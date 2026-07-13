#!/usr/bin/env python3
"""Create derived_ashare_crowding_daily table."""

from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

DDL = """
CREATE TABLE IF NOT EXISTS derived_ashare_crowding_daily (
    trade_date       DATE          PRIMARY KEY,
    total_amount     NUMERIC(20,2),
    hhi              NUMERIC(12,8),
    top3_share       NUMERIC(8,4),
    top10_share      NUMERIC(8,4),
    crowding_pct     NUMERIC(6,2),
    crowding_smooth  NUMERIC(6,2),
    top_board        VARCHAR(30),
    top_board_share  NUMERIC(8,4),
    board_shares     JSONB,
    computed_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS derived_ashare_crowding_daily_date_idx
    ON derived_ashare_crowding_daily (trade_date DESC);
"""


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
    import psycopg2

    url = os.environ.get("DATABASE_URL")
    conn = (
        psycopg2.connect(url)
        if url
        else psycopg2.connect(
            host=os.environ.get("DB_HOST", "localhost"),
            port=int(os.environ.get("DB_PORT", "5432")),
            dbname=os.environ.get("DB_NAME", "market_data"),
            user=os.environ.get("DB_USER", "market_user"),
            password=os.environ.get("DB_PASSWORD", ""),
        )
    )
    cur = conn.cursor()
    cur.execute(DDL)
    conn.commit()
    cur.close()
    conn.close()
    print("OK: derived_ashare_crowding_daily created (or already exists)")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
