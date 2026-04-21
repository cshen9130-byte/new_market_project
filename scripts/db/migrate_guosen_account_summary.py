#!/usr/bin/env python3
"""
migrate_guosen_account_summary.py
==================================
Creates the guosen_account_summary table for storing 资金状况 (Account Summary)
data parsed from 国信 settlement xlsx files.

Columns map to cells in the first sheet:
  C5  client_id          G5  client_name        N5  trade_date (date range)
  D10 balance_bf         D11 deposit_withdrawal  D12 realized_pl
  D13 mtm_pl             D14 exercise_pl         D15 commission
  D16 exercise_fee       D17 delivery_fee        D18 new_fx_pledge
  D19 fx_redemption      D20 chg_pledge_amt      D21 premium_received
  D22 premium_paid       D23 delivery_pl
  K10 initial_margin     K11 balance_cf          K12 pledge_amount
  K13 client_equity      K14 fx_pledge_occ       K15 margin_occupied
  K16 delivery_margin    K17 mv_long             K18 mv_short
  K19 mv_equity          K20 fund_avail          K21 risk_degree
  K22 margin_call        K23 chg_fx_pledge

Safe to re-run: CREATE TABLE uses IF NOT EXISTS.

Usage:
    python scripts/db/migrate_guosen_account_summary.py
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
        CREATE TABLE IF NOT EXISTS guosen_account_summary (
            id                  SERIAL PRIMARY KEY,
            client_id           TEXT NOT NULL,
            client_name         TEXT,
            trade_date          DATE NOT NULL,
            date_range_raw      TEXT,
            source_file         TEXT NOT NULL,
            balance_bf          NUMERIC,
            deposit_withdrawal  NUMERIC,
            realized_pl         NUMERIC,
            mtm_pl              NUMERIC,
            exercise_pl         NUMERIC,
            commission          NUMERIC,
            exercise_fee        NUMERIC,
            delivery_fee        NUMERIC,
            new_fx_pledge       NUMERIC,
            fx_redemption       NUMERIC,
            chg_pledge_amt      NUMERIC,
            premium_received    NUMERIC,
            premium_paid        NUMERIC,
            delivery_pl         NUMERIC,
            initial_margin      NUMERIC,
            balance_cf          NUMERIC,
            pledge_amount       NUMERIC,
            client_equity       NUMERIC,
            fx_pledge_occ       NUMERIC,
            margin_occupied     NUMERIC,
            delivery_margin     NUMERIC,
            mv_long             NUMERIC,
            mv_short            NUMERIC,
            mv_equity           NUMERIC,
            fund_avail          NUMERIC,
            risk_degree         NUMERIC,
            margin_call         NUMERIC,
            chg_fx_pledge       NUMERIC,
            updated_at          TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (client_id, trade_date)
        )
    """)
    print("  + guosen_account_summary table created (or already exists)")

conn.commit()
conn.close()
print("Migration complete.")
