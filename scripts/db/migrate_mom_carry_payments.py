#!/usr/bin/env python3
"""
migrate_mom_carry_payments.py
==============================
Creates the mom_carry_payments table and seeds it with the known historical
carry payment records.

Safe to re-run: CREATE TABLE uses IF NOT EXISTS; seed rows are inserted via
ON CONFLICT DO NOTHING so re-running is idempotent.

Usage:
    python scripts/db/migrate_mom_carry_payments.py
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
            try:
                for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
            except Exception:
                pass


_load_env()

print("DATABASE_URL present:", bool(os.environ.get("DATABASE_URL")))

try:
    import psycopg2
except ImportError:
    print("psycopg2 not found — run:  pip install psycopg2-binary")
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

print("Connected OK")

with conn.cursor() as cur:
    # 1. Create table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS mom_carry_payments (
            id               SERIAL        PRIMARY KEY,
            account          VARCHAR(50)   NOT NULL,
            start_date       DATE          NOT NULL,
            carry_date       DATE          NOT NULL,
            operating_days   INTEGER,
            balance          NUMERIC(20,2),
            total_profit     NUMERIC(20,2),
            profit_portion   NUMERIC(20,2) NOT NULL,  -- 提盈部分 (base for mother carry)
            paid_child_carry NUMERIC(20,2) NOT NULL,  -- 实付carry (already paid to sub-manager)
            note             TEXT,
            created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
            CONSTRAINT mom_carry_payments_uq UNIQUE (account, carry_date)
        )
    """)
    print("  + mom_carry_payments table created (or already exists)")

    # 2. Seed historical carry payment records from the known data
    seed_rows = [
        # account, start_date, carry_date, operating_days, balance,        total_profit,  profit_portion, paid_child_carry, note
        ("rx303", "2025-08-01", "2025-12-31", 152, 10_288_256.48,  288_256.48,  188_256.48,  37_651.30,  None),
        ("rx307", "2025-09-25", "2026-01-16", 113, 41_002_071.34, 1_002_071.34, 600_000.00, 120_000.00,  None),
        ("rx335", "2026-01-21", "2026-03-27",  65, 11_981_278.98, 1_981_278.98, 1_500_000.00, 300_000.00, None),
    ]

    inserted = 0
    for row in seed_rows:
        cur.execute("""
            INSERT INTO mom_carry_payments
                (account, start_date, carry_date, operating_days, balance,
                 total_profit, profit_portion, paid_child_carry, note)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (account, carry_date) DO NOTHING
        """, row)
        if cur.rowcount:
            inserted += 1
            print(f"  + Inserted carry record: {row[0]} on {row[2]}")
        else:
            print(f"  ~ Skipped (already exists): {row[0]} on {row[2]}")

    print(f"  Seed complete: {inserted} new row(s) inserted")

conn.commit()
conn.close()
print("Migration complete.")
