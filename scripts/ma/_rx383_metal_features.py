# -*- coding: utf-8 -*-
"""Features known before the open, for the nonferrous day and name choice."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_metal_model as mm  # noqa: E402
import _rx383_option_strategy_report as base  # noqa: E402
import _rx383_pick_model as pick  # noqa: E402


def main() -> None:
    metal, _full, sells = mm.build()
    data = pick.load()
    pos = data["raw"]["opt_pos"].copy()
    pos["dt"] = pd.to_datetime(pos["dt"]).dt.normalize()
    pos = pos[pos["product"].isin(mm.METALS)]
    short = pos.groupby(["dt", "product"], as_index=False)["short_lots"].sum()
    days = list(sorted(metal["dt"].unique()))
    prev = {days[i]: days[i - 1] for i in range(1, len(days))}
    # position calendar may include days outside the 14
    pos_days = sorted(short["dt"].unique())
    print("pos days", [pd.Timestamp(d).strftime("%m-%d") for d in pos_days if d >= pd.Timestamp("2026-10-01")][:40])
    lookup = {(pd.Timestamp(r.dt), r.product): float(r.short_lots) for r in short.itertuples(index=False)}
    all_pos_days = sorted(set(pos["dt"]).union(days))
    prev_any = {all_pos_days[i]: all_pos_days[i - 1] for i in range(1, len(all_pos_days))}

    print("\nPRIOR SHORTS and yesterday's sell")
    ysold = {(pd.Timestamp(r.dt), r.product): float(r.lots) for r in metal.itertuples(index=False)}
    for d in days:
        src = prev_any.get(d)
        bits = []
        for p in mm.METALS:
            sh = lookup.get((src, p), 0.0) if src is not None else float("nan")
            yday = prev.get(d)
            sold_y = ysold.get((yday, p), 0.0) if yday is not None else 0.0
            today = ysold.get((d, p), 0.0)
            mark = "*" if today else " "
            bits.append(f"{mark}{p}:sh{sh:.0f}/y{sold_y:.0f}")
        print(pd.Timestamp(d).strftime("%m-%d"), " ".join(bits))

    print("\nMONTHS he sold")
    m = sells[sells["product"].isin(mm.METALS)]
    for dt, g in m.groupby("dt"):
        bits = [f"{r.product}{r.month}x{int(r.lots)}" for r in g.itertuples(index=False)]
        print(pd.Timestamp(dt).strftime("%m-%d"), " ".join(bits))


if __name__ == "__main__":
    main()
