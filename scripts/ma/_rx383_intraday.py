# -*- coding: utf-8 -*-
"""Where RX383's sells sit on the 5-minute tape, against the other bars that session."""
from __future__ import annotations

import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _generate_rx319_profile_word_report as prof  # noqa: E402
from cn_market_holidays import is_cn_market_closed  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports" / "_rx383_option_strategy"
CACHE = OUT / "bars5min.csv"
EMPTY = OUT / "bars5min_empty.json"
CHART = OUT / "charts"

# Eastmoney futsse ids. Option ids are a different board from the futures.
_FUT_MKT = {"SHFE": 113, "DCE": 114, "CZCE": 115, "CFFEX": 220, "GFEX": 225}
_OPT_MKT = {"SHFE": 151, "DCE": 140, "CZCE": 141, "CFFEX": 221, "GFEX": 226}
_EXCHANGE = {
    "A": "DCE", "B": "DCE", "C": "DCE", "CS": "DCE", "EB": "DCE", "EG": "DCE",
    "I": "DCE", "J": "DCE", "JD": "DCE", "JM": "DCE", "L": "DCE", "LH": "DCE",
    "M": "DCE", "P": "DCE", "PG": "DCE", "PP": "DCE", "V": "DCE", "Y": "DCE",
    "AG": "SHFE", "AL": "SHFE", "AO": "SHFE", "AU": "SHFE", "BR": "SHFE", "BU": "SHFE",
    "CU": "SHFE", "FU": "SHFE", "HC": "SHFE", "NI": "SHFE", "PB": "SHFE", "RB": "SHFE",
    "RU": "SHFE", "SN": "SHFE", "SP": "SHFE", "SS": "SHFE", "ZN": "SHFE",
    "AP": "CZCE", "CF": "CZCE", "CJ": "CZCE", "CY": "CZCE", "FG": "CZCE", "MA": "CZCE",
    "OI": "CZCE", "PF": "CZCE", "PK": "CZCE", "PX": "CZCE", "RM": "CZCE", "SA": "CZCE",
    "SF": "CZCE", "SH": "CZCE", "SM": "CZCE", "SR": "CZCE", "TA": "CZCE", "UR": "CZCE",
    "LC": "GFEX", "PS": "GFEX", "SI": "GFEX",
    "HO": "CFFEX", "IO": "CFFEX", "MO": "CFFEX", "IH": "CFFEX", "IF": "CFFEX", "IM": "CFFEX",
}
_UNDER = {"HO": "IH", "IO": "IF", "MO": "IM"}
_UA = {"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"}
_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"


def _next_after(day: date) -> date:
    d = day + timedelta(days=1)
    while is_cn_market_closed(d):
        d += timedelta(days=1)
    return d


def _prev_on_or_before(day: date) -> date:
    d = day
    while is_cn_market_closed(d):
        d -= timedelta(days=1)
    return d


def bar_trading_day(ts: pd.Timestamp) -> date:
    """Night session on the calendar evening belongs to the next trading day."""
    d = ts.date()
    if ts.hour >= 20:
        return _next_after(d)
    if ts.hour < 8:
        return _next_after(d - timedelta(days=1))
    return d


def fill_stamp(trading_day: date, hour: int, minute: int, second: int) -> pd.Timestamp | None:
    """Wall-clock time of a fill whose 交易日期 is the exchange trading day."""
    if hour >= 20:
        cal = _prev_on_or_before(trading_day - timedelta(days=1))
    elif hour < 8:
        cal = _prev_on_or_before(trading_day - timedelta(days=1)) + timedelta(days=1)
    elif hour >= 16:
        return None
    else:
        cal = trading_day
    return pd.Timestamp(datetime(cal.year, cal.month, cal.day, hour, minute, second))


def _hms(value) -> tuple[int, int, int] | None:
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    if hasattr(value, "hour") and not isinstance(value, pd.Timestamp):
        return int(value.hour), int(value.minute), int(value.second)
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "nat"}:
        return None
    parts = text.replace(".", ":").split(":")
    if len(parts) < 2:
        return None
    try:
        second = int(float(parts[2])) if len(parts) > 2 else 0
        return int(parts[0]), int(parts[1]), second
    except ValueError:
        return None


def _code(product: str, month: str, cp: str | None = None, strike: float | None = None) -> str:
    exchange = _EXCHANGE.get(product, "")
    strike_s = "" if strike is None else str(int(strike)) if float(strike).is_integer() else str(strike)
    if cp is None:
        root = _UNDER.get(product, product)
        if exchange in {"CZCE", "CFFEX"}:
            return f"{root.upper()}{month}"
        return f"{root.lower()}{month}"
    if exchange == "GFEX":
        return f"{product.lower()}{month}-{cp}-{strike_s}"
    if exchange == "CFFEX":
        return f"{product.upper()}{month}-{cp}-{strike_s}"
    if exchange == "CZCE":
        return f"{product.upper()}{month}{cp}{strike_s}"
    return f"{product.lower()}{month}{cp}{strike_s}"


def secid_future(product: str, month: str) -> str | None:
    root = _UNDER.get(product, product)
    exchange = _EXCHANGE.get(root) or _EXCHANGE.get(product)
    if not exchange:
        return None
    return f"{_FUT_MKT[exchange]}.{_code(product, month)}"


def secid_option(product: str, month: str, cp: str, strike: float) -> str | None:
    exchange = _EXCHANGE.get(product)
    if not exchange:
        return None
    return f"{_OPT_MKT[exchange]}.{_code(product, month, cp, strike)}"


def _fetch_one(secid: str) -> pd.DataFrame:
    params = {
        "secid": secid, "klt": "5", "fqt": "1",
        "beg": "20261001", "end": "20261106", "lmt": "2000",
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57",
    }
    last = None
    for _ in range(2):
        try:
            payload = requests.get(_URL, params=params, headers=_UA, timeout=20).json()
            rows = ((payload.get("data") or {}).get("klines")) or []
            if not rows:
                return pd.DataFrame(columns=["secid", "bar_time", "raw_close", "volume", "amount"])
            parsed = []
            for line in rows:
                parts = str(line).split(",")
                if len(parts) < 6:
                    continue
                parsed.append((
                    secid,
                    pd.Timestamp(parts[0]),
                    float(parts[2]),
                    float(parts[5]),
                    float(parts[6]) if len(parts) > 6 else float("nan"),
                ))
            return pd.DataFrame(parsed, columns=["secid", "bar_time", "raw_close", "volume", "amount"])
        except Exception as exc:  # noqa: BLE001
            last = exc
    raise RuntimeError(f"{secid}: {last}")


def load_bars(secids: list[str]) -> pd.DataFrame:
    """Local cache first. A secid that comes back empty is remembered and not requested again."""
    wanted = [s for s in dict.fromkeys(secids) if s]
    cached = pd.read_csv(CACHE, parse_dates=["bar_time"]) if CACHE.is_file() else pd.DataFrame(
        columns=["secid", "bar_time", "raw_close", "volume", "amount"]
    )
    if not cached.empty and "amount" not in cached.columns:
        cached = cached.iloc[0:0]
    empty = set(json.loads(EMPTY.read_text(encoding="utf-8"))) if EMPTY.is_file() else set()
    have = set(cached["secid"]) if not cached.empty else set()
    missing = [s for s in wanted if s not in have and s not in empty]
    frames = [cached] if not cached.empty else []
    if missing:
        fetched = []
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(_fetch_one, s): s for s in missing}
            for fut in as_completed(futures):
                secid = futures[fut]
                try:
                    frame = fut.result()
                except Exception as exc:  # noqa: BLE001
                    print("BAR FAIL", secid, exc)
                    continue
                if frame.empty:
                    empty.add(secid)
                else:
                    fetched.append(frame)
        if fetched:
            frames.append(pd.concat(fetched, ignore_index=True))
        OUT.mkdir(parents=True, exist_ok=True)
        merged = pd.concat(frames, ignore_index=True) if frames else cached
        merged = merged.drop_duplicates(["secid", "bar_time"]).sort_values(["secid", "bar_time"])
        merged.to_csv(CACHE, index=False)
        EMPTY.write_text(json.dumps(sorted(empty), ensure_ascii=False), encoding="utf-8")
        cached = merged
    if cached.empty:
        return cached
    cached = cached[cached["secid"].isin(wanted)].copy()
    cached["bar_time"] = pd.to_datetime(cached["bar_time"])
    cached["trading_day"] = cached["bar_time"].map(bar_trading_day)
    return _repair_prices(cached)


_LADDER = np.array([1, 2, 5, 10, 15, 16, 20, 50, 60, 100, 200, 300, 500, 1000], dtype=float)


def _snap_mult(value: float) -> float:
    """Contract multiplier, when turnover / (quote × volume) lands on a listed size."""
    if not math.isfinite(value) or value <= 0:
        return float("nan")
    idx = int(np.argmin(np.abs(np.log(_LADDER / value))))
    if abs(math.log(_LADDER[idx] / value)) < math.log(1.08):
        return float(_LADDER[idx])
    return float("nan")


def _repair_prices(bars: pd.DataFrame) -> pd.DataFrame:
    """The long history's open/high/low does not match its turnover. The bar is turnover / volume / multiplier.

    The multiplier is read from the bars whose own close does agree with that turnover.
    """
    if bars.empty:
        return bars
    pieces = []
    for secid, g in bars.groupby("secid", sort=False):
        g = g.copy()
        vol = g["volume"].to_numpy(float)
        amt = g["amount"].to_numpy(float)
        raw = g["raw_close"].to_numpy(float)
        with np.errstate(divide="ignore", invalid="ignore"):
            guess = np.divide(amt, vol * raw, out=np.full(len(g), np.nan), where=(vol > 0) & (raw > 0))
        snapped = [_snap_mult(float(v)) for v in guess if math.isfinite(v)]
        snapped = [v for v in snapped if math.isfinite(v)]
        if not snapped:
            continue
        mult = max(set(snapped), key=snapped.count)
        with np.errstate(divide="ignore", invalid="ignore"):
            px = np.divide(amt, vol * mult, out=np.full(len(g), np.nan), where=vol > 0)
        g["close"] = px
        g = g[np.isfinite(g["close"]) & (g["close"] > 0)]
        if g.empty:
            continue
        g["open"] = g["close"]
        g["high"] = g["close"]
        g["low"] = g["close"]
        pieces.append(g)
    return pd.concat(pieces, ignore_index=True) if pieces else bars.iloc[0:0]


def _rank(value: float, pop: np.ndarray) -> float:
    pop = pop[np.isfinite(pop)]
    if len(pop) < 6 or not math.isfinite(value):
        return float("nan")
    return float(np.mean(pop <= value))


def _wmedian(values: np.ndarray, weights: np.ndarray) -> float:
    mask = np.isfinite(values) & np.isfinite(weights) & (weights > 0)
    if not mask.any():
        return float("nan")
    order = np.argsort(values[mask])
    v = values[mask][order]
    w = weights[mask][order]
    cut = np.cumsum(w)
    return float(v[int(np.searchsorted(cut, 0.5 * cut[-1], side="left"))])


def _top_share(frame: pd.DataFrame, col: str) -> float:
    if frame.empty or col not in frame:
        return float("nan")
    s = pd.to_numeric(frame[col], errors="coerce").dropna()
    if s.empty:
        return float("nan")
    return float((s >= 0.9).mean())


def _median(series: pd.Series) -> float:
    s = pd.to_numeric(series, errors="coerce")
    return float(s.median()) if s.notna().any() else float("nan")


def _attach_path(bars: pd.DataFrame) -> pd.DataFrame:
    """Range so far, completed-session range, and the move over the next 12 bars."""
    pieces = []
    for _, g in bars.groupby("secid", sort=False):
        g = g.sort_values("bar_time").copy()
        times = g["bar_time"].to_numpy(dtype="datetime64[ns]")
        days = g["trading_day"].to_numpy()
        high = g["high"].to_numpy(float)
        low = g["low"].to_numpy(float)
        close = g["close"].to_numpy(float)
        n = len(g)
        run_pos = np.full(n, np.nan)
        full_pos = np.full(n, np.nan)
        fwd = np.full(n, np.nan)
        for day in pd.unique(days):
            idx = np.flatnonzero(days == day)
            if len(idx) < 8:
                continue
            hi = np.maximum.accumulate(high[idx])
            lo = np.minimum.accumulate(low[idx])
            span = hi - lo
            with np.errstate(divide="ignore", invalid="ignore"):
                run_pos[idx] = np.divide(close[idx] - lo, span, out=np.full(len(idx), np.nan), where=span > 0)
            span_all = float(np.nanmax(high[idx]) - np.nanmin(low[idx]))
            if span_all > 0:
                full_pos[idx] = (close[idx] - float(np.nanmin(low[idx]))) / span_all
        for i in range(n):
            j = i + 12
            if j >= n or days[j] != days[i]:
                continue
            gap_min = (times[j] - times[i]) / np.timedelta64(1, "m")
            if gap_min <= 200 and close[i] > 0:
                fwd[i] = close[j] / close[i] - 1.0
        g["run_pos"] = run_pos
        g["full_pos"] = full_pos
        g["fwd"] = fwd
        pieces.append(g)
    return pd.concat(pieces, ignore_index=True) if pieces else bars


def _match_bar(times: np.ndarray, stamp: pd.Timestamp) -> int | None:
    if times is None or len(times) == 0 or stamp is None:
        return None
    needle = np.datetime64(stamp.to_datetime64())
    idx = int(np.searchsorted(times, needle, side="left"))
    if idx >= len(times):
        return None
    gap = (times[idx] - needle) / np.timedelta64(1, "m")
    if gap < 0 or gap > 6:
        return None
    return idx


def _iv_frame(fut: pd.DataFrame, opt: pd.DataFrame, product: str, month: str, cp: str, strike: float) -> pd.DataFrame:
    import _rx383_combined_report as rep

    expiry = rep.option_expiry(product, month)
    if expiry is None or fut.empty or opt.empty:
        return pd.DataFrame()
    joined = opt.merge(fut[["bar_time", "close"]], on="bar_time", suffixes=("_opt", "_fut"))
    if joined.empty:
        return joined
    ivs = []
    for r in joined.itertuples(index=False):
        dte = (expiry - pd.Timestamp(r.trading_day).date()).days
        if dte <= 1 or not (r.close_opt > 0) or not (r.close_fut > 0):
            ivs.append(np.nan)
            continue
        try:
            iv = rep._implied_vol(float(r.close_fut), strike, dte / 365.0, float(r.close_opt), cp) * 100.0
        except Exception:  # noqa: BLE001
            iv = np.nan
        ivs.append(iv if math.isfinite(iv) and 1.0 < iv < 300.0 else np.nan)
    joined["iv"] = ivs
    return joined


def analyze(opt: pd.DataFrame) -> dict:
    """Sell-opens in the account frame. One decision is one contract in one 5-minute bar."""
    sells = opt[opt["is_open"] & opt["is_sell"]].copy()
    sells["dt"] = pd.to_datetime(sells["dt"]).dt.date
    clock = sells["ttime"].map(_hms)
    sells["hour"] = clock.map(lambda x: x[0] if x else np.nan)
    batch = sells["hour"].between(16, 19, inclusive="both")
    live = sells.loc[~batch].copy()
    live["hms"] = live["ttime"].map(_hms)
    live = live[live["hms"].notna()].copy()
    live["stamp"] = [
        fill_stamp(d, h, m, s) for d, (h, m, s) in zip(live["dt"], live["hms"])
    ]
    live = live[live["stamp"].notna()].copy()
    live["fut_id"] = [secid_future(p, mo) for p, mo in zip(live["product"], live["month"])]
    live["opt_id"] = [
        secid_option(p, mo, cp, k) for p, mo, cp, k in zip(live["product"], live["month"], live["cp"], live["strike"])
    ]
    bars = load_bars([*(live["fut_id"].dropna().unique()), *(live["opt_id"].dropna().unique())])
    bars = _attach_path(bars) if not bars.empty else bars
    by_id = {}
    if not bars.empty:
        for secid, g in bars.groupby("secid", sort=False):
            g = g.sort_values("bar_time")
            by_id[secid] = (g.reset_index(drop=True), g["bar_time"].to_numpy(dtype="datetime64[ns]"))

    rows = []
    for r in live.itertuples(index=False):
        fut = by_id.get(r.fut_id)
        hit = _match_bar(fut[1], r.stamp) if fut else None
        if hit is None:
            continue
        bar = fut[0].iloc[hit]
        if bar.trading_day != r.dt:
            continue
        rows.append({
            "dt": r.dt, "contract": r.contract, "product": r.product, "month": r.month,
            "cp": r.cp, "strike": float(r.strike), "lots": float(r.lots), "fill": float(r.price),
            "bar_time": bar.bar_time, "fut_id": r.fut_id, "opt_id": r.opt_id,
            "fut_close": float(bar.close), "fut_run": float(bar.run_pos), "fut_full": float(bar.full_pos),
            "fut_fwd": float(bar.fwd),
        })
    decisions = pd.DataFrame(rows)
    if not decisions.empty:
        decisions["px_lots"] = decisions["fill"] * decisions["lots"]
        decisions = decisions.groupby(["dt", "contract", "bar_time"], as_index=False).agg(
            product=("product", "first"), month=("month", "first"), cp=("cp", "first"),
            strike=("strike", "first"), lots=("lots", "sum"), px_lots=("px_lots", "sum"),
            fut_id=("fut_id", "first"), opt_id=("opt_id", "first"),
            fut_close=("fut_close", "first"), fut_run=("fut_run", "first"),
            fut_full=("fut_full", "first"), fut_fwd=("fut_fwd", "first"),
        )
        decisions["fill"] = decisions["px_lots"] / decisions["lots"]

    opt_bars: dict[tuple, pd.DataFrame] = {}
    if not decisions.empty:
        for (oid, product, month, cp, strike), grp in decisions.groupby(["opt_id", "product", "month", "cp", "strike"]):
            fut_id = secid_future(product, month)
            tape = by_id.get(oid)
            fut_tape = by_id.get(fut_id)
            if tape is None or fut_tape is None:
                continue
            days = set(grp["dt"])
            iv = _iv_frame(
                fut_tape[0][fut_tape[0]["trading_day"].isin(days)],
                tape[0][tape[0]["trading_day"].isin(days)],
                product, month, cp, float(strike),
            )
            if not iv.empty:
                opt_bars[(oid, product, month, cp, float(strike))] = iv

    def _opt_blank() -> dict:
        return {"opt_close": np.nan, "opt_run": np.nan, "opt_fwd": np.nan, "iv": np.nan, "iv_prior": np.nan, "bar_pos": np.nan, "rank_iv": np.nan, "rank_opt_fwd": np.nan}

    def _opt_row(r) -> dict:
        key = (r.opt_id, r.product, r.month, r.cp, float(r.strike))
        tape = opt_bars.get(key)
        if tape is None or tape.empty:
            return _opt_blank()
        day = tape[tape["trading_day"] == r.dt].sort_values("bar_time")
        if day.empty:
            return _opt_blank()
        times = day["bar_time"].to_numpy(dtype="datetime64[ns]")
        hit = _match_bar(times, pd.Timestamp(r.bar_time))
        if hit is None:
            return _opt_blank()
        bar = day.iloc[hit]
        close = day["close_opt"].to_numpy(float)
        high = day["high"].to_numpy(float) if "high" in day.columns else close
        low = day["low"].to_numpy(float) if "low" in day.columns else close
        # option frame from the merge keeps the option high/low under their original names
        if "high" not in day.columns:
            high = np.full(len(day), np.nan)
            low = high
        hi = np.maximum.accumulate(np.where(np.isfinite(high), high, close))
        lo = np.minimum.accumulate(np.where(np.isfinite(low), low, close))
        span = hi[hit] - lo[hit]
        run = (close[hit] - lo[hit]) / span if span > 0 else np.nan
        fwd = np.nan
        if hit + 12 < len(day):
            gap = (times[hit + 12] - times[hit]) / np.timedelta64(1, "m")
            if gap <= 200 and close[hit] > 0:
                fwd = close[hit + 12] / close[hit] - 1.0
        iv = day["iv"].to_numpy(float)
        prior = iv[:hit]
        prior = prior[np.isfinite(prior)]
        iv_prior = float(np.median(prior)) if len(prior) >= 6 else np.nan
        bar_pos = r.fill / float(close[hit]) - 1.0 if close[hit] > 0 else np.nan
        signed = np.full(len(day), np.nan)
        for j in range(len(day) - 12):
            gap = (times[j + 12] - times[j]) / np.timedelta64(1, "m")
            if gap <= 200 and close[j] > 0:
                signed[j] = close[j + 12] / close[j] - 1.0
        return {
            "opt_close": float(close[hit]), "opt_run": float(run) if math.isfinite(run) else np.nan,
            "opt_fwd": float(fwd) if math.isfinite(fwd) else np.nan,
            "iv": float(iv[hit]) if math.isfinite(iv[hit]) else np.nan,
            "iv_prior": iv_prior, "bar_pos": bar_pos if math.isfinite(bar_pos) else np.nan,
            "rank_iv": _rank(float(iv[hit]) if math.isfinite(iv[hit]) else float("nan"), iv),
            "rank_opt_fwd": _rank(float(fwd) if math.isfinite(fwd) else float("nan"), signed),
        }

    if not decisions.empty:
        extra = pd.DataFrame([_opt_row(r) for r in decisions.itertuples(index=False)])
        decisions = pd.concat([decisions.reset_index(drop=True), extra], axis=1)
        decisions["fav_run"] = np.where(decisions["cp"] == "C", decisions["fut_run"], 1.0 - decisions["fut_run"])
        decisions["fav_full"] = np.where(decisions["cp"] == "C", decisions["fut_full"], 1.0 - decisions["fut_full"])

    def _session_ranks(frame: pd.DataFrame, value_col: str, pop_builder) -> pd.Series:
        out = pd.Series(np.nan, index=frame.index, dtype=float)
        if frame.empty:
            return out
        for (_, _), idx in frame.groupby(["fut_id", "dt"]).groups.items():
            rows_ix = list(idx)
            pop = pop_builder(frame.loc[rows_ix])
            for i in rows_ix:
                out.loc[i] = _rank(float(frame.at[i, value_col]), pop)
        return out

    # Populations are the session bars, transformed the same way as the decision.
    def _fut_pop(kind: str, side: str, fut_id: str, day) -> np.ndarray:
        tape = by_id.get(fut_id)
        if tape is None:
            return np.array([])
        g = tape[0]
        g = g[g["trading_day"] == day]
        if kind == "run":
            base = g["run_pos"].to_numpy(float)
        elif kind == "full":
            base = g["full_pos"].to_numpy(float)
        else:
            base = np.abs(g["fwd"].to_numpy(float))
        if side == "P" and kind != "fwd":
            base = 1.0 - base
        return base

    if not decisions.empty:
        decisions["rank_run"] = [
            _rank(float(r.fav_run), _fut_pop("run", r.cp, r.fut_id, r.dt))
            for r in decisions.itertuples(index=False)
        ]
        decisions["rank_full"] = [
            _rank(float(r.fav_full), _fut_pop("full", r.cp, r.fut_id, r.dt))
            for r in decisions.itertuples(index=False)
        ]
        decisions["rank_fwd"] = [
            _rank(abs(float(r.fut_fwd)), _fut_pop("fwd", r.cp, r.fut_id, r.dt))
            for r in decisions.itertuples(index=False)
        ]
        decisions["iv_gap"] = decisions["iv"] - decisions["iv_prior"]

    def _null_median(kind: str) -> float:
        """Median rank of every bar, under the same definition, across sessions he sold."""
        if decisions.empty:
            return float("nan")
        ranks = []
        seen = set()
        for r in decisions.itertuples(index=False):
            key = (r.fut_id, r.dt, r.cp, kind)
            if key in seen:
                continue
            seen.add(key)
            pop = _fut_pop("fwd" if kind == "fwd" else kind, r.cp, r.fut_id, r.dt)
            pop = pop[np.isfinite(pop)]
            if len(pop) < 8:
                continue
            ranks.extend(_rank(float(v), pop) for v in pop)
        return float(np.median(ranks)) if ranks else float("nan")

    def _pack(col: str, null: float) -> dict:
        if decisions.empty or col not in decisions:
            return {"n": 0, "lots": 0.0, "median": float("nan"), "wmedian": float("nan"), "null": null}
        s = decisions[col]
        ok = s.notna()
        return {
            "n": int(ok.sum()),
            "lots": float(decisions.loc[ok, "lots"].sum()) if ok.any() else 0.0,
            "median": _median(s),
            "wmedian": _wmedian(s.to_numpy(float), decisions["lots"].to_numpy(float)),
            "null": null,
        }

    strangle = _strangle(decisions, by_id)
    iv_gap_his = _median(decisions["iv_gap"]) if not decisions.empty else float("nan")
    iv_gap_null = _iv_gap_null(decisions, opt_bars)
    charts = _charts(decisions)
    matched_lots = float(decisions["lots"].sum()) if not decisions.empty else 0.0
    opt_lots = float(decisions.loc[decisions["iv"].notna(), "lots"].sum()) if not decisions.empty else 0.0
    return {
        "sell_lots": float(sells["lots"].sum()),
        "batch_lots": float(sells.loc[batch, "lots"].sum()),
        "decisions": int(len(decisions)),
        "matched_lots": matched_lots,
        "unmatched_lots": float(live["lots"].sum()) - matched_lots,
        "opt_lots": opt_lots,
        "bar_pos": _median(decisions["bar_pos"]) if not decisions.empty else float("nan"),
        "run": _pack("rank_run", _null_median("run")),
        "full": _pack("rank_full", _null_median("full")),
        "fwd": _pack("rank_fwd", _null_median("fwd")),
        "iv": _pack("rank_iv", _column_null(decisions, opt_bars, "iv")),
        "opt_fwd": _pack("rank_opt_fwd", _fwd_null(decisions, opt_bars)),
        "iv_gap_his": iv_gap_his,
        "iv_gap_null": iv_gap_null,
        "strangle": strangle,
        "charts": charts,
        "top_run": _top_share(decisions, "rank_run"),
        "top_iv": _top_share(decisions, "rank_iv"),
    }


def _column_null(decisions: pd.DataFrame, opt_bars: dict, col: str) -> float:
    """Median rank of every bar's value, so his median has something to stand next to."""
    if decisions.empty:
        return float("nan")
    ranks = []
    seen = set()
    for r in decisions.itertuples(index=False):
        key = (r.opt_id, r.product, r.month, r.cp, float(r.strike), r.dt)
        if key in seen:
            continue
        seen.add(key)
        tape = opt_bars.get(key[:5])
        if tape is None:
            continue
        pop = tape.loc[tape["trading_day"] == r.dt, col].to_numpy(float)
        pop = pop[np.isfinite(pop)]
        if len(pop) < 8:
            continue
        ranks.extend(_rank(float(v), pop) for v in pop)
    return float(np.median(ranks)) if ranks else float("nan")


def _fwd_null(decisions: pd.DataFrame, opt_bars: dict) -> float:
    if decisions.empty:
        return float("nan")
    ranks = []
    seen = set()
    for r in decisions.itertuples(index=False):
        key = (r.opt_id, r.product, r.month, r.cp, float(r.strike), r.dt)
        if key in seen:
            continue
        seen.add(key)
        tape = opt_bars.get(key[:5])
        if tape is None:
            continue
        day = tape[tape["trading_day"] == r.dt].sort_values("bar_time")
        close = day["close_opt"].to_numpy(float)
        times = day["bar_time"].to_numpy(dtype="datetime64[ns]")
        signed = np.full(len(day), np.nan)
        for j in range(len(day) - 12):
            gap = (times[j + 12] - times[j]) / np.timedelta64(1, "m")
            if gap <= 200 and close[j] > 0:
                signed[j] = close[j + 12] / close[j] - 1.0
        pop = signed[np.isfinite(signed)]
        if len(pop) < 8:
            continue
        ranks.extend(_rank(float(v), pop) for v in pop)
    return float(np.median(ranks)) if ranks else float("nan")


def _iv_gap_null(decisions: pd.DataFrame, opt_bars: dict) -> float:
    if decisions.empty:
        return float("nan")
    gaps = []
    seen = set()
    for r in decisions.itertuples(index=False):
        key = (r.opt_id, r.product, r.month, r.cp, float(r.strike), r.dt)
        if key in seen:
            continue
        seen.add(key)
        tape = opt_bars.get(key[:5])
        if tape is None:
            continue
        day = tape[tape["trading_day"] == r.dt].sort_values("bar_time")
        iv = day["iv"].to_numpy(float)
        for i in range(len(iv)):
            prior = iv[:i]
            prior = prior[np.isfinite(prior)]
            if len(prior) < 6 or not math.isfinite(iv[i]):
                continue
            gaps.append(float(iv[i] - np.median(prior)))
    return float(np.median(gaps)) if gaps else float("nan")


def _strangle(decisions: pd.DataFrame, by_id: dict) -> dict:
    empty = {"n": 0, "call_higher": float("nan"), "gap": float("nan"), "typical": float("nan")}
    if decisions.empty:
        return empty
    rows = []
    typical = []
    for (day, product), g in decisions.groupby(["dt", "product"]):
        calls = g[g["cp"] == "C"]
        puts = g[g["cp"] == "P"]
        if calls.empty or puts.empty:
            continue
        fc = float(np.average(calls["fut_close"], weights=calls["lots"]))
        fp = float(np.average(puts["fut_close"], weights=puts["lots"]))
        if not (fc > 0 and fp > 0):
            continue
        rows.append(fc / fp - 1.0)
        tape = by_id.get(calls["fut_id"].iloc[0])
        if tape is None:
            continue
        session = tape[0]
        session = session[session["trading_day"] == day].sort_values("bar_time")
        close = session["close"].to_numpy(float)
        if len(close) < 18:
            continue
        move = np.abs(close[6:] / close[:-6] - 1.0)
        move = move[np.isfinite(move)]
        if len(move):
            typical.append(float(np.median(move)))
    if not rows:
        return empty
    arr = np.array(rows, float)
    return {
        "n": int(len(arr)),
        "call_higher": float(np.mean(arr > 0)),
        "gap": float(np.median(arr)),
        "typical": float(np.median(typical)) if typical else float("nan"),
    }


def _charts(decisions: pd.DataFrame) -> dict:
    CHART.mkdir(parents=True, exist_ok=True)
    out = {}
    specs = [
        ("rank_run", CHART / "intraday_fut.png", "期货位置的分位", "左边不利，右边有利"),
        ("rank_iv", CHART / "intraday_iv.png", "这档隐波的分位", "左边更低，右边更高"),
    ]
    prof.configure_matplotlib()
    for col, path, title, xlabel in specs:
        if decisions.empty or col not in decisions or decisions[col].notna().sum() < 15:
            continue
        values = decisions.loc[decisions[col].notna(), col].to_numpy(float)
        counts, _ = np.histogram(values, bins=np.linspace(0, 1, 11))
        share = counts / counts.sum()
        fig, ax = plt.subplots(figsize=(8.2, 3.6))
        ax.bar(np.arange(10), share, color=prof.C_NAVY, width=0.82)
        ax.axhline(0.1, color=prof.C_GRAY, lw=1.0, label="随机一根大约一成")
        ax.set_xticks(np.arange(10))
        ax.set_xticklabels([f"{i * 10}" for i in range(10)])
        ax.set_ylim(0, max(0.25, float(share.max()) * 1.25))
        ax.set_ylabel("决策占比")
        ax.set_xlabel(xlabel)
        ax.set_title(title)
        ax.legend(frameon=False, fontsize=8)
        fig.tight_layout()
        fig.savefig(path, dpi=140)
        plt.close()
        out[col] = path
    return out


def _pct(v: float) -> str:
    return "—" if not math.isfinite(v) else f"{v:.0%}"


def _pp(v: float) -> str:
    return "—" if not math.isfinite(v) else f"{v:+.1f}"


def _flat(row: dict) -> bool:
    if not math.isfinite(row["median"]) or not math.isfinite(row["null"]):
        return not math.isfinite(row["median"]) or abs(row["median"] - 0.5) < 0.08
    return abs(row["median"] - row["null"]) < 0.08


def _side_text(row: dict, higher_means: str) -> str:
    if row["n"] == 0 or not math.isfinite(row["median"]):
        return "没有够上的样本。"
    ref = row["null"] if math.isfinite(row["null"]) else 0.5
    gap = row["median"] - ref
    if abs(gap) < 0.08:
        where = "和当天全部棒的中位差不多"
    elif gap > 0:
        where = f"比当天全部棒的中位高 {gap:.0%}，{higher_means}"
    else:
        where = f"比当天全部棒的中位低 {-gap:.0%}，方向和「{higher_means}」相反"
    weight = ""
    if math.isfinite(row["wmedian"]) and abs(row["wmedian"] - row["median"]) >= 0.08:
        weight = f"按手数加权是 {_pct(row['wmedian'])}。"
    return f"{row['n']} 个决策、{row['lots']:.0f} 手，中位 {_pct(row['median'])}，全部棒 {_pct(ref)}。{where}。{weight}"


def write_intraday(doc, opt: pd.DataFrame, add_fig, add_tab) -> str:
    """Definition, charts, table, then what the 5-minute tape changes. Returns one sentence for the close."""
    stats = analyze(opt)
    prof.heading(doc, "卖在 5 分钟的什么位置", 2)
    prof.para(
        doc,
        "成交时刻对上东方财富的 5 分钟线。一根的时间取这 5 分钟的结束，成交落在结束后 6 分钟以内的那一根。"
        "夜盘算进下一个交易日，和他成交单上的交易日一致。16 点以后的时间是到期批次的戳，没有行情，不放进来。"
        "这组历史里的开高低收和成交额对不上，所以每根用成交额除以成交量再除以合约乘数，得到这一根的成交均价。位置比的是均价，不是最高最低。"
        "一个决策是同一个合约在同一根里的卖开，手数加总，成交价按手数加权。"
        "期货位置按这一侧来转：认购卖在已经走出的高位算有利，认沽卖在已经走出的低位算有利。"
        "分位是这根在当天这一侧全部棒里的位置。随机挑一根，中位大约在一半。完整一天的高低用到了卖出之后的价格，单独列开。"
        "隐波用这根期权的成交均价和同时间的期货成交均价，按到期日的剩余天数反解，只留 1% 到 300% 之间的结果。"
        "已经摘牌的 11 月期权没有这组 5 分钟，10 月 15 日日盘在夜盘品种上也不在返回的区间里。",
    )
    prof.para(
        doc,
        f"卖开一共 {stats['sell_lots']:.0f} 手。"
        + (f"其中 {stats['batch_lots']:.0f} 手的时间在 16 点以后，是批次戳。" if stats["batch_lots"] else "")
        + f"对上期货 5 分钟的是 {stats['matched_lots']:.0f} 手、{stats['decisions']} 个决策，"
        f"对不上的 {stats['unmatched_lots']:.0f} 手留空。"
        f"期权 5 分钟还能反解出隐波的是 {stats['opt_lots']:.0f} 手。"
        + (
            (
                "期权成交价和这根的成交均价几乎一样。"
                if abs(stats["bar_pos"]) < 0.0005
                else f"期权成交价相对这根成交均价，中位偏离 {_pp(stats['bar_pos'] * 100)} 个百分点。"
            )
            if math.isfinite(stats["bar_pos"]) else ""
        ),
    )
    if "rank_run" in stats["charts"]:
        add_fig(stats["charts"]["rank_run"], "每个卖开决策的期货位置分位。横线是随机一根时每一档大约占一成。右边是对这一侧有利的位置。")
    if "rank_iv" in stats["charts"]:
        add_fig(stats["charts"]["rank_iv"], "每个能反解的卖开决策，这档隐波在当天的分位。右边是隐波更高。排名用了当天其余时刻。")
    rows = [
        ("期货均价，相对此前各根", stats["run"], "高于全部 = 卖在对这一侧有利的位置"),
        ("期货均价，相对完整一天", stats["full"], "高于全部 = 卖在全天有利的一端，用到了后面的价格"),
        ("卖完 12 根的期货绝对波动", stats["fwd"], "低于全部 = 卖完之后更安静"),
        ("这档隐波在全天的位置", stats["iv"], "高于全部 = 卖在隐波更高的时刻"),
        ("卖完 12 根的权利金涨跌", stats["opt_fwd"], "低于全部 = 卖完之后权利金跌得更多"),
    ]
    add_tab(
        ["比较", "决策", "手数", "他的中位", "全部棒的中位"],
        [[
            name,
            str(row["n"]),
            f"{row['lots']:.0f}",
            _pct(row["median"]),
            _pct(row["null"]) if math.isfinite(row["null"]) else "—",
        ] for name, row, _note in rows if row["n"]],
        "分位是这根在当天全部 5 分钟里的位置。期货两行按认购高、认沽低转成有利方向。隐波和权利金只含还查得到 5 分钟的合约。",
    )
    for name, row, note in rows:
        if row["n"]:
            prof.para(doc, f"{name}。{_side_text(row, note)}")
    if math.isfinite(stats["iv_gap_his"]):
        prof.para(
            doc,
            f"只和卖出之前比：卖出那根的隐波，比这天已经走过的中位 {_pp(stats['iv_gap_his'])} 个百分点。"
            f"当天每一根用同样的算法，中位是 {_pp(stats['iv_gap_null'])} 个百分点。"
            "这个差用的是卖出当时已经有的价格。",
        )
    st = stats["strangle"]
    if st["n"]:
        if math.isfinite(st["gap"]) and math.isfinite(st["typical"]):
            gap_bit = (
                f"价差中位 {st['gap'] * 100:.2f}%。"
                f"这些品种上，随便隔半小时，期货绝对波动的中位是 {st['typical'] * 100:.2f}%。"
            )
            if abs(st["gap"]) > 1.5 * st["typical"] and (st["call_higher"] >= 0.7 or st["call_higher"] <= 0.3):
                gap_bit += "认购卖在更高的期货价上，价差也大于这半小时本来会走的幅度。"
            else:
                gap_bit += "价差没有大过这段时间本来会走的幅度，所以不是先等期货冲高卖认购、再等回落卖认沽。"
        else:
            gap_bit = ""
        prof.para(
            doc,
            f"同一天同一个品种两边都卖、并且两边都对上期货的有 {st['n']} 天。"
            f"认购卖出时的期货价高于认沽的，占 {_pct(st['call_higher'])}。{gap_bit}",
        )
    flat_names = [name for name, row, _note in rows if row["n"] and _flat(row)]
    moved = [name for name, row, _note in rows if row["n"] and not _flat(row)]
    if moved:
        close = "5 分钟上离得开的是" + "、".join(moved) + "。其余和当天随便一根差不多。"
    else:
        close = "5 分钟上，卖出那根的中位和随便一根差不多，没有再多出一个择时。"
    if math.isfinite(stats.get("top_run", float("nan"))) and stats["top_run"] >= 0.16:
        close += f"期货最有利的十分位里放了 {stats['top_run']:.0%} 的决策，随机大约是一成，但中位仍在一半，不是稳定地挑那个位置。"
    if flat_names and moved:
        prof.para(doc, close + "和当天差不多的是" + "、".join(flat_names) + "。")
    else:
        prof.para(doc, close)
    return close
