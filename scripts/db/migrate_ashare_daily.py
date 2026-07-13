#!/usr/bin/env python3
"""
migrate_ashare_daily.py
=======================
Create raw_ashare_daily table for A-share stock daily OHLCV + amount + turnover.

Usage:
    python scripts/db/migrate_ashare_daily.py
"""

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
CREATE TABLE IF NOT EXISTS raw_ashare_daily (
    trade_date  DATE          NOT NULL,
    ts_code     VARCHAR(20)   NOT NULL,
    open        NUMERIC(12,4),
    close       NUMERIC(12,4),
    high        NUMERIC(12,4),
    low         NUMERIC(12,4),
    volume      BIGINT,
    amount      NUMERIC(20,2),
    turn        NUMERIC(12,6),
    source      VARCHAR(30)   NOT NULL DEFAULT 'choice',
    fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT raw_ashare_daily_uq UNIQUE (trade_date, ts_code)
);
CREATE INDEX IF NOT EXISTS raw_ashare_daily_date_idx
    ON raw_ashare_daily (trade_date DESC);
CREATE INDEX IF NOT EXISTS raw_ashare_daily_code_date_idx
    ON raw_ashare_daily (ts_code, trade_date DESC);
"""


def main() -> None:
    _load_env()
    try:
        import psycopg2
    except ImportError:
        print("psycopg2 not installed. Run: pip install psycopg2-binary")
        sys.exit(1)

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
    print("OK: raw_ashare_daily created (or already exists)")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
