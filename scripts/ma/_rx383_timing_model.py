# -*- coding: utf-8 -*-
"""When RX383 opens and closes options.

Builds two decisions from his own fills:

* Close: a short line is on the book at the prior settlement. Did he buy it back today?
* Open: a product he has used. Did he sell premium in it today?

Rules are scored by leaving out each trade date, so a threshold is not judged on the day it was chosen.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Inches

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _generate_rx319_profile_word_report as prof  # noqa: E402
import _rx383_option_strategy_report as base  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports" / "_rx383_option_strategy"
CHART = OUT / "charts"


def auc_score(y, s) -> float:
    y = np.asarray(y, dtype=float)
    s = np.asarray(s, dtype=float)
    ok = np.isfinite(y) & np.isfinite(s)
    y, s = y[ok], s[ok]
    pos = s[y == 1]
    neg = s[y == 0]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    # Mann-Whitney, ties get half credit
    order = np.argsort(s, kind="mergesort")
    ranks = np.empty(len(s), dtype=float)
    ranks[order] = np.arange(1, len(s) + 1, dtype=float)
    # average ranks for ties
    ss = s[order]
    i = 0
    while i < len(ss):
        j = i + 1
        while j < len(ss) and ss[j] == ss[i]:
            j += 1
        if j > i + 1:
            avg = ranks[order[i:j]].mean()
            ranks[order[i:j]] = avg
        i = j
    sum_pos = float(ranks[y == 1].sum())
    n_pos, n_neg = float(len(pos)), float(len(neg))
    return (sum_pos - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)


def logit_fit(X: np.ndarray, y: np.ndarray, l2: float = 2.0, n_iter: int = 40) -> np.ndarray:
    w = np.zeros(X.shape[1])
    pen = np.full(X.shape[1], l2)
    pen[0] = 0.0
    for _ in range(n_iter):
        z = np.clip(X @ w, -20, 20)
        p = 1.0 / (1.0 + np.exp(-z))
        ww = np.clip(p * (1.0 - p), 1e-4, None)
        H = X.T @ (X * ww[:, None])
        H.flat[:: H.shape[0] + 1] += pen
        g = X.T @ (p - y) + pen * w
        try:
            step = np.linalg.solve(H, g)
        except np.linalg.LinAlgError:
            break
        w = w - step
        if float(np.max(np.abs(step))) < 1e-6:
            break
    return w


def logit_predict(X: np.ndarray, w: np.ndarray) -> np.ndarray:
    z = np.clip(X @ w, -20, 20)
    return 1.0 / (1.0 + np.exp(-z))


def standardize_fit(X: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mu = np.nanmean(X, axis=0)
    sd = np.nanstd(X, axis=0)
    sd = np.where(sd < 1e-8, 1.0, sd)
    mu = np.where(np.isfinite(mu), mu, 0.0)
    Z = (X - mu) / sd
    Z = np.where(np.isfinite(Z), Z, 0.0)
    return Z, mu, sd


def standardize_apply(X, mu, sd) -> np.ndarray:
    Z = (X - mu) / sd
    return np.where(np.isfinite(Z), Z, 0.0)


def prepare() -> dict:
    conn = get_conn()
    try:
        raw = base.load_account(conn)
        mkt = base.load_market(conn, raw["opt_trades"], raw["opt_pos"])
    finally:
        conn.close()
    trades = raw["opt_trades"].copy()
    pos = raw["opt_pos"].copy()
    mult = base.multipliers(trades)
    fut_px = base.build_futures_px(mkt["futs"])
    chain_acc = mkt["chain_acc"]
    if not chain_acc.empty:
        chain_acc = base.attach_underlying_fast(chain_acc, fut_px)
        iv_map = (
            chain_acc.drop_duplicates(["dt", "code"])[["dt", "code", "iv", "delta", "settl"]]
        )
        trades = trades.merge(iv_map, on=["dt", "code"], how="left")
        pos = pos.merge(
            chain_acc.drop_duplicates(["dt", "code"])[["dt", "code", "settl", "delta"]].rename(
                columns={"settl": "mkt_settl", "delta": "chain_delta"}
            ),
            on=["dt", "code"],
            how="left",
        )
    else:
        trades["iv"] = np.nan
        trades["delta"] = np.nan
        trades["settl"] = np.nan
        pos["mkt_settl"] = np.nan
        pos["chain_delta"] = np.nan
    trades = base.attach_underlying_fast(trades, fut_px)
    pos["mark"] = pd.to_numeric(pos["settl"], errors="coerce")
    pos.loc[pos["mark"] <= 0, "mark"] = np.nan
    pos["mark"] = pos["mark"].fillna(pd.to_numeric(pos.get("mkt_settl"), errors="coerce"))
    pos["delta"] = pd.to_numeric(pos.get("chain_delta"), errors="coerce")
    pos["mult"] = pos["product"].map(mult)

    pos_px = (
        pos.loc[pos["mark"].notna() & (pos["mark"] > 0), ["dt", "code", "mark"]]
        .drop_duplicates(["dt", "code"], keep="last")
        .sort_values("dt")
    )
    attached = []
    for _, g in trades.groupby("code", sort=False):
        g = g.sort_values("dt")
        ref = pos_px.loc[pos_px["code"] == g["code"].iloc[0], ["dt", "mark"]].sort_values("dt")
        if ref.empty:
            g["pos_mark"] = np.nan
            attached.append(g)
        else:
            attached.append(pd.merge_asof(g, ref, on="dt", direction="backward").rename(columns={"mark": "pos_mark"}))
    trades = pd.concat(attached, ignore_index=True)

    def repaired_price(row) -> float:
        price = base.fnum(row["price"])
        strike = base.fnum(row["strike"])
        settl = base.fnum(row["settl"]) if "settl" in row.index else float("nan")
        if not (math.isfinite(settl) and settl > 0):
            settl = base.fnum(row["pos_mark"]) if "pos_mark" in row.index else float("nan")
        bogus = (
            abs(base.fnum(row["premium"])) < 1e-9
            and abs(base.fnum(row["turnover"])) < 1e-9
            and math.isfinite(strike)
            and strike > 0
            and math.isfinite(price)
            and abs(price - strike) / strike < 0.03
        )
        if not bogus:
            return price
        if math.isfinite(settl) and 0 < settl < strike * 0.5:
            return float(settl)
        return float("nan")

    trades["price"] = trades.apply(repaired_price, axis=1)
    trades["mult"] = trades["product"].map(mult)
    trades["prem_yuan"] = trades["price"] * trades["mult"]
    trades["otm"] = np.where(
        trades["cp"].eq("C"),
        trades["moneyness"] - 1,
        np.where(trades["cp"].eq("P"), 1 - trades["moneyness"], np.nan),
    )
    trades["prem_frac"] = trades["price"] / trades["fut"]
    trades["minute"] = trades["hh"] * 60 + trades["mm"]
    trades.loc[trades["hh"] < 0, "minute"] = np.nan

    products = set(trades["product"]) | set(pos["product"])
    surface = base.build_surface(mkt["chain"], fut_px)
    basis = base.build_basis(fut_px, products)
    if not basis.empty:
        extra = basis[basis["product"].isin(base.UNDER_FUT.values())].copy()
        inv = {v: k for k, v in base.UNDER_FUT.items()}
        extra["product"] = extra["product"].map(lambda p: inv.get(p, p))
        basis = pd.concat([basis, extra], ignore_index=True)
    civ = mkt["civ"]
    atm = surface.copy() if not surface.empty else pd.DataFrame()
    if not civ.empty:
        civ_ok = civ.groupby("product")["iv"].apply(lambda s: int(s.notna().sum()))
        good = set(civ_ok[civ_ok >= 20].index)
        use_civ = civ[civ["product"].isin(good)][["dt", "product", "iv"]].rename(columns={"iv": "atm_pub"})
        if atm.empty:
            atm = use_civ.rename(columns={"atm_pub": "atm_iv"})
        else:
            atm = atm.merge(use_civ, on=["dt", "product"], how="outer")
            atm["atm_iv"] = atm["atm_pub"].where(atm["atm_pub"].notna(), atm["atm_iv"])
    if not atm.empty:
        atm = atm.sort_values(["product", "dt"])
        atm["hist_n"] = atm.groupby("product").cumcount() + 1
        atm["iv_pct"] = base.expanding_pct(atm, "atm_iv")
        atm["iv_pct_lag"] = atm.groupby("product")["iv_pct"].shift(1)
        atm["atm_lag"] = atm.groupby("product")["atm_iv"].shift(1)
        atm["slope_lag"] = atm.groupby("product")["slope"].shift(1) if "slope" in atm.columns else np.nan
    if not basis.empty:
        basis = basis.sort_values(["product", "dt"])
        basis["hist_n"] = basis.groupby("product").cumcount() + 1
        basis["basis_pct"] = base.expanding_pct(basis, "basis_ann")
        basis["basis_pct_lag"] = basis.groupby("product")["basis_pct"].shift(1)
        basis["basis_lag"] = basis.groupby("product")["basis_ann"].shift(1)
        basis["ret1"] = basis.groupby("product")["front_px"].pct_change()
        basis["ret5"] = basis.groupby("product")["front_px"].pct_change(5)

    credit = target_credit(chain_acc)
    return {
        "trades": trades,
        "pos": pos,
        "daily": raw["daily"],
        "atm": atm,
        "basis": basis,
        "credit": credit,
        "mult": mult,
    }


def target_credit(chain: pd.DataFrame) -> pd.DataFrame:
    """Premium, as a fraction of the future, on the 12–20% OTM wing he actually sells."""
    if chain.empty or "moneyness" not in chain.columns:
        return pd.DataFrame(columns=["dt", "product", "credit"])
    c = chain.dropna(subset=["moneyness", "settl"]).copy()
    c = c[c["settl"] > 0]
    c["band"] = np.where(
        (c["cp"].eq("C") & c["moneyness"].between(1.12, 1.22))
        | (c["cp"].eq("P") & c["moneyness"].between(0.78, 0.88)),
        1,
        0,
    )
    c = c[c["band"] == 1]
    if c.empty:
        return pd.DataFrame(columns=["dt", "product", "credit"])
    c["frac"] = c["settl"] / c["fut"]
    g = c.groupby(["dt", "product"], as_index=False)["frac"].median()
    return g.rename(columns={"frac": "credit"})


def clock_block(trades: pd.DataFrame) -> dict:
    opens = trades[trades["is_open"] & trades["is_sell"] & trades["minute"].notna()].copy()
    closes = trades[trades["is_close"] & trades["is_buy"] & trades["minute"].notna()].copy()

    def pack(df, lot_col="lots"):
        if df.empty:
            return {}
        w = df[lot_col].to_numpy(dtype=float)
        m = df["minute"].to_numpy(dtype=float)
        order = np.argsort(m)
        m, w = m[order], w[order]
        cw = np.cumsum(w)
        def q(p):
            return float(m[np.searchsorted(cw, p * cw[-1], side="left")])
        hours = (df["minute"] // 60).astype(int)
        by_h = df.groupby(hours)["lots"].sum()
        return {
            "lots": float(w.sum()),
            "p10": q(0.10),
            "p50": q(0.50),
            "p90": q(0.90),
            "by_hour": {str(int(k)): float(v) for k, v in by_h.items()},
        }

    # first action of each product-day
    day = []
    for (dt, product), g in trades.groupby(["dt", "product"]):
        g = g[g["minute"].notna()].sort_values("minute")
        if g.empty:
            continue
        sell_open = g[g["is_open"] & g["is_sell"]]
        buy_close = g[g["is_close"] & g["is_buy"]]
        day.append({
            "dt": str(pd.Timestamp(dt).date()),
            "product": product,
            "first": float(g["minute"].iloc[0]),
            "open_min": float(sell_open["minute"].median()) if not sell_open.empty else None,
            "close_min": float(buy_close["minute"].median()) if not buy_close.empty else None,
            "open_lots": float(sell_open["lots"].sum()),
            "close_lots": float(buy_close["lots"].sum()),
        })
    both = [r for r in day if r["open_lots"] > 0 and r["close_lots"] > 0]
    close_first = sum(1 for r in both if r["close_min"] < r["open_min"])
    return {
        "open": pack(opens),
        "close": pack(closes),
        "product_days": len(day),
        "both": len(both),
        "close_before_open": close_first,
    }


def strike_block(trades: pd.DataFrame) -> dict:
    s = trades[trades["is_open"] & trades["is_sell"]].copy()
    out = {"n": int(len(s)), "lots": float(s["lots"].sum())}

    def dist(mask, col):
        g = s.loc[mask, [col, "lots"]].dropna()
        if g.empty:
            return {"n": 0}
        v = g[col].to_numpy(dtype=float)
        w = g["lots"].to_numpy(dtype=float)
        order = np.argsort(v)
        v, w = v[order], w[order]
        cw = np.cumsum(w)
        def q(p):
            return float(v[min(len(v) - 1, np.searchsorted(cw, p * cw[-1], side="left"))])
        return {"n": int(len(g)), "lots": float(w.sum()), "p25": q(0.25), "p50": q(0.50), "p75": q(0.75)}

    out["call_otm"] = dist(s["cp"].eq("C"), "otm")
    out["put_otm"] = dist(s["cp"].eq("P"), "otm")
    out["prem_frac"] = dist(s["prem_frac"].between(0, 0.2), "prem_frac")
    out["prem_yuan"] = dist(s["prem_yuan"] > 0, "prem_yuan")
    out["abs_delta"] = dist(s["delta"].notna(), "delta")
    if out["abs_delta"].get("n"):
        # report absolute delta
        s2 = s.loc[s["delta"].notna(), ["delta", "lots"]].copy()
        s2["delta"] = s2["delta"].abs()
        out["abs_delta"] = dist(pd.Series(True, index=s2.index) if False else s["delta"].notna(), "delta")
        g = s.loc[s["delta"].notna(), ["delta", "lots"]].copy()
        g["ad"] = g["delta"].abs()
        v = g["ad"].to_numpy()
        w = g["lots"].to_numpy()
        order = np.argsort(v)
        v, w = v[order], w[order]
        cw = np.cumsum(w)
        def q(p):
            return float(v[min(len(v) - 1, np.searchsorted(cw, p * cw[-1], side="left"))])
        out["abs_delta"] = {"n": int(len(g)), "lots": float(w.sum()), "p25": q(0.25), "p50": q(0.50), "p75": q(0.75)}
    # expiry vs front: share of sell-open lots in the nearest listed month of that product-day
    return out


def expiry_block(trades: pd.DataFrame, atm: pd.DataFrame) -> dict:
    s = trades[trades["is_open"] & trades["is_sell"]].copy()
    if atm.empty or s.empty or "front" not in atm.columns:
        return {}
    s = s.merge(atm[["dt", "product", "front", "back"]], on=["dt", "product"], how="left")
    known = s[s["front"].notna()]
    if known.empty:
        return {"cover": 0}
    front_lots = float(known.loc[known["mkey"] == known["front"], "lots"].sum())
    back_lots = float(known.loc[(known["mkey"] == known["back"]) & (known["back"] != known["front"]), "lots"].sum())
    mid_lots = float(known["lots"].sum()) - front_lots - back_lots
    # DTE to the 15th of the contract month
    def dte(row):
        mk = int(row["mkey"]) if math.isfinite(base.fnum(row["mkey"])) and int(row["mkey"]) > 0 else 0
        if mk <= 0:
            return np.nan
        y, m = divmod(mk, 100)
        try:
            exp = pd.Timestamp(year=y, month=m, day=15)
        except ValueError:
            return np.nan
        return (exp - pd.Timestamp(row["dt"])).days
    s["dte"] = s.apply(dte, axis=1)
    g = s.dropna(subset=["dte"])
    if g.empty:
        dte_stats = {}
    else:
        v = g["dte"].to_numpy(dtype=float)
        w = g["lots"].to_numpy(dtype=float)
        order = np.argsort(v)
        v, w = v[order], w[order]
        cw = np.cumsum(w)
        def q(p):
            return float(v[min(len(v) - 1, np.searchsorted(cw, p * cw[-1], side="left"))])
        dte_stats = {"p25": q(0.25), "p50": q(0.50), "p75": q(0.75), "lots": float(w.sum())}
    return {
        "cover_lots": float(known["lots"].sum()),
        "front_lots": front_lots,
        "back_lots": back_lots,
        "mid_lots": mid_lots,
        "dte": dte_stats,
    }


def tranche_book(trades: pd.DataFrame) -> dict[tuple, list]:
    """Remaining short tranches at the end of each trade date, keyed by code."""
    t = trades.sort_values(["dt", "hh", "mm", "contract"]).copy()
    books: dict[str, list] = {}
    snap: dict[tuple, list] = {}
    seen_dates: dict[str, set] = {}
    for r in t.itertuples(index=False):
        book = books.setdefault(r.code, [])
        lots = float(r.lots)
        px = base.fnum(r.price)
        if lots <= 0 or not math.isfinite(px):
            continue
        if r.is_open and r.is_sell:
            book.append({"left": lots, "px": px, "dt": pd.Timestamp(r.dt), "cp": r.cp})
        elif r.is_close and r.is_buy:
            left = lots
            for lot in book:
                if left <= 1e-9:
                    break
                take = min(lot["left"], left)
                lot["left"] -= take
                left -= take
            books[r.code] = [lot for lot in book if lot["left"] > 1e-9]
        seen_dates.setdefault(r.code, set()).add(pd.Timestamp(r.dt))
    # snapshot after processing each date: rebuild by walking once more and storing end-of-day
    books = {}
    for r in t.itertuples(index=False):
        book = books.setdefault(r.code, [])
        lots = float(r.lots)
        px = base.fnum(r.price)
        if lots <= 0 or not math.isfinite(px):
            continue
        if r.is_open and r.is_sell:
            book.append({"left": lots, "px": px, "dt": pd.Timestamp(r.dt), "cp": r.cp})
        elif r.is_close and r.is_buy:
            left = lots
            for lot in book:
                if left <= 1e-9:
                    break
                take = min(lot["left"], left)
                lot["left"] -= take
                left -= take
            books[r.code] = [lot for lot in book if lot["left"] > 1e-9]
        snap[(r.code, pd.Timestamp(r.dt))] = [
            {"left": lot["left"], "px": lot["px"], "dt": lot["dt"]} for lot in books[r.code]
        ]
    return snap


def close_panel(trades: pd.DataFrame, pos: pd.DataFrame, snap: dict) -> pd.DataFrame:
    dates = sorted(pd.to_datetime(pos["dt"].unique()))
    rows = []
    pos_idx = {(pd.Timestamp(r.dt), r.code): r for r in pos.itertuples(index=False)}
    closes = trades[trades["is_close"] & trades["is_buy"]]
    close_lots = closes.groupby(["dt", "code"])["lots"].sum()
    for i, dt in enumerate(dates):
        if i == 0:
            continue
        prev = dates[i - 1]
        # only score a day he actually had the account marked, and the next session exists
        held = pos[(pos["dt"] == prev) & (pos["short_lots"] > 0)]
        for r in held.itertuples(index=False):
            mark = base.fnum(r.mark)
            sell = base.fnum(r.sell_px)
            profit = (sell - mark) / sell if math.isfinite(sell) and sell > 0 and math.isfinite(mark) else float("nan")
            tranches = snap.get((r.code, prev), [])
            if tranches and sum(t["left"] for t in tranches) > 0:
                left = sum(t["left"] for t in tranches)
                age = sum(t["left"] * (prev - t["dt"]).days for t in tranches) / left
                entry = sum(t["left"] * t["px"] for t in tranches) / left
            else:
                age = float("nan")
                entry = sell
            entry_profit = (entry - mark) / entry if math.isfinite(entry) and entry > 0 and math.isfinite(mark) else profit
            closed = float(close_lots.get((dt, r.code), 0.0))
            rows.append({
                "dt": dt,
                "prev": prev,
                "code": r.code,
                "product": r.product,
                "cp": r.cp,
                "short_lots": float(r.short_lots),
                "closed_lots": closed,
                "y": 1.0 if closed > 0 else 0.0,
                "frac": min(1.0, closed / float(r.short_lots)) if r.short_lots else 0.0,
                "profit": profit,
                "entry_profit": entry_profit,
                "age": age,
                "delta": abs(base.fnum(r.delta)) if math.isfinite(base.fnum(r.delta)) else float("nan"),
                "mark": mark,
                "sell_px": sell,
            })
    return pd.DataFrame(rows)


def open_panel(trades: pd.DataFrame, pos: pd.DataFrame, atm: pd.DataFrame, basis: pd.DataFrame, credit: pd.DataFrame) -> pd.DataFrame:
    dates = sorted(set(pd.to_datetime(trades["dt"].unique())) | set(pd.to_datetime(pos["dt"].unique())))
    products = sorted(set(trades["product"]))
    sell = trades[trades["is_open"] & trades["is_sell"]]
    sell_lots = sell.groupby(["dt", "product"])["lots"].sum()
    short = pos.groupby(["dt", "product"])["short_lots"].sum()
    # days since last sell-open, known before today
    last_open: dict[str, pd.Timestamp | None] = {p: None for p in products}
    rows = []
    atm_i = atm.set_index(["dt", "product"]) if not atm.empty else None
    basis_i = basis.set_index(["dt", "product"]) if not basis.empty else None
    credit_i = credit.set_index(["dt", "product"]) if not credit.empty else None
    for i, dt in enumerate(dates):
        prev = dates[i - 1] if i else None
        for product in products:
            lots = float(sell_lots.get((dt, product), 0.0))
            inv = float(short.get((prev, product), 0.0)) if prev is not None else 0.0
            prev_open = last_open[product]
            gap = (dt - prev_open).days if prev_open is not None else 99
            rec = {
                "dt": dt,
                "product": product,
                "y": 1.0 if lots > 0 else 0.0,
                "lots": lots,
                "inv": inv,
                "flat": 1.0 if inv <= 0 else 0.0,
                "gap": float(gap),
                "dow": int(pd.Timestamp(dt).dayofweek),
            }
            if prev is not None and atm_i is not None and (prev, product) in atm_i.index:
                a = atm_i.loc[(prev, product)]
                if isinstance(a, pd.DataFrame):
                    a = a.iloc[-1]
                rec["iv_pct"] = base.fnum(a.get("iv_pct"))
                rec["atm"] = base.fnum(a.get("atm_iv"))
                rec["slope"] = base.fnum(a.get("slope")) if "slope" in a.index else float("nan")
                rec["hist_n"] = base.fnum(a.get("hist_n"))
            else:
                rec["iv_pct"] = rec["atm"] = rec["slope"] = rec["hist_n"] = float("nan")
            if prev is not None and basis_i is not None and (prev, product) in basis_i.index:
                b = basis_i.loc[(prev, product)]
                if isinstance(b, pd.DataFrame):
                    b = b.iloc[-1]
                rec["basis_pct"] = base.fnum(b.get("basis_pct"))
                rec["basis"] = base.fnum(b.get("basis_ann"))
                rec["ret1"] = base.fnum(b.get("ret1"))
                rec["ret5"] = base.fnum(b.get("ret5"))
            else:
                rec["basis_pct"] = rec["basis"] = rec["ret1"] = rec["ret5"] = float("nan")
            if prev is not None and credit_i is not None and (prev, product) in credit_i.index:
                c = credit_i.loc[(prev, product)]
                rec["credit"] = float(c["credit"]) if np.ndim(c) == 0 or "credit" not in getattr(c, "index", []) else base.fnum(c["credit"] if not isinstance(c, pd.DataFrame) else c["credit"].iloc[-1])
                if isinstance(c, pd.DataFrame):
                    rec["credit"] = base.fnum(c["credit"].iloc[-1])
                elif isinstance(c, pd.Series):
                    rec["credit"] = base.fnum(c.get("credit"))
                else:
                    rec["credit"] = base.fnum(c)
            else:
                rec["credit"] = float("nan")
            rows.append(rec)
            if lots > 0:
                last_open[product] = dt
    return pd.DataFrame(rows)


def rule_table(df: pd.DataFrame, score: np.ndarray, y: np.ndarray, higher_is_close: bool = True) -> list[dict]:
    """Thresholds chosen on the pooled sample, for description. OOS is separate."""
    y = np.asarray(y)
    s = np.asarray(score, dtype=float)
    ok = np.isfinite(s)
    y, s = y[ok], s[ok]
    base_rate = float(y.mean()) if len(y) else float("nan")
    rows = []
    if not len(y):
        return rows
    cuts = np.unique(np.quantile(s, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]))
    for cut in cuts:
        pred = s >= cut if higher_is_close else s <= cut
        if pred.sum() == 0 or (~pred).sum() == 0:
            continue
        tp = int(((pred == 1) & (y == 1)).sum())
        fp = int(((pred == 1) & (y == 0)).sum())
        fn = int(((pred == 0) & (y == 1)).sum())
        prec = tp / (tp + fp) if tp + fp else float("nan")
        rec = tp / (tp + fn) if tp + fn else float("nan")
        rows.append({
            "cut": float(cut),
            "pred": int(pred.sum()),
            "precision": prec,
            "recall": rec,
            "lift": prec / base_rate if base_rate else float("nan"),
            "base": base_rate,
        })
    return rows


def best_threshold_oos(df: pd.DataFrame, col: str, higher: bool) -> dict:
    """Pick the F1-maximising threshold on all other days, score the left-out day."""
    days = list(df["dt"].drop_duplicates())
    picked = []
    for hold in days:
        train = df[df["dt"] != hold]
        test = df[df["dt"] == hold]
        s_tr = train[col].to_numpy(dtype=float)
        y_tr = train["y"].to_numpy(dtype=float)
        ok = np.isfinite(s_tr)
        if ok.sum() < 8 or y_tr[ok].sum() < 1 or (1 - y_tr[ok]).sum() < 1:
            continue
        cuts = np.unique(np.quantile(s_tr[ok], np.linspace(0.15, 0.85, 8)))
        best_f1, best_cut = -1.0, float(cuts[0])
        for cut in cuts:
            pred = s_tr[ok] >= cut if higher else s_tr[ok] <= cut
            y = y_tr[ok]
            tp = ((pred == 1) & (y == 1)).sum()
            fp = ((pred == 1) & (y == 0)).sum()
            fn = ((pred == 0) & (y == 1)).sum()
            prec = tp / (tp + fp) if tp + fp else 0
            rec = tp / (tp + fn) if tp + fn else 0
            f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0
            if f1 > best_f1:
                best_f1, best_cut = f1, float(cut)
        s_te = test[col].to_numpy(dtype=float)
        y_te = test["y"].to_numpy(dtype=float)
        ok_te = np.isfinite(s_te)
        if ok_te.sum() == 0:
            continue
        pred = s_te[ok_te] >= best_cut if higher else s_te[ok_te] <= best_cut
        y = y_te[ok_te]
        tp = int(((pred == 1) & (y == 1)).sum())
        fp = int(((pred == 1) & (y == 0)).sum())
        fn = int(((pred == 0) & (y == 1)).sum())
        picked.append({"cut": best_cut, "tp": tp, "fp": fp, "fn": fn, "n": int(ok_te.sum()), "y": int(y.sum())})
    if not picked:
        return {}
    tp = sum(r["tp"] for r in picked)
    fp = sum(r["fp"] for r in picked)
    fn = sum(r["fn"] for r in picked)
    prec = tp / (tp + fp) if tp + fp else float("nan")
    rec = tp / (tp + fn) if tp + fn else float("nan")
    base = sum(r["y"] for r in picked) / sum(r["n"] for r in picked)
    cuts = [r["cut"] for r in picked]
    return {
        "precision": prec,
        "recall": rec,
        "base": base,
        "lift": prec / base if base else float("nan"),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "cut_med": float(np.median(cuts)),
        "cut_p25": float(np.quantile(cuts, 0.25)),
        "cut_p75": float(np.quantile(cuts, 0.75)),
        "days": len(picked),
    }


def logit_oos(df: pd.DataFrame, cols: list[str]) -> dict:
    days = list(df["dt"].drop_duplicates())
    preds = []
    coefs = []
    for hold in days:
        train = df[df["dt"] != hold]
        test = df[df["dt"] == hold]
        Xtr = train[cols].to_numpy(dtype=float)
        ytr = train["y"].to_numpy(dtype=float)
        if ytr.sum() < 2 or (1 - ytr).sum() < 2:
            continue
        Ztr, mu, sd = standardize_fit(Xtr)
        Xtr_i = np.column_stack([np.ones(len(Ztr)), Ztr])
        w = logit_fit(Xtr_i, ytr)
        Xte = test[cols].to_numpy(dtype=float)
        Zte = standardize_apply(Xte, mu, sd)
        Xte_i = np.column_stack([np.ones(len(Zte)), Zte])
        p = logit_predict(Xte_i, w)
        part = test[["dt", "y"]].copy()
        part["p"] = p
        preds.append(part)
        coefs.append(w[1:])
    if not preds:
        return {}
    pred = pd.concat(preds, ignore_index=True)
    score = auc_score(pred["y"], pred["p"])
    base = float(pred["y"].mean())
    # top-half precision
    med = float(pred["p"].median())
    top = pred[pred["p"] >= med]
    prec = float(top["y"].mean()) if len(top) else float("nan")
    coef = np.mean(np.vstack(coefs), axis=0) if coefs else []
    return {
        "auc": score,
        "base": base,
        "top_half_rate": prec,
        "lift": prec / base if base else float("nan"),
        "n": int(len(pred)),
        "positives": int(pred["y"].sum()),
        "coef": {c: float(v) for c, v in zip(cols, coef)},
    }


def group_means(df: pd.DataFrame, cols: list[str]) -> dict:
    out = {}
    for c in cols:
        a = df.loc[df["y"] == 1, c].dropna()
        b = df.loc[df["y"] == 0, c].dropna()
        out[c] = {
            "yes": float(a.median()) if len(a) else float("nan"),
            "no": float(b.median()) if len(b) else float("nan"),
            "yes_n": int(len(a)),
            "no_n": int(len(b)),
            "auc": auc_score(df.loc[df[c].notna(), "y"], df.loc[df[c].notna(), c]),
        }
    return out


def minute_label(m) -> str:
    if m is None or not math.isfinite(float(m)):
        return "—"
    m = int(round(float(m)))
    return f"{m // 60:02d}:{m % 60:02d}"


def decision_story(trades: pd.DataFrame, pos: pd.DataFrame) -> dict:
    """Separate the expiry batch from live buybacks, and describe the open he actually places."""
    closes = trades[trades["is_close"] & trades["is_buy"]].copy()
    # 16:45 on the SHFE expiry date is the exchange batch. One other after-hours print is a single lot.
    batch = closes[(closes["dt"] == pd.Timestamp("2026-10-26")) & (closes["minute"] >= 16 * 60)]
    live = closes[closes["minute"] < 16 * 60]
    matched = base.fifo_closes(trades)
    short_m = matched[matched["side"] == "S"].copy() if not matched.empty else matched
    if not short_m.empty:
        short_m["close_dt"] = pd.to_datetime(short_m["close_dt"])
        short_m["kept"] = 1 - short_m["close_px"] / short_m["open_px"]

    def leg_table(df: pd.DataFrame) -> list[dict]:
        if df is None or df.empty:
            return []
        rows = []
        for product, g in df.groupby("product"):
            rows.append({
                "product": product,
                "lots": float(g["lots"].sum()),
                "hold": float(np.average(g["hold"], weights=g["lots"])),
                "kept": float(np.average(g["kept"], weights=g["lots"])),
            })
        return sorted(rows, key=lambda r: -r["lots"])

    batch_m = short_m[short_m["close_dt"].isin(pd.to_datetime(batch["dt"].unique()))] if not short_m.empty else short_m
    live_m = short_m[short_m["close_dt"].isin(pd.to_datetime(live["dt"].unique()))] if not short_m.empty else short_m
    # November shorts still on the book the session after the batch
    after = pos[(pos["dt"] == pd.Timestamp("2026-10-27")) & (pos["short_lots"] > 0) & (pos["mkey"] == 202611)]
    opens = trades[trades["is_open"] & trades["is_sell"]].copy()
    day_rows = []
    for dt, g in opens.groupby("dt"):
        day_rows.append({
            "dt": str(pd.Timestamp(dt).date()),
            "lots": float(g["lots"].sum()),
            "names": int(g["product"].nunique()),
            "m11": float(g.loc[g["mkey"] == 202611, "lots"].sum()),
            "m12": float(g.loc[g["mkey"] == 202612, "lots"].sum()),
            "m01": float(g.loc[g["mkey"] == 202701, "lots"].sum()),
        })
    close_by_day = closes.groupby(closes["dt"].dt.strftime("%Y-%m-%d"))["lots"].sum()
    for row in day_rows:
        row["close_lots"] = float(close_by_day.get(row["dt"], 0.0))
    # days with no opens still need the expiry print visible
    open_days = {r["dt"] for r in day_rows}
    for dt, lots in close_by_day.items():
        if dt not in open_days:
            day_rows.append({"dt": dt, "lots": 0.0, "names": 0, "m11": 0.0, "m12": 0.0, "m01": 0.0, "close_lots": float(lots)})
    day_rows.sort(key=lambda r: r["dt"])

    gaps = []
    both_lots = one_lots = 0.0
    both_n = one_n = 0
    for (_, _), g in opens.groupby(["dt", "product"]):
        calls = g[g["cp"] == "C"]
        puts = g[g["cp"] == "P"]
        if calls["lots"].sum() > 0 and puts["lots"].sum() > 0:
            both_n += 1
            both_lots += float(g["lots"].sum())
            if calls["minute"].notna().any() and puts["minute"].notna().any():
                gaps.append(abs(float(calls["minute"].median()) - float(puts["minute"].median())))
        else:
            one_n += 1
            one_lots += float(g["lots"].sum())
    book = pos.groupby("dt", as_index=False)["short_lots"].sum()
    return {
        "batch_lots": float(batch["lots"].sum()),
        "live_lots": float(live["lots"].sum()),
        "batch_days": sorted({str(pd.Timestamp(x).date()) for x in batch["dt"].unique()}),
        "live_days": sorted({str(pd.Timestamp(x).date()) for x in live["dt"].unique()}),
        "batch_legs": leg_table(batch_m),
        "live_legs": leg_table(live_m),
        "batch_kept": float(np.average(batch_m["kept"], weights=batch_m["lots"])) if not batch_m.empty else float("nan"),
        "batch_hold": float(np.average(batch_m["hold"], weights=batch_m["lots"])) if not batch_m.empty else float("nan"),
        "live_kept": float(np.average(live_m["kept"], weights=live_m["lots"])) if not live_m.empty else float("nan"),
        "live_hold": float(np.average(live_m["hold"], weights=live_m["lots"])) if not live_m.empty else float("nan"),
        "live_win_lots": float(live_m.loc[live_m["kept"] > 0, "lots"].sum()) if not live_m.empty else 0.0,
        "nov_left": float(after["short_lots"].sum()) if not after.empty else 0.0,
        "nov_left_names": sorted(after["product"].unique()) if not after.empty else [],
        "days": day_rows,
        "both_n": both_n,
        "one_n": one_n,
        "both_lots": both_lots,
        "one_lots": one_lots,
        "gap_med": float(np.median(gaps)) if gaps else float("nan"),
        "night_lots": float(opens.loc[opens["hh"] >= 21, "lots"].sum()),
        "day_lots": float(opens.loc[opens["hh"] < 21, "lots"].sum()),
        "book": book,
        "reload": next((r for r in day_rows if r["dt"] == "2026-10-27"), {}),
    }


def make_charts(clock: dict, trades: pd.DataFrame, pos: pd.DataFrame, story: dict) -> dict:
    CHART.mkdir(parents=True, exist_ok=True)
    paths = {}
    prof.configure_matplotlib()

    fig, ax = plt.subplots(figsize=(8.2, 3.6))

    def hist(block, color, label, shift):
        if not block:
            return
        xs = [int(k) for k in block.get("by_hour", {})]
        ys = [block["by_hour"][str(k)] for k in xs]
        ax.bar([x + shift for x in xs], ys, width=0.36, color=color, label=label)

    hist(clock.get("open"), prof.C_NAVY, "卖开", -0.18)
    hist(clock.get("close"), prof.C_GOLD, "买平", 0.18)
    ax.set_xlabel("成交小时")
    ax.set_ylabel("手数")
    ax.legend(frameon=False)
    fig.tight_layout()
    p = CHART / "timing_clock.png"
    fig.savefig(p, dpi=140)
    plt.close()
    paths["clock"] = p

    fig, ax = plt.subplots(figsize=(8.2, 3.8))
    book = story["book"].sort_values("dt")
    ax.plot(book["dt"], book["short_lots"], color=prof.C_NAVY, lw=1.8, label="空头手数")
    opens = trades[trades["is_open"] & trades["is_sell"]]
    by = opens.groupby("dt")["lots"].sum()
    ax.bar(by.index, by.values, width=0.8, color=prof.C_GOLD, alpha=0.85, label="当天卖开")
    ax.axvline(pd.Timestamp("2026-10-26"), color="#C05621", lw=1.0, ls="--", label="10-26 到期批次")
    ax.set_ylabel("手数")
    ax.legend(frameon=False, ncol=3)
    fig.autofmt_xdate()
    fig.tight_layout()
    p = CHART / "timing_book.png"
    fig.savefig(p, dpi=140)
    plt.close()
    paths["book"] = p

    fig, ax = plt.subplots(figsize=(8.2, 3.8))
    s = trades[trades["is_open"] & trades["is_sell"] & trades["otm"].notna()]
    bins = np.linspace(0, 0.45, 16)
    for cp, color, label in (("C", prof.C_NAVY, "认购虚值"), ("P", prof.C_GOLD, "认沽虚值")):
        g = s[s["cp"] == cp]
        ax.hist(g["otm"], bins=bins, weights=g["lots"], color=color, alpha=0.75, label=label)
    ax.axvline(0.13, color=prof.C_NAVY, lw=0.8, ls="--")
    ax.axvline(0.12, color=prof.C_GOLD, lw=0.8, ls="--")
    ax.set_xlabel("虚值程度  认购为行权价/期货−1，认沽为 1−行权价/期货")
    ax.set_ylabel("卖开手数")
    ax.legend(frameon=False)
    fig.tight_layout()
    p = CHART / "timing_otm.png"
    fig.savefig(p, dpi=140)
    plt.close()
    paths["otm"] = p
    return paths


def add_pic(doc, path) -> None:
    if path and Path(path).exists():
        doc.add_picture(str(path), width=Inches(6.3))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER


def write_doc(result: dict, story: dict, pics: dict, out_path: Path) -> None:
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.left_margin = Cm(1.8)
    sec.right_margin = Cm(1.8)
    sec.top_margin = Cm(1.6)
    sec.bottom_margin = Cm(1.6)
    prof.heading.offset = 0
    strike = result["strike"]
    clock = result["clock"]
    logit = result["open_logit"]
    oos = result.get("live_oos") or {}
    sell_lots = strike["lots"]
    prof.para(doc, "内部资料 · 开平仓时点 · 请勿外传", size=9, color=prof.GOLD, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=14)
    prof.para(doc, "RX383 什么时候开、什么时候平", size=22, bold=True, color=prof.NAVY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    prof.para(doc, "未登记投顾 · 未登记团队", size=12, color=prof.TEXT, align=WD_ALIGN_PARAGRAPH.CENTER)
    prof.para(
        doc,
        "期权成交  2026-10-15  ~  2026-11-03      卖开 623 手      买平 151 手",
        size=11, color=prof.MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12,
    )
    prof.heading(doc, "一、他实际在做的事", 1)
    prof.para(
        doc,
        "他卖近月虚值期权，拿到交易所到期，到期的下一场换到后面两个月再卖。样本里能对上下一笔的，是平在到期日、开在固定的虚值距离，不是开在某一个钟点或某一档隐波。",
    )
    prof.para(
        doc,
        f"卖开 623 手里，{story['both_lots']:.0f} 手落在「同一个品种、同一天、认购和认沽都卖」的日子，占 {story['both_lots'] / sell_lots:.0%}。"
        f"两边成交时间的中位间隔是 {story['gap_med']:.0f} 分钟，所以这是一次决定拆成两条腿，不是隔了半天的两个主意。"
        f"认购虚值中位 {strike['call_otm']['p50']:.0%}（四分位 {strike['call_otm']['p25']:.0%}–{strike['call_otm']['p75']:.0%}），"
        f"认沽虚值中位 {strike['put_otm']['p50']:.0%}（四分位 {strike['put_otm']['p25']:.0%}–{strike['put_otm']['p75']:.0%}）。"
        f"有 delta 的 269 手里，绝对 delta 中位 {strike['abs_delta']['p50']:.3f}。",
    )
    prof.para(
        doc,
        f"卖开散在全天。日盘 {story['day_lots']:.0f} 手，夜盘 {story['night_lots']:.0f} 手。"
        f"按手数，10% 的卖开在 {minute_label(clock['open']['p10'])} 之前，一半在 {minute_label(clock['open']['p50'])} 之前，90% 在 {minute_label(clock['open']['p90'])} 之前。"
        "没有一个固定的开仓分钟。",
    )
    add_pic(doc, pics.get("book"))
    prof.caption(doc, "图1  空头手数和当天卖开。10 月 26 日的竖线是上期所 2611 期权到期批次，空头从 251 手掉到 151 手，次日再卖回去。")
    add_pic(doc, pics.get("otm"))
    prof.caption(doc, "图2  卖开时的虚值程度。虚线是认购 13%、认沽 12% 的中位。权利金金额从几十元到几百元，他卡的是距离，不是一张固定的权利金。")

    prof.heading(doc, "二、平仓：到期才平", 1)
    prof.para(
        doc,
        f"151 手买平里，{story['batch_lots']:.0f} 手打在 16:45 左右，日期是 {('、'.join(story['batch_days']))}。"
        "上期所商品期权的到期日，是标的交割月前一个月的倒数第 5 个交易日。2026 年 10 月 26 日就是这一天，对应 2611。"
        "这批单子权利金和成交额都是 0，几十个合约同一秒成交，价格落在最小变动价位上。这是到期批次，不是盘中一笔一笔点掉的。",
    )
    prof.para(
        doc,
        f"这 {story['batch_lots']:.0f} 手相对自己的卖出价，留下了权利金的 {story['batch_kept']:.0%}，持有大约 {story['batch_hold']:.0f} 天，每一手都是赚的。"
        f"到期次日，11 月合约还留在空头里的只有 {story['nov_left']:.0f} 手"
        + (f"（{'、'.join(story['nov_left_names'])}）" if story["nov_left_names"] else "")
        + "。到期的月份被平掉，没到期的月份留着。"
        "另有 1 手 LH 打在 10 月 23 日 16:44，时间戳和这批同类，单手，不另立规则。",
    )
    prof.add_table(
        doc,
        ["品种", "手数", "持有天数", "留下的权利金"],
        [[r["product"], f"{r['lots']:.0f}", f"{r['hold']:.1f}", f"{r['kept']:.0%}"] for r in story["batch_legs"]],
    )
    prof.caption(doc, "表1  到期批次。留下的权利金 = 1 − 了结价/卖出价，按手数加权。了结价用持仓结算价，因为这批成交价字段写成了行权价。")
    prof.para(
        doc,
        f"剩下 {story['live_lots']:.0f} 手是盘中买平，分布在 {('、'.join(story['live_days']))}，品种是 "
        + "、".join(f"{r['product']} {r['lots']:.0f} 手" for r in story["live_legs"])
        + f"。持有大约 {story['live_hold']:.1f} 天，留下权利金 {story['live_kept']:.0%}，其中 {story['live_win_lots']:.0f} 手是赚着平的。",
    )
    underwater = next((b for b in result.get("close_buckets", []) if b["bucket"] == "亏"), None)
    if underwater:
        prof.para(
            doc,
            f"亏着的持仓很少被买平。前一日结算还在卖出价之下的仓位，一共 {underwater['lines']} 行、{underwater['lots']:.0f} 手，"
            f"下一天出现买平的只有 {underwater['close_rate']:.1%}。他不平亏损单，也不是赚到两成就走。"
            f"把到期日拿掉之后，用「已经赚到的权利金比例」去预报下一天买平，阈值在其余日子上选、拿到留出的那天用："
            f"精度 {oos.get('precision', float('nan')):.1%}，召回 {oos.get('recall', float('nan')):.0%}，"
            f"而这些日子里一行仓位真正被买平的基准只有 {oos.get('base', float('nan')):.1%}。"
            "这 33 手太少，定不出第二条平仓线。能用的平仓预报只有一条：到期日平掉该月份，其余日子继续拿着。",
        )
    add_pic(doc, pics.get("clock"))
    prof.caption(doc, "图3  卖开散在日盘和夜盘。买平的 16 点那根柱子是 10 月 26 日的到期批次，不是一个固定的平仓钟点。")

    prof.heading(doc, "三、开仓：到期换月，行权价按虚值", 1)
    reload = story.get("reload") or {}
    prof.para(
        doc,
        f"10 月 27 日是到期后的第一个交易日，也是这段样本里卖得最开的一天：{reload.get('names', 0)} 个品种、{reload.get('lots', 0):.0f} 手，"
        f"12 月 {reload.get('m12', 0):.0f} 手、1 月 {reload.get('m01', 0):.0f} 手，11 月 0 手。"
        "他不是只卖最近的一个月。到期之后，近月和再下一个月都卖，大约一半一半。",
    )
    traded_days = [r["names"] for r in story["days"] if r["lots"] > 0]
    name_med = float(np.median(traded_days)) if traded_days else float("nan")
    prof.para(
        doc,
        f"这 {len(traded_days)} 个有卖开的日子里，品种数从 {min(traded_days) if traded_days else 0} 个到 {max(traded_days) if traded_days else 0} 个，中位 {name_med:.1f} 个。"
        f"已经持有的品种当天再卖的比例是 {result['open_flat_rate']['held_and_open']:.0%}，空仓品种是 {result['open_flat_rate']['flat_and_open']:.0%}。"
        f"再卖进已有持仓 {result['open_when_held_lots']:.0f} 手，新开品种 {result['open_when_flat_lots']:.0f} 手。他会在同一品种上加仓。",
    )
    prof.add_table(
        doc,
        ["日期", "卖开手数", "品种数", "11月", "12月", "1月", "买平"],
        [[
            r["dt"][5:],
            f"{r['lots']:.0f}",
            f"{r['names']:.0f}",
            f"{r['m11']:.0f}",
            f"{r['m12']:.0f}",
            f"{r['m01']:.0f}",
            f"{r['close_lots']:.0f}",
        ] for r in story["days"]],
    )
    prof.caption(doc, "表2  每天卖到哪个月。10 月 26 日没有卖开，买平 117 手是到期。10 月 27 日起 11 月合约不再卖。")
    prof.para(
        doc,
        f"用前一天的库存、隐波分位、期货曲线分位、翼部权利金和近 5 日涨跌，去预报「这个品种今天会不会卖开」。"
        f"每天留出来检验，AUC {logit.get('auc', float('nan')):.2f}，得分较高的一半里实际卖开的比例是 {logit.get('top_half_rate', float('nan')):.0%}，"
        f"基准是 {logit.get('base', float('nan')):.0%}。"
        "这比抛硬币好一点，定不出他明天会点哪个品种。样本只有三周、他做过的 19 个品种，这条预报就停在这里。",
    )

    prof.heading(doc, "四、下一笔怎么对照", 1)
    prof.para(doc, "平仓预报。合约还没到交易所到期日，预报为继续持有。到期日，预报为这一到期月的空头在收盘批次被了结。这条覆盖了 151 手买平里的 117 手。")
    prof.para(
        doc,
        "开仓预报。他若卖某个品种，认购行权价落在期货上方大约 11% 到 20%，认沽落在下方大约 9% 到 18%，并且常常在半小时内补上另一边。"
        "到期之后的下一场，他会把卖出换到后面两个月份。卖哪个品种、卖在几点，这半个月对不上一条可以复用的规则。",
    )
    prof.para(
        doc,
        "这段窗口只经过一个上期所到期日。到期才平、次日换月，现在有这一次完整的来回。下一次到期日前还不能把这条写成稳定的容量。",
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)


def main() -> None:
    data = prepare()
    trades = data["trades"]
    pos = data["pos"]
    clock = clock_block(trades)
    strike = strike_block(trades)
    expiry = expiry_block(trades, data["atm"])
    snap = tranche_book(trades)
    close = close_panel(trades, pos, snap)
    opens = open_panel(trades, pos, data["atm"], data["basis"], data["credit"])
    # drop the first calendar day of the position file from opens? keep all trade dates that have a prior day feature
    opens_m = opens[opens["dt"].isin(close["dt"].unique())].copy() if not close.empty else opens.copy()

    close_cols = ["profit", "age", "delta"]
    open_cols = ["flat", "gap", "iv_pct", "basis_pct", "credit", "ret5", "slope"]
    result = {
        "clock": clock,
        "strike": strike,
        "expiry": expiry,
        "close_n": int(len(close)),
        "close_pos": int(close["y"].sum()) if not close.empty else 0,
        "close_rate": float(close["y"].mean()) if not close.empty else None,
        "close_means": group_means(close, close_cols) if not close.empty else {},
        "close_profit_oos": best_threshold_oos(close.dropna(subset=["profit"]), "profit", True) if not close.empty else {},
        "close_age_oos": best_threshold_oos(close.dropna(subset=["age"]), "age", True) if not close.empty else {},
        "close_logit": logit_oos(close.dropna(subset=["profit"]), ["profit", "age"]) if not close.empty else {},
        "open_n": int(len(opens_m)),
        "open_pos": int(opens_m["y"].sum()) if not opens_m.empty else 0,
        "open_rate": float(opens_m["y"].mean()) if not opens_m.empty else None,
        "open_means": group_means(opens_m, open_cols) if not opens_m.empty else {},
        "open_flat_rate": {
            "flat_and_open": float(opens_m.loc[opens_m["flat"] == 1, "y"].mean()) if (opens_m["flat"] == 1).any() else None,
            "held_and_open": float(opens_m.loc[opens_m["flat"] == 0, "y"].mean()) if (opens_m["flat"] == 0).any() else None,
            "flat_n": int((opens_m["flat"] == 1).sum()),
            "held_n": int((opens_m["flat"] == 0).sum()),
        },
        "open_basis_oos": best_threshold_oos(opens_m.dropna(subset=["basis_pct"]), "basis_pct", False) if not opens_m.empty else {},
        "open_iv_oos": best_threshold_oos(opens_m.dropna(subset=["iv_pct"]), "iv_pct", True) if not opens_m.empty else {},
        "open_credit_oos": best_threshold_oos(opens_m.dropna(subset=["credit"]), "credit", True) if not opens_m.empty else {},
        "open_logit": logit_oos(opens_m, ["flat", "gap", "iv_pct", "basis_pct", "credit", "ret5"]) if not opens_m.empty else {},
    }
    # profit buckets for the prose
    if not close.empty:
        c = close.dropna(subset=["profit"]).copy()
        bins = [-1, 0, 0.2, 0.4, 0.6, 0.8, 2]
        labels = ["亏", "赚0-20%", "赚20-40%", "赚40-60%", "赚60-80%", "赚80%+"]
        c["bucket"] = pd.cut(c["profit"], bins=bins, labels=labels)
        buck = []
        for lab, g in c.groupby("bucket", observed=False):
            buck.append({
                "bucket": str(lab),
                "lines": int(len(g)),
                "lots": float(g["short_lots"].sum()),
                "close_rate": float(g["y"].mean()) if len(g) else None,
                "closed_lots": float(g.loc[g["y"] == 1, "short_lots"].sum()),
            })
        result["close_buckets"] = buck
        # age buckets among profitable
        profit_pos = c[c["profit"] >= 0.2]
        if not profit_pos.empty:
            result["close_when_up_20"] = {
                "rate": float(profit_pos["y"].mean()),
                "n": int(len(profit_pos)),
                "age_med_yes": float(profit_pos.loc[profit_pos["y"] == 1, "age"].median()),
                "age_med_no": float(profit_pos.loc[profit_pos["y"] == 0, "age"].median()),
            }
    if not opens_m.empty:
        by_day = opens_m.groupby("dt").agg(opens=("y", "sum"), products=("product", "nunique")).reset_index()
        result["opens_per_day"] = {
            "median": float(by_day["opens"].median()),
            "min": float(by_day["opens"].min()),
            "max": float(by_day["opens"].max()),
            "days": int(len(by_day)),
        }
        # repeat vs first entry
        result["open_when_flat_lots"] = float(opens_m.loc[(opens_m["y"] == 1) & (opens_m["flat"] == 1), "lots"].sum())
        result["open_when_held_lots"] = float(opens_m.loc[(opens_m["y"] == 1) & (opens_m["flat"] == 0), "lots"].sum())

    story = decision_story(trades, pos)
    live_close = close[close["dt"] != pd.Timestamp("2026-10-26")].dropna(subset=["profit"])
    if not live_close.empty and live_close["y"].sum() >= 2:
        result["live_oos"] = {
            "auc": auc_score(live_close["y"], live_close["profit"]),
            **best_threshold_oos(live_close, "profit", True),
        }
    else:
        result["live_oos"] = {}
    pics = make_charts(clock, trades, pos, story)
    doc_path = ROOT / "reports" / "RX383_开平仓时点.docx"
    write_doc(result, story, pics, doc_path)
    print("REPORT", doc_path)
    result["charts"] = {k: str(v) for k, v in pics.items()}
    OUT.mkdir(parents=True, exist_ok=True)
    # json-safe
    def conv(o):
        if isinstance(o, (np.floating,)):
            o = float(o)
        if isinstance(o, float) and not math.isfinite(o):
            return None
        if isinstance(o, (np.integer,)):
            return int(o)
        return o
    text = json.dumps(result, ensure_ascii=False, indent=2, default=conv)
    (OUT / "timing.json").write_text(text, encoding="utf-8")
    print(text)
    print("WROTE", OUT / "timing.json")


if __name__ == "__main__":
    main()
