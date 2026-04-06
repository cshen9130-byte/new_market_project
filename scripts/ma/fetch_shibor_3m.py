#!/usr/bin/env python3
"""
fetch_shibor_3m.py
==================
Fetches SHIBOR 3M monthly data and upserts into `shibor_3m_monthly` table.

Data sources
------------
  --seed-csv   Read from money_credit/data/shibor_3m_monthly.csv (initial backfill)
  (default)    Fetch from akshare macro_china_shibor_all(), resample to month-end

Usage
-----
  python3 scripts/ma/fetch_shibor_3m.py            # fetch from akshare
  python3 scripts/ma/fetch_shibor_3m.py --seed-csv # seed from local CSV

Prints JSON: {"upserted": N}
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

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
log = logging.getLogger('fetch_shibor_3m')

MONEY_CREDIT_DIR = (
    Path(__file__).resolve().parent.parent.parent / 'money_credit' / 'data'
)


# ── DB ─────────────────────────────────────────────────────────────────────────
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


def upsert_rows(conn, rows: list[tuple]) -> int:
    """rows: [(month_date, shibor_3m_close), ...]"""
    if not rows:
        return 0
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO shibor_3m_monthly (month, shibor_3m_close, updated_at)
            VALUES %s
            ON CONFLICT (month) DO UPDATE
              SET shibor_3m_close = EXCLUDED.shibor_3m_close,
                  updated_at      = NOW()
            """,
            rows,
            template="(%s, %s, NOW())",
        )
    conn.commit()
    return len(rows)


# ── SEED FROM CSV ──────────────────────────────────────────────────────────────
def load_from_csv() -> pd.DataFrame:
    """Load shibor_3m_monthly.csv, return DataFrame with month-end index and shibor_3m_close column."""
    csv_path = MONEY_CREDIT_DIR / 'shibor_3m_monthly.csv'
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")
    df = pd.read_csv(csv_path, parse_dates=['date'])
    df = df.dropna(subset=['shibor_3m_close'])
    df['date'] = pd.to_datetime(df['date']) + pd.offsets.MonthEnd(0)
    df = df.set_index('date').sort_index()
    df = df[['shibor_3m_close']]
    # forward-fill then backward-fill short gaps
    df['shibor_3m_close'] = df['shibor_3m_close'].ffill().bfill()
    df = df.dropna()
    log.info("CSV seed: %d rows from %s to %s",
             len(df), df.index[0].date(), df.index[-1].date())
    return df


# ── FETCH FROM AKSHARE ─────────────────────────────────────────────────────────
def load_from_akshare() -> pd.DataFrame:
    """Fetch SHIBOR all tenors from akshare, extract 3M, resample to month-end."""
    try:
        import akshare as ak
    except ImportError:
        raise ImportError("akshare is not installed")

    log.info("Fetching SHIBOR from akshare...")
    raw = ak.macro_china_shibor_all()
    log.info("Raw shape: %s  columns: %s", raw.shape, list(raw.columns))

    # Normalize column names
    raw.columns = [str(c).strip() for c in raw.columns]

    # Find the date column (usually '日期' or 'date')
    date_col = None
    for c in raw.columns:
        if '日期' in c or c.lower() == 'date':
            date_col = c
            break
    if date_col is None:
        date_col = raw.columns[0]

    # Find 3M rate column — try exact names first, then prefix match
    # akshare changed column format from "3M" to "3M-定价" at some point
    rate_col = None
    for candidate in ['3个月', '3M', '3m', '三个月', '90天', '3M-定价']:
        if candidate in raw.columns:
            rate_col = candidate
            break
    if rate_col is None:
        # Fallback: find any column that starts with "3M" (e.g. "3M-定价", "3M-涨跌幅" → pick 定价)
        for c in raw.columns:
            if str(c).startswith('3M') and '涨跌' not in c:
                rate_col = c
                break
    if rate_col is None:
        raise ValueError(f"Cannot find 3M column in: {list(raw.columns)}")

    df = raw[[date_col, rate_col]].copy()
    df.columns = ['date', 'shibor_3m_close']
    df['date'] = pd.to_datetime(df['date'])
    df = df.dropna(subset=['shibor_3m_close'])
    df['shibor_3m_close'] = pd.to_numeric(df['shibor_3m_close'], errors='coerce')
    df = df.dropna(subset=['shibor_3m_close'])
    df = df.set_index('date').sort_index()

    # Resample to month-end, take last value
    df = df.resample('ME').last()
    df['shibor_3m_close'] = df['shibor_3m_close'].ffill().bfill()
    df = df.loc['2006-10-01':].dropna()

    log.info("akshare: %d monthly rows from %s to %s",
             len(df), df.index[0].date(), df.index[-1].date())
    return df


# ── MAIN ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seed-csv', action='store_true',
                        help='Seed from local CSV instead of akshare')
    args = parser.parse_args()

    try:
        if args.seed_csv:
            df = load_from_csv()
        else:
            df = load_from_akshare()

        rows = [
            (row.name.date(), float(row['shibor_3m_close']))
            for _, row in df.iterrows()
            if pd.notna(row['shibor_3m_close'])
        ]

        conn = get_conn()
        n = upsert_rows(conn, rows)
        conn.close()

        log.info("Upserted %d rows into shibor_3m_monthly", n)
        print(json.dumps({"upserted": n}))
        sys.exit(0)

    except Exception as e:
        log.exception("fetch_shibor_3m failed")
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
