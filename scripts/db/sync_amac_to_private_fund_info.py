#!/usr/bin/env python3
"""
sync_amac_to_private_fund_info.py
===================================
Insert funds from amac_private_funds into private_fund_info when beian_hao is missing.

Only adds new rows; does not update existing private_fund_info records.

Usage:
    python scripts/db/sync_amac_to_private_fund_info.py
    python scripts/db/sync_amac_to_private_fund_info.py --dry-run
"""

from __future__ import annotations

import argparse
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


def _connect():
    import psycopg2

    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", "market_data"),
        user=os.environ.get("DB_USER", "market_user"),
        password=os.environ.get("DB_PASSWORD", ""),
    )


INSERT_SQL = """
INSERT INTO private_fund_info (beian_hao, product_name, manager, inception_date)
SELECT
    a.fund_no,
    a.fund_name,
    a.manager_name,
    a.establish_date
FROM amac_private_funds a
WHERE NOT EXISTS (
    SELECT 1 FROM private_fund_info p WHERE p.beian_hao = a.fund_no
)
ON CONFLICT (beian_hao) DO NOTHING
"""

COUNT_CANDIDATES_SQL = """
SELECT COUNT(*)
FROM amac_private_funds a
WHERE NOT EXISTS (
    SELECT 1 FROM private_fund_info p WHERE p.beian_hao = a.fund_no
)
"""

SYNC_MANAGER_SQL = """
UPDATE private_fund_info i
SET manager = a.manager_name
FROM amac_private_funds a
WHERE a.fund_no = i.beian_hao
  AND i.manager IS DISTINCT FROM a.manager_name
  AND COALESCE(BTRIM(a.manager_name), '') <> ''
  AND a.manager_name NOT LIKE '%；%'
  AND a.manager_name NOT LIKE '%;%'
  AND (
    COALESCE(BTRIM(i.manager), '') = ''
    OR (
      i.manager NOT LIKE '%；%'
      AND i.manager NOT LIKE '%;%'
      AND LENGTH(BTRIM(i.manager)) >= 6
      AND a.manager_name LIKE BTRIM(i.manager) || '%'
    )
  )
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync AMAC funds into private_fund_info.")
    parser.add_argument("--dry-run", action="store_true", help="Count candidates only; do not insert.")
    args = parser.parse_args()

    _load_env()

    try:
        conn = _connect()
    except Exception as exc:
        print(f"Database connection failed: {exc}")
        sys.exit(1)

    with conn:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('public.amac_private_funds')")
            if cur.fetchone()[0] is None:
                print("amac_private_funds table not found. Run migrate_amac_private_funds.py first.")
                sys.exit(1)

            cur.execute("SELECT to_regclass('public.private_fund_info')")
            if cur.fetchone()[0] is None:
                print("private_fund_info table not found.")
                sys.exit(1)

            cur.execute("SELECT COUNT(*) FROM amac_private_funds")
            amac_total = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM private_fund_info")
            info_before = cur.fetchone()[0]
            cur.execute(COUNT_CANDIDATES_SQL)
            candidates = cur.fetchone()[0]

            print(f"amac_private_funds: {amac_total:,} rows")
            print(f"private_fund_info:  {info_before:,} rows (before)")
            print(f"Candidates to add:  {candidates:,}")

            if args.dry_run:
                print("Dry run — no rows written.")
                return

            inserted = 0
            if candidates > 0:
                cur.execute(INSERT_SQL)
                inserted = cur.rowcount

            cur.execute(SYNC_MANAGER_SQL)
            manager_updated = cur.rowcount
            cur.execute("SELECT COUNT(*) FROM private_fund_info")
            info_after = cur.fetchone()[0]

    conn.close()
    print(
        f"Inserted {inserted:,} new funds into private_fund_info "
        f"({info_after:,} rows total); updated {manager_updated:,} abbreviated manager names."
    )


if __name__ == "__main__":
    main()
