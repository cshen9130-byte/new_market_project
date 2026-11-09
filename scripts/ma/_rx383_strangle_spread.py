# -*- coding: utf-8 -*-
"""Spread of realized strangle payouts at a few distances."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_expiry_zero as z

fut = z._futures()
board = z._settle_map(fut)
entry = board["entry"].to_numpy()
settle = board["settle"].to_numpy()
ret = settle / entry - 1
print("return p50", round(float(np.median(ret)), 4), "p10", round(float(np.quantile(ret, 0.1)), 4), "p90", round(float(np.quantile(ret, 0.9)), 4))
for x in (0, 5, 10, 14, 20, 30):
    call_k = entry * (1 + x / 100)
    put_k = entry * (1 - x / 100)
    payout = (np.maximum(settle - call_k, 0) + np.maximum(put_k - settle, 0)) / entry
    losers = np.sort(payout[payout > 0])
    print(
        f"x={x:2d} mean {payout.mean():.4f} median {np.median(payout):.4f} "
        f"zero {(payout == 0).mean():.3f} nloss {losers.size} "
        f"loss_p50 {np.median(losers):.4f} loss_p90 {np.quantile(losers, 0.9):.4f} loss_max {losers[-1]:.4f}"
    )
