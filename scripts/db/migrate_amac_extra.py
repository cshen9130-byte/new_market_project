#!/usr/bin/env python3
"""
migrate_amac_extra.py
=====================
Creates AMAC extra tables and loads data from fetch_amac_data/amac_extra/*.csv.

Safe to re-run: CREATE TABLE uses IF NOT EXISTS; rows upsert on natural keys.

Usage:
    python scripts/db/migrate_amac_extra.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CSV_DIR = ROOT / "fetch_amac_data" / "amac_extra"

sys.path.insert(0, str(ROOT / "scripts" / "db"))
from amac_extra_db import (  # noqa: E402
    DDL,
    UPSERT_EXECUTIVE_RESUME,
    UPSERT_EXECUTIVES,
    UPSERT_MANAGER_DETAILS,
    UPSERT_MANAGERS,
    UPSERT_PERSON_ORG,
    load_manager_details_from_csv,
    load_manager_executive_resume_from_csv,
    load_manager_executives_from_csv,
    load_managers_from_csv,
    load_person_org_stats_from_csv,
)


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
    _load_env()

    try:
        import psycopg2
        from psycopg2.extras import execute_values
    except ImportError as exc:
        print(f"Missing dependency: {exc}. Run: pip install psycopg2-binary")
        sys.exit(1)

    if not CSV_DIR.is_dir():
        print(f"Directory not found: {CSV_DIR}")
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

    loaders = [
        ("amac_managers", lambda: load_managers_from_csv(CSV_DIR), UPSERT_MANAGERS),
        ("amac_person_org_stats", lambda: load_person_org_stats_from_csv(CSV_DIR), UPSERT_PERSON_ORG),
        ("amac_manager_details", lambda: load_manager_details_from_csv(CSV_DIR), UPSERT_MANAGER_DETAILS),
        ("amac_manager_executives", lambda: load_manager_executives_from_csv(CSV_DIR), UPSERT_EXECUTIVES),
        (
            "amac_manager_executive_resume",
            lambda: load_manager_executive_resume_from_csv(CSV_DIR),
            UPSERT_EXECUTIVE_RESUME,
        ),
    ]

    with conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            print("Tables ready.")

            for table, loader, upsert_sql in loaders:
                print(f"Loading {table} …")
                rows = loader()
                execute_values(cur, upsert_sql, rows, page_size=2000)
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                total = cur.fetchone()[0]
                cur.execute(f"ANALYZE {table}")
                print(f"  Upserted {len(rows):,} rows ({total:,} rows in {table})")

    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
