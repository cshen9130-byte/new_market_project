# -*- coding: utf-8 -*-
"""Every traded option we can follow to expiry. One quote per contract."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_expiry_zero as z
import _rx383_option_strategy_report as base
from mom_data_etl import get_conn

# bins of strike distance, percent. The last edge is open.
EDGES = [-20, 0, 3, 7, 12, 17, 25, 40, 80]


def load_opts() -> pd.DataFrame:
    conn = get_conn()
    try:
        df = base.prof.read_sql(conn, """
            SELECT trade_date::date AS dt, contract,
                   close::float8 AS px, volume::float8 AS vol
            FROM raw_options_contracts_daily
            WHERE trade_date >= DATE '2025-01-01'
              AND close > 0
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
    df["vol"] = pd.to_numeric(df["vol"], errors="coerce").fillna(0)
    return df.dropna(subset=["strike", "px"])


def main() -> None:
    import _rx383_combined_report as rep

    fut = z._futures()
    fut["mkey"] = [base.month_key(m) for m in fut["month"]]
    # settlement is the last futures print on or before the option expiry, for every contract
    sett_rows = []
    for (product, mkey), g in fut.groupby(["product", "mkey"], sort=False):
        month = str(g["month"].iloc[0])
        exp = rep.option_expiry(product, month)
        if exp is None:
            continue
        exp_ts = pd.Timestamp(exp)
        on = g[g["dt"] <= exp_ts].sort_values("dt")
        if on.empty or (exp_ts - on.iloc[-1]["dt"]).days > 7:
            continue
        # 20 sessions before expiry, when that history exists
        before = g[g["dt"] < exp_ts].sort_values("dt")
        entry_dt = before.iloc[-20]["dt"] if len(before) >= 20 else before.iloc[0]["dt"] if len(before) else exp_ts
        sett_rows.append({
            "product": product, "mkey": mkey, "expiry": exp_ts,
            "entry_dt": pd.Timestamp(entry_dt), "settle": float(on.iloc[-1]["px"]),
        })
    sett = pd.DataFrame(sett_rows)
    print("futures with an expiry settlement", len(sett), "products", sett["product"].nunique(),
          "expiry", sett["expiry"].min().date(), "to", sett["expiry"].max().date())

    opts = load_opts()
    print("option rows", len(opts), "with volume", int((opts["vol"] > 0).sum()),
          "span", opts["dt"].min().date(), opts["dt"].max().date())
    px = fut.copy()
    px["mkey"] = [base.month_key(m) for m in px["month"]]
    opt = opts.merge(px[["dt", "product", "mkey", "px"]].rename(columns={"px": "fut"}),
                     on=["dt", "product", "mkey"], how="inner")
    opt = opt.merge(sett, on=["product", "mkey"], how="inner")
    opt = opt[(opt["fut"] > 0) & (opt["dt"] < opt["expiry"])]
    opt["dist"] = np.where(opt["cp"] == "C", opt["strike"] / opt["fut"] - 1, 1 - opt["strike"] / opt["fut"])
    opt["prem"] = opt["px"] / opt["fut"]
    print("quotes with a futures price and an expiry", len(opt),
          "distinct contracts", opt.groupby(["product", "mkey", "cp", "strike"]).ngroups,
          "products", opt["product"].nunique())
    sane = (opt["prem"] > 0.0002) & (opt["prem"] < 0.50)
    print("dropped as an implausible premium", int((~sane).sum()))
    opt = opt[sane]
    opt["dte"] = (opt["expiry"] - opt["dt"]).dt.days
    # one sale per contract: the traded day closest to 20 sessions before expiry
    traded = opt[opt["vol"] > 0].copy()
    traded["miss"] = (traded["dt"] - traded["entry_dt"]).abs()
    one = traded.sort_values(["miss", "vol"], ascending=[True, False])
    one = one.groupby(["product", "mkey", "cp", "strike"], as_index=False).first()
    print("contracts with a traded close and an expiry", len(one),
          "products", one["product"].nunique(),
          "expiries", one.groupby(["product", "mkey"]).ngroups)
    have = set(one["product"].unique())
    missing = sorted(set(sett["product"]) - have)
    print("products", " ".join(sorted(have)))
    print("futures products with no traded option close", len(missing), " ".join(missing))
    print("quote dates", one["dt"].min().date(), one["dt"].max().date(),
          "expiries", one["expiry"].min().date(), one["expiry"].max().date(),
          "median days to expiry", int(one["dte"].median()),
          "days", int(one["dte"].min()), int(one["dte"].max()))
    one["bin"] = pd.cut(one["dist"] * 100, EDGES, right=False)
    print("contracts outside the distance bins", int(one["bin"].isna().sum()))
    for (cp, b), g in one.groupby(["cp", "bin"], observed=True):
        if cp == "C":
            gap = np.maximum(g["settle"] - g["strike"], 0) / g["fut"]
        else:
            gap = np.maximum(g["strike"] - g["settle"], 0) / g["fut"]
        win = gap <= 0
        w = float(win.mean())
        thru = float(gap[~win].mean()) if (~win).any() else 0.0
        pm = float(g["prem"].mean())
        lr = 1 - w
        name = "call" if cp == "C" else "put"
        prods = " ".join(sorted(g["product"].unique()))
        print(
            f"{name:4s} {str(b):10s} n {len(g):4d} prod {g['product'].nunique():2d} "
            f"dte {int(g['dte'].median()):3d} "
            f"{w:.3f} x {pm*100:.2f}% + {lr:.3f} x ({pm*100:.2f}% - {thru*100:.2f}%) "
            f"= {((w * pm + lr * (pm - thru)) * 100):+.2f}%"
        )
        print("     ", prods)


if __name__ == "__main__":
    main()
