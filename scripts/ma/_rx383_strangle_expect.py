# -*- coding: utf-8 -*-
"""Realized short-strangle payout by wing distance. No theoretical premium."""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_expiry_zero as z

fut = z._futures()
board = z._settle_map(fut)
entry = board["entry"].to_numpy()
settle = board["settle"].to_numpy()
rows = []
for x in range(0, 41):
    call_k = entry * (1 + x / 100)
    put_k = entry * (1 - x / 100)
    payout = (np.maximum(settle - call_k, 0) + np.maximum(put_k - settle, 0)) / entry
    call0 = settle <= call_k
    put0 = settle >= put_k
    both0 = call0 & put0
    losers = payout[payout > 0]
    rows.append({
        "x": x,
        "call": round(float(call0.mean()), 4),
        "put": round(float(put0.mean()), 4),
        "both": round(float(both0.mean()), 4),
        "avgLoss": None if losers.size == 0 else round(float(losers.mean()), 6),
        "expect": round(float(payout.mean()), 6),
        "nLoss": int(losers.size),
    })
print(json.dumps({"n": int(len(board)), "rows": rows}))
