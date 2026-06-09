#!/usr/bin/env python3
"""
migrate_fund_managers.py
========================
Creates private_fund_managers table and loads data from fund_managers.csv.

Safe to re-run: CREATE TABLE uses IF NOT EXISTS; table is cleared or rows are upserted.
Since CSV doesn't have an obvious natural unique key besides (manager_name, private_fund_manager_company, representative_fund),
we will create the table and do a clean insert/reload (re-insert rows) or use (manager_name, private_fund_manager_company) as a compound natural key or seq_no as primary key.
Given the csv contains "序号" (seq_no), we can make seq_no the primary key, or use SERIAL PRIMARY KEY and unique on (seq_no) or just truncate and reload for simplicity and idempotency.

Let's do TRUNCATE and reload or standard serial id with seq_no as a UNIQUE constraint so that we can safe-run it idempotently with ON CONFLICT (seq_no) DO UPDATE.
Let's see columns:
- 序号 (seq_no): int
- 基金经理 (manager_name): text
- 私募管理人 (private_fund_manager_company): text
- 从业年限 (years_of_experience): numeric
- 在管基金数 (funds_under_management): int
- 代表基金 (representative_fund): text
- 任职区间收益 (tenure_return_pct): numeric (parsed from '65.80%')

Usage:
    python scripts/db/migrate_fund_managers.py
"""

from __future__ import annotations

import os
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CSV_PATH = ROOT / "fund_managers.csv"


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
    print(f"Missing dependency: {exc}. Run: pip install pandas psycopg2-binary")
    sys.exit(1)

if not CSV_PATH.is_file():
    print(f"csv not found: {CSV_PATH}")
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
CREATE TABLE IF NOT EXISTS private_fund_managers (
    id                             SERIAL PRIMARY KEY,
    seq_no                         INTEGER NOT NULL,
    manager_name                   TEXT NOT NULL,
    private_fund_manager_company   TEXT NOT NULL,
    years_of_experience            NUMERIC(6, 2),
    funds_under_management         INTEGER,
    representative_fund            TEXT,
    tenure_return_pct              NUMERIC(10, 4),
    source_file                    TEXT NOT NULL DEFAULT 'fund_managers.csv',
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT private_fund_managers_seq_no_uq UNIQUE (seq_no)
);

CREATE INDEX IF NOT EXISTS idx_private_fund_managers_manager_name
    ON private_fund_managers (manager_name);

CREATE INDEX IF NOT EXISTS idx_private_fund_managers_company
    ON private_fund_managers (private_fund_manager_company);

CREATE INDEX IF NOT EXISTS idx_private_fund_managers_tenure_return
    ON private_fund_managers (tenure_return_pct DESC);
"""

UPSERT_SQL = """
INSERT INTO private_fund_managers (
    seq_no, manager_name, private_fund_manager_company, years_of_experience,
    funds_under_management, representative_fund, tenure_return_pct, source_file
) VALUES %s
ON CONFLICT (seq_no) DO UPDATE SET
    manager_name                 = EXCLUDED.manager_name,
    private_fund_manager_company = EXCLUDED.private_fund_manager_company,
    years_of_experience          = EXCLUDED.years_of_experience,
    funds_under_management       = EXCLUDED.funds_under_management,
    representative_fund          = EXCLUDED.representative_fund,
    tenure_return_pct            = EXCLUDED.tenure_return_pct,
    source_file                  = EXCLUDED.source_file,
    updated_at                   = NOW()
"""


def main() -> None:
    print(f"Reading {CSV_PATH.name} …")
    # Let's specify encoding because Chinese characters are present
    try:
        df = pd.read_csv(CSV_PATH, encoding="utf-8")
    except Exception:
        df = pd.read_csv(CSV_PATH, encoding="gbk")

    expected = ["序号", "基金经理", "私募管理人", "从业年限", "在管基金数", "代表基金", "任职区间收益"]
    missing = [col for col in expected if col not in df.columns]
    if missing:
        print(f"Unexpected csv columns. Missing: {missing}")
        print(f"Found: {list(df.columns)}")
        sys.exit(1)

    rows = []
    for _, row in df.iterrows():
        seq_no = _parse_int(row["序号"])
        if seq_no is None:
            continue
        rows.append((
            seq_no,
            str(row["基金经理"]).strip(),
            str(row["私募管理人"]).strip(),
            _parse_numeric(row["从业年限"]),
            _parse_int(row["在管基金数"]),
            _dash_to_none(row["代表基金"]),
            _parse_pct(row["任职区间收益"]),
            CSV_PATH.name,
        ))

    with conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            print("  + private_fund_managers table ready")

            execute_values(cur, UPSERT_SQL, rows, page_size=1000)
            cur.execute("SELECT COUNT(*) FROM private_fund_managers")
            total = cur.fetchone()[0]

    print(f"Upserted {len(rows)} rows from csv ({total} rows in table).")
    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
