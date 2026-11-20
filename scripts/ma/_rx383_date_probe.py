# -*- coding: utf-8 -*-
"""Read-only: futures after 9 Nov, and whether the open examples are still on the book."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import report_type6_ops_missing_nav as ops
from mom_data_etl import get_conn

ops.ensure_db()
conn = get_conn()
try:
    cur = conn.cursor()
    cur.execute("""
        SELECT "交易日期"::date, "合约", "买/卖", "开/平", "手数", "成交价"
        FROM mom_futures_trade_details
        WHERE LOWER(TRIM("账户")) = 'rx383' AND "交易日期" > DATE '2026-11-09'
        ORDER BY 1, 2
    """)
    print("FUT")
    for row in cur.fetchall():
        print(row)
    cur.execute("""
        SELECT "交易日期"::date, "合约", SUM("持仓手数"::float8)
        FROM mom_futures_position_details
        WHERE LOWER(TRIM("账户")) = 'rx383' AND "交易日期" = DATE '2026-11-19'
        GROUP BY 1, 2 ORDER BY 2
    """)
    print("FPOS")
    for row in cur.fetchall():
        print(row)
    cur.execute("""
        SELECT "合约", SUM(CASE WHEN "买/卖" LIKE '%卖%' THEN "手数"::float8 ELSE 0 END),
               SUM(CASE WHEN "买/卖" LIKE '%买%' THEN "手数"::float8 ELSE 0 END)
        FROM mom_options_position_details
        WHERE LOWER(TRIM("账户")) = 'rx383' AND "交易日期" = DATE '2026-11-19'
          AND ("合约" ILIKE 'c2701%' OR "合约" ILIKE 'jd2612%' OR "合约" ILIKE 'm2701%' OR "合约" ILIKE 'rb2701%')
        GROUP BY 1 ORDER BY 1
    """)
    print("OPOS examples")
    for row in cur.fetchall():
        print(row)
finally:
    conn.close()
