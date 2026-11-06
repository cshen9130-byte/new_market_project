# -*- coding: utf-8 -*-
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_option_strategy_report as base  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402

conn = get_conn()
try:
    pos = base.parse_side(base.prof.read_sql(
        conn,
        """
        SELECT "交易日期"::date AS dt, "合约" AS contract,
               "买持仓" AS long_lots, "卖持仓" AS short_lots
        FROM mom_options_position_details
        WHERE LOWER(TRIM("账户")) = %s
          AND "交易日期" BETWEEN DATE '2026-10-14' AND DATE '2026-10-30'
        """,
        (base.ACCOUNT,),
    ))
    tr = base.parse_side(base.prof.read_sql(
        conn,
        """
        SELECT "交易日期"::date AS dt, "合约" AS contract, "买/卖" AS bs, "开/平" AS oc,
               "手数" AS lots
        FROM mom_options_trade_details
        WHERE LOWER(TRIM("账户")) = %s
          AND "交易日期" BETWEEN DATE '2026-10-15' AND DATE '2026-10-30'
        """,
        (base.ACCOUNT,),
    ))
finally:
    conn.close()
pos["dt"] = pd.to_datetime(pos["dt"])
tr["dt"] = pd.to_datetime(tr["dt"])
for c in ("long_lots", "short_lots", "lots"):
    if c in pos.columns:
        pos[c] = pd.to_numeric(pos[c], errors="coerce").fillna(0)
    if c in tr.columns:
        tr[c] = pd.to_numeric(tr[c], errors="coerce").fillna(0)
metals = {"CU", "AL", "ZN", "NI", "SN", "PB", "AO"}
pos = pos[pos["product"].isin(metals)]
tr = tr[tr["product"].isin(metals)]
print("POS rows", len(pos), "dup", int(pos.duplicated(["dt", "contract"]).sum()))
pos = pos.drop_duplicates(["dt", "contract"])
print("after dedup", len(pos))
for dt, g in pos.groupby("dt"):
    bits = []
    for p, gg in g.groupby("product"):
        bits.append(f"{p}:L{gg['long_lots'].sum():.0f}/S{gg['short_lots'].sum():.0f}/n{len(gg)}")
    print(pd.Timestamp(dt).strftime("%m-%d"), " ".join(bits))
print("\nSN NI CU PB contracts")
sub = pos[pos["product"].isin(["SN", "NI", "CU", "PB"])]
for dt, g in sub.groupby("dt"):
    bits = [f"{r.contract}:S{r.short_lots:.0f}" for r in g.itertuples(index=False) if r.short_lots or r.long_lots]
    print(pd.Timestamp(dt).strftime("%m-%d"), " ".join(bits))
print("\nCLOSES")
cl = tr[tr["is_close"]]
for dt, g in cl.groupby("dt"):
    bits = [f"{r.product}{r.month}{'S' if r.is_sell else 'B'}{int(float(r.lots))}" for r in g.itertuples(index=False)]
    print(pd.Timestamp(dt).strftime("%m-%d"), " ".join(bits))
