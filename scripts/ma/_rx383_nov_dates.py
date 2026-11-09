# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_option_strategy_report as base
from mom_data_etl import get_conn

conn = get_conn()
try:
    daily = base.prof.read_sql(conn, """
        SELECT "交易日期"::date AS dt
        FROM mom_daily_reports
        WHERE LOWER(TRIM("账户")) = %s
          AND "交易日期" BETWEEN DATE '2026-11-02' AND DATE '2026-11-06'
        ORDER BY 1
    """, (base.ACCOUNT,))
    fut = base.prof.read_sql(conn, """
        SELECT "交易日期"::date AS dt, COUNT(*) AS n
        FROM mom_futures_trade_details
        WHERE LOWER(TRIM("账户")) = %s
          AND "交易日期" BETWEEN DATE '2026-11-02' AND DATE '2026-11-06'
        GROUP BY 1 ORDER BY 1
    """, (base.ACCOUNT,))
    ak = base.prof.read_sql(conn, """
        SELECT DISTINCT trade_date::date AS dt
        FROM raw_akshare_futures_daily
        WHERE trade_date BETWEEN DATE '2026-11-02' AND DATE '2026-11-06'
        ORDER BY 1
    """)
finally:
    conn.close()
print("daily")
print(daily.to_string(index=False))
print("fut trades")
print(fut.to_string(index=False))
print("ak")
print(ak.to_string(index=False))
