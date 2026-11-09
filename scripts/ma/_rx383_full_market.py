# -*- coding: utf-8 -*-
"""Expiry result of a full strike grid, sold every trading day.

The premium is not observed for an untraded strike, so the result is the
amount the seller pays at expiry, as a percent of the futures price on the
sale day.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as rep
import _rx383_expiry_zero as z
import _rx383_option_strategy_report as base
from mom_data_etl import get_conn

EDGES = [-20, 0, 3, 7, 12, 17, 25, 40, 80]
# How far around the futures price the grid runs, and the sale window.
LOW, HIGH = 0.70, 1.40
MIN_DTE, MAX_DTE = 5, 80


def infer_steps() -> dict[str, float]:
    conn = get_conn()
    try:
        df = base.prof.read_sql(conn, """
            SELECT contract FROM raw_options_contracts_daily
            WHERE trade_date >= DATE '2025-01-01'
        """)
    finally:
        conn.close()
    parsed = df["contract"].map(base.parse_contract)
    df = df.loc[parsed.notna()].copy()
    info = pd.DataFrame(list(parsed.loc[df.index]))
    info.index = df.index
    df["product"] = info["product"].str.upper()
    df["strike"] = pd.to_numeric(info["strike"], errors="coerce")
    steps = {}
    for product, g in df.dropna(subset=["strike"]).groupby("product"):
        strikes = np.unique(np.sort(g["strike"].to_numpy()))
        if len(strikes) < 2:
            continue
        d = np.diff(strikes)
        d = d[d > 0]
        if len(d) == 0:
            continue
        # the exchange step is the smallest gap that accounts for most neighbours
        step = float(np.median(d))
        if step > 0:
            steps[product] = step
    return steps


def grid(price: float, step: float) -> np.ndarray:
    lo = np.floor(price * LOW / step) * step
    hi = np.ceil(price * HIGH / step) * step
    if hi < lo:
        return np.array([])
    n = int(round((hi - lo) / step)) + 1
    if n > 400:
        return np.array([])
    return lo + step * np.arange(n)


def main() -> None:
    steps = infer_steps()
    print("inferred steps", len(steps))
    for p in sorted(steps):
        print(f"  {p} {steps[p]:g}")
    fut = z._futures()
    fut["mkey"] = [base.month_key(m) for m in fut["month"]]
    # one frame per futures expiry
    sales = []
    covered = set()
    skipped = []
    for (product, mkey), g in fut.groupby(["product", "mkey"], sort=False):
        step = steps.get(product)
        month = str(g["month"].iloc[0])
        exp = rep.option_expiry(product, month)
        if exp is None or step is None:
            if exp is not None and step is None:
                skipped.append(product)
            continue
        exp_ts = pd.Timestamp(exp)
        g = g.sort_values("dt")
        on = g[g["dt"] <= exp_ts]
        if on.empty or (exp_ts - on.iloc[-1]["dt"]).days > 7:
            continue
        settle = float(on.iloc[-1]["px"])
        life = g[(g["dt"] < exp_ts - pd.Timedelta(days=MIN_DTE)) & (g["dt"] >= exp_ts - pd.Timedelta(days=MAX_DTE))]
        if life.empty:
            continue
        # every trading day in the window
        take = life
        covered.add(product)
        for row in take.itertuples(index=False):
            ks = grid(float(row.px), step)
            if len(ks) == 0:
                continue
            call_gap = np.maximum(settle - ks, 0) / float(row.px)
            put_gap = np.maximum(ks - settle, 0) / float(row.px)
            call_dist = ks / float(row.px) - 1
            put_dist = 1 - ks / float(row.px)
            sales.append((product, call_dist, call_gap, put_dist, put_gap))
    print("products with a step and a sale", len(covered), " ".join(sorted(covered)))
    print("option products with no inferred step", " ".join(sorted(set(skipped))))
    # flatten
    products, cd, cg, pd_, pg = [], [], [], [], []
    for product, call_dist, call_gap, put_dist, put_gap in sales:
        products.append(np.full(len(call_dist), product))
        cd.append(call_dist)
        cg.append(call_gap)
        pd_.append(put_dist)
        pg.append(put_gap)
    product = np.concatenate(products)
    dist = np.concatenate([np.concatenate(cd), np.concatenate(pd_)])
    gap = np.concatenate([np.concatenate(cg), np.concatenate(pg)])
    side = np.concatenate([np.full(sum(len(x) for x in cd), "call"), np.full(sum(len(x) for x in pd_), "put")])
    prod = np.concatenate([product, product])
    print("sales", len(dist))
    labels = ["ITM", "0-3", "3-7", "7-12", "12-17", "17-25", "25-40", "40-80"]
    bins = pd.cut(dist * 100, EDGES, labels=labels, right=False)
    frame = pd.DataFrame({"side": side, "bin": bins, "gap": gap, "product": prod})
    frame = frame.dropna(subset=["bin"])
    # traded-close premium in the same distance band, percent of the futures price
    prem = {
        ("call", "ITM"): 10.15, ("call", "0-3"): 1.23, ("call", "3-7"): 0.77, ("call", "7-12"): 0.53,
        ("call", "12-17"): 0.48, ("call", "17-25"): 0.51, ("call", "25-40"): 0.26, ("call", "40-80"): 0.14,
        ("put", "ITM"): 6.55, ("put", "0-3"): 1.36, ("put", "3-7"): 0.63, ("put", "7-12"): 0.25,
        ("put", "12-17"): 0.27, ("put", "17-25"): 0.21, ("put", "25-40"): 0.15, ("put", "40-80"): 0.05,
    }
    for (name, b), g in frame.groupby(["side", "bin"], observed=True):
        win = g["gap"] <= 0
        w = float(f"{float(win.mean()):.3f}")
        thru = float(g.loc[~win, "gap"].mean()) * 100 if (~win).any() else 0.0
        thru_r = float(f"{thru:.2f}")
        lr = float(f"{1 - w:.3f}")
        p = prem[(name, str(b))]
        exp = w * p + lr * (p - thru_r)
        prods = " ".join(sorted(g["product"].unique()))
        print(
            f"{name:4s} {str(b):8s} n {len(g):8d} prod {g['product'].nunique():2d} "
            f"{w:.3f} x {p:.2f}% + {lr:.3f} x ({p:.2f}% - {thru_r:.2f}%) = {exp:+.2f}% | {prods}"
        )


if __name__ == "__main__":
    main()
