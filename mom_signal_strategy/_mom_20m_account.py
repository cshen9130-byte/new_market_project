# -*- coding: utf-8 -*-
"""20M CNY paper account that trades MOM 量化 vs 主观 decision signals."""
from __future__ import annotations

import math
from pathlib import Path

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

START_EQUITY = 20_000_000.0
BROKER_MARGIN_MULT = 1.10
MAX_MARGIN_UTIL = 0.50
TARGET_GROSS_LEV = 2.20
MAX_NAMES = 8
RISK_CAP_NAV = 0.012
COMM_RATE = 0.00012
SLIP_RATE = 0.00015
FEE_FLOOR_YUAN = 3.0
MIN_LOT_NOTIONAL = 80_000.0

MULTIPLIER = {
    "C": 10, "CS": 10, "WH": 20, "PM": 50, "RR": 10, "RI": 20, "JR": 20, "LR": 10,
    "A": 10, "B": 10, "M": 10, "Y": 10, "RM": 10, "OI": 10, "RS": 10, "PK": 10, "P": 10,
    "SR": 10, "CF": 5, "CY": 5, "AP": 10, "CJ": 5, "LH": 16, "JD": 10,
    "LG": 90, "SP": 10, "OP": 20, "BB": 500, "FB": 500,
    "AU": 1000, "AG": 15, "PT": 1000, "PD": 1000,
    "CU": 5, "BC": 5, "AL": 5, "AO": 20, "AD": 5, "ZN": 5, "PB": 5, "NI": 1, "SN": 1,
    "LC": 1, "PS": 5, "SI": 5,
    "I": 100, "SF": 5, "SM": 5, "RB": 10, "HC": 10, "SS": 5, "WR": 10,
    "JM": 60, "J": 100, "ZC": 100, "FG": 20,
    "SC": 1000, "FU": 10, "LU": 10, "PG": 20, "BU": 10, "EC": 50,
    "TA": 5, "EG": 10, "PF": 5, "PR": 15,
    "PL": 20, "PP": 5, "L": 5,
    "BZ": 30, "PX": 5, "EB": 5,
    "RU": 10, "BR": 5, "NR": 10,
    "SA": 20, "SH": 30, "V": 5, "UR": 20, "MA": 10,
    "IH": 300, "IF": 300, "IC": 200, "IM": 200, "MO": 100,
    "TS": 20000, "TF": 10000, "T": 10000, "TL": 10000,
}

MARGIN_RATE = {
    "AU": 0.16, "AG": 0.16, "PT": 0.16, "PD": 0.16,
    "SC": 0.16, "FU": 0.12, "LU": 0.12, "PG": 0.12, "BU": 0.12,
    "CU": 0.11, "AL": 0.11, "ZN": 0.11, "PB": 0.11, "NI": 0.14, "SN": 0.14, "BC": 0.11, "AO": 0.12, "AD": 0.12,
    "LC": 0.15, "PS": 0.14, "SI": 0.14,
    "I": 0.11, "RB": 0.09, "HC": 0.09, "J": 0.12, "JM": 0.12, "ZC": 0.12, "SF": 0.10, "SM": 0.10, "SS": 0.10, "FG": 0.09,
    "IF": 0.12, "IH": 0.12, "IC": 0.12, "IM": 0.12,
    "T": 0.02, "TF": 0.012, "TS": 0.005, "TL": 0.035,
    "LH": 0.08, "JD": 0.08, "AP": 0.08, "CJ": 0.08,
}
DEFAULT_MARGIN = 0.10


def multiplier(prod: str) -> float:
    return float(MULTIPLIER.get(prod, 10))


def margin_rate(prod: str) -> float:
    return float(MARGIN_RATE.get(prod, DEFAULT_MARGIN)) * BROKER_MARGIN_MULT


def consensus_dir(kind: str, q_pct: float, s_pct: float) -> float:
    if kind == "consensus_long":
        return 1.0
    if kind == "consensus_short":
        return -1.0
    if kind == "crowded":
        return 1.0 if q_pct > 0 else -1.0
    if (q_pct > 0 and s_pct > 0) or (q_pct < 0 and s_pct < 0):
        return 1.0 if (q_pct + s_pct) > 0 else -1.0
    return 0.0


def heavy_dir(q_pct: float, s_pct: float) -> float:
    if abs(q_pct) >= abs(s_pct):
        return 1.0 if q_pct > 0 else -1.0
    return 1.0 if s_pct > 0 else -1.0


def signal_trade_dir(
    action: str,
    kind: str,
    q_pct: float,
    s_pct: float,
    divergence_follow: str | None = None,
) -> float:
    """User rule: 加码 follow 主观/量化; 控拥挤 fade; 观望 flat unless divergence_follow."""
    if action == "加码":
        return consensus_dir(kind, q_pct, s_pct)
    if action == "控拥挤":
        d = consensus_dir(kind, q_pct, s_pct)
        return -d if d != 0 else 0.0
    if action == "补风格":
        return heavy_dir(q_pct, s_pct)
    if action == "观望":
        if divergence_follow == "subj" and s_pct != 0:
            return 1.0 if s_pct > 0 else -1.0
        if divergence_follow == "quant" and q_pct != 0:
            return 1.0 if q_pct > 0 else -1.0
    return 0.0


def trade_cost(notional_abs: float, lots_abs: float) -> tuple[float, float]:
    if notional_abs <= 0 or lots_abs <= 0:
        return 0.0, 0.0
    comm = max(notional_abs * COMM_RATE, lots_abs * FEE_FLOOR_YUAN)
    slip = notional_abs * SLIP_RATE
    return comm, slip


def _price_on(close: pd.DataFrame, dt: str, prod: str) -> float:
    if prod not in close.columns:
        return 0.0
    if dt in close.index:
        v = close.at[dt, prod]
        if pd.notna(v) and float(v) > 0:
            return float(v)
    loc = int(close.index.searchsorted(dt, side="right")) - 1
    if loc < 0:
        return 0.0
    v = close.iat[loc, close.columns.get_loc(prod)]
    return float(v) if pd.notna(v) and float(v) > 0 else 0.0


def _sigma_on(clean: pd.DataFrame, dt: str, prod: str, vol_days=20) -> float:
    if prod not in clean.columns:
        return 0.0
    idx = int(clean.index.searchsorted(dt, side="right")) - 1
    if idx < 2:
        return 0.0
    start = max(0, idx - vol_days)
    w = clean.iloc[start:idx][prod].to_numpy(dtype=float)
    w = w[w != 0]
    if len(w) < 2:
        return 0.0
    return float(np.std(w, ddof=1))


def size_book(
    targets: list[dict],
    equity: float,
    close: pd.DataFrame,
    clean: pd.DataFrame,
    as_of: str,
    slot_count: int | None = None,
) -> dict[str, dict]:
    if equity <= 0 or not targets:
        return {}
    ranked = sorted(targets, key=lambda x: -abs(x.get("strength", 1.0)))[:MAX_NAMES]
    n = slot_count if slot_count and slot_count > 0 else len(ranked)
    budget = equity * TARGET_GROSS_LEV / n
    raw = {}
    for t in ranked:
        p = t["product"]
        px = _price_on(close, as_of, p)
        mult = multiplier(p)
        if px <= 0 or mult <= 0:
            continue
        point = px * mult
        sigma = _sigma_on(clean, as_of, p)
        notional = budget
        if sigma > 1e-6:
            cap = equity * RISK_CAP_NAV / sigma
            notional = min(notional, cap)
        lots = int(round(notional / point))
        if lots <= 0 or point < MIN_LOT_NOTIONAL and lots * point < MIN_LOT_NOTIONAL:
            if point <= equity * 0.08:
                lots = 1
            else:
                continue
        signed = int(lots * (1 if t["dir"] > 0 else -1))
        raw[p] = {
            "product": p,
            "name": t["name"],
            "sector": t["sector"],
            "action": t["action"],
            "kind": t["kind"],
            "dir": t["dir"],
            "lots": signed,
            "price": px,
            "mult": mult,
            "notional": abs(signed) * point,
            "margin": abs(signed) * point * margin_rate(p),
            "sigma": sigma,
            "q_pct": t["q_pct"],
            "s_pct": t["s_pct"],
        }
    margin = sum(v["margin"] for v in raw.values())
    cap = equity * MAX_MARGIN_UTIL
    if margin > cap > 0:
        scale = cap / margin
        for p, v in list(raw.items()):
            lots = int(math.trunc(abs(v["lots"]) * scale))
            if lots <= 0:
                del raw[p]
                continue
            signed = lots * (1 if v["lots"] > 0 else -1)
            point = v["price"] * v["mult"]
            v["lots"] = signed
            v["notional"] = abs(signed) * point
            v["margin"] = abs(signed) * point * margin_rate(p)
    return raw


def run_account(
    sig: pd.DataFrame,
    close: pd.DataFrame,
    ret_wide: pd.DataFrame,
    clean: pd.DataFrame,
    include_bufengge: bool = True,
    allowed_actions: set[str] | None = None,
    divergence_follow: str | None = None,
    roll=None,
) -> dict:
    by_date = {d: g for d, g in sig.groupby("date")}
    signal_dates = sorted(by_date)
    equity = START_EQUITY
    prev_pos: dict[str, dict] = {}
    daily_rows = []
    hold_rows = []
    trade_rows = []
    peak = START_EQUITY

    for dt in signal_dates:
        loc = int(ret_wide.index.searchsorted(dt, side="right"))
        if loc >= len(ret_wide.index):
            break
        nxt = str(ret_wide.index[loc])
        g = by_date[dt]
        targets = []
        for r in g.itertuples(index=False):
            if allowed_actions is not None and r.action not in allowed_actions:
                d = 0.0
            elif (not include_bufengge) and r.action == "补风格":
                d = 0.0
            else:
                d = signal_trade_dir(r.action, r.kind, r.q_pct, r.s_pct, divergence_follow)
            if d == 0:
                continue
            targets.append({
                "product": r.product,
                "name": r.name,
                "sector": r.sector,
                "action": r.action,
                "kind": r.kind,
                "dir": d,
                "q_pct": r.q_pct,
                "s_pct": r.s_pct,
                "strength": abs(r.q_pct) + abs(r.s_pct),
            })
        book = size_book(targets, equity, close, clean, dt)

        comm = slip = roll_comm = roll_slip = 0.0
        n_rolls = 0
        names = set(book) | set(prev_pos)
        for p in names:
            old_pos = prev_pos.get(p) or {}
            new_pos = book.get(p) or {}
            old = old_pos.get("lots", 0)
            new = new_pos.get("lots", 0)
            old_c = old_pos.get("contract") or (roll.contract_on(p, dt) if roll else "")
            new_c = ""
            if roll:
                new_c = roll.contract_on(p, nxt) or roll.contract_on(p, dt) or old_c
                if new and new_c:
                    book[p] = dict(book[p])
                    book[p]["contract"] = new_c
            rolled = bool(roll and old and new and old_c and new_c and old_c != new_c)

            if rolled:
                c1 = s1 = c2 = s2 = 0.0
                px_old = (roll.price(old_c, nxt) if roll else 0.0) or _price_on(close, nxt, p) or _price_on(close, dt, p)
                px_new = (roll.price(new_c, nxt) if roll else 0.0) or px_old
                if px_old > 0:
                    notion_old = abs(old) * px_old * multiplier(p)
                    c1, s1 = trade_cost(notion_old, abs(old))
                    comm += c1
                    slip += s1
                    roll_comm += c1
                    roll_slip += s1
                if px_new > 0:
                    notion_new = abs(new) * px_new * multiplier(p)
                    c2, s2 = trade_cost(notion_new, abs(new))
                    comm += c2
                    slip += s2
                    roll_comm += c2
                    roll_slip += s2
                    n_rolls += 1
                    spread = (px_new - px_old) if px_old and px_new else 0.0
                    trade_rows.append({
                        "signal_date": dt,
                        "trade_date": nxt,
                        "product": p,
                        "name": (book.get(p) or prev_pos.get(p) or {}).get("name", p),
                        "action": (book.get(p) or prev_pos.get(p) or {}).get("action", ""),
                        "side": "移仓",
                        "old_lots": old,
                        "new_lots": new,
                        "d_lots": new - old,
                        "price": px_new,
                        "notional": (abs(old) * px_old + abs(new) * px_new) * multiplier(p) if px_old and px_new else 0.0,
                        "commission": (c1 if px_old > 0 else 0.0) + (c2 if px_new > 0 else 0.0),
                        "slippage": (s1 if px_old > 0 else 0.0) + (s2 if px_new > 0 else 0.0),
                        "cost": (c1 + s1 if px_old > 0 else 0.0) + (c2 + s2 if px_new > 0 else 0.0),
                        "from_contract": old_c,
                        "to_contract": new_c,
                        "roll_spread": spread,
                    })
                continue

            d_lots = new - old
            if d_lots == 0:
                if new and roll and new_c and p in book:
                    book[p] = dict(book[p])
                    book[p]["contract"] = new_c or old_c
                continue
            px = _price_on(close, nxt, p) or _price_on(close, dt, p)
            if roll and new_c:
                px = roll.price(new_c, nxt) or roll.price(old_c or new_c, nxt) or px
            if px <= 0:
                continue
            notion = abs(d_lots) * px * multiplier(p)
            c, s = trade_cost(notion, abs(d_lots))
            comm += c
            slip += s
            side = "开/加" if old == 0 or (old * new > 0 and abs(new) > abs(old)) else ("减" if old * new > 0 else "反手/平")
            if new == 0:
                side = "平仓"
            trade_rows.append({
                "signal_date": dt,
                "trade_date": nxt,
                "product": p,
                "name": (book.get(p) or prev_pos.get(p) or {}).get("name", p),
                "action": (book.get(p) or prev_pos.get(p) or {}).get("action", ""),
                "side": side,
                "old_lots": old,
                "new_lots": new,
                "d_lots": d_lots,
                "price": px,
                "notional": notion,
                "commission": c,
                "slippage": s,
                "cost": c + s,
                "from_contract": old_c or "",
                "to_contract": new_c or old_c or "",
                "roll_spread": None,
            })

        gross = 0.0
        n_live = 0
        for p, pos in book.items():
            if p not in ret_wide.columns:
                continue
            held = pos.get("contract") or (roll.contract_on(p, nxt) if roll else "")
            prev_c = (prev_pos.get(p) or {}).get("contract") or held
            mark_from = (prev_pos.get(p) or {}).get("mark_date") or dt
            r = None
            if roll and prev_c:
                r = roll.contract_ret(prev_c, mark_from, nxt)
            if r is None:
                # No fake continuous jump: prefer cleaned return on missing contract path
                src = clean if roll is not None else ret_wide
                if nxt in src.index and p in src.columns:
                    raw = src.at[nxt, p]
                    r = None if pd.isna(raw) else float(raw)
            if r is None:
                continue
            px = pos["price"] or _price_on(close, nxt, p)
            if roll and held:
                px = roll.price(held, nxt) or roll.price(prev_c, nxt) or px
            notion = abs(pos["lots"]) * (_price_on(close, nxt, p) or px) * pos["mult"]
            if roll and held and roll.price(held, nxt):
                notion = abs(pos["lots"]) * roll.price(held, nxt) * pos["mult"]
            pnl = (1 if pos["lots"] > 0 else -1) * notion * float(r)
            pos = dict(pos)
            pos["pnl"] = pnl
            pos["ret"] = float(r)
            pos["notional"] = notion
            pos["margin"] = notion * margin_rate(p)
            pos["contract"] = held or prev_c
            pos["mark_date"] = nxt
            pos["price"] = px
            book[p] = pos
            gross += pnl
            n_live += 1
            hold_rows.append({
                "signal_date": dt,
                "hold_date": nxt,
                "product": p,
                "name": pos["name"],
                "sector": pos["sector"],
                "action": pos["action"],
                "kind": pos["kind"],
                "dir": "多" if pos["lots"] > 0 else "空",
                "lots": pos["lots"],
                "price": px,
                "mult": pos["mult"],
                "notional": notion,
                "margin": pos["margin"],
                "q_pct": pos["q_pct"],
                "s_pct": pos["s_pct"],
                "pnl": pnl,
                "ret": float(r),
                "contract": pos.get("contract", ""),
            })

        cost = comm + slip
        net = gross - cost
        equity = equity + net
        peak = max(peak, equity)
        daily_rows.append({
            "signal_date": dt,
            "return_date": nxt,
            "equity": equity,
            "pnl_gross": gross,
            "commission": comm,
            "slippage": slip,
            "cost": cost,
            "pnl_net": net,
            "ret": net / (equity - net) if (equity - net) > 0 else 0.0,
            "n": n_live,
            "n_signals": len(targets),
            "gross_notional": sum(abs(v["notional"]) for v in book.values()),
            "margin": sum(v["margin"] for v in book.values()),
            "margin_util": (sum(v["margin"] for v in book.values()) / equity) if equity > 0 else 0.0,
            "turnover_notional": sum(abs(r["notional"]) for r in trade_rows if r["signal_date"] == dt),
            "roll_cost": roll_comm + roll_slip,
            "n_rolls": n_rolls,
        })
        prev_pos = book

    return _finalize_account(daily_rows, hold_rows, trade_rows, include_bufengge=include_bufengge)


def _finalize_account(daily_rows, hold_rows, trade_rows, **extra) -> dict:
    daily = pd.DataFrame(daily_rows)
    holds = pd.DataFrame(hold_rows)
    trades = pd.DataFrame(trade_rows)
    if not daily.empty:
        daily["dd"] = daily["equity"] / daily["equity"].cummax() - 1.0
        daily["nav"] = daily["equity"] / START_EQUITY
        daily["cum_cost"] = daily["cost"].cumsum()
        daily["cum_gross"] = daily["pnl_gross"].cumsum()
        daily["cum_net"] = daily["pnl_net"].cumsum()
    out = {"daily": daily, "holds": holds, "trades": trades}
    out.update(extra)
    return out


def run_account_fixed_hold(
    sig: pd.DataFrame,
    close: pd.DataFrame,
    ret_wide: pd.DataFrame,
    clean: pd.DataFrame,
    hold_days: int = 10,
    allowed_actions: set[str] | None = None,
    include_bufengge: bool = False,
    divergence_follow: str | None = None,
) -> dict:
    """Enter on allowed signals, freeze lots, hold `hold_days` trading sessions, then exit.

    Same product is not pyramided while a hold is live. Opposite-direction signal
    flattens and re-enters. Calendar is futures sessions in ``ret_wide``.
    """
    if hold_days < 1:
        raise ValueError("hold_days must be >= 1")
    allowed = allowed_actions if allowed_actions is not None else {"加码"}
    cal = [str(x) for x in ret_wide.index]
    if not cal:
        return _finalize_account([], [], [], hold_days=hold_days)

    by_date = {str(d): g for d, g in sig.groupby("date")}
    equity = START_EQUITY
    open_pos: dict[str, dict] = {}
    daily_rows = []
    hold_rows = []
    trade_rows = []

    first_sig = min(by_date) if by_date else cal[0]
    start_i = int(np.searchsorted(cal, first_sig, side="left"))
    start_i = min(max(start_i, 0), len(cal) - 1)

    for i in range(start_i, len(cal)):
        today = cal[i]
        prev_day = cal[i - 1] if i > 0 else today
        comm = slip = 0.0

        # Signals dated prev_day (known at that close) enter on today's session.
        new_targets = []
        if prev_day in by_date:
            for r in by_date[prev_day].itertuples(index=False):
                if r.action not in allowed:
                    continue
                if (not include_bufengge) and r.action == "补风格":
                    continue
                d = signal_trade_dir(r.action, r.kind, r.q_pct, r.s_pct, divergence_follow)
                if d == 0:
                    continue
                old = open_pos.get(r.product)
                if old is not None:
                    old_dir = 1.0 if old["lots"] > 0 else -1.0
                    if old_dir == d:
                        continue
                    px = _price_on(close, today, r.product) or old.get("price", 0.0)
                    if px > 0:
                        notion = abs(old["lots"]) * px * multiplier(r.product)
                        c, s = trade_cost(notion, abs(old["lots"]))
                        comm += c
                        slip += s
                        trade_rows.append({
                            "signal_date": prev_day,
                            "trade_date": today,
                            "product": r.product,
                            "name": old.get("name", r.product),
                            "action": old.get("action", ""),
                            "side": "反手/平",
                            "old_lots": old["lots"],
                            "new_lots": 0,
                            "d_lots": -old["lots"],
                            "price": px,
                            "notional": notion,
                            "commission": c,
                            "slippage": s,
                            "cost": c + s,
                        })
                    del open_pos[r.product]
                if r.product in open_pos or len(open_pos) + len(new_targets) >= MAX_NAMES:
                    continue
                if any(t["product"] == r.product for t in new_targets):
                    continue
                new_targets.append({
                    "product": r.product,
                    "name": r.name,
                    "sector": r.sector,
                    "action": r.action,
                    "kind": r.kind,
                    "dir": d,
                    "q_pct": r.q_pct,
                    "s_pct": r.s_pct,
                    "strength": abs(r.q_pct) + abs(r.s_pct),
                    "signal_date": prev_day,
                })

        if new_targets:
            slots = max(len(open_pos) + len(new_targets), 1)
            sized = size_book(new_targets, equity, close, clean, prev_day, slot_count=slots)
            for p, pos in sized.items():
                if p in open_pos:
                    continue
                pos = dict(pos)
                pos["remaining"] = hold_days
                pos["signal_date"] = next(t["signal_date"] for t in new_targets if t["product"] == p)
                pos["entry_date"] = today
                px = _price_on(close, today, p) or pos["price"]
                lots = pos["lots"]
                if px > 0 and lots != 0:
                    notion = abs(lots) * px * multiplier(p)
                    c, s = trade_cost(notion, abs(lots))
                    comm += c
                    slip += s
                    trade_rows.append({
                        "signal_date": pos["signal_date"],
                        "trade_date": today,
                        "product": p,
                        "name": pos["name"],
                        "action": pos["action"],
                        "side": "开/加",
                        "old_lots": 0,
                        "new_lots": lots,
                        "d_lots": lots,
                        "price": px,
                        "notional": notion,
                        "commission": c,
                        "slippage": s,
                        "cost": c + s,
                    })
                open_pos[p] = pos

        gross = 0.0
        n_live = 0
        to_close = []
        for p, pos in open_pos.items():
            if p not in ret_wide.columns:
                pos["remaining"] = pos.get("remaining", hold_days) - 1
                if pos["remaining"] <= 0:
                    to_close.append(p)
                continue
            r = ret_wide.at[today, p] if today in ret_wide.index else np.nan
            if pd.isna(r):
                pos["remaining"] = pos.get("remaining", hold_days) - 1
                if pos["remaining"] <= 0:
                    to_close.append(p)
                continue
            px = _price_on(close, today, p) or pos["price"]
            notion = abs(pos["lots"]) * (px or pos["price"]) * pos["mult"]
            pnl = (1 if pos["lots"] > 0 else -1) * notion * float(r)
            pos = dict(pos)
            pos["pnl"] = pnl
            pos["ret"] = float(r)
            pos["notional"] = notion
            pos["margin"] = notion * margin_rate(p)
            pos["price"] = px
            pos["remaining"] = pos.get("remaining", hold_days) - 1
            open_pos[p] = pos
            gross += pnl
            n_live += 1
            hold_rows.append({
                "signal_date": pos.get("signal_date", ""),
                "entry_date": pos.get("entry_date", ""),
                "hold_date": today,
                "product": p,
                "name": pos["name"],
                "sector": pos["sector"],
                "action": pos["action"],
                "kind": pos["kind"],
                "dir": "多" if pos["lots"] > 0 else "空",
                "lots": pos["lots"],
                "price": px,
                "mult": pos["mult"],
                "notional": notion,
                "margin": pos["margin"],
                "q_pct": pos["q_pct"],
                "s_pct": pos["s_pct"],
                "pnl": pnl,
                "ret": float(r),
                "remaining_after": pos["remaining"],
            })
            if pos["remaining"] <= 0:
                to_close.append(p)

        for p in to_close:
            pos = open_pos.pop(p, None)
            if not pos:
                continue
            px = _price_on(close, today, p) or pos.get("price", 0.0)
            lots = pos["lots"]
            if px > 0 and lots != 0:
                notion = abs(lots) * px * multiplier(p)
                c, s = trade_cost(notion, abs(lots))
                comm += c
                slip += s
                trade_rows.append({
                    "signal_date": pos.get("signal_date", ""),
                    "trade_date": today,
                    "product": p,
                    "name": pos.get("name", p),
                    "action": pos.get("action", ""),
                    "side": "平仓",
                    "old_lots": lots,
                    "new_lots": 0,
                    "d_lots": -lots,
                    "price": px,
                    "notional": notion,
                    "commission": c,
                    "slippage": s,
                    "cost": c + s,
                })

        cost = comm + slip
        net = gross - cost
        if n_live == 0 and not new_targets and cost == 0 and not daily_rows:
            continue
        equity = equity + net
        daily_rows.append({
            "signal_date": prev_day,
            "return_date": today,
            "equity": equity,
            "pnl_gross": gross,
            "commission": comm,
            "slippage": slip,
            "cost": cost,
            "pnl_net": net,
            "ret": net / (equity - net) if (equity - net) > 0 else 0.0,
            "n": n_live,
            "n_signals": len(new_targets),
            "gross_notional": sum(abs(v.get("notional", 0.0)) for v in open_pos.values()),
            "margin": sum(v.get("margin", 0.0) for v in open_pos.values()),
            "margin_util": (sum(v.get("margin", 0.0) for v in open_pos.values()) / equity) if equity > 0 else 0.0,
            "turnover_notional": sum(
                abs(r["notional"]) for r in trade_rows if r["trade_date"] == today
            ),
        })
        future_signals = any(d in by_date for d in cal[i:])
        if not open_pos and not future_signals:
            break

    return _finalize_account(daily_rows, hold_rows, trade_rows, hold_days=hold_days, include_bufengge=include_bufengge)


def account_stats(daily: pd.DataFrame) -> dict:
    if daily.empty:
        return {}
    r = daily["ret"]
    n = len(r)
    years = n / 252.0
    start = START_EQUITY
    end = float(daily["equity"].iloc[-1])
    cagr = (end / start) ** (1 / years) - 1 if years > 0 and end > 0 else None
    vol = float(r.std(ddof=1) * math.sqrt(252)) if n > 1 else None
    sharpe = (float(r.mean()) / float(r.std(ddof=1)) * math.sqrt(252)) if n > 1 and r.std(ddof=1) > 0 else None
    maxdd = float(daily["dd"].min())
    maxdd_yuan = float((daily["equity"] - daily["equity"].cummax()).min())
    return {
        "start": start,
        "end": end,
        "pnl": end - start,
        "cagr": cagr,
        "vol": vol,
        "sharpe": sharpe,
        "maxdd": maxdd,
        "maxdd_yuan": maxdd_yuan,
        "hit": float((daily["pnl_net"] > 0).mean()),
        "n": n,
        "avg_names": float(daily["n"].mean()),
        "avg_margin": float(daily["margin"].mean()),
        "avg_util": float(daily["margin_util"].mean()),
        "avg_notional": float(daily["gross_notional"].mean()),
        "total_comm": float(daily["commission"].sum()),
        "total_slip": float(daily["slippage"].sum()),
        "total_cost": float(daily["cost"].sum()),
        "total_gross": float(daily["pnl_gross"].sum()),
        "calmar": (cagr / abs(maxdd)) if cagr is not None and maxdd else None,
    }


def fmt_yuan(v, signed=False):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return "—"
    n = float(v)
    sign = "+" if signed and n > 0 else ("−" if signed and n < 0 else ("-" if n < 0 else ""))
    a = abs(n)
    if a >= 1e8:
        return f"{sign}{a / 1e8:.2f}亿"
    if a >= 1e4:
        return f"{sign}{a / 1e4:.1f}万"
    return f"{sign}{a:,.0f}"


def draw_account_charts(acct: dict, chart_dir: Path, fp, apply_font, save_fig) -> dict:
    daily: pd.DataFrame = acct["daily"]
    holds: pd.DataFrame = acct["holds"]
    C_NAVY, C_RED, C_GREEN, C_ORANGE, C_BLUE, C_GOLD = "#1A365D", "#C53030", "#2F855A", "#DD6B20", "#2B6CB0", "#C9A227"
    out = {}
    if daily.empty:
        return out
    x = pd.to_datetime(daily["return_date"])

    fig, ax = plt.subplots(figsize=(11.2, 5.2), dpi=160)
    ax.plot(x, daily["equity"] / 1e4, color=C_NAVY, lw=1.8, label="权益")
    ax.axhline(START_EQUITY / 1e4, color="#A0AEC0", ls="--", lw=1, label="起始 2,000 万")
    ax.set_title("2,000 万账户权益（扣手续费与滑点后）", fontsize=13, color=C_NAVY, **fp())
    ax.set_xlabel("日期", **fp())
    ax.set_ylabel("权益（万元）", **fp())
    ax.legend(frameon=False, fontsize=8)
    apply_font(ax)
    out["acct_equity"] = save_fig(fig, "acct_equity.png")

    fig, ax = plt.subplots(figsize=(11.2, 3.8), dpi=160)
    ax.fill_between(x, daily["dd"] * 100, 0, color=C_RED, alpha=0.35)
    ax.set_title("账户回撤", fontsize=13, color=C_NAVY, **fp())
    ax.set_ylabel("回撤（%）", **fp())
    apply_font(ax)
    out["acct_dd"] = save_fig(fig, "acct_dd.png")

    fig, ax = plt.subplots(figsize=(11.2, 4.4), dpi=160)
    ax.plot(x, daily["cum_gross"] / 1e4, color=C_BLUE, lw=1.5, label="累计毛盈亏")
    ax.plot(x, daily["cum_cost"] / 1e4, color=C_ORANGE, lw=1.5, label="累计交易费用")
    ax.plot(x, daily["cum_net"] / 1e4, color=C_NAVY, lw=1.8, label="累计净盈亏")
    ax.axhline(0, color="#4A5568", lw=0.8)
    ax.set_title("毛盈亏 vs 手续费+滑点 vs 净盈亏", fontsize=13, color=C_NAVY, **fp())
    ax.set_ylabel("万元", **fp())
    ax.legend(frameon=False, fontsize=8)
    apply_font(ax)
    out["acct_cost"] = save_fig(fig, "acct_cost.png")

    fig, ax = plt.subplots(figsize=(11.2, 4.2), dpi=160)
    ax.plot(x, daily["margin"] / 1e4, color=C_NAVY, lw=1.4, label="保证金占用")
    ax.plot(x, daily["gross_notional"] / 1e4, color=C_ORANGE, lw=1.2, label="名义本金")
    ax.set_title("保证金与名义本金", fontsize=13, color=C_NAVY, **fp())
    ax.set_ylabel("万元", **fp())
    ax.legend(frameon=False, fontsize=8)
    apply_font(ax)
    out["acct_margin"] = save_fig(fig, "acct_margin.png")

    fig, ax = plt.subplots(figsize=(11.2, 3.6), dpi=160)
    ax.plot(x, daily["n"], color=C_NAVY, lw=1.3)
    ax.set_title("每日持仓品种数", fontsize=13, color=C_NAVY, **fp())
    ax.set_ylabel("个数", **fp())
    apply_font(ax)
    out["acct_n"] = save_fig(fig, "acct_n.png")

    fig, ax = plt.subplots(figsize=(11.2, 4.6), dpi=160)
    s = daily.set_index(pd.to_datetime(daily["return_date"]))["pnl_net"].resample("ME").sum()
    colors = [C_RED if v >= 0 else C_GREEN for v in s.values]
    ax.bar(s.index, s.values / 1e4, width=20, color=colors, align="center")
    ax.axhline(0, color="#4A5568", lw=0.8)
    ax.set_title("账户月度净盈亏", fontsize=13, color=C_NAVY, **fp())
    ax.set_ylabel("万元", **fp())
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    apply_font(ax)
    out["acct_monthly"] = save_fig(fig, "acct_monthly.png")

    if not holds.empty:
        fig, ax = plt.subplots(figsize=(11.2, 5.0), dpi=160)
        by_act = holds.groupby("action")["pnl"].sum().sort_values()
        colors = [C_RED if v >= 0 else C_GREEN for v in by_act.values]
        ax.barh(by_act.index, by_act.values / 1e4, color=colors)
        ax.axvline(0, color="#4A5568", lw=0.8)
        ax.set_title("按信号动作归属的累计毛盈亏（持仓市值×当日涨跌）", fontsize=13, color=C_NAVY, **fp())
        ax.set_xlabel("万元", **fp())
        apply_font(ax)
        out["acct_by_action"] = save_fig(fig, "acct_by_action.png")

        fig, ax = plt.subplots(figsize=(11.2, 5.6), dpi=160)
        by_p = holds.groupby("name")["pnl"].sum().sort_values()
        top = pd.concat([by_p.head(8), by_p.tail(8)]).drop_duplicates()
        colors = [C_RED if v >= 0 else C_GREEN for v in top.values]
        ax.barh(top.index, top.values / 1e4, color=colors)
        ax.axvline(0, color="#4A5568", lw=0.8)
        ax.set_title("品种累计毛盈亏：最亏 8 个与最赚 8 个", fontsize=13, color=C_NAVY, **fp())
        ax.set_xlabel("万元", **fp())
        apply_font(ax)
        out["acct_by_prod"] = save_fig(fig, "acct_by_prod.png")

    return out
