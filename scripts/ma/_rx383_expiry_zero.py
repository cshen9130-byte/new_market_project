# -*- coding: utf-8 -*-
"""Hold-to-expiry: how often a sold call and put finish at 0.

A short option finishes at 0 when the futures settlement on the option expiry
is on the worthless side of the strike. His book is scored only where that
expiry has already happened. The random book is every futures contract since
2025, struck 10% above and 14% below the price 20 sessions before expiry,
which is the distance of his own wings.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as rep  # noqa: E402
import _rx383_option_strategy_report as base  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402

CALL_OTM = 0.10
PUT_OTM = 0.14
TENOR = 20
ASOF = pd.Timestamp("2026-11-06")


def _futures() -> pd.DataFrame:
    conn = get_conn()
    try:
        df = base.prof.read_sql(conn, """
            SELECT trade_date::date AS dt, contract,
                   COALESCE(clear, close)::float8 AS px
            FROM raw_futures_contracts_daily
            WHERE trade_date >= DATE '2025-01-01'
              AND COALESCE(clear, close) > 0
        """)
    finally:
        conn.close()
    df["code"] = df["contract"].map(base.norm_code)
    parsed = df["code"].map(_fut)
    df = df.loc[parsed.notna()].copy()
    info = pd.DataFrame(list(parsed.loc[df.index]))
    info.index = df.index
    df["product"] = info["product"]
    df["month"] = info["month"]
    df["dt"] = pd.to_datetime(df["dt"])
    df["px"] = pd.to_numeric(df["px"], errors="coerce")
    return df.dropna(subset=["px"])


def _fut(code: str):
    import re
    m = re.fullmatch(r"([A-Z]+?)(\d{3,4})", str(code or ""))
    if not m:
        return None
    return {"product": m.group(1), "month": m.group(2)}


def _his() -> pd.DataFrame:
    conn = get_conn()
    try:
        tr = base.parse_side(base.prof.read_sql(conn, """
            SELECT "交易日期"::date AS dt, "合约" AS contract, "买/卖" AS bs, "开/平" AS oc,
                   "手数" AS lots
            FROM mom_options_trade_details
            WHERE LOWER(TRIM("账户")) = %s
        """, (base.ACCOUNT,)))
    finally:
        conn.close()
    tr["dt"] = pd.to_datetime(tr["dt"])
    tr["lots"] = pd.to_numeric(tr["lots"], errors="coerce").fillna(0.0)
    tr = tr[tr["is_sell"] & tr["is_open"]].copy()
    tr["expiry"] = [rep.option_expiry(p, m) for p, m in zip(tr["product"], tr["month"])]
    return tr


def _settle_map(fut: pd.DataFrame) -> pd.DataFrame:
    """One row per futures contract: expiry, settlement, and the price TENOR sessions earlier."""
    rows = []
    for (product, month), g in fut.groupby(["product", "month"], sort=False):
        exp = rep.option_expiry(product, month)
        if exp is None:
            continue
        exp_ts = pd.Timestamp(exp)
        if exp_ts > ASOF:
            continue
        g = g.sort_values("dt")
        on = g[g["dt"] <= exp_ts]
        if on.empty:
            continue
        last = on.iloc[-1]
        if (exp_ts - last["dt"]).days > 7:
            continue
        before = g[g["dt"] <= exp_ts - pd.Timedelta(days=1)]
        if len(before) < TENOR:
            continue
        entry = before.iloc[-TENOR]
        rows.append({
            "product": product,
            "month": month,
            "expiry": exp_ts,
            "settle": float(last["px"]),
            "settle_dt": last["dt"],
            "entry": float(entry["px"]),
            "entry_dt": entry["dt"],
        })
    return pd.DataFrame(rows)


def _worthless(cp: str, strike: float, settle: float) -> bool:
    if cp == "C":
        return settle <= strike
    return settle >= strike


def main() -> None:
    fut = _futures()
    board = _settle_map(fut)
    board["call_k"] = board["entry"] * (1 + CALL_OTM)
    board["put_k"] = board["entry"] * (1 - PUT_OTM)
    board["call0"] = board["settle"] <= board["call_k"]
    board["put0"] = board["settle"] >= board["put_k"]
    board["both0"] = board["call0"] & board["put0"]
    print(f"random board n={len(board)} expiries {board['expiry'].nunique()} products {board['product'].nunique()}")
    print(f"  call finishes 0 {board['call0'].mean():.3f}")
    print(f"  put  finishes 0 {board['put0'].mean():.3f}")
    print(f"  both finish 0   {board['both0'].mean():.3f}")
    # at the money, sold the session price itself
    atm_call = (board["settle"] <= board["entry"]).mean()
    atm_put = (board["settle"] >= board["entry"]).mean()
    atm_both = ((board["settle"] - board["entry"]).abs() / board["entry"] < 1e-6).mean()
    print(f"  ATM call 0 {atm_call:.3f}  ATM put 0 {atm_put:.3f}  ATM both 0 {atm_both:.3f}")

    his = _his()
    his["expiry"] = pd.to_datetime(his["expiry"])
    print(f"his sell-open lots {his['lots'].sum():.0f}  rows {len(his)}")
    expired = his[his["expiry"].notna() & (his["expiry"] <= ASOF)]
    live = his[his["expiry"].notna() & (his["expiry"] > ASOF)]
    print(f"  expired lots {expired['lots'].sum():.0f}  still running {live['lots'].sum():.0f}")

    # innermost wings: highest put and lowest call decide whether every sold strike is 0
    books = []
    for (product, month), g in expired.groupby(["product", "month"]):
        calls = g[g["cp"] == "C"]
        puts = g[g["cp"] == "P"]
        if calls.empty or puts.empty:
            continue
        exp = g["expiry"].iloc[0]
        hit = board[(board["product"] == product) & (board["month"] == month)]
        if hit.empty:
            # settlement may exist even if the 20-day entry filter dropped it
            sub = fut[(fut["product"] == product) & (fut["month"] == month) & (fut["dt"] <= exp)]
            if sub.empty or (exp - sub["dt"].max()).days > 7:
                print("  no settlement", product, month, exp.date())
                continue
            settle = float(sub.sort_values("dt").iloc[-1]["px"])
        else:
            settle = float(hit.iloc[0]["settle"])
        call_k = float(calls["strike"].min())
        put_k = float(puts["strike"].max())
        call_lots = float(calls["lots"].sum())
        put_lots = float(puts["lots"].sum())
        books.append({
            "product": product,
            "month": month,
            "expiry": exp,
            "settle": settle,
            "call_k": call_k,
            "put_k": put_k,
            "call0": settle <= call_k,
            "put0": settle >= put_k,
            "both0": (settle <= call_k) and (settle >= put_k),
            "lots": call_lots + put_lots,
            "entry": g["dt"].min(),
        })
    bk = pd.DataFrame(books)
    if bk.empty:
        print("no expired both-wing books")
        return
    bk = bk.sort_values(["expiry", "product"])
    print("\nHIS EXPIRED SHORT STRANGLES")
    for r in bk.itertuples(index=False):
        print(
            f"  {r.expiry.date()} {r.product}{r.month} settle {r.settle:.0f} "
            f"put {r.put_k:.0f} call {r.call_k:.0f} "
            f"put0 {int(r.put0)} call0 {int(r.call0)} both {int(r.both0)} lots {r.lots:.0f}"
        )
    print(f"structures {len(bk)} both0 {int(bk['both0'].sum())} rate {bk['both0'].mean():.3f}")
    print(f"  call0 {bk['call0'].mean():.3f} put0 {bk['put0'].mean():.3f}")
    w = bk["lots"].sum()
    print(f"  lot-weighted both0 {np.average(bk['both0'], weights=bk['lots']):.3f} lots {w:.0f}")

    # same-expiry null: every other product expiring that day, struck at HIS moneyness
    # measured from the futures price on his first sell day
    print("\nSAME-DAY NULL at his wing width")
    rng = np.random.default_rng(1)
    hits = []
    for r in bk.itertuples(index=False):
        day = pd.Timestamp(r.entry)
        # price on his first sell date; if the contract did not print, the prior print
        px = fut[fut["dt"] <= day].sort_values("dt").groupby(["product", "month"], as_index=False).tail(1)
        px = px[px["dt"] >= day - pd.Timedelta(days=4)]
        call_otm = r.call_k / r.settle - 1 if False else None
        # moneyness versus the futures price on entry, not versus expiry
        entry_px = fut[(fut["product"] == r.product) & (fut["month"] == r.month) & (fut["dt"] <= day)]
        if entry_px.empty:
            print("  no entry future", r.product, r.month)
            continue
        f0 = float(entry_px.sort_values("dt").iloc[-1]["px"])
        c_pct = r.call_k / f0 - 1
        p_pct = 1 - r.put_k / f0
        mates = []
        for q in px.itertuples(index=False):
            if rep.option_expiry(q.product, q.month) is None:
                continue
            if pd.Timestamp(rep.option_expiry(q.product, q.month)) != r.expiry:
                continue
            settled = board[(board["product"] == q.product) & (board["month"] == q.month)]
            if settled.empty:
                sub = fut[(fut["product"] == q.product) & (fut["month"] == q.month) & (fut["dt"] <= r.expiry)]
                if sub.empty or (r.expiry - sub["dt"].max()).days > 7:
                    continue
                st = float(sub.sort_values("dt").iloc[-1]["px"])
            else:
                st = float(settled.iloc[0]["settle"])
            ck = float(q.px) * (1 + c_pct)
            pk = float(q.px) * (1 - p_pct)
            mates.append((st <= ck) and (st >= pk))
        if not mates:
            print("  no mates", r.product, r.expiry.date())
            continue
        p = float(np.mean(mates))
        hits.append({"product": r.product, "expiry": r.expiry, "his": bool(r.both0), "p": p, "n": len(mates), "c": c_pct, "put": p_pct})
        print(f"  {r.expiry.date()} {r.product} his {int(r.both0)}  same-day rate {p:.3f}  n {len(mates)}  call {c_pct:.1%} put {p_pct:.1%}")
    h = pd.DataFrame(hits)
    if h.empty:
        return
    # Poisson-binomial tail: probability a same-day random book wins at least as often
    k = int(h["his"].sum())
    # exact DP
    dp = np.zeros(len(h) + 1)
    dp[0] = 1.0
    for p in h["p"]:
        dp[1:] = dp[1:] * (1 - p) + dp[:-1] * p
        dp[0] *= (1 - p)
    # The DP above is wrong because I scaled the whole array with the new p incorrectly.
    # Recompute cleanly.
    dp = np.array([1.0])
    for p in h["p"]:
        nxt = np.zeros(len(dp) + 1)
        nxt[:-1] += dp * (1 - p)
        nxt[1:] += dp * p
        dp = nxt
    tail = float(dp[k:].sum())
    print(f"his {k}/{len(h)}  random expected {h['p'].sum():.2f}  P(random >= his) {tail:.3f}")

    print("\nONE-SIDED EXPIRED LEGS")
    sided = []
    for (product, month, cp, strike), g in expired.groupby(["product", "month", "cp", "strike"]):
        both = bk[(bk["product"] == product) & (bk["month"] == month)]
        if not both.empty:
            continue
        exp = g["expiry"].iloc[0]
        sub = fut[(fut["product"] == product) & (fut["month"] == month) & (fut["dt"] <= exp)]
        if sub.empty or (exp - sub["dt"].max()).days > 7:
            print("  no settlement", product, month, cp, strike)
            continue
        settle = float(sub.sort_values("dt").iloc[-1]["px"])
        ok = _worthless(cp, float(strike), settle)
        sided.append(ok)
        print(f"  {exp.date()} {product}{month} {cp} {float(strike):.0f} settle {settle:.0f} zero {int(ok)} lots {g['lots'].sum():.0f}")
    if sided:
        print(f"one-sided legs {len(sided)} finish 0 {sum(sided)}/{len(sided)}")

    print("\nTENOR SENSITIVITY both-finish-0")
    for tenor in (5, 10, 20, 40):
        rows = []
        for (product, month), g in fut.groupby(["product", "month"], sort=False):
            exp = rep.option_expiry(product, month)
            if exp is None:
                continue
            exp_ts = pd.Timestamp(exp)
            if exp_ts > ASOF:
                continue
            g = g.sort_values("dt")
            on = g[g["dt"] <= exp_ts]
            if on.empty or (exp_ts - on.iloc[-1]["dt"]).days > 7:
                continue
            before = g[g["dt"] <= exp_ts - pd.Timedelta(days=1)]
            if len(before) < tenor:
                continue
            entry = float(before.iloc[-tenor]["px"])
            settle = float(on.iloc[-1]["px"])
            rows.append((settle <= entry * 1.10) and (settle >= entry * 0.86))
        print(f"  {tenor} sessions n={len(rows)} both0 {np.mean(rows):.3f}")


if __name__ == "__main__":
    main()
