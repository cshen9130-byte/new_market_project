# -*- coding: utf-8 -*-
"""What is already in the database after 3 Nov."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_option_strategy_report as base  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402

conn = get_conn()
try:
    dates = base.prof.read_sql(conn, """
        SELECT 'opt_trade' AS src, MAX("交易日期")::date AS mx, COUNT(*) FILTER (WHERE "交易日期" >= DATE '2026-11-03') AS n
        FROM mom_options_trade_details WHERE LOWER(TRIM("账户")) = %s
        UNION ALL
        SELECT 'fut_trade', MAX("交易日期")::date, COUNT(*) FILTER (WHERE "交易日期" >= DATE '2026-11-03')
        FROM mom_futures_trade_details WHERE LOWER(TRIM("账户")) = %s
        UNION ALL
        SELECT 'daily', MAX("交易日期")::date, COUNT(*) FILTER (WHERE "交易日期" >= DATE '2026-11-03')
        FROM mom_daily_reports WHERE LOWER(TRIM("账户")) = %s
        UNION ALL
        SELECT 'ak', MAX(trade_date)::date, COUNT(*) FILTER (WHERE trade_date >= DATE '2026-11-03')
        FROM raw_akshare_futures_daily
        UNION ALL
        SELECT 'fut', MAX(trade_date)::date, COUNT(*) FILTER (WHERE trade_date >= DATE '2026-11-03')
        FROM raw_futures_contracts_daily
        UNION ALL
        SELECT 'optpx', MAX(trade_date)::date, COUNT(*) FILTER (WHERE trade_date >= DATE '2026-11-03')
        FROM raw_options_contracts_daily
        UNION ALL
        SELECT 'iv', MAX(trade_date)::date, COUNT(*) FILTER (WHERE trade_date >= DATE '2026-11-03')
        FROM raw_commodity_option_iv_daily
    """, (base.ACCOUNT, base.ACCOUNT, base.ACCOUNT))
    tr = base.parse_side(base.prof.read_sql(conn, """
        SELECT "交易日期"::date AS dt, "合约" AS contract, "买/卖" AS bs, "开/平" AS oc,
               "手数" AS lots, "成交价" AS price
        FROM mom_options_trade_details
        WHERE LOWER(TRIM("账户")) = %s
          AND "交易日期" BETWEEN DATE '2026-11-03' AND DATE '2026-11-06'
    """, (base.ACCOUNT,)))
finally:
    conn.close()
print(dates.to_string(index=False))
tr["dt"] = pd.to_datetime(tr["dt"])
tr["lots"] = pd.to_numeric(tr["lots"], errors="coerce")
tr["price"] = pd.to_numeric(tr["price"], errors="coerce")
print("trade rows", len(tr))
if tr.empty:
    raise SystemExit
opens = tr[tr["is_open"] & tr["is_sell"]]
print("\nSELL OPENS")
for dt, g in opens.groupby("dt"):
    bits = []
    for (p, month, cp, strike), s in g.groupby(["product", "month", "cp", "strike"]):
        lots = float(s["lots"].sum())
        px = float((s["price"] * s["lots"]).sum() / lots)
        bits.append(f"{p}{month}{cp}{int(strike)} x{lots:.0f}@{px:.1f}")
    print(pd.Timestamp(dt).strftime("%m-%d"), " | ".join(bits) or "-")
