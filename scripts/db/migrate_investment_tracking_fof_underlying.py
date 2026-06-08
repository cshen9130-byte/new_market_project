#!/usr/bin/env python3
"""
migrate_investment_tracking_fof_underlying.py
==============================================
Creates investment_tracking_fof_underlying and loads data from FOF底层.xlsx.

Safe to re-run: CREATE TABLE uses IF NOT EXISTS; rows upsert on beian_hao.

Usage:
    python scripts/db/migrate_investment_tracking_fof_underlying.py
"""

from __future__ import annotations

import os
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
XLSX_PATH = ROOT / "FOF底层.xlsx"


def _load_env() -> None:
    for base in (Path.cwd(), ROOT):
        for fname in (".env.local", ".env"):
            f = base / fname
            if not f.is_file():
                continue
            with f.open(encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _dash_to_none(val):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s in ("-", "-%"):
        return None
    return s


def _parse_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s or s == "-":
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _parse_int(val) -> int | None:
    if val is None:
        return None
    s = str(val).strip()
    if not s or s == "-":
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _parse_numeric(val) -> Decimal | None:
    if val is None:
        return None
    s = str(val).strip().replace(",", "")
    if not s or s in ("-", "-%"):
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _parse_pct(val) -> Decimal | None:
    if val is None:
        return None
    s = str(val).strip().replace(",", "")
    if not s or s in ("-", "-%"):
        return None
    s = s.replace("%", "").replace("+", "")
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


_load_env()

try:
    import pandas as pd
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError as exc:
    print(f"Missing dependency: {exc}. Run: pip install pandas openpyxl psycopg2-binary")
    sys.exit(1)

if not XLSX_PATH.is_file():
    print(f"xlsx not found: {XLSX_PATH}")
    sys.exit(1)

url = os.environ.get("DATABASE_URL")
if url:
    conn = psycopg2.connect(url)
else:
    conn = psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", "market_data"),
        user=os.environ.get("DB_USER", "market_user"),
        password=os.environ.get("DB_PASSWORD", ""),
    )

DDL = """
CREATE TABLE IF NOT EXISTS investment_tracking_fof_underlying (
    id              SERIAL PRIMARY KEY,
    seq_no          INTEGER,
    manager_name    TEXT NOT NULL,
    product_name    TEXT NOT NULL,
    beian_hao       TEXT NOT NULL,
    unit_nav        NUMERIC(16, 6),
    nav_date        DATE,
    price_change    NUMERIC(10, 4),
    ret_1w          NUMERIC(10, 4),
    ret_1m          NUMERIC(10, 4),
    ret_3m          NUMERIC(10, 4),
    ret_6m          NUMERIC(10, 4),
    ret_1y          NUMERIC(10, 4),
    sharpe_1y       NUMERIC(10, 4),
    calmar_1y       NUMERIC(10, 4),
    source_file     TEXT NOT NULL DEFAULT 'FOF底层.xlsx',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT investment_tracking_fof_underlying_beian_hao_uq UNIQUE (beian_hao)
);

CREATE INDEX IF NOT EXISTS idx_investment_tracking_fof_underlying_manager
    ON investment_tracking_fof_underlying (manager_name);

CREATE INDEX IF NOT EXISTS idx_investment_tracking_fof_underlying_nav_date
    ON investment_tracking_fof_underlying (nav_date DESC);
"""

UPSERT_SQL = """
INSERT INTO investment_tracking_fof_underlying (
    seq_no, manager_name, product_name, beian_hao, unit_nav, nav_date,
    price_change, ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
    sharpe_1y, calmar_1y, source_file
) VALUES %s
ON CONFLICT (beian_hao) DO UPDATE SET
    seq_no        = EXCLUDED.seq_no,
    manager_name  = EXCLUDED.manager_name,
    product_name  = EXCLUDED.product_name,
    unit_nav      = EXCLUDED.unit_nav,
    nav_date      = EXCLUDED.nav_date,
    price_change  = EXCLUDED.price_change,
    ret_1w        = EXCLUDED.ret_1w,
    ret_1m        = EXCLUDED.ret_1m,
    ret_3m        = EXCLUDED.ret_3m,
    ret_6m        = EXCLUDED.ret_6m,
    ret_1y        = EXCLUDED.ret_1y,
    sharpe_1y     = EXCLUDED.sharpe_1y,
    calmar_1y     = EXCLUDED.calmar_1y,
    source_file   = EXCLUDED.source_file,
    updated_at    = NOW()
"""


def main() -> None:
    print(f"Reading {XLSX_PATH.name} …")
    df = pd.read_excel(XLSX_PATH)

    expected = [
        "序号", "管理人名称", "产品名称", "备案编码", "单位净值", "净值日期", "涨跌幅",
        "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益",
        "近一年夏普比率", "近一年卡玛比率",
    ]
    missing = [col for col in expected if col not in df.columns]
    if missing:
        print(f"Unexpected xlsx columns. Missing: {missing}")
        print(f"Found: {list(df.columns)}")
        sys.exit(1)

    rows = []
    for _, row in df.iterrows():
        beian_hao = _dash_to_none(row["备案编码"])
        if not beian_hao:
            continue
        rows.append((
            _parse_int(row["序号"]),
            str(row["管理人名称"]).strip(),
            str(row["产品名称"]).strip(),
            beian_hao,
            _parse_numeric(row["单位净值"]),
            _parse_date(row["净值日期"]),
            _parse_pct(row["涨跌幅"]),
            _parse_pct(row["近一周收益"]),
            _parse_pct(row["近一月收益"]),
            _parse_pct(row["近三月收益"]),
            _parse_pct(row["近六月收益"]),
            _parse_pct(row["近一年收益"]),
            _parse_numeric(row["近一年夏普比率"]),
            _parse_numeric(row["近一年卡玛比率"]),
            XLSX_PATH.name,
        ))

    with conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            print("  + investment_tracking_fof_underlying table ready")

            execute_values(cur, UPSERT_SQL, rows, page_size=500)
            cur.execute("SELECT COUNT(*) FROM investment_tracking_fof_underlying")
            total = cur.fetchone()[0]

    print(f"Upserted {len(rows)} rows from xlsx ({total} rows in table).")
    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
