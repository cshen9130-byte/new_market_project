#!/usr/bin/env python3
"""
calc_regime_similarity.py
=========================
Reads macro_indicators_monthly from PostgreSQL, computes rolling z-score
normalisation and Euclidean-distance similarity to find the historical months
most resembling the current economic regime.

Algorithm mirrors similar_regime/regime_identification.py:
  1. Derive YoY transforms  (pmi_chg, yield_chg, spread_chg, nhci_yoy)
  2. Apply rolling 120-month z-score (clipped ±3)
  3. Select current month (latest row with all 7 z-scores)
  4. Compute distances vs all months > 36 months earlier
  5. Keep top 20; save all distances

Saves results to:
  regime_current_zscores   (one row per run_date)
  regime_similarity_top    (20 rows per run_date)
  regime_all_distances     (N rows per run_date, one per historical month)

Prints JSON: {"status": "ok", "run_date": "...", "current_month": "...", "rows_top": 20}
"""
from __future__ import annotations

import json
import logging
import os
import sys
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
except ImportError as exc:
    print(json.dumps({'error': str(exc)}))
    sys.exit(1)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('calc_regime')

VARS_LIST  = ['pmi_chg', 'yield_chg', 'spread_chg', 'nhci_yoy', 'afre', 'm1', 'cpi']
Z_COLS     = [v + '_z' for v in VARS_LIST]
ROLLING_WIN = 120    # 10-year window for z-score normalisation
EXCLUDE_MONTHS = 36  # exclude last 36 months from historical candidates


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


# ── LOAD DATA ─────────────────────────────────────────────────────────────────
def load_indicators(conn) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT month, pmi, afre, m1, cpi, yield_10y, spread_10y1y, nhci
            FROM macro_indicators_monthly
            ORDER BY month ASC
        """)
        rows = cur.fetchall()
    if not rows:
        raise RuntimeError('macro_indicators_monthly is empty — run fetch_regime_indicators.py first')

    df = pd.DataFrame(rows, columns=['date', 'pmi', 'afre', 'm1', 'cpi',
                                     'yield_10y', 'spread_10y1y', 'nhci'])
    for c in df.columns[1:]:
        df[c] = pd.to_numeric(df[c], errors='coerce')
    df['date'] = pd.to_datetime(df['date'])
    df = df.set_index('date').sort_index()
    return df


# ── DERIVED VARIABLES ─────────────────────────────────────────────────────────
def build_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """Compute YoY derivatives and clean."""
    df = df.copy()
    df['pmi_chg']    = df['pmi']       - df['pmi'].shift(12)
    df['yield_chg']  = df['yield_10y'] - df['yield_10y'].shift(12)
    df['spread_chg'] = df['spread_10y1y'] - df['spread_10y1y'].shift(12)
    df['nhci_yoy']   = (df['nhci'] / df['nhci'].shift(12) - 1) * 100
    # afre, m1, cpi are already YoY values from source
    return df[VARS_LIST].dropna()


# ── ROLLING Z-SCORE ──────────────────────────────────────────────────────────
def rolling_zscore(series: pd.Series, window: int = ROLLING_WIN) -> pd.Series:
    roll_mean = series.rolling(window, min_periods=window).mean()
    roll_std  = series.rolling(window, min_periods=window).std()
    return ((series - roll_mean) / roll_std).clip(-3, 3)


def compute_zscores(df_vars: pd.DataFrame) -> pd.DataFrame:
    df_z = df_vars.copy()
    for var in VARS_LIST:
        df_z[var + '_z'] = rolling_zscore(df_vars[var])
    return df_z.dropna(subset=Z_COLS)


# ── MAIN COMPUTATION ──────────────────────────────────────────────────────────
def compute_similarity(conn) -> dict:
    df_raw = load_indicators(conn)
    df_vars = build_feature_matrix(df_raw)
    df_z = compute_zscores(df_vars)

    if df_z.empty:
        raise RuntimeError(
            f'Not enough data for z-score computation (need >{ROLLING_WIN} months with full data)'
        )

    # Current month = latest row with all z-scores
    current_date = df_z.index[-1]
    current_vec  = df_z.loc[current_date, Z_COLS].values.astype(float)
    log.info('Current analysis month: %s', current_date.strftime('%Y-%m-%d'))

    # Historical candidates: exclude last 36 months
    earliest_excl = current_date - pd.DateOffset(months=EXCLUDE_MONTHS)
    hist_idx = df_z.index[df_z.index < earliest_excl]

    if len(hist_idx) == 0:
        raise RuntimeError('Not enough historical data (need >36 months before current)')

    # Euclidean distances
    hist_matrix = df_z.loc[hist_idx, Z_COLS].values.astype(float)
    diffs = hist_matrix - current_vec
    distances = np.sqrt((diffs ** 2).sum(axis=1))

    dist_df = pd.DataFrame({
        'hist_month': hist_idx,
        'distance':   distances,
    }).sort_values('distance').reset_index(drop=True)

    top20 = dist_df.head(20).copy()
    top20['rank'] = range(1, len(top20) + 1)

    # Attach z-scores for top 20
    for col in Z_COLS:
        top20[col] = top20['hist_month'].map(df_z[col])

    run_date = date.today()

    return {
        'run_date':     run_date,
        'current_date': current_date,
        'current_vec':  current_vec,
        'top20':        top20,
        'dist_df':      dist_df,
        'df_z':         df_z,
    }


# ── UPSERT RESULTS ────────────────────────────────────────────────────────────
def upsert_current_zscores(conn, run_date: date, current_date,
                            current_vec: np.ndarray) -> None:
    cur_month = current_date.date() if hasattr(current_date, 'date') else current_date
    vals = [float(v) if np.isfinite(v) else None for v in current_vec]
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO regime_current_zscores
                (run_date, current_month, pmi_chg_z, yield_chg_z, spread_chg_z,
                 nhci_yoy_z, afre_z, m1_z, cpi_z)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (run_date) DO UPDATE SET
                current_month = EXCLUDED.current_month,
                pmi_chg_z     = EXCLUDED.pmi_chg_z,
                yield_chg_z   = EXCLUDED.yield_chg_z,
                spread_chg_z  = EXCLUDED.spread_chg_z,
                nhci_yoy_z    = EXCLUDED.nhci_yoy_z,
                afre_z        = EXCLUDED.afre_z,
                m1_z          = EXCLUDED.m1_z,
                cpi_z         = EXCLUDED.cpi_z
        """, [run_date, cur_month] + vals)


def upsert_top20(conn, run_date: date, top20: pd.DataFrame) -> None:
    def sf(v):
        try:
            f = float(v)
            return f if np.isfinite(f) else None
        except (TypeError, ValueError):
            return None

    rows = []
    for _, r in top20.iterrows():
        hm = r['hist_month']
        if hasattr(hm, 'date'):
            hm = hm.date()
        rows.append((
            run_date, int(r['rank']), hm, sf(r['distance']),
            sf(r.get('pmi_chg_z')),  sf(r.get('yield_chg_z')),
            sf(r.get('spread_chg_z')), sf(r.get('nhci_yoy_z')),
            sf(r.get('afre_z')),     sf(r.get('m1_z')),
            sf(r.get('cpi_z')),
        ))

    with conn.cursor() as cur:
        # Clear previous run entries for today and re-insert
        cur.execute('DELETE FROM regime_similarity_top WHERE run_date = %s', [run_date])
        execute_values(cur, """
            INSERT INTO regime_similarity_top
                (run_date, rank, similar_month, distance,
                 pmi_chg_z, yield_chg_z, spread_chg_z, nhci_yoy_z,
                 afre_z, m1_z, cpi_z)
            VALUES %s
        """, rows)


def upsert_all_distances(conn, run_date: date, dist_df: pd.DataFrame) -> None:
    rows = []
    for _, r in dist_df.iterrows():
        hm = r['hist_month']
        if hasattr(hm, 'date'):
            hm = hm.date()
        d = float(r['distance'])
        if not np.isfinite(d):
            continue
        rows.append((run_date, hm, d))

    with conn.cursor() as cur:
        cur.execute('DELETE FROM regime_all_distances WHERE run_date = %s', [run_date])
        execute_values(cur, """
            INSERT INTO regime_all_distances (run_date, hist_month, distance)
            VALUES %s
        """, rows)


# ── ENTRY POINT ───────────────────────────────────────────────────────────────
def main():
    conn = get_conn()
    try:
        result = compute_similarity(conn)
        run_date     = result['run_date']
        current_date = result['current_date']
        top20        = result['top20']
        dist_df      = result['dist_df']
        current_vec  = result['current_vec']

        upsert_current_zscores(conn, run_date, current_date, current_vec)
        upsert_top20(conn, run_date, top20)
        upsert_all_distances(conn, run_date, dist_df)
        conn.commit()

        log.info('Regime similarity saved for run_date=%s current_month=%s top20 rows=%d all=%d',
                 run_date, current_date.strftime('%Y-%m'), len(top20), len(dist_df))
        print(json.dumps({
            'status':        'ok',
            'run_date':      run_date.isoformat(),
            'current_month': current_date.strftime('%Y-%m'),
            'rows_top':      len(top20),
            'rows_all':      len(dist_df),
        }))
    except Exception as exc:
        log.error('calc_regime_similarity failed: %s', exc)
        print(json.dumps({'error': str(exc)}))
        conn.rollback()
        sys.exit(1)
    finally:
        conn.close()


if __name__ == '__main__':
    main()
