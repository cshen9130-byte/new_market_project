# -*- coding: utf-8 -*-
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
print(f"n {len(ret)} mean_ret {ret.mean():.4f} median {np.median(ret):.4f}")
for x in (0, 5, 10, 14, 20, 30):
    call_gap = np.maximum(settle - entry * (1 + x / 100), 0) / entry
    put_gap = np.maximum(entry * (1 - x / 100) - settle, 0) / entry
    call_hit = call_gap > 0
    put_hit = put_gap > 0
    print(
        f"x {x:2d} "
        f"call0 {1 - call_hit.mean():.3f} call_through {call_gap[call_hit].mean():.4f} call_exp {call_gap.mean():.4f} "
        f"put0 {1 - put_hit.mean():.3f} put_through {put_gap[put_hit].mean():.4f} put_exp {put_gap.mean():.4f} "
        f"both0 {(1 - call_hit.mean() - put_hit.mean()):.3f} total { (call_gap + put_gap).mean():.4f} "
        f"ncall {int(call_hit.sum())} nput {int(put_hit.sum())}"
    )
