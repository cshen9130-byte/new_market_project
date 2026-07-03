#!/usr/bin/env python3
"""
migrate_amac_private_funds.py
=============================
Creates amac_private_funds table and loads data from fetch_amac_data/amac_private_funds.csv.

Safe to re-run: CREATE TABLE uses IF NOT EXISTS; rows upsert on fund_no.

Usage:
    python scripts/db/migrate_amac_private_funds.py
"""

from __future__ import annotations

import os
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CSV_PATH = ROOT / "fetch_amac_data" / "amac_private_funds.csv"


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
CREATE TABLE IF NOT EXISTS amac_private_funds (
    id                  SERIAL PRIMARY KEY,
    fund_name           TEXT NOT NULL,
    fund_no             TEXT NOT NULL,
    manager_name        TEXT,
    manager_type        TEXT,
    working_state       TEXT,
    mandator_name       TEXT,
    establish_date      DATE,
    put_on_record_date  DATE,
    detail_url          TEXT,
    source_file         TEXT NOT NULL DEFAULT 'amac_private_funds.csv',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_private_funds_fund_no_uq UNIQUE (fund_no)
);

CREATE INDEX IF NOT EXISTS idx_amac_private_funds_fund_name
    ON amac_private_funds (fund_name);

CREATE INDEX IF NOT EXISTS idx_amac_private_funds_manager_name
    ON amac_private_funds (manager_name);

CREATE INDEX IF NOT EXISTS idx_amac_private_funds_working_state
    ON amac_private_funds (working_state);

CREATE INDEX IF NOT EXISTS idx_amac_private_funds_put_on_record_date
    ON amac_private_funds (put_on_record_date DESC);
"""

UPSERT_SQL = """
INSERT INTO amac_private_funds (
    fund_name, fund_no, manager_name, manager_type, working_state,
    mandator_name, establish_date, put_on_record_date, detail_url, source_file
) VALUES %s
ON CONFLICT (fund_no) DO UPDATE SET
    fund_name          = EXCLUDED.fund_name,
    manager_name       = EXCLUDED.manager_name,
    manager_type       = EXCLUDED.manager_type,
    working_state      = EXCLUDED.working_state,
    mandator_name      = EXCLUDED.mandator_name,
    establish_date     = EXCLUDED.establish_date,
    put_on_record_date = EXCLUDED.put_on_record_date,
    detail_url         = EXCLUDED.detail_url,
    source_file        = EXCLUDED.source_file,
    updated_at         = NOW()
"""


def main() -> None:
    print(f"Reading {CSV_PATH.name} …")
    try:
        df = pd.read_csv(CSV_PATH, encoding="utf-8-sig")
    except Exception:
        df = pd.read_csv(CSV_PATH, encoding="utf-8")

    expected = [
        "fund_name",
        "fund_no",
        "manager_name",
        "manager_type",
        "working_state",
        "mandator_name",
        "establish_date",
        "put_on_record_date",
        "detail_url",
    ]
    missing = [col for col in expected if col not in df.columns]
    if missing:
        print(f"Unexpected csv columns. Missing: {missing}")
        print(f"Found: {list(df.columns)}")
        sys.exit(1)

    raw_count = len(df)
    df = df.dropna(subset=["fund_no", "fund_name"], how="any")
    df["fund_no"] = df["fund_no"].astype(str).str.strip()
    df["fund_name"] = df["fund_name"].astype(str).str.strip()
    df = df[(df["fund_no"] != "") & (df["fund_name"] != "")]
    df = df.drop_duplicates(subset=["fund_no"], keep="last")

    rows = []
    for _, row in df.iterrows():
        rows.append((
            str(row["fund_name"]).strip(),
            str(row["fund_no"]).strip(),
            _dash_to_none(row["manager_name"]),
            _dash_to_none(row["manager_type"]),
            _dash_to_none(row["working_state"]),
            _dash_to_none(row["mandator_name"]),
            _parse_date(row["establish_date"]),
            _parse_date(row["put_on_record_date"]),
            _dash_to_none(row["detail_url"]),
            CSV_PATH.name,
        ))

    print(f"  Parsed {len(rows)} rows ({raw_count - len(rows)} skipped or deduped)")

    with conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            print("  + amac_private_funds table ready")

            execute_values(cur, UPSERT_SQL, rows, page_size=1000)
            cur.execute("SELECT COUNT(*) FROM amac_private_funds")
            total = cur.fetchone()[0]
            cur.execute("ANALYZE amac_private_funds")

    print(f"Upserted {len(rows)} rows from csv ({total} rows in amac_private_funds).")
    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
