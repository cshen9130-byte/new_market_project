#!/usr/bin/env python3
"""
migrate_add_freq_column.py
===========================
Adds a `freq` column to current_market_prediction so that daily / weekly /
monthly cluster predictions can all live in the same table.

Safe to re-run: all statements are guarded with IF NOT EXISTS / IF EXISTS.
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
    # 1. Add freq column with default 'daily' (no-op if already present)
    cur.execute("""
        ALTER TABLE current_market_prediction
        ADD COLUMN IF NOT EXISTS freq VARCHAR(10) NOT NULL DEFAULT 'daily'
    """)
    print("  + freq column added (or already exists)")

    # 2. Drop the old single-column unique constraint (trade_date only)
    cur.execute("""
        ALTER TABLE current_market_prediction
        DROP CONSTRAINT IF EXISTS current_market_prediction_uq
    """)
    cur.execute("""
        ALTER TABLE current_market_prediction
        DROP CONSTRAINT IF EXISTS current_market_prediction_trade_date_key
    """)
    print("  - old unique(trade_date) constraint dropped (if existed)")

    # 3. Add composite unique constraint (trade_date, freq) — guarded via pg_constraint
    cur.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'current_market_prediction_trade_date_freq_key'
            ) THEN
                ALTER TABLE current_market_prediction
                ADD CONSTRAINT current_market_prediction_trade_date_freq_key
                UNIQUE (trade_date, freq);
            END IF;
        END $$;
    """)
    print("  + unique(trade_date, freq) constraint added (or already exists)")

conn.commit()
conn.close()
print("Migration complete.")
