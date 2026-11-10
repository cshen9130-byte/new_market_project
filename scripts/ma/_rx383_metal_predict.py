# -*- coding: utf-8 -*-
"""Predict his nonferrous sell-opens before the session opens.

The position file does not hold the whole book, so the short in each name is
reconstructed from his fills: sell-to-open adds, buy-to-close subtracts.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_metal_model as mm  # noqa: E402

EXPIRY = {pd.Timestamp("2026-10-26")}
FLOOR = 4.5
BAND = 3.0
LEAD = 1.5
TOPUP = 10.0
HARD = 40.0
STREAK_STOP = 4


def tape() -> pd.DataFrame:
    import _rx383_option_strategy_report as base
    from mom_data_etl import get_conn

    conn = get_conn()
    try:
        tr = base.parse_side(base.prof.read_sql(
            conn,
            """
            SELECT "交易日期"::date AS dt, "合约" AS contract, "买/卖" AS bs, "开/平" AS oc,
                   "手数" AS lots
            FROM mom_options_trade_details
            WHERE LOWER(TRIM("账户")) = %s
              AND "交易日期" BETWEEN DATE '2026-10-01' AND DATE '2026-11-09'
            """,
            (base.ACCOUNT,),
        ))
    finally:
        conn.close()
    tr["dt"] = pd.to_datetime(tr["dt"]).dt.normalize()
    tr["lots"] = pd.to_numeric(tr["lots"], errors="coerce").fillna(0.0)
    tr = tr[tr["product"].isin(mm.METALS)].copy()
    tr["dshort"] = 0.0
    tr.loc[tr["is_sell"] & tr["is_open"], "dshort"] = tr["lots"]
    tr.loc[tr["is_buy"] & tr["is_close"], "dshort"] = -tr["lots"]
    return tr


def open_books(tr: pd.DataFrame, sessions: list[pd.Timestamp]) -> dict[pd.Timestamp, dict[str, float]]:
    daily = tr.groupby(["dt", "product"], as_index=False)["dshort"].sum()
    flow: dict[pd.Timestamp, dict[str, float]] = {}
    for r in daily.itertuples(index=False):
        flow.setdefault(pd.Timestamp(r.dt), {})[str(r.product)] = float(r.dshort)
    book = {p: 0.0 for p in mm.METALS}
    out = {}
    for d in sessions:
        out[d] = dict(book)
        for p, v in flow.get(d, {}).items():
            book[p] = max(0.0, book[p] + v)
    return out


def predict_day(g: pd.DataFrame, book: dict[str, float], streak: int, stopped: bool, expiry: bool) -> set[str]:
    """Names to sell-open. Every input is known before this session."""
    if expiry or stopped or streak >= STREAK_STOP:
        return set()
    known = g.dropna(subset=["gap"])
    if known.empty:
        return set()
    leader_gap = float(known["gap"].max())
    second = float(known["gap"].nlargest(2).iloc[-1]) if len(known) > 1 else leader_gap
    lead = leader_gap - second
    near = known[(known["gap"] >= FLOOR) & (known["gap"] >= leader_gap - BAND)]
    if near.empty:
        return set()
    shorts = {r.product: float(book.get(r.product, 0.0)) for r in near.itertuples(index=False)}
    if all(v <= 0 for v in shorts.values()):
        return set(near["product"])
    if lead >= LEAD:
        leader = str(known.sort_values("gap", ascending=False).iloc[0]["product"])
        if book.get(leader, 0.0) >= HARD:
            return set()
        return {leader}
    ranked = sorted(shorts, key=lambda p: (shorts[p], -float(near.loc[near["product"] == p, "gap"].iloc[0])))
    chosen = {ranked[0]}
    yday = near[near["sold_y"] == 1]
    for r in yday.itertuples(index=False):
        if float(book.get(r.product, 0.0)) <= TOPUP:
            chosen.add(str(r.product))
    return {p for p in chosen if book.get(p, 0.0) < HARD}


def run(metal: pd.DataFrame, tr: pd.DataFrame) -> pd.DataFrame:
    metal = metal.copy()
    metal["dt"] = pd.to_datetime(metal["dt"]).dt.normalize()
    sessions = list(sorted(metal["dt"].unique()))
    books = open_books(tr, sessions)
    # sold yesterday, attached inside each day frame
    ymap = {(pd.Timestamp(r.dt), r.product): int(r.y) for r in metal.itertuples(index=False)}
    rows = []
    streak = 0
    stopped = False
    for d in sessions:
        book = books[d]
        if sum(book.values()) <= 0:
            stopped = False
        g = metal[metal["dt"] == d].copy()
        prev = sessions[sessions.index(d) - 1] if d != sessions[0] else None
        g["sold_y"] = [ymap.get((prev, p), 0) if prev is not None else 0 for p in g["product"]]
        pred = predict_day(g, book, streak, stopped, d in EXPIRY)
        actual = set(g.loc[g["y"] == 1, "product"])
        if streak >= STREAK_STOP:
            stopped = True
        if actual:
            streak += 1
        else:
            streak = 0
        rows.append({
            "dt": d,
            "pred": tuple(sorted(pred, key=lambda p: -float(g.loc[g["product"] == p, "gap"].max()))),
            "actual": tuple(sorted(actual, key=lambda p: -float(g.loc[g["product"] == p, "gap"].max()))),
            "book": {p: v for p, v in book.items() if v},
            "streak_in": streak if not actual else streak - 1,
        })
    return pd.DataFrame(rows)


def score(out: pd.DataFrame) -> dict:
    tp = fp = fn = day_hit = 0
    for r in out.itertuples(index=False):
        p, a = set(r.pred), set(r.actual)
        tp += len(p & a)
        fp += len(p - a)
        fn += len(a - p)
        day_hit += int(bool(p) == bool(a))
    return {"days": day_hit, "n": len(out), "tp": tp, "fp": fp, "fn": fn}


def _cn(product: str) -> str:
    import _generate_rx319_profile_word_report as prof

    name = prof.PRODUCT_CN.get(product, product)
    return name[1:] if name.startswith("沪") else name


def table_rows(out: pd.DataFrame) -> list[list[str]]:
    rows = []
    for r in out.itertuples(index=False):
        book = " ".join(f"{_cn(p)}{int(v)}" for p, v in r.book.items()) or "空"
        pred = "、".join(_cn(p) for p in r.pred) or "不开"
        actual = "、".join(_cn(p) for p in r.actual) or "不开"
        rows.append([pd.Timestamp(r.dt).strftime("%m-%d"), book, pred, actual])
    return rows


def main() -> None:
    metal, _, _ = mm.build()
    out = run(metal, tape())
    for r in out.itertuples(index=False):
        print(
            pd.Timestamp(r.dt).strftime("%m-%d"),
            "pred", ",".join(r.pred) or "-",
            "actual", ",".join(r.actual) or "-",
            "book", r.book,
        )
    print(score(out))


if __name__ == "__main__":
    main()
