# -*- coding: utf-8 -*-
"""Read-only: how far RX383 and the market tapes go."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import report_type6_ops_missing_nav as ops
from mom_data_etl import get_conn

ops.ensure_db()
conn = get_conn()
try:
    cur = conn.cursor()
    queries = [
        ("opt_trade", """
            SELECT MAX("交易日期")::date, COUNT(*) FILTER (WHERE "交易日期" > DATE '2026-11-03'),
                   COUNT(*) FILTER (WHERE "交易日期" BETWEEN DATE '2026-11-04' AND DATE '2026-11-09')
            FROM mom_options_trade_details WHERE LOWER(TRIM("账户")) = 'rx383'
        """),
        ("fut_trade", """
            SELECT MAX("交易日期")::date, COUNT(*) FILTER (WHERE "交易日期" > DATE '2026-11-03'),
                   COUNT(*) FILTER (WHERE "交易日期" BETWEEN DATE '2026-11-04' AND DATE '2026-11-09')
            FROM mom_futures_trade_details WHERE LOWER(TRIM("账户")) = 'rx383'
        """),
        ("daily", """
            SELECT MAX("交易日期")::date, COUNT(*) FILTER (WHERE "交易日期" > DATE '2026-11-03'),
                   COUNT(*) FILTER (WHERE "交易日期" BETWEEN DATE '2026-11-04' AND DATE '2026-11-09')
            FROM mom_daily_reports WHERE LOWER(TRIM("账户")) = 'rx383'
        """),
        ("opt_pos", """
            SELECT MAX("交易日期")::date, COUNT(*) FILTER (WHERE "交易日期" = DATE '2026-11-09')
            FROM mom_options_position_details WHERE LOWER(TRIM("账户")) = 'rx383'
        """),
        ("fut_daily", """
            SELECT MAX(trade_date)::date FROM raw_futures_contracts_daily
        """),
        ("opt_daily", """
            SELECT MAX(trade_date)::date FROM raw_options_contracts_daily
        """),
        ("ak", """
            SELECT MAX(trade_date)::date FROM raw_akshare_futures_daily
        """),
        ("civ", """
            SELECT MAX(trade_date)::date FROM raw_commodity_option_iv_daily
        """),
    ]
    for name, sql in queries:
        cur.execute(sql)
        print(name, cur.fetchone())
    cur.execute("""
        SELECT "交易日期"::date, COUNT(*)
        FROM mom_options_trade_details
        WHERE LOWER(TRIM("账户")) = 'rx383'
          AND "交易日期" BETWEEN DATE '2026-11-03' AND DATE '2026-11-09'
        GROUP BY 1 ORDER BY 1
    """)
    print("by day")
    for row in cur.fetchall():
        print(row)
finally:
    conn.close()
