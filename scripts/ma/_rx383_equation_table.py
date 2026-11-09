# -*- coding: utf-8 -*-
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_expiry_zero as z

P = 0.01
fut = z._futures()
board = z._settle_map(fut)
entry = board["entry"].to_numpy()
settle = board["settle"].to_numpy()
n = len(entry)
print("n", n)
for x in (0, 5, 10, 14, 20, 30):
    call_gap = np.maximum(settle - entry * (1 + x / 100), 0) / entry
    put_gap = np.maximum(entry * (1 - x / 100) - settle, 0) / entry
    total = call_gap + put_gap
    for name, gap in (("call", call_gap), ("put", put_gap), ("both", total)):
        win = gap == 0
        w = float(win.mean())
        loss = gap[~win]
        thru = float(loss.mean()) if loss.size else 0.0
        lr = 1 - w
        t1 = w * P
        t2 = lr * (P - thru)
        exp = t1 + t2
        print(
            f"{x:2d} {name:4s} win {w:.6f} loss {lr:.6f} thru {thru:.6f} "
            f"net {P - thru:.6f} t1 {t1:.6f} t2 {t2:.6f} exp {exp:.6f} "
            f"check {P - gap.mean():.6f} nloss {loss.size}"
        )
