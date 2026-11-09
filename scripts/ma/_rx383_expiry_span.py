# -*- coding: utf-8 -*-
"""Strike coverage on a few option months, and his sell-open months."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_option_strategy_report as base
from mom_data_etl import get_conn

conn = get_conn()
try:
    cov = base.prof.read_sql(conn, """
        SELECT contract, COUNT(*) AS n, MIN(trade_date)::date AS a, MAX(trade_date)::date AS b
        FROM raw_options_contracts_daily
        WHERE contract ILIKE 'CU2611%' OR contract ILIKE 'CU2511%'
           OR contract ILIKE 'M2601%' OR contract ILIKE 'LC2612%'
        GROUP BY contract
        ORDER BY contract
    """)
    print("sample contracts", len(cov))
    print(cov.head(8).to_string(index=False))
    print("...")
    print("CU2611", int(cov["contract"].str.upper().str.startswith("CU2611").sum()) if len(cov) else 0)
    print("CU2511", int(cov["contract"].astype(str).str.upper().str.startswith("CU2511").sum()))
    print("M2601", int(cov["contract"].astype(str).str.upper().str.startswith("M2601").sum()))
    print("LC2612", int(cov["contract"].astype(str).str.upper().str.startswith("LC2612").sum()))
    tr = base.parse_side(base.prof.read_sql(conn, """
        SELECT "交易日期"::date AS dt, "合约" AS contract, "买/卖" AS bs, "开/平" AS oc,
               "手数" AS lots, "成交价" AS price
        FROM mom_options_trade_details
        WHERE LOWER(TRIM("账户")) = %s
    """, (base.ACCOUNT,)))
finally:
    conn.close()

sell = tr[tr["is_sell"] & tr["is_open"]]
print("sell opens", len(sell), "lots", float(sell["lots"].sum()))
print(sell.groupby(["product", "month"]).size().sort_index().to_string())
