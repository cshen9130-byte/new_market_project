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
    SELECT nav_date, subject, attachment_filename, fund_name, product_code
    FROM ops_email_nav_records
    WHERE (product_code = 'SBAH99' OR fund_name ILIKE '%%恒盈2号%%')
      AND nav_date BETWEEN DATE '2025-06-01' AND '2025-07-31'
    ORDER BY nav_date
    LIMIT 30
    """
)
rows = cur.fetchall()
print("SBAH99 nav 2025-06 sample count", len(rows))
for r in rows:
    print(r)

cur.execute(
    """
    SELECT nav_date, subject, attachment_filename
    FROM ops_email_nav_records
    WHERE nav_date BETWEEN DATE '2025-06-01' AND '2025-06-30'
      AND (subject ILIKE '%%估值%%' OR attachment_filename ILIKE '%%估值%%' OR attachment_filename ILIKE '%%专用表%%')
    ORDER BY nav_date
    LIMIT 20
    """
)
print("\nAny 2025-06 valuation-ish nav rows:")
for r in cur.fetchall():
    print(r)

cur.execute(
    """
    SELECT DISTINCT attachment_filename
    FROM ops_email_nav_records
    WHERE (product_code = 'SBAH99' OR fund_name ILIKE '%%恒盈2号%%')
      AND attachment_filename <> ''
    ORDER BY 1
    LIMIT 40
    """
)
print("\nSBAH99 attachment filenames:")
for r in cur.fetchall():
    print(r[0])

cur.close()
conn.close()
