# -*- coding: utf-8 -*-
"""What contract and price he sold, against the prior session's future and settlement."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_option_strategy_report as base  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402

METALS = ["CU", "AL", "ZN", "NI", "SN", "PB", "AO"]

conn = get_conn()
try:
    tr = base.parse_side(base.prof.read_sql(
        conn,
        """
        SELECT "交易日期"::date AS dt, "合约" AS contract, "买/卖" AS bs, "开/平" AS oc,
               "手数" AS lots, "成交价" AS price
        FROM mom_options_trade_details
        WHERE LOWER(TRIM("账户")) = %s
          AND "交易日期" BETWEEN DATE '2026-10-15' AND DATE '2026-11-03'
        """,
        (base.ACCOUNT,),
    ))
    chain = base.prof.read_sql(
        conn,
        """
        SELECT trade_date::date AS dt, contract, COALESCE(clear, close)::float8 AS settl
        FROM raw_options_contracts_daily
        WHERE trade_date BETWEEN DATE '2026-10-01' AND DATE '2026-11-03'
        """,
    )
    futs = base.prof.read_sql(
        conn,
        """
        SELECT trade_date::date AS dt, contract, COALESCE(clear, close)::float8 AS settl,
               COALESCE(volume, 0)::float8 AS volume
        FROM raw_futures_contracts_daily
        WHERE trade_date BETWEEN DATE '2026-10-01' AND DATE '2026-11-03'
        """,
    )
finally:
    conn.close()

tr["dt"] = pd.to_datetime(tr["dt"]).dt.normalize()
tr["lots"] = pd.to_numeric(tr["lots"], errors="coerce").fillna(0)
tr["price"] = pd.to_numeric(tr["price"], errors="coerce")
tr = tr[tr["product"].isin(METALS) & tr["is_open"] & tr["is_sell"]].copy()
chain["dt"] = pd.to_datetime(chain["dt"]).dt.normalize()
chain["code"] = chain["contract"].map(base.norm_code)
chain["settl"] = pd.to_numeric(chain["settl"], errors="coerce")
futs["dt"] = pd.to_datetime(futs["dt"]).dt.normalize()
futs["code"] = futs["contract"].map(base.norm_code)
futs["settl"] = pd.to_numeric(futs["settl"], errors="coerce")

days = sorted(set(tr["dt"]).union(set(futs["dt"])))
prev = {days[i]: days[i - 1] for i in range(1, len(days))}
settle = {(pd.Timestamp(r.dt), r.code): float(r.settl) for r in chain.itertuples(index=False) if pd.notna(r.settl)}
fut_rows = []
for r in futs.itertuples(index=False):
    m = __import__("re").match(r"^([A-Z]+?)(\d{3,4})$", str(r.code))
    if m and r.settl and r.settl > 0:
        fut_rows.append((pd.Timestamp(r.dt), m.group(1), base.month_key(m.group(2)), float(r.settl), float(r.volume), r.code))
fut = pd.DataFrame(fut_rows, columns=["dt", "product", "mkey", "px", "volume", "code"])
fut = fut.sort_values("volume", ascending=False).drop_duplicates(["dt", "product", "mkey"])

# vwap by day, contract
g = tr.groupby(["dt", "product", "month", "cp", "strike", "code"], as_index=False).apply(
    lambda s: pd.Series({"lots": s["lots"].sum(), "px": (s["price"] * s["lots"]).sum() / s["lots"].sum()}),
    include_groups=False,
).reset_index(drop=True)
# groupby apply with include_groups may drop keys on this pandas; do it manually
rows = []
for key, s in tr.groupby(["dt", "product", "month", "cp", "strike", "code"]):
    lots = float(s["lots"].sum())
    px = float((s["price"] * s["lots"]).sum() / lots)
    rows.append((*key, lots, px, int(s["price"].nunique())))
g = pd.DataFrame(rows, columns=["dt", "product", "month", "cp", "strike", "code", "lots", "px", "nfills"])

print("DAY PRODUCT  side strike lots vwap  prior_fut otm%  prior_settle  vs_settle")
for r in g.sort_values(["dt", "product", "cp", "strike"]).itertuples(index=False):
    src = prev.get(pd.Timestamp(r.dt))
    mkey = base.month_key(r.month)
    fut_px = fut[(fut["dt"] == src) & (fut["product"] == r.product) & (fut["mkey"] == mkey)]
    fpx = float(fut_px["px"].iloc[0]) if len(fut_px) else float("nan")
    if r.cp == "C":
        otm = (r.strike / fpx - 1) * 100 if fpx == fpx and fpx else float("nan")
    else:
        otm = (1 - r.strike / fpx) * 100 if fpx == fpx and fpx else float("nan")
    ps = settle.get((src, r.code), float("nan"))
    vs = (r.px / ps - 1) * 100 if ps == ps and ps else float("nan")
    print(
        pd.Timestamp(r.dt).strftime("%m-%d"), r.product, r.month, r.cp,
        f"{r.strike:.0f}", f"lots{r.lots:.0f}", f"px{r.px:.1f}", f"fills{r.nfills}",
        f"fut{fpx:.0f}" if fpx == fpx else "futna",
        f"otm{otm:.1f}" if otm == otm else "otmna",
        f"set{ps:.1f}" if ps == ps else "setna",
        f"vs{vs:+.1f}%" if vs == vs else "vsna",
    )
