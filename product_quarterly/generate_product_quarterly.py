#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-page quarterly holding-period report for listed-company / institutional investors.

Reads nav.csv + config.json, writes PNG + PDF (A4).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.font_manager import FontProperties, fontManager
from matplotlib.patches import FancyBboxPatch, Rectangle
from matplotlib.transforms import blended_transform_factory

C_NAVY = "#1A365D"
C_NAVY_MID = "#2C5282"
C_RED = "#C53030"
C_BLUE = "#2B6CB0"
C_GRAY = "#4A5568"
C_TEXT = "#1A202C"
C_MUTED = "#718096"
C_BORDER = "#CBD5E1"
C_BG = "#FFFFFF"
C_ROW = "#F7FAFC"
C_KPI_BG = "#F8FAFC"
C_GOLD = "#B7791F"

TRADING_DAYS = 252

_WORKSPACE = Path(__file__).resolve().parent
_FONTS_DIR = _WORKSPACE / "fonts"
_HAITAI_FONTS = _WORKSPACE.parent / "haitai_week_report" / "fonts"


def _is_usable_font_path(path: str) -> bool:
    try:
        return os.path.isfile(path) and os.path.getsize(path) >= 100_000
    except OSError:
        return False


def find_cn_font_path() -> str | None:
    env_path = os.environ.get("FOF_REPORT_FONT_PATH", "").strip()
    candidates = [
        env_path,
        str(_FONTS_DIR / "NotoSansSC-Regular.otf"),
        str(_HAITAI_FONTS / "NotoSansSC-Regular.otf"),
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyhbd.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    ]
    for path in candidates:
        if path and _is_usable_font_path(path):
            try:
                fontManager.addfont(path)
            except Exception:
                pass
            return path
    return None


def configure_cn_font() -> tuple[FontProperties | None, FontProperties | None]:
    path = find_cn_font_path()
    if not path:
        matplotlib.rcParams["axes.unicode_minus"] = False
        return None, None
    try:
        fontManager.addfont(path)
    except Exception:
        pass
    fp = FontProperties(fname=path)
    family = fp.get_name()
    matplotlib.rcParams["axes.unicode_minus"] = False
    matplotlib.rcParams["font.sans-serif"] = [family, "DejaVu Sans"]
    matplotlib.rcParams["font.family"] = "sans-serif"
    fp_bold = FontProperties(fname=path)
    try:
        fp_bold.set_weight("bold")
    except Exception:
        pass
    return fp, fp_bold


def _fmt_pct(value: float | None, digits: int = 2, signed: bool = True) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "--"
    sign = "+" if signed and value > 0 else ""
    return f"{sign}{value * 100:.{digits}f}%"


def _fmt_num(value: float | None, digits: int = 4) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "--"
    return f"{value:.{digits}f}"


def _fmt_date_cn(value: str) -> str:
    if not value:
        return "--"
    try:
        dt = pd.Timestamp(value)
        return f"{dt.year}年{dt.month}月{dt.day}日"
    except Exception:
        return value


def _safe_report_stem(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\r\n]+', "_", name)
    cleaned = re.sub(r"_+", "_", cleaned).strip(" ._")
    return cleaned[:120] or "持有期季报"


def _display_short_name(short_name: str, product_name: str) -> str:
    raw = (short_name or product_name or "").strip()
    for suffix in ("私募证券投资基金", "私募投资基金", "证券投资基金", "私募基金", "投资基金"):
        if raw.endswith(suffix):
            raw = raw[: -len(suffix)].strip()
            break
    return raw or short_name or product_name


def load_nav_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig")
    if df.empty:
        raise ValueError("净值数据为空")
    cols = list(df.columns)
    date_col = cols[0]
    unit_col = cols[1] if len(cols) > 1 else None
    adj_col = cols[3] if len(cols) > 3 else unit_col
    bench1_col = cols[5] if len(cols) > 5 else None
    bench2_col = cols[6] if len(cols) > 6 else None
    out = pd.DataFrame()
    out["date"] = pd.to_datetime(df[date_col])
    out["unit_nav"] = pd.to_numeric(df[unit_col], errors="coerce") if unit_col else np.nan
    out["nav"] = pd.to_numeric(df[adj_col], errors="coerce") if adj_col else out["unit_nav"]
    out["nav"] = out["nav"].fillna(out["unit_nav"])
    out["bench1"] = pd.to_numeric(df[bench1_col], errors="coerce") if bench1_col else np.nan
    out["bench2"] = pd.to_numeric(df[bench2_col], errors="coerce") if bench2_col else np.nan
    out = out.dropna(subset=["date", "nav"]).sort_values("date").reset_index(drop=True)
    if len(out) < 2:
        raise ValueError("净值数据不足")
    return out


def _total_return(start: float, end: float) -> float:
    if start <= 0:
        return 0.0
    return end / start - 1.0


def _max_drawdown(nav: pd.Series) -> float:
    peak = nav.cummax()
    dd = nav / peak - 1.0
    value = float(dd.min()) if len(dd) else 0.0
    # A dip smaller than 0.01% rounds to 0.00%. Keep the sign off that zero.
    if not np.isfinite(value) or value > -5e-5:
        return 0.0
    return value


def normalize_nav_frequency(freq: str | None) -> str:
    normalized = (freq or "weekly").strip().lower()
    if normalized in ("daily", "weekly", "monthly"):
        return normalized
    return "weekly"


def apply_nav_frequency(df: pd.DataFrame, freq: str | None) -> pd.DataFrame:
    """Keep the last trading day of each week or month.

    Weekly buckets start on Monday. A period that ends mid-week still keeps
    that week's latest trading day, so the ending net value stays on the report.
    """
    normalized = normalize_nav_frequency(freq)
    work = df.sort_values("date").copy()
    trading = work[work["date"].dt.weekday < 5]
    if not trading.empty:
        work = trading
    if normalized == "weekly":
        monday = work["date"] - pd.to_timedelta(work["date"].dt.weekday, unit="D")
        work = work.assign(_bucket=monday.dt.normalize())
        sampled = work.groupby("_bucket", sort=True).tail(1)
    elif normalized == "monthly":
        work = work.assign(_bucket=work["date"].dt.to_period("M").astype(str))
        sampled = work.groupby("_bucket", sort=True).tail(1)
    else:
        sampled = work
    sampled = sampled.drop(columns="_bucket", errors="ignore").sort_values("date").reset_index(drop=True)
    if len(sampled) < 2:
        raise ValueError("按所选净值频率聚合后数据不足")
    return sampled



def _ann_vol(path: pd.Series) -> float | None:
    vals = path.dropna().astype(float)
    if len(vals) < 3:
        return None
    rets = vals.pct_change().dropna()
    if len(rets) < 2:
        return None
    gaps = vals.index.to_series().diff().dt.days.dropna()
    med = float(gaps.median()) if len(gaps) else 7.0
    if med <= 2:
        ppy = 252
    elif med <= 10:
        ppy = 52
    elif med <= 20:
        ppy = 26
    elif med <= 45:
        ppy = 12
    else:
        ppy = 4
    return float(rets.std(ddof=1) * np.sqrt(ppy))


def _holding_metrics(
    series: pd.Series,
    start: pd.Timestamp,
    end: pd.Timestamp,
    anchor: str = "prior",
) -> dict[str, float | None]:
    full = series.dropna()
    if len(full) < 2:
        return {"ret": None, "ann": None, "ann_vol": None, "mdd": None, "days": None, "n": None}
    before = full[full.index < start]
    window = full[(full.index >= start) & (full.index <= end)]
    if len(window) < 1:
        return {"ret": None, "ann": None, "ann_vol": None, "mdd": None, "days": None, "n": None}
    # Product-page 开始分析 slices the dates first, then samples. The return
    # starts at the first point inside the window, not the previous week.
    use_prior = anchor != "window" and len(before) > 0
    if use_prior:
        base = float(before.iloc[-1])
        start_dt = before.index[-1]
        year_basis = 365.0
    else:
        if len(window) < 2:
            return {"ret": None, "ann": None, "ann_vol": None, "mdd": None, "days": None, "n": None}
        base = float(window.iloc[0])
        start_dt = window.index[0]
        year_basis = 365.25
    last = float(window.iloc[-1])
    ret = _total_return(base, last)
    days = max((window.index[-1] - start_dt).days, 1)
    ann = (1 + ret) ** (year_basis / days) - 1 if days > 0 else 0.0
    path = pd.concat([pd.Series({start_dt: base}), window]) if start_dt not in window.index else window
    mdd = _max_drawdown(path)
    ann_vol = _ann_vol(path)
    return {"ret": ret, "ann": ann, "ann_vol": ann_vol, "mdd": mdd, "days": float(days), "n": float(len(window))}


def _relative_return(fund_ret: float | None, bench_ret: float | None, method: str) -> float | None:
    """产品页「超额（除法）」为 (1+基金)/(1+基准)-1，未勾选时为基金减基准。"""
    if fund_ret is None or bench_ret is None:
        return None
    if method == "division":
        denom = 1.0 + float(bench_ret)
        if denom == 0:
            return None
        return (1.0 + float(fund_ret)) / denom - 1.0
    return float(fund_ret) - float(bench_ret)


def calc_metrics(
    df: pd.DataFrame,
    period_begin: pd.Timestamp,
    period_end: pd.Timestamp,
    anchor: str = "prior",
    excess: str = "subtract",
) -> dict[str, Any]:
    nav = df.set_index("date")["nav"]
    b1 = df.set_index("date")["bench1"]
    b2 = df.set_index("date")["bench2"]
    fund = _holding_metrics(nav, period_begin, period_end, anchor)
    bench1 = _holding_metrics(b1, period_begin, period_end, anchor)
    bench2 = _holding_metrics(b2, period_begin, period_end, anchor)
    excess1 = _relative_return(fund["ret"], bench1["ret"], excess)
    excess2 = _relative_return(fund["ret"], bench2["ret"], excess)
    unit_end = df.loc[df["date"] <= period_end].iloc[-1]
    return {
        "fund": fund,
        "bench1": bench1,
        "bench2": bench2,
        "excess1": excess1,
        "excess2": excess2,
        "unit_nav": float(unit_end["unit_nav"]) if pd.notna(unit_end["unit_nav"]) else float(unit_end["nav"]),
        "cum_nav": float(unit_end["nav"]),
    }


def auto_commentary(
    product_label: str,
    period_begin: pd.Timestamp,
    period_end: pd.Timestamp,
    metrics: dict[str, Any],
    bench1_label: str,
    bench2_label: str,
    use_vol: bool = False,
    nav_unit: str = "净值日",
    show_bench1: bool = True,
) -> str:
    fund = metrics["fund"]
    days = int(fund["days"] or 0)
    n = int(fund["n"] or 0)
    ret = _fmt_pct(fund["ret"])
    ann = _fmt_pct(fund["ann_vol"], signed=False) if use_vol else _fmt_pct(fund["ann"])
    ann_label = "年化波动" if use_vol else "年化收益"
    mdd = _fmt_pct(fund["mdd"], signed=False)
    b1 = _fmt_pct(metrics["bench1"]["ret"])
    b2 = _fmt_pct(metrics["bench2"]["ret"])
    x1 = _fmt_pct(metrics["excess1"])
    x2 = _fmt_pct(metrics["excess2"])
    return "\n".join(
        [
            (
                f"本报告覆盖 {period_begin.year}年{period_begin.month}月{period_begin.day}日至"
                f"{period_end.year}年{period_end.month}月{period_end.day}日持有期"
                f"（约{days}个自然日、{n}个{nav_unit}）。"
            ),
            f"期内「{product_label}」区间收益 {ret}，{ann_label} {ann}，期间最大回撤 {mdd}。",
            (
                f"同期{bench1_label}区间收益 {b1}，{bench2_label}区间收益 {b2}。"
                if show_bench1
                else f"同期{bench2_label}区间收益 {b2}。"
            ),
            (
                f"产品相对{bench1_label}超额 {x1}，相对{bench2_label}超额 {x2}。"
                if show_bench1
                else f"产品相对{bench2_label}超额 {x2}。"
            ),
            "以上数据仅反映本持有期已实现净值表现，不构成对未来收益的承诺或投资建议。",
        ]
    )


def draw_section_bar(ax, y: float, title: str, fp_bold: FontProperties | None, width: float = 1.0) -> float:
    bar_h = 0.026
    ax.add_patch(
        Rectangle((0.04, y - bar_h), width - 0.08, bar_h, facecolor=C_NAVY, edgecolor="none", transform=ax.transAxes, zorder=2)
    )
    ax.plot([0.055, 0.055], [y - bar_h + 0.004, y - 0.004], color="white", lw=1.7, transform=ax.transAxes, zorder=3, solid_capstyle="round")
    ax.text(
        0.07,
        y - bar_h / 2,
        title,
        transform=ax.transAxes,
        va="center",
        ha="left",
        color="white",
        fontsize=9.5,
        fontproperties=fp_bold,
        zorder=3,
    )
    return y - bar_h - 0.012


def draw_overview_table(ax, y: float, overview: dict[str, str], fp: FontProperties | None, fp_bold: FontProperties | None) -> float:
    rows = [
        [("管理人", overview.get("manager", "--")), ("投资经理", overview.get("investment_manager", "--"))],
        [("托管人", overview.get("custodian", "--")), ("成立时间", overview.get("inception_date", "--"))],
        [("产品类型", overview.get("product_type", "--")), ("期末单位净值", overview.get("unit_nav", "--"))],
    ]
    row_h = 0.024
    col_w = [0.13, 0.33, 0.13, 0.33]
    x0 = 0.04
    for i, row in enumerate(rows):
        yy = y - (i + 1) * row_h
        xs = x0
        cells = [row[0][0], row[0][1], row[1][0], row[1][1]]
        for j, (text, w) in enumerate(zip(cells, col_w)):
            is_label = j % 2 == 0
            bg = "#EDF2F7" if is_label else (C_ROW if i % 2 == 0 else C_BG)
            ax.add_patch(Rectangle((xs, yy), w, row_h, facecolor=bg, edgecolor=C_BORDER, lw=0.55, transform=ax.transAxes, zorder=2))
            ax.text(
                xs + w / 2,
                yy + row_h / 2,
                text or "--",
                transform=ax.transAxes,
                ha="center",
                va="center",
                fontsize=8,
                color=C_MUTED if is_label else C_TEXT,
                fontproperties=fp_bold if is_label else fp,
                zorder=4,
            )
            xs += w
    return y - len(rows) * row_h - 0.016


def draw_kpi_row(
    ax,
    y: float,
    items: list[tuple[str, str, str]],
    fp: FontProperties | None,
    fp_bold: FontProperties | None,
    box_h: float = 0.072,
    gap_after: float = 0.016,
) -> float:
    gap = 0.012
    x0 = 0.04
    width = (0.92 - gap * 3) / 4
    for i, (label, value, hint) in enumerate(items):
        x = x0 + i * (width + gap)
        ax.add_patch(
            FancyBboxPatch(
                (x, y - box_h),
                width,
                box_h,
                boxstyle="round,pad=0.004,rounding_size=0.008",
                facecolor=C_KPI_BG,
                edgecolor=C_BORDER,
                lw=0.7,
                transform=ax.transAxes,
                zorder=2,
            )
        )
        ax.text(x + width / 2, y - 0.016, label, transform=ax.transAxes, ha="center", va="top", fontsize=7.4, color=C_MUTED, fontproperties=fp, zorder=3)
        ax.text(x + width / 2, y - 0.038, value, transform=ax.transAxes, ha="center", va="center", fontsize=13, color=C_NAVY, fontproperties=fp_bold, zorder=3)
        ax.text(x + width / 2, y - 0.058, hint, transform=ax.transAxes, ha="center", va="top", fontsize=6.6, color=C_GOLD if hint.startswith("+") else C_MUTED, fontproperties=fp, zorder=3)
    return y - box_h - gap_after


def draw_compare_table(
    ax,
    y: float,
    product_label: str,
    bench1_label: str,
    bench2_label: str,
    metrics: dict[str, Any],
    fp: FontProperties | None,
    fp_bold: FontProperties | None,
    use_vol: bool = False,
    show_bench1: bool = True,
) -> float:
    vol_name = "年化波动" if use_vol else "年化收益"
    fund_vol = _fmt_pct(metrics["fund"]["ann_vol"], signed=False) if use_vol else _fmt_pct(metrics["fund"]["ann"])
    bench2_vol = _fmt_pct(metrics["bench2"]["ann_vol"], signed=False) if use_vol else _fmt_pct(metrics["bench2"]["ann"])
    if show_bench1:
        bench1_vol = _fmt_pct(metrics["bench1"]["ann_vol"], signed=False) if use_vol else _fmt_pct(metrics["bench1"]["ann"])
        headers = ["指标", product_label, bench1_label, bench2_label, f"相对{bench1_label}", f"相对{bench2_label}"]
        rows = [
            ["区间收益", _fmt_pct(metrics["fund"]["ret"]), _fmt_pct(metrics["bench1"]["ret"]), _fmt_pct(metrics["bench2"]["ret"]), _fmt_pct(metrics["excess1"]), _fmt_pct(metrics["excess2"])],
            [vol_name, fund_vol, bench1_vol, bench2_vol, "--", "--"],
            ["最大回撤", _fmt_pct(metrics["fund"]["mdd"], signed=False), _fmt_pct(metrics["bench1"]["mdd"], signed=False), _fmt_pct(metrics["bench2"]["mdd"], signed=False), "--", "--"],
        ]
        widths = [0.12, 0.16, 0.16, 0.16, 0.16, 0.16]
    else:
        headers = ["指标", product_label, bench2_label, f"相对{bench2_label}"]
        rows = [
            ["区间收益", _fmt_pct(metrics["fund"]["ret"]), _fmt_pct(metrics["bench2"]["ret"]), _fmt_pct(metrics["excess2"])],
            [vol_name, fund_vol, bench2_vol, "--"],
            ["最大回撤", _fmt_pct(metrics["fund"]["mdd"], signed=False), _fmt_pct(metrics["bench2"]["mdd"], signed=False), "--"],
        ]
        widths = [0.18, 0.26, 0.24, 0.24]
    row_h = 0.022
    x0 = 0.04
    for r_i, row in enumerate([headers, *rows]):
        yy = y - (r_i + 1) * row_h
        xs = x0
        for j, (cell, w) in enumerate(zip(row, widths)):
            bg = C_NAVY if r_i == 0 else (C_ROW if r_i % 2 == 1 else C_BG)
            fg = "white" if r_i == 0 else C_TEXT
            ax.add_patch(Rectangle((xs, yy), w, row_h, facecolor=bg, edgecolor=C_BORDER, lw=0.45, transform=ax.transAxes, zorder=2))
            fontsize = 6.4 if (j > 0 and r_i == 0 and len(str(cell)) > 8) else 7.2
            ax.text(
                xs + w / 2,
                yy + row_h / 2,
                cell,
                transform=ax.transAxes,
                ha="center",
                va="center",
                fontsize=fontsize,
                color=fg,
                fontproperties=fp_bold if (r_i == 0 or j == 0) else fp,
                zorder=3,
                clip_on=True,
            )
            xs += w
    return y - (len(rows) + 1) * row_h - 0.014


def _period_kpis(metrics: dict[str, Any], bench_label: str, use_vol: bool, hint: str) -> list[tuple[str, str, str]]:
    vol_name = "年化波动" if use_vol else "年化收益"
    vol_value = _fmt_pct(metrics["fund"]["ann_vol"], signed=False) if use_vol else _fmt_pct(metrics["fund"]["ann"])
    vol_hint = "按周净值" if use_vol else f"{int(metrics['fund']['days'] or 0)}个自然日"
    return [
        ("区间收益", _fmt_pct(metrics["fund"]["ret"]), hint),
        (vol_name, vol_value, vol_hint),
        ("最大回撤", _fmt_pct(metrics["fund"]["mdd"], signed=False), hint),
        ("相对超额", _fmt_pct(metrics["excess2"]), f"相对{bench_label} {_fmt_pct(metrics['excess2'])}"),
    ]


def draw_dual_period_table(
    ax,
    y: float,
    product_label: str,
    bench_label: str,
    quarter: dict[str, Any],
    life: dict[str, Any],
    quarter_name: str,
    life_name: str,
    fp: FontProperties | None,
    fp_bold: FontProperties | None,
    use_vol: bool = False,
) -> float:
    vol_name = "年化波动" if use_vol else "年化收益"

    def block(name: str, metrics: dict[str, Any]) -> list[list[str]]:
        fund_vol = _fmt_pct(metrics["fund"]["ann_vol"], signed=False) if use_vol else _fmt_pct(metrics["fund"]["ann"])
        bench_vol = _fmt_pct(metrics["bench2"]["ann_vol"], signed=False) if use_vol else _fmt_pct(metrics["bench2"]["ann"])
        return [
            [name, "区间收益", _fmt_pct(metrics["fund"]["ret"]), _fmt_pct(metrics["bench2"]["ret"]), _fmt_pct(metrics["excess2"])],
            ["", vol_name, fund_vol, bench_vol, "--"],
            ["", "最大回撤", _fmt_pct(metrics["fund"]["mdd"], signed=False), _fmt_pct(metrics["bench2"]["mdd"], signed=False), "--"],
        ]

    headers = ["区间", "指标", product_label, bench_label, f"相对{bench_label}"]
    rows = block(quarter_name, quarter) + block(life_name, life)
    row_h = 0.0192
    widths = [0.13, 0.14, 0.22, 0.215, 0.215]
    x0 = 0.04
    for r_i, row in enumerate([headers, *rows]):
        yy = y - (r_i + 1) * row_h
        xs = x0
        for j, (cell, w) in enumerate(zip(row, widths)):
            bg = C_NAVY if r_i == 0 else (C_ROW if r_i % 2 == 1 else C_BG)
            fg = "white" if r_i == 0 else C_TEXT
            ax.add_patch(Rectangle((xs, yy), w, row_h, facecolor=bg, edgecolor=C_BORDER, lw=0.45, transform=ax.transAxes, zorder=2))
            ax.text(
                xs + w / 2,
                yy + row_h / 2,
                cell,
                transform=ax.transAxes,
                ha="center",
                va="center",
                fontsize=7.0,
                color=fg,
                fontproperties=fp_bold if (r_i == 0 or j <= 1) else fp,
                zorder=3,
                clip_on=True,
            )
            xs += w
    return y - (len(rows) + 1) * row_h - 0.010


def draw_period_columns_table(
    ax,
    y: float,
    bench_label: str,
    quarter: dict[str, Any],
    life: dict[str, Any],
    quarter_title: str,
    life_title: str,
    fp: FontProperties | None,
    fp_bold: FontProperties | None,
    use_vol: bool = False,
) -> float:
    """One table, periods in columns, so the chart keeps the vertical space."""
    vol_name = "年化波动" if use_vol else "年化收益"

    def vol(metrics: dict[str, Any], side: str) -> str:
        block = metrics[side]
        return _fmt_pct(block["ann_vol"], signed=False) if use_vol else _fmt_pct(block["ann"])

    rows = [
        ["区间收益", _fmt_pct(quarter["fund"]["ret"]), _fmt_pct(life["fund"]["ret"])],
        [vol_name, vol(quarter, "fund"), vol(life, "fund")],
        ["最大回撤", _fmt_pct(quarter["fund"]["mdd"], signed=False), _fmt_pct(life["fund"]["mdd"], signed=False)],
        [f"{bench_label}区间收益", _fmt_pct(quarter["bench2"]["ret"]), _fmt_pct(life["bench2"]["ret"])],
        [f"相对{bench_label}", _fmt_pct(quarter["excess2"]), _fmt_pct(life["excess2"])],
        [f"{bench_label}{vol_name}", vol(quarter, "bench2"), vol(life, "bench2")],
        [f"{bench_label}最大回撤", _fmt_pct(quarter["bench2"]["mdd"], signed=False), _fmt_pct(life["bench2"]["mdd"], signed=False)],
    ]
    headers = ["指标", quarter_title, life_title]
    header_h = 0.034
    row_h = 0.0205
    widths = [0.28, 0.32, 0.32]
    x0 = 0.04
    table = [headers, *rows]
    for r_i, row in enumerate(table):
        h = header_h if r_i == 0 else row_h
        yy = y - h
        xs = x0
        for j, (cell, w) in enumerate(zip(row, widths)):
            bg = C_NAVY if r_i == 0 else (C_ROW if r_i % 2 == 1 else C_BG)
            fg = "white" if r_i == 0 else C_TEXT
            ax.add_patch(Rectangle((xs, yy), w, h, facecolor=bg, edgecolor=C_BORDER, lw=0.45, transform=ax.transAxes, zorder=2))
            ax.text(
                xs + w / 2,
                yy + h / 2,
                cell,
                transform=ax.transAxes,
                ha="center",
                va="center",
                fontsize=7.3 if r_i else 7.6,
                color=fg,
                fontproperties=fp_bold if (r_i == 0 or j == 0) else fp,
                zorder=3,
                linespacing=1.15,
            )
            xs += w
        y = yy
    return y - 0.012


def draw_life_column_table(
    ax,
    y: float,
    product_label: str,
    bench_label: str,
    quarter: dict[str, Any],
    life: dict[str, Any],
    fp: FontProperties | None,
    fp_bold: FontProperties | None,
    use_vol: bool = False,
) -> float:
    """Same three rows as the quarter table, with a 成立以来 column beside each group."""
    vol_name = "年化波动" if use_vol else "年化收益"

    def vol(metrics: dict[str, Any], side: str) -> str:
        block = metrics[side]
        return _fmt_pct(block["ann_vol"], signed=False) if use_vol else _fmt_pct(block["ann"])

    groups = [product_label, bench_label, f"相对{bench_label}"]
    sub = ["本季度", "成立以来"]
    rows = [
        [
            "区间收益",
            _fmt_pct(quarter["fund"]["ret"]),
            _fmt_pct(life["fund"]["ret"]),
            _fmt_pct(quarter["bench2"]["ret"]),
            _fmt_pct(life["bench2"]["ret"]),
            _fmt_pct(quarter["excess2"]),
            _fmt_pct(life["excess2"]),
        ],
        [vol_name, vol(quarter, "fund"), vol(life, "fund"), vol(quarter, "bench2"), vol(life, "bench2"), "--", "--"],
        [
            "最大回撤",
            _fmt_pct(quarter["fund"]["mdd"], signed=False),
            _fmt_pct(life["fund"]["mdd"], signed=False),
            _fmt_pct(quarter["bench2"]["mdd"], signed=False),
            _fmt_pct(life["bench2"]["mdd"], signed=False),
            "--",
            "--",
        ],
    ]
    label_w = 0.13
    col_w = (0.92 - label_w) / 6
    widths = [label_w, *([col_w] * 6)]
    x0 = 0.04
    group_h = 0.018
    sub_h = 0.016
    row_h = 0.022
    header_bottom = y - group_h - sub_h
    ax.add_patch(Rectangle((x0, header_bottom), label_w, group_h + sub_h, facecolor=C_NAVY, edgecolor=C_BORDER, lw=0.45, transform=ax.transAxes, zorder=2))
    ax.text(x0 + label_w / 2, header_bottom + (group_h + sub_h) / 2, "指标", transform=ax.transAxes, ha="center", va="center", fontsize=7.0, color="white", fontproperties=fp_bold, zorder=3)
    yy = y - group_h
    xs = x0 + label_w
    for name in groups:
        ax.add_patch(Rectangle((xs, yy), col_w * 2, group_h, facecolor=C_NAVY, edgecolor=C_BORDER, lw=0.45, transform=ax.transAxes, zorder=2))
        ax.text(xs + col_w, yy + group_h / 2, name, transform=ax.transAxes, ha="center", va="center", fontsize=6.7, color="white", fontproperties=fp_bold, zorder=3)
        for j, label in enumerate(sub):
            ax.add_patch(Rectangle((xs + j * col_w, yy - sub_h), col_w, sub_h, facecolor=C_NAVY, edgecolor=C_BORDER, lw=0.45, transform=ax.transAxes, zorder=2))
            ax.text(xs + j * col_w + col_w / 2, yy - sub_h / 2, label, transform=ax.transAxes, ha="center", va="center", fontsize=6.3, color="white", fontproperties=fp, zorder=3)
        xs += col_w * 2
    y = yy - sub_h
    for r_i, row in enumerate(rows):
        yy = y - row_h
        xs = x0
        for j, (cell, w) in enumerate(zip(row, widths)):
            bg = C_ROW if r_i % 2 == 0 else C_BG
            ax.add_patch(Rectangle((xs, yy), w, row_h, facecolor=bg, edgecolor=C_BORDER, lw=0.45, transform=ax.transAxes, zorder=2))
            ax.text(
                xs + w / 2,
                yy + row_h / 2,
                cell,
                transform=ax.transAxes,
                ha="center",
                va="center",
                fontsize=6.7,
                color=C_TEXT,
                fontproperties=fp_bold if j == 0 else fp,
                zorder=3,
            )
            xs += w
        y = yy
    return y - 0.012


_WRAP_BREAK_AFTER = set("。！？；，、： ")
_NO_SPLIT_CHARS = set("0123456789+-.%")


def wrap_report_text(text: str, max_chars: int = 56) -> list[str]:
    """Wrap on sentence and clause breaks, and keep amounts such as +0.49% on one line."""
    lines: list[str] = []
    for para in (text or "").split("\n"):
        para = para.strip()
        if not para:
            continue
        start = 0
        while start < len(para):
            rest = para[start:]
            if len(rest) <= max_chars:
                lines.append(rest)
                break
            end = max_chars
            while end > 1 and rest[end - 1] in _NO_SPLIT_CHARS and end < len(rest) and rest[end] in _NO_SPLIT_CHARS:
                end -= 1
            if rest[end - 1] in "「『（(":
                end -= 1
            window = rest[:end]
            break_at = 0
            for i in range(len(window) - 1, 0, -1):
                if window[i - 1] in _WRAP_BREAK_AFTER and window[i] not in _NO_SPLIT_CHARS:
                    break_at = i
                    break
            if break_at <= 0:
                break_at = max(end, 1)
            piece = rest[:break_at].strip()
            if piece:
                lines.append(piece)
            start += break_at
            while start < len(para) and para[start] == " ":
                start += 1
    return lines


def draw_wrapped_text(ax, text: str, x: float, y: float, fp: FontProperties | None, fontsize: float = 8.0, line_h: float = 0.0165, max_chars: int = 56, max_lines: int = 6) -> float:
    content = (text or "").strip()
    if not content:
        return y
    lines = wrap_report_text(content, max_chars=max_chars)
    for i, line in enumerate(lines[:max_lines]):
        ax.text(x, y - i * line_h, line, transform=ax.transAxes, ha="left", va="top", fontsize=fontsize, color=C_TEXT, fontproperties=fp)
    return y - min(len(lines), max_lines) * line_h - 0.01


def quarter_title(period_begin: pd.Timestamp, period_end: pd.Timestamp, label: str) -> str:
    if label:
        return label
    if period_begin.month in (1, 4, 7, 10) and period_begin.day == 1:
        q = (period_begin.month - 1) // 3 + 1
        if period_end.month == period_begin.month + 2 or (period_begin.month == 10 and period_end.month == 12):
            return f"{period_begin.year}年 第{q}季度 投资报告"
    return f"{period_begin.year}年{period_begin.month}月–{period_end.year}年{period_end.month}月 持有期投资报告"


def build_report_figure(nav_df: pd.DataFrame, config: dict[str, Any]):
    fp, fp_bold = configure_cn_font()
    product_name = str(config.get("product_name") or "私募基金")
    short_name = _display_short_name(str(config.get("short_name") or ""), product_name)
    brand = str(config.get("brand_name") or "内部资料")
    watermark = str(config.get("watermark") or brand)
    period_end = pd.Timestamp(config["end_date"])
    period_begin = pd.Timestamp(config.get("period_begin") or config.get("month_begin") or period_end)
    bench1_label = str(config.get("bench1_label") or "上证指数")
    bench2_label = str(config.get("bench2_label") or "沪深300")
    overview = dict(config.get("overview") or {})
    user_note = str(config.get("commentary") or "").strip()
    report_heading = str(config.get("report_heading") or "")

    nav_df = nav_df[nav_df["date"] <= period_end].copy()
    if len(nav_df) < 2:
        raise ValueError("报告截止日期之前净值数据不足")
    nav_df = apply_nav_frequency(nav_df, str(config.get("nav_frequency") or "weekly"))

    anchor = "window" if config.get("metrics_match_product_page") else "prior"
    excess = "division" if config.get("metrics_match_product_page") else "subtract"
    metrics = calc_metrics(nav_df, period_begin, period_end, anchor, excess)
    overview.setdefault("unit_nav", _fmt_num(metrics["unit_nav"], 4))
    overview.setdefault("cum_nav", _fmt_num(metrics["cum_nav"], 4))
    overview["inception_date"] = overview.get("inception_date") or _fmt_date_cn(str(config.get("inception_date") or ""))

    fig = plt.figure(figsize=(8.27, 11.69), dpi=170, facecolor=C_BG)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    ax.text(0.5, 0.50, watermark, transform=ax.transAxes, ha="center", va="center", fontsize=40, color="#E2E8F0", alpha=0.45, rotation=28, fontproperties=fp_bold, zorder=0)

    ax.add_patch(Rectangle((0, 0.955), 1, 0.045, facecolor=C_NAVY, edgecolor="none", transform=ax.transAxes, zorder=1))
    ax.text(0.04, 0.978, "CONFIDENTIAL  ·  仅供指定机构投资者", transform=ax.transAxes, ha="left", va="center", fontsize=7.2, color="#E2E8F0", fontproperties=fp, zorder=2)
    ax.text(0.96, 0.978, brand, transform=ax.transAxes, ha="right", va="center", fontsize=8.5, color="white", fontproperties=fp_bold, zorder=2)
    ax.add_patch(Rectangle((0, 0.951), 1, 0.004, facecolor=C_RED, edgecolor="none", transform=ax.transAxes, zorder=1))

    title = quarter_title(period_begin, period_end, report_heading)
    ax.text(0.5, 0.932, product_name, transform=ax.transAxes, ha="center", va="top", fontsize=13.5, color=C_TEXT, fontproperties=fp_bold, zorder=2)
    ax.text(0.5, 0.908, title, transform=ax.transAxes, ha="center", va="top", fontsize=11.5, color=C_NAVY, fontproperties=fp_bold, zorder=2)
    ax.text(
        0.5,
        0.886,
        f"持有期  {_fmt_date_cn(str(period_begin.date()))}  至  {_fmt_date_cn(str(period_end.date()))}",
        transform=ax.transAxes,
        ha="center",
        va="top",
        fontsize=8.2,
        color=C_MUTED,
        fontproperties=fp,
        zorder=2,
    )

    y = 0.862
    y = draw_section_bar(ax, y, "一、产品概览", fp_bold)
    y = draw_overview_table(ax, y, overview, fp, fp_bold)

    use_vol = bool(config.get("ann_vol_instead_of_return"))
    show_bench1 = bool(config.get("show_bench1", True))
    life_metrics = None
    chart_start_preview = pd.Timestamp(config["chart_start"]) if config.get("chart_start") else period_begin
    if chart_start_preview > period_begin:
        chart_start_preview = period_begin
    if chart_start_preview < period_begin - pd.Timedelta(days=7):
        life_anchor = "window" if config.get("metrics_match_product_page") else "prior"
        life_excess = "division" if config.get("metrics_match_product_page") else "subtract"
        life_metrics = calc_metrics(nav_df, chart_start_preview, period_end, life_anchor, life_excess)
    y = draw_section_bar(ax, y, "二、本持有期核心指标", fp_bold)
    y = draw_kpi_row(
            ax,
            y,
            [
                ("区间收益", _fmt_pct(metrics["fund"]["ret"]), "本持有期"),
                ("年化波动" if use_vol else "年化收益", _fmt_pct(metrics["fund"]["ann_vol"], signed=False) if use_vol else _fmt_pct(metrics["fund"]["ann"]), "按周净值" if use_vol else f"{int(metrics['fund']['days'] or 0)}个自然日"),
                ("最大回撤", _fmt_pct(metrics["fund"]["mdd"], signed=False), "持有期内"),
                ("相对超额", _fmt_pct(metrics["excess2"]), f"相对{bench2_label} {_fmt_pct(metrics['excess2'])}"),
            ],
            fp,
            fp_bold,
        )

    chart_start = pd.Timestamp(config["chart_start"]) if config.get("chart_start") else period_begin
    if chart_start > period_begin:
        chart_start = period_begin
    show_full_life = chart_start < period_begin - pd.Timedelta(days=7)
    y = draw_section_bar(ax, y, "三、成立以来净值走势（期初=1）" if show_full_life else "三、净值走势（期初=1）", fp_bold)
    chart_h = 0.226 if life_metrics is not None and not show_bench1 else 0.24
    label_pad = 0.028
    chart_bottom = y - chart_h
    ax_nav = fig.add_axes([0.11, chart_bottom + label_pad, 0.78, chart_h - label_pad - 0.01])

    mask = (nav_df["date"] >= chart_start - pd.Timedelta(days=5)) & (nav_df["date"] <= period_end)
    plot_df = nav_df.loc[mask].copy()
    if len(plot_df) < 2:
        plot_df = nav_df.copy()
    base_row = plot_df[plot_df["date"] <= chart_start]
    base_nav = float(base_row["nav"].iloc[-1]) if len(base_row) else float(plot_df["nav"].iloc[0])
    if show_full_life:
        ax_nav.axvspan(period_begin, period_end, color=C_NAVY, alpha=0.10, zorder=0, lw=0)
        ax_nav.axvline(period_begin, color=C_NAVY, lw=0.7, alpha=0.45, zorder=1)
        ax_nav.text(
            period_begin + (period_end - period_begin) / 2,
            0.03,
            "本季度",
            transform=blended_transform_factory(ax_nav.transData, ax_nav.transAxes),
            ha="center",
            va="bottom",
            fontsize=7,
            color=C_NAVY,
            fontproperties=fp,
            zorder=4,
        )
    ax_nav.plot(plot_df["date"], plot_df["nav"] / base_nav, color=C_RED, lw=1.8, label=short_name, zorder=4)

    if show_bench1 and plot_df["bench1"].notna().sum() >= 2:
        b1 = plot_df.dropna(subset=["bench1"])
        b1_base_rows = b1[b1["date"] <= chart_start]
        b1_base = float(b1_base_rows["bench1"].iloc[-1]) if len(b1_base_rows) else float(b1["bench1"].iloc[0])
        if b1_base > 0:
            ax_nav.plot(b1["date"], b1["bench1"] / b1_base, color=C_GRAY, lw=1.15, label=bench1_label, zorder=2)
    if plot_df["bench2"].notna().sum() >= 2:
        b2 = plot_df.dropna(subset=["bench2"])
        b2_base_rows = b2[b2["date"] <= chart_start]
        b2_base = float(b2_base_rows["bench2"].iloc[-1]) if len(b2_base_rows) else float(b2["bench2"].iloc[0])
        if b2_base > 0:
            ax_nav.plot(b2["date"], b2["bench2"] / b2_base, color=C_BLUE, lw=1.25, label=bench2_label, zorder=3)

    ax_nav.axhline(1.0, color="#E2E8F0", lw=0.8, zorder=1)
    ax_nav.legend(loc="upper left", fontsize=7, frameon=True, framealpha=0.94, edgecolor="none", prop=fp)
    ax_nav.grid(True, color="#EDF2F7", lw=0.7)
    ax_nav.spines["top"].set_visible(False)
    ax_nav.spines["right"].set_visible(False)
    ax_nav.tick_params(axis="both", labelsize=6.5, colors=C_MUTED)
    ax_nav.set_xlim(plot_df["date"].iloc[0], plot_df["date"].iloc[-1])
    if (plot_df["date"].iloc[-1] - plot_df["date"].iloc[0]).days > 120:
        ax_nav.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
        ax_nav.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    else:
        ax_nav.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d"))
        ax_nav.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4, maxticks=7))
    for label in ax_nav.get_xticklabels() + ax_nav.get_yticklabels():
        if fp:
            label.set_fontproperties(fp)
    y = chart_bottom - 0.008

    y = draw_section_bar(ax, y, "四、与基准比较", fp_bold)
    if life_metrics is not None and not show_bench1:
        y = draw_life_column_table(
            ax, y, short_name, bench2_label, metrics, life_metrics, fp, fp_bold, use_vol=use_vol,
        )
    else:
        y = draw_compare_table(
            ax, y, short_name, bench1_label, bench2_label, metrics, fp, fp_bold, use_vol=use_vol, show_bench1=show_bench1,
        )

    y = draw_section_bar(ax, y, "五、简要说明", fp_bold)
    nav_unit = "周净值日" if str(config.get("nav_frequency") or "weekly") == "weekly" else "净值日"
    note = user_note or auto_commentary(
        short_name,
        period_begin,
        period_end,
        metrics,
        bench1_label,
        bench2_label,
        use_vol=use_vol,
        nav_unit=nav_unit,
        show_bench1=show_bench1,
    )
    y = draw_wrapped_text(ax, note, 0.05, y, fp, fontsize=8.0, max_chars=56, max_lines=5)

    ax.add_patch(Rectangle((0.04, 0.038), 0.92, 0.0008, facecolor=C_BORDER, edgecolor="none", transform=ax.transAxes, zorder=2))
    ax.text(
        0.5,
        0.028,
        "风险提示：本报告仅供持有本产品满三个月的机构投资者参考，不构成投资建议、要约或承诺。私募基金有投资风险，管理人过往业绩不预示未来表现。",
        transform=ax.transAxes,
        ha="center",
        va="top",
        fontsize=6.4,
        color=C_MUTED,
        fontproperties=fp,
        zorder=2,
    )
    ax.text(
        0.5,
        0.014,
        f"数据截止日 {_fmt_date_cn(str(period_end.date()))}  ·  净值已复权  ·  基准为{bench2_label if not show_bench1 else '同期价格指数'}",
        transform=ax.transAxes,
        ha="center",
        va="top",
        fontsize=6.2,
        color="#A0AEC0",
        fontproperties=fp,
        zorder=2,
    )

    return fig


def render_report(nav_df: pd.DataFrame, config: dict[str, Any], output_dir: Path) -> tuple[Path, Path]:
    fig = build_report_figure(nav_df, config)
    product_name = str(config.get("product_name") or "私募基金")
    short_name = _display_short_name(str(config.get("short_name") or ""), product_name)
    period_end = pd.Timestamp(config["end_date"])
    period_begin = pd.Timestamp(config.get("period_begin") or config.get("month_begin") or period_end)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = _safe_report_stem(
        f"{short_name}_{period_begin.year}年{period_begin.month}月{period_begin.day}日"
        f"至{period_end.year}年{period_end.month}月{period_end.day}日持有期季报"
    )
    png_path = output_dir / f"{stem}.png"
    pdf_path = output_dir / f"{stem}.pdf"
    fig.savefig(png_path, dpi=170, facecolor=C_BG, bbox_inches="tight", pad_inches=0.12)
    fig.savefig(pdf_path, dpi=170, facecolor=C_BG, bbox_inches="tight", pad_inches=0.12)
    plt.close(fig)
    return png_path, pdf_path


def main() -> int:
    parser = argparse.ArgumentParser(description="机构投资者持有期季报生成器")
    parser.add_argument("nav_csv", help="净值 CSV 路径")
    parser.add_argument("--config", required=True, help="config.json 路径")
    parser.add_argument("-o", "--output", required=True, help="输出目录")
    args = parser.parse_args()

    nav_path = Path(args.nav_csv)
    config_path = Path(args.config)
    output_dir = Path(args.output)
    if not nav_path.is_file():
        print(f"错误: 净值文件不存在: {nav_path}", file=sys.stderr)
        return 1
    if not config_path.is_file():
        print(f"错误: 配置文件不存在: {config_path}", file=sys.stderr)
        return 1

    try:
        config = json.loads(config_path.read_text(encoding="utf-8-sig"))
        nav_df = load_nav_csv(nav_path)
        png_path, pdf_path = render_report(nav_df, config, output_dir)
        print(f"OK png={png_path.name} pdf={pdf_path.name}")
        return 0
    except Exception as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
