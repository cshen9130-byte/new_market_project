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

import json
import psycopg2  # type: ignore

conn = psycopg2.connect(os.environ.get("DATABASE_URL") or "")
cur = conn.cursor()

queries = [
    ("all valuation count/range", "SELECT COUNT(*), MIN(valuation_date), MAX(valuation_date), MIN(sent_at), MAX(sent_at) FROM ops_email_valuation_records"),
    ("all nav before 2026", "SELECT COUNT(*), MIN(nav_date), MAX(nav_date) FROM ops_email_nav_records WHERE nav_date < DATE '2026-01-01'"),
    ("valuation by year", "SELECT EXTRACT(YEAR FROM valuation_date)::int, COUNT(*) FROM ops_email_valuation_records GROUP BY 1 ORDER BY 1"),
    ("nav by year", "SELECT EXTRACT(YEAR FROM nav_date)::int, COUNT(*) FROM ops_email_nav_records GROUP BY 1 ORDER BY 1 LIMIT 10"),
]
for label, sql in queries:
    cur.execute(sql)
    print(label, cur.fetchone())

# email parse json store
store_path = ROOT / "data" / "email-parse-records.json"
if store_path.is_file():
    data = json.loads(store_path.read_text(encoding="utf-8"))
    records = data.get("records", [])
    dates = [r.get("sentAt", "")[:10] for r in records if r.get("sentAt")]
    dates.sort()
    print("parse store count", len(records), "oldest", dates[0] if dates else None, "newest", dates[-1] if dates else None)
    val_ok = [r for r in records if r.get("valuationStatus") == "成功"]
    print("parse valuation success", len(val_ok))

cur.close()
conn.close()
