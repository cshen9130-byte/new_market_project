# -*- coding: utf-8 -*-
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as rep

end = pd.Timestamp("2026-11-03")
conn = rep.get_conn()
try:
    trades = rep.base.load_account(conn)["opt_trades"]
finally:
    conn.close()
structure = rep.structure_by_sector(trades[pd.to_datetime(trades["dt"]) <= end])
print(structure.pivot(index="sector", columns="kind", values="sell").fillna(0).round(0).to_string())
print("totals", structure.groupby("kind")["sell"].sum().round(0).to_dict(), "all", structure["sell"].sum())
facts = rep.exposure_facts()
g = facts["by_sector"]
print(g.round(0).to_string())
print("sum dn15", g["dn15"].sum(), "expiry", facts["expiry"]["dn15"])
print("sum vol10", g["vol10"].sum(), "facts", facts["vol10"])
print("sum theta", g["theta_yuan"].sum(), "facts", facts["theta"])
print("sum d1", g["delta_1pct"].sum(), "facts", facts["opt_1pct"])
paths = rep._sector_link_charts(structure, g)
print(paths)
