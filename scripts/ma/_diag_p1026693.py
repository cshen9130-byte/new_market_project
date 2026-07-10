import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

for fname in (".env.local", ".env"):
    f = ROOT / fname
    if f.is_file():
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

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
reg = "P1026693"
queries = [
    (
        "amac_managers",
        "SELECT manager_name, legal_rep_name, inception_date, registration_date, active_fund_count, member_type FROM amac_managers WHERE registration_no=%s",
    ),
    (
        "amac_manager_details",
        "SELECT actual_controller, full_time_staff_count, fund_practitioner_count, mgmt_scale_range, registered_address, office_address, registered_capital_cny_wan, enterprise_nature, org_type, registration_date FROM amac_manager_details WHERE registration_no=%s",
    ),
    (
        "private_fund_managers_list",
        "SELECT manager_name, mgmt_scale, active_product_count, inception_date, member_type FROM private_fund_managers_list WHERE registration_no=%s",
    ),
    (
        "amac_manager_metrics_history",
        "SELECT COUNT(*), MAX(snapshot_date) FROM amac_manager_metrics_history WHERE registration_no=%s",
    ),
]
for tbl, q in queries:
    try:
        cur.execute(q, (reg,))
        print(f"=== {tbl} ===")
        print(cur.fetchone())
    except Exception as e:
        conn.rollback()
        print(f"=== {tbl} ERROR: {e} ===")
conn.close()
