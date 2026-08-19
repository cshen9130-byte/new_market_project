#!/bin/bash
set -euo pipefail
cd /root/new_market_project
set -a
. ./.env
set +a
python3 - <<'PY'
import os, json, psycopg2
conn = psycopg2.connect(os.environ.get("DATABASE_URL") or os.environ["POSTGRES_URL"])
cur = conn.cursor()
cur.execute(
    """
    SELECT id, status, beian_hao, product_name, applied_fields, error_message,
           length(coalesce(text_preview,'')), left(coalesce(text_preview,''), 900),
           extracted_json
    FROM ops_element_extract_jobs WHERE id = 10
    """
)
row = cur.fetchone()
print("status", row[1])
print("beian", row[2], row[3])
print("applied", row[4])
print("error", row[5])
print("preview_len", row[6])
print("---preview---")
print(row[7])
print("---extracted---")
print(json.dumps(row[8], ensure_ascii=False, indent=2) if row[8] is not None else None)
print("=== remaining needs_review ===")
cur.execute(
    "SELECT id, original_filename, product_name, error_message FROM ops_element_extract_jobs WHERE status = 'needs_review' ORDER BY id"
)
for r in cur.fetchall():
    print(r)
print("=== fee_pay ===")
cur.execute(
    "SELECT fund_name, register_number, fee_pay FROM basicinfo_bfl_track WHERE fund_name ILIKE %s OR register_number ILIKE %s",
    ("%奇盾安富尊荣3号%", "%SAPY25%"),
)
for r in cur.fetchall():
    print("NAME:", r[0])
    print("CODE:", r[1])
    print("FEE_PAY:", r[2])
    print("---")
PY
