#!/usr/bin/env python3
"""
migrate_mom_fund_transactions.py
=================================
Creates the mom_fund_transactions table to store MOM fund capital in/out
records (申购、认购、赎回 confirmation details).

Safe to re-run: CREATE TABLE uses IF NOT EXISTS.

Usage:
    python scripts/db/migrate_mom_fund_transactions.py
"""

import os
import sys
from pathlib import Path


def _load_env() -> None:
    candidates = [
        Path.cwd(),
        Path(__file__).resolve().parent,
        Path(__file__).resolve().parent.parent,
        Path(__file__).resolve().parent.parent.parent,
    ]
    for base in candidates:
        for fname in (".env.local", ".env"):
            f = base / fname
            if not f.is_file():
                continue
            with f.open(encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            return


_load_env()

try:
    import psycopg2
except ImportError:
    print("psycopg2 not found. Install with: pip install psycopg2-binary")
    sys.exit(1)

DDL = """
CREATE TABLE IF NOT EXISTS mom_fund_transactions (
    id                      SERIAL PRIMARY KEY,
    product_code            VARCHAR(20)     NOT NULL,
    product_name            VARCHAR(200)    NOT NULL,
    customer_name           VARCHAR(200)    NOT NULL,
    transaction_type        VARCHAR(20)     NOT NULL,
    application_date        DATE,
    confirmation_date       DATE,
    confirmed_amount        NUMERIC(20, 2),
    confirmed_net_amount    NUMERIC(20, 2),
    confirmed_shares        NUMERIC(20, 6),
    confirmation_result     VARCHAR(20),
    unit_nav                NUMERIC(12, 6),
    cumulative_nav          NUMERIC(12, 6),
    handling_fee            NUMERIC(20, 2),
    performance_fee         NUMERIC(20, 2),
    total_confirmed_amount  NUMERIC(20, 2),
    application_amount      NUMERIC(20, 2),
    application_shares      NUMERIC(20, 6),
    remaining_shares        NUMERIC(20, 6),
    sales_org_name          VARCHAR(200),
    ta_clearing_time        TIMESTAMPTZ,
    imported_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE mom_fund_transactions IS
    'MOM fund subscription/redemption confirmation details imported from TA export files';

COMMENT ON COLUMN mom_fund_transactions.transaction_type IS
    '业务类型: 认购结果 / 认购确认 / 申购确认 / 赎回确认';
"""

INDEX_DDL = """
CREATE INDEX IF NOT EXISTS idx_mom_fund_tx_product_code ON mom_fund_transactions (product_code);
CREATE INDEX IF NOT EXISTS idx_mom_fund_tx_confirmation_date ON mom_fund_transactions (confirmation_date);
CREATE INDEX IF NOT EXISTS idx_mom_fund_tx_customer_name ON mom_fund_transactions (customer_name);
CREATE INDEX IF NOT EXISTS idx_mom_fund_tx_transaction_type ON mom_fund_transactions (transaction_type);
"""


def main() -> None:
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        conn = psycopg2.connect(db_url)
    else:
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST", "localhost"),
            port=int(os.environ.get("DB_PORT", "5432")),
            dbname=os.environ.get("DB_NAME", "market_data"),
            user=os.environ.get("DB_USER", "market_user"),
            password=os.environ.get("DB_PASSWORD", ""),
        )

    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(DDL)
                print("✓ Table mom_fund_transactions created (or already exists).")
                for stmt in INDEX_DDL.strip().split("\n"):
                    stmt = stmt.strip()
                    if stmt:
                        cur.execute(stmt)
                print("✓ Indexes created (or already exist).")
    finally:
        conn.close()

    print("Migration complete.")


if __name__ == "__main__":
    main()
