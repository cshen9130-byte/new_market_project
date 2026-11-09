# -*- coding: utf-8 -*-
"""Run the nonferrous model for 3-5 Nov and set it next to the fills."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_metal_model as mm  # noqa: E402
import _rx383_metal_predict as pred  # noqa: E402
import _rx383_metal_quote as quote  # noqa: E402
import _rx383_option_strategy_report as base  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402

HOLD = [pd.Timestamp(x) for x in ("2026-11-03", "2026-11-04", "2026-11-05")]


def actual_opens() -> pd.DataFrame:
    conn = get_conn()
    try:
        tr = base.parse_side(base.prof.read_sql(
            conn,
            """
            SELECT "交易日期"::date AS dt, "合约" AS contract, "买/卖" AS bs, "开/平" AS oc,
                   "手数" AS lots, "成交价" AS price
            FROM mom_options_trade_details
            WHERE LOWER(TRIM("账户")) = %s
              AND "交易日期" BETWEEN DATE '2026-11-03' AND DATE '2026-11-05'
            """,
            (base.ACCOUNT,),
        ))
    finally:
        conn.close()
    tr["dt"] = pd.to_datetime(tr["dt"]).dt.normalize()
    tr["lots"] = pd.to_numeric(tr["lots"], errors="coerce").fillna(0.0)
    tr["price"] = pd.to_numeric(tr["price"], errors="coerce")
    return tr


def _sell_opens(tr: pd.DataFrame, dt: pd.Timestamp) -> str:
    g = tr[(tr["dt"] == dt) & tr["is_sell"] & tr["is_open"]]
    if g.empty:
        return "没有"
    bits = []
    for key, h in g.groupby(["product", "month", "cp", "strike"], sort=False):
        product, month, cp, strike = key
        lots = float(h["lots"].sum())
        vwap = float((h["price"] * h["lots"]).sum() / lots)
        side = "认购" if cp == "C" else "认沽"
        bits.append(f"{pred._cn(product)}{month}{side}{int(strike)} {lots:.0f}手 {vwap:.0f}")
    return "；".join(bits)


def holdout_rows() -> list[list[str]]:
    """Name-model calls for 3-5 Nov next to every sell-open that day."""
    metal, _, _ = mm.build(pd.Timestamp("2026-11-05"))
    out = pred.run(metal, pred.tape())
    tr = actual_opens()
    rows = []
    for r in out[out["dt"].isin(HOLD)].itertuples(index=False):
        book = " ".join(f"{pred._cn(p)}{int(v)}" for p, v in r.book.items()) or "空"
        called = "、".join(pred._cn(p) for p in r.pred) or "不开"
        metal_actual = "、".join(pred._cn(p) for p in r.actual) or "没有"
        rows.append([
            pd.Timestamp(r.dt).strftime("%m-%d"),
            book,
            called,
            metal_actual,
            _sell_opens(tr, pd.Timestamp(r.dt)),
        ])
    return rows


def main() -> None:
    metal, _, _ = mm.build(pd.Timestamp("2026-11-05"))
    print("sessions", [pd.Timestamp(d).strftime("%m-%d") for d in sorted(metal["dt"].unique()) if d >= pd.Timestamp("2026-11-01")])
    out = pred.run(metal, pred.tape())
    sub = out[out["dt"].isin(HOLD)]
    print("\nMODEL")
    for r in sub.itertuples(index=False):
        g = metal[metal["dt"] == r.dt].dropna(subset=["gap"]).sort_values("gap", ascending=False)
        gaps = " ".join(f"{a.product}{a.gap:.1f}" for a in g.itertuples(index=False))
        print(pd.Timestamp(r.dt).strftime("%m-%d"), "pred", ",".join(r.pred) or "-", "metal_actual", ",".join(r.actual) or "-", "book", r.book)
        print("   ", gaps)
    tr = actual_opens()
    print("\nALL FILLS")
    if tr.empty:
        print("none")
        return
    for dt, g in tr.groupby("dt"):
        bits = []
        for r in g.itertuples(index=False):
            side = ("卖" if r.is_sell else "买") + ("开" if r.is_open else "平")
            bits.append(f"{side}{r.product}{r.month}{r.cp}{int(r.strike)} x{r.lots:.0f}@{r.price:.1f}")
        print(pd.Timestamp(dt).strftime("%m-%d"), " | ".join(bits))
    # quotes only for names the model opens on these days
    fut = quote._futures()
    cal = sorted(pd.to_datetime(fut["dt"]).unique())
    atm = {(pd.Timestamp(r.dt), r.product): float(r.atm_iv_prev) for r in metal.itertuples(index=False) if pd.notna(r.atm_iv_prev)}
    print("\nQUOTES for predicted names")
    any_name = False
    for r in sub.itertuples(index=False):
        for p in r.pred:
            any_name = True
            for leg in quote.quote_name(p, r.dt, fut, atm.get((pd.Timestamp(r.dt), p), float("nan")), cal):
                print(pd.Timestamp(r.dt).strftime("%m-%d"), p, leg["month"], leg["cp"], int(leg["strike"]), f"black{leg['model']:.1f}", f"atm{leg['atm']:.1f}")
    if not any_name:
        print("model opened nothing, no contract")


if __name__ == "__main__":
    main()
