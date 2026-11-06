# -*- coding: utf-8 -*-
"""Net metal short reconstructed from the trade tape, at the open of each session."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_option_strategy_report as base  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402

METALS = ["CU", "AL", "ZN", "NI", "SN", "PB", "AO"]
START = pd.Timestamp("2026-10-15")
END = pd.Timestamp("2026-11-03")

conn = get_conn()
try:
    tr = base.parse_side(base.prof.read_sql(
        conn,
        """
        SELECT "交易日期"::date AS dt, "合约" AS contract, "买/卖" AS bs, "开/平" AS oc,
               "手数" AS lots
        FROM mom_options_trade_details
        WHERE LOWER(TRIM("账户")) = %s
          AND "交易日期" BETWEEN DATE '2026-10-01' AND DATE '2026-11-03'
        """,
        (base.ACCOUNT,),
    ))
finally:
    conn.close()
tr["dt"] = pd.to_datetime(tr["dt"]).dt.normalize()
tr["lots"] = pd.to_numeric(tr["lots"], errors="coerce").fillna(0)
tr = tr[tr["product"].isin(METALS)].copy()
# +1 short opened, -1 short closed. A sell-close reduces a long, ignore for the short book.
tr["dshort"] = 0.0
tr.loc[tr["is_sell"] & tr["is_open"], "dshort"] = tr["lots"]
tr.loc[tr["is_buy"] & tr["is_close"], "dshort"] = -tr["lots"]
print("rows", len(tr), "pre-window", int((tr["dt"] < START).sum()))
daily = tr.groupby(["dt", "product"], as_index=False)["dshort"].sum()
days = list(pd.bdate_range(START, END))
# actual sessions we care about
sessions = sorted(d for d in pd.to_datetime(tr["dt"].unique()) if START <= d <= END)
# include sessions with no metal trade too
want = [
    pd.Timestamp(x) for x in
    ["2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22",
     "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30",
     "2026-11-02", "2026-11-03"]
]
book = {p: 0.0 for p in METALS}
# apply trades before the window
for r in daily[daily["dt"] < START].itertuples(index=False):
    book[r.product] += float(r.dshort)
print("book at open 10-15", {k: v for k, v in book.items() if v})
by_day = {pd.Timestamp(r.dt): {} for r in daily.itertuples(index=False)}
for r in daily.itertuples(index=False):
    by_day.setdefault(pd.Timestamp(r.dt), {})[r.product] = float(r.dshort)
for d in want:
    print(pd.Timestamp(d).strftime("%m-%d"), " ".join(f"{p}{book[p]:.0f}" for p in METALS if book[p]))
    for p, v in by_day.get(d, {}).items():
        book[p] = book[p] + v
print("end", {k: v for k, v in book.items() if v})
