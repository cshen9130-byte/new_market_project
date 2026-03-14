#!/usr/bin/env python3
"""
fetch_regime_indicators.py
==========================
Fetches monthly macro-economic indicators for the regime similarity model and
upserts them into the `macro_indicators_monthly` PostgreSQL table.

Data sources
------------
  --seed-csv   Read from existing CSVs in similar_regime/data/ (initial backfill)
  (default)    Fetch full history via akshare + NHCI from PostgreSQL

Variables stored
-----------------
  pmi          Manufacturing PMI level
  afre         Social financing stock YoY % (社融存量同比增速)
  m1           M1 YoY %
  cpi          CPI YoY %
  yield_10y    10-year govt bond yield (monthly mean)
  spread_10y1y 10Y-1Y term spread (monthly mean)
  nhci         Nanhua Commodity Index (month-end close, from raw_nhci_daily)

Usage
-----
  python scripts/ma/fetch_regime_indicators.py              # full fetch via akshare
  python scripts/ma/fetch_regime_indicators.py --seed-csv   # seed from local CSVs

Prints JSON: {"upserted": N}
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import date
from pathlib import Path

# ── Load .env ─────────────────────────────────────────────────────────────────
for fname in ('.env.local', '.env'):
    for base in (Path('.'), Path(__file__).resolve().parent.parent.parent):
        f = base / fname
        if f.is_file():
            for line in f.read_text(encoding='utf-8', errors='ignore').splitlines():
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v

try:
    import psycopg2
    from psycopg2.extras import execute_values
    import pandas as pd
    import numpy as np
except ImportError as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('fetch_regime')

SIMILAR_REGIME_DIR = (
    Path(__file__).resolve().parent.parent.parent / 'similar_regime' / 'data'
)


# ── DB ────────────────────────────────────────────────────────────────────────
def get_conn():
    url = os.environ.get('DATABASE_URL')
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get('DB_HOST', 'localhost'),
        port=int(os.environ.get('DB_PORT', '5432')),
        dbname=os.environ.get('DB_NAME', 'market_data'),
        user=os.environ.get('DB_USER', 'market_user'),
        password=os.environ.get('DB_PASSWORD', ''),
    )


def to_month_end(df: pd.DataFrame, col: str = 'date') -> pd.DataFrame:
    df = df.copy()
    df[col] = pd.to_datetime(df[col]) + pd.offsets.MonthEnd(0)
    return df


# ── SEED FROM EXISTING CSVs ───────────────────────────────────────────────────
def load_from_csvs() -> pd.DataFrame:
    D = SIMILAR_REGIME_DIR
    frames: dict[str, pd.DataFrame] = {}

    if (D / 'china_pmi_monthly.csv').exists():
        df = pd.read_csv(D / 'china_pmi_monthly.csv', parse_dates=['date'])
        df = to_month_end(df)
        frames['pmi'] = df.rename(columns={'value': 'pmi'})[['date', 'pmi']]

    if (D / 'china_afre_stock_yoy_monthly.csv').exists():
        df = pd.read_csv(D / 'china_afre_stock_yoy_monthly.csv', parse_dates=['date'])
        df = to_month_end(df)
        frames['afre'] = df.rename(columns={'value': 'afre'})[['date', 'afre']]

    if (D / 'china_m1_yoy_monthly.csv').exists():
        df = pd.read_csv(D / 'china_m1_yoy_monthly.csv', parse_dates=['date'])
        df = to_month_end(df)
        frames['m1'] = df.rename(columns={'value': 'm1'})[['date', 'm1']]

    if (D / 'china_cpi_yoy_monthly.csv').exists():
        df = pd.read_csv(D / 'china_cpi_yoy_monthly.csv', parse_dates=['date'])
        df = to_month_end(df)
        frames['cpi'] = df.rename(columns={'value': 'cpi'})[['date', 'cpi']]

    if (D / 'china_10y_bond_yield_monthly.csv').exists():
        df = pd.read_csv(D / 'china_10y_bond_yield_monthly.csv')
        df['date'] = pd.to_datetime(df['date']) + pd.offsets.MonthEnd(0)
        col = 'china_10y_yield' if 'china_10y_yield' in df.columns else df.columns[1]
        frames['yield_10y'] = df[['date', col]].rename(
            columns={col: 'yield_10y'})

    if (D / 'china_10y1y_spread_monthly.csv').exists():
        df = pd.read_csv(D / 'china_10y1y_spread_monthly.csv')
        df['date'] = pd.to_datetime(df['date']) + pd.offsets.MonthEnd(0)
        col = '10Y_1Y_spread' if '10Y_1Y_spread' in df.columns else df.columns[1]
        frames['spread_10y1y'] = df[['date', col]].rename(
            columns={col: 'spread_10y1y'})

    # NHII daily → month-end close (NHII = Nanhua Industrial Index, similar to NHCI)
    for nhii_name in ('china_nhii_daily.csv', 'china_nhii_monthly.csv'):
        nhii_path = D / nhii_name
        if nhii_path.exists():
            df = pd.read_csv(nhii_path, parse_dates=['date'])
            close_col = 'close' if 'close' in df.columns else df.columns[1]
            df = df.set_index('date')[close_col].resample('ME').last().reset_index()
            df = to_month_end(df)
            frames['nhci'] = df.rename(columns={close_col: 'nhci'})[['date', 'nhci']]
            break

    if not frames:
        raise RuntimeError(f'No CSV files found in {D}')

    # Merge on date (outer join)
    df_list = list(frames.values())
    merged = df_list[0].set_index('date')
    for df in df_list[1:]:
        merged = merged.join(df.set_index('date'), how='outer')
    return merged.reset_index()


# ── AKSHARE FETCHERS ──────────────────────────────────────────────────────────
def fetch_pmi_akshare() -> pd.DataFrame:
    import akshare as ak
    df = ak.macro_china_pmi_manufacturing()
    date_col = '月份' if '月份' in df.columns else df.columns[0]
    val_col = next(
        (c for c in df.columns if 'pmi' in c.lower() or 'PMI' in c),
        df.columns[1],
    )
    out = df[[date_col, val_col]].rename(columns={date_col: 'date', val_col: 'pmi'})
    out['pmi'] = pd.to_numeric(out['pmi'], errors='coerce')
    out['date'] = pd.to_datetime(out['date'], errors='coerce') + pd.offsets.MonthEnd(0)
    return out.dropna(subset=['date', 'pmi'])[['date', 'pmi']]


def fetch_m1_akshare() -> pd.DataFrame:
    import akshare as ak
    df = ak.macro_china_money_supply_bal()
    date_col = '月份' if '月份' in df.columns else df.columns[0]
    val_col = next(
        (c for c in df.columns if 'M1' in c and ('同比' in c or '增长' in c or 'yoy' in c.lower())),
        next((c for c in df.columns if 'M1' in c), None),
    )
    if val_col is None:
        return pd.DataFrame(columns=['date', 'm1'])
    out = df[[date_col, val_col]].rename(columns={date_col: 'date', val_col: 'm1'})
    out['m1'] = pd.to_numeric(out['m1'], errors='coerce')
    out['date'] = pd.to_datetime(out['date'], errors='coerce') + pd.offsets.MonthEnd(0)
    return out.dropna(subset=['date', 'm1'])[['date', 'm1']]


def fetch_cpi_akshare() -> pd.DataFrame:
    import akshare as ak
    df = ak.macro_china_cpi_monthly()
    date_col = '月份' if '月份' in df.columns else df.columns[0]
    val_col = next(
        (c for c in df.columns if '同比' in c and ('全国' in c or '居民' in c)),
        next((c for c in df.columns if '当月' in c), None),
    )
    if val_col is None and len(df.columns) > 1:
        val_col = df.columns[1]
    if val_col is None:
        return pd.DataFrame(columns=['date', 'cpi'])
    out = df[[date_col, val_col]].rename(columns={date_col: 'date', val_col: 'cpi'})
    out['cpi'] = pd.to_numeric(out['cpi'], errors='coerce')
    out['date'] = pd.to_datetime(out['date'], errors='coerce') + pd.offsets.MonthEnd(0)
    return out.dropna(subset=['date', 'cpi'])[['date', 'cpi']]


def fetch_afre_akshare() -> pd.DataFrame:
    """Social financing stock YoY %."""
    import akshare as ak
    for fn_name in ['macro_china_shrzgm_change_rate', 'macro_china_sf_month',
                    'macro_china_shrzgm']:
        try:
            df = getattr(ak, fn_name)()
            log.info('AFRE: used akshare.%s', fn_name)
            break
        except (AttributeError, Exception):
            continue
    else:
        log.warning('AFRE: no matching akshare function found')
        return pd.DataFrame(columns=['date', 'afre'])

    date_col = df.columns[0]
    val_col = next(
        (c for c in df.columns if '同比' in c or '增速' in c or 'yoy' in c.lower()),
        df.columns[1] if len(df.columns) > 1 else None,
    )
    if val_col is None:
        return pd.DataFrame(columns=['date', 'afre'])
    out = df[[date_col, val_col]].rename(columns={date_col: 'date', val_col: 'afre'})
    out['afre'] = pd.to_numeric(out['afre'], errors='coerce')
    out['date'] = pd.to_datetime(out['date'], errors='coerce') + pd.offsets.MonthEnd(0)
    return out.dropna(subset=['date', 'afre'])[['date', 'afre']]


def fetch_bond_akshare() -> pd.DataFrame:
    """10Y yield and 10-1Y spread, full history, monthly means."""
    import akshare as ak
    CURVE_NAME = '中债国债收益率曲线'
    start, end = date(2000, 1, 1), date.today()
    frames = []
    cur = start
    while cur <= end:
        chunk_end = date.fromordinal(min(cur.toordinal() + 364, end.toordinal()))
        s_str, e_str = cur.strftime('%Y%m%d'), chunk_end.strftime('%Y%m%d')
        for attempt in range(1, 4):
            try:
                df = ak.bond_china_yield(start_date=s_str, end_date=e_str)
                gov = df[df['曲线名称'] == CURVE_NAME]
                if not gov.empty and '10年' in gov.columns and '1年' in gov.columns:
                    frames.append(gov[['日期', '1年', '10年']])
                break
            except Exception as exc:
                if attempt < 3:
                    time.sleep(3)
                else:
                    log.warning('bond_china_yield %s~%s failed: %s', s_str, e_str, exc)
        cur = date.fromordinal(chunk_end.toordinal() + 1)

    if not frames:
        return pd.DataFrame(columns=['date', 'yield_10y', 'spread_10y1y'])

    raw = pd.concat(frames, ignore_index=True)
    raw['日期'] = pd.to_datetime(raw['日期'])
    raw['1年'] = pd.to_numeric(raw['1年'], errors='coerce')
    raw['10年'] = pd.to_numeric(raw['10年'], errors='coerce')
    raw = raw.dropna(subset=['1年', '10年']).sort_values('日期').set_index('日期')
    raw['spread_10y1y'] = raw['10年'] - raw['1年']
    monthly = raw[['10年', 'spread_10y1y']].resample('ME').mean().reset_index()
    monthly.columns = ['date', 'yield_10y', 'spread_10y1y']
    return monthly


def fetch_nhci_from_db(conn) -> pd.DataFrame:
    """NHCI from raw_nhci_daily, resampled to month-end close."""
    with conn.cursor() as cur:
        cur.execute(
            'SELECT trade_date, close FROM raw_nhci_daily ORDER BY trade_date'
        )
        rows = cur.fetchall()
    if not rows:
        return pd.DataFrame(columns=['date', 'nhci'])
    df = pd.DataFrame(rows, columns=['date', 'nhci'])
    df['date'] = pd.to_datetime(df['date'])
    df['nhci'] = pd.to_numeric(df['nhci'], errors='coerce')
    df = df.dropna().sort_values('date').set_index('date')
    monthly = df['nhci'].resample('ME').last().reset_index()
    monthly.columns = ['date', 'nhci']
    return monthly


# ── MERGE & UPSERT ────────────────────────────────────────────────────────────
def merge_all(dfs: list[pd.DataFrame]) -> pd.DataFrame:
    nonempty = [d for d in dfs if not d.empty]
    if not nonempty:
        return pd.DataFrame()
    merged = nonempty[0].set_index('date')
    for df in nonempty[1:]:
        merged = merged.join(df.set_index('date'), how='outer')
    return merged.reset_index()


def upsert_to_db(conn, merged: pd.DataFrame) -> int:
    cols = ['pmi', 'afre', 'm1', 'cpi', 'yield_10y', 'spread_10y1y', 'nhci']
    for c in cols:
        if c not in merged.columns:
            merged[c] = None

    def sf(v):
        try:
            return float(v) if v is not None and not (
                isinstance(v, float) and np.isnan(v)) else None
        except (TypeError, ValueError):
            return None

    rows = []
    for _, r in merged.iterrows():
        d = r['date']
        if pd.isna(d):
            continue
        rows.append((
            d.date() if hasattr(d, 'date') else d,
            sf(r.get('pmi')), sf(r.get('afre')), sf(r.get('m1')),
            sf(r.get('cpi')), sf(r.get('yield_10y')),
            sf(r.get('spread_10y1y')), sf(r.get('nhci')),
        ))

    if not rows:
        return 0

    sql = """
        INSERT INTO macro_indicators_monthly
            (month, pmi, afre, m1, cpi, yield_10y, spread_10y1y, nhci)
        VALUES %s
        ON CONFLICT (month) DO UPDATE SET
            pmi          = COALESCE(EXCLUDED.pmi,          macro_indicators_monthly.pmi),
            afre         = COALESCE(EXCLUDED.afre,         macro_indicators_monthly.afre),
            m1           = COALESCE(EXCLUDED.m1,           macro_indicators_monthly.m1),
            cpi          = COALESCE(EXCLUDED.cpi,          macro_indicators_monthly.cpi),
            yield_10y    = COALESCE(EXCLUDED.yield_10y,    macro_indicators_monthly.yield_10y),
            spread_10y1y = COALESCE(EXCLUDED.spread_10y1y, macro_indicators_monthly.spread_10y1y),
            nhci         = COALESCE(EXCLUDED.nhci,         macro_indicators_monthly.nhci),
            updated_at   = NOW()
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--seed-csv', action='store_true',
                        help='Seed from existing CSV files in similar_regime/data/')
    args = parser.parse_args()

    conn = get_conn()
    try:
        if args.seed_csv:
            log.info('Seeding from CSV files in %s ...', SIMILAR_REGIME_DIR)
            merged = load_from_csvs()
            log.info('Loaded %d merged rows from CSVs', len(merged))
        else:
            log.info('Fetching macro indicators from akshare ...')
            dfs: list[pd.DataFrame] = []

            for label, fn in [
                ('PMI',  fetch_pmi_akshare),
                ('M1',   fetch_m1_akshare),
                ('CPI',  fetch_cpi_akshare),
                ('AFRE', fetch_afre_akshare),
            ]:
                try:
                    df = fn()
                    log.info('%s: %d rows', label, len(df))
                    dfs.append(df)
                except Exception as exc:
                    log.warning('%s: fetch failed — %s', label, exc)
                    # continue; missing indicator will leave nulls in DB

            try:
                log.info('Fetching bond yields (multi-year chunked, may take ~2 min)...')
                bond_df = fetch_bond_akshare()
                log.info('Bond: %d rows', len(bond_df))
                dfs.append(bond_df[['date', 'yield_10y']])
                dfs.append(bond_df[['date', 'spread_10y1y']])
            except Exception as exc:
                log.warning('Bond: fetch failed — %s', exc)

            try:
                nhci_df = fetch_nhci_from_db(conn)
                log.info('NHCI: %d rows', len(nhci_df))
                dfs.append(nhci_df)
            except Exception as exc:
                log.warning('NHCI: fetch failed — %s', exc)

            merged = merge_all(dfs)

        n = upsert_to_db(conn, merged)
        log.info('Upserted %d rows to macro_indicators_monthly', n)
        print(json.dumps({'upserted': n}))
    finally:
        conn.close()


if __name__ == '__main__':
    main()
