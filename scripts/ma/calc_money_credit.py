#!/usr/bin/env python3
"""
calc_money_credit.py
====================
Computes the 货币+信用 四象限周期 from DB data and upserts results into
`money_credit_cycle`.

Data sources (from PostgreSQL)
-------------------------------
  shibor_3m_monthly      month, shibor_3m_close
  macro_indicators_monthly  month, afre   (social financing stock YoY %)

Algorithm
---------
  1. Inner-join on month
  2. 3-month rolling mean + slope for both SHIBOR and social financing
  3. Rolling 36-month 25th/75th percentile for context
  4. Monetary state:  加速收紧 / 加速放松 / 高位平稳 / 低位平稳 / 中性平稳
  5. Credit state:    加速扩张 / 加速收缩 / 高位平稳 / 低位平稳 / 中性平稳
  6. Two-class:       宽货币/紧货币/中性货币 · 宽信用/紧信用/中性信用
  7. Quadrant:        衰退/防御 · 复苏/进攻 · 过热/商品 · 滞胀/现金 · 中性

Prints JSON: {"status": "ok", "run_date": "...", "rows": N}
"""
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import date
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
log = logging.getLogger('calc_money_credit')

SHIBOR_THRESH = 0.08   # monthly slope threshold for SHIBOR (% points)
SOCIAL_THRESH = 0.20   # monthly slope threshold for social financing (% points)


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


def load_data(conn) -> pd.DataFrame:
    """Load SHIBOR and social financing from DB, return inner-joined DataFrame."""
    shibor_sql = """
        SELECT date_trunc('month', month)::date AS month,
               shibor_3m_close
        FROM shibor_3m_monthly
        ORDER BY month
    """
    social_sql = """
        SELECT date_trunc('month', month)::date AS month,
               afre AS social
        FROM macro_indicators_monthly
        WHERE afre IS NOT NULL
        ORDER BY month
    """
    df_shibor = pd.read_sql(shibor_sql, conn, parse_dates=['month'])
    df_social = pd.read_sql(social_sql, conn, parse_dates=['month'])

    # Align to month-end
    df_shibor['month'] = pd.to_datetime(df_shibor['month']) + pd.offsets.MonthEnd(0)
    df_social['month'] = pd.to_datetime(df_social['month']) + pd.offsets.MonthEnd(0)

    df_shibor = df_shibor.set_index('month').sort_index()
    df_social = df_social.set_index('month').sort_index()

    # SHIBOR: resample to month-end (last value), ffill gaps
    df_shibor = df_shibor.resample('ME').last().ffill().bfill()

    df = df_social.join(df_shibor, how='inner')
    df.columns = ['social', 'shibor']
    df.sort_index(inplace=True)

    # Only use from 2006-10 (SHIBOR started)
    df = df.loc['2006-10-01':]
    log.info("Joined data: %d rows from %s to %s",
             len(df), df.index[0].date(), df.index[-1].date())
    return df


# ── COMPUTE CYCLE ──────────────────────────────────────────────────────────────
def compute_cycle(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # 3-month MA and slope
    df['social_ma']    = df['social'].rolling(3).mean()
    df['shibor_ma']    = df['shibor'].rolling(3).mean()
    df['social_slope'] = df['social_ma'].diff()
    df['shibor_slope'] = df['shibor_ma'].diff()

    # Rolling 36-month percentiles
    df['shibor_lower'] = df['shibor_ma'].rolling(36).quantile(0.25)
    df['shibor_upper'] = df['shibor_ma'].rolling(36).quantile(0.75)
    df['social_lower'] = df['social_ma'].rolling(36).quantile(0.25)
    df['social_upper'] = df['social_ma'].rolling(36).quantile(0.75)

    def monetary_state(row):
        s, m = row['shibor_slope'], row['shibor_ma']
        lo, hi = row['shibor_lower'], row['shibor_upper']
        if any(pd.isna(x) for x in [s, m, lo, hi]):
            return np.nan
        if s > SHIBOR_THRESH:
            return '加速收紧'
        elif s < -SHIBOR_THRESH:
            return '加速放松'
        elif m >= hi:
            return '高位平稳'
        elif m <= lo:
            return '低位平稳'
        else:
            return '中性平稳'

    def credit_state(row):
        s, m = row['social_slope'], row['social_ma']
        lo, hi = row['social_lower'], row['social_upper']
        if any(pd.isna(x) for x in [s, m, lo, hi]):
            return np.nan
        if s > SOCIAL_THRESH:
            return '加速扩张'
        elif s < -SOCIAL_THRESH:
            return '加速收缩'
        elif m >= hi:
            return '高位平稳'
        elif m <= lo:
            return '低位平稳'
        else:
            return '中性平稳'

    df['monetary_state'] = df.apply(monetary_state, axis=1)
    df['credit_state']   = df.apply(credit_state, axis=1)

    MONETARY_MAP = {
        '加速放松': '宽货币', '低位平稳': '宽货币',
        '加速收紧': '紧货币', '高位平稳': '紧货币',
        '中性平稳': '中性货币',
    }
    CREDIT_MAP = {
        '加速扩张': '宽信用', '高位平稳': '宽信用',
        '加速收缩': '紧信用', '低位平稳': '紧信用',
        '中性平稳': '中性信用',
    }

    df['monetary'] = df['monetary_state'].map(MONETARY_MAP)
    df['credit']   = df['credit_state'].map(CREDIT_MAP)

    def quadrant(row):
        m, c = row['monetary'], row['credit']
        if pd.isna(m) or pd.isna(c):
            return '中性'
        if m == '宽货币' and c == '紧信用':
            return '衰退/防御'
        elif m == '宽货币' and c == '宽信用':
            return '复苏/进攻'
        elif m == '紧货币' and c == '宽信用':
            return '过热/商品'
        elif m == '紧货币' and c == '紧信用':
            return '滞胀/现金'
        else:
            return '中性'

    df['quadrant'] = df.apply(quadrant, axis=1)
    return df


# ── UPSERT ─────────────────────────────────────────────────────────────────────
def upsert_cycle(conn, df: pd.DataFrame) -> int:
    cols = ['social', 'shibor', 'social_ma', 'shibor_ma',
            'social_slope', 'shibor_slope',
            'monetary_state', 'credit_state', 'monetary', 'credit', 'quadrant']

    def safe(v):
        if v is None:
            return None
        if isinstance(v, float) and np.isnan(v):
            return None
        return v

    rows = []
    for ts, row in df.iterrows():
        rows.append((
            ts.date(),
            safe(row.get('social')), safe(row.get('shibor')),
            safe(row.get('social_ma')), safe(row.get('shibor_ma')),
            safe(row.get('social_slope')), safe(row.get('shibor_slope')),
            row.get('monetary_state') if not isinstance(row.get('monetary_state'), float) else None,
            row.get('credit_state')   if not isinstance(row.get('credit_state'),   float) else None,
            row.get('monetary')       if not isinstance(row.get('monetary'),       float) else None,
            row.get('credit')         if not isinstance(row.get('credit'),         float) else None,
            row.get('quadrant')       if not isinstance(row.get('quadrant'),       float) else None,
        ))

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO money_credit_cycle
                (month, social, shibor, social_ma, shibor_ma,
                 social_slope, shibor_slope,
                 monetary_state, credit_state, monetary, credit, quadrant,
                 updated_at)
            VALUES %s
            ON CONFLICT (month) DO UPDATE SET
                social         = EXCLUDED.social,
                shibor         = EXCLUDED.shibor,
                social_ma      = EXCLUDED.social_ma,
                shibor_ma      = EXCLUDED.shibor_ma,
                social_slope   = EXCLUDED.social_slope,
                shibor_slope   = EXCLUDED.shibor_slope,
                monetary_state = EXCLUDED.monetary_state,
                credit_state   = EXCLUDED.credit_state,
                monetary       = EXCLUDED.monetary,
                credit         = EXCLUDED.credit,
                quadrant       = EXCLUDED.quadrant,
                updated_at     = NOW()
            """,
            rows,
            template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())",
        )
    conn.commit()
    return len(rows)


# ── MAIN ───────────────────────────────────────────────────────────────────────
def main():
    try:
        conn = get_conn()
        df_raw = load_data(conn)
        df_cycle = compute_cycle(df_raw)

        latest = df_cycle.dropna(subset=['quadrant']).iloc[-1]
        log.info(
            "Latest: %s  货币=%s  信用=%s  象限=【%s】",
            latest.name.strftime('%Y-%m'),
            latest.get('monetary', '?'),
            latest.get('credit', '?'),
            latest.get('quadrant', '?'),
        )

        n = upsert_cycle(conn, df_cycle)
        conn.close()

        run_date = date.today().isoformat()
        log.info("Upserted %d rows into money_credit_cycle", n)
        print(json.dumps({"status": "ok", "run_date": run_date, "rows": n}))
        sys.exit(0)

    except Exception as e:
        log.exception("calc_money_credit failed")
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
