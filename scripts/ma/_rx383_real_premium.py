# -*- coding: utf-8 -*-
"""Real traded premium 20 sessions before expiry, and the same contract's expiry result."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_expiry_zero as z
import _rx383_option_strategy_report as base
from mom_data_etl import get_conn

TARGETS = (0, 5, 10, 14, 20, 30)
BAND = 1.5  # percentage points: a listed strike must sit this close to the target


def load_opts() -> pd.DataFrame:
    conn = get_conn()
    try:
        df = base.prof.read_sql(conn, """
            SELECT trade_date::date AS dt, contract,
                   close::float8 AS px, volume::float8 AS vol
            FROM raw_options_contracts_daily
            WHERE trade_date >= DATE '2025-01-01'
              AND close > 0
              AND volume > 0
        """)
    finally:
        conn.close()
    parsed = df["contract"].map(base.parse_contract)
    df = df.loc[parsed.notna()].copy()
    info = pd.DataFrame(list(parsed.loc[df.index]))
    info.index = df.index
    df["product"] = info["product"].str.upper()
    df["month"] = info["month"].astype(str)
    df["cp"] = info["cp"]
    df["strike"] = pd.to_numeric(info["strike"], errors="coerce")
    df["mkey"] = df["month"].map(base.month_key)
    df["dt"] = pd.to_datetime(df["dt"])
    return df.dropna(subset=["strike", "px"])


def main() -> None:
    fut = z._futures()
    board = z._settle_map(fut)
    board["mkey"] = [base.month_key(m) for m in board["month"]]
    board["entry_dt"] = pd.to_datetime(board["entry_dt"])
    print("board", len(board), "products", board["product"].nunique())
    opts = load_opts()
    print("traded option rows", len(opts), "days", opts["dt"].nunique(), "span", opts["dt"].min().date(), opts["dt"].max().date())
    # futures price on the option's own day, so the distance is vs that day's futures
    px = fut.copy()
    px["mkey"] = [base.month_key(m) for m in px["month"]]
    px = px.rename(columns={"px": "fut"})
    opt = opts.merge(px[["dt", "product", "mkey", "fut"]], on=["dt", "product", "mkey"], how="inner")
    opt = opt[opt["fut"] > 0]
    opt["dist"] = np.where(opt["cp"] == "C", opt["strike"] / opt["fut"] - 1, 1 - opt["strike"] / opt["fut"])
    opt["prem"] = opt["px"] / opt["fut"]
    # keep quotes that are a recognizable premium, not a 2-point print on a 100000 future
    opt = opt[(opt["prem"] > 0.0002) & (opt["prem"] < 0.30) & (opt["dist"] > -0.05) & (opt["dist"] < 0.50)]
    print("joined quotes", len(opt), "contracts", opt.groupby(["product", "mkey", "cp", "strike"]).ngroups)
    # attach expiry settlement of that futures
    sett = board[["product", "mkey", "expiry", "entry_dt", "settle"]].drop_duplicates(["product", "mkey"])
    opt = opt.merge(sett, on=["product", "mkey"], how="inner")
    # the quote must be the one from the 20-session entry day, within 3 calendar days
    opt = opt[(opt["dt"] - opt["entry_dt"]).abs() <= pd.Timedelta(days=3)]
    print("quotes on the entry day", len(opt), "names", opt.groupby(["product", "mkey"]).ngroups)
    rows = []
    for x in TARGETS:
        for cp, name in (("C", "call"), ("P", "put")):
            g = opt[opt["cp"] == cp].copy()
            g["miss"] = (g["dist"] * 100 - x).abs()
            g = g[g["miss"] <= BAND]
            # one quote per product-month: the strike closest to the target
            g = g.sort_values("miss").groupby(["product", "mkey"], as_index=False).first()
            if g.empty:
                print(x, name, "none")
                continue
            if cp == "C":
                gap = np.maximum(g["settle"] - g["strike"], 0) / g["fut"]
            else:
                gap = np.maximum(g["strike"] - g["settle"], 0) / g["fut"]
            win = gap <= 0
            w = float(win.mean())
            thru = float(gap[~win].mean()) if (~win).any() else 0.0
            prem = float(g["prem"].median())
            prem_mean = float(g["prem"].mean())
            rows.append(g.assign(x=x, name=name, gap=gap))
            lr = 1 - w
            net = prem_mean - thru
            t1 = w * prem_mean
            t2 = lr * net
            print(
                f"{x:2d} {name:4s} n {len(g):3d}  "
                f"{w:.3f} x {prem_mean*100:.2f}% + {lr:.3f} x ({prem_mean*100:.2f}% - {thru*100:.2f}%) "
                f"= {((t1 + t2)*100):+.2f}%"
            )
    book = pd.concat(rows, ignore_index=True)
    print("PAIR same product")
    for x in TARGETS:
        c = book[(book["x"] == x) & (book["name"] == "call")]
        p = book[(book["x"] == x) & (book["name"] == "put")]
        m = c.merge(p, on=["product", "mkey"], suffixes=("_c", "_p"))
        if m.empty:
            print(x, "none")
            continue
        gap = m["gap_c"] + m["gap_p"]
        prem = m["prem_c"] + m["prem_p"]
        win = gap <= 0
        w = float(win.mean())
        thru = float(gap[~win].mean()) if (~win).any() else 0.0
        pm = float(prem.mean())
        lr = 1 - w
        print(
            f"{x:2d} both n {len(m):3d}  "
            f"{w:.3f} x {pm*100:.2f}% + {lr:.3f} x ({pm*100:.2f}% - {thru*100:.2f}%) "
            f"= {((w * pm + lr * (pm - thru))*100):+.2f}%"
        )
    # a few raw prints so the premium unit can be checked
    sample = opt[(opt["product"] == "CU") & (opt["cp"] == "C")].sort_values("dt")
    if len(sample):
        s = sample.iloc[len(sample) // 2]
        print("sample", s["product"], s["month"], s["cp"], int(s["strike"]), "px", round(s["px"], 2), "fut", round(s["fut"], 1), "prem", round(s["prem"], 4), "dist", round(s["dist"], 3))


if __name__ == "__main__":
    main()
