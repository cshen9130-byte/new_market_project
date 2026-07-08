#!/usr/bin/env python3
"""Repair SBPC20 email rows where 虚拟计提净值表 AUM was stored as unit NAV."""
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
for fname in (".env.local", ".env"):
    f = ROOT / fname
    if not f.is_file():
        continue
    for line in f.open(encoding="utf-8", errors="ignore"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import psycopg2

SUBJ_RE = re.compile(r"单位净(?:值|价)\s*(?:为|[：:])\s*(\d+\.\d{3,8})")

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
cur.execute(
    """SELECT id, nav_date::text, nav::text, subject
       FROM ops_email_nav_records
       WHERE product_code = 'SBPC20'
         AND nav::numeric > 50
       ORDER BY nav_date DESC, id"""
)
rows = cur.fetchall()
updated = 0
for row_id, nav_date, nav, subject in rows:
    m = SUBJ_RE.search(subject or "")
    if not m:
        continue
    hinted = float(m.group(1))
    if not (0.1 <= hinted <= 50):
        continue
    cur.execute(
        "UPDATE ops_email_nav_records SET nav = %s WHERE id = %s",
        (hinted, row_id),
    )
    updated += 1
    print(f"  id={row_id} {nav_date}: {nav} -> {hinted}")

conn.commit()
print(f"Updated {updated} rows")
conn.close()
