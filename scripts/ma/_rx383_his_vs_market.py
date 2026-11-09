# -*- coding: utf-8 -*-
"""RX383 sold strangle legs on the same distance bins as the full-grid market."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as rep  # noqa: E402
import _rx383_expiry_zero as z  # noqa: E402
import _rx383_option_strategy_report as base  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402

EDGES = [-20, 0, 3, 7, 12, 17, 25, 40, 80]
LABELS = ["ITM", "0-3", "3-7", "7-12", "12-17", "17-25", "25-40", "40-80"]


def _legs() -> pd.DataFrame:
    conn = get_conn()
    try:
        tr = base.parse_side(base.prof.read_sql(conn, f"""
            SELECT "交易日期"::date AS dt, "合约" AS contract, "买/卖" AS bs, "开/平" AS oc,
                   {base.prof.num_sql("手数")} AS lots,
                   {base.prof.num_sql("成交价")} AS price
            FROM mom_options_trade_details
            WHERE LOWER(TRIM("账户")) = %s
        """, (base.ACCOUNT,)))
    finally:
        conn.close()
    tr["dt"] = pd.to_datetime(tr["dt"])
    tr["lots"] = pd.to_numeric(tr["lots"], errors="coerce").fillna(0.0)
    tr["price"] = pd.to_numeric(tr["price"], errors="coerce")
    tr = tr[tr["is_sell"] & tr["is_open"] & (tr["lots"] > 0) & (tr["price"] > 0)].copy()
    tr["expiry"] = [rep.option_expiry(p, m) for p, m in zip(tr["product"], tr["month"])]
    tr["expiry"] = pd.to_datetime(tr["expiry"])
    return tr


def main() -> None:
    fut = z._futures()
    asof = fut["dt"].max()
    print("futures asof", asof.date(), "rows", len(fut))
    books = {(p, m): g.sort_values("dt") for (p, m), g in fut.groupby(["product", "month"], sort=False)}

    def book_for(product: str, month: str):
        for key in base.fut_lookup_keys(product, month):
            hit = re.fullmatch(r"([A-Z]+?)(\d{3,4})", key)
            if hit and (hit.group(1), hit.group(2)) in books:
                return books[(hit.group(1), hit.group(2))]
        return None

    legs = _legs()
    both = (
        legs.groupby(["product", "month"])["cp"]
        .agg(lambda s: set(s) >= {"C", "P"})
        .rename("strangle")
        .reset_index()
    )
    legs = legs.merge(both, on=["product", "month"], how="left")
    print("sell-open rows", len(legs), "lots", float(legs["lots"].sum()))
    print("strangle rows", int(legs["strangle"].sum()), "lots", float(legs.loc[legs["strangle"], "lots"].sum()))
    print("one-sided lots", float(legs.loc[~legs["strangle"], "lots"].sum()))

    rows = []
    skipped = []
    for r in legs.itertuples(index=False):
        book = book_for(r.product, r.month)
        if book is None or not pd.notna(r.expiry):
            if r.strangle:
                skipped.append((r.dt.date(), r.product, r.month, r.cp, float(r.strike), float(r.lots), "no book" if book is None else "no expiry"))
            continue
        near = book[(book["dt"] - r.dt).abs() <= pd.Timedelta(days=10)]
        if near.empty:
            if r.strangle:
                skipped.append((r.dt.date(), r.product, r.month, r.cp, float(r.strike), float(r.lots), "no print within 10 days"))
            continue
        pick = near.iloc[(near["dt"] - r.dt).abs().argmin()]
        f0 = float(pick["px"])
        if f0 <= 0:
            continue
        if r.cp == "C":
            dist = (r.strike / f0 - 1.0) * 100.0
        else:
            dist = (1.0 - r.strike / f0) * 100.0
        prem = r.price / f0 * 100.0
        expired = r.expiry <= asof
        settle = np.nan
        through = np.nan
        zero = np.nan
        if expired:
            sub = book[book["dt"] <= r.expiry]
            if not sub.empty and (r.expiry - sub["dt"].max()).days <= 7:
                settle = float(sub.sort_values("dt").iloc[-1]["px"])
                if r.cp == "C":
                    intrinsic = max(settle - r.strike, 0.0)
                    zero = settle <= r.strike
                else:
                    intrinsic = max(r.strike - settle, 0.0)
                    zero = settle >= r.strike
                through = intrinsic / f0 * 100.0
        rows.append({
            "dt": r.dt.date(), "product": r.product, "month": r.month, "cp": r.cp,
            "strike": r.strike, "lots": r.lots, "price": r.price, "fut": f0,
            "dist": dist, "prem": prem, "strangle": bool(r.strangle),
            "expiry": r.expiry.date(), "expired": bool(expired and pd.notna(settle)),
            "settle": settle, "through": through, "zero": zero,
        })
    df = pd.DataFrame(rows)
    df["bin"] = pd.cut(df["dist"], EDGES, labels=LABELS, right=False)
    st = df[df["strangle"]].copy()
    print("skipped strangle", skipped)
    print("\nSTRANGLE LEGS", len(st), "lots", float(st["lots"].sum()))
    print("expired legs", int(st["expired"].sum()), "lots", float(st.loc[st["expired"], "lots"].sum()))
    print("dist p10/p50/p90", np.percentile(st["dist"], [10, 50, 90]).round(2))
    print(st.groupby(["cp", "bin"], observed=False).agg(n=("lots", "size"), lots=("lots", "sum"), prem=("prem", "median"), dist=("dist", "median")).to_string())
    print("\nALL strangle sells, lot-weighted premium, open included")
    for cp in ("C", "P"):
        for lab in LABELS:
            g = st[(st["cp"] == cp) & (st["bin"] == lab)]
            if g.empty:
                continue
            prem = np.average(g["prem"], weights=g["lots"])
            dist = np.average(g["dist"], weights=g["lots"])
            open_g = g[~g["expired"]]
            open_prem = np.average(open_g["prem"], weights=open_g["lots"]) if not open_g.empty else float("nan")
            print(f"  {cp} {lab}: lots {g['lots'].sum():.0f} prem {prem:.2f}% dist {dist:.1f}% expired lots {g.loc[g['expired'], 'lots'].sum():.0f} open prem {open_prem:.2f}%")

    print("\nBIN EQUATIONS lot-weighted, expired strangle legs only")
    ex = st[st["expired"]].copy()
    for cp in ("C", "P"):
        for lab in LABELS:
            g = ex[(ex["cp"] == cp) & (ex["bin"] == lab)]
            if g.empty:
                continue
            w = g["lots"].to_numpy()
            zero = np.average(g["zero"].astype(float), weights=w)
            prem = np.average(g["prem"], weights=w)
            losers = g[g["zero"] == False]
            if losers.empty:
                thru = 0.0
                loss_n = 0.0
            else:
                thru = np.average(losers["through"], weights=losers["lots"])
                loss_n = float(losers["lots"].sum())
            loss_rate = 1.0 - zero
            net = prem - thru
            exp = zero * prem + loss_rate * net
            print(f"  {cp} {lab}: lots {w.sum():.0f} fills {len(g)} win {zero:.3f} prem {prem:.2f}% thru {thru:.2f}%  {zero:.3f} x {prem:.2f}% + {loss_rate:.3f} x ({prem:.2f}% - {thru:.2f}%) = {exp:+.2f}%")

    print("expired products", sorted(ex.groupby(["product", "month"]).groups))
    print("\nALL expired strangle legs pooled")
    for cp in ("C", "P"):
        g = ex[ex["cp"] == cp]
        if g.empty:
            continue
        w = g["lots"].to_numpy()
        zero = np.average(g["zero"].astype(float), weights=w)
        prem = np.average(g["prem"], weights=w)
        losers = g[g["zero"] == False]
        thru = 0.0 if losers.empty else np.average(losers["through"], weights=losers["lots"])
        net = prem - thru
        exp = zero * prem + (1 - zero) * net
        print(f"  {cp}: lots {w.sum():.0f} win {zero:.3f} prem {prem:.2f}% result {exp:+.2f}% dist median {np.average(g['dist'], weights=w):.1f}%")


if __name__ == "__main__":
    main()
