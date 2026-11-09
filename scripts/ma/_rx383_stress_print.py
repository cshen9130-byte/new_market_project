# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as r

f = r.exposure_facts()
prem = f["prem"]
theta = f["theta"]
print("prem", round(prem))
print("theta", round(theta), "vega1", round(f["vega"]), "vol10", round(f["vol10"]))
print("fut1", round(f["fut_1pct"]), "fut10", round(f["fut_1pct"] * 10))
print("opt1", round(f["opt_1pct"]))
print("by sig2 down", [(k, round(v)) for k, v in f["expiry"]["by_sig2_dn"]])
for k, v in f["expiry"].items():
    if not isinstance(v, float):
        continue
    print(f"{k:12} {v:12.0f}  /prem {v / prem:7.2f}  /day {v / theta:6.1f}")
d = f["day"]
print("by sig2 down", [(k, round(v)) for k, v in f["expiry"]["by_sig2_dn"]])
print(d.round(0).to_string())
