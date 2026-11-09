# -*- coding: utf-8 -*-
"""Sign of RX383's option book: delta, theta, vega, gamma. Read only."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_option_strategy_report as base
from mom_data_etl import get_conn

END = pd.Timestamp("2026-11-03")


def main() -> None:
    conn = get_conn()
    try:
        pos = base.parse_side(base.prof.read_sql(conn, f"""
            SELECT "交易日期"::date AS dt, "合约" AS contract,
                   {base.prof.num_sql("买持仓")} AS long_lots,
                   {base.prof.num_sql("卖持仓")} AS short_lots
            FROM mom_options_position_details
            WHERE LOWER(TRIM("账户")) = %s
        """, (base.ACCOUNT,)))
        fut = base.prof.read_sql(conn, f"""
            SELECT "交易日期"::date AS dt, "合约" AS contract,
                   {base.prof.num_sql("买持仓")} AS long_lots,
                   {base.prof.num_sql("卖持仓")} AS short_lots
            FROM mom_position_details
            WHERE LOWER(TRIM("账户")) = %s
        """, (base.ACCOUNT,))
        g = base.prof.read_sql(conn, """
            SELECT trade_date::date AS dt, contract,
                   delta::float8 AS delta, em_delta::float8 AS em_delta,
                   gamma::float8 AS gamma, em_gamma::float8 AS em_gamma,
                   theta::float8 AS theta, em_theta::float8 AS em_theta,
                   vega::float8 AS vega, em_vega::float8 AS em_vega
            FROM raw_options_contracts_daily
            WHERE trade_date BETWEEN DATE '2026-10-01' AND DATE '2026-11-06'
        """)
    finally:
        conn.close()
    pos["dt"] = pd.to_datetime(pos["dt"])
    pos = pos[pos["dt"] <= END].copy()
    print("option pos", pos["dt"].min().date(), pos["dt"].max().date(), "rows", len(pos))
    g["dt"] = pd.to_datetime(g["dt"])
    g["code"] = g["contract"].map(base.norm_code)
    for col in ("delta", "em_delta", "gamma", "em_gamma", "theta", "em_theta", "vega", "em_vega"):
        g[col] = pd.to_numeric(g[col], errors="coerce")
    # delta scale
    dlt = g["delta"].where(g["delta"].notna(), g["em_delta"])
    med = float(dlt.abs().median())
    print("delta abs median raw", med)
    if med > 2:
        g["delta_u"] = dlt / 100.0
    else:
        g["delta_u"] = dlt
    for src, dst in (("gamma", "gamma_u"), ("em_gamma", "em_gamma_u"), ("theta", "theta_u"), ("em_theta", "em_theta_u"), ("vega", "vega_u"), ("em_vega", "em_vega_u")):
        g[dst] = g[src]
    g = g.drop_duplicates(["dt", "code"])
    m = pos.merge(g, on=["dt", "code"], how="left")
    m["lots"] = m["long_lots"].fillna(0) + m["short_lots"].fillna(0)
    known = m["delta_u"].notna()
    print("lots", float(m["lots"].sum()), "delta known lots", float(m.loc[known, "lots"].sum()))
    # position sign: long +, short -
    m["sign"] = np.where(m["short_lots"].fillna(0) > 0, -1.0, 1.0)
    # if both long and short on same row, skip those
    both = (m["long_lots"].fillna(0) > 0) & (m["short_lots"].fillna(0) > 0)
    print("both sides rows", int(both.sum()))
    m = m.loc[~both].copy()
    m["net_lots"] = m["sign"] * m["lots"]
    for name in ("delta_u", "gamma_u", "theta_u", "vega_u"):
        raw = m[name]
        # fallback em
        if name == "gamma_u":
            raw = raw.where(raw.notna(), m["em_gamma_u"])
        if name == "theta_u":
            raw = raw.where(raw.notna(), m["em_theta_u"])
        if name == "vega_u":
            raw = raw.where(raw.notna(), m["em_vega_u"])
        m[name] = raw
        covered = raw.notna()
        print(f"\n{name} cover lots {m.loc[covered, 'lots'].sum():.0f} / {m['lots'].sum():.0f}")
        if name != "delta_u":
            long_opt = m.loc[covered & (m["sign"] > 0), name]
            short_opt = m.loc[covered & (m["sign"] < 0), name]
            print("  long-option median", float(long_opt.median()) if len(long_opt) else None, "n", len(long_opt))
            print("  short-option median", float(short_opt.median()) if len(short_opt) else None, "n", len(short_opt))
        m["contrib"] = m["net_lots"] * m[name]
        day = m.dropna(subset=["contrib"]).groupby("dt")["contrib"].sum()
        print("  daily net median", float(day.median()) if len(day) else None, "share positive", float((day > 0).mean()) if len(day) else None, "days", len(day))
        # by product-day sign
        prod = m.dropna(subset=["contrib"]).groupby(["dt", "product"])["contrib"].sum()
        print("  product-days", len(prod), "positive share", float((prod > 0).mean()) if len(prod) else None)

    # delta split: short calls vs short puts vs long options, futures-equivalent
    m["dcontrib"] = m["net_lots"] * m["delta_u"]
    sub = m.dropna(subset=["dcontrib"])
    print("\nDELTA by side")
    for label, mask in (
        ("short call", (sub["sign"] < 0) & (sub["cp"] == "C")),
        ("short put", (sub["sign"] < 0) & (sub["cp"] == "P")),
        ("long call", (sub["sign"] > 0) & (sub["cp"] == "C")),
        ("long put", (sub["sign"] > 0) & (sub["cp"] == "P")),
    ):
        g = sub.loc[mask]
        print(f"  {label} lots {g['lots'].sum():.0f} delta-lots sum {g['dcontrib'].sum():.1f} |delta| lot-median {np.average(g['delta_u'].abs(), weights=g['lots']) if g['lots'].sum() else float('nan'):.3f}")
    day_d = sub.groupby("dt")["dcontrib"].sum()
    print("daily net option delta median", float(day_d.median()), "mean", float(day_d.mean()), "abs median", float(day_d.abs().median()))
    gross = sub.groupby("dt")["lots"].sum()
    print("daily |net delta| / gross lots median", float((day_d.abs() / gross).median()))
    # within product, |net delta| vs gross
    pg = sub.groupby(["dt", "product"]).agg(net=("dcontrib", "sum"), lots=("lots", "sum"))
    sides = sub.groupby(["dt", "product", "cp"])["lots"].sum().unstack(fill_value=0)
    pg = pg.join(sides)
    pg = pg[pg["lots"] > 0]
    both_side = (pg.get("C", 0) > 0) & (pg.get("P", 0) > 0)
    print("product-days both", int(both_side.sum()), "one", int((~both_side).sum()))
    ratio = pg["net"].abs() / pg["lots"]
    print("both |net|/lots median", float(ratio[both_side].median()) if both_side.any() else None, "p90", float(ratio[both_side].quantile(0.9)) if both_side.any() else None)
    print("one |net|/lots median", float(ratio[~both_side].median()) if (~both_side).any() else None, "p90", float(ratio[~both_side].quantile(0.9)) if (~both_side).any() else None)
    print("product-day |net delta|/lots median", float(ratio.median()), "p90", float(ratio.quantile(0.9)))
    last_day = sub["dt"].max()
    last = sub[sub["dt"] == last_day].groupby("product").agg(net=("dcontrib", "sum"), lots=("lots", "sum"))
    print("last option day", last_day.date(), "greek days", sorted(sub["dt"].dt.date.unique()))
    print(last.sort_values("lots", ascending=False).head(15).to_string())
    raw_last = m[m["dt"] == last_day].groupby("product")["lots"].sum().sort_values(ascending=False)
    print("all position lots that day, greek or not")
    print(raw_last.head(20).to_string())

    if not fut.empty:
        fut["dt"] = pd.to_datetime(fut["dt"])
        fut = fut[fut["dt"] <= END]
        fut = fut.loc[fut["contract"].map(lambda c: base.parse_contract(c) is None)].copy()
        fut["product"] = fut["contract"].map(base.prof.product_code)
        fut["net"] = fut["long_lots"].fillna(0) - fut["short_lots"].fillna(0)
        last = fut[fut["dt"] == fut["dt"].max()]
        print("\nFUTURES last", fut["dt"].max().date() if len(fut) else None)
        print(last.groupby("product")["net"].sum().to_string())
        print("fut trade days", fut["dt"].nunique(), "products", sorted(fut["product"].dropna().unique()))


if __name__ == "__main__":
    main()
