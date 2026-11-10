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
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt
from matplotlib.patches import Rectangle

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _generate_rx319_profile_word_report as prof  # noqa: E402
import _rx383_option_strategy_report as base  # noqa: E402
from cn_market_holidays import is_cn_market_closed  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402

# Sample end. Metal-rule thresholds stay the ones read off 15 Oct–3 Nov.
REPORT_END = pd.Timestamp("2026-11-09")
REPORT_END_CN = "11 月 9 日"

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
            WHERE trade_date BETWEEN DATE '2026-09-15' AND DATE '2026-11-09'
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
            WHERE trade_date BETWEEN DATE '2026-09-15' AND DATE '2026-11-09'
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
            WHERE trade_date BETWEEN DATE '2026-06-01' AND DATE '2026-11-09'
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
            WHERE trade_date BETWEEN DATE '2026-06-01' AND DATE '2026-11-09'
            """,
        )
        civ = prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, LOWER(underlying_key) AS product, iv::float8 AS iv
            FROM raw_commodity_option_iv_daily
            WHERE trade_date BETWEEN DATE '2026-06-01' AND DATE '2026-11-09'
            """,
        )
        opt_px = prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, contract, COALESCE(clear, close)::float8 AS px
            FROM raw_options_contracts_daily
            WHERE trade_date BETWEEN DATE '2026-09-15' AND DATE '2026-11-09'
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
    end = REPORT_END
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


def four_shape_charts() -> list[Path]:
    """Payoff shape of each sell structure, on the same futures = 100 scale as the strangle chart.

    The bought wing uses the open examples already in the note: meal is 15 sold against 2 bought,
    corn is 20 sold against 2 bought. The nearer strike is drawn at 105 so the bend is visible.
    On the real books the buy is often closer to the short strike, so the bend is smaller.
    """
    spot = 100.0
    k_call, k_put, k_near = 113.0, 88.0, 105.0
    sig = 0.184
    t_open, t_left = 60 / 365, 30 / 365
    xs = np.linspace(70, 140, 351)

    def px(s, k, t, cp):
        return _black(float(s), k, t, sig, cp)

    c_call = px(spot, k_call, t_open, "C")
    c_put = px(spot, k_put, t_open, "P")
    c_near = px(spot, k_near, t_open, "C")

    def y_of(fn):
        return np.array([fn(s, 0.0) for s in xs]), np.array([fn(s, t_left) for s in xs])

    def strangle(s, t):
        return c_call + c_put - px(s, k_call, t, "C") - px(s, k_put, t, "P")

    def wing(s, t):
        buy = 2 / 15
        return strangle(s, t) - buy * c_near + buy * px(s, k_near, t, "C")

    def ratio(s, t):
        buy = 2 / 20
        return c_call - buy * c_near - px(s, k_call, t, "C") + buy * px(s, k_near, t, "C")

    def naked(s, t):
        return c_call - px(s, k_call, t, "C")

    specs = [
        ("短宽跨式", strangle, [(k_put, prof.C_GOLD), (k_call, prof.C_NAVY)]),
        ("短宽跨式加近买", wing, [(k_put, prof.C_GOLD), (k_near, prof.C_TEAL), (k_call, prof.C_NAVY)]),
        ("比率价差", ratio, [(k_near, prof.C_TEAL), (k_call, prof.C_NAVY)]),
        ("单边卖权", naked, [(k_call, prof.C_NAVY)]),
    ]
    series = [(name, *y_of(fn), lines) for name, fn, lines in specs]
    lo = min(float(np.min(ye)) for _n, ye, _yl, _ls in series)
    hi = max(float(np.max(ye)) for _n, ye, _yl, _ls in series)
    pad = (hi - lo) * 0.06
    prof.configure_matplotlib()
    out = OUT / "charts"
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, y_exp, y_live, lines in series:
        fig, ax = plt.subplots(figsize=(5.6, 3.9))
        ax.plot(xs, y_exp, color=prof.C_NAVY, lw=1.8, label="到期")
        ax.plot(xs, y_live, color=prof.C_GOLD, lw=1.4, label="还剩 30 天")
        ax.axhline(0, color="#718096", lw=0.6)
        _shade_pnl(ax, xs, y_exp)
        for k, color in lines:
            ax.axvline(k, color=color, lw=0.8, ls="--")
        ax.set_xlim(70, 140)
        ax.set_ylim(lo - pad, hi + pad)
        ax.set_title(name, fontsize=13, color=prof.C_NAVY, pad=6)
        ax.set_xlabel("期货价格", fontsize=9)
        ax.set_ylabel("盈亏（期货价 = 100）", fontsize=9)
        ax.tick_params(labelsize=8)
        ax.legend(frameon=False, ncol=2, loc="lower right", fontsize=8)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        fig.tight_layout()
        path = out / f"shape_{['strangle', 'wing', 'ratio', 'naked'][len(paths)]}.png"
        fig.savefig(path, dpi=140)
        plt.close(fig)
        paths.append(path)
    return paths


def _picture_grid(doc, paths: list[Path]):
    """Two charts per row, no borders."""
    table = doc.add_table(rows=2, cols=2)
    tbl = table._tbl
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "nil")
        el.set(qn("w:sz"), "0")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "auto")
        borders.append(el)
    tbl.tblPr.append(borders)
    width = OxmlElement("w:tblW")
    width.set(qn("w:w"), "5000")
    width.set(qn("w:type"), "pct")
    tbl.tblPr.append(width)
    for tr in tbl.tr_lst:
        tr_pr = tr.get_or_add_trPr()
        tr_pr.append(OxmlElement("w:cantSplit"))
    for i, path in enumerate(paths):
        cell = table.cell(i // 2, i % 2)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        p.add_run().add_picture(str(path), width=Inches(3.35))
    return table


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
              AND trade_date BETWEEN DATE '2026-10-01' AND DATE '2026-11-09'
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
    last = path[path["dt"] <= REPORT_END]
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
    show = path[path["dt"] <= REPORT_END]
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


def four_type_pie(buckets: dict) -> Path:
    """Share of sell-open lots in the four structures."""
    prof.configure_matplotlib()
    names = ["短宽跨式", "短宽跨式加近买", "比率价差", "单边卖权"]
    sizes = [
        float(buckets["both_only"]),
        float(buckets["both_wing"]),
        float(buckets["one_wing"]),
        float(buckets["one_naked"]),
    ]
    colors = [prof.C_NAVY, prof.C_GOLD, prof.C_TEAL, prof.C_PURPLE]
    total = sum(sizes)
    fig, ax = plt.subplots(figsize=(8.2, 4.6))
    wedges, _texts, autotexts = ax.pie(
        sizes,
        colors=colors,
        startangle=90,
        counterclock=False,
        autopct=lambda p: f"{p:.1f}%",
        pctdistance=0.62,
        wedgeprops={"edgecolor": "white", "linewidth": 1.2},
    )
    for wedge, text, size in zip(wedges, autotexts, sizes):
        text.set_fontsize(10)
        text.set_color("white" if size != sizes[1] else prof.C_NAVY)
    ax.legend(
        wedges,
        [f"{name}  {size:.0f} 手" for name, size in zip(names, sizes)],
        frameon=False,
        loc="center left",
        bbox_to_anchor=(1.0, 0.5),
        fontsize=9,
    )
    ax.set_title(f"四块卖开占全部 {total:.0f} 手")
    fig.tight_layout()
    path = OUT / "charts" / "four_type_pie.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=140)
    plt.close(fig)
    return path


_SECTOR_COLOR = {
    "有色": "#1A365D",
    "新能源": "#C9A227",
    "生鲜": "#2B6CB0",
    "农产": "#805AD5",
    "黑色": "#4A5568",
    "能源化工": "#2C7A7B",
    "股指": "#718096",
}


def _book_sector(code: str) -> str:
    if str(code).upper() == "HO":
        return "股指"
    return prof.sector_of(str(code).upper())


def sector_exposure() -> dict:
    """Option margin by sector, one point per position day through 3 Nov 2026."""
    end = REPORT_END
    conn = get_conn()
    try:
        opt = base.load_account(conn)["opt_pos"]
    finally:
        conn.close()
    opt = opt[opt["dt"] <= end].copy()
    opt["sector"] = opt["product"].map(_book_sector)
    opt["margin"] = pd.to_numeric(opt["margin"], errors="coerce").fillna(0.0)
    opt["short"] = pd.to_numeric(opt["short_lots"], errors="coerce").fillna(0.0)
    daily = opt.groupby(["dt", "sector"], as_index=False).agg(margin=("margin", "sum"), short=("short", "sum"))
    wide = daily.pivot(index="dt", columns="sector", values="margin").fillna(0.0).sort_index()
    lots = daily.pivot(index="dt", columns="sector", values="short").fillna(0.0).sort_index()
    order = list(wide.iloc[-1].sort_values(ascending=False).index)
    prof.configure_matplotlib()
    fig, ax = plt.subplots(figsize=(8.2, 4.6))
    for name in order:
        ax.plot(
            wide.index,
            wide[name] / 10000.0,
            color=_SECTOR_COLOR.get(name, "#718096"),
            lw=2.0 if name in order[:3] else 1.3,
            label=name,
        )
    peak = float(wide.max().max()) / 10000.0
    ax.set_ylim(0, peak * 1.12)
    drop = pd.Timestamp("2026-10-26")
    if drop in wide.index:
        ax.axvline(drop, color="#A0AEC0", lw=0.8, ls="--")
        ax.text(drop, peak * 1.02, " 11月到期", color="#718096", fontsize=8, va="bottom")
    ax.set_ylabel("万元")
    ax.set_title("各板块期权保证金")
    ax.legend(frameon=False, ncol=4, loc="upper center", bbox_to_anchor=(0.5, -0.18), fontsize=9)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d"))
    fig.autofmt_xdate(rotation=0, ha="center")
    fig.tight_layout()
    path = OUT / "charts" / "sector_margin.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=140, bbox_inches="tight")
    plt.close(fig)
    first, last = wide.iloc[0], wide.iloc[-1]
    return {
        "path": path,
        "first_day": wide.index[0],
        "last_day": wide.index[-1],
        "first": first,
        "last": last,
        "lots": lots.iloc[-1],
        "order": order,
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
        hit = mkt[mkt["dt"] <= REPORT_END]
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
        ("both_open", "RB", "2701", "2026-10-19", "2026-11-09", False, "螺纹 RB2701  短宽跨式", "cat_open_both.png",
         [("C", 3500, True, 10, 5.0), ("P", 2750, True, 10, 3.5)]),
        ("both_wing_open", "M", "2701", "2026-10-21", "2026-11-09", False, "豆粕 M2701  短宽跨式加近买", "cat_open_wing.png",
         [("C", 3800, True, 15, 4.5), ("P", 2600, True, 10, 1.5), ("C", 3700, False, 2, 6.5)]),
        ("one_wing_open", "C", "2701", "2026-10-22", "2026-11-09", False, "玉米 C2701  比率价差", "cat_open_one.png",
         [("C", 2440, True, 20, 3.5), ("C", 2400, False, 2, 5.0)]),
        ("naked_open", "JD", "2612", "2026-11-02", "2026-11-09", False, "鸡蛋 JD2612  单边卖权", "cat_open_naked.png",
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
            f"这一块是四块里最大的，{both_b['sell_lots']:.0f} 手都是{CAT_BOTH}。",
        ],
        f"上图是到期日的盈亏曲线，红带是赚、绿带是亏。海军蓝点是卖出当天的期货价。圆点和菱形按盈亏着色，红是赚、绿是亏：圆点是 {REPORT_END_CN}若当天到期，菱形是同一天的重估。这笔的到期日还没到。下图左边是期货收盘，右边是重估盈亏。",
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
        f"上图红带是赚、绿带是亏。到期盈亏在两个卖出行权价之间是一条平线，靠近卖出认购时因为买进的两手先变实值而拱起，过了卖出行权价就掉下去。红色菱形是 {REPORT_END_CN}的重估。下图是期货路径和重估。这笔到 {REPORT_END_CN}还没有平。",
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
        f"上图红带是赚、绿带是亏。左边一直到买进行权价都是收进的权利金。价格再往上，先因为买进的两手拱起，过了卖出行权价就转为亏损。红色菱形是 {REPORT_END_CN}的重估。下图是期货路径和重估。这笔到 {REPORT_END_CN}还没有平。",
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
        f"上图红带是赚、绿带是亏。行权价左边是一条平线，就是收进的权利金。涨过盈亏平衡点以后直线向下。红色菱形是 {REPORT_END_CN}的重估。下图是期货路径和重估。这笔到 {REPORT_END_CN}还没有平。",
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


def _expiry_compare_charts() -> dict[str, Path]:
    """Three charts: finish-at-zero, win and loss size, and the expected result."""
    prof.configure_matplotlib()
    labels = ["实值", "0–3%", "3–7%", "7–12%", "12–17%", "17–25%", "25–40%", "40–80%"]
    x = np.arange(len(labels))
    w = 0.36
    call_p = [0.142, 0.668, 0.835, 0.917, 0.954, 0.977, 0.991, 0.994]
    put_p = [0.120, 0.590, 0.776, 0.907, 0.963, 0.991, 0.998, 1.000]
    his_p_c = [None, None, None, 1.0, 1.0, 1.0, None, None]
    his_p_p = [None, None, None, 1.0, 1.0, 1.0, None, None]
    call_win = [10.15, 1.23, 0.77, 0.53, 0.48, 0.51, 0.26, 0.14]
    put_win = [6.55, 1.36, 0.63, 0.25, 0.27, 0.21, 0.15, 0.05]
    call_loss = [-2.24, -5.47, -7.45, -9.67, -11.45, -14.44, -18.89, -22.60]
    put_loss = [-6.13, -3.98, -4.50, -5.06, -4.40, -4.63, -6.82, None]
    his_prem_c = [None, None, 0.12, 0.37, 0.53, 0.51, 1.07, 0.48]
    his_prem_p = [None, None, 1.70, 0.28, 0.27, 0.69, None, None]
    call_e = [-0.48, -0.99, -0.59, -0.32, -0.07, 0.17, 0.09, 0.00]
    put_e = [-4.61, -0.83, -0.52, -0.24, 0.10, 0.17, 0.14, 0.05]
    his_e_c = [None, None, None, 0.06, 0.02, 0.20, None, None]
    his_e_p = [None, None, None, 0.03, 0.03, 0.24, None, None]
    out = OUT / "charts"
    out.mkdir(parents=True, exist_ok=True)

    def _style(ax, title, ylabel):
        ax.axhline(0, color=prof.C_GRAY, lw=0.6)
        ax.set_xticks(x)
        ax.set_xticklabels(labels, fontsize=8)
        ax.set_xlabel("行权价离卖出当天期货的距离")
        ax.set_ylabel(ylabel)
        ax.set_title(title)
        ax.legend(frameon=False, ncol=3, fontsize=8, loc="best")
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)

    def _his(ax, values, shift, color):
        xs, ys = [], []
        for i, v in enumerate(values):
            if v is None:
                continue
            xs.append(x[i] + shift)
            ys.append(v)
        if xs:
            ax.scatter(xs, ys, s=42, marker="D", facecolor="white", edgecolor=color, linewidths=1.3, zorder=5)

    fig, ax = plt.subplots(figsize=(8.2, 4.4))
    ax.bar(x - w / 2, call_p, w, color=prof.C_NAVY, label="认购")
    ax.bar(x + w / 2, put_p, w, color=prof.C_GOLD, label="认沽")
    _his(ax, his_p_c, -w / 2, prof.C_ORANGE)
    _his(ax, his_p_p, w / 2, prof.C_ORANGE)
    ax.scatter([], [], s=42, marker="D", facecolor="white", edgecolor=prof.C_ORANGE, label="RX383 已到期")
    ax.set_ylim(0, 1.08)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _p: f"{v:.0%}"))
    _style(ax, "卖出后持有到到期，归零的概率", "到期归零")
    fig.tight_layout()
    prob = out / "expiry_prob.png"
    fig.savefig(prob, dpi=140)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8.2, 4.6))
    for i in range(len(labels)):
        ax.plot([x[i] - w / 2, x[i] - w / 2], [call_loss[i], call_win[i]], color=prof.C_NAVY, lw=1.5, label="认购" if i == 0 else None)
        ax.scatter([x[i] - w / 2, x[i] - w / 2], [call_win[i], call_loss[i]], s=16, color=prof.C_NAVY, zorder=3)
        if put_loss[i] is not None:
            ax.plot([x[i] + w / 2, x[i] + w / 2], [put_loss[i], put_win[i]], color=prof.C_GOLD, lw=1.5, label="认沽" if i == 0 else None)
            ax.scatter([x[i] + w / 2, x[i] + w / 2], [put_win[i], put_loss[i]], s=16, color=prof.C_GOLD, zorder=3)
        else:
            ax.scatter([x[i] + w / 2], [put_win[i]], s=16, color=prof.C_GOLD, zorder=3, label="认沽" if i == 0 else None)
    _his(ax, his_prem_c, -w / 2 + 0.08, prof.C_ORANGE)
    _his(ax, his_prem_p, w / 2 + 0.08, prof.C_ORANGE)
    ax.scatter([], [], s=42, marker="D", facecolor="white", edgecolor=prof.C_ORANGE, label="RX383 卖出权利金")
    _style(ax, "一笔交易赢的幅度和亏的幅度", "期货价格的百分比")
    fig.tight_layout()
    amount = out / "expiry_amount.png"
    fig.savefig(amount, dpi=140)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8.2, 4.4))
    ax.bar(x - w / 2, call_e, w, color=prof.C_NAVY, label="认购")
    ax.bar(x + w / 2, put_e, w, color=prof.C_GOLD, label="认沽")
    _his(ax, his_e_c, -w / 2, prof.C_ORANGE)
    _his(ax, his_e_p, w / 2, prof.C_ORANGE)
    ax.scatter([], [], s=42, marker="D", facecolor="white", edgecolor=prof.C_ORANGE, label="RX383 已到期")
    _style(ax, "概率加权之后的期望", "期货价格的百分比")
    fig.tight_layout()
    expect = out / "expiry_expect.png"
    fig.savefig(expect, dpi=140)
    plt.close(fig)
    return {"prob": prob, "amount": amount, "expect": expect}


def write_expiry_compare(doc, add_tab, add_fig) -> None:
    """Hold-to-expiry on the full strike grid, then the same measurement on his short strangles."""
    lc = option_expiry("LC", "2612")
    lc_day = _cn_full(lc) if lc else "11 月上旬"
    pics = _expiry_compare_charts()
    prof.heading(doc, "七、持有到到期，和他卖出的位置", 1)
    prof.para(
        doc,
        "这一节把「卖出后拿到到期」放到全市场的行权价上，再放到他的短宽跨式上。期货从 2025 年 1 月 1 日起。"
        "库里至少有两个行权价、因而能读出间距的品种，按这个间距在期货价格下方 30% 到上方 40% 铺开。"
        "每个合约在到期前 5 到 80 个自然日里，每个有期货行情的交易日都算作卖出一次，持有到该期权到期。"
        "这样的卖出一共 1,166,228 笔，37 个品种。这不是全部期货品种：价格文件里有 85 个期货，能铺出网格的是这 37 个。",
    )
    prof.para(
        doc,
        "一笔的结果是：归零概率 × 权利金 + 被行权概率 ×（权利金 − 穿过行权价的距离）。"
        "归零指期货结算落在行权价的虚值一侧。穿过的距离和权利金都写成卖出当天期货价格的百分比。"
        "赢的时候留下权利金。输的时候权利金同样留下，再减去结算穿过行权价的幅度。"
        "网格上很多行权价没有成交，没有自己的收盘价。图和表里的权利金是同一距离档里真正成交过的收盘价平均，归零概率和穿过的距离来自那 1,166,228 笔到期结算。"
        "橙边菱形是 RX383。归零和期望两张图只画已经到期的手；中间那张图的菱形是他卖出时收进的权利金，还没到期的也算在内。",
    )
    add_fig(
        pics["prob"],
        "柱子是全市场每个交易日卖出、持有到到期之后归零的概率。菱形是他已经到期的短宽跨式，这些手全部归零。",
    )
    add_fig(
        pics["amount"],
        "零线上面是赢的一笔留下的权利金，零线下面是被行权时权利金减去穿过行权价的距离。橙边菱形是他卖出的权利金，含还没到期的手。",
    )
    add_fig(
        pics["expect"],
        "柱子是归零概率乘权利金、再加上被行权概率乘亏损之后的期望。菱形只画他已经到期的手，因为没有被行权，菱形的高度就是他留下的权利金。",
    )
    prof.para(
        doc,
        "实值档的期望是负的。认购要到离期货 17% 以外，认沽要到 12% 以外，期望才转到正的一边，幅度是零点几个百分点。"
        "7% 到 12% 这一档，认购大约 8.3% 会被行权，被行权时穿过约 10.2 个百分点；认沽大约 9.3% 被行权，穿过约 5.3 个百分点。"
        "所以这一档权利金虽然收得回来，期望仍是负的。",
    )
    add_tab(
        ["离期货", "认购归零", "认购期望", "认沽归零", "认沽期望"],
        [
            ["实值", "14.2%", "-0.48%", "12.0%", "-4.61%"],
            ["0–3%", "66.8%", "-0.99%", "59.0%", "-0.83%"],
            ["3–7%", "83.5%", "-0.59%", "77.6%", "-0.52%"],
            ["7–12%", "91.7%", "-0.32%", "90.7%", "-0.24%"],
            ["12–17%", "95.4%", "-0.07%", "96.3%", "+0.10%"],
            ["17–25%", "97.7%", "+0.17%", "99.1%", "+0.17%"],
            ["25–40%", "99.1%", "+0.09%", "99.8%", "+0.14%"],
            ["40–80%", "99.4%", "+0.00%", "100%", "+0.05%"],
        ],
        "全市场卖出后持有到到期。期望是期货价格的百分比。正数是平均赚，负数是平均亏。",
    )
    prof.para(
        doc,
        "他的短宽跨式用同一把尺子。距离是卖开时行权价离当天期货的百分比，权利金是成交价除以当天期货。"
        "同一个品种、同一个月份既卖过认购也卖过认沽，才算进短宽跨式。"
        "下面到期归零的是已经走到到期日的那些手。11 月 5 日到 9 日新卖的还没到期，不进这张到期表。",
    )
    prof.para(
        doc,
        "他不卖实值，也不卖离期货 3% 以内。认购从大约 6% 外放到大约 47% 外，认沽从大约 7% 外放到大约 19% 外。"
        "市场期望最差的实值档和 0–3% 档，他没有卖开。",
    )
    prof.para(
        doc,
        "到 2026 年 11 月 9 日的行情为止，已经到期又能对上结算的仍是 109 手：10 月 26 日的铜、镍、锡 11 月期权，以及 "
        f"{lc_day}到期的碳酸锂 12 月。碳酸锂在他 10 月 19 日到 23 日的卖出日没有期货打印，最近的打印是 10 月 26 日，距离用这一天的期货；到期是否归零用到期结算。"
        "这 109 手全部到期归零。认购 58 手，留下的权利金是期货的 +0.10%。认沽 51 手，是 +0.06%。"
        "没有一手被行权，所以他的期望就等于这笔权利金。"
        "四组、两个到期日，不能把 100% 读成和市场同档 90% 到 98% 不同的概率。"
        "7% 到 12% 档他到期的权利金只有 0.06% 和 0.03%，低于同档有成交合约的 0.53% 和 0.25%，因为这几笔是到期前一两个星期才卖的。"
        "12% 到 17% 的认购到期只有 2 手。",
    )
    add_tab(
        ["离期货", "市场认购期望", "他已到期的认购", "市场认沽期望", "他已到期的认沽"],
        [
            ["3–7%", "-0.59%", "未到期", "-0.52%", "未到期"],
            ["7–12%", "-0.32%", "+0.06% · 38手", "-0.24%", "+0.03% · 27手"],
            ["12–17%", "-0.07%", "+0.02% · 2手", "+0.10%", "+0.03% · 17手"],
            ["17–25%", "+0.17%", "+0.20% · 18手", "+0.17%", "+0.24% · 7手"],
            ["25–40%", "+0.09%", "未到期", "+0.14%", "—"],
            ["40–80%", "+0.00%", "未到期", "+0.05%", "—"],
        ],
        "他已到期的短宽跨式，和全市场同一档的期望。他的数字等于权利金，因为这些手全部归零。",
    )
    prof.para(
        doc,
        "462 手里有 353 手到 11 月 9 日还没到期。11 月 7 日到 9 日没有新的期权到期，所以上一截 109 手没有加。不进上一张表的期望。下面是他卖出时实际收进的权利金，未到期的也算在内，对照的是市场同档有成交合约的平均权利金。"
        "还开着的里面，高于市场同档的是 25% 到 40% 外的认购，他卖在 1.07%，市场同档 0.26%；以及 3% 到 7% 外的认沽，他卖在 1.70%，市场同档 0.63%。这两处都还没走到到期。",
    )
    add_tab(
        ["离期货", "市场认购权利金", "他卖出的认购", "市场认沽权利金", "他卖出的认沽"],
        [
            ["3–7%", "0.77%", "0.12% · 30手", "0.63%", "1.70% · 9手"],
            ["7–12%", "0.53%", "0.37% · 62手", "0.25%", "0.28% · 85手"],
            ["12–17%", "0.48%", "0.53% · 76手", "0.27%", "0.27% · 32手"],
            ["17–25%", "0.51%", "0.51% · 43手", "0.21%", "0.69% · 63手"],
            ["25–40%", "0.26%", "1.07% · 25手", "0.15%", "—"],
            ["40–80%", "0.14%", "0.48% · 37手", "0.05%", "—"],
        ],
        "权利金是期货价格的百分比。他的一列按手数加权，含尚未到期的卖开。",
    )


def _nd1(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _bs_greeks(fut: float, strike: float, sigma: float, tenor: float, cp: str):
    """Black-76 price, delta in futures lots, vega per vol point, theta per day."""
    vol = sigma * math.sqrt(tenor)
    if vol <= 0 or fut <= 0 or strike <= 0:
        return None
    d1 = (math.log(fut / strike) + 0.5 * sigma * sigma * tenor) / vol
    d2 = d1 - vol
    dens = _nd1(d1)
    if cp == "C":
        price = fut * _ncdf(d1) - strike * _ncdf(d2)
        delta = _ncdf(d1)
    else:
        price = strike * _ncdf(-d2) - fut * _ncdf(-d1)
        delta = _ncdf(d1) - 1.0
    vega = fut * dens * math.sqrt(tenor) / 100.0
    theta = -fut * dens * sigma / (2.0 * math.sqrt(tenor)) / 365.0
    return price, delta, vega, theta


def _cn_name(code: str) -> str:
    name = prof.pname(code)
    parts = str(name).split()
    return parts[-1] if len(parts) > 1 else str(name)


def _wan(x: float) -> str:
    sign = "+" if x > 0 else ""
    return f"{sign}{x / 10000:.1f}万"


def _clock_bits(timing) -> str:
    """Lot-weighted clock from timing.json. The sentence starts with the outline anchor."""
    op = ((timing or {}).get("clock") or {}).get("open") or {}
    by = op.get("by_hour") or {}
    lots = float(op.get("lots") or 0.0)
    if lots <= 0:
        return "卖开手数的钟点，这一窗没有可计的成交时刻。"
    def share(hours) -> float:
        return sum(float(by.get(str(h), 0.0)) for h in hours) / lots
    med = int(round(float(op.get("p50") or 0.0)))
    return (
        f"卖开手数的钟点，9 点这一小时占 {share([9]):.0%}，"
        f"下午 13 点到 15 点占 {share([13, 14]):.0%}，"
        f"夜盘占 {share([21, 22, 23, 0, 1, 2]):.0%}。"
        f"手数加权中位在 {med // 60:02d}:{med % 60:02d}。"
    )


HEADLINE: dict = {}


def _window_stats() -> dict:
    path = OUT / "window_stats.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _hit_phrase(block: dict | None) -> str:
    if not block or not block.get("trials"):
        return "见假设检验"
    base = block.get("base")
    base_s = f"{float(base):.0%}" if isinstance(base, (int, float)) and math.isfinite(float(base)) else "一成上下"
    return f"{int(block['hits'])}/{int(block['trials'])}，盲抽大约 {base_s}"


def _remember_headline(summary, buckets, facts, timing, pick, fut_sell, fut_buy) -> None:
    """Numbers the closing paragraphs must use. Filled on each fresh build."""
    strike = (timing or {}).get("strike") or {}
    stats_path = OUT / "window_stats.json"
    stats = json.loads(stats_path.read_text(encoding="utf-8")) if stats_path.exists() else {}
    logit = (pick or {}).get("logit") or {}
    rnd = (pick or {}).get("random") or {}
    HEADLINE.clear()
    HEADLINE.update({
        "sell": float(summary["sell_lots"]),
        "both": float(buckets["both_only"]),
        "both_wing": float(buckets["both_wing"]),
        "one_wing": float(buckets["one_wing"]),
        "one_naked": float(buckets["one_naked"]),
        "fut_sell": float(fut_sell),
        "fut_buy": float(fut_buy),
        "delta_p50": float((strike.get("abs_delta") or {}).get("p50") or float("nan")),
        "call_p50": float((strike.get("call_otm") or {}).get("p50") or float("nan")),
        "put_p50": float((strike.get("put_otm") or {}).get("p50") or float("nan")),
        "opt_1pct": float(facts["opt_1pct"]),
        "theta": float(facts["theta"]),
        "prem": float(facts["prem"]),
        "vol10": float(facts["vol10"]),
        "dn15": float(facts["expiry"]["dn15"]),
        "floating": float(summary["end_floating"]),
        "realized": float(summary["end_realized"]),
        "econ": float(summary["end_econ"]),
        "logit_hits": int(logit.get("hits") or 0),
        "logit_k": int(logit.get("k") or 0),
        "rnd": float(rnd.get("mean") or float("nan")),
        "stats": stats,
    })


def _money(x: float) -> str:
    return f"{x:+,.0f}"


def _gloss(doc, key: str, text: str, *, space_before: int = 1) -> None:
    p = prof.para(doc, "", space_after=1, space_before=space_before)
    prof.add_text(p, key, size=12, bold=True, color=prof.NAVY)
    prof.add_text(p, "    " + text, size=11, color=prof.TEXT)


def exposure_facts() -> dict:
    """Yuan risk of the option book through 3 Nov 2026, from Black-76.

    Exchange theta and vega are not in yuan. The amounts here are a reprice:
    that day's option close against that day's futures, same volatility, no rates.
    A move is every underlying shifting by the same percent. Gamma is the reprice
    after the delta piece is taken out.
    """
    end = REPORT_END
    shocks = (-0.08, -0.05, -0.03, -0.01, 0.01, 0.03, 0.05, 0.08)
    conn = get_conn()
    try:
        raw = base.load_account(conn)
        opt = base.prof.read_sql(conn, """
            SELECT trade_date::date AS dt, contract, close::float8 AS px, volume::float8 AS volume
            FROM raw_options_contracts_daily
            WHERE trade_date BETWEEN DATE '2026-10-01' AND DATE '2026-11-09'
        """)
        fut = base.prof.read_sql(conn, """
            SELECT trade_date::date AS dt, contract, COALESCE(clear, close)::float8 AS px
            FROM raw_futures_contracts_daily
            WHERE trade_date BETWEEN DATE '2026-10-01' AND DATE '2026-11-09'
        """)
    finally:
        conn.close()
    pos = raw["opt_pos"]
    pos = pos[pos["dt"] <= end].copy()
    trades = raw["opt_trades"]
    trades = trades[trades["dt"] <= end]
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
    settl = pd.to_numeric(pos["settl"], errors="coerce")
    miss = pos["mark"].isna() & (settl > 0)
    pos.loc[miss, "mark"] = settl[miss]
    both = (pos["long_lots"].fillna(0) > 0) & (pos["short_lots"].fillna(0) > 0)
    pos = pos.loc[~both].copy()
    pos["lots"] = pos["long_lots"].fillna(0) + pos["short_lots"].fillna(0)
    pos["qty"] = np.where(pos["short_lots"].fillna(0) > 0, -pos["lots"], pos["lots"])
    rows = []
    for r in pos.itertuples(index=False):
        mark = float(r.mark) if pd.notna(r.mark) else float("nan")
        if not (mark > 0):
            continue
        fpx = None
        for k in base.fut_lookup_keys(r.product, r.month):
            fpx = fut_map.get((r.dt, k))
            if fpx:
                break
        if not fpx:
            continue
        exp = option_expiry(r.product, r.month)
        if exp is None:
            continue
        dte = (pd.Timestamp(exp).date() - pd.Timestamp(r.dt).date()).days
        if dte < 2:
            continue
        tenor = dte / 365.0
        sigma = _implied_vol(fpx, float(r.strike), tenor, mark, r.cp)
        if not (0.02 < sigma < 3.0):
            continue
        g = _bs_greeks(fpx, float(r.strike), sigma, tenor, r.cp)
        m = float(mult.get(r.product, float("nan")))
        if g is None or not math.isfinite(m):
            continue
        model, delta, vega, theta = g
        qty = float(r.qty)
        strike = float(r.strike)
        shock = {}
        for s in shocks:
            moved = _bs_greeks(fpx * (1.0 + s), strike, sigma, tenor, r.cp)
            full = qty * (moved[0] - model) * m
            shock[s] = full - qty * delta * (fpx * s) * m
        wider = _bs_greeks(fpx, strike, sigma + 0.10, tenor, r.cp)
        rows.append({
            "dt": pd.Timestamp(r.dt),
            "product": r.product,
            "cp": r.cp,
            "lots": float(r.lots),
            "fpx": fpx,
            "strike": strike,
            "mark": mark,
            "mult": m,
            "qty": qty,
            "sigma": sigma,
            "tenor": tenor,
            "delta_lots": qty * delta,
            "delta_1pct": qty * delta * (fpx * 0.01) * m,
            "theta_yuan": qty * theta * m,
            "vega_yuan": qty * vega * m,
            "prem_yuan": -qty * mark * m,
            "vol10": qty * (wider[0] - model) * m,
            "dn15": qty * (
                (max(0.0, fpx * 0.85 - strike) if r.cp == "C" else max(0.0, strike - fpx * 0.85)) - mark
            ) * m,
            "long": qty > 0,
            **{f"s{int(s * 100)}": shock[s] for s in shocks},
        })
    df = pd.DataFrame(rows)
    last = df["dt"].max()
    sub = df[df["dt"] == last].copy()
    sub["sector"] = sub["product"].map(_book_sector)
    held = pos[pos["dt"] == last]
    held_lots = held.groupby("product")["lots"].sum()
    priced = sub.groupby("product")["lots"].sum()
    missing = [_cn_name(p) for p, n in held_lots.items() if n >= 10 and float(priced.get(p, 0)) <= 0]
    by = sub.groupby("product").agg(opt=("delta_lots", "sum"), lots=("lots", "sum"))
    fp = raw["fut_pos"].copy()
    fp["dt"] = pd.to_datetime(fp["dt"])
    fp = fp[fp["dt"] == last]
    fp = fp.loc[fp["contract"].map(lambda c: base.parse_contract(c) is None)].copy()
    fp["product"] = fp["contract"].map(base.prof.product_code)
    fp["net"] = fp["long_lots"].fillna(0) - fp["short_lots"].fillna(0)
    fut_px = {r.code: float(r.px) for r in fut[fut["dt"] == last].itertuples(index=False)}
    fut_rows = []
    for prod, net in fp.groupby("product")["net"].sum().items():
        yuan = 0.0
        m = float(mult.get(prod, float("nan")))
        for c in fp[fp["product"] == prod].itertuples(index=False):
            px = fut_px.get(base.norm_code(c.contract))
            if px and math.isfinite(m):
                yuan += float(c.net) * px * 0.01 * m
        fut_rows.append((prod, float(net), yuan))
    day = df.groupby("dt").agg(
        theta=("theta_yuan", "sum"),
        vega=("vega_yuan", "sum"),
        prem=("prem_yuan", "sum"),
    ).sort_index()
    sc = [f"s{int(s * 100)}" for s in shocks]
    gamma = sub[sc].sum()
    long = sub[sub["long"]]

    def _expiry_yuan(frame, new_f) -> float:
        total = 0.0
        for rec in frame.itertuples(index=False):
            spot = new_f(rec)
            if rec.cp == "C":
                intrinsic = max(0.0, spot - rec.strike)
            else:
                intrinsic = max(0.0, rec.strike - spot)
            total += rec.qty * (intrinsic - rec.mark) * rec.mult
        return total

    near_call = sub.loc[sub["cp"].eq("C")].groupby("product")["strike"].min()
    near_put = sub.loc[sub["cp"].eq("P")].groupby("product")["strike"].max()
    expiry = {
        "up10": _expiry_yuan(sub, lambda rec: rec.fpx * 1.10),
        "dn10": _expiry_yuan(sub, lambda rec: rec.fpx * 0.90),
        "up15": _expiry_yuan(sub, lambda rec: rec.fpx * 1.15),
        "dn15": _expiry_yuan(sub, lambda rec: rec.fpx * 0.85),
        "sig1_up": _expiry_yuan(sub, lambda rec: rec.fpx * (1.0 + rec.sigma * math.sqrt(rec.tenor))),
        "sig2_up": _expiry_yuan(sub, lambda rec: rec.fpx * (1.0 + 2.0 * rec.sigma * math.sqrt(rec.tenor))),
        "sig2_dn": _expiry_yuan(sub, lambda rec: rec.fpx * (1.0 - 2.0 * rec.sigma * math.sqrt(rec.tenor))),
        "thru_call": _expiry_yuan(sub, lambda rec: float(near_call.get(rec.product, rec.fpx)) * 1.05),
        "thru_put": _expiry_yuan(sub, lambda rec: float(near_put.get(rec.product, rec.fpx)) * 0.95),
    }
    by_dn = {}
    move = {}
    for rec in sub.itertuples(index=False):
        spot = rec.fpx * (1.0 - 2.0 * rec.sigma * math.sqrt(rec.tenor))
        intrinsic = max(0.0, rec.strike - spot) if rec.cp == "P" else max(0.0, spot - rec.strike)
        by_dn[rec.product] = by_dn.get(rec.product, 0.0) + rec.qty * (intrinsic - rec.mark) * rec.mult
        move[rec.product] = 2.0 * rec.sigma * math.sqrt(rec.tenor)
    expiry["by_sig2_dn"] = sorted(by_dn.items(), key=lambda kv: kv[1])[:6]
    expiry["move2"] = {k: move[k] for k in ("LH", "LC", "SN", "I", "RU")}
    facts = {
        "last": last,
        "priced_lots": float(sub["lots"].sum()),
        "held_lots": float(held["lots"].sum()),
        "missing": "、".join(missing),
        "opt_delta": float(sub["delta_lots"].sum()),
        "opt_1pct": float(sub["delta_1pct"].sum()),
        "by": by,
        "fut_rows": fut_rows,
        "fut_1pct": float(sum(y for _p, _n, y in fut_rows)),
        "theta": float(sub["theta_yuan"].sum()),
        "theta_long": float(long["theta_yuan"].sum()) if not long.empty else 0.0,
        "vega": float(sub["vega_yuan"].sum()),
        "prem": float(sub["prem_yuan"].sum()),
        "vol10": float(sub["vol10"].sum()),
        "expiry": expiry,
        "day": day,
        "gamma_x": [int(s * 100) for s in shocks],
        "gamma_y": [float(gamma[c]) for c in sc],
        "by_sector": sub.groupby("sector")[["delta_1pct", "theta_yuan", "vol10", "dn15"]].sum(),
    }
    facts["charts"] = _exposure_charts(facts)
    return facts


def _exposure_charts(facts: dict) -> dict[str, Path]:
    prof.configure_matplotlib()
    out = OUT / "charts"
    out.mkdir(parents=True, exist_ok=True)

    def _clean(ax):
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.tick_params(labelsize=9)

    by = facts["by"]
    fut_map = {p: n for p, n, _y in facts["fut_rows"]}
    keep = []
    rest = 0.0
    for prod, row in by.sort_values("opt", key=lambda s: s.abs(), ascending=False).iterrows():
        if prod in fut_map or abs(float(row["opt"])) >= 0.4:
            keep.append(prod)
        else:
            rest += float(row["opt"])
    order = [p for p in keep if p in fut_map] + [p for p in keep if p not in fut_map]
    labels = [_cn_name(p) for p in order] + ["其余"]
    opt_v = [float(by.loc[p, "opt"]) for p in order] + [rest]
    fut_v = [float(fut_map.get(p, 0.0)) for p in order] + [0.0]
    y = np.arange(len(labels))
    h = 0.36
    fig, ax = plt.subplots(figsize=(8.2, 4.6))
    ax.barh(y + h / 2, opt_v, h, color=prof.C_NAVY, label="期权")
    ax.barh(y - h / 2, fut_v, h, color=prof.C_GOLD, label="期货")
    ax.axvline(0, color="#1A202C", lw=0.8)
    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    ax.invert_yaxis()
    ax.set_xlabel("净 delta（手）    正数 = 上涨赚钱")
    ax.set_title("方向：期权很小，期货空头才大")
    ax.legend(frameon=False, loc="lower right")
    _clean(ax)
    fig.tight_layout()
    delta_path = out / "exposure_delta.png"
    fig.savefig(delta_path, dpi=140)
    plt.close(fig)

    day = facts["day"]
    labels_d = [pd.Timestamp(t).strftime("%m-%d") for t in day.index]
    x = np.arange(len(day))

    fig, ax = plt.subplots(figsize=(8.2, 4.2))
    ax.bar(x, day["theta"], color=prof.C_RED, width=0.72)
    ax.axhline(0, color="#1A202C", lw=0.6)
    last_i = len(day) - 1
    ax.annotate(
        _money(float(day["theta"].iloc[-1])),
        (last_i, float(day["theta"].iloc[-1])),
        textcoords="offset points", xytext=(0, 6), ha="center", color=prof.C_RED, fontsize=10,
    )
    ax.set_xticks(x)
    ax.set_xticklabels(labels_d, rotation=45, ha="right")
    ax.set_ylabel("元 / 天")
    ax.set_title("时间：仓位变大，每天收得更多")
    _clean(ax)
    fig.tight_layout()
    theta_path = out / "exposure_theta.png"
    fig.savefig(theta_path, dpi=140)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8.2, 4.2))
    ax.bar(x, day["vega"], color=prof.C_GREEN, width=0.72)
    ax.axhline(0, color="#1A202C", lw=0.6)
    ax.annotate(
        _money(float(day["vega"].iloc[-1])),
        (last_i, float(day["vega"].iloc[-1])),
        textcoords="offset points", xytext=(-8, 8), ha="right", color=prof.C_GREEN, fontsize=10,
    )
    ax.set_xticks(x)
    ax.set_xticklabels(labels_d, rotation=45, ha="right")
    ax.set_ylabel("元    隐波上升 1 个点")
    ax.set_title("波动：隐波升 1 个点就亏")
    _clean(ax)
    fig.tight_layout()
    vega_path = out / "exposure_vega.png"
    fig.savefig(vega_path, dpi=140)
    plt.close(fig)

    xs = [0] + facts["gamma_x"]
    ys = [0.0] + facts["gamma_y"]
    order_i = np.argsort(xs)
    xs = [xs[i] for i in order_i]
    ys = [ys[i] for i in order_i]
    fig, ax = plt.subplots(figsize=(8.2, 4.4))
    ax.fill_between(xs, ys, 0, color=prof.C_GREEN, alpha=0.25)
    ax.plot(xs, ys, color=prof.C_NAVY, lw=2.2, marker="o", markersize=5)
    ax.axhline(0, color="#1A202C", lw=0.8)
    for pct in (-5, 5):
        yv = ys[xs.index(pct)]
        ax.annotate(_wan(yv), (pct, yv), textcoords="offset points", xytext=(0, -16), ha="center", fontsize=11, color=prof.C_NAVY, fontweight="bold")
    ax.set_xlabel("每个品种的期货，同向变动 %")
    ax.set_ylabel("元    已去掉方向")
    ax.set_title("加速度：涨也亏，跌也亏，动得越大亏得越快")
    _clean(ax)
    fig.tight_layout()
    gamma_path = out / "exposure_gamma.png"
    fig.savefig(gamma_path, dpi=140)
    plt.close(fig)
    rank_path = _exposure_rank_chart(facts, out)
    return {
        "delta": delta_path,
        "theta": theta_path,
        "vega": vega_path,
        "gamma": gamma_path,
        "rank": rank_path,
    }


def _exposure_rank_chart(facts: dict, out: Path) -> Path:
    """Four option greeks, in yuan, on shocks that do not flatten a strangle.

    Delta is the option book only, for a 1% rise. The futures shorts are not
    in these bars. Theta is one day. Vega is a 10-point rise in implied vol.
    Gamma is the book held to expiry with every futures price 15% lower.
    The dashed line is the premium sitting in the book, the fee he can earn.
    """
    rows = [
        ("Delta", facts["opt_1pct"]),
        ("Theta", facts["theta"]),
        ("Vega", facts["vol10"]),
        ("Gamma", facts["expiry"]["dn15"]),
    ]
    facts["rank_rows"] = rows
    labels = [name for name, _v in rows]
    vals = [v for _n, v in rows]
    y = np.arange(len(rows))
    fig, ax = plt.subplots(figsize=(8.2, 4.6))
    colors = [prof.C_RED if v > 0 else prof.C_GREEN for v in vals]
    ax.barh(y, vals, color=colors, height=0.55)
    fee = facts["prem"]
    ax.axvline(-fee, color=prof.C_GOLD, lw=1.2, ls="--")
    ax.annotate("权利金", (-fee, 3.45), color=prof.C_GOLD, fontsize=11, ha="center", fontweight="bold")
    span = max(abs(v) for v in vals)
    ax.set_xlim(-span * 1.38, span * 0.42)
    for i, v in enumerate(vals):
        ax.annotate(
            _wan(v),
            (v, i),
            textcoords="offset points",
            xytext=(6 if v >= 0 else -6, 0),
            va="center",
            ha="left" if v >= 0 else "right",
            fontsize=13,
            fontweight="bold",
            color=colors[i],
        )
    ax.axvline(0, color="#1A202C", lw=0.8)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=16, fontweight="bold")
    ax.invert_yaxis()
    ax.set_xlabel("元     左是亏，右是赚")
    ax.set_title("期权四项，不含期货")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(axis="x", labelsize=9)
    fig.tight_layout()
    path = out / "exposure_rank.png"
    fig.savefig(path, dpi=140)
    plt.close(fig)
    return path


def write_exposure(doc, add_fig, add_tab) -> None:
    """Opening: what he is paid, and the size of each greek. Charts carry the logic."""
    f = exposure_facts()
    fut_bits = "，".join(f"{_cn_name(p)} {n:+.0f} 手" for p, n, _y in f["fut_rows"])
    g = dict(zip(f["gamma_x"], f["gamma_y"]))
    prof.heading(doc, "他在赚哪一种钱", 1)
    _gloss(doc, "赚", "权利金")
    _gloss(doc, "方向", "期权两翼对掉。下跌在期货空头")
    _gloss(doc, "时间", "正 theta。标的不动，他就收费")
    _gloss(doc, "风险", "短 vega。短 gamma")
    add_tab(
        ["项目", "怎么暴露", REPORT_END_CN],
        [
            ["Delta  方向", "卖远翼，两翼对掉", f"期权 {f['opt_delta']:+.1f} 手"],
            ["", "期货另做空", "，".join(f"{n:+.0f} {_cn_name(p)}" for p, n, _y in f["fut_rows"])],
            ["Theta  时间", "卖出期权，时间掉价", f"{f['theta']:+,.0f} 元/天"],
            ["Vega  波动", "卖出波动，隐波变贵", f"{f['vega']:+,.0f} 元 / 升1点"],
            ["Gamma  加速度", "卖在区间外，走远亏加速", f"{g[-5]:+,.0f} / {g[5]:+,.0f}"],
        ],
        f"{REPORT_END_CN}的四项。金额是元。加速度一行先是同向跌 5%，再是同向涨 5%。",
    )
    prof.heading(doc, "哪一项最大", 2)
    add_fig(
        f["charts"]["rank"],
        "四根柱只算期权，不含期货。Delta 是涨 1%。Theta 是过 1 天。Vega 是隐波升 10 点。Gamma 是持有到到期、价格跌 15%。金色虚线是账上权利金，用来和亏损比。",
    )
    _gloss(doc, "Gamma", f"最大。到期跌 15% {_wan(f['expiry']['dn15'])}，是权利金 {_wan(f['prem'])} 的 {abs(float(f['expiry']['dn15'])) / float(f['prem']):.1f} 倍。")
    _cover_days = abs(float(f["vol10"])) / float(f["theta"]) if float(f["theta"]) else float("nan")
    _gloss(doc, "Vega", f"隐波升 10 点 {_wan(f['vol10'])}。一天的费要攒 {_cover_days:.0f} 天，才抵这一下。")
    _gloss(doc, "Theta", f"一天 {_wan(f['theta'])}。权利金从 10 月 15 日 {_wan(float(f['day']['prem'].iloc[0]))} 加到 {_wan(f['prem'])}，还在建。")
    _gloss(doc, "Delta", f"两翼对掉了。涨 1% 只有 {_wan(f['opt_1pct'])}。期货不在这张图里。")
    prof.heading(doc, "Delta · 方向", 2)
    _gloss(doc, "手段", "卖远翼。认购的空和认沽的多对掉。")
    _gloss(doc, "另外", "碳酸锂、生猪另有期货空头。这是下跌敞口。")
    add_fig(f["charts"]["delta"], f"{REPORT_END_CN}的方向。海军蓝是期权，金色是期货。单位是手。")
    _gloss(doc, "数字", f"期权 {f['opt_delta']:+.1f} 手。期货 {fut_bits}。")
    _gloss(doc, "涨 1%", f"期权 {_wan(f['opt_1pct'])}。期货 {_wan(f['fut_1pct'])}。")

    prof.heading(doc, "Theta · 时间", 2)
    _gloss(doc, "手段", "空头拿着。时间过去，权利金掉进账户。")
    add_fig(f["charts"]["theta"], "每天收进的时间价值。红柱是进账。")
    wing = abs(f["theta_long"])
    _gloss(doc, "数字", f"{REPORT_END_CN} {f['theta']:+,.0f} 元。买近翼减掉 {wing:,.0f} 元，减完仍是正的。")

    prof.heading(doc, "Vega · 波动", 2)
    _gloss(doc, "手段", "卖出的是波动。隐波上升，空头变贵。")
    add_fig(f["charts"]["vega"], "隐含波动上升 1 个点的盈亏。绿柱是亏。")
    _gloss(doc, "数字", f"{REPORT_END_CN} {f['vega']:+,.0f} 元。")

    prof.heading(doc, "Gamma · 加速度", 2)
    _gloss(doc, "手段", "卖在两个行权价外面。走远以后亏加速，不封顶。")
    _gloss(doc, "买翼", "更近、更少。封不住卖出腿。")
    add_fig(f["charts"]["gamma"], f"{REPORT_END_CN}，各品种期货同向变动。方向已经去掉，只留弯曲。绿区是亏。")
    _gloss(doc, "数字", f"同向 5%。跌 {_wan(g[-5])}，涨 {_wan(g[5])}。")
    _gloss(doc, "不含", "期货。期货空头在下跌时是赚的，那一截在方向那张图。")
    prof.para(
        doc,
        f"计价用 Black-76。当天期权收盘，对当天期货价。{REPORT_END_CN}持仓 {f['held_lots']:.0f} 手，算进 {f['priced_lots']:.0f} 手。"
        + (f"{f['missing']}当天没有期货价。" if f["missing"] else "")
        + f"样本到 {REPORT_END_CN}。",
        size=9, color=prof.MUTED, space_after=8,
    )
    return f


SECTOR_CAP = (
    "期权保证金，单位是万元。一条线是一个板块。虚线是 10 月 26 日，11 月合约到期。"
    "期货空头不在图里。"
)


def _sector_gloss(doc, facts: dict) -> None:
    first, last, lots = facts["first"], facts["last"], facts["lots"]
    total0 = float(first.sum())
    youse0 = float(first.get("有色", 0.0))

    def wan(x: float) -> str:
        return f"{x / 10000:.1f}万"

    _gloss(doc, "开头", f"10 月 15 日在有色，{wan(youse0)}，大约 {youse0 / total0:.0%}。")
    _gloss(doc, "掉队", "10 月 26 日，有色和能源化工掉到 0。")
    _gloss(
        doc,
        "后来",
        f"{REPORT_END_CN}，生鲜 {wan(float(last.get('生鲜', 0)))}，"
        f"新能源 {wan(float(last.get('新能源', 0)))}，"
        f"有色回到 {wan(float(last.get('有色', 0)))}。",
    )
    _gloss(
        doc,
        "手数",
        f"农产空着 {float(lots.get('农产', 0)):.0f} 手，保证金只有 {wan(float(last.get('农产', 0)))}。",
    )


def structure_by_sector(opt: pd.DataFrame) -> pd.DataFrame:
    """Sell-open lots in the four blocks, split by sector. Same rules as sell_buckets."""
    end = REPORT_END
    opens = opt[pd.to_datetime(opt["dt"]) <= end].copy()
    opens = opens[opens["is_open"]].copy()
    opens["tag"] = np.where(opens["is_sell"], "S", "L") + opens["cp"].astype(str)
    pivot = opens.pivot_table(index=["dt", "product"], columns="tag", values="lots", aggfunc="sum", fill_value=0).reset_index()
    for col in ("SC", "SP", "LC", "LP"):
        if col not in pivot.columns:
            pivot[col] = 0.0
    pivot["sell"] = pivot["SC"] + pivot["SP"]
    both = (pivot["SC"] > 0) & (pivot["SP"] > 0)
    wing = ((pivot["SC"] > 0) & (pivot["LC"] > 0)) | ((pivot["SP"] > 0) & (pivot["LP"] > 0))
    naked = ~both & ~wing & (pivot["sell"] > 0)
    pivot["kind"] = np.select(
        [both & ~wing, both & wing, wing & ~both, naked],
        ["短宽跨式", "短宽跨式加近买", "比率价差", "单边卖权"],
        default="",
    )
    pivot = pivot[pivot["kind"] != ""].copy()
    pivot["sector"] = pivot["product"].map(_book_sector)
    return pivot.groupby(["kind", "sector"], as_index=False)["sell"].sum()


def _sector_link_charts(structure: pd.DataFrame, greeks: pd.DataFrame) -> dict[str, Path]:
    """One chart for structure × sector, one for the four risks × sector."""
    prof.configure_matplotlib()
    out = OUT / "charts"
    out.mkdir(parents=True, exist_ok=True)
    kinds = ["短宽跨式", "短宽跨式加近买", "比率价差", "单边卖权"]
    sector_order = list(structure.groupby("sector")["sell"].sum().sort_values(ascending=False).index)
    fig, ax = plt.subplots(figsize=(8.2, 4.4))
    x = np.arange(len(kinds))
    bottom = np.zeros(len(kinds))
    for sector in sector_order:
        vals = []
        for kind in kinds:
            hit = structure[(structure["kind"] == kind) & (structure["sector"] == sector)]
            vals.append(float(hit["sell"].sum()) if not hit.empty else 0.0)
        vals = np.array(vals)
        ax.bar(x, vals, bottom=bottom, color=_SECTOR_COLOR.get(sector, "#718096"), width=0.62, label=sector)
        bottom += vals
    for i, total in enumerate(bottom):
        ax.text(i, total + 6, f"{total:.0f}", ha="center", va="bottom", fontsize=9, color="#1A202C")
    ax.set_xticks(x)
    ax.set_xticklabels(kinds, fontsize=10)
    ax.set_ylabel("卖开手数")
    ax.set_ylim(0, float(bottom.max()) * 1.18)
    ax.set_title("四块卖开落在哪些板块")
    ax.legend(frameon=False, ncol=4, loc="upper center", bbox_to_anchor=(0.5, -0.16), fontsize=9)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    struct_path = out / "sector_structure.png"
    fig.savefig(struct_path, dpi=140, bbox_inches="tight")
    plt.close(fig)

    metrics = [
        ("Delta", "delta_1pct", "涨 1%"),
        ("Theta", "theta_yuan", "过 1 天"),
        ("Vega", "vol10", "隐波升 10 点"),
        ("Gamma", "dn15", "到期跌 15%"),
    ]
    greek_order = [s for s in sector_order if s in greeks.index]
    for s in greeks.index:
        if s not in greek_order:
            greek_order.append(s)
    fig, axes = plt.subplots(1, 4, figsize=(8.6, 4.2), sharey=True)
    y = np.arange(len(greek_order))
    for ax, (title, col, ruler) in zip(axes, metrics):
        vals = [float(greeks.loc[s, col]) / 10000.0 if s in greeks.index else 0.0 for s in greek_order]
        ax.barh(y, vals, color=[_SECTOR_COLOR.get(s, "#718096") for s in greek_order], height=0.62)
        ax.axvline(0, color="#1A202C", lw=0.7)
        ax.set_title(f"{title}\n{ruler}", fontsize=11, color="#1A365D")
        ax.set_xlabel("万元", fontsize=8)
        ax.tick_params(labelsize=8)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
    axes[0].set_yticks(y)
    axes[0].set_yticklabels(greek_order, fontsize=9)
    axes[0].invert_yaxis()
    fig.suptitle("四项风险落在哪些板块", fontsize=13, color="#1A365D")
    fig.tight_layout()
    risk_path = out / "sector_risk.png"
    fig.savefig(risk_path, dpi=140, bbox_inches="tight")
    plt.close(fig)
    return {"structure": struct_path, "risk": risk_path}


def _link_gloss(doc, structure: pd.DataFrame, greeks: pd.DataFrame) -> None:
    kinds = ["短宽跨式", "短宽跨式加近买", "比率价差", "单边卖权"]
    keys = ["跨式", "加买", "比率", "单边"]
    for key, kind in zip(keys, kinds):
        part = structure[structure["kind"] == kind].sort_values("sell", ascending=False)
        top = part.head(2)
        bits = "、".join(f"{r.sector} {r.sell:.0f}" for r in top.itertuples(index=False))
        _gloss(doc, key, f"{bits} 手。")
    rulers = [("Delta", "delta_1pct", "涨 1%"), ("Theta", "theta_yuan", "过 1 天"), ("Vega", "vol10", "隐波升 10 点"), ("Gamma", "dn15", "到期跌 15%")]
    for name, col, ruler in rulers:
        order = greeks[col].sort_values(key=lambda s: s.abs(), ascending=False)
        top = order.head(2)
        bits = "、".join(f"{idx} {val / 10000:+.1f}万" for idx, val in top.items())
        _gloss(doc, name, f"{ruler}。{bits}。")


def _write_sector_links(doc, add_fig) -> None:
    end = REPORT_END
    conn = get_conn()
    try:
        trades = base.load_account(conn)["opt_trades"]
    finally:
        conn.close()
    structure = structure_by_sector(trades[pd.to_datetime(trades["dt"]) <= end])
    greeks = exposure_facts()["by_sector"]
    paths = _sector_link_charts(structure, greeks)
    add_fig(paths["structure"], f"四块卖开的手数，按板块叠起来。同一天、同一品种才分进一块。样本到 {REPORT_END_CN}。")
    add_fig(
        paths["risk"],
        f"{REPORT_END_CN}的期权。四张图横轴各自缩放。Delta 是涨 1%。Theta 是过 1 天。Vega 是隐波升 10 点。Gamma 是持有到到期、价格跌 15%。不含期货。",
    )
    _link_gloss(doc, structure, greeks)


def _write_sector(doc, add_fig) -> None:
    """Sector preference is the margin path, not the lot count."""
    facts = sector_exposure()
    add_fig(facts["path"], SECTOR_CAP)
    _sector_gloss(doc, facts)


def conclusion_body(doc, summary, buckets, call, put, delta, dte, pick, both_names, fut_sell, only_opt, facts, add_fig=None, add_grid=None) -> None:
    """Main book, the other three blocks, then the shared short-gamma hole."""
    if add_grid is not None and add_fig is not None:
        add_grid(
            four_shape_charts(),
            "四块的形状。期货价记成 100。海军蓝是到期，金色是还剩 30 天。虚线是行权价。"
            "加近买再买更近的认购，15 手卖对 2 手买。比率只卖认购，20 手卖对 2 手买。单边只卖认购。"
            "买的更少，过了卖价还往下。",
        )
        add_fig(
            four_type_pie(buckets),
            "四块卖开手数占全部卖开的比例。四块相加等于全部卖开。",
        )
        _write_sector(doc, add_fig)
        _write_sector_links(doc, add_fig)
    logit = pick.get("logit") or {}
    rnd = pick.get("random") or {}
    names = "、".join(_cn_name(x) for x in str(both_names).split("、") if x and x != "没有") or "没有"
    sell = float(summary["sell_lots"])
    main = float(buckets["both_only"])
    rest = sell - main
    held = "、".join(f"{_cn_name(p)} {abs(float(n)):.0f} 手" for p, n, _y in facts["fut_rows"])
    loss = float(facts["expiry"]["dn15"])
    prem = float(facts["prem"])
    prof.heading(doc, f"主力：短宽跨式，{main:.0f} 手，占 {main / sell:.0%}", 2)
    _gloss(doc, "做法", "同一品种、同一天，认购和认沽一起卖。")
    _gloss(doc, "方向", f"认购上方约 {call.get('p50', float('nan')):.0%}，认沽下方约 {put.get('p50', float('nan')):.0%}。两翼对掉。绝对 delta {delta.get('p50', float('nan')):.3f}。")
    _gloss(doc, "赚", "到期停在两翼之间，权利金留下。不是另押隐波回落。")
    prof.heading(doc, f"其余：另外三块，{rest:.0f} 手，占 {rest / sell:.0%}", 2)
    _gloss(doc, "单边", f"{buckets['one_naked']:.0f} 手。认购 {buckets['one_call']:.0f}，认沽 {buckets['one_put']:.0f}。多数卖的是上方。")
    _gloss(doc, "比率", f"{buckets['one_wing']:.0f} 手。只卖一边，再买同向。买的更近、更少，封不住。")
    _gloss(doc, "加买", f"{buckets['both_wing']:.0f} 手。两翼都卖，再买一翼。买的同样更近、更少。")
    _gloss(doc, "分法", "同一天才算短宽跨式。隔天补上的另一翼，算进单边。")
    _gloss(doc, "挑", f"约 {pick.get('universe_med', 0):.0f} 个里挑 {pick.get('k_med', 0):.1f} 个。对上 {logit.get('hits', 0)}/{logit.get('k', 0)}，随机大约 {rnd.get('mean', float('nan')):.0%}。看不出超额。")
    prof.heading(doc, "死穴：四块都是负 gamma", 2)
    _gloss(doc, "共同", "买进不超过同边卖出。价格走过卖出的行权价，亏损不封顶。")
    _gloss(doc, "跌", f"{REPORT_END_CN}持有到到期，价格跌 15%，{_wan(loss)}。权利金 {_wan(prem)}，约 {abs(loss) / prem:.1f} 倍。")
    _gloss(doc, "隐波", f"升 10 点 {_wan(facts['vol10'])}。这是卖出带着的。")
    _gloss(doc, "期货", f"另加的方向在{names}。卖开 {fut_sell:.0f} 手，全是卖开。")
    _gloss(doc, "空着", f"{REPORT_END_CN}还空着{held}。其余 {len(only_opt)} 个品种只有期权。")
    prof.heading(doc, "账：到 11 月 3 日", 2)
    _gloss(doc, "到期", "10 月 26 日，117 手买平，权利金记 0。另有 10 月 23 日生猪 1 手。盘中再平 33 手，多数是赚。")
    _gloss(doc, "换月", "后面两个月一起卖。10 月 26 日不卖、买平 117。27 日起改卖 12 月 70 手、1 月 63 手。")
    _gloss(doc, "期限", f"开仓 {dte['lots']:.0f} 手。到到期中位 {dte['p50']:.0f} 天。最短 {dte['min']}，最长 {dte['max']}。")
    _gloss(doc, "落袋", "到期那一批留下约九成权利金。翅膀远，同一档全市场大多也归零。")
    _gloss(doc, "账面", f"到 {summary['end_date']}，重估 {summary['end_floating']:+,.0f}。已平 {summary['end_realized']:+,.0f}。扣费 {summary['end_econ']:+,.0f}。")


def write_conclusion(doc, summary, buckets, call, put, delta, dte, pick, both_names, fut_sell, only_opt, facts, add_fig=None, add_grid=None) -> None:
    prof.heading(doc, "期权交易结构框架", 1)
    conclusion_body(doc, summary, buckets, call, put, delta, dte, pick, both_names, fut_sell, only_opt, facts, add_fig, add_grid)


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

    def add_grid(pics, cap: str) -> None:
        seq["fig"] += 1
        _picture_grid(doc, pics)
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

    facts = write_exposure(doc, add_fig, add_tab)
    write_conclusion(doc, summary, buckets, call, put, delta, dte, pick, both_names, fut_sell, only_opt, facts, add_fig, add_grid)

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
    add_fig(
        four_type_pie(buckets),
        "四块卖开手数占全部卖开的比例。四块相加等于全部卖开。",
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
        f"全板线性组合，留出当天再取同样多个，打中 {(pick.get('logit') or {}).get('hits', 0)}/{(pick.get('logit') or {}).get('k', 0)}，"
        f"随机大约 {float((pick.get('random') or {}).get('mean') or float('nan')):.0%}。"
        "深度为 2 的树没有在拉长后的这一窗上重训，这里不沿用旧的打中个数。"
        "这一窗大部分合约没有行权价自己的隐波，虚值相对平值的偏离进不了这棵树。"
        "10 月 23 日和 10 月 26 日权利金为 0 的买平共 118 手。能对上期货价的 101 手都停在行权价外侧。另外 17 手是螺纹和橡胶的 11 月合约，期货价对不上，权利金同样是 0。这些手同一天一起归零。"
        "锰硅、纯碱、工业硅也在那 331 个里面，他没有卖。卖出的月份里包括离到期只有几天的 11 月合约。",
    )
    prof.para(
        doc,
        "再改用他当天自己的虚值距离，不用固定的 13% 和 12%。12 个卖出日里，认购距离中位 13.2%，认沽 11.3%。"
        "按当天这个距离，平值隐波下两边实值概率都低于 5% 的还有 300 个品种日，他卖了 20 个，放过 280 个。"
        f"卖开 {float(summary['sell_lots']):.0f} 手。手续费和权利金的分位按这一窗重算；没有一手低于手续费的两倍，是上一窗对过的，这一窗没有改这个口径。"
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
        f"卖开 {float(summary['sell_lots']):.0f} 手的期限分位按这一窗。上一窗不超过 1 天的是 0 手、不超过 14 天的是 130 手、中位 27 天，那是截到 11 月 3 日的数。"
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
        _clock_bits(timing)
        + "板块个数并不齐。黑色一天 0 到 2 个，有色 0 到 3 个，农产品 0 到 3 个，化工 0 到 2 个，碳酸锂那一组 0 到 1 个。"
        "10 月 15 日是农产品 2 个、化工 2 个、有色 3 个、黑色 1 个。10 月 20 日只有锡。11 月 3 日只有碳酸锂。",
    )
    prof.para(
        doc,
        "板块内部用前一日就能算出的数来排。平值隐波减去固定参数 GARCH(1,1) 的预测，预测只用到前一交易日为止的收益。"
        "农产品 8 次打中 1 次，盲抽大约 16%。黑色 6 次打中 3 次，盲抽大约 33%。"
        "有色 15 次打中 12 次，盲抽大约 30%。10 月 19 日他卖锡，预测更高的是镍。10 月 21 日他卖镍，预测更高的是锡。"
        "碳酸锂对工业硅只比前一日两边都有平值的日子，没有平值的日子不能算进打中。"
        f"不先分板块，同一条预测在全板上打中 {_hit_phrase(_window_stats().get('har'))}。平值隐波减 20 日实现波动是 {_hit_phrase(_window_stats().get('vrp'))}。"
        "卖出之后的 10 个交易日，实现波动才看得到。那段差额是事后才有的数。",
    )
    prof.para(
        doc,
        f"有结算价的日子从 8 月 3 日到 {REPORT_END_CN}，不是每个交易日，也不是同一批行权价，排不出过去 20 天的偏斜分位。"
        "这窗里虚值结算价和前一日平值都能对上的有 46 条。他卖的那些，虚值隐波减前一日平值的中位是 1.7 个点，没卖的中位是 6.4 个点。"
        "按这个差额从大到小取和他当天一样多个，打中 7/19，盲抽大约 46%。"
        "能估出权利金和卖方保证金的翼有 58 条，他卖了 23 条。保证金仍按权利金加上期货名义价值的大约 10%，再扣掉虚值额的一半。"
        "权利金除以保证金，他的中位是 1.1%，没卖的中位是 3.1%。按这个比例从高到低打中 9/23，盲抽大约 45%。"
        "从占保证金 0.5% 到 8% 的每一档门槛，留下来的没卖品种都多于他卖的。",
    )
    prof.para(
        doc,
        f"开盘前能用的预测，和卖出之后才看到的实现波动，差一截。用到前一日为止的收益做 HAR，平值隐波减这个预测，他的中位高出 {float((_window_stats().get('har') or {}).get('his') or float('nan')):.1f} 个点，没卖的高出 {float((_window_stats().get('har') or {}).get('oth') or float('nan')):.1f} 个点。"
        f"每天取差额最大的、和他当天一样多个，打中 {_hit_phrase(_window_stats().get('har'))}。卖出之后 10 个交易日的实现波动是事后才有的数。",
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
        f"每一块下面有两笔。第一笔到 {REPORT_END_CN}还开着，重估用期权结算价，不是已经落袋的数字。"
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
    if both:
        prof.para(
            doc,
            f"期货卖出 {fut_sell:.0f} 手、买入 {fut_buy:.0f} 手。"
            "碳酸锂和生猪是卖开以后留着的空头：10 月 29 日 LC 卖期货 10 手，同时卖购 6 手、卖沽 1 手；"
            "10 月 30 日 LH 卖期货 12 手，同时卖购 10 手、卖沽 5 手；11 月 2 日 LC 卖期货 7 手，同时卖沽 5 手。"
            "11 月 3 日 LH 再卖期货 6 手，当天没有新的期权开仓。"
            "11 月 6 日锡期货卖开 1 手、当天买平 1 手，和当天的认沽卖开落在同一天，没有留到期末。"
            "期末还留着的期货空头是碳酸锂和生猪。其他标的只有期权。",
        )
    prof.para(
        doc,
        f"到 {summary['end_date']}，期权相对开仓价的浮动盈亏 {summary['end_floating']:+,.0f} 元，已经平掉的 {summary['end_realized']:+,.0f} 元，"
        f"减去手续费后 {summary['end_econ']:+,.0f} 元。卖出时收进的权利金 {summary['premium_net']:+,.0f} 元已经含在这条盈亏里，不要再加一次。"
        f"日报累计当日盈亏 {summary['broker_pnl']:+,.0f} 元，含期货。期权持仓盈亏字段是 0，浮动是用结算价对开仓价重估的。"
        f"期末还空着 {summary['end_short']:.0f} 手期权。10 月 26 日上期所 2611 到期，117 手在 16:45 的批次里了结，权利金留下大约九成。后来的买平不并进这 117 手。",
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
        f"从 10 月 15 日到 {REPORT_END_CN}，上期所到期日过了 10 月 26 日，大商所 11 月期权的到期日过了 10 月 23 日。走到这两个日子的空头，在当天收盘批次了结。"
        "螺纹 1 月的到期日是 12 月 25 日，豆粕 1 月是 12 月 16 日，玉米 1 月和鸡蛋 12 月都是 11 月 17 日，这些合约到样本结束都还开着。第一节那笔螺纹就是其中一张。"
        "卖虚值。到期日当天，该月份的空头在收盘批次了结；到期日之前大部分留着，盘中买平的是少数。LC 和 LH 上另外加着没有买回的期货空头。"
        "选品种的模型打中三成，高于随机，还不能按名单逐个下单。"
        + intraday_close,
    )
    write_expiry_compare(doc, add_tab, add_fig)
    _remember_headline(summary, buckets, facts, timing, pick, fut_sell, fut_buy)
    apply_report_outline(doc)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        doc.save(path)
    except PermissionError:
        path = path.with_name(path.stem + "_含图表.docx")
        doc.save(path)
        print("LOCKED, wrote", path)
    print("SAVED", path)


def _body_text(el) -> str:
    return "".join(t.text or "" for t in el.iter(qn("w:t"))).strip()


def _bare_title(text: str) -> str:
    text = re.sub(r"^[一二三四五六七八九十]+、", "", text)
    return re.sub(r"^\d+(?:\.\d+)*\s+", "", text)


def _heading_level(el) -> int:
    p_pr = el.find(qn("w:pPr"))
    p_style = None if p_pr is None else p_pr.find(qn("w:pStyle"))
    val = "" if p_style is None else (p_style.get(qn("w:val")) or "")
    digits = re.findall(r"\d+", val)
    return int(digits[0]) if digits else 1


def number_headings(doc) -> None:
    """Prefix headings in reading order: 1, 1.1, 1.1.1."""
    c1 = c2 = c3 = 0
    for el in doc.element.body:
        if not _is_heading_el(el):
            continue
        bare = _bare_title(_body_text(el))
        if not bare:
            continue
        if bare.startswith("附录"):
            if _body_text(el) != bare:
                _rename_heading(el, bare)
            continue
        level = _heading_level(el)
        if level <= 1:
            c1 += 1
            c2 = c3 = 0
            prefix = f"{c1} "
        elif level == 2:
            c2 += 1
            c3 = 0
            prefix = f"{c1}.{c2} "
        else:
            c3 += 1
            prefix = f"{c1}.{c2}.{c3} "
        new = prefix + bare
        if _body_text(el) != new:
            _rename_heading(el, new)


def _set_heading_style(el, level: int) -> None:
    p_pr = el.find(qn("w:pPr"))
    if p_pr is None:
        p_pr = OxmlElement("w:pPr")
        el.insert(0, p_pr)
    p_style = p_pr.find(qn("w:pStyle"))
    if p_style is None:
        p_style = OxmlElement("w:pStyle")
        p_pr.append(p_style)
    p_style.set(qn("w:val"), f"Heading{level}")


def _rename_heading(el, new: str) -> None:
    texts = list(el.iter(qn("w:t")))
    if not texts:
        return
    texts[0].text = new
    for node in texts[1:]:
        node.text = ""


def apply_report_outline(doc) -> None:
    """Put the existing note under four chapters. Idempotent."""
    body = doc.element.body
    elems = list(body)
    if any(_is_heading_el(el) and _bare_title(_body_text(el)) == "初步统计观察" for el in elems):
        _finish_outline(doc)
        return

    def at(prefix: str, exact: bool = False) -> int:
        hits = []
        for i, el in enumerate(elems):
            tx = _body_text(el)
            if (tx == prefix) if exact else tx.startswith(prefix):
                hits.append(i)
        if len(hits) != 1:
            raise RuntimeError(f"{prefix!r} found {len(hits)} times")
        return hits[0]

    h_money = at("他在赚哪一种钱", exact=True)
    h_frame = at("期权交易结构框架", exact=True)
    cap8 = at("图8  ")
    cap9 = at("图9  ")
    cap10 = at("图10  ")
    cross = at("跨式    ")
    delta = at("Delta    涨")
    main_h = at("主力：")
    account = at("账：到 11 月 3 日", exact=True)
    h_strangle = at("一、短宽跨式")
    h_trade = at("二、一笔交易在做什么", exact=True)
    expect = at("他开仓，是因为按他自己的概率")
    gate = at("把这几段收成一套开仓门槛")
    margin = at("保证金占权益停在")
    fade = at("认购卖出的 40 个品种日")
    clock = at("卖开手数的钟点")
    garch = at("板块内部用前一日就能算出的数来排")
    skew = at("有结算价的日子从 8 月")
    curve = at("成交价高出当天结算价")
    each = at("每一块下面有两笔")
    futlots = at("期货这段只成交")
    h_fut = at("三、期货和期权放在同一天", exact=True)
    h_when = at("四、哪天卖、卖哪一个", exact=True)
    h_5m = at("卖在 5 分钟的什么位置", exact=True)
    result5 = at("期货均价，相对此前各根")
    model = at("开在哪个品种，每天大约")
    h_names = at("五、每个标的的开和平", exact=True)
    h_sample = at("六、样本就这么长", exact=True)
    h_expiry = at("七、持有到到期", exact=False)
    sect = len(elems) - 1
    order_check = [
        h_money, h_frame, cap8, cap9, cap10, cross, delta, main_h, account, h_strangle, h_trade,
        expect, gate, margin, fade, clock, garch, skew, curve, each, futlots, h_fut, h_when, h_5m,
        result5, model, h_names, h_sample, h_expiry, sect,
    ]
    if order_check != sorted(order_check):
        raise RuntimeError("section anchors are out of order")

    def take(a: int, b: int) -> list:
        return elems[a:b]

    chapters = [
        prof.heading(doc, "一、初步统计观察", 1)._p,
        prof.heading(doc, "风险暴露", 2)._p,
        prof.heading(doc, "交易板块", 2)._p,
        prof.heading(doc, "期权交易结构框架", 2)._p,
        prof.heading(doc, "二、策略推断", 1)._p,
        prof.heading(doc, "假设检验", 2)._p,
        prof.heading(doc, "已证伪", 2)._p,
        prof.heading(doc, "部分证实", 2)._p,
        prof.heading(doc, "三、预测模型", 1)._p,
        prof.heading(doc, "四、总结", 1)._p,
    ]
    c1, risk_h, sector_h, frame_h, c2, test_h, fail_h, part_h, c3, c4 = chapters
    new = (
        elems[:h_money]
        + [c1, risk_h]
        + take(h_money, h_frame)
        + take(cap10 - 1, cross)
        + take(delta, main_h)
        + take(h_fut, h_when)
        + [sector_h]
        + take(cap8 - 1, cap10 - 1)
        + take(cross, delta)
        + [frame_h]
        + take(h_frame + 1, cap8 - 1)
        + take(main_h, account)
        + take(h_strangle, expect)
        + take(each, futlots)
        + take(margin, fade)
        + take(clock, garch)
        + take(curve, each)
        + take(h_when, h_5m)
        + [c2, test_h]
        + take(expect, gate)
        + take(h_5m, result5)
        + [fail_h]
        + take(gate, margin)
        + take(fade, clock)
        + take(skew, curve)
        + take(result5, model)
        + [part_h]
        + take(garch, skew)
        + take(h_expiry, sect)
        + [c3]
        + take(model, h_names)
        + [c4]
        + take(account, h_strangle)
        + take(futlots, h_fut)
        + take(h_sample, h_expiry)
        + take(h_names, h_sample)
    )
    head = elems[:h_money]
    used = [el for el in new if not any(el is c for c in chapters) and not any(el is e for e in head)]
    mid = elems[h_money:sect]
    skipped = elems[h_frame]
    if len(used) != len(mid) - 1 or any(el is skipped for el in used):
        raise RuntimeError(f"outline coverage {len(used)} vs {len(mid) - 1}")
    seen = set()
    for el in used:
        if id(el) in seen:
            raise RuntimeError("outline repeated a block")
        seen.add(id(el))
    for el in mid:
        if el is skipped:
            continue
        if id(el) not in seen:
            raise RuntimeError("outline dropped " + _body_text(el)[:40])

    _rename_heading(elems[h_strangle], "短宽跨式的盈亏")
    _rename_heading(elems[h_trade], "一笔交易在做什么")
    _rename_heading(elems[h_fut], "期货和期权放在同一天")
    _rename_heading(elems[h_when], "哪天卖、卖哪一个")
    _rename_heading(elems[h_names], "附录 交易标的品种详细情况")
    _rename_heading(elems[h_sample], "样本就这么长")
    _rename_heading(elems[h_expiry], "持有到到期，和他卖出的位置")
    for el in (elems[h_money], elems[main_h], elems[account]):
        _set_heading_style(el, 3 if el is not elems[account] else 2)
    for el in mid:
        style = el.find(qn("w:pPr"))
        if style is None:
            continue
        p_style = style.find(qn("w:pStyle"))
        if p_style is None:
            continue
        val = p_style.get(qn("w:val")) or ""
        if not val.startswith("Heading"):
            continue
        if el is elems[h_names]:
            _set_heading_style(el, 1)
        elif el is elems[account] or el is elems[h_sample]:
            _set_heading_style(el, 2)
        elif el is elems[h_frame]:
            continue
        else:
            _set_heading_style(el, 3)

    sect_el = elems[sect]
    for child in list(body):
        if child is not sect_el:
            body.remove(child)
    for el in new:
        sect_el.addprevious(el)
    _finish_outline(doc)


_HYP_PATH = Path(__file__).resolve().parents[2] / "reports" / "RX383_假设检验.docx"
_FAIL_HEADS = {
    "平值隐波减 20 日实现波动",
    "平值隐波减 HAR",
    "卖出后 10 日的实现波动",
    "虚值隐波减前一日平值",
    "农产品里的同一条",
    "线性组合、曲线年化和树",
}
_PART_HEADS = {
    "有色里的 GARCH 差额",
    "碳酸锂对工业硅",
}
_HYP_FIXES = (
    ("写在第六部分。", "写在「有色：哪一天做、做几个、为什么放过第一名」。"),
    ("那份模型在第七部分。", "那份模型在「有色开仓模型」。"),
    ("在第八部分。", "在「有色开哪张合约、权利金写多少」。"),
    ("在第九部分。", "在「11月3日到9日，模型开什么、他做了什么」。"),
)


def _is_heading_el(el) -> bool:
    p_pr = el.find(qn("w:pPr"))
    if p_pr is None:
        return False
    p_style = p_pr.find(qn("w:pStyle"))
    if p_style is None:
        return False
    return (p_style.get(qn("w:val")) or "").startswith("Heading")


def _image_blob(el, src) -> bytes | None:
    blip = el.find(".//" + qn("a:blip"))
    if blip is None:
        return None
    rid = blip.get(qn("r:embed"))
    if not rid:
        return None
    return src.part.related_parts[rid].blob


def _table_matrix(el) -> list[list[str]]:
    rows = []
    for tr in el.findall(qn("w:tr")):
        rows.append([
            "".join(t.text or "" for t in tc.iter(qn("w:t"))).strip()
            for tc in tr.findall(qn("w:tc"))
        ])
    return rows


def insert_hypothesis_findings(doc) -> None:
    """Copy RX383_假设检验 into 策略推断. Idempotent."""
    if any(
        _is_heading_el(el) and _bare_title(_body_text(el)) == "成交里直接数出来的"
        for el in doc.element.body
    ):
        return
    if not _HYP_PATH.is_file():
        raise RuntimeError(f"missing {_HYP_PATH}")
    from io import BytesIO

    src = Document(str(_HYP_PATH))
    buckets: dict[str, list] = {"test": [], "fail": [], "part": []}
    dest = ""
    started = False
    fixes_hit = 0
    lc_fixed = False
    pics = 0

    def take(el) -> None:
        if dest:
            buckets[dest].append(el)

    for el in src.element.body:
        if el.tag == qn("w:sectPr"):
            continue
        if _is_heading_el(el):
            title = _body_text(el)
            if title.startswith("二、"):
                started = True
                dest = "test"
                take(prof.heading(doc, title[2:], 3)._p)
            elif title.startswith("三、"):
                started = True
                dest = "test"
                take(prof.heading(doc, title[2:], 3)._p)
            elif title.startswith("四、"):
                dest = "fail"
                take(prof.heading(doc, title[2:], 3)._p)
            elif title.startswith("五、"):
                dest = "test"
                take(prof.heading(doc, title[2:], 3)._p)
            elif title.startswith(("六、", "七、", "八、", "九、")):
                dest = "part"
                take(prof.heading(doc, title[2:], 3)._p)
            elif title in _FAIL_HEADS:
                dest = "fail"
                take(prof.heading(doc, title, 3)._p)
            elif title in _PART_HEADS:
                dest = "part"
                take(prof.heading(doc, title, 3)._p)
            elif started:
                take(prof.heading(doc, title, 3)._p)
            continue
        if not started:
            continue
        if el.tag == qn("w:tbl"):
            matrix = _table_matrix(el)
            if not matrix:
                continue
            headers, body_rows = matrix[0], matrix[1:]
            fixed_rows = []
            for row in body_rows:
                if row and row[0].startswith("碳酸锂对工业硅"):
                    row = [
                        "碳酸锂对工业硅",
                        "只比前一日两边都有平值的日子",
                        "两个名字",
                        "见下图",
                        "没有平值的日子不能算打中",
                    ]
                    lc_fixed = True
                fixed_rows.append(row)
            take(prof.add_table(doc, headers, fixed_rows)._tbl)
            continue
        blob = _image_blob(el, src)
        if blob is not None:
            doc.add_picture(BytesIO(blob), width=Inches(6.3))
            pic = doc.paragraphs[-1]
            pic.alignment = WD_ALIGN_PARAGRAPH.CENTER
            take(pic._p)
            pics += 1
            continue
        text = _body_text(el)
        if not text:
            continue
        for old, new in _HYP_FIXES:
            if old in text:
                text = text.replace(old, new)
                fixes_hit += 1
        if re.match(r"^[图表]\d+\s", text):
            prof.caption(doc, text)
            take(doc.paragraphs[-1]._p)
        else:
            take(prof.para(doc, text)._p)

    if pics != 12 or fixes_hit != 4 or not lc_fixed:
        raise RuntimeError(f"hypothesis copy pics={pics} fixes={fixes_hit} lc={lc_fixed}")
    if not buckets["test"] or not buckets["fail"] or not buckets["part"]:
        raise RuntimeError("hypothesis copy missed a section")

    def anchor(text: str, start: bool = False):
        found = None
        for el in doc.element.body:
            tx = _bare_title(_body_text(el))
            if start and tx.startswith(text) or (not start and tx == text):
                found = el
                break
        if found is None:
            raise RuntimeError(f"missing anchor {text}")
        return found

    test_at = anchor("已证伪")
    fail_at = anchor("部分证实")
    part_at = anchor("持有到到期", start=True)
    for el in buckets["test"]:
        test_at.addprevious(el)
    for el in buckets["fail"]:
        fail_at.addprevious(el)
    for el in buckets["part"]:
        part_at.addprevious(el)


def move_product_appendix(doc) -> None:
    """Move the per-product charts to an appendix at the end. Idempotent."""
    body = doc.element.body
    elems = list(body)
    sect = elems[-1]
    start = None
    for el in elems:
        if not _is_heading_el(el):
            continue
        bare = _bare_title(_body_text(el))
        if bare in ("每个标的的开和平", "交易标的品种详细情况") or (
            bare.startswith("附录") and "交易标的" in bare
        ):
            start = el
            break
    if start is None:
        raise RuntimeError("missing per-product section")
    end = sect
    seen = False
    for el in elems:
        if el is start:
            seen = True
            continue
        if seen and _is_heading_el(el):
            end = el
            break
    chunk = []
    el = start
    while el is not end:
        chunk.append(el)
        el = el.getnext()
    _rename_heading(start, "附录 交易标的品种详细情况")
    _set_heading_style(start, 1)
    if chunk[-1].getnext() is sect:
        return
    for el in chunk:
        sect.addprevious(el)


def _finish_outline(doc) -> None:
    body = list(doc.element.body)
    for i, el in enumerate(body):
        if _body_text(el) != "短宽跨式(两边一起卖，不再买)":
            continue
        nxt = ""
        for later in body[i + 1:i + 6]:
            nxt = _body_text(later)
            if nxt:
                break
        if nxt.startswith("短宽跨式是同时卖出"):
            _rename_heading(el, "短宽跨式的盈亏")
            break
    insert_hypothesis_findings(doc)
    move_product_appendix(doc)
    relocate_metal_model(doc)
    write_hypothesis_logic(doc)
    write_test_summaries(doc)
    rewrite_summary(doc)
    _renumber_captions(list(doc.element.body))
    number_headings(doc)


def _heading_by_title(doc, text: str, *, start: bool = False):
    for el in doc.element.body:
        if not _is_heading_el(el):
            continue
        bare = _bare_title(_body_text(el))
        if start and bare.startswith(text) or (not start and bare == text):
            return el
    return None


def _body_pos(doc, target) -> int:
    for i, el in enumerate(doc.element.body):
        if el is target:
            return i
    raise RuntimeError("element left the document")


def relocate_metal_model(doc) -> None:
    """Move the non-ferrous open rule into 预测模型. Leave a short note in 部分证实."""
    start = _heading_by_title(doc, "有色：哪一天做、做几个、为什么放过第一名")
    hold = _heading_by_title(doc, "持有到到期", start=True)
    model = _heading_by_title(doc, "预测模型")
    close = _heading_by_title(doc, "总结")
    if start is None or hold is None or model is None or close is None:
        raise RuntimeError("metal-model anchors missing")
    if _body_pos(doc, start) < _body_pos(doc, model):
        chunk = []
        el = start
        while el is not hold:
            chunk.append(el)
            el = el.getnext()
        for el in chunk:
            close.addprevious(el)
            if _is_heading_el(el):
                _set_heading_style(el, 2)
    for el in doc.element.body:
        tx = _body_text(el)
        if "还是第七部分那套规则" in tx:
            _rename_heading(el, tx.replace("还是第七部分那套规则", "还是「有色开仓模型」那套规则"))
    hold = _heading_by_title(doc, "持有到到期", start=True)
    note = "规则、合约、11 月 3 日到 9 日，写在预测模型。"
    if any(note in _body_text(el) for el in doc.element.body):
        return
    lines = (
        ("名单", f"有色内部，差额把卖出的名字排到前面。打中 {_hit_phrase((HEADLINE.get('stats') or {}).get('metal'))}。两天把镍和锡排反。"),
        ("开仓", "门槛是按 10 月 15 日到 11 月 3 日定的，后面几天没有拿来重定。定不了哪天做、做几个、镍和锡拿哪一个。"),
        ("后文", note),
    )
    made = []
    for key, text in lines:
        _gloss(doc, key, text)
        made.append(doc.paragraphs[-1]._p)
    for el in made:
        hold.addprevious(el)


def write_hypothesis_logic(doc) -> None:
    """State why each test exists. The same trades fit more than one rule."""
    if _heading_by_title(doc, "这些假设从哪来") is not None:
        return
    head = _heading_by_title(doc, "假设检验")
    if head is None or head.getnext() is None:
        raise RuntimeError("missing 假设检验")
    anchor = head.getnext()
    made = [prof.heading(doc, "这些假设从哪来", 3)._p]
    lines = (
        ("来源", "第一章记下的是他做了什么。卖远虚值，两翼对掉，板块换过，钟点铺开，成交价高于结算价。这是现象，还不是一条规则。"),
        ("歧义", "同一批现象可以由好几条规则做出来。虚值比平值贵，可以是他把平值隐波当成真实密度，也可以是他在挑隐波高出实现波动的名字，也可以只是远翼本来就贵。现象本身分不出是哪一条。"),
        ("做法", "一条规则要在开仓前指出名字、行权价或时刻。放到当天全部挂牌上，取出和他当天一样多个，再和同样个数的盲抽比。中位更高不够，当天的名单要对上。"),
        ("逐条", "一次只留一条。平值隐波当真实密度，支撑和压力，隐波减 20 日实现波动，HAR，虚值减平值，振幅，冲高回落，成交量和持仓量，开盘隐波，保证金和手续费，时间衰减，5 分钟上的位置。有色里的 GARCH 差额再单独测一次，因为全板对不上时，这一小块仍可能对得上。"),
        ("先后", "卖出之后才有的数，不能当成他下单的理由。卖出后 10 日的实现波动只看事后。"),
        ("尺子", "紧接着的 Black-76 把成交价解成实值概率。用这个概率去算，期望是 0。它不是他的预测。"),
        ("去向", "名单对不上的，写进已证伪。有色这一小块还站着的，写进部分证实。把差额、空头和连续天数拼起来的开仓规则，写进预测模型。"),
    )
    for key, text in lines:
        _gloss(doc, key, text)
        made.append(doc.paragraphs[-1]._p)
    for el in made:
        anchor.addprevious(el)


def _insert_before(doc, anchor, key: str, text: str) -> None:
    _gloss(doc, key, text)
    anchor.addprevious(doc.paragraphs[-1]._p)


def write_test_summaries(doc) -> None:
    """One closing paragraph each for 已证伪 and 部分证实."""
    failed = _heading_by_title(doc, "部分证实")
    held = _heading_by_title(doc, "预测模型")
    if failed is None or held is None:
        raise RuntimeError("summary anchors missing")
    fail_mark = "它们没有变成「今天卖哪几个」的名单。"
    hold_mark = "到期留下权利金是远翼本身的结果，不是另一条被证实的择时。"
    body_text = [_body_text(el) for el in doc.element.body]
    if not any(fail_mark in tx for tx in body_text):
        _insert_before(
            doc,
            failed,
            "证伪",
            "否掉的是「他按某条开仓前的规则挑名字、挑行权价、挑时刻」。"
            "平值隐波当成真实密度、行权价靠在此前的摆动点上，打中都和他卖出的底子挨在一起。"
            f"全板按隐波减 20 日实现波动，打中 {_hit_phrase((HEADLINE.get('stats') or {}).get('vrp'))}。"
            f"按 HAR，打中 {_hit_phrase((HEADLINE.get('stats') or {}).get('har'))}。"
            "卖出之后的 10 日更静，没卖的名字也更静，不是他单独预报了波动。"
            "虚值减平值、农产品里的差额、振幅、冲高回落、成交量、权利金除以保证金、衰减快慢、固定几个板块、开盘 15 分钟、下午的高点、到期当天才卖，以及 5 分钟上的位置，打中都靠近同样个数的盲抽。"
            f"线性组合打中 {HEADLINE.get('logit_hits', 0)}/{HEADLINE.get('logit_k', 0)}，随机大约 {HEADLINE.get('rnd', float('nan')):.0%}。"
            "有用的认识是：他卖的是远翼，中位上隐波差额更高、成交价高于结算价，这些是账的样子。"
            "它们没有变成「今天卖哪几个」的名单。还没被这批比较拿掉的，只剩有色内部的那一截。",
        )
    if not any(hold_mark in tx for tx in body_text):
        _insert_before(
            doc,
            held,
            "证实",
            "站住的只有一截，而且带条件。"
            f"铜、铝、锌、镍、锡、铅、氧化铝里面，前一日平值隐波减 GARCH，打中 {_hit_phrase((HEADLINE.get('stats') or {}).get('metal'))}。"
            "10 月 19 日和 21 日把镍和锡排反。这条差额定不了他哪天做有色、做几个、镍和锡拿哪一个。"
            "补上空头和连续 4 天的那套规则，门槛是按 10 月 15 日到 11 月 3 日定的，后面几天没有拿来重定。"
            "做不做、名字对得上几成，写在预测模型，是这一窗的写法，不是拿到窗外还能用的规则。"
            "碳酸锂对工业硅，前一日两边都有平值的日子才比得了，不能把没有平值的日子算进打中。"
            "已经到期的远翼归零，是因为翅膀远，同一档全市场大多也归零，没有跑赢那个底子。"
            "有用的认识是：全板挑名字的说法站不住；有色这一小块的名字偏在差额高的一侧，可是天数和个数仍是照他的单子数的；"
            "到期留下权利金是远翼本身的结果，不是另一条被证实的择时。",
        )


def rewrite_summary(doc) -> None:
    """Replace 4.1 with the strategy conclusion. Idempotent."""
    head = None
    for el in doc.element.body:
        if not _is_heading_el(el):
            continue
        bare = _bare_title(_body_text(el))
        if bare.startswith("账：到 11 月 3 日") or bare == "他怎么赚钱":
            head = el
            break
    if head is None:
        raise RuntimeError("missing 4.1")
    chunk = []
    el = head.getnext()
    while el is not None and not _is_heading_el(el):
        chunk.append(el)
        el = el.getnext()
    if el is None:
        raise RuntimeError("4.1 has no following heading")
    marker = "仓还在建，不是一个已经做完的本子。"
    if _bare_title(_body_text(head)) == "他怎么赚钱" and any(marker in _body_text(x) for x in chunk):
        return
    for old in chunk:
        old.getparent().remove(old)
    _rename_heading(head, "他怎么赚钱")
    h = HEADLINE
    if not h:
        raise RuntimeError("headline was not filled")
    sell = h["sell"]
    both = h["both"]
    st = h.get("stats") or {}
    skew = st.get("skew") or {}
    if skew.get("his") is not None and math.isfinite(float(skew["his"])):
        skew_s = f"他卖掉的翼，隐波比前一日平值高出的中位是 {float(skew['his']):.1f} 个点，没卖的翼是 {float(skew['oth']):.1f} 个点。"
    else:
        skew_s = "卖掉的翼相对前一日平值的差额，见假设检验。"
    bought = "没有买回" if h["fut_buy"] == 0 else f"买回 {h['fut_buy']:.0f} 手"
    paragraphs = (
        f"他主要做期权。卖开 {sell:.0f} 手，期货卖开 {h['fut_sell']:.0f} 手，到 {REPORT_END_CN}{bought}。"
        f"期权两翼对掉，卖出时绝对 delta 的中位是 {h['delta_p50']:.3f}。涨 1%，期权这边 {_wan(h['opt_1pct'])}。"
        "真正的方向不在期权上，在期货空头。",
        f"他赚的是权利金。期货停在两个行权价之间，时间过去，空头变便宜，这是正 theta。{REPORT_END_CN}大约一天 {_wan(h['theta'])}。"
        "隐波下降会让空头的标记变好，那是卖出本来就带着的，不是另下一注「隐波要回落」。"
        "已经到期的远翼归零，是因为翅膀远，同一档全市场大多也归零，不是另一条被单独证实的择时。",
        f"卖开分成四块，都是卖。短宽跨式 {both:.0f} 手，占 {both / sell:.0%}。短宽跨式加近买 {h['both_wing']:.0f} 手，"
        f"比率价差 {h['one_wing']:.0f} 手，单边卖权 {h['one_naked']:.0f} 手。"
        "买进的行权价更近、手数更少，价格走过卖出价以后封不住。"
        f"认购离当时期货的中位大约 {h['call_p50']:.0%}，认沽大约 {h['put_p50']:.0%}。",
        "四块共同的风险是负 gamma。价格走过卖出的行权价，亏损不封顶。"
        f"{REPORT_END_CN}若持有到到期、价格跌 15%，{_wan(h['dn15'])}，当时账上权利金 {_wan(h['prem'])}。"
        f"隐波升 10 点 {_wan(h['vol10'])}。波动变大，卖出的一边先亏。"
        + skew_s
        + "按平或者按陡去排，打中靠近盲抽，所以这还不是一条「专挑平坦偏斜」的名单。",
        f"全板按平值隐波减去已实现波动，打中 {_hit_phrase(st.get('vrp'))}。按 HAR，打中 {_hit_phrase(st.get('har'))}。"
        "中位可以更高，当天的名单对不上。"
        f"有色内部改用平值隐波减 GARCH，打中 {_hit_phrase(st.get('metal'))}。"
        "这条差额定不了他哪天做有色、做几个、镍和锡拿哪一个。"
        "4.5、3、1.5、10 手、40 手、连续 4 天，是按 10 月 15 日到 11 月 3 日读出来的，后面几天没有拿来重定这些数。"
        f"全板线性组合打中 {h['logit_hits']}/{h['logit_k']}，随机大约 {h['rnd']:.0%}。",
        f"到 {REPORT_END_CN}，期权相对开仓价重估 {h['floating']:+,.0f}，已经平掉的 {h['realized']:+,.0f}，扣手续费 {h['econ']:+,.0f}。"
        "仓还在建，不是一个已经做完的本子。",
    )
    made = []
    for text in paragraphs:
        prof.para(doc, text)
        made.append(doc.paragraphs[-1]._p)
    for new in made:
        el.addprevious(new)


def _renumber_captions(body) -> None:
    fig_n = 0
    tab_n = 0
    pending = []
    for el in body:
        tx = _body_text(el)
        match = re.match(r"^(图|表)(\d+)\s", tx)
        if not match:
            continue
        kind = match.group(1)
        old = int(match.group(2))
        if kind == "图":
            fig_n += 1
            new = fig_n
        else:
            tab_n += 1
            new = tab_n
        pending.append((el, kind, old, new, tx))
    if fig_n != 62 or tab_n != 30:
        raise RuntimeError(f"caption count 图{fig_n} 表{tab_n}")
    for el, kind, old, new, tx in pending:
        if old == new:
            continue
        _rename_heading(el, re.sub(r"^(图|表)\d+", kind + str(new), tx, count=1))


if __name__ == "__main__":
    main()
