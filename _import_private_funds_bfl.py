"""
Import BFL-group private fund data into PostgreSQL.

Tables created:
  private_fund_info_bfl  – metadata from 团队策略基金列表_全量.xlsx (备案编码 as PK)
  private_fund_nav_group – NAV time-series from nav_csv_group/ (linked by 备案号)
"""

import os
import re
import sys
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

# ── Config ───────────────────────────────────────────────────────────────────
DATABASE_URL   = "postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
XLSX_PATH      = os.path.join(os.path.dirname(__file__), "团队策略基金列表_全量.xlsx")
NAV_GROUP_DIR  = os.path.join(os.path.dirname(__file__), "nav_csv_group")

# ── DDL ───────────────────────────────────────────────────────────────────────
DDL_INFO_BFL = """
CREATE TABLE IF NOT EXISTS private_fund_info_bfl (
    beian_hao           TEXT PRIMARY KEY,
    product_name        TEXT NOT NULL,
    short_name          TEXT,
    manager             TEXT,
    inception_date      DATE,
    liquidation_date    DATE,
    adj_nav             NUMERIC(16,6),
    latest_nav          NUMERIC(16,6),
    cumulative_nav      NUMERIC(16,6),
    price_change        NUMERIC(16,6),
    latest_nav_date     DATE,
    registration_date   TIMESTAMPTZ,
    fund_type           TEXT,
    operation_status    TEXT,
    nav_frequency       TEXT,
    custodian           TEXT,
    strategy_l1         TEXT,
    strategy_l2         TEXT,
    strategy_l3         TEXT,
    strategy_confirmed  SMALLINT,
    investment_advisor  TEXT,
    fund_size           TEXT,
    registration_no     TEXT,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
"""

DDL_NAV_GROUP = """
CREATE TABLE IF NOT EXISTS private_fund_nav_group (
    id                  BIGSERIAL PRIMARY KEY,
    beian_hao           TEXT NOT NULL,
    product_name        TEXT,
    price_date          DATE NOT NULL,
    nav                 NUMERIC(16,6),
    cumulative_nav      NUMERIC(16,6),
    cum_nav_withdrawal  NUMERIC(16,6),
    price_change        NUMERIC(16,6),
    CONSTRAINT uq_fund_nav_group UNIQUE (beian_hao, price_date)
);

CREATE INDEX IF NOT EXISTS idx_pfng_beian ON private_fund_nav_group (beian_hao);
CREATE INDEX IF NOT EXISTS idx_pfng_date  ON private_fund_nav_group (price_date);
"""


def safe_date(val):
    if pd.isna(val):
        return None
    try:
        d = pd.to_datetime(val, errors="coerce")
        if pd.isna(d):
            return None
        # 0000-00-00 or very old dates → None
        if d.year < 1900:
            return None
        return d.date()
    except Exception:
        return None


def safe_float(val):
    if pd.isna(val):
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_int(val):
    if pd.isna(val):
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def safe_text(val):
    if pd.isna(val):
        return None
    s = str(val).strip()
    return s if s else None


def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor()

    print("Creating tables …")
    cur.execute(DDL_INFO_BFL)
    cur.execute(DDL_NAV_GROUP)
    conn.commit()

    # ── 1. Upsert fund info from 团队策略基金列表_全量.xlsx ─────────────────
    print(f"Reading {XLSX_PATH} …")
    df = pd.read_excel(XLSX_PATH)
    print(f"  {len(df)} rows, columns: {df.columns.tolist()}")

    info_rows = []
    for _, row in df.iterrows():
        beian = safe_text(row.get("备案编码"))
        if not beian:
            continue
        info_rows.append((
            beian,
            safe_text(row.get("基金名称"))   or "",
            safe_text(row.get("基金简称")),
            safe_text(row.get("基金管理人")),
            safe_date(row.get("成立日期")),
            safe_date(row.get("清算日期")),
            safe_float(row.get("复权净值")),
            safe_float(row.get("最新净值")),
            safe_float(row.get("累计净值")),
            safe_float(row.get("涨跌幅")),
            safe_date(row.get("最新净值日期")),
            safe_date(row.get("备案时间")),
            safe_text(row.get("基金类型")),
            safe_text(row.get("运作状态")),
            safe_text(row.get("净值更新周期")),
            safe_text(row.get("托管人名称")),
            safe_text(row.get("一级策略")),
            safe_text(row.get("二级策略")),
            safe_text(row.get("三级策略")),
            safe_int(row.get("策略已确认")),
            safe_text(row.get("投资顾问")),
            safe_text(row.get("产品规模")),
            safe_text(row.get("登记编号")),
        ))

    print(f"  Upserting {len(info_rows)} rows into private_fund_info_bfl …")
    execute_values(cur, """
        INSERT INTO private_fund_info_bfl (
            beian_hao, product_name, short_name, manager,
            inception_date, liquidation_date,
            adj_nav, latest_nav, cumulative_nav, price_change, latest_nav_date,
            registration_date, fund_type, operation_status, nav_frequency,
            custodian, strategy_l1, strategy_l2, strategy_l3,
            strategy_confirmed, investment_advisor, fund_size, registration_no
        ) VALUES %s
        ON CONFLICT (beian_hao) DO UPDATE SET
            product_name       = EXCLUDED.product_name,
            short_name         = EXCLUDED.short_name,
            manager            = EXCLUDED.manager,
            inception_date     = EXCLUDED.inception_date,
            liquidation_date   = EXCLUDED.liquidation_date,
            adj_nav            = EXCLUDED.adj_nav,
            latest_nav         = EXCLUDED.latest_nav,
            cumulative_nav     = EXCLUDED.cumulative_nav,
            price_change       = EXCLUDED.price_change,
            latest_nav_date    = EXCLUDED.latest_nav_date,
            registration_date  = EXCLUDED.registration_date,
            fund_type          = EXCLUDED.fund_type,
            operation_status   = EXCLUDED.operation_status,
            nav_frequency      = EXCLUDED.nav_frequency,
            custodian          = EXCLUDED.custodian,
            strategy_l1        = EXCLUDED.strategy_l1,
            strategy_l2        = EXCLUDED.strategy_l2,
            strategy_l3        = EXCLUDED.strategy_l3,
            strategy_confirmed = EXCLUDED.strategy_confirmed,
            investment_advisor = EXCLUDED.investment_advisor,
            fund_size          = EXCLUDED.fund_size,
            registration_no    = EXCLUDED.registration_no,
            updated_at         = NOW()
    """, info_rows)
    conn.commit()
    print("  private_fund_info_bfl done.")

    # ── 2. Insert NAV time-series from nav_csv_group/ ──────────────────────
    csv_files = [f for f in os.listdir(NAV_GROUP_DIR) if f.endswith(".csv")]
    print(f"\nProcessing {len(csv_files)} NAV CSV files from nav_csv_group/ …")

    BATCH_SIZE = 200
    nav_batch  = []
    errors     = []

    for idx, fname in enumerate(csv_files, 1):
        stem  = fname[:-4]
        parts = stem.rsplit("_", 1)
        if len(parts) != 2:
            errors.append(f"  Skipped (bad name): {fname}")
            continue
        product_name_csv, beian_hao = parts[0].strip(), parts[1].strip()

        fpath = os.path.join(NAV_GROUP_DIR, fname)
        try:
            nav_df = pd.read_csv(fpath, parse_dates=["price_date"])
        except Exception as e:
            errors.append(f"  Read error {fname}: {e}")
            continue

        for _, r in nav_df.iterrows():
            pd_val = r.get("price_date")
            if pd.isna(pd_val):
                continue
            nav_batch.append((
                beian_hao,
                product_name_csv,
                pd_val.date() if hasattr(pd_val, "date") else pd_val,
                safe_float(r.get("nav")),
                safe_float(r.get("cumulative_nav")),
                safe_float(r.get("cumulative_nav_withdrawal")),
                safe_float(r.get("price_change")),
            ))

        if idx % BATCH_SIZE == 0 or idx == len(csv_files):
            deduped = {}
            for row in nav_batch:
                deduped[(row[0], row[2])] = row
            unique_batch = list(deduped.values())
            execute_values(cur, """
                INSERT INTO private_fund_nav_group
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
