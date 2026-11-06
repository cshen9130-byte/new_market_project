# -*- coding: utf-8 -*-
"""One RX383 strategy note: options and futures on the same underlying charts."""
from __future__ import annotations

import json
import math
import re
import sys
from datetime import date, timedelta
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Inches
from matplotlib.patches import Rectangle

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _generate_rx319_profile_word_report as prof  # noqa: E402
import _rx383_option_strategy_report as base  # noqa: E402
from cn_market_holidays import is_cn_market_closed  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402

# Shanghai: 5th-to-last session of the month before delivery.
_SHFE = {"CU", "AL", "ZN", "PB", "NI", "SN", "AU", "AG", "RB", "HC", "BU", "RU", "FU", "SP", "SS", "AO", "BR"}
# Dalian: 12th session of the month before delivery. Corn and soybean No.1 January
# options are the exception named in the October 2026 broker notices: they expire
# on the 12th session two months before delivery.
_DCE = {"A", "B", "C", "CS", "EB", "EG", "I", "J", "JD", "JM", "L", "LH", "M", "P", "PG", "PP", "V", "Y"}
_DCE_TWO_MONTH = {("A", 1), ("C", 1)}
# Zhengzhou: 3rd trading day on or before the 15th of the month before delivery.
# Cotton, sugar, rapeseed oil and rapeseed meal January options use two months before.
_CZCE = {"AP", "CF", "CJ", "CY", "FG", "MA", "OI", "PF", "PK", "PL", "PR", "PX", "RM", "SA", "SF", "SH", "SM", "SR", "TA", "UR", "ZC"}
_CZCE_TWO_MONTH = {("CF", 1), ("SR", 1), ("OI", 1), ("RM", 1)}
# Guangzhou lithium carbonate: 5th trading day of the month before delivery.
_GFEX = {"LC"}
# CFFEX index options expire on the third Friday of the contract month.
_CFFEX = {"HO", "IO", "MO"}

# Sell-open blocks. The name is the structure; the parenthesis is how the day's trades were split.
CAT_BOTH = "短宽跨式(两边一起卖，不再买)"
CAT_BOTH_BUY = "短宽跨式加近买(两边一起卖，再买一翼)"
CAT_RATIO = "比率价差(只卖一边，再买同向)"
CAT_NAKED = "单边卖权(只卖一边，不再买)"

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports" / "_rx383_option_strategy"
CHART = OUT / "charts" / "candles"
UNDER = {"HO": "IH", "IO": "IF", "MO": "IM"}


def _nth_trading_day(year: int, month: int, n: int) -> date:
    d = date(year, month, 1)
    seen = 0
    while d.month == month:
        if not is_cn_market_closed(d):
            seen += 1
            if seen == n:
                return d
        d += timedelta(days=1)
    raise ValueError(f"no {n}th trading day in {year}-{month:02d}")


def _nth_last_trading_day(year: int, month: int, n: int) -> date:
    if month == 12:
        d = date(year, 12, 31)
    else:
        d = date(year, month + 1, 1) - timedelta(days=1)
    seen = 0
    while d.month == month:
        if not is_cn_market_closed(d):
            seen += 1
            if seen == n:
                return d
        d -= timedelta(days=1)
    raise ValueError(f"no {n}th-last trading day in {year}-{month:02d}")


def _nth_on_or_before(year: int, month: int, day: int, n: int) -> date:
    """Nth trading day counting backward from this calendar day, including it."""
    d = date(year, month, day)
    seen = 0
    while d.year > 2000:
        if not is_cn_market_closed(d):
            seen += 1
            if seen == n:
                return d
        d -= timedelta(days=1)
    raise ValueError(f"no {n}th trading day on or before {year}-{month:02d}-{day:02d}")


def _third_friday(year: int, month: int) -> date:
    d = date(year, month, 1)
    while d.weekday() != 4:
        d += timedelta(days=1)
    return d + timedelta(days=14)


def _prior_month(year: int, month: int, back: int = 1) -> tuple[int, int]:
    m = month - back
    y = year
    while m <= 0:
        m += 12
        y -= 1
    return y, m


def option_expiry(product: str, month: str) -> date | None:
    """Exchange expiry for one commodity option. None when the rule is not one of these."""
    product = str(product or "").upper()
    mk = base.month_key(str(month or ""))
    if mk <= 0:
        return None
    year, mon = mk // 100, mk % 100
    if product in _SHFE:
        py, pm = _prior_month(year, mon, 1)
        return _nth_last_trading_day(py, pm, 5)
    if product in _DCE:
        back = 2 if (product, mon) in _DCE_TWO_MONTH else 1
        py, pm = _prior_month(year, mon, back)
        return _nth_trading_day(py, pm, 12)
    if product in _CZCE:
        back = 2 if (product, mon) in _CZCE_TWO_MONTH else 1
        py, pm = _prior_month(year, mon, back)
        return _nth_on_or_before(py, pm, 15, 3)
    if product in _GFEX:
        py, pm = _prior_month(year, mon, 1)
        return _nth_trading_day(py, pm, 5)
    if product in _CFFEX:
        return _third_friday(year, mon)
    return None


def _cn_full(d) -> str:
    d = pd.Timestamp(d)
    return f"{d.year}年{d.month}月{d.day}日"


def _pnl_color(v) -> str:
    """China market: red is a gain, green is a loss."""
    return prof.C_RED if float(v) >= 0 else prof.C_GREEN


def _shade_pnl(ax, xs, y) -> None:
    """Light red above zero, light green below."""
    xs = np.asarray(xs, dtype=float)
    y = np.asarray(y, dtype=float)
    if len(xs) == 0:
        return
    run = xs[0]
    up = bool(y[0] >= 0)
    for i in range(1, len(xs)):
        now = bool(y[i] >= 0)
        if now != up:
            ax.axvspan(run, xs[i], color=prof.C_RED if up else prof.C_GREEN, alpha=0.12, zorder=0)
            run = xs[i]
            up = now
    ax.axvspan(run, xs[-1], color=prof.C_RED if up else prof.C_GREEN, alpha=0.12, zorder=0)


def _ak_product(code) -> str | None:
    s = str(code or "").upper()
    m = re.match(r"^([A-Z]+?)(?:0|M)\.", s)
    if m:
        return m.group(1)
    m = re.match(r"^([A-Z]+)", s)
    return m.group(1) if m else None


def load() -> dict:
    conn = get_conn()
    try:
        raw = base.load_account(conn)
        ohlc = prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, contract,
                   open::float8 AS open, high::float8 AS high,
                   low::float8 AS low, close::float8 AS close,
                   clear::float8 AS clear, COALESCE(volume, 0)::float8 AS volume
            FROM raw_futures_contracts_daily
            WHERE trade_date BETWEEN DATE '2026-09-15' AND DATE '2026-11-04'
            """,
        )
        ak = prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, code,
                   open::float8 AS open, high::float8 AS high,
                   low::float8 AS low, close::float8 AS close,
                   clear::float8 AS clear, COALESCE(volume, 0)::float8 AS volume
            FROM raw_akshare_futures_daily
            WHERE trade_date BETWEEN DATE '2026-09-15' AND DATE '2026-11-04'
            """,
        )
        hist_ohlc = prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, contract,
                   open::float8 AS open, high::float8 AS high,
                   low::float8 AS low, close::float8 AS close,
                   clear::float8 AS clear
            FROM raw_futures_contracts_daily
            WHERE trade_date BETWEEN DATE '2026-06-01' AND DATE '2026-11-04'
            """,
        )
        hist_ak = prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, code,
                   open::float8 AS open, high::float8 AS high,
                   low::float8 AS low, close::float8 AS close,
                   clear::float8 AS clear
            FROM raw_akshare_futures_daily
            WHERE trade_date BETWEEN DATE '2026-06-01' AND DATE '2026-11-04'
            """,
        )
        civ = prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, LOWER(underlying_key) AS product, iv::float8 AS iv
            FROM raw_commodity_option_iv_daily
            WHERE trade_date BETWEEN DATE '2026-06-01' AND DATE '2026-11-04'
            """,
        )
        opt_px = prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, contract, COALESCE(clear, close)::float8 AS px
            FROM raw_options_contracts_daily
            WHERE trade_date BETWEEN DATE '2026-09-15' AND DATE '2026-11-04'
              AND COALESCE(clear, close) > 0
            """,
        )
    finally:
        conn.close()
    for df in (ohlc, ak, hist_ohlc, hist_ak, civ, opt_px):
        if not df.empty:
            df["dt"] = pd.to_datetime(df["dt"])
    if not ohlc.empty:
        ohlc["code"] = ohlc["contract"].map(base.norm_code)
    if not hist_ohlc.empty:
        hist_ohlc["code"] = hist_ohlc["contract"].map(base.norm_code)
    if not ak.empty:
        ak["product"] = ak["code"].map(_ak_product)
    if not hist_ak.empty:
        hist_ak["product"] = hist_ak["code"].map(_ak_product)
    if not civ.empty:
        civ["product"] = civ["product"].astype(str).str.upper()
        civ["iv"] = base.to_percent(civ["iv"])
    return {"raw": raw, "ohlc": ohlc, "ak": ak, "hist_ohlc": hist_ohlc, "hist_ak": hist_ak, "civ": civ, "opt_px": opt_px}


def clean_px(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()
    for col in ("open", "high", "low", "close", "clear"):
        out[col] = pd.to_numeric(out[col], errors="coerce")
    out["c"] = out["close"].where(out["close"] > 0, out["clear"])
    out["o"] = out["open"].where(out["open"] > 0, out["c"])
    out["h"] = out["high"].where(out["high"] > 0, out[["o", "c"]].max(axis=1))
    out["l"] = out["low"].where(out["low"] > 0, out[["o", "c"]].min(axis=1))
    out = out.dropna(subset=["c"])
    out = out[out["c"] > 0]
    return out.sort_values("dt").drop_duplicates("dt")


def series_for(product: str, month: str, ohlc: pd.DataFrame, ak: pd.DataFrame) -> tuple[pd.DataFrame, str]:
    under = UNDER.get(product, product)
    keys = base.fut_lookup_keys(under, month) if month else []
    hit = ohlc[ohlc["code"].isin(keys)] if not ohlc.empty and keys else ohlc.iloc[0:0]
    if not hit.empty:
        # the code with the most sessions
        code = hit.groupby("code")["dt"].nunique().sort_values(ascending=False).index[0]
        px = clean_px(hit[hit["code"] == code])
        if len(px) >= 5:
            return px, str(code)
    if not ak.empty:
        a = ak[ak["product"] == under]
        px = clean_px(a)
        if len(px) >= 5:
            return px, f"{under} 连续"
    return pd.DataFrame(), ""


def events_for(product: str, opt: pd.DataFrame, fut: pd.DataFrame) -> pd.DataFrame:
    rows = []
    o = opt[opt["product"] == product]
    for r in o.itertuples(index=False):
        if r.is_open and r.is_sell and r.cp == "C":
            kind = "卖开购"
        elif r.is_open and r.is_sell and r.cp == "P":
            kind = "卖开沽"
        elif r.is_close and r.is_buy:
            kind = "买平权"
        elif r.is_close and r.is_sell:
            kind = "卖平权"
        elif r.is_open and r.is_buy:
            kind = "买开权"
        else:
            continue
        rows.append({"dt": pd.Timestamp(r.dt), "kind": kind, "lots": float(r.lots)})
    f = fut[fut["product"] == product] if not fut.empty else fut
    if not f.empty:
        for r in f.itertuples(index=False):
            kind = "卖期货" if "卖" in str(r.bs) else "买期货"
            rows.append({"dt": pd.Timestamp(r.dt), "kind": kind, "lots": float(r.lots)})
    if not rows:
        return pd.DataFrame(columns=["dt", "kind", "lots"])
    ev = pd.DataFrame(rows)
    return ev.groupby(["dt", "kind"], as_index=False)["lots"].sum()


def history_for(label: str, product: str, hist_ohlc: pd.DataFrame, hist_ak: pd.DataFrame) -> pd.DataFrame:
    """Same instrument as the candle, with enough sessions to form a 20-day realized vol."""
    if not label:
        return pd.DataFrame()
    if str(label).endswith("连续"):
        if hist_ak.empty:
            return pd.DataFrame()
        return clean_px(hist_ak[hist_ak["product"] == UNDER.get(product, product)])
    if hist_ohlc.empty:
        return pd.DataFrame()
    return clean_px(hist_ohlc[hist_ohlc["code"] == label])


def _returns(hist: pd.DataFrame) -> pd.Series:
    if hist is None or hist.empty:
        return pd.Series(dtype=float)
    h = hist.sort_values("dt").drop_duplicates("dt")
    s = pd.Series(h["c"].to_numpy(float), index=pd.to_datetime(h["dt"]))
    return s.pct_change()


def rv20_on(contract_hist: pd.DataFrame, cont_hist: pd.DataFrame, dates: pd.Series) -> pd.Series:
    """20-day realized vol. Before the listed month has 20 sessions, earlier returns come from the continuous contract."""
    listed = _returns(contract_hist)
    cont = _returns(cont_hist)
    idx = listed.index.union(cont.index)
    rets = listed.reindex(idx).combine_first(cont.reindex(idx)).sort_index()
    rv = rets.rolling(20, min_periods=20).std() * math.sqrt(252.0) * 100.0
    return rv.reindex(pd.to_datetime(dates))


def _exchange_atm() -> pd.DataFrame:
    path = OUT / "atm_fill.csv"
    if not path.is_file():
        return pd.DataFrame(columns=["dt", "product", "iv"])
    fill = pd.read_csv(path)
    if fill.empty:
        return pd.DataFrame(columns=["dt", "product", "iv"])
    fill["dt"] = pd.to_datetime(fill["dt"])
    fill["product"] = fill["product"].astype(str).str.upper()
    fill["iv"] = pd.to_numeric(fill["iv"], errors="coerce")
    return fill.dropna(subset=["iv"])[["dt", "product", "iv"]]


def _invert_atm(opt_px: pd.DataFrame, ohlc: pd.DataFrame) -> pd.DataFrame:
    """Nearest listed strike within 8% of the future, inverted from that day's settlement."""
    cols = ["dt", "product", "iv"]
    if opt_px is None or opt_px.empty or ohlc is None or ohlc.empty:
        return pd.DataFrame(columns=cols)
    parsed = opt_px["contract"].map(base.parse_contract)
    chain = opt_px.loc[parsed.notna()].copy()
    if chain.empty:
        return pd.DataFrame(columns=cols)
    info = pd.DataFrame(list(parsed.loc[chain.index]))
    chain = pd.concat([chain.reset_index(drop=True), info.reset_index(drop=True)], axis=1)
    fut = ohlc.copy()
    fut["fut"] = pd.to_numeric(fut["close"], errors="coerce")
    fut["fut"] = fut["fut"].where(fut["fut"] > 0, pd.to_numeric(fut["clear"], errors="coerce"))
    fut = fut[fut["fut"] > 0][["dt", "code", "fut"]].drop_duplicates(["dt", "code"])
    best: dict[tuple, tuple] = {}
    for r in chain.itertuples(index=False):
        if not r.strike or r.strike <= 0 or not r.px or r.px <= 0:
            continue
        hit = fut[(fut["dt"] == r.dt) & fut["code"].isin(base.fut_lookup_keys(r.product, r.month))]
        if hit.empty:
            continue
        spot = float(hit["fut"].iloc[0])
        dist = abs(float(r.strike) / spot - 1.0)
        if dist > 0.08:
            continue
        exp = option_expiry(r.product, r.month)
        if exp is None:
            continue
        dte = (exp - pd.Timestamp(r.dt).date()).days
        if dte <= 1:
            continue
        try:
            iv = _implied_vol(spot, float(r.strike), dte / 365.0, float(r.px), r.cp) * 100.0
        except Exception:
            continue
        if not math.isfinite(iv) or not 1.0 < iv < 250.0:
            continue
        key = (pd.Timestamp(r.dt), r.product, r.cp)
        prev = best.get(key)
        if prev is None or dist < prev[0]:
            best[key] = (dist, iv)
    rows = []
    by_day: dict[tuple, list] = {}
    for (dt, product, _cp), (_dist, iv) in best.items():
        by_day.setdefault((dt, product), []).append(iv)
    for (dt, product), ivs in by_day.items():
        rows.append((dt, product, float(sum(ivs) / len(ivs))))
    return pd.DataFrame(rows, columns=cols)


def atm_table(civ: pd.DataFrame, opt_px: pd.DataFrame, ohlc: pd.DataFrame) -> pd.DataFrame:
    """Published at-the-money first, then the exchange fill, then a settlement inversion."""
    parts = []
    if civ is not None and not civ.empty:
        published = civ.rename(columns={"iv": "iv"})[["dt", "product", "iv"]].copy()
        published["rank"] = 0
        parts.append(published)
    extra = _exchange_atm()
    if not extra.empty:
        extra = extra.copy()
        extra["rank"] = 1
        parts.append(extra)
    inv = _invert_atm(opt_px, ohlc)
    if not inv.empty:
        inv = inv.copy()
        inv["rank"] = 2
        parts.append(inv)
    if not parts:
        return pd.DataFrame(columns=["dt", "product", "iv"])
    all_iv = pd.concat(parts, ignore_index=True)
    all_iv = all_iv.sort_values("rank").drop_duplicates(["dt", "product"], keep="first")
    return all_iv[["dt", "product", "iv"]]


def vol_lines(product: str, px: pd.DataFrame, contract_hist: pd.DataFrame, cont_hist: pd.DataFrame, atm: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame({"dt": pd.to_datetime(px["dt"])})
    out["rv20"] = rv20_on(contract_hist, cont_hist, out["dt"]).to_numpy()
    out["atm"] = np.nan
    if atm is not None and not atm.empty:
        sub = atm[atm["product"] == product].drop_duplicates("dt")
        mapped = pd.Series(sub["iv"].to_numpy(float), index=pd.to_datetime(sub["dt"])).reindex(out["dt"])
        out["atm"] = mapped.to_numpy()
    out["gap"] = out["atm"] - out["rv20"]
    return out


def plot_candle(product: str, px: pd.DataFrame, ev: pd.DataFrame, fut_net: pd.DataFrame, strikes: dict, vol: pd.DataFrame, path: Path) -> None:
    prof.configure_matplotlib()
    has_fut = fut_net is not None and not fut_net.empty and float(fut_net["net"].abs().sum()) > 0
    fig, (ax, axv) = plt.subplots(
        2, 1, sharex=True, figsize=(8.2, 6.6 if has_fut else 5.8),
        gridspec_kw={"height_ratios": [1.7, 1.05]},
    )
    xs = np.arange(len(px))
    date_pos = {pd.Timestamp(d): i for i, d in enumerate(px["dt"])}
    for i, r in enumerate(px.itertuples(index=False)):
        up = r.c >= r.o
        color = prof.C_RED if up else prof.C_GREEN
        ax.vlines(i, r.l, r.h, color=color, linewidth=0.8)
        body = max(abs(r.c - r.o), (r.h - r.l) * 0.02, r.c * 0.001)
        ax.add_patch(Rectangle((i - 0.32, min(r.o, r.c)), 0.64, body, facecolor=color, edgecolor=color, linewidth=0.4))
    style = {
        "卖开购": dict(marker="v", color=prof.C_NAVY, y="high"),
        "卖开沽": dict(marker="v", color=prof.C_GOLD, y="low"),
        "买平权": dict(marker="^", color=prof.C_TEAL, y="high"),
        "卖平权": dict(marker="^", color="#805AD5", y="low"),
        "买开权": dict(marker="o", color=prof.C_TEAL, y="low"),
        "卖期货": dict(marker="s", color=prof.C_GREEN, y="high"),
        "买期货": dict(marker="s", color=prof.C_RED, y="low"),
    }
    labeled = set()
    if not ev.empty:
        for r in ev.itertuples(index=False):
            i = date_pos.get(pd.Timestamp(r.dt))
            if i is None or r.kind not in style:
                continue
            st = style[r.kind]
            base_y = float(px.iloc[i]["h"] if st["y"] == "high" else px.iloc[i]["l"])
            y = base_y * (1.018 if st["y"] == "high" else 0.982)
            ax.scatter([i], [y], marker=st["marker"], c=st["color"], s=36 + min(r.lots, 40), zorder=5,
                       label=r.kind if r.kind not in labeled else None)
            labeled.add(r.kind)
    lo = float(px["l"].min())
    hi = float(px["h"].max())
    span = max(hi - lo, hi * 0.01)
    for name, strike, color in (
        ("购行权", strikes.get("C"), prof.C_NAVY),
        ("沽行权", strikes.get("P"), prof.C_GOLD),
    ):
        if strike and lo - span * 0.12 < strike < hi + span * 0.12:
            ax.axhline(strike, color=color, lw=0.7, ls="--", alpha=0.75, label=f"{name} {strike:.0f}")
    if has_fut:
        ax2 = ax.twinx()
        fn = fut_net.set_index("dt")["net"].reindex(px["dt"]).ffill().fillna(0)
        ax2.step(xs, fn.to_numpy(), where="post", color="#C05621", lw=1.1, label="期货净持仓")
        ax2.axhline(0, color="#C05621", lw=0.4, alpha=0.4)
        ax2.set_ylabel("期货净持仓（手）")
        h2, l2 = ax2.get_legend_handles_labels()
    else:
        h2, l2 = [], []
    h1, l1 = ax.get_legend_handles_labels()
    ax.set_ylabel("期货价格")
    ax.set_title(prof.pname(product))
    ax.tick_params(labelbottom=False)
    axv.plot(xs, vol["atm"], color=prof.C_NAVY, lw=1.2, marker="o", ms=3.2, label="平值隐波")
    axv.plot(xs, vol["rv20"], color=prof.C_ORANGE, lw=1.2, label="20日实现波动")
    axv.plot(xs, vol["gap"], color=prof.C_PURPLE, lw=1.2, marker="o", ms=3.2, label="平值隐波减20日实现波动")
    axv.axhline(0, color=prof.C_GRAY, lw=0.5)
    axv.set_ylabel("百分数")
    axv.legend(frameon=False, fontsize=8, ncol=3, loc="upper left")
    axv.set_xlim(-0.8, len(px) - 0.2)
    step = max(1, len(px) // 8)
    axv.set_xticks(xs[::step])
    axv.set_xticklabels([pd.Timestamp(d).strftime("%m-%d") for d in px["dt"].iloc[::step]], rotation=0)
    if h1 or h2:
        fig.legend(h1 + h2, l1 + l2, frameon=False, ncol=4, fontsize=8, loc="lower center", bbox_to_anchor=(0.5, 0.0))
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=140)
    plt.close()


def dominant_month(opt: pd.DataFrame, product: str) -> str:
    g = opt[(opt["product"] == product) & opt["is_open"] & opt["is_sell"]]
    if g.empty:
        g = opt[opt["product"] == product]
    if g.empty or g["month"].isna().all():
        return ""
    return str(g.groupby("month")["lots"].sum().sort_values(ascending=False).index[0])


def strike_med(opt: pd.DataFrame, product: str, cp: str) -> float:
    g = opt[(opt["product"] == product) & opt["is_open"] & opt["is_sell"] & (opt["cp"] == cp)]
    g = g[g["strike"] > 0]
    if g.empty:
        return float("nan")
    return float(np.average(g["strike"], weights=g["lots"]))


def _wquant(values: np.ndarray, weights: np.ndarray, p: float) -> float:
    order = np.argsort(values)
    v = values[order]
    w = weights[order]
    cw = np.cumsum(w)
    if cw[-1] <= 0:
        return float("nan")
    return float(v[min(len(v) - 1, int(np.searchsorted(cw, p * cw[-1], side="left")))])


def open_to_expiry(opt: pd.DataFrame) -> dict:
    """Calendar days from each opening fill to that contract's exchange expiry."""
    opens = opt[opt["is_open"]].copy()
    if opens.empty:
        return {"lots": 0.0, "known": 0.0, "rows": [], "buckets": []}
    opens["expiry"] = [
        option_expiry(p, m) for p, m in zip(opens["product"], opens["month"])
    ]
    known = opens[opens["expiry"].notna()].copy()
    known["days"] = [
        (pd.Timestamp(exp).date() - pd.Timestamp(dt).date()).days
        for dt, exp in zip(known["dt"], known["expiry"])
    ]
    v = known["days"].to_numpy(dtype=float)
    w = known["lots"].to_numpy(dtype=float)
    rows = []
    for exp, g in known.groupby("expiry"):
        gv = g["days"].to_numpy(dtype=float)
        gw = g["lots"].to_numpy(dtype=float)
        rows.append({
            "expiry": pd.Timestamp(exp).date(),
            "lots": float(gw.sum()),
            "sell": float(g.loc[g["is_sell"], "lots"].sum()),
            "buy": float(g.loc[g["is_buy"], "lots"].sum()),
            "min": int(gv.min()),
            "p50": _wquant(gv, gw, 0.50),
            "max": int(gv.max()),
        })
    rows.sort(key=lambda r: r["expiry"])
    edges = [0, 15, 22, 31, 46, 61, 10_000]
    labels = ["0–14 天", "15–21 天", "22–30 天", "31–45 天", "46–60 天", "61 天以上"]
    buckets = []
    for lo, hi, label in zip(edges, edges[1:], labels):
        mask = (v >= lo) & (v < hi)
        buckets.append({"label": label, "lots": float(w[mask].sum())})
    sell = known[known["is_sell"]]
    buy = known[known["is_buy"]]
    return {
        "lots": float(opens["lots"].sum()),
        "known": float(w.sum()),
        "missing": float(opens.loc[opens["expiry"].isna(), "lots"].sum()),
        "sell": float(sell["lots"].sum()),
        "buy": float(buy["lots"].sum()),
        "near": float(w[v < 15].sum()) if len(v) else 0.0,
        "far": float(w[v >= 46].sum()) if len(v) else 0.0,
        "min": int(v.min()) if len(v) else None,
        "p25": _wquant(v, w, 0.25) if len(v) else float("nan"),
        "p50": _wquant(v, w, 0.50) if len(v) else float("nan"),
        "p75": _wquant(v, w, 0.75) if len(v) else float("nan"),
        "max": int(v.max()) if len(v) else None,
        "rows": rows,
        "buckets": buckets,
    }


def month_table(opt: pd.DataFrame) -> list[dict]:
    opens = opt[opt["is_open"] & opt["is_sell"]].copy()
    closes = opt[opt["is_close"] & opt["is_buy"]].copy()
    days = sorted(set(pd.to_datetime(opens["dt"])) | set(pd.to_datetime(closes["dt"])))
    rows = []
    for dt in days:
        g = opens[pd.to_datetime(opens["dt"]) == dt]
        c = closes[pd.to_datetime(closes["dt"]) == dt]
        rows.append({
            "dt": str(pd.Timestamp(dt).date())[5:],
            "lots": float(g["lots"].sum()),
            "names": int(g["product"].nunique()) if not g.empty else 0,
            "m11": float(g.loc[g["mkey"] == 202611, "lots"].sum()) if "mkey" in g.columns else 0.0,
            "m12": float(g.loc[g["mkey"] == 202612, "lots"].sum()) if "mkey" in g.columns else 0.0,
            "m01": float(g.loc[g["mkey"] == 202701, "lots"].sum()) if "mkey" in g.columns else 0.0,
            "close": float(c["lots"].sum()),
        })
    return rows


def main() -> None:
    data = load()
    raw = data["raw"]
    end = pd.Timestamp("2026-11-03")
    for key in ("opt_trades", "opt_pos", "daily", "fut_trades", "fut_pos"):
        frame = raw.get(key)
        if isinstance(frame, pd.DataFrame) and not frame.empty and "dt" in frame.columns:
            raw[key] = frame.loc[pd.to_datetime(frame["dt"]) <= end].copy()
    opt = raw["opt_trades"]
    fut = raw["fut_trades"].copy() if not raw["fut_trades"].empty else pd.DataFrame()
    if not fut.empty:
        fut = fut.loc[~fut["contract"].map(lambda c: base.parse_contract(c) is not None)].copy()
        fut["product"] = fut["contract"].map(prof.product_code)
        fut["is_sell"] = fut["bs"].fillna("").astype(str).str.contains("卖")
        fut["is_buy"] = fut["bs"].fillna("").astype(str).str.contains("买")
        fut["is_open"] = fut["oc"].fillna("").astype(str).str.contains("开")
        fut["is_close"] = fut["oc"].fillna("").astype(str).str.contains("平")
    fpos = raw["fut_pos"].copy() if not raw["fut_pos"].empty else pd.DataFrame()
    if not fpos.empty:
        fpos = fpos.loc[~fpos["contract"].map(lambda c: base.parse_contract(c) is not None)].copy()
        fpos["product"] = fpos["contract"].map(prof.product_code)
        fpos["net"] = fpos["long_lots"] - fpos["short_lots"]
    summary = json.loads((OUT / "summary.json").read_text(encoding="utf-8"))
    pick = json.loads((OUT / "pick.json").read_text(encoding="utf-8"))
    timing = json.loads((OUT / "timing.json").read_text(encoding="utf-8"))
    months = month_table(opt)

    products = sorted(set(opt["product"]) | (set(fut["product"]) if not fut.empty else set()),
                      key=lambda p: -float(opt.loc[opt["product"] == p, "lots"].sum() if not opt.empty else 0))
    atm = atm_table(data["civ"], data["opt_px"], data["ohlc"])
    charts = []
    rows = []
    for product in products:
        month = dominant_month(opt, product)
        px, label = series_for(product, month, data["ohlc"], data["ak"])
        ev = events_for(product, opt, fut)
        net = fpos[fpos["product"] == product].groupby("dt", as_index=False)["net"].sum() if not fpos.empty else pd.DataFrame()
        path = CHART / f"{product}.png"
        if not px.empty:
            hist = history_for(label, product, data["hist_ohlc"], data["hist_ak"])
            cont = history_for(f"{UNDER.get(product, product)} 连续", product, data["hist_ohlc"], data["hist_ak"])
            plot_candle(product, px, ev, net, {
                "C": strike_med(opt, product, "C"),
                "P": strike_med(opt, product, "P"),
            }, vol_lines(product, px, hist, cont, atm), path)
        o_sell_c = float(opt.loc[(opt["product"] == product) & opt["is_open"] & opt["is_sell"] & (opt["cp"] == "C"), "lots"].sum())
        o_sell_p = float(opt.loc[(opt["product"] == product) & opt["is_open"] & opt["is_sell"] & (opt["cp"] == "P"), "lots"].sum())
        o_close = float(opt.loc[(opt["product"] == product) & opt["is_close"], "lots"].sum())
        f_sell = float(fut.loc[(fut["product"] == product) & fut["is_sell"], "lots"].sum()) if not fut.empty else 0.0
        f_buy = float(fut.loc[(fut["product"] == product) & fut["is_buy"], "lots"].sum()) if not fut.empty else 0.0
        f_end = float(net.loc[net["dt"] == net["dt"].max(), "net"].sum()) if not net.empty else 0.0
        # same calendar day: option sell and futures trade
        o_days = set(pd.to_datetime(opt.loc[(opt["product"] == product) & opt["is_open"] & opt["is_sell"], "dt"]))
        f_days = set(pd.to_datetime(fut.loc[fut["product"] == product, "dt"])) if not fut.empty else set()
        rows.append({
            "product": product,
            "month": month,
            "label": label,
            "chart": path if path.exists() else None,
            "sell_c": o_sell_c,
            "sell_p": o_sell_p,
            "close": o_close,
            "fut_sell": f_sell,
            "fut_buy": f_buy,
            "fut_end": f_end,
            "same_days": len(o_days & f_days),
            "opt_days": len(o_days),
            "fut_days": len(f_days),
        })
        charts.append(rows[-1])

    # day-level joint tape for products that have a future
    tape = []
    if not fut.empty:
        for r in fut.sort_values("dt").itertuples(index=False):
            same = opt[(opt["product"] == r.product) & (opt["dt"] == r.dt) & opt["is_open"] & opt["is_sell"]]
            tape.append({
                "dt": str(pd.Timestamp(r.dt).date()),
                "product": r.product,
                "bs": "卖" if r.is_sell else "买",
                "oc": "开" if r.is_open else ("平" if r.is_close else ""),
                "lots": float(r.lots),
                "price": float(r.price) if math.isfinite(base.fnum(r.price)) else float("nan"),
                "opt_c": float(same.loc[same["cp"] == "C", "lots"].sum()),
                "opt_p": float(same.loc[same["cp"] == "P", "lots"].sum()),
            })

    both = [r for r in rows if r["fut_sell"] + r["fut_buy"] > 0]
    only_opt = [r for r in rows if r["fut_sell"] + r["fut_buy"] == 0]
    fut_lots = float(fut["lots"].sum()) if not fut.empty else 0.0
    fut_sell_lots = float(fut.loc[fut["is_sell"], "lots"].sum()) if not fut.empty else 0.0
    fut_buy_lots = float(fut.loc[fut["is_buy"], "lots"].sum()) if not fut.empty else 0.0

    doc_path = ROOT / "reports" / "RX383_交易策略.docx"
    example = real_strangle(opt, data["ohlc"])
    buckets = sell_buckets(opt)
    cases = category_examples(opt, data["ohlc"])
    dte = open_to_expiry(opt)
    logic = category_logic(opt)
    write_doc(
        doc_path, summary, pick, timing, months, rows, tape, both, only_opt,
        fut_lots, fut_sell_lots, fut_buy_lots, example, buckets, cases, dte, logic, opt,
    )
    print("CASES")
    for c in cases:
        print(c["product"], c["label"], "fut", round(c["fut"], 1), "credit", round(c["credit"], 1),
              "be", None if not math.isfinite(c["be_low"]) else round(c["be_low"], 1),
              None if not math.isfinite(c["be_high"]) else round(c["be_high"], 1),
              "peak", round(c["peak"], 1), "live", round(c["live"], 1), "fee", c["fee"],
              "end", round(c["end_fut"], 1), "mark", round(c["expiry_here"], 1),
              "exp", c.get("expiry"), "times", c["times"])
    print("BUCKETS", buckets)
    print("REPORT", doc_path)
    print("FUT", fut_sell_lots, fut_buy_lots, "products", [r["product"] for r in both])
    print("MONTHS")
    for r in months:
        print(r)
    for t in tape:
        print(t)


FEAT_CN = {
    "basis_ann_lag": "期货年化升水",
    "fut_oi_lag": "近月期货持仓量",
    "basis_pct_lag": "期货曲线分位",
    "ret5_lag": "期货近5日涨跌",
    "ret_lag": "期货前一日涨跌",
    "iv_pct_lag": "隐波历史分位",
    "fut_vol_lag": "近月期货成交量",
    "atm_iv_lag": "平值隐波",
    "vrp_lag": "隐波减20日实现波动",
}


def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _black(f: float, k: float, t: float, sig: float, cp: str) -> float:
    if t <= 1e-8:
        return max(f - k, 0.0) if cp == "C" else max(k - f, 0.0)
    vol = sig * math.sqrt(t)
    d1 = (math.log(f / k) + 0.5 * sig * sig * t) / vol
    d2 = d1 - vol
    if cp == "C":
        return f * _ncdf(d1) - k * _ncdf(d2)
    return k * _ncdf(-d2) - f * _ncdf(-d1)


def strangle_payoff() -> dict:
    """One short strangle scaled to futures = 100, using his median distance and ATM IV."""
    spot = 100.0
    k_call = 113.0
    k_put = 88.0
    sig = 0.184
    t_open = 60 / 365
    t_left = 30 / 365
    credit_c = _black(spot, k_call, t_open, sig, "C")
    credit_p = _black(spot, k_put, t_open, sig, "P")
    credit = credit_c + credit_p
    xs = np.linspace(70, 140, 281)

    def pnl_exp(s):
        return credit - max(s - k_call, 0.0) - max(k_put - s, 0.0)

    def pnl_live(s):
        return credit - _black(s, k_call, t_left, sig, "C") - _black(s, k_put, t_left, sig, "P")

    y_exp = np.array([pnl_exp(s) for s in xs])
    y_live = np.array([pnl_live(s) for s in xs])
    prof.configure_matplotlib()
    fig, axes = plt.subplots(2, 1, figsize=(8.2, 6.4), gridspec_kw={"height_ratios": [1.15, 1]})
    ax = axes[0]
    ax.plot(xs, y_exp, color=prof.C_NAVY, lw=1.8, label="到期")
    ax.plot(xs, y_live, color=prof.C_GOLD, lw=1.4, label="还剩 30 天")
    ax.axhline(0, color="#718096", lw=0.6)
    _shade_pnl(ax, xs, y_exp)
    ax.axvline(spot, color="#718096", lw=0.6, ls=":")
    ax.axvline(k_put, color=prof.C_GOLD, lw=0.7, ls="--")
    ax.axvline(k_call, color=prof.C_NAVY, lw=0.7, ls="--")
    ax.set_xlim(70, 140)
    ax.set_ylabel("盈亏（期货价 = 100）")
    ax.set_title("短宽跨式：期货价格一变，盈亏怎么走")
    ax.legend(frameon=False, ncol=2, loc="lower right")
    ax2 = axes[1]
    ax2.plot(xs, y_exp, color=prof.C_NAVY, lw=1.8, label="到期")
    ax2.plot(xs, y_live, color=prof.C_GOLD, lw=1.4, label="还剩 30 天")
    ax2.axhline(0, color="#718096", lw=0.6)
    _shade_pnl(ax2, xs, y_exp)
    ax2.axvline(spot, color="#718096", lw=0.6, ls=":", label="卖出时期货价 100")
    ax2.axvline(k_put, color=prof.C_GOLD, lw=0.7, ls="--", label="认沽行权 88")
    ax2.axvline(k_call, color=prof.C_NAVY, lw=0.7, ls="--", label="认购行权 113")
    ax2.set_xlim(84, 118)
    ax2.set_ylim(-2.2, 0.55)
    ax2.set_xlabel("期货价格")
    ax2.set_ylabel("盈亏（放大）")
    ax2.legend(frameon=False, ncol=3, fontsize=8, loc="lower right")
    fig.tight_layout()
    path = OUT / "charts" / "strangle_payoff.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=140)
    plt.close()
    marks = [70, 80, 88, 100, 113, 130]
    return {
        "path": path,
        "spot": spot,
        "k_call": k_call,
        "k_put": k_put,
        "sig": sig,
        "credit": credit,
        "credit_c": credit_c,
        "credit_p": credit_p,
        "be_low": k_put - credit,
        "be_high": k_call + credit,
        "pnl_mid_live": pnl_live(spot),
        "rows": [{"px": s, "exp": pnl_exp(s), "live": pnl_live(s)} for s in marks],
    }


def _option_closes(product: str, month: str, cp: str, strike: float) -> pd.DataFrame:
    code = f"{product}{month}{cp}{int(round(strike))}"
    conn = get_conn()
    try:
        df = prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, clear::float8 AS close, volume::float8 AS volume
            FROM raw_options_contracts_daily
            WHERE regexp_replace(contract, '\\.[A-Za-z]+$', '') = %s
              AND trade_date BETWEEN DATE '2026-10-01' AND DATE '2026-11-04'
            ORDER BY trade_date
            """,
            (code,),
        )
    finally:
        conn.close()
    if df.empty:
        return df
    df["dt"] = pd.to_datetime(df["dt"])
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    return df.dropna(subset=["close"])


def real_strangle(opt: pd.DataFrame, ohlc: pd.DataFrame) -> dict | None:
    """The same-day pair closest to a balanced wide strangle, with its own payoff."""
    opens = opt[opt["is_open"] & opt["is_sell"]].copy()
    best = None
    for (dt, product, month), g in opens.groupby(["dt", "product", "month"]):
        calls = g[g["cp"] == "C"]
        puts = g[g["cp"] == "P"]
        if calls.empty or puts.empty:
            continue
        if calls["strike"].nunique() != 1 or puts["strike"].nunique() != 1:
            continue
        lc = float(calls["lots"].sum())
        lp = float(puts["lots"].sum())
        if min(lc, lp) < 5:
            continue
        px, label = series_for(product, month, ohlc, pd.DataFrame())
        if px.empty:
            continue
        day = px[px["dt"] == pd.Timestamp(dt)]
        if day.empty:
            continue
        fut = float(day["c"].iloc[-1])
        if not math.isfinite(fut) or fut <= 0:
            continue
        kc = float(calls["strike"].iloc[0])
        kp = float(puts["strike"].iloc[0])
        pc = float(np.average(calls["price"], weights=calls["lots"]))
        pp = float(np.average(puts["price"], weights=puts["lots"]))
        dist = abs(kc / fut - 1 - 0.13) + abs(1 - kp / fut - 0.12)
        balance = min(lc, lp) / max(lc, lp)
        score = balance - dist
        if best is None or score > best["score"]:
            fee = float(pd.to_numeric(g["fee"], errors="coerce").fillna(0).sum()) if "fee" in g.columns else 0.0
            ttimes = sorted(str(x) for x in g["ttime"].dropna().unique()) if "ttime" in g.columns else []
            best = {
                "score": score,
                "dt": pd.Timestamp(dt),
                "product": product,
                "month": str(month),
                "label": label,
                "px": px,
                "fut": fut,
                "kc": kc,
                "kp": kp,
                "pc": pc,
                "pp": pp,
                "lc": lc,
                "lp": lp,
                "fee": fee,
                "ttimes": ttimes,
                "day_low": float(day["l"].iloc[-1]),
                "day_high": float(day["h"].iloc[-1]),
            }
    if best is None:
        return None
    mult = float(base.multipliers(opt).get(best["product"], float("nan")))
    if not math.isfinite(mult):
        return None
    lots = min(best["lc"], best["lp"])
    credit_pts = best["pc"] + best["pp"]
    credit_yuan = credit_pts * lots * mult
    be_low = best["kp"] - credit_pts
    be_high = best["kc"] + credit_pts
    call_mkt = _option_closes(best["product"], best["month"], "C", best["kc"])
    put_mkt = _option_closes(best["product"], best["month"], "P", best["kp"])
    path = best["px"][best["px"]["dt"] >= best["dt"] - pd.Timedelta(days=12)].copy()
    last = path[path["dt"] <= pd.Timestamp("2026-11-03")]
    end_dt = last["dt"].max()
    end_fut = float(last.loc[last["dt"] == end_dt, "c"].iloc[-1])

    def mark_on(frame: pd.DataFrame, dt, fallback: float) -> float:
        if frame.empty:
            return fallback
        hit = frame[frame["dt"] <= dt]
        if hit.empty:
            return fallback
        return float(hit["close"].iloc[-1])

    end_call = mark_on(call_mkt, end_dt, best["pc"])
    end_put = mark_on(put_mkt, end_dt, best["pp"])
    call_pnl = (best["pc"] - end_call) * best["lc"] * mult
    put_pnl = (best["pp"] - end_put) * best["lp"] * mult
    live = call_pnl + put_pnl
    expiry_if_here = credit_yuan  # both strikes are still OTM at end_fut; checked below
    if end_fut > best["kc"]:
        expiry_if_here = credit_yuan - (end_fut - best["kc"]) * lots * mult
    elif end_fut < best["kp"]:
        expiry_if_here = credit_yuan - (best["kp"] - end_fut) * lots * mult

    prof.configure_matplotlib()
    fig, axes = plt.subplots(2, 1, figsize=(8.2, 6.6), gridspec_kw={"height_ratios": [1.15, 1]})
    xs = np.linspace(best["kp"] - 400, best["kc"] + 400, 400)
    y = []
    for s in xs:
        intrinsic = max(s - best["kc"], 0.0) + max(best["kp"] - s, 0.0)
        y.append(credit_yuan - intrinsic * lots * mult)
    y = np.array(y)
    ax = axes[0]
    ax.plot(xs, y, color=prof.C_NAVY, lw=1.8, label="到期盈亏")
    ax.axhline(0, color="#718096", lw=0.6)
    _shade_pnl(ax, xs, y)
    ax.axvline(best["kp"], color=prof.C_GOLD, lw=0.7, ls="--", label=f"认沽 {best['kp']:.0f}")
    ax.axvline(best["kc"], color=prof.C_NAVY, lw=0.7, ls="--", label=f"认购 {best['kc']:.0f}")
    end_label = pd.Timestamp(end_dt).strftime("%m-%d")
    ax.scatter([best["fut"]], [credit_yuan], s=36, color=prof.C_NAVY, zorder=5, label=f"卖出日期货 {best['fut']:.0f}")
    ax.scatter([end_fut], [expiry_if_here], s=36, color=_pnl_color(expiry_if_here), zorder=5, label=f"{end_label} 若到期 {expiry_if_here:+.0f} 元")
    ax.scatter([end_fut], [live], s=42, marker="D", color=_pnl_color(live), zorder=6, label=f"{end_label} 重估 {live:+.0f} 元")
    ax.set_ylim(-2500, credit_yuan * 1.8)
    ax.set_xlabel("期货价格")
    ax.set_ylabel("盈亏（元）")
    ax.set_title(f"{prof.pname(best['product'])} {best['label']}  这套短宽跨式")
    ax.legend(frameon=False, fontsize=8, ncol=2, loc="upper left")
    ax2 = axes[1]
    show = path[path["dt"] <= pd.Timestamp("2026-11-04")]
    ax2.plot(show["dt"], show["c"], color=prof.C_NAVY, lw=1.4, label="期货收盘")
    ax2.scatter([best["dt"]], [best["fut"]], s=36, color=prof.C_GOLD, zorder=5, label="卖出")
    ax2.set_ylabel("期货价格")
    ax2b = ax2.twinx()
    pnl_days = show[show["dt"] >= best["dt"]]
    pnl_y = []
    for dt in pnl_days["dt"]:
        cpx = mark_on(call_mkt, dt, best["pc"])
        ppx = mark_on(put_mkt, dt, best["pp"])
        pnl_y.append((best["pc"] - cpx) * best["lc"] * mult + (best["pp"] - ppx) * best["lp"] * mult)
    ax2b.plot(pnl_days["dt"], pnl_y, color=_pnl_color(pnl_y[-1]), lw=1.3, label="按结算价重估")
    ax2b.axhline(credit_yuan, color=_pnl_color(credit_yuan), lw=0.7, ls="--", label=f"到期最高 {credit_yuan:.0f} 元")
    ax2b.set_ylabel("盈亏（元）")
    h1, l1 = ax2.get_legend_handles_labels()
    h2, l2 = ax2b.get_legend_handles_labels()
    ax2.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d"))
    ax2.xaxis.set_major_locator(mdates.WeekdayLocator(byweekday=mdates.MO))
    ax2.legend(h1 + h2, l1 + l2, frameon=False, fontsize=8, ncol=2, loc="lower left")
    fig.tight_layout()
    path_png = OUT / "charts" / "strangle_real.png"
    path_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path_png, dpi=140)
    plt.close()
    return {
        "path": path_png,
        "dt": str(best["dt"].date()),
        "product": best["product"],
        "name": prof.pname(best["product"]),
        "label": best["label"],
        "fut": best["fut"],
        "day_low": best["day_low"],
        "day_high": best["day_high"],
        "kc": best["kc"],
        "kp": best["kp"],
        "pc": best["pc"],
        "pp": best["pp"],
        "lc": best["lc"],
        "lp": best["lp"],
        "mult": mult,
        "fee": best["fee"],
        "ttimes": best["ttimes"],
        "credit_pts": credit_pts,
        "credit_yuan": credit_yuan,
        "be_low": be_low,
        "be_high": be_high,
        "otm_c": best["kc"] / best["fut"] - 1,
        "otm_p": 1 - best["kp"] / best["fut"],
        "end_dt": str(pd.Timestamp(end_dt).date()),
        "end_fut": end_fut,
        "end_call": end_call,
        "end_put": end_put,
        "call_pnl": call_pnl,
        "put_pnl": put_pnl,
        "live": live,
        "live_net": live - best["fee"],
        "expiry_if_here": expiry_if_here,
        "expiry": option_expiry(best["product"], best["month"]),
    }


def sell_buckets(opt: pd.DataFrame) -> dict:
    """Four exclusive blocks of sell-open lots. They add up to every sell open."""
    opens = opt[opt["is_open"]].copy()
    opens["tag"] = np.where(opens["is_sell"], "S", "L") + opens["cp"].astype(str)
    pivot = opens.pivot_table(index=["dt", "product"], columns="tag", values="lots", aggfunc="sum", fill_value=0).reset_index()
    for col in ("SC", "SP", "LC", "LP"):
        if col not in pivot.columns:
            pivot[col] = 0.0
    pivot["sell"] = pivot["SC"] + pivot["SP"]
    pivot["strangle"] = (pivot["SC"] > 0) & (pivot["SP"] > 0)
    pivot["wing"] = ((pivot["SC"] > 0) & (pivot["LC"] > 0)) | ((pivot["SP"] > 0) & (pivot["LP"] > 0))
    both = pivot["strangle"]
    wing = pivot["wing"]
    naked = ~both & ~wing & (pivot["sell"] > 0)
    call_naked = naked & (pivot["SC"] > 0) & (pivot["SP"] == 0)

    def lots(mask) -> float:
        return float(pivot.loc[mask, "sell"].sum())

    nearer = True
    smaller = True
    for (_, _), g in opens.groupby(["dt", "product"]):
        for cp in ("C", "P"):
            sold = g[(g["cp"] == cp) & g["is_sell"]]
            bought = g[(g["cp"] == cp) & g["is_buy"]]
            if sold.empty or bought.empty:
                continue
            if float(bought["lots"].sum()) > float(sold["lots"].sum()) + 1e-9:
                smaller = False
            if cp == "C" and float(bought["strike"].max()) >= float(sold["strike"].min()):
                nearer = False
            if cp == "P" and float(bought["strike"].min()) <= float(sold["strike"].max()):
                nearer = False
    return {
        "both_only": lots(both & ~wing),
        "both_wing": lots(both & wing),
        "one_wing": lots(wing & ~both),
        "one_naked": lots(naked),
        "one_call": lots(call_naked),
        "one_put": lots(naked) - lots(call_naked),
        "buy_nearer": nearer,
        "buy_smaller": smaller,
    }


def _life_move(iv_pct: float, dte: int) -> float:
    """One-standard-deviation price move from an annualized IV over calendar days."""
    if not math.isfinite(iv_pct) or iv_pct <= 0 or dte <= 0:
        return float("nan")
    return (iv_pct / 100.0) * math.sqrt(dte / 365.0)


def category_logic(opt: pd.DataFrame) -> dict:
    """IV, wing distance and net credit for the four sell-open blocks.

    Strike IV is blank on these contracts. The vol used here is the published
    ATM IV of the product that day. A missing future or a missing IV is left
    out of the median, and the cover count is kept.
    """
    conn = get_conn()
    try:
        mkt = base.load_market(conn, opt, opt.iloc[0:0])
    finally:
        conn.close()
    fut_px = base.build_futures_px(mkt["futs"])
    chain = mkt["chain_acc"]
    delta = (
        chain.drop_duplicates(["dt", "code"])[["dt", "code", "delta"]]
        if not chain.empty else pd.DataFrame(columns=["dt", "code", "delta"])
    )
    opens = opt[opt["is_open"]].merge(delta, on=["dt", "code"], how="left")
    opens = base.attach_underlying_fast(opens, fut_px)
    surface = base.build_surface(mkt["chain"], fut_px)
    atm = surface[["dt", "product", "atm_iv"]].copy() if not surface.empty else pd.DataFrame(columns=["dt", "product", "atm_iv"])
    civ = mkt["civ"]
    if not civ.empty:
        atm = atm.merge(civ[["dt", "product", "iv"]].rename(columns={"iv": "atm_pub"}), on=["dt", "product"], how="outer")
        atm["atm_iv"] = atm["atm_pub"].where(atm["atm_pub"].notna(), atm["atm_iv"])
    opens = opens.merge(atm[["dt", "product", "atm_iv"]], on=["dt", "product"], how="left")
    tag = np.where(opens["is_sell"], "S", "L") + opens["cp"].astype(str)
    opens["tag"] = tag
    piv = opens.pivot_table(index=["dt", "product"], columns="tag", values="lots", aggfunc="sum", fill_value=0).reset_index()
    for col in ("SC", "SP", "LC", "LP"):
        if col not in piv.columns:
            piv[col] = 0.0
    both = (piv["SC"] > 0) & (piv["SP"] > 0)
    wing = ((piv["SC"] > 0) & (piv["LC"] > 0)) | ((piv["SP"] > 0) & (piv["LP"] > 0))
    piv["cat"] = np.where(both & ~wing, "both", np.where(both & wing, "both_buy", np.where(wing & ~both, "ratio", "naked")))
    opens = opens.merge(piv[["dt", "product", "cat"]], on=["dt", "product"], how="left")
    opens["expiry"] = [option_expiry(p, m) for p, m in zip(opens["product"], opens["month"])]
    opens["dte"] = [
        (pd.Timestamp(exp).date() - pd.Timestamp(dt).date()).days if exp is not None else np.nan
        for dt, exp in zip(opens["dt"], opens["expiry"])
    ]
    opens["otm"] = np.where(opens["cp"].eq("C"), opens["strike"] / opens["fut"] - 1.0, 1.0 - opens["strike"] / opens["fut"])
    opens.loc[~opens["is_sell"] | ~opens["otm"].between(0, 1.5), "otm"] = np.nan
    opens["move"] = [_life_move(iv, int(d) if math.isfinite(base.fnum(d)) else 0) for iv, d in zip(opens["atm_iv"], opens["dte"])]
    opens["sig"] = opens["otm"] / opens["move"]
    mult = base.multipliers(opt)
    opens["cash"] = np.where(opens["is_sell"], 1.0, -1.0) * opens["price"] * opens["lots"] * opens["product"].map(mult)

    def med(df: pd.DataFrame, col: str) -> tuple[float, float]:
        g = df.dropna(subset=[col])
        if g.empty:
            return float("nan"), 0.0
        return _wquant(g[col].to_numpy(float), g["lots"].to_numpy(float), 0.50), float(g["lots"].sum())

    blocks = {}
    iv_on = {}
    for cat, g in opens.groupby("cat"):
        sell = g[g["is_sell"]]
        call = sell[sell["cp"] == "C"]
        put = sell[sell["cp"] == "P"]
        known = sell.dropna(subset=["sig"])
        day = g.groupby(["dt", "product"], as_index=False)["cash"].sum()
        day = day.merge(sell[["dt", "product"]].drop_duplicates(), on=["dt", "product"])
        otm_p50, otm_n = med(sell, "otm")
        call_p50, call_n = med(call, "otm")
        put_p50, put_n = med(put, "otm")
        atm_p50, atm_n = med(sell, "atm_iv")
        sig_p50, sig_n = med(sell, "sig")
        dte_p50, _ = med(sell, "dte")
        delta_p50, delta_n = med(sell.assign(ad=sell["delta"].abs()), "ad")
        blocks[cat] = {
            "sell_lots": float(sell["lots"].sum()),
            "days": int(len(day)),
            "credit_days": int((day["cash"] > 0).sum()),
            "debit_days": int((day["cash"] < 0).sum()),
            "otm_p50": otm_p50,
            "otm_n": otm_n,
            "call_otm_p50": call_p50,
            "call_n": call_n,
            "put_otm_p50": put_p50,
            "put_n": put_n,
            "atm_p50": atm_p50,
            "atm_n": atm_n,
            "sig_p50": sig_p50,
            "sig_n": sig_n,
            "sig_gt1": float(known.loc[known["sig"] > 1, "lots"].sum()) if not known.empty else 0.0,
            "sig_gt2": float(known.loc[known["sig"] > 2, "lots"].sum()) if not known.empty else 0.0,
            "dte_p50": dte_p50,
            "delta_p50": delta_p50,
            "delta_n": delta_n,
            "call_lots": float(call["lots"].sum()),
            "put_lots": float(put["lots"].sum()),
        }
        for (product, dt), eg in g.dropna(subset=["atm_iv"]).groupby(["product", "dt"]):
            iv_on[(product, pd.Timestamp(dt).strftime("%Y-%m-%d"))] = float(eg["atm_iv"].iloc[0])
    smile_rows = []
    for r in opens[opens["is_sell"]].itertuples(index=False):
        fut, atm_iv, dte, px = base.fnum(r.fut), base.fnum(r.atm_iv), base.fnum(r.dte), base.fnum(r.price)
        if not all(math.isfinite(v) and v > 0 for v in (fut, atm_iv, dte, px, float(r.strike))):
            continue
        tenor = dte / 365.0
        sig_w = _implied_vol(fut, float(r.strike), tenor, px, r.cp)
        _, d2w = _black76(fut, float(r.strike), sig_w, tenor, r.cp)
        q = _ncdf(d2w) if r.cp == "C" else _ncdf(-d2w)
        _, d2a = _black76(fut, float(r.strike), atm_iv / 100.0, tenor, r.cp)
        qh = _ncdf(d2a) if r.cp == "C" else _ncdf(-d2a)
        if q <= 1e-8:
            continue
        m = float(mult.get(r.product, float("nan")))
        edge = px * (1.0 - qh / q) * float(r.lots) * m
        smile_rows.append((float(r.lots), atm_iv, sig_w * 100.0, sig_w * 100.0 - atm_iv, q, qh, edge, qh < q))
    lots = np.array([x[0] for x in smile_rows])
    def smed(i: int) -> float:
        return _wquant(np.array([x[i] for x in smile_rows]), lots, 0.50)
    smile = {
        "lots": float(lots.sum()),
        "atm": smed(1),
        "wing": smed(2),
        "gap": smed(3),
        "q": smed(4),
        "qh": smed(5),
        "edge": float(sum(x[6] for x in smile_rows if math.isfinite(x[6]))),
        "cheaper": float(sum(x[0] for x in smile_rows if x[7])),
    }
    return {"blocks": blocks, "iv_on": iv_on, "smile": smile}


def _package_pnl(legs: list[dict], mult: float, s: float) -> float:
    total = 0.0
    for leg in legs:
        intrinsic = max(s - leg["k"], 0.0) if leg["cp"] == "C" else max(leg["k"] - s, 0.0)
        if leg["short"]:
            total += (leg["px"] - intrinsic) * leg["lots"] * mult
        else:
            total += (intrinsic - leg["px"]) * leg["lots"] * mult
    return total


def _plot_package(spec: dict) -> dict:
    """Expiry payoff and the futures path for one day's option package."""
    legs = spec["legs"]
    mult = spec["mult"]
    fut = spec["fut"]
    end_fut = spec["end_fut"]
    strikes = [leg["k"] for leg in legs]
    lo = min([fut, end_fut, *strikes])
    hi = max([fut, end_fut, *strikes])
    pad = max((hi - lo) * 0.18, hi * 0.02)
    xs = np.linspace(lo - pad, hi + pad, 500)
    y = np.array([_package_pnl(legs, mult, s) for s in xs])
    credit = _package_pnl(legs, mult, fut)
    kink = max(_package_pnl(legs, mult, k) for k in strikes)
    peak = max(float(y.max()), kink)
    bes = []
    for i in range(len(y) - 1):
        if y[i] == 0:
            bes.append(float(xs[i]))
        elif y[i] * y[i + 1] < 0:
            w = abs(y[i]) / (abs(y[i]) + abs(y[i + 1]))
            bes.append(float(xs[i] + w * (xs[i + 1] - xs[i])))
    below = [b for b in bes if b < fut]
    above = [b for b in bes if b > fut]
    be_low = max(below) if below else float("nan")
    be_high = min(above) if above else float("nan")
    live = 0.0
    for leg in legs:
        if leg["short"]:
            live += (leg["px"] - leg["end"]) * leg["lots"] * mult
        else:
            live += (leg["end"] - leg["px"]) * leg["lots"] * mult
    expiry_here = _package_pnl(legs, mult, end_fut)

    prof.configure_matplotlib()
    fig, axes = plt.subplots(2, 1, figsize=(8.2, 6.6), gridspec_kw={"height_ratios": [1.15, 1]})
    ax = axes[0]
    ax.plot(xs, y, color=prof.C_NAVY, lw=1.8, label="到期盈亏")
    ax.axhline(0, color="#718096", lw=0.6)
    _shade_pnl(ax, xs, y)
    for leg in legs:
        side = "卖" if leg["short"] else "买"
        wing = "认购" if leg["cp"] == "C" else "认沽"
        ax.axvline(leg["k"], color=prof.C_NAVY if leg["cp"] == "C" else prof.C_GOLD, lw=0.7, ls="--" if leg["short"] else ":",
                   label=f"{side}{wing} {leg['k']:.0f}")
    end_label = pd.Timestamp(spec["end_dt"]).strftime("%m-%d")
    ax.scatter([fut], [credit], s=36, color=prof.C_NAVY, zorder=5, label=f"卖出日期货 {fut:.0f}")
    if spec.get("settled"):
        ax.scatter([end_fut], [live], s=42, marker="D", color=_pnl_color(live), zorder=6, label=f"{end_label} 到期了结 {live:+.0f} 元")
    else:
        ax.scatter([end_fut], [expiry_here], s=36, color=_pnl_color(expiry_here), zorder=5, label=f"{end_label} 若到期 {expiry_here:+.0f} 元")
        ax.scatter([end_fut], [live], s=42, marker="D", color=_pnl_color(live), zorder=6, label=f"{end_label} 重估 {live:+.0f} 元")
    ax.set_xlim(xs[0], xs[-1])
    ax.set_ylim(min(-abs(credit) * 1.6, -600), max(peak, credit) * 1.45)
    ax.set_xlabel("期货价格")
    ax.set_ylabel("盈亏（元）")
    ax.set_title(spec["title"])
    ax.legend(frameon=False, fontsize=8, ncol=2, loc="upper left")
    ax2 = axes[1]
    show = spec["path"]
    ax2.plot(show["dt"], show["c"], color=prof.C_NAVY, lw=1.4, label="期货收盘")
    ax2.scatter([spec["dt"]], [fut], s=36, color=prof.C_GOLD, zorder=5, label="开仓")
    ax2.set_ylabel("期货价格")
    ax2b = ax2.twinx()
    pnl_days = show[show["dt"] >= spec["dt"]]

    def book_on(dt) -> float:
        if spec.get("settled") and pd.Timestamp(dt) >= pd.Timestamp(spec["end_dt"]):
            return live
        total = 0.0
        for leg in legs:
            mark = leg["px"]
            frame = leg["mkt"]
            if not frame.empty:
                hit = frame[frame["dt"] <= dt]
                if not hit.empty:
                    mark = float(hit["close"].iloc[-1])
            if leg["short"]:
                total += (leg["px"] - mark) * leg["lots"] * mult
            else:
                total += (mark - leg["px"]) * leg["lots"] * mult
        return total

    pnl_y = [book_on(dt) for dt in pnl_days["dt"]]
    ax2b.plot(pnl_days["dt"], pnl_y, color=_pnl_color(pnl_y[-1]), lw=1.3, label="按结算价重估")
    ax2b.axhline(credit, color=_pnl_color(credit), lw=0.7, ls="--", label=f"期权归零 {credit:.0f} 元")
    ax2b.set_ylabel("盈亏（元）")
    h1, l1 = ax2.get_legend_handles_labels()
    h2, l2 = ax2b.get_legend_handles_labels()
    ax2.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d"))
    ax2.xaxis.set_major_locator(mdates.WeekdayLocator(byweekday=mdates.MO))
    ax2.legend(h1 + h2, l1 + l2, frameon=False, fontsize=8, ncol=2, loc="lower left")
    fig.tight_layout()
    spec["png"].parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(spec["png"], dpi=140)
    plt.close()
    spec["credit"] = credit
    spec["peak"] = peak
    spec["be_low"] = be_low
    spec["be_high"] = be_high
    spec["live"] = live
    spec["expiry_here"] = expiry_here
    return spec


def _day_px(px: pd.DataFrame, dt) -> pd.Series:
    day = px[px["dt"] == pd.Timestamp(dt)]
    if day.empty:
        raise RuntimeError(f"no futures close on {dt}")
    return day.iloc[-1]


def _leg(product, month, cp, strike, short, lots, price) -> dict:
    mkt = _option_closes(product, month, cp, strike)
    end = price
    if not mkt.empty:
        hit = mkt[mkt["dt"] <= pd.Timestamp("2026-11-03")]
        if not hit.empty:
            end = float(hit["close"].iloc[-1])
    return {"cp": cp, "k": float(strike), "short": short, "lots": float(lots), "px": float(price), "end": end, "mkt": mkt}


def category_examples(opt: pd.DataFrame, ohlc: pd.DataFrame) -> list[dict]:
    """One package per sell-open block, chosen from trades that were closed on an expiry day."""
    mults = base.multipliers(opt)

    def pack(product, month, dt, end_on, title, png, legs, fee, settled) -> dict:
        px, label = series_for(product, month, ohlc, pd.DataFrame())
        day = _day_px(px, dt)
        end_cut = pd.Timestamp(end_on)
        last = px[px["dt"] <= end_cut]
        end_dt = last["dt"].max()
        end_row = last.loc[last["dt"] == end_dt].iloc[-1]
        show = px[(px["dt"] >= pd.Timestamp(dt) - pd.Timedelta(days=12)) & (px["dt"] <= end_cut + pd.Timedelta(days=1))]
        built = []
        for leg in legs:
            item = _leg(product, month, *leg)
            if settled:
                item["end"] = 0.0
            built.append(item)
        return _plot_package({
            "product": product,
            "name": prof.pname(product),
            "label": label,
            "title": title,
            "png": OUT / "charts" / png,
            "dt": pd.Timestamp(dt),
            "fut": float(day["c"]),
            "day_low": float(day["l"]),
            "day_high": float(day["h"]),
            "end_dt": end_dt,
            "end_fut": float(end_row["c"]),
            "mult": float(mults[product]),
            "fee": float(fee),
            "legs": built,
            "path": show,
            "settled": settled,
        })

    def fee_of(product, dt) -> float:
        g = opt[(opt["product"] == product) & (opt["dt"] == dt) & opt["is_open"]]
        return float(pd.to_numeric(g["fee"], errors="coerce").fillna(0).sum())

    # Each block has the still-open package and one package closed on the expiry day.
    # Expiry-day sell lots: both-only 53, both-wing 4, one-wing 28, one-naked 33.
    out = []
    rows = (
        ("both_open", "RB", "2701", "2026-10-19", "2026-11-03", False, "螺纹 RB2701  短宽跨式", "cat_open_both.png",
         [("C", 3500, True, 10, 5.0), ("P", 2750, True, 10, 3.5)]),
        ("both_wing_open", "M", "2701", "2026-10-21", "2026-11-03", False, "豆粕 M2701  短宽跨式加近买", "cat_open_wing.png",
         [("C", 3800, True, 15, 4.5), ("P", 2600, True, 10, 1.5), ("C", 3700, False, 2, 6.5)]),
        ("one_wing_open", "C", "2701", "2026-10-22", "2026-11-03", False, "玉米 C2701  比率价差", "cat_open_one.png",
         [("C", 2440, True, 20, 3.5), ("C", 2400, False, 2, 5.0)]),
        ("naked_open", "JD", "2612", "2026-11-02", "2026-11-03", False, "鸡蛋 JD2612  单边卖权", "cat_open_naked.png",
         [("C", 4000, True, 20, 8.0)]),
        ("both", "NI", "2611", "2026-10-21", "2026-10-26", True, "镍 NI2611  短宽跨式，10月26日到期了结", "cat_both.png",
         [("C", 130000, True, 13, 1408 / 13), ("P", 110000, True, 15, 400 / 15)]),
        ("both_wing", "NI", "2611", "2026-10-22", "2026-10-26", True, "镍 NI2611  短宽跨式加近买", "cat_both_wing.png",
         [("C", 136000, True, 2, 76.0), ("P", 110000, True, 2, 26.0), ("C", 124000, False, 1, 984.0)]),
        ("one_wing", "SN", "2611", "2026-10-19", "2026-10-26", True, "锡 SN2611  比率价差", "cat_one_wing.png",
         [("P", 320000, True, 15, 1730 / 15), ("P", 325000, False, 1, 152.0)]),
        ("naked", "BU", "2611", "2026-10-15", "2026-10-26", True, "沥青 BU2611  单边卖权", "cat_naked.png",
         [("C", 6000, True, 10, 3.0)]),
    )
    for kind, product, month, dt, end_on, settled, title, png, legs in rows:
        spec = pack(product, month, dt, end_on, title, png, legs, fee_of(product, dt), settled)
        g = opt[(opt["product"] == product) & (opt["dt"] == dt) & opt["is_open"]]
        spec["times"] = sorted({str(x)[:8] for x in g["ttime"].dropna()})
        spec["expiry"] = option_expiry(product, month)
        spec["kind"] = kind
        out.append(spec)
    return out


def _cn_day(dt) -> str:
    d = pd.Timestamp(dt)
    return f"{d.month}月{d.day}日"


def _yuan(v: float, signed: bool = False) -> str:
    sign = "+" if signed and v > 0 else ""
    if abs(v - round(v)) < 0.05:
        return f"{sign}{v:,.0f}"
    return f"{sign}{v:,.1f}"


def _otm(leg: dict, fut: float) -> float:
    return leg["k"] / fut - 1 if leg["cp"] == "C" else 1 - leg["k"] / fut


def _leg_pnl(leg: dict, mult: float) -> float:
    if leg["short"]:
        return (leg["px"] - leg["end"]) * leg["lots"] * mult
    return (leg["end"] - leg["px"]) * leg["lots"] * mult


def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _black76(fut: float, strike: float, sigma: float, tenor: float, cp: str) -> tuple[float, float]:
    """Black-76 price and d2. Premium is in futures points, rate is zero."""
    vol = sigma * math.sqrt(tenor)
    d1 = (math.log(fut / strike) + 0.5 * sigma * sigma * tenor) / vol
    d2 = d1 - vol
    if cp == "C":
        return fut * _ncdf(d1) - strike * _ncdf(d2), d2
    return strike * _ncdf(-d2) - fut * _ncdf(-d1), d2


def _implied_vol(fut: float, strike: float, tenor: float, price: float, cp: str) -> float:
    lo, hi = 1e-6, 8.0
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        model, _ = _black76(fut, strike, mid, tenor, cp)
        if model > price:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def _leg_quote(spec: dict, leg: dict) -> dict:
    """Probability implied by the traded premium, and the incomplete premium × P(OTM)."""
    dte = (pd.Timestamp(spec["expiry"]).date() - pd.Timestamp(spec["dt"]).date()).days
    tenor = dte / 365.0
    fut = float(spec["fut"])
    sigma = _implied_vol(fut, float(leg["k"]), tenor, float(leg["px"]), leg["cp"])
    _model, d2 = _black76(fut, float(leg["k"]), sigma, tenor, leg["cp"])
    p_itm = _ncdf(d2) if leg["cp"] == "C" else _ncdf(-d2)
    naive = float(leg["px"]) * (1.0 - p_itm) * float(leg["lots"]) * float(spec["mult"])
    return {"iv": sigma * 100.0, "p_itm": p_itm, "naive": naive}


def _expect_lines(spec: dict) -> str:
    bits = []
    naive = 0.0
    for leg in spec["legs"]:
        q = _leg_quote(spec, leg)
        name = ("卖出" if leg["short"] else "买进") + ("认购" if leg["cp"] == "C" else "认沽")
        sign = 1.0 if leg["short"] else -1.0
        naive += sign * q["naive"]
        bits.append(
            f"{name}用成交价反解，隐波 {q['iv']:.0f}%，到期实值概率 {q['p_itm']:.1%}，"
            f"权利金乘虚值概率是 {_yuan(q['naive'])} 元。"
        )
    fee = float(spec["fee"])
    look = "像是一笔正的结果。" if naive > 0 else "方向相加已经是负的，因为买进付出的权利金乘虚值概率，大于卖出收回的。"
    bits.append(
        f"几条腿按买卖方向相加是 {_yuan(naive, signed=True)} 元，{look}"
        "这只加了虚值、权利金留在原处的那一种。"
        "把他自己的实值概率 qh 代进 权利金 × (1 − qh/q)，q 用上面这个成交价里的概率，卖出腿在 qh 低于 q 时期望大于 0，买进腿在 qh 高于 q 时期望大于 0。"
        f"qh 刚好等于 q 时期望是 0，再减手续费 {_yuan(fee)} 元就为负，这种概率下他不会开。"
        "成交里没有他填的 qh。"
    )
    return "".join(bits)


def _write_category_examples(doc, add_fig, add_tab, cases, logic) -> None:
    """Each sell-open block: one package still open on 3 Nov, then one closed on its expiry day."""
    by = {c["kind"]: c for c in cases}
    rb, meal, corn, egg = by["both_open"], by["both_wing_open"], by["one_wing_open"], by["naked_open"]
    ni, wing, tin, asphalt = by["both"], by["both_wing"], by["one_wing"], by["naked"]

    def show(spec, heading, paragraphs, caption, level=3) -> None:
        prof.heading(doc, heading, level)
        for text in paragraphs:
            prof.para(doc, text)
        add_fig(spec["png"], caption)
        rows = []
        for leg in spec["legs"]:
            side = "卖出" if leg["short"] else "买进"
            wing_name = "认购" if leg["cp"] == "C" else "认沽"
            rows.append([
                f"{side}{wing_name}",
                f"{leg['k']:.0f}",
                f"{leg['px']:.1f}",
                f"{leg['lots']:.0f}",
                f"{leg['end']:.1f}",
                _yuan(_leg_pnl(leg, spec["mult"]), signed=True),
            ])
        rows.append(["合计", "—", "—", "—", "—", _yuan(spec["live"], signed=True)])
        end = pd.Timestamp(spec["end_dt"]).strftime("%m-%d")
        price_col = f"{end} 了结价" if spec.get("settled") else f"{end} 结算价"
        note = "到期批次权利金为 0，了结价按 0 计。" if spec.get("settled") else "重估用期权结算价。"
        add_tab(
            ["腿", "行权价", "开仓价", "手数", price_col, "盈亏"],
            rows,
            f"手续费 {_yuan(spec['fee'])} 元，扣完 {_yuan(spec['live'] - spec['fee'], signed=True)} 元。{note}",
        )

    both_b = logic["blocks"]["both"]
    buy_b = logic["blocks"]["both_buy"]
    ratio_b = logic["blocks"]["ratio"]
    naked_b = logic["blocks"]["naked"]

    prof.heading(doc, CAT_BOTH, 2)
    prof.para(
        doc,
        "开仓时要算的是期望，不是权利金本身。到期盈亏对他所预测的价格概率加总，大于 0，这套做法重复做才有正的平均结果。"
        "手数相同、一边一个行权价时，一套的到期盈亏（元）是"
        "（认购权利金 + 认沽权利金 − max(认沽行权价 − 到期期货, 0) − max(到期期货 − 认购行权价, 0)）× 手数 × 乘数。"
        "下沿等于认沽行权价减去两笔权利金，上沿等于认购行权价加上两笔权利金。"
        "到期期货收在两沿之间，两腿归零，留下权利金。跌破下沿或涨过上沿，亏起来不封顶。"
        f"这一块 {both_b['days']} 天全部是净收权利金。",
    )
    prof.para(
        doc,
        "盈利区间是上面两个盈亏平衡价之间。区间里的利润几乎是固定的权利金，区间外的亏损随期货走远而变大，不是另一个固定数。"
        "Black-76 用成交价反解隐波，再给出到期实值的概率。权利金乘上虚值概率，只算出赚钱那种结果的贡献。"
        f"螺纹这套：{_expect_lines(rb)}"
        "已经到期、两腿归零的镍和铜，是虚值概率大约 95% 的那种结果，还不能说明他把实值概率报得比成交价更低。",
    )
    show(
        rb,
        "还没到期",
        [
            f"{_cn_day(rb['dt'])}螺纹 {rb['label']}。期货收盘 {rb['fut']:.0f}，当天 {rb['day_low']:.0f} 到 {rb['day_high']:.0f}。"
            f"卖出认购 {rb['legs'][0]['k']:.0f}、{rb['legs'][0]['lots']:.0f} 手、权利金 {rb['legs'][0]['px']:.1f}，虚值 {_otm(rb['legs'][0], rb['fut']):.0%}；"
            f"卖出认沽 {rb['legs'][1]['k']:.0f}、{rb['legs'][1]['lots']:.0f} 手、权利金 {rb['legs'][1]['px']:.1f}，虚值 {_otm(rb['legs'][1], rb['fut']):.0%}。"
            f"两笔在 {' 和 '.join(rb['times'][:2])}。没有再买。"
            f"10 套收进权利金 {_yuan(rb['credit'])} 元。"
            f"到期日是 {_cn_full(rb['expiry'])}，上期所螺纹 1 月期权，交割月前一个月的倒数第 5 个交易日。"
            f"到期时期货落在 {rb['be_low']:.0f} 到 {rb['be_high']:.0f} 之间，两腿归零，留下这笔权利金。"
            f"跌破 {rb['be_low']:.0f} 或涨过 {rb['be_high']:.0f}，开始亏，而且不封顶。",
            f"到 {pd.Timestamp(rb['end_dt']).strftime('%m-%d')} 还在仓里，到期日还没到，这笔没有平掉。期货收到 {rb['end_fut']:.0f}，仍在两个行权价之间。"
            f"认购结算价收到 {rb['legs'][0]['end']:.1f}，认沽结算价收到 {rb['legs'][1]['end']:.1f}，两腿都比卖出价低。"
            f"两腿重估 {_yuan(rb['live'], signed=True)} 元，扣手续费后 {_yuan(rb['live'] - rb['fee'], signed=True)} 元。"
            f"若到期仍停在 {rb['end_fut']:.0f}，能留下 {_yuan(rb['expiry_here'])} 元。现在重估已经是这笔权利金的大部分。"
            f"这一块是四块里最大的，358 手都是{CAT_BOTH}。",
        ],
        "上图是到期日的盈亏曲线，红带是赚、绿带是亏。海军蓝点是卖出当天的期货价。圆点和菱形按盈亏着色，红是赚、绿是亏：圆点是 11 月 3 日若当天到期，菱形是同一天的重估。这笔的到期日还没到。下图左边是期货收盘，右边是重估盈亏。",
    )
    show(
        ni,
        "已经到期",
        [
            f"{_cn_day(ni['dt'])}镍 {ni['label']}。期货收盘 {ni['fut']:.0f}，当天 {ni['day_low']:.0f} 到 {ni['day_high']:.0f}。"
            f"卖出认购 {ni['legs'][0]['k']:.0f}、{ni['legs'][0]['lots']:.0f} 手、均价 {ni['legs'][0]['px']:.1f}，虚值 {_otm(ni['legs'][0], ni['fut']):.0%}；"
            f"卖出认沽 {ni['legs'][1]['k']:.0f}、{ni['legs'][1]['lots']:.0f} 手、均价 {ni['legs'][1]['px']:.1f}，虚值 {_otm(ni['legs'][1], ni['fut']):.0%}。"
            f"从 {ni['times'][0]} 卖到 {ni['times'][-1]}。没有再买。"
            f"收进权利金 {_yuan(ni['credit'])} 元。"
            f"到期日是 {_cn_full(ni['expiry'])}。当天 16:45 这批买平，权利金记成 0。",
            f"到期时期货落在 {ni['be_low']:.0f} 到 {ni['be_high']:.0f} 之间，两腿归零，留下这笔权利金。"
            f"跌破 {ni['be_low']:.0f} 或涨过 {ni['be_high']:.0f}，开始亏，而且不封顶。",
            f"到期日期货收到 {ni['end_fut']:.0f}，在两个行权价之间，两腿都归零。"
            f"留下 {_yuan(ni['live'], signed=True)} 元，扣手续费后 {_yuan(ni['live'] - ni['fee'], signed=True)} 元。"
            "同一张 130000 认购在 10 月 15 日还卖过 10 手，那天只有认购，也在这批里归零。图上这 13 手只算 21 日。"
            "这一块里走到到期的还有 10 月 15 日的铜，25 手，四个行权价，同样在 10 月 26 日归零。两天合计 53 手。",
        ],
        "上图是到期盈亏，红带是赚、绿带是亏。红色菱形是 10 月 26 日的期货价，期权在批次里归零，所以菱形落在收进的权利金上。下图右边在到期日收到这个数字。",
    )
    prof.heading(doc, CAT_BOTH_BUY, 2)
    prof.para(
        doc,
        "骨架仍是短宽跨式。到期盈亏先按上面的两腿短跨式计算，再减去买进那一腿的权利金、加上它的内在价值。"
        "买进的行权价更近，手数更少。期货走到卖出行权价内侧时，买进的那手先变成实值，盈亏比纯卖跨高一截。"
        "期货走过卖出的行权价以后，空头手数仍然更多，这一侧的亏损不封顶。买进的几手没有把亏损封住。"
        f"这一块 {buy_b['days']} 天里，{buy_b['credit_days']} 天净收权利金，{buy_b['debit_days']} 天净付权利金。"
        "净收的日子，到期期货留在两个盈亏平衡之间就留下权利金。"
        "净付的日子，买进的近端必须在到期变成实值，内在价值要盖过付出去的净权利金。期货若停在所有行权价外侧，几张一起归零，净权利金亏掉。"
        "下面已经到期的镍就是净付的那一天。",
    )
    prof.para(
        doc,
        "净收权利金的日子，高概率的结果是几张归零、留下权利金。净付权利金的日子，高概率的结果是几张归零、把付出去的权利金亏掉，正期望要靠买进的近端实值概率高于成交价所含的概率。"
        f"豆粕这套是净收的：{_expect_lines(meal)}"
        f"已经到期的镍是净付的：{_expect_lines(wing)}",
    )
    show(
        meal,
        "还没到期",
        [
            f"{_cn_day(meal['dt'])}豆粕 {meal['label']}。期货收盘 {meal['fut']:.0f}，当天 {meal['day_low']:.0f} 到 {meal['day_high']:.0f}。"
            f"{meal['times'][0]} 卖出认沽 {meal['legs'][1]['k']:.0f}、{meal['legs'][1]['lots']:.0f} 手、权利金 {meal['legs'][1]['px']:.1f}，虚值 {_otm(meal['legs'][1], meal['fut']):.0%}。"
            f"接着卖出认购 {meal['legs'][0]['k']:.0f}、{meal['legs'][0]['lots']:.0f} 手、权利金 {meal['legs'][0]['px']:.1f}，虚值 {_otm(meal['legs'][0], meal['fut']):.0%}。"
            f"{meal['times'][-1]} 买进认购 {meal['legs'][2]['k']:.0f}、{meal['legs'][2]['lots']:.0f} 手、权利金 {meal['legs'][2]['px']:.1f}，虚值 {_otm(meal['legs'][2], meal['fut']):.0%}。"
            "买的行权价更近，只有 2 手，对上 15 手卖出的认购。"
            f"三笔轧差后收进 {_yuan(meal['credit'])} 元。"
            f"到期日是 {_cn_full(meal['expiry'])}，大商所豆粕 1 月期权，交割月前一个月的第 12 个交易日。",
            f"到期时，期货在 {meal['be_low']:.0f} 到 {meal['legs'][2]['k']:.0f} 之间，三张期权都归零，留下 {_yuan(meal['credit'])} 元。"
            f"从 {meal['legs'][2]['k']:.0f} 走到卖出认购的 {meal['legs'][0]['k']:.0f}，买进的两手先变成实值，盈亏升到约 {_yuan(meal['peak'])} 元。"
            f"过了 {meal['legs'][0]['k']:.0f}，15 手空头对 2 手多头，净下来还空 13 手认购。"
            f"期货到 {meal['be_high']:.0f} 以上这笔转亏，往上不封顶。跌破 {meal['be_low']:.0f}，认沽那条腿开始亏。"
            "买进的两手没有把上涨的亏损封住。",
            f"到 {pd.Timestamp(meal['end_dt']).strftime('%m-%d')} 期货 {meal['end_fut']:.0f}，还在认沽和买进认购两个行权价之间，三张都还没有平，到期日还没到。"
            f"卖出的认购收到 {meal['legs'][0]['end']:.1f}，盈亏 {_yuan(_leg_pnl(meal['legs'][0], meal['mult']), signed=True)} 元；"
            f"买进的认购收到 {meal['legs'][2]['end']:.1f}，盈亏 {_yuan(_leg_pnl(meal['legs'][2], meal['mult']), signed=True)} 元；"
            f"认沽收到 {meal['legs'][1]['end']:.1f}，盈亏 {_yuan(_leg_pnl(meal['legs'][1], meal['mult']), signed=True)} 元。"
            f"合计 {_yuan(meal['live'], signed=True)} 元，扣手续费后 {_yuan(meal['live'] - meal['fee'], signed=True)} 元。"
            f"若到期仍停在 {meal['end_fut']:.0f}，能留下 {_yuan(meal['expiry_here'])} 元。",
        ],
        "上图红带是赚、绿带是亏。到期盈亏在两个卖出行权价之间是一条平线，靠近卖出认购时因为买进的两手先变实值而拱起，过了卖出行权价就掉下去。红色菱形是 11 月 3 日的重估。下图是期货路径和重估。这笔到 11 月 3 日还没有平。",
    )
    show(
        wing,
        "已经到期",
        [
            f"{_cn_day(wing['dt'])}镍 {wing['label']}，夜盘。"
            f"期货收盘 {wing['fut']:.0f}，当天 {wing['day_low']:.0f} 到 {wing['day_high']:.0f}。"
            f"{wing['times'][0]} 卖出认沽 {wing['legs'][1]['k']:.0f}、{wing['legs'][1]['lots']:.0f} 手、权利金 {wing['legs'][1]['px']:.0f}，虚值 {_otm(wing['legs'][1], wing['fut']):.0%}。"
            f"{wing['times'][1]} 买进认购 {wing['legs'][2]['k']:.0f}、{wing['legs'][2]['lots']:.0f} 手、权利金 {wing['legs'][2]['px']:.0f}，虚值 {_otm(wing['legs'][2], wing['fut']):.0%}。"
            f"{wing['times'][2]} 卖出认购 {wing['legs'][0]['k']:.0f}、{wing['legs'][0]['lots']:.0f} 手、权利金 {wing['legs'][0]['px']:.0f}，虚值 {_otm(wing['legs'][0], wing['fut']):.0%}。"
            "买的行权价更近，1 手对上 2 手卖出的认购。"
            f"买进付了 {_yuan(wing['legs'][2]['px'] * wing['legs'][2]['lots'])} 元，两边卖出只收回 204 元，轧差付出去 {_yuan(-wing['credit'])} 元。",
            f"到期日是 {_cn_full(wing['expiry'])}，和上一笔同一天的 16:45 批次。",
            f"期货若走到买进的 {wing['legs'][2]['k']:.0f} 和卖出认购的 {wing['legs'][0]['k']:.0f} 之间，买进的那手先变成实值，盈亏最高约 {_yuan(wing['peak'])} 元。"
            f"过了 {wing['legs'][0]['k']:.0f}，2 手空头对 1 手多头，净下来还空 1 手，往上不封顶。"
            "买进的这一手没有把上涨的亏损封住。",
            f"到期日期货收到 {wing['end_fut']:.0f}，低于买进的行权价，三张都归零。"
            f"买进的权利金全亏掉，结果 {_yuan(wing['live'], signed=True)} 元，扣手续费后 {_yuan(wing['live'] - wing['fee'], signed=True)} 元。"
            "110000 认沽在 21 日已经卖过 15 手，图上这两手是 22 日新加的。"
            "走到到期的这一块只有这 4 手卖出。",
        ],
        "上图红带是赚、绿带是亏。两个卖出行权价之间是付出去的净权利金。靠近卖出认购时因为买进的那手先变实值而拱起，过了卖出行权价就掉下去。绿色菱形在拱起的左边，三张都归零。",
    )
    prof.heading(doc, CAT_RATIO, 2)
    prof.para(
        doc,
        "只卖一边，再买同一边更近的行权价，而且买的手数更少。"
        "认购的到期盈亏（元）是"
        "（卖出权利金 − max(到期期货 − 卖出行权价, 0)）× 卖出手数 × 乘数"
        " + （max(到期期货 − 买进行权价, 0) − 买进权利金）× 买进手数 × 乘数。"
        "认沽把 max 里面的减数倒过来，内在价值是 max(行权价 − 到期期货, 0)。"
        "期货朝卖出的行权价走、还没走过它的时候，买进的几手先赚，盈亏在卖出行权价那里最高。"
        "走过卖出行权价以后，剩下的是净空头，亏损不封顶。"
        "另一侧没有卖出的腿。卖认购时，期货下跌两张都归零，留下净权利金，下跌不增加亏损。卖认沽时，期货上涨同样留下净权利金。"
        f"这一块 {ratio_b['days']} 天全部是净收权利金。"
        "开仓时他在赌期货不要走过卖出的行权价。买进的近端是价格接近那个行权价时多出来的一截利润，不是亏损的上限。",
    )
    prof.para(
        doc,
        "卖出腿的高概率结果是归零、留下权利金。买进的近端要让整笔期望大于 0，他得把这张的 qh 报得高于成交价里的 q。手数少，主账仍是卖出腿的 qh 要低于 q。"
        f"玉米这套：{_expect_lines(corn)}"
        f"已经到期的锡：{_expect_lines(tin)}",
    )
    show(
        corn,
        "还没到期",
        [
            f"{_cn_day(corn['dt'])}玉米 {corn['label']}。期货收盘 {corn['fut']:.0f}，当天 {corn['day_low']:.0f} 到 {corn['day_high']:.0f}，收在最高价。"
            f"{corn['times'][0]} 卖出认购 {corn['legs'][0]['k']:.0f}、{corn['legs'][0]['lots']:.0f} 手、权利金 {corn['legs'][0]['px']:.1f}，虚值 {_otm(corn['legs'][0], corn['fut']):.0%}。"
            f"{corn['times'][-1]} 买进认购 {corn['legs'][1]['k']:.0f}、{corn['legs'][1]['lots']:.0f} 手、权利金 {corn['legs'][1]['px']:.1f}，虚值 {_otm(corn['legs'][1], corn['fut']):.0%}。"
            "两笔相隔十几秒。没有认沽。"
            f"轧差后收进 {_yuan(corn['credit'])} 元。"
            f"到期日是 {_cn_full(corn['expiry'])}。玉米 1 月期权比豆粕 1 月早一个月，落在交割月前两个月的第 12 个交易日。",
            "下跌这一侧没有卖出的腿，价格跌下去仍然留下这笔权利金。"
            f"从买进的 {corn['legs'][1]['k']:.0f} 涨到卖出的 {corn['legs'][0]['k']:.0f}，两手多头先赚，盈亏升到约 {_yuan(corn['peak'])} 元。"
            f"过了 {corn['legs'][0]['k']:.0f}，20 手空头对 2 手多头，净空 18 手。"
            f"期货到 {corn['be_high']:.0f} 以上转亏，往上不封顶。",
            f"到 {pd.Timestamp(corn['end_dt']).strftime('%m-%d')} 期货 {corn['end_fut']:.0f}，两张认购都还是虚值。到期日还没到，这笔没有平掉。"
            f"卖出的收到 {corn['legs'][0]['end']:.1f}，盈亏 {_yuan(_leg_pnl(corn['legs'][0], corn['mult']), signed=True)} 元；"
            f"买进的收到 {corn['legs'][1]['end']:.1f}，盈亏 {_yuan(_leg_pnl(corn['legs'][1], corn['mult']), signed=True)} 元。"
            f"合计 {_yuan(corn['live'], signed=True)} 元，扣手续费后 {_yuan(corn['live'] - corn['fee'], signed=True)} 元。"
            "10 月 15 日他还单独卖过 4 手玉米 2380 认购，不在这张图里。",
        ],
        "上图红带是赚、绿带是亏。左边一直到买进行权价都是收进的权利金。价格再往上，先因为买进的两手拱起，过了卖出行权价就转为亏损。红色菱形是 11 月 3 日的重估。下图是期货路径和重估。这笔到 11 月 3 日还没有平。",
    )
    show(
        tin,
        "已经到期",
        [
            f"{_cn_day(tin['dt'])}锡 {tin['label']}。期货收盘 {tin['fut']:.0f}，当天 {tin['day_low']:.0f} 到 {tin['day_high']:.0f}。"
            f"{tin['times'][0]} 起到 {tin['times'][-2] if len(tin['times']) > 1 else tin['times'][0]} 卖出认沽 {tin['legs'][0]['k']:.0f}、{tin['legs'][0]['lots']:.0f} 手、均价 {tin['legs'][0]['px']:.1f}，虚值 {_otm(tin['legs'][0], tin['fut']):.0%}。"
            f"{tin['times'][-1]} 买进认沽 {tin['legs'][1]['k']:.0f}、{tin['legs'][1]['lots']:.0f} 手、权利金 {tin['legs'][1]['px']:.0f}，虚值 {_otm(tin['legs'][1], tin['fut']):.0%}。"
            "买的行权价更近，1 手对上 15 手。没有认购。"
            f"轧差后收进 {_yuan(tin['credit'])} 元。",
            f"到期日是 {_cn_full(tin['expiry'])}，16:45 的批次里两张认沽都归零。",
            "上涨这一侧没有卖出的腿，价格涨上去仍然留下这笔权利金。"
            f"从买进的 {tin['legs'][1]['k']:.0f} 跌到卖出的 {tin['legs'][0]['k']:.0f}，买进的那手先变成实值，盈亏升到约 {_yuan(tin['peak'])} 元。"
            f"再往下，15 手空头对 1 手多头，净空 14 手，不封底。",
            f"到期日期货收到 {tin['end_fut']:.0f}，远在两个行权价上面，两张都归零。"
            f"留下 {_yuan(tin['live'], signed=True)} 元，扣手续费后 {_yuan(tin['live'] - tin['fee'], signed=True)} 元。"
            "买进的那手没有派上用场。"
            "这一块里走到到期的还有 10 月 15 日锡的 6 手认购配 2 手更近的认购，以及当天橡胶的 7 手认沽配 1 手更近的认沽。三天合计卖出 28 手。",
        ],
        "上图红带是赚、绿带是亏。行权价右边是收进的权利金。价格跌进两个行权价之间，买进的那手先拱起，跌过卖出行权价以后转为亏损。红色菱形在右边的平线上，两张都归零。",
    )
    prof.heading(doc, CAT_NAKED, 2)
    prof.para(
        doc,
        "只卖一边，没有再买。"
        "认购的到期盈亏（元）是（权利金 − max(到期期货 − 行权价, 0)）× 手数 × 乘数，盈亏平衡是行权价加上权利金。"
        "到期期货低于平衡价，留下权利金，跌再多也不增加这笔的亏损。涨过平衡价以后，期货每多一个点，亏 手数 × 乘数，往上不封顶。"
        "认沽反过来：平衡价是行权价减去权利金，涨再多不增加亏损，跌过平衡价以后往下不封底。"
        f"这一块卖开 {naked_b['sell_lots']:.0f} 手，认购 {naked_b['call_lots']:.0f} 手、认沽 {naked_b['put_lots']:.0f} 手，{naked_b['days']} 天全部是净收权利金。"
        "卖认购是在赌期货不要涨过平衡价，卖认沽是在赌期货不要跌过平衡价。"
        "开仓时已经收进权利金。期货不动，时间过去，卖出的权利金变便宜，到期前的盯市就在赚。隐波升高会把这个盯市倒过来。到期算总账时隐波不再进公式，只看期货过没过平衡价。",
    )
    prof.para(
        doc,
        "这里没有买进的腿。卖出一张时，qh 等于成交价里的 q，期望是 0，减手续费后为负。"
        "他开仓，是 qh 低于 q，期望 = 权利金 × (1 − qh/q) 大于 0。"
        f"鸡蛋这套：{_expect_lines(egg)}"
        f"已经到期的沥青：{_expect_lines(asphalt)}",
    )
    show(
        egg,
        "还没到期",
        [
            f"{_cn_day(egg['dt'])}鸡蛋 {egg['label']}。期货收盘 {egg['fut']:.0f}，当天 {egg['day_low']:.0f} 到 {egg['day_high']:.0f}。"
            f"当天上涨，收盘仍比行权价低 {_otm(egg['legs'][0], egg['fut']):.0%}。"
            f"{egg['times'][0]} 到 {egg['times'][-1]} 卖出认购 {egg['legs'][0]['k']:.0f}、{egg['legs'][0]['lots']:.0f} 手、权利金 {egg['legs'][0]['px']:.1f}。"
            "没有认沽，也没有再买。"
            f"收进 {_yuan(egg['credit'])} 元。"
            f"到期日是 {_cn_full(egg['expiry'])}，大商所鸡蛋 12 月期权，交割月前一个月的第 12 个交易日。",
            f"到期时期货在 {egg['be_high']:.0f} 以下，认购归零，留下这笔权利金。"
            f"涨过 {egg['be_high']:.0f} 开始亏，往上不封顶。跌多少都不增加这笔的亏损。",
            f"到 {pd.Timestamp(egg['end_dt']).strftime('%m-%d')} 期货 {egg['end_fut']:.0f}，认购收到 {egg['legs'][0]['end']:.1f}。到期日还没到，这 20 手还在仓里。"
            f"重估 {_yuan(egg['live'], signed=True)} 元，扣手续费后 {_yuan(egg['live'] - egg['fee'], signed=True)} 元。"
            f"若到期仍停在 {egg['end_fut']:.0f}，能留下 {_yuan(egg['expiry_here'])} 元。"
            f"这 20 手是{CAT_NAKED}里最大的一笔。",
        ],
        "上图红带是赚、绿带是亏。行权价左边是一条平线，就是收进的权利金。涨过盈亏平衡点以后直线向下。红色菱形是 11 月 3 日的重估。下图是期货路径和重估。这笔到 11 月 3 日还没有平。",
    )
    show(
        asphalt,
        "已经到期",
        [
            f"{_cn_day(asphalt['dt'])}沥青 {asphalt['label']}。期货收盘 {asphalt['fut']:.0f}，当天 {asphalt['day_low']:.0f} 到 {asphalt['day_high']:.0f}。"
            f"收盘比行权价低 {_otm(asphalt['legs'][0], asphalt['fut']):.0%}。"
            f"{asphalt['times'][0]} 到 {asphalt['times'][-1]} 卖出认购 {asphalt['legs'][0]['k']:.0f}、{asphalt['legs'][0]['lots']:.0f} 手、权利金 {asphalt['legs'][0]['px']:.1f}。"
            "没有认沽，也没有再买。"
            f"收进 {_yuan(asphalt['credit'])} 元。",
            f"到期日是 {_cn_full(asphalt['expiry'])}。当天 16:45 这张认购归零。",
            f"到期时期货在 {asphalt['be_high']:.0f} 以下，认购归零，留下这笔权利金。"
            f"涨过 {asphalt['be_high']:.0f} 开始亏，往上不封顶。跌多少都不增加这笔的亏损。",
            f"到期日期货收到 {asphalt['end_fut']:.0f}，还在行权价下面。"
            f"留下 {_yuan(asphalt['live'], signed=True)} 元，扣手续费后 {_yuan(asphalt['live'] - asphalt['fee'], signed=True)} 元。"
            "这一块里走到到期的还有 10 月 15 日镍的 10 手认购、螺纹的 10 手认沽、20 日锡的 2 手认购，以及 23 日大商所到期的 1 手生猪认购。五天合计 33 手。",
        ],
        "上图红带是赚、绿带是亏。行权价左边是收进的权利金。涨过盈亏平衡点以后直线向下。红色菱形在平线上，认购归零。",
    )


def fmt_feat(v, feature: str) -> str:
    if v is None or not math.isfinite(float(v)):
        return "—"
    v = float(v)
    if "pct" in feature:
        return f"{v:.0%}"
    if "ret" in feature:
        return f"{v:.2%}"
    if feature == "atm_iv_lag" or feature == "vrp_lag":
        return f"{v:.1f}"
    if feature == "basis_ann_lag":
        return f"{v:.2f}"
    return f"{v:.2f}"


def write_doc(path, summary, pick, timing, months, rows, tape, both, only_opt, fut_lots, fut_sell, fut_buy, example, buckets, cases, dte, logic, opt) -> None:
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.left_margin = Cm(1.6)
    sec.right_margin = Cm(1.6)
    sec.top_margin = Cm(1.5)
    sec.bottom_margin = Cm(1.5)
    prof.heading.offset = 0
    seq = {"fig": 0, "tab": 0}
    charts = OUT / "charts"

    def add_fig(pic, cap: str) -> None:
        p = Path(pic) if pic else None
        if p is None or not p.exists():
            return
        seq["fig"] += 1
        doc.add_picture(str(p), width=Inches(6.3))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
        prof.caption(doc, f"图{seq['fig']}  {cap}")

    def add_tab(headers, body, cap: str) -> None:
        prof.add_table(doc, headers, body)
        seq["tab"] += 1
        prof.caption(doc, f"表{seq['tab']}  {cap}")

    prof.para(doc, "内部资料 · 交易策略 · 请勿外传", size=9, color=prof.GOLD, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)
    prof.para(doc, "RX383 交易策略", size=24, bold=True, color=prof.NAVY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    prof.para(doc, "未登记投顾 · 未登记团队", size=12, color=prof.TEXT, align=WD_ALIGN_PARAGRAPH.CENTER)
    prof.para(
        doc,
        f"成交  {summary['from']}  ~  {summary['to']}      期权 {summary['n_trades']} 笔 / {summary['lots']:.0f} 手      期货 {fut_lots:.0f} 手      {summary['n_products']} 个标的",
        size=11, color=prof.MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10,
    )

    both_names = "、".join(r["product"] for r in both) or "没有"
    strike = (timing or {}).get("strike") or {}
    call = strike.get("call_otm") or {}
    put = strike.get("put_otm") or {}
    yuan = strike.get("prem_yuan") or {}
    delta = strike.get("abs_delta") or {}
    ex = strangle_payoff()

    prof.heading(doc, "结论", 1)
    prof.para(
        doc,
        f"这半个月，RX383 做的是商品期权卖权，核心是短宽跨式：同一个品种、同一天卖出虚值认购和虚值认沽。"
        f"卖开 {summary['sell_lots']:.0f} 手，分成四块："
        f"{CAT_BOTH} {buckets['both_only']:.0f} 手；"
        f"{CAT_BOTH_BUY} {buckets['both_wing']:.0f} 手；"
        f"{CAT_RATIO} {buckets['one_wing']:.0f} 手；"
        f"{CAT_NAKED} {buckets['one_naked']:.0f} 手。"
        f"认购在期货上方大约 {call.get('p50', float('nan')):.0%}，认沽在下方大约 {put.get('p50', float('nan')):.0%}，绝对 delta 中位 {delta.get('p50', float('nan')):.3f}。"
        "样本里已经在到期日了结的，是 10 月 26 日上期所 11 月期权：117 手空头在 16:45 一批买平，成交价记成行权价、权利金为 0。"
        "大商所 11 月期权在 10 月 23 日到期，账上只有 1 手生猪认购，当天 16:44 同样了结。"
        "盘中另外买平 33 手，多数是赚着平的。"
        "第二节每一块有两笔：一笔到 11 月 3 日还开着，一笔已经在到期日了结。第一节的螺纹 1 月是还开着的那一笔。",
    )
    prof.para(
        doc,
        "月份是后面两个月一起卖。10 月 26 日上期所 11 月期权到期，他当天卖开 0 手、买平 117 手；"
        "10 月 27 日改卖 12 月 70 手和 1 月 63 手，11 月合约从此为 0。"
        f"全部期权开仓 {dte['lots']:.0f} 手，开仓日到该合约到期日的手数加权中位是 {dte['p50']:.0f} 个自然日，"
        f"最短 {dte['min']} 天，最长 {dte['max']} 天。",
    )
    logit = pick.get("logit") or {}
    rnd = pick.get("random") or {}
    prof.para(
        doc,
        f"品种是从当天大约 {pick.get('universe_med', 0):.0f} 个有行情的名字里挑 {pick.get('k_med', 0):.1f} 个。"
        f"用前一天的成交量、期货曲线和隐波减实现波动来挑，对上他 {logit.get('hits', 0)}/{logit.get('k', 0)} 个品种日，随机大约 {rnd.get('mean', float('nan')):.0%}。",
    )
    prof.para(
        doc,
        f"期货只出现在 {both_names}，{fut_sell:.0f} 手全部是卖开，没有买回，其中 29 手和当天的期权卖开在同一天。"
        f"这两个品种是短宽跨式再加一截期货空头。另外 {len(only_opt)} 个品种只有期权。",
    )
    prof.para(
        doc,
        f"到期批次留下了大约九成权利金。到 {summary['end_date']}，还留在仓里的期权按开仓价重估 {summary['end_floating']:+,.0f} 元，"
        f"已经平掉的 {summary['end_realized']:+,.0f} 元，扣手续费后 {summary['end_econ']:+,.0f} 元。"
        "已经到期的那一截时间价值落袋了，还开着的合约要等到它们自己的到期日。",
    )

    prof.heading(doc, f"一、{CAT_BOTH}", 1)
    prof.para(
        doc,
        "短宽跨式是同时卖出同一期货上的一张虚值认购和一张虚值认沽。认购的行权价在期货价格上面，认沽的行权价在下面，所以两条腿都离现价有一段距离，这就是「宽」。卖出当时收进两笔权利金。",
    )
    prof.para(
        doc,
        "到期时，期货价格若留在两个行权价之间，两张期权的内在价值都是 0，卖出的人留下全部权利金。价格每天不动，期权就变便宜一截，这截就是时间价值。"
        "价格跌破认沽行权价，认沽变成实值，亏损从行权价往下一条直线。价格涨过认购行权价，认购变成实值，亏损往上一条直线。"
        "最高利润就是当初收进的权利金。亏损这一侧随着价格离开行权价一直增加。",
    )
    prof.para(
        doc,
        f"下图把他的中位距离画成一条，期货价格记成 {ex['spot']:.0f}。"
        f"认购行权价 {ex['k_call']:.0f}，高 {ex['k_call'] / ex['spot'] - 1:.0%}；认沽行权价 {ex['k_put']:.0f}，低 {1 - ex['k_put'] / ex['spot']:.0%}。"
        f"平值隐波用他卖开时的中位数 {ex['sig']:.1%}，离到期大约 60 天，两腿权利金合计 {ex['credit']:.2f}，大约是期货价格的 {ex['credit'] / ex['spot']:.2%}。"
        f"到期盈亏在 {ex['k_put']:.0f} 和 {ex['k_call']:.0f} 之间是一条平线，最高 +{ex['credit']:.2f}。"
        f"价格跌到 {ex['be_low']:.1f} 以下或涨到 {ex['be_high']:.1f} 以上，这条线穿过 0，开始亏。"
        f"还剩 30 天、价格仍停在 {ex['spot']:.0f} 时，盈亏是 {ex['pnl_mid_live']:+.2f}，到不了 +{ex['credit']:.2f}，因为两腿还剩着时间价值。",
    )
    add_fig(
        ex["path"],
        "上图是完整的盈亏，下图把行权价附近放大。海军蓝是到期日的盈亏，金色是还剩 30 天。虚线是两个行权价，点线是卖出时的期货价。",
    )
    add_tab(
        ["期货价格", "到期盈亏", "还剩 30 天"],
        [[f"{r['px']:.0f}", f"{r['exp']:+.2f}", f"{r['live']:+.2f}"] for r in ex["rows"]],
        f"期货价格记为 100 时的盈亏。+{ex['credit']:.2f} 是两腿权利金，也是到期时的最高利润。",
    )
    if example:
        gap = ""
        if len(example["ttimes"]) >= 2:
            gap = f"两笔成交时间是 {' 和 '.join(str(t)[:8] for t in example['ttimes'][:2])}。"
        prof.para(
            doc,
            f"和他这张图最接近的一笔，是 {example['dt']} 的{example['name']} {example['label']}。"
            f"当天期货收盘 {example['fut']:.0f}，盘中在 {example['day_low']:.0f} 到 {example['day_high']:.0f}。"
            f"他卖出认购 {example['kc']:.0f}、{example['lc']:.0f} 手、权利金 {example['pc']:.1f}，虚值 {example['otm_c']:.0%}；"
            f"卖出认沽 {example['kp']:.0f}、{example['lp']:.0f} 手、权利金 {example['pp']:.1f}，虚值 {example['otm_p']:.0%}。"
            f"{gap}手数相同，各一个行权价。",
        )
        prof.para(
            doc,
            f"一套的权利金是 {example['credit_pts']:.1f} 个点。到期时期货落在 {example['be_low']:.0f} 到 {example['be_high']:.0f} 之间，两腿归零，"
            f"{example['lc']:.0f} 套留下权利金 {example['credit_yuan']:.0f} 元，扣手续费 {example['fee']:.0f} 元后是 {example['credit_yuan'] - example['fee']:.0f} 元。"
            f"跌破 {example['be_low']:.0f} 或涨过 {example['be_high']:.0f}，开始亏，而且亏起来不封顶。",
        )
        prof.para(
            doc,
            f"到期日是 {_cn_full(example['expiry'])}，上期所螺纹 1 月期权，交割月前一个月的倒数第 5 个交易日。"
            f"到 {example['end_dt']} 这套还在，没有平仓，到期日还没到。期货收到 {example['end_fut']:.0f}，仍在盈利区间里，"
            f"离认沽行权价大约 {example['end_fut'] - example['kp']:.0f} 点，离认购大约 {example['kc'] - example['end_fut']:.0f} 点。"
            f"认购结算价从 {example['pc']:.1f} 收到 {example['end_call']:.1f}，盈亏 {example['call_pnl']:+,.0f} 元；"
            f"认沽结算价从 {example['pp']:.1f} 收到 {example['end_put']:.1f}，盈亏 {example['put_pnl']:+,.0f} 元。"
            f"两腿合计 {example['live']:+,.0f} 元，扣手续费后 {example['live_net']:+,.0f} 元。"
            f"两腿结算价都比卖出价低。"
            f"若到期价格仍停在 {example['end_fut']:.0f}，两腿归零，能留下 {example['expiry_if_here']:.0f} 元权利金。现在重估已经是这笔权利金的大部分。"
            "已经在到期日了结的短宽跨式，写在下一节，是 10 月 21 日的镍。",
        )
        add_fig(
            example["path"],
            f"上图是这 {example['lc']:.0f} 套在到期日的盈亏曲线，红带是赚、绿带是亏。海军蓝点是卖出当天的期货价。圆点和菱形按盈亏着色，红是赚、绿是亏：圆点是 {example['end_dt'][5:]} 若当天到期，菱形是同一天按期权结算价的重估。这笔到样本结束还没到期。"
            "下图左边是期货收盘，右边是重估盈亏，红色虚线是到期最高利润。",
        )
        add_tab(
            ["腿", "行权价", "卖出价", "手数", f"{example['end_dt'][5:]} 结算价", "盈亏"],
            [
                ["认购", f"{example['kc']:.0f}", f"{example['pc']:.1f}", f"{example['lc']:.0f}", f"{example['end_call']:.1f}", f"{example['call_pnl']:+,.0f}"],
                ["认沽", f"{example['kp']:.0f}", f"{example['pp']:.1f}", f"{example['lp']:.0f}", f"{example['end_put']:.1f}", f"{example['put_pnl']:+,.0f}"],
                ["合计", "—", f"{example['credit_pts']:.1f}", f"{example['lc'] + example['lp']:.0f}", "—", f"{example['live']:+,.0f}"],
            ],
            f"手续费 {example['fee']:.0f} 元，扣完是 {example['live_net']:+,.0f} 元。重估用期权结算价。",
        )
    prof.para(
        doc,
        f"{both_names} 上多出来的期货空头不在这张图里。那一截空头在价格上涨时多亏、下跌时少亏，是加在短宽跨式上的方向。图上这条线是纯卖权。",
    )

    prof.heading(doc, "二、一笔交易在做什么", 1)
    prof.para(
        doc,
        f"主仓是卖虚值期权。卖开 {summary['sell_lots']:.0f} 手，其中认购 {summary['sell_call']:.0f} 手、认沽 {summary['sell_put']:.0f} 手。"
        f"按同一天、同一品种把这 {summary['sell_lots']:.0f} 手拆开，四块相加就是全部："
        f"{CAT_BOTH} {buckets['both_only']:.0f} 手；"
        f"{CAT_BOTH_BUY} {buckets['both_wing']:.0f} 手；"
        f"{CAT_RATIO} {buckets['one_wing']:.0f} 手；"
        f"{CAT_NAKED} {buckets['one_naked']:.0f} 手，其中认购 {buckets['one_call']:.0f} 手、认沽 {buckets['one_put']:.0f} 手。"
        "行权价卡的是虚值距离，不是一张固定的权利金。",
    )
    if buckets.get("buy_nearer") and buckets.get("buy_smaller"):
        prof.para(
            doc,
            "短宽跨式加近买和比率价差里，买进的行权价都比同边卖出的更靠近期货价，买入手数也不超过同边卖出。"
            "买进的几手会在卖出行权价内侧先赚一截。价格走过卖出的行权价以后，空头手数仍然更多，这一侧的亏损不封顶。",
        )
    prof.para(
        doc,
        "他开仓，是因为按他自己的概率，期望大于 0。成交价里也能解出一个实值概率 q，那是市场价格自己的概率。"
        "用 q 去算，期望刚好是 0，再减手续费为负。这个 0 不是他的预测，是把成交价代回它自己。"
        "卖出时，他用的实值概率 qh 必须低于 q，期望才大于 0。买进时，qh 必须高于 q。",
    )
    prof.para(
        doc,
        "概率按 Black-76 算，利率取 0，期货价用开仓当天的期货收盘。距到期的年数 T 是自然日除以 365。"
        "σ 是年化隐波，F 是期货价，K 是行权价。先算两个标准化距离："
        "d1 = [ln(F/K) + σ²T/2] / (σ√T)，d2 = d1 − σ√T。"
        "N(x) 是标准正态累积，N(x) = 1/2 × (1 + erf(x/√2))。"
        "认购模型价 = F×N(d1) − K×N(d2)。认沽模型价 = K×N(−d2) − F×N(−d1)。"
        "隐波不是平值隐波，是把 σ 从低往高试，直到模型价等于这张的成交价。"
        "在这个 σ 的对数正态下面，认购到期实值的概率是 N(d2)，认沽到期实值的概率是 N(−d2)。"
        "虚值概率是 1 减去实值概率。权利金乘虚值概率，再乘手数和合约乘数，就是只算虚值、不算实值亏损的那个金额。"
        "记这个实值概率为 q。实值时平均要亏的点数，用成交价反推，是 权利金/q。"
        "他用的实值概率记为 qh。卖出一条腿的期望（点）= 权利金 × (1 − qh) − (权利金/q) × qh = 权利金 × (1 − qh/q)。"
        "再乘手数和合约乘数，得到元。qh = q 时，括号里是 0，期望是 0。qh < q 时期望大于 0，这是卖出开仓的条件。qh > q 时期望为负。"
        "买进一条腿把不等号倒过来：qh > q 时期望大于 0。",
    )
    prof.para(
        doc,
        "螺纹认购代一次数。F = 3068，K = 3500，成交价 5.0 点，到期隔 67 天，T = 67/365 = 0.1836。"
        "解出来的 σ = 18.35%。σ√T = 0.0786。"
        "ln(3068/3500) = −0.1317，加上 σ²T/2 的 0.0031，再除以 0.0786，d1 = −1.636，d2 = −1.715。"
        "N(d2) = 4.3%，这就是到期期货高于 3500 的概率。虚值概率 95.7%。"
        "5.0 × 95.7% × 10 手 × 乘数 10 = 478 元。"
        "认沽 F 仍是 3068，K = 2750，成交价 3.5 点，解出 σ = 15.09%，d2 = 1.660，N(−d2) = 4.8%。"
        "3.5 × 95.2% × 10 × 10 = 333 元。两条相加 811 元，这是 qh = 0、实值一次都不算的算法。"
        "认购的 q = 4.3%。若他用的 qh 也是 4.3%，期望 = 5.0 × (1 − 4.3%/4.3%) = 0，扣掉这笔 30 元手续费后为负，按这个概率不该卖。"
        "若他认为认购只有 2% 的机会实值，期望 = 5.0 × (1 − 2%/4.3%) = 2.7 点，10 手 × 乘数 10 = 267 元，这一条腿就盖过了手续费。"
        "2% 是用来代入公式的例子，不是从成交里读出来的。成交只给出 q = 4.3%。他愿卖，表示他用的 qh 低于 4.3%，低得越多，期望越大。",
    )
    prof.para(
        doc,
        "把他卖出的成交价和当天平值隐波代进同一个 Black-76，虚值看起来比平值贵。这只说明这些卖单自己长这样，不能当成他的模型。"
        f"期货价和平值隐波都对得上的卖开有 {logic['smile']['lots']:.0f} 手。成交价反解的隐波中位 {logic['smile']['wing']:.0f}%，当天平值隐波中位 {logic['smile']['atm']:.0f}%，高出 {logic['smile']['gap']:.0f} 个百分点。"
        f"用平值隐波算出的实值概率 qh 中位 {logic['smile']['qh']:.1%}，成交价里的 q 中位 {logic['smile']['q']:.1%}。"
        f"这 {logic['smile']['lots']:.0f} 手里有 {logic['smile']['cheaper']:.0f} 手是 qh 低于 q。"
        f"若把平值隐波当成真实概率，这些手的期望加起来约 {_yuan(logic['smile']['edge'])} 元。这是一笔假设账。"
        "拿他这套距离去套当天有平值隐波的全部品种，对不上他的开仓。12 个卖出日，每天有 44 到 45 个品种有平值隐波，合计 531 个品种日，其中他卖了 33 个。"
        "认购虚值 13%、认沽虚值 12%、到期隔 26 天，两边用平值隐波算出的实值概率都低于 5% 的，有 331 个品种日。他卖了 24 个，放过 307 个，打中率 7.3%。"
        "有平值隐波的品种日里，他实际卖出的比例是 6.2%。锰硅平值隐波中位 13%，同一套 13% 认购的实值概率约 0.02%，他没有卖过锰硅。"
        "平值隐波中位在 12% 到 25%、因而同一套距离同样是小概率的，还有铝、菜油、尿素、硅铁、锌、氧化铝、黄金、玻璃、工业硅、乙二醇、纯碱。豆油、白糖、豆一更低。这些他都没卖。"
        "另一头，碳酸锂、锡、镍、橡胶有 9 个卖出品种日，平值隐波高到同样的 13% 认购实值概率已经高于 5%，他仍然卖了。"
        "结算价能对上的虚值里，10 月 29 日乙二醇认沽 4800，期货 5345，结算价 35，隔 19 天到期，反解隐波 43%，当天平值 26%，他没有卖乙二醇。"
        "同一天能对上的镍虚值，隐波和平值只差不到 1 个百分点，他卖了镍。"
        "这一窗大部分期权合约没有结算价，虚值偏离不能逐合约算完全市场。上面 331 个品种日只用不随合约结算价变化的平值隐波和固定距离。"
        "成交里没有另一个模型，能在他开仓的品种上把实值概率算低、在他没开的品种上算高。",
    )
    prof.para(
        doc,
        "支撑和压力用开仓前已经走出来的该合约日线。摆动高点、低点取左右各 5 根里唯一的极值，右边 5 根必须在开仓日前收完，只用开仓前 120 个交易日。前 20 日最高、最低另记一条。"
        "对得上合约日线的卖开有 622 手。行权价离最近的同向摆动点，手数加权中位 5.1%，落在 2% 以内的是 30% 的手数。离前 20 日高点或低点的中位是 8.8%。"
        "80% 的手数，认购行权价在前 20 日高点之上，认沽行权价在前 20 日低点之下。"
        "10 月 19 日螺纹认购 3500 离最近摆动高点 8.3%，离前 20 日高点 11.6%；认沽 2750 离最近摆动低点 8.1%。"
        "同一合约上虚值 5% 到 25% 的其他行权价，离摆动点的中位是 2.5%，2% 以内占 42%。他成交的那些行权价中位 4.5%，2% 以内占 25%。"
        "38 次一边的选择里，有 5 次他的行权价比该边上其他虚值行权价都更靠近摆动点。"
        "再把认购虚值 13%、认沽虚值 12% 套到有日线的品种上，386 个品种日里他卖了 37 个。这套行权价落在摆动点 2% 以内的，卖的是 19%，没卖的是 21%。"
        "行权价站在前 20 日高点之外或低点之外的，卖的是 86%，没卖的是 87%。"
        "11 月 2 日鸡蛋认购 4000、10 月 27 日铅认购 17000 正好压在之前的摆动高点上。这种重合在他没卖的行权价里更多。",
    )
    prof.para(
        doc,
        "把这几段收成一套开仓门槛，再用他卖出的 12 个交易日对一遍，对不上。"
        "那 331 个品种日已经是「平值隐波下，13% 认购和 12% 认沽的实值概率都低于 5%」。他卖了其中 24 个。"
        "在这 331 个里面，用前一日的数每天只取和他当天一样多个："
        "平值隐波减去 5 日、20 日、60 日实现波动的平均，打中 8/24，盲抽大约是 13%，这 8 个里有 4 个是铜，10 月 21 日、22 日、23 日一个都没中。"
        "平值隐波减 20 日实现波动打中 5/24。隐波自身历史分位打中 6/24。"
        "曲线分位偏低打中 4/20，近 5 日跌幅打中 4/24。"
        "离摆动点更近打中 3/24，收在前 20 日区间更靠下打中 3/24，都低于这 331 个里的盲抽。"
        "不先套那条 5% 的门槛，隐波减三段实现波动的平均在全部品种日上是 4/33，盲抽约 10%。"
        "曲线年化升水偏高仍是单因子里最齐的一条，第四节里是 11/43。"
        "深度为 2 的梯度提升树，留出当天再训练，打中 9/43，低于第四节那套线性组合的 13/43。"
        "树在全样本上权重最高的是期货曲线、持仓量和隐波减实现波动。摆动点距离和近 5 日涨跌的权重很低。"
        "这一窗大部分合约没有行权价自己的隐波，虚值相对平值的偏离进不了这棵树。"
        "10 月 23 日和 10 月 26 日权利金为 0 的买平共 118 手。能对上期货价的 101 手都停在行权价外侧。另外 17 手是螺纹和橡胶的 11 月合约，期货价对不上，权利金同样是 0。这些手同一天一起归零。"
        "锰硅、纯碱、工业硅也在那 331 个里面，他没有卖。卖出的月份里包括离到期只有几天的 11 月合约。",
    )
    prof.para(
        doc,
        "再改用他当天自己的虚值距离，不用固定的 13% 和 12%。12 个卖出日里，认购距离中位 13.2%，认沽 11.3%。"
        "按当天这个距离，平值隐波下两边实值概率都低于 5% 的还有 300 个品种日，他卖了 20 个，放过 280 个。"
        "卖开 623 手，手续费 1,119 元，每手中位 1.5 元。权利金每手的十分位是 17.5 元。没有一手低于 10 元，也没有一手低于手续费的两倍。"
        "能按他当天的距离对上结算价的只有 70 条、17 个品种。他卖的那些每手中位 130 元，没卖的中位 45 元。"
        "没卖的里面焦炭大约 1,530 元、橡胶大约 1,930 元。镍、锡、铅、螺纹在他没卖的日子，同样距离的结算价只有几元。这 70 条盖不住那 280 个品种日。"
        "成交价和当天结算价都能对上的有 269 手。成交价高于结算价的占 76%，手数加权中位高出 1.5 个点。相差不超过 0.5 个点的占 27%。"
        "两边都卖的 27 个品种日，认购第一笔和认沽第一笔相隔的中位是 88 秒。15 秒以内占 15%，60 秒以内占 44%，九十分位是 82 分钟。"
        "一个品种从当天第一笔到最后一笔，中位跨度 45 分钟。"
        "期权保证金对客户权益，10 月 15 日 24%，10 月 23 日 41%，10 月 26 日到期批次过后 9%，11 月 3 日回到 41%。"
        "这一窗没有逐笔盘口。12 个交易日、43 个卖出品种日，不够拿序列模型去复刻他按下的是哪一个品种。",
    )
    prof.para(
        doc,
        "日频振幅筛不出他出手的日子。连续合约在这 12 个卖出日上有 870 个品种日，他卖了 51 个。"
        "振幅用最高价减最低价，再除以当天结算价。他卖的中位 2.2%，没卖的中位 2.0%。"
        "每天按振幅从大到小取和他当天一样多个，打中 6/51，盲抽大约 8%。收盘更靠近当天最低价的，打中 3/51。"
        "这一窗没有分钟行情，冲高回落和探底回升量不了。",
    )
    prof.para(
        doc,
        "行权价表在这一窗是残缺的，步长量不出来。10 月 27 日螺纹 2701 的认购只入库了 2750、3150、3300、3500 四档，"
        "锰硅和纯碱各月也只有两三条。对得上本月期货价的 202 条里，他卖的那一侧，最近一条已入库行权价离当天目标距离的中位是 1.4 个百分点，"
        "没卖的一侧是 3.4 个百分点。交易所有没有挂出 13% 那一档，这张表回答不了。",
    )
    prof.para(
        doc,
        "保证金占权益停在 40% 附近的日子，他仍在开仓。10 月 22 日收到 40%，当天卖开 43 手；10 月 23 日 41%，又卖开 25 手；"
        "11 月 2 日 40%，又卖开 25 手。10 月 16 日只占 24%，当天没有新开。10 月 26 日掉到 9% 是 11 月合约到期把保证金放出来，"
        "之后从 10 月 27 日的 20% 用了几个交易日才回到 41%。"
        "能标出期权结算价、又能对上当天虚值距离的，只有 5 个交易日，每天大约 8 到 11 个品种。"
        "卖方保证金按权利金加上期货名义价值的大约 10%、再扣掉虚值额的一半来估。按权利金除以这份保证金从高到低取和他当天一样多个，打中 8/20。"
        "只按权利金金额从高到低，打中 11/20。这些日子里他已经占了可标价品种的将近一半，盲抽也大约是一半。"
        "铁矿、焦炭、豆粕、橡胶多次排在他当天卖出的品种前面。那 280 个没卖的品种日，大多数没有期权结算价，"
        "卖 1 手占多少保证金、收多少权利金，算不出来。",
    )
    prof.para(
        doc,
        "269 手能对上结算价的，成交价中位 3.5 个点，结算价中位 2.5 个点，高出的部分大约是成交价的三分之一。"
        "结算价在 1 个点及以下的占 4%。这是成交价和当天结算价的差，手头没有买一卖一的盘口。",
    )
    prof.para(
        doc,
        "卖开 623 手里，到期不超过 1 天的是 0 手，不超过 4 天的是 4 手，不超过 14 天的是 130 手，手数加权中位 27 天。"
        "能反解出隐波的 507 手里，期货价和隐波都按成交时不动，权利金一天衰减掉的比例中位是 5.8%。"
        "14 天以内的 101 手，这个比例中位 35%。40 天以上的 246 手，中位 3.8%。"
        "能按当天距离对上结算价的翼有 69 条，他卖了 23 条。按每天衰减比例从高到低取和他当天一样多个，打中 13/23。"
        "按剩余天数从短到长，打中 12/23。这 69 条里盲抽大约是 39%。衰减比例和剩余天数挪的是同一些合约。"
        "库里的分钟线只有 50、300、500 的 ETF 和股指期权，从 10 月 23 日才有，盖不住这些商品合约。",
    )
    prof.para(
        doc,
        "认购卖出的 40 个品种日，按期货冲高回落从大到小取同样多个，打中 5/40，盲抽大约 6%。"
        "冲高回落是最高价减结算价，再除以最高价。收盘更靠近最低价的，打中 1/40。"
        "认沽卖出的 38 个品种日，按探底回升打中 5/38，盲抽大约 7%。"
        "只卖认沽、当天没有认购的 11 个品种日，按探底回升打中 0 个。"
        "认购那天收盘落在日内区间的中位大约是 49%。只卖认沽的那天大约是 44%。",
    )
    prof.para(
        doc,
        "有期权成交量的品种日只有 100 个，他占 24 个。按期权成交量从高到低打中 8/24，盲抽大约 37%。按持仓量从高到低也是 8/24。"
        "这一窗没有买卖价差。期货成交量低于他卖出品种日的下四分位、大约 15 万手的，他自己有 13 个品种日，没卖的有 332 个，剩下 487 个没卖的还在。",
    )
    prof.para(
        doc,
        "269 手对得上期权当天的最高价和最低价。成交价在这一高一低之间的位置，手数加权中位是 0.47，落在靠近最高价的那五分之一里的占 14%。"
        "212 手还能用开盘价反解隐波。成交隐波减开盘隐波的中位是 0，成交隐波更高的占 33%。"
        "成交隐波减前一日平值隐波，319 手的中位高出 7.5 个点，高出 8 个点及以上的占 49%。"
        "这是虚值相对前一日平值的差。前面按平值隐波去套 13% 虚值，全板打中率停在基础比例附近。",
    )
    prof.para(
        doc,
        "卖开 623 手的钟点，9:00 到 9:15 占 7%，9 点这一小时占 27%，下午 13 点到 15 点占 28%，夜盘占 23%。手数加权中位在 13:32。"
        "12 个卖出日的板块个数并不齐。黑色一天 0 到 2 个，有色 0 到 3 个，农产品 0 到 3 个，化工 0 到 2 个，碳酸锂那一组 0 到 1 个。"
        "10 月 15 日是农产品 2 个、化工 2 个、有色 3 个、黑色 1 个。10 月 20 日只有锡。11 月 3 日只有碳酸锂。",
    )
    prof.para(
        doc,
        "板块内部用前一日就能算出的数来排。平值隐波减去固定参数 GARCH(1,1) 的预测，预测只用到前一交易日为止的收益。"
        "农产品 8 次打中 1 次，盲抽大约 16%。黑色 6 次打中 3 次，盲抽大约 33%。"
        "有色 15 次打中 12 次，盲抽大约 30%。10 月 19 日他卖锡，预测更高的是镍。10 月 21 日他卖镍，预测更高的是锡。"
        "碳酸锂和工业硅对得上的 9 天里，碳酸锂的差额都更高，他 9 次卖的都是碳酸锂。"
        "不先分板块，同一条预测在全板上打中 8/41，盲抽大约 11%。平值隐波减 20 日实现波动也是 8/41。"
        "卖出之后的 10 个交易日，实现波动才看得到。对得上的 33 个卖出品种日，前一日平值隐波高出这段实现波动的中位是 9.3 个点，没卖的是 3.9 个点。",
    )
    prof.para(
        doc,
        "有结算价的日子从 8 月 3 日到 11 月 3 日共 33 天，不是每个交易日，也不是同一批行权价，排不出过去 20 天的偏斜分位。"
        "这窗里虚值结算价和前一日平值都能对上的有 46 条。他卖的那些，虚值隐波减前一日平值的中位是 1.7 个点，没卖的中位是 6.4 个点。"
        "按这个差额从大到小取和他当天一样多个，打中 7/19，盲抽大约 46%。"
        "能估出权利金和卖方保证金的翼有 58 条，他卖了 23 条。保证金仍按权利金加上期货名义价值的大约 10%，再扣掉虚值额的一半。"
        "权利金除以保证金，他的中位是 1.1%，没卖的中位是 3.1%。按这个比例从高到低打中 9/23，盲抽大约 45%。"
        "从占保证金 0.5% 到 8% 的每一档门槛，留下来的没卖品种都多于他卖的。",
    )
    prof.para(
        doc,
        "开盘前能用的预测，和卖出之后才看到的实现波动，差一截。用到前一日为止的收益做 HAR，平值隐波减这个预测，他的中位高出 5.7 个点，没卖的高出 2.0 个点。"
        "每天取差额最大的、和他当天一样多个，打中 8/41，盲抽大约 11%。9.3 对 3.9 用的是卖出之后 10 个交易日的实现波动。",
    )
    prof.para(
        doc,
        "虚值减平值、又能对上这段已实现波动差额的，有 51 条，他占 19 条。偏斜低于 2 个点的，他占 53%，没卖的占 34%。"
        "低于 3 个点的，他占 58%，没卖的占 41%。按偏斜从平到陡取同样多个，打中 9/19，盲抽大约 42%。"
        "差额高于中位、偏斜又低于中位的那一角有 21 条，其中 10 条是他卖的。"
        "他自己的 19 条里有 8 条偏斜超过 3 个点，玉米、镍、铁矿、豆二都在里面。",
    )
    prof.para(
        doc,
        "成交价高出当天结算价，上午 11 点前的 54 手中位是 7.5 个点，下午 13 点及以后的 210 手中位是 1.5 个点。"
        "碳酸锂、镍、锡、铜，他卖的日子和没卖的日子，近月对次近月的价差中位大约差 0.1 个百分点。持仓量在两边都下降。",
    )
    prof.para(
        doc,
        "每一块下面有两笔。第一笔到 11 月 3 日还开着，重估用期权结算价，不是已经落袋的数字。"
        "第二笔已经在到期日了结。卖开之后走到 10 月 23 日或 10 月 26 日的，有 118 手："
        f"{CAT_BOTH} 53 手；{CAT_BOTH_BUY} 4 手；{CAT_RATIO} 28 手；{CAT_NAKED} 33 手。"
        "另外 5 手是当天买进的那一翼，也在同一批里平掉。成交价记成行权价，权利金为 0。",
    )
    _write_category_examples(doc, add_fig, add_tab, cases, logic)
    strike = (timing or {}).get("strike") or {}
    call = strike.get("call_otm") or {}
    put = strike.get("put_otm") or {}
    yuan = strike.get("prem_yuan") or {}
    prof.para(
        doc,
        f"能对上期货价格的卖开里，认购虚值中位 {call.get('p50', float('nan')):.0%}（四分位 {call.get('p25', float('nan')):.0%}–{call.get('p75', float('nan')):.0%}），"
        f"认沽虚值中位 {put.get('p50', float('nan')):.0%}（四分位 {put.get('p25', float('nan')):.0%}–{put.get('p75', float('nan')):.0%}）。"
        f"权利金金额的四分位是 {yuan.get('p25', float('nan')):.0f} / {yuan.get('p50', float('nan')):.0f} / {yuan.get('p75', float('nan')):.0f} 元，从几十元到几百元，没有一档固定的收费。"
        "图上的虚线是认购 13%、认沽 12%。右手边那截认购是更远的翼。",
    )
    add_fig(
        charts / "timing_otm.png",
        "卖开手数按虚值程度。深蓝是认购，金色是认沽。他卖的是距离，两边都堆在 10% 到 20% 虚值。",
    )
    prof.para(
        doc,
        f"期货这段只成交 {fut_lots:.0f} 手，卖出 {fut_sell:.0f} 手、买入 {fut_buy:.0f} 手，品种是 {both_names}。"
        "其余标的只有期权，没有期货腿。",
    )
    if both and fut_buy == 0 and fut_sell > 0:
        prof.para(
            doc,
            f"期货全部是卖开，这半个月没有一笔买回，品种只有 {both_names}。"
            f"{fut_sell:.0f} 手里有 29 手和当天的期权卖开落在同一天：10 月 29 日 LC 卖期货 10 手，同时卖购 6 手、卖沽 1 手；"
            "10 月 30 日 LH 卖期货 12 手，同时卖购 10 手、卖沽 5 手；11 月 2 日 LC 卖期货 7 手，同时卖沽 5 手。"
            "11 月 3 日 LH 再卖期货 6 手，当天没有新的期权开仓。"
            "前两天的期权开仓偏认购，11 月 2 日 LC 只加了认沽。期货空头平到期末都还在，所以 LC 和 LH 上是卖权再加一截没有平掉的期货空头。其他标的只有期权。",
        )
    elif both:
        prof.para(
            doc,
            "期货和期权出现在相同的品种上，按同一天的成交对照之后，期货是这套卖权上的方向腿，不是另一套独立的单边。",
        )
    prof.para(
        doc,
        f"到 {summary['end_date']}，期权相对开仓价的浮动盈亏 {summary['end_floating']:+,.0f} 元，已经平掉的 {summary['end_realized']:+,.0f} 元，"
        f"减去手续费后 {summary['end_econ']:+,.0f} 元。卖出时收进的权利金 {summary['premium_net']:+,.0f} 元已经含在这条盈亏里，不要再加一次。"
        f"日报累计当日盈亏 {summary['broker_pnl']:+,.0f} 元，含期货。期权持仓盈亏字段是 0，浮动是用结算价对开仓价重估的。"
        f"期末还空着 {summary['end_short']:.0f} 手期权。10 月 26 日上期所 2611 到期，117 手在 16:45 的批次里了结，权利金留下大约九成；盘中另外买平的只有三十来手。",
    )
    add_fig(
        charts / "floating.png",
        "期权经济盈亏。橙线是还留在仓里的浮动，青线是已平，海军蓝是两者相加减手续费。金色虚线是日报累计，含期货。",
    )

    prof.heading(doc, "三、期货和期权放在同一天", 1)
    prof.para(
        doc,
        "下表按标的把两条腿并在一起。期货净持仓是期末多头减空头。同一天，是指这个品种当天既卖了期权、又成交了期货。",
    )
    add_tab(
        ["标的", "卖开购", "卖开沽", "期权平仓", "期货卖", "期货买", "期末期货净", "同一天"],
        [[
            r["product"],
            f"{r['sell_c']:.0f}",
            f"{r['sell_p']:.0f}",
            f"{r['close']:.0f}",
            f"{r['fut_sell']:.0f}",
            f"{r['fut_buy']:.0f}",
            f"{r['fut_end']:.0f}",
            f"{r['same_days']}" if r["fut_days"] else "—",
        ] for r in rows],
        "每个标的的期权和期货。期末期货净为负是空头。",
    )
    if tape:
        prof.para(doc, "期货每一笔，旁边是当天这个品种卖开的认购和认沽手数。")
        add_tab(
            ["日期", "标的", "期货", "手数", "价格", "当天卖购", "当天卖沽"],
            [[t["dt"][5:], t["product"], t["bs"] + t["oc"], f"{t['lots']:.0f}",
              f"{t['price']:.1f}" if math.isfinite(t["price"]) else "—",
              f"{t['opt_c']:.0f}", f"{t['opt_p']:.0f}"] for t in tape],
            "期货成交，以及同一天同品种的期权卖开。",
        )
    opt_only_lots = sum(r["sell_c"] + r["sell_p"] for r in only_opt)
    both_opt_lots = sum(r["sell_c"] + r["sell_p"] for r in both)
    prof.para(
        doc,
        f"卖开手数里，{both_opt_lots:.0f} 手落在有期货的品种上，{opt_only_lots:.0f} 手落在没有期货的品种上。"
        "期货手数远小于期权手数，空头只加在 LC、LH 上，没有铺到其余卖权。",
    )

    prof.heading(doc, "四、哪天卖、卖哪一个", 1)
    logit = pick.get("logit") or {}
    rnd = pick.get("random") or {}
    prof.para(
        doc,
        "平仓能对上的，是交易所到期日。10 月 26 日是上期所 11 月期权的到期日，当天卖开 0 手，买平 117 手在 16:45 的批次了结，成交价记成行权价、权利金为 0，空头从大约 250 手掉下去。"
        "10 月 23 日是大商所 11 月期权的到期日，对得上的只有 1 手生猪认购，16:44 同样了结。到期日前几乎不平亏损单。"
        "到期后的第一个交易日，10 月 27 日，他卖 133 手、9 个品种，11 月合约是 0，12 月 70 手、1 月 63 手。此后 11 月合约不再卖。他卖的是后面两个月，不是只卖最近的一个月。",
    )
    add_fig(
        charts / "timing_book.png",
        "空头手数和当天卖开。竖线是 10 月 26 日的到期批次。空头掉下去之后，次日的金色柱子是换到后面两个月再卖。",
    )
    add_tab(
        ["日期", "卖开手数", "品种数", "11月", "12月", "1月", "买平"],
        [[
            r["dt"], f"{r['lots']:.0f}", f"{r['names']:.0f}",
            f"{r['m11']:.0f}", f"{r['m12']:.0f}", f"{r['m01']:.0f}", f"{r['close']:.0f}",
        ] for r in months],
        "每天卖到哪个月。10 月 26 日没有卖开，买平 117 手是到期。10 月 27 日起 11 月合约不再卖。",
    )
    oct_lots = sum(r["lots"] for r in dte["rows"] if r["expiry"].month == 10 and r["expiry"].year == 2026)
    prof.para(
        doc,
        f"开仓日到该合约的交易所到期日，按自然日计。{dte['lots']:.0f} 手期权开仓都算上，卖开 {dte['sell']:.0f} 手、买开 {dte['buy']:.0f} 手。"
        f"手数加权中位 {dte['p50']:.0f} 天，四分位 {dte['p25']:.0f} 天和 {dte['p75']:.0f} 天，最短 {dte['min']} 天，最长 {dte['max']} 天。"
        f"最短是 10 月 22 日的镍 11 月，到期日 10 月 26 日，隔了 4 天。"
        f"最长是 10 月 19 日的螺纹 1 月，到期日 12 月 25 日，隔了 67 天。"
        f"{dte['near']:.0f} 手在 14 天以内，其中 {oct_lots:.0f} 手的到期日是 10 月 23 日或 10 月 26 日。"
        f"{dte['far']:.0f} 手在 46 天及以上。",
    )
    add_tab(
        ["到期日", "开仓手数", "最短天数", "中位天数", "最长天数"],
        [[
            r["expiry"].strftime("%m-%d"),
            f"{r['lots']:.0f}",
            f"{r['min']}",
            f"{r['p50']:.0f}",
            f"{r['max']}",
        ] for r in dte["rows"]],
        "每个到期日上，开仓日离它多少个自然日。手数是卖开加买开。",
    )
    add_tab(
        ["开仓到到期", "手数", "占开仓"],
        [[
            b["label"],
            f"{b['lots']:.0f}",
            f"{b['lots'] / dte['lots']:.0%}" if dte["lots"] else "—",
        ] for b in dte["buckets"]],
        f"{dte['lots']:.0f} 手开仓按自然日分档。中位 {dte['p50']:.0f} 天落在两堆中间：一堆是两周内到期，一堆是一个半月以上。",
    )
    prof.para(
        doc,
        "卖开散在日盘和夜盘，没有固定的一分钟。同一品种的认购和认沽，中位间隔大约半小时。16 点那根买平柱是 10 月 26 日的到期批次，不是一个固定的平仓钟点。",
    )
    add_fig(
        charts / "timing_clock.png",
        "卖开和买平按成交小时。卖开从 9 点铺到夜盘，买平集中在到期日的 16 点。",
    )
    import _rx383_intraday as intraday
    intraday_close = intraday.write_intraday(doc, opt, add_fig, add_tab)
    show = [r for r in pick.get("features") or [] if r.get("cover", 0) >= 0.5][:8]
    by_name = {r["feature"]: r for r in show}

    def feat_pct(name: str, key: str) -> str:
        v = (by_name.get(name) or {}).get(key, float("nan"))
        return f"{v:.0%}" if isinstance(v, (int, float)) and math.isfinite(v) else "—"

    atm = by_name.get("atm_iv_lag") or {}
    vol = by_name.get("fut_vol_lag") or {}
    prof.para(
        doc,
        f"开在哪个品种，每天大约 {pick.get('universe_med', 0):.0f} 个有行情的名字里他卖 {pick.get('k_med', 0):.1f} 个。"
        f"用前一天的期货成交量、曲线分位、隐波减实现波动和近几日涨跌做回归，留出一天再取同样多个名字，打中 {logit.get('precision', float('nan')):.0%}（{logit.get('hits', 0)}/{logit.get('k', 0)}），随机是 {rnd.get('mean', float('nan')):.0%}。"
        f"下表是单因子：每天取最高或最低的同样多个名字。取平值隐波最高只打中 {feat_pct('atm_iv_lag', 'precision_high')}，所以他不是在隐波高的品种上卖。"
        f"取期货年化升水最高打中 {feat_pct('basis_ann_lag', 'precision_high')}，取曲线分位最低打中 {feat_pct('basis_pct_lag', 'precision_low')}，取成交量最低打中 {feat_pct('fut_vol_lag', 'precision_low')}。"
        f"他卖的平值隐波中位数 {fmt_feat(atm.get('yes'), 'atm_iv_lag')}，没卖的是 {fmt_feat(atm.get('no'), 'atm_iv_lag')}。"
        f"成交量中位数 {vol.get('yes', float('nan')):,.0f} 手，没卖的是 {vol.get('no', float('nan')):,.0f} 手。",
    )
    add_tab(
        ["前一日特征", "他卖的中位", "没卖的中位", "他在当天的分位", "取高打中", "取低打中"],
        [[
            FEAT_CN.get(r["feature"], r["feature"]),
            fmt_feat(r["yes"], r["feature"]),
            fmt_feat(r["no"], r["feature"]),
            f"{r['his_pct']:.0%}",
            f"{r['precision_high']:.0%}",
            f"{r['precision_low']:.0%}",
        ] for r in show],
        f"卖开当天，他的品种相对全市场的位置。随机打中大约 {rnd.get('mean', float('nan')):.0%}。",
    )
    add_fig(
        charts / "pick_scatter.png",
        "每个点是一个品种的一个交易日。深蓝是他卖开的。它们略偏「隐波高于 20 日实现波动、期货曲线分位偏低」的一侧，和没卖的名字重叠很大。",
    )
    add_fig(
        charts / "pick_overlap.png",
        f"留出一天的回归。柱子是打中的品种个数，点是他当天实际卖的品种数。合计打中 {logit.get('hits', 0)}/{logit.get('k', 0)}。",
    )

    prof.heading(doc, "五、每个标的的开和平", 1)
    prof.para(
        doc,
        "K 线是他卖得最多的那个月期货；郑商所 10 月没有分月行情的，改用连续主力。倒三角是卖开，三角是买平，方块是期货。虚线是卖开手数加权的行权价，只有落在这根价格附近才画出来。"
        "期货净持仓画在右轴，只出现在有期货的品种上。"
        "每根 K 线下面三条线用同一段日期。平值隐波先用公布数。公布数断掉的日子，碳酸锂用广期所合约系列隐波补到 10 月 28 日；生猪、焦煤、鸡蛋用当天结算价里离期货最近、距离不超过 8% 的那一档反解。两处都没有的日子仍然断开。只有单独一天有数的，画成点，不把中间的空档连起来。"
        "20 日实现波动是年化标准差。该月份上市不足 20 个交易日的开头，用连续合约更早的日收益补上。紫色是前一条减去后一条，零线以上是平值隐波更高。",
    )
    n_before = seq["fig"]
    for r in rows:
        if r["chart"]:
            fut_bit = ""
            if r["fut_sell"] or r["fut_buy"]:
                fut_bit = f"期货卖 {r['fut_sell']:.0f} 手、买 {r['fut_buy']:.0f} 手，期末净 {r['fut_end']:.0f}。和期权同一天的有 {r['same_days']} 天。"
            add_fig(
                r["chart"],
                f"{prof.pname(r['product'])}  {r['label']}。"
                f"卖开认购 {r['sell_c']:.0f} 手、认沽 {r['sell_p']:.0f} 手，期权平仓 {r['close']:.0f} 手。{fut_bit}",
            )
        else:
            prof.para(doc, f"{prof.pname(r['product'])} 这段没有对上期货 K 线。卖开认购 {r['sell_c']:.0f} 手、认沽 {r['sell_p']:.0f} 手。")
    if seq["fig"] == n_before:
        prof.para(doc, "这段没有对上期货 K 线。")

    prof.heading(doc, "六、样本就这么长", 1)
    prof.para(
        doc,
        "从 10 月 15 日到 11 月 3 日，上期所到期日过了 10 月 26 日，大商所 11 月期权的到期日过了 10 月 23 日。走到这两个日子的空头，在当天收盘批次了结。"
        "螺纹 1 月的到期日是 12 月 25 日，豆粕 1 月是 12 月 16 日，玉米 1 月和鸡蛋 12 月都是 11 月 17 日，这些合约到样本结束都还开着。第一节那笔螺纹就是其中一张。"
        "卖虚值。到期日当天，该月份的空头在收盘批次了结；到期日之前大部分留着，盘中买平的是少数。LC 和 LH 上另外加着没有买回的期货空头。"
        "选品种的模型打中三成，高于随机，还不能按名单逐个下单。"
        + intraday_close,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        doc.save(path)
    except PermissionError:
        path = path.with_name(path.stem + "_含图表.docx")
        doc.save(path)
        print("LOCKED, wrote", path)
    print("SAVED", path)


if __name__ == "__main__":
    main()
