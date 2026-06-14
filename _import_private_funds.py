"""
Import private fund data into PostgreSQL.

Tables created:
  private_fund_info  – metadata from xlsx (备案号 as PK)
  private_fund_nav   – NAV time-series from nav_csv/ (linked by 备案号)
"""

import os
import re
import sys
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

# ── Config ──────────────────────────────────────────────────────────────────
DATABASE_URL = "postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
XLSX_PATH    = os.path.join(os.path.dirname(__file__), "20260515以来更新净值的私募证券基金（10800只）.xlsx")
NAV_DIR      = os.path.join(os.path.dirname(__file__), "nav_csv")

# ── Helpers ──────────────────────────────────────────────────────────────────
def clean_pct(val):
    """Convert '+7.53%' / '-1.2%' strings to float, or None."""
    if pd.isna(val):
        return None
    s = str(val).strip().replace('%', '').replace('+', '')
    try:
        return float(s)
    except ValueError:
        return None

# ── DDL ──────────────────────────────────────────────────────────────────────
DDL_INFO = """
CREATE TABLE IF NOT EXISTS private_fund_info (
    beian_hao           TEXT PRIMARY KEY,
    product_name        TEXT NOT NULL,
    strategy_l1         TEXT,
    strategy_l2         TEXT,
    manager             TEXT,
    inception_date      DATE,
    benchmark           TEXT,
    ret_1w              NUMERIC(10,4),
    ret_1m              NUMERIC(10,4),
    ret_3m              NUMERIC(10,4),
    ret_6m              NUMERIC(10,4),
    ret_1y              NUMERIC(10,4),
    sharpe_1y           NUMERIC(10,4),
    calmar_1y           NUMERIC(10,4),
    latest_nav          NUMERIC(16,6),
    latest_nav_date     DATE,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
"""

DDL_NAV = """
CREATE TABLE IF NOT EXISTS private_fund_nav (
    id                  BIGSERIAL PRIMARY KEY,
    beian_hao           TEXT NOT NULL,
    price_date          DATE NOT NULL,
    nav                 NUMERIC(16,6),
    cumulative_nav      NUMERIC(16,6),
    cum_nav_withdrawal  NUMERIC(16,6),
    price_change        NUMERIC(16,6),
    CONSTRAINT uq_fund_nav UNIQUE (beian_hao, price_date)
);

CREATE INDEX IF NOT EXISTS idx_pfn_beian  ON private_fund_nav (beian_hao);
CREATE INDEX IF NOT EXISTS idx_pfn_date   ON private_fund_nav (price_date);
CREATE INDEX IF NOT EXISTS idx_pfn_beian_date_desc ON private_fund_nav (beian_hao, price_date DESC);
"""

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor()

    print("Creating tables …")
    cur.execute(DDL_INFO)
    cur.execute(DDL_NAV)
    conn.commit()

    # ── 1. Insert / upsert fund info from xlsx ────────────────────────────
    print("Reading xlsx …")
    df = pd.read_excel(XLSX_PATH)

    info_rows = []
    for _, row in df.iterrows():
        info_rows.append((
            str(row["备案号"]).strip(),
            str(row["产品名称"]).strip(),
            row.get("一级策略") if not pd.isna(row.get("一级策略")) else None,
            row.get("二级策略") if not pd.isna(row.get("二级策略")) else None,
            row.get("管理人")   if not pd.isna(row.get("管理人"))   else None,
            pd.to_datetime(row.get("成立日期"), errors="coerce").date() if not pd.isna(row.get("成立日期")) else None,
            row.get("基准指数") if not pd.isna(row.get("基准指数")) else None,
            clean_pct(row.get("近一周收益")),
            clean_pct(row.get("近一月收益")),
            clean_pct(row.get("近三月收益")),
            clean_pct(row.get("近六月收益")),
            clean_pct(row.get("近一年收益")),
            clean_pct(row.get("近一年夏普比率")),
            clean_pct(row.get("近一年卡玛比率")),
        ))

    print(f"  Upserting {len(info_rows)} fund info rows …")
    execute_values(cur, """
        INSERT INTO private_fund_info
            (beian_hao, product_name, strategy_l1, strategy_l2, manager,
             inception_date, benchmark, ret_1w, ret_1m, ret_3m, ret_6m,
             ret_1y, sharpe_1y, calmar_1y)
        VALUES %s
        ON CONFLICT (beian_hao) DO UPDATE SET
            product_name   = EXCLUDED.product_name,
            strategy_l1    = EXCLUDED.strategy_l1,
            strategy_l2    = EXCLUDED.strategy_l2,
            manager        = EXCLUDED.manager,
            inception_date = EXCLUDED.inception_date,
            benchmark      = EXCLUDED.benchmark,
            ret_1w         = EXCLUDED.ret_1w,
            ret_1m         = EXCLUDED.ret_1m,
            ret_3m         = EXCLUDED.ret_3m,
            ret_6m         = EXCLUDED.ret_6m,
            ret_1y         = EXCLUDED.ret_1y,
            sharpe_1y      = EXCLUDED.sharpe_1y,
            calmar_1y      = EXCLUDED.calmar_1y,
            updated_at     = NOW()
    """, info_rows)
    conn.commit()
    print("  Fund info done.")

    # ── 2. Insert NAV time-series from nav_csv/ ───────────────────────────
    csv_files = [f for f in os.listdir(NAV_DIR) if f.endswith(".csv")]
    print(f"Processing {len(csv_files)} NAV CSV files …")

    BATCH_SIZE = 200   # files per commit
    nav_batch  = []
    errors     = []

    for idx, fname in enumerate(csv_files, 1):
        stem      = fname[:-4]                    # strip .csv
        parts     = stem.rsplit("_", 1)
        if len(parts) != 2:
            errors.append(f"  Skipped (bad name): {fname}")
            continue
        product_name_csv, beian_hao = parts[0].strip(), parts[1].strip()

        fpath = os.path.join(NAV_DIR, fname)
        try:
            nav_df = pd.read_csv(fpath, parse_dates=["price_date"])
        except Exception as e:
            errors.append(f"  Read error {fname}: {e}")
            continue

        for _, r in nav_df.iterrows():
            nav_batch.append((
                beian_hao,
                product_name_csv,
                r["price_date"].date() if not pd.isna(r["price_date"]) else None,
                float(r["nav"])                    if not pd.isna(r.get("nav"))                    else None,
                float(r["cumulative_nav"])          if not pd.isna(r.get("cumulative_nav"))          else None,
                float(r["cumulative_nav_withdrawal"]) if not pd.isna(r.get("cumulative_nav_withdrawal")) else None,
                float(r["price_change"])            if not pd.isna(r.get("price_change"))            else None,
            ))

        if idx % BATCH_SIZE == 0 or idx == len(csv_files):
            # Deduplicate within batch – keep last occurrence per (beian_hao, price_date)
            deduped = {}
            for row in nav_batch:
                deduped[(row[0], row[2])] = row
            unique_batch = list(deduped.values())
            execute_values(cur, """
                INSERT INTO private_fund_nav
                    (beian_hao, product_name, price_date, nav, cumulative_nav,
                     cum_nav_withdrawal, price_change)
                VALUES %s
                ON CONFLICT (beian_hao, price_date) DO UPDATE SET
                    product_name       = EXCLUDED.product_name,
                    nav                = EXCLUDED.nav,
                    cumulative_nav     = EXCLUDED.cumulative_nav,
                    cum_nav_withdrawal = EXCLUDED.cum_nav_withdrawal,
                    price_change       = EXCLUDED.price_change
            """, unique_batch, page_size=2000)
            conn.commit()
            nav_batch.clear()
            print(f"  Committed up to file {idx}/{len(csv_files)}")

    cur.close()
    conn.close()

    if errors:
        print(f"\n{len(errors)} warnings:")
        for e in errors:
            print(e)

    print("\nDone.")


if __name__ == "__main__":
    main()
