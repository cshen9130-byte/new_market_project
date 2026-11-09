# -*- coding: utf-8 -*-
"""Black risk-neutral chance of finishing at zero, at each contract's ATM vol."""
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_expiry_zero as z
import _rx383_option_strategy_report as base
from mom_data_etl import get_conn

T = 20 / 252


def phi(v: float) -> float:
    return 0.5 * (1.0 + math.erf(v / math.sqrt(2.0)))


def rn_call(x: float, sig: float) -> float:
    s = sig * math.sqrt(T)
    lnkf = math.log(1 + x / 100)
    return phi((lnkf + 0.5 * sig * sig * T) / s)


def rn_put(x: float, sig: float) -> float:
    s = sig * math.sqrt(T)
    lnkf = math.log(1 - x / 100)
    return phi(-(lnkf + 0.5 * sig * sig * T) / s)


fut = z._futures()
board = z._settle_map(fut)
conn = get_conn()
try:
    iv = base.prof.read_sql(conn, """
        SELECT trade_date::date AS dt, LOWER(underlying_key) AS product, iv::float8 AS iv
        FROM raw_commodity_option_iv_daily
        WHERE trade_date >= DATE '2025-01-01'
    """)
finally:
    conn.close()
iv["dt"] = pd.to_datetime(iv["dt"])
iv["product"] = iv["product"].str.upper()
iv["iv"] = pd.to_numeric(iv["iv"], errors="coerce")
print("iv rows", len(iv), "median", float(iv["iv"].median()), "span", iv["dt"].min().date(), iv["dt"].max().date())

board = board.copy()
board["entry_dt"] = pd.to_datetime(board["entry_dt"])
iv = iv.dropna(subset=["iv"]).sort_values("dt")
# last print on or before the entry, within 5 days
matched = []
for r in board.itertuples(index=False):
    sub = iv[(iv["product"] == r.product) & (iv["dt"] <= r.entry_dt) & (iv["dt"] >= r.entry_dt - pd.Timedelta(days=5))]
    if sub.empty:
        matched.append(np.nan)
    else:
        matched.append(float(sub.iloc[-1]["iv"]))
board["iv"] = matched
use = board.dropna(subset=["iv"]).copy()
# stored as percent or decimal
med = float(use["iv"].median())
if med > 3:
    use["sig"] = use["iv"] / 100
else:
    use["sig"] = use["iv"]
use = use[(use["sig"] > 0.02) & (use["sig"] < 2)]
print("matched", len(use), "of", len(board), "median vol", round(float(use["sig"].median()) * 100, 1))

xs = list(range(0, 41))
rows = []
sigs = use["sig"].to_numpy()
entry = use["entry"].to_numpy()
settle = use["settle"].to_numpy()
for x in xs:
    call_r = float(np.mean(settle <= entry * (1 + x / 100)))
    put_r = float(np.mean(settle >= entry * (1 - x / 100)))
    call_q = float(np.mean([rn_call(x, s) for s in sigs]))
    put_q = float(np.mean([rn_put(x, s) for s in sigs]))
    rows.append({
        "x": x,
        "call": round(call_r, 4),
        "put": round(put_r, 4),
        "call_rn": round(call_q, 4),
        "put_rn": round(put_q, 4),
    })
print(json.dumps({"n": int(len(use)), "vol": round(float(use["sig"].median()) * 100, 1), "rows": rows}))
