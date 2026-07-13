#!/usr/bin/env python3
"""Create dim_ashare_stock table for A-share Chinese name lookup."""

from __future__ import annotations

import os
import sys
import traceback
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


DDL = """
CREATE TABLE IF NOT EXISTS dim_ashare_stock (
    ts_code     VARCHAR(20)   PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
"""


def main() -> int:
    _load_env()
    try:
        import psycopg2
    except ImportError:
        print("psycopg2 not installed", file=sys.stderr)
        return 1

    try:
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST", "localhost"),
            port=int(os.environ.get("DB_PORT", "5432")),
            dbname=os.environ.get("DB_NAME", "market_data"),
            user=os.environ.get("DB_USER", "market_user"),
            password=os.environ.get("DB_PASSWORD", ""),
        )
        with conn.cursor() as cur:
            cur.execute(DDL)
        conn.commit()
        conn.close()
        print("OK: dim_ashare_stock created (or already exists)")
        return 0
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
