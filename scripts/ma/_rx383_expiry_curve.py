# -*- coding: utf-8 -*-
"""Finish-at-zero rate by wing distance, 20 sessions before expiry."""
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
xs = list(range(0, 41))
rows = []
for x in xs:
    call = float(np.mean(settle <= entry * (1 + x / 100)))
    put = float(np.mean(settle >= entry * (1 - x / 100)))
    rows.append({"x": x, "call": round(call, 4), "put": round(put, 4)})
print(json.dumps({"n": int(len(board)), "rows": rows}))
