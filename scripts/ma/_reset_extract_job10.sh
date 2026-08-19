#!/bin/bash
set -euo pipefail
cd /root/new_market_project
set -a
. ./.env
set +a
python3 - <<'PY'
import os, psycopg2
conn = psycopg2.connect(os.environ.get("DATABASE_URL") or os.environ["POSTGRES_URL"])
conn.autocommit = True
cur = conn.cursor()
cur.execute(
    """
    UPDATE ops_element_extract_jobs
    SET status = 'needs_review',
        error_message = NULL,
        extracted_json = NULL,
        text_preview = NULL,
        applied_fields = NULL
    WHERE id = 10
    RETURNING id, status, original_filename
    """
)
print("reset", cur.fetchone())
PY
npx tsx scripts/ma/contract_extract_etl.ts --rematch-review
