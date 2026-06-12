#!/usr/bin/env python3
"""
migrate_ops_email_nav_records.py
=================================
Creates the ops_email_nav_records table for email-sourced NAV data.

Safe to re-run: CREATE TABLE / CREATE INDEX use IF NOT EXISTS.

Usage:
    python scripts/db/migrate_ops_email_nav_records.py
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

sql_path = Path(__file__).resolve().parent.parent / "ma" / "003_create_ops_email_nav_records.sql"
ddl = sql_path.read_text(encoding="utf-8")

with conn.cursor() as cur:
    cur.execute(ddl)
    print("  + ops_email_nav_records table created (or already exists)")

    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'ops_email_nav_records'
        )
    """)
    exists = cur.fetchone()[0]
    print("  Table visible in public schema:", exists)

conn.commit()
conn.close()
print("Migration complete.")
