#!/usr/bin/env python3
"""
migrate_mom_carry_rates.py
===========================
Creates the mom_carry_rates config table and seeds it with default rates.

Safe to re-run: CREATE TABLE uses IF NOT EXISTS; seed rows use ON CONFLICT DO NOTHING.

Usage:
    python scripts/db/migrate_mom_carry_rates.py
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
    cur.execute("""
        CREATE TABLE IF NOT EXISTS mom_carry_rates (
            key   VARCHAR(50) PRIMARY KEY,
            value NUMERIC(8,6) NOT NULL
        )
    """)
    print("  + mom_carry_rates table created (or already exists)")

    for key, value in [("mother_rate", 0.35), ("child_rate", 0.20)]:
        cur.execute("""
            INSERT INTO mom_carry_rates (key, value)
            VALUES (%s, %s)
            ON CONFLICT (key) DO NOTHING
        """, (key, value))
        if cur.rowcount:
            print(f"  + Seeded default: {key} = {value}")
        else:
            print(f"  ~ Already exists: {key}")

conn.commit()
conn.close()
print("Migration complete.")
