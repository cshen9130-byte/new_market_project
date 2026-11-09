# -*- coding: utf-8 -*-
import re
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as rep
import _rx383_expiry_zero as z
import _rx383_option_strategy_report as base
from mom_data_etl import get_conn

fut = z._futures()
print("futures contracts parsed", fut["product"].nunique(), " ".join(sorted(fut["product"].unique())))
opt_sets = sorted(rep._SHFE | rep._DCE | rep._CZCE | rep._GFEX | rep._CFFEX)
print("option rules", len(opt_sets), " ".join(opt_sets))
conn = get_conn()
try:
    raw = base.prof.read_sql(conn, """
        SELECT contract FROM raw_futures_contracts_daily
        WHERE trade_date >= DATE '2025-01-01'
    """)
finally:
    conn.close()
prods = set()
for c in raw["contract"].astype(str).unique():
    s = re.sub(r"\.[A-Za-z]+$", "", c.strip()).upper()
    m = re.fullmatch(r"([A-Z]+?)(\d{3,4})", s)
    if m:
        prods.add(m.group(1))
print("raw futures products", len(prods))
print(" ".join(sorted(prods)))

# full-grid expiry stats, premium = average traded close in the same band
rows = [
    ("call", "in the money", 0.142, 10.15, 12.45),
    ("call", "0-3", 0.663, 1.23, 6.82),
    ("call", "3-7", 0.833, 0.77, 8.03),
    ("call", "7-12", 0.916, 0.53, 10.22),
    ("call", "12-17", 0.952, 0.48, 12.19),
    ("call", "17-25", 0.977, 0.51, 15.06),
    ("call", "25-40", 0.991, 0.26, 19.55),
    ("call", "40-80", 0.994, 0.14, 23.07),
    ("put", "in the money", 0.122, 6.55, 12.68),
    ("put", "0-3", 0.593, 1.36, 5.45),
    ("put", "3-7", 0.775, 0.63, 5.25),
    ("put", "7-12", 0.903, 0.25, 5.24),
    ("put", "12-17", 0.962, 0.27, 4.65),
    ("put", "17-25", 0.991, 0.21, 4.34),
    ("put", "25-40", 0.998, 0.15, 5.35),
    ("put", "40-80", 1.000, 0.05, 0.00),
]
for side, band, w, prem, thru in rows:
    lr = round(1 - w, 3)
    exp = w * prem + lr * (prem - thru)
    print(f"{side} {band}: {w:.3f} x {prem:.2f}% + {lr:.3f} x ({prem:.2f}% - {thru:.2f}%) = {exp:+.2f}%")
