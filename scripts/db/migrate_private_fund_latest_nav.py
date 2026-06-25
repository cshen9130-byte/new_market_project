#!/usr/bin/env python3
"""
migrate_private_fund_latest_nav.py
==================================
Adds latest_nav / latest_nav_date columns to private_fund_info, creates a
composite index on private_fund_nav, and backfills latest NAV per fund.

Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

Usage:
    python scripts/db/migrate_private_fund_latest_nav.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


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


def main() -> None:
    try:
        import psycopg2
    except ImportError:
        print("psycopg2 not installed. Run: pip install psycopg2-binary", file=sys.stderr)
        sys.exit(1)

    _load_env()
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

    conn.autocommit = False
    cur = conn.cursor()

    print("Adding latest_nav columns to private_fund_info …")
    cur.execute("""
        ALTER TABLE private_fund_info
          ADD COLUMN IF NOT EXISTS latest_nav      NUMERIC(16,6),
          ADD COLUMN IF NOT EXISTS latest_nav_date DATE
    """)

    print("Creating composite index on private_fund_nav …")
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_pfn_beian_date_desc
          ON private_fund_nav (beian_hao, price_date DESC)
    """)

    print("Creating list indexes on private_fund_info …")
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_pfi_product_name
          ON private_fund_info (product_name)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_pfi_strategy_l1
          ON private_fund_info (strategy_l1)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_pfi_latest_nav_date
          ON private_fund_info (latest_nav_date DESC NULLS LAST)
    """)

    print("Backfilling latest_nav / latest_nav_date (one-time DISTINCT ON scan) …")
    cur.execute("""
        UPDATE private_fund_info AS i SET
          latest_nav      = sub.nav,
          latest_nav_date = sub.price_date
        FROM (
          SELECT DISTINCT ON (beian_hao)
            beian_hao, nav, price_date
          FROM private_fund_nav
          WHERE nav IS NOT NULL AND nav > 0
          ORDER BY beian_hao, price_date DESC
        ) AS sub
        WHERE i.beian_hao = sub.beian_hao
    """)
    updated = cur.rowcount
    conn.commit()
    print(f"Done — backfilled {updated} funds.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
