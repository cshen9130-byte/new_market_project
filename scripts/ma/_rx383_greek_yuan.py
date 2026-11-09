# -*- coding: utf-8 -*-
"""Black-76 yuan risk of the RX383 option book, through 2026-11-03."""
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as rep
import _rx383_option_strategy_report as base
from mom_data_etl import get_conn

END = pd.Timestamp("2026-11-03")
SHOCKS = (-0.08, -0.05, -0.03, -0.01, 0.01, 0.03, 0.05, 0.08)


def _nd(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def greeks(fut, strike, sigma, tenor, cp):
    vol = sigma * math.sqrt(tenor)
    if vol <= 0 or fut <= 0 or strike <= 0:
        return None
    d1 = (math.log(fut / strike) + 0.5 * sigma * sigma * tenor) / vol
    d2 = d1 - vol
    nd1 = _nd(d1)
    if cp == "C":
        price = fut * rep._ncdf(d1) - strike * rep._ncdf(d2)
        delta = rep._ncdf(d1)
    else:
        price = strike * rep._ncdf(-d2) - fut * rep._ncdf(-d1)
        delta = rep._ncdf(d1) - 1.0
    vega = fut * nd1 * math.sqrt(tenor) / 100.0
    theta = -fut * nd1 * sigma / (2.0 * math.sqrt(tenor)) / 365.0
    return price, delta, vega, theta


def main() -> None:
    conn = get_conn()
    try:
        raw = base.load_account(conn)
        opt = base.prof.read_sql(conn, """
            SELECT trade_date::date AS dt, contract, close::float8 AS px, volume::float8 AS volume
            FROM raw_options_contracts_daily
            WHERE trade_date BETWEEN DATE '2026-10-01' AND DATE '2026-11-06'
        """)
        fut = base.prof.read_sql(conn, """
            SELECT trade_date::date AS dt, contract,
                   COALESCE(clear, close)::float8 AS px
            FROM raw_futures_contracts_daily
            WHERE trade_date BETWEEN DATE '2026-10-01' AND DATE '2026-11-06'
        """)
    finally:
        conn.close()
    pos = raw["opt_pos"]
    pos = pos[pos["dt"] <= END].copy()
    trades = raw["opt_trades"]
    trades = trades[trades["dt"] <= END]
    mult = base.multipliers(trades)
    opt["dt"] = pd.to_datetime(opt["dt"])
    opt["code"] = opt["contract"].map(base.norm_code)
    opt["px"] = pd.to_numeric(opt["px"], errors="coerce")
    opt = opt[opt["px"] > 0].sort_values("volume", ascending=False).drop_duplicates(["dt", "code"])
    fut["dt"] = pd.to_datetime(fut["dt"])
    fut["code"] = fut["contract"].map(base.norm_code)
    fut["px"] = pd.to_numeric(fut["px"], errors="coerce")
    fut = fut[fut["px"] > 0].drop_duplicates(["dt", "code"])
    fut_map = {(r.dt, r.code): float(r.px) for r in fut.itertuples(index=False)}
    pos = pos.merge(opt[["dt", "code", "px"]], on=["dt", "code"], how="left")
    pos["mark"] = pos["px"]
    miss = pos["mark"].isna() & (pd.to_numeric(pos["settl"], errors="coerce") > 0)
    pos.loc[miss, "mark"] = pd.to_numeric(pos.loc[miss, "settl"], errors="coerce")
    both = (pos["long_lots"].fillna(0) > 0) & (pos["short_lots"].fillna(0) > 0)
    pos = pos.loc[~both].copy()
    pos["lots"] = pos["long_lots"].fillna(0) + pos["short_lots"].fillna(0)
    pos["qty"] = np.where(pos["short_lots"].fillna(0) > 0, -pos["lots"], pos["lots"])
    rows = []
    skipped = {"no_px": 0.0, "no_fut": 0.0, "no_exp": 0.0, "iv": 0.0}
    for r in pos.itertuples(index=False):
        lots = float(r.lots)
        mark = float(r.mark) if pd.notna(r.mark) else float("nan")
        if not (mark > 0):
            skipped["no_px"] += lots
            continue
        fpx = None
        for k in base.fut_lookup_keys(r.product, r.month):
            fpx = fut_map.get((r.dt, k))
            if fpx:
                break
        if not fpx:
            skipped["no_fut"] += lots
            skipped.setdefault("nofut_prod", {})
            skipped["nofut_prod"][r.product] = skipped["nofut_prod"].get(r.product, 0.0) + lots
            continue
        exp = rep.option_expiry(r.product, r.month)
        if exp is None:
            skipped["no_exp"] += lots
            continue
        dte = (pd.Timestamp(exp).date() - pd.Timestamp(r.dt).date()).days
        if dte < 2:
            skipped["no_exp"] += lots
            continue
        tenor = dte / 365.0
        sigma = rep._implied_vol(fpx, float(r.strike), tenor, mark, r.cp)
        if not (0.02 < sigma < 3.0):
            skipped["iv"] += lots
            continue
        g = greeks(fpx, float(r.strike), sigma, tenor, r.cp)
        if g is None:
            skipped["iv"] += lots
            continue
        _model, delta, vega, theta = g
        m = float(mult.get(r.product, float("nan")))
        if not math.isfinite(m):
            skipped["iv"] += lots
            continue
        qty = float(r.qty)
        shock = {}
        for s in SHOCKS:
            moved = greeks(fpx * (1.0 + s), float(r.strike), sigma, tenor, r.cp)
            full = qty * (moved[0] - _model) * m
            delta_yuan = qty * delta * (fpx * s) * m
            shock[s] = full - delta_yuan
        rows.append({
            "dt": r.dt, "product": r.product, "cp": r.cp, "lots": lots, "qty": qty,
            "delta_lots": qty * delta,
            "delta_1pct": qty * delta * (fpx * 0.01) * m,
            "theta_yuan": qty * theta * m,
            "vega_yuan": qty * vega * m,
            "short": qty < 0,
            **{f"s{int(s*100)}": shock[s] for s in SHOCKS},
        })
    df = pd.DataFrame(rows)
    print("skipped lots", skipped, "priced lots", float(df["lots"].sum()), "rows", len(df))
    day = df.groupby("dt").agg(theta=("theta_yuan", "sum"), vega=("vega_yuan", "sum"), lots=("lots", "sum"), delta=("delta_lots", "sum"))
    print(day.to_string())
    print("median theta", float(day["theta"].median()), "median vega", float(day["vega"].median()))
    short = df[df["short"]].groupby("dt")[["theta_yuan", "vega_yuan"]].sum()
    long = df[~df["short"]].groupby("dt")[["theta_yuan", "vega_yuan"]].sum()
    print("short theta median", float(short["theta_yuan"].median()), "long", float(long["theta_yuan"].median()) if len(long) else None)
    print("short vega median", float(short["vega_yuan"].median()), "long", float(long["vega_yuan"].median()) if len(long) else None)
    last = df["dt"].max()
    sub = df[df["dt"] == last]
    by = sub.groupby("product").agg(opt=("delta_lots", "sum"), lots=("lots", "sum"), theta=("theta_yuan", "sum"), vega=("vega_yuan", "sum"))
    fp = raw["fut_pos"].copy()
    fp["dt"] = pd.to_datetime(fp["dt"])
    fp = fp[fp["dt"] == last]
    fp = fp.loc[fp["contract"].map(lambda c: base.parse_contract(c) is None)].copy()
    fp["product"] = fp["contract"].map(base.prof.product_code)
    fp["net"] = fp["long_lots"].fillna(0) - fp["short_lots"].fillna(0)
    fut_net = fp.groupby("product")["net"].sum()
    by["fut"] = fut_net
    print("LAST", last.date())
    print(by.sort_values("lots", ascending=False).to_string())
    print("nofut", skipped.get("nofut_prod"))
    print("option delta sum", float(sub["delta_lots"].sum()), "delta +1% yuan", float(sub["delta_1pct"].sum()), "lots", float(sub["lots"].sum()))
    print("gamma-only shocks")
    sc = [c for c in ("s-8", "s-5", "s-3", "s-1", "s1", "s3", "s5", "s8") if c in sub.columns]
    print(sub[sc].sum().to_string())
    # futures 1% yuan on the last day
    last_px = {}
    for r in fut[fut["dt"] == last].itertuples(index=False):
        last_px[r.code] = float(r.px)
    print("futures 1% ")
    for prod, net in fut_net.items():
        # pick the contract with a price
        cands = fp[fp["product"] == prod]
        yuan = 0.0
        for c in cands.itertuples(index=False):
            px = last_px.get(base.norm_code(c.contract))
            m = float(mult.get(prod, float("nan")))
            if px and math.isfinite(m):
                yuan += float(c.net) * px * 0.01 * m
        print(prod, "lots", float(net), "yuan per +1%", yuan)


if __name__ == "__main__":
    main()
