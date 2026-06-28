#!/usr/bin/env python3
from __future__ import annotations
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
for fname in (".env.local", ".env"):
    f = ROOT / fname
    if f.is_file():
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v

import psycopg2  # type: ignore

conn = psycopg2.connect(os.environ.get("DATABASE_URL") or "")
cur = conn.cursor()

cur.execute(
    """
    SELECT nav_date, subject, attachment_filename, fund_name
    FROM ops_email_nav_records
    WHERE fund_name ILIKE '%%恒盈%%'
      AND nav_date < DATE '2026-01-01'
    ORDER BY nav_date
    LIMIT 15
    """
)
print("nav hengying pre-2026:", cur.fetchall())

cur.execute(
    """
    SELECT valuation_date, subject, attachment_filename, fund_name
    FROM ops_email_valuation_records
    WHERE fund_name ILIKE '%%恒盈%%'
    ORDER BY valuation_date
    LIMIT 5
    """
)
print("val hengying earliest:", cur.fetchall())

cur.execute(
    """
    SELECT attachment_filename, COUNT(*)
    FROM ops_email_valuation_records
    WHERE fund_name ILIKE '%%恒盈%%'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 10
    """
)
print("val attachment patterns:", cur.fetchall())

cur.execute(
    """
    SELECT valuation_date, subject, attachment_filename, product_code, fund_name
    FROM ops_email_valuation_records
    WHERE attachment_filename ILIKE '%%恒盈%%'
       OR subject ILIKE '%%恒盈%%'
    ORDER BY valuation_date
    LIMIT 20
    """
)
print("any val mentioning hengying:", cur.fetchall())

cur.execute(
    """
    SELECT COUNT(*), MIN(valuation_date), MAX(valuation_date)
    FROM ops_email_valuation_records
    WHERE attachment_filename ILIKE '%%专用表%%'
       OR attachment_filename ILIKE '%%估值%%'
    """
)
print("val by filename keyword:", cur.fetchone())

cur.close()
conn.close()
