#!/usr/bin/env python3
"""
migrate_private_fund_managers_list.py
=====================================
Creates private_fund_managers_list and loads data from 私募管理人列表.xlsx.

Safe to re-run: CREATE TABLE uses IF NOT EXISTS; rows upsert on registration_no.

Usage:
    python scripts/db/migrate_private_fund_managers_list.py
"""

from __future__ import annotations

import os
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
XLSX_PATH = ROOT / "私募管理人列表.xlsx"


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
    if not s or s == "-":
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
CREATE TABLE IF NOT EXISTS private_fund_managers_list (
    id                    SERIAL PRIMARY KEY,
    seq_no                INTEGER,
    manager_name          TEXT NOT NULL,
    core_strategy         TEXT,
    mgmt_scale            TEXT,
    inception_date        DATE,
    active_product_count  INTEGER,
    member_type           TEXT,
    registration_no       TEXT NOT NULL,
    source_file           TEXT NOT NULL DEFAULT '私募管理人列表.xlsx',
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT private_fund_managers_list_registration_no_uq UNIQUE (registration_no)
);

CREATE INDEX IF NOT EXISTS idx_private_fund_managers_list_name
    ON private_fund_managers_list (manager_name);

CREATE INDEX IF NOT EXISTS idx_private_fund_managers_list_inception_date
    ON private_fund_managers_list (inception_date DESC);
"""

UPSERT_SQL = """
INSERT INTO private_fund_managers_list (
    seq_no, manager_name, core_strategy, mgmt_scale, inception_date,
    active_product_count, member_type, registration_no, source_file
) VALUES %s
ON CONFLICT (registration_no) DO UPDATE SET
    seq_no               = EXCLUDED.seq_no,
    manager_name         = EXCLUDED.manager_name,
    core_strategy        = EXCLUDED.core_strategy,
    mgmt_scale           = EXCLUDED.mgmt_scale,
    inception_date       = EXCLUDED.inception_date,
    active_product_count = EXCLUDED.active_product_count,
    member_type          = EXCLUDED.member_type,
    source_file          = EXCLUDED.source_file,
    updated_at           = NOW()
"""


def main() -> None:
    print(f"Reading {XLSX_PATH.name} …")
    df = pd.read_excel(XLSX_PATH)

    expected = [
        "序号", "管理人名称", "核心策略", "管理规模", "成立日期",
        "运作中产品数", "会员类型", "登记编号",
    ]
    missing = [col for col in expected if col not in df.columns]
    if missing:
        print(f"Unexpected xlsx columns. Missing: {missing}")
        print(f"Found: {list(df.columns)}")
        sys.exit(1)

    rows = []
    for _, row in df.iterrows():
        registration_no = _dash_to_none(row["登记编号"])
        if not registration_no:
            continue
        rows.append((
            _parse_int(row["序号"]),
            str(row["管理人名称"]).strip(),
            _dash_to_none(row["核心策略"]),
            _dash_to_none(row["管理规模"]),
            _parse_date(row["成立日期"]),
            _parse_int(row["运作中产品数"]),
            _dash_to_none(row["会员类型"]),
            registration_no,
            XLSX_PATH.name,
        ))

    with conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            print("  + private_fund_managers_list table ready")

            execute_values(cur, UPSERT_SQL, rows, page_size=500)
            cur.execute("SELECT COUNT(*) FROM private_fund_managers_list")
            total = cur.fetchone()[0]

    print(f"Upserted {len(rows)} rows from xlsx ({total} rows in table).")
    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
