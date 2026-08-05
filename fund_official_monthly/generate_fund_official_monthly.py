#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Single-fund official monthly investment report (Yingci-style layout).

Reads nav.csv + config.json, writes PNG + PDF.
"""

from __future__ import annotations

import argparse
import json
import os
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
from matplotlib.patches import Rectangle

C_NAVY = "#1A365D"
C_NAVY_MID = "#2C5282"
C_RED = "#C53030"
C_BLUE = "#3182CE"
C_TEXT = "#1A202C"
C_MUTED = "#718096"
C_BORDER = "#CBD5E1"
C_BG = "#FFFFFF"
C_ROW = "#F7FAFC"
C_BAR = "#2B6CB0"

RISK_FREE = 0.02
TRADING_DAYS = 252

_WORKSPACE = Path(__file__).resolve().parent
_FONTS_DIR = _WORKSPACE / "fonts"


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
        return f"{dt.year}.{dt.month}.{dt.day}"
    except Exception:
        return value


def _display_short_name(short_name: str, product_name: str) -> str:
    """Drop legal suffixes so legend/table labels stay compact."""
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
    bench_col = cols[5] if len(cols) > 5 else None
    out = pd.DataFrame()
    out["date"] = pd.to_datetime(df[date_col])
    out["unit_nav"] = pd.to_numeric(df[unit_col], errors="coerce") if unit_col else np.nan
    out["nav"] = pd.to_numeric(df[adj_col], errors="coerce") if adj_col else out["unit_nav"]
    out["nav"] = out["nav"].fillna(out["unit_nav"])
    if bench_col:
        out["bench"] = pd.to_numeric(df[bench_col], errors="coerce")
    else:
        out["bench"] = np.nan
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
    return float(dd.min()) if len(dd) else 0.0


def _sharpe(ann_ret: float, ann_vol: float) -> float:
    if ann_vol <= 0:
        return 0.0
    return (ann_ret - RISK_FREE) / ann_vol


def period_return(nav: pd.Series, start: pd.Timestamp, end: pd.Timestamp) -> float | None:
    sub = nav[(nav.index >= start) & (nav.index <= end)]
    if len(sub) < 1:
        return None
    before = nav[nav.index < start]
    base = before.iloc[-1] if len(before) else sub.iloc[0]
    return _total_return(float(base), float(sub.iloc[-1]))


def calc_metrics(df: pd.DataFrame, month_begin: pd.Timestamp, month_end: pd.Timestamp) -> dict[str, Any]:
    nav = df.set_index("date")["nav"]
    bench = df.set_index("date")["bench"]
    ret = nav.pct_change().dropna()
    days = max((nav.index[-1] - nav.index[0]).days, 1)
    total = _total_return(float(nav.iloc[0]), float(nav.iloc[-1]))
    ann = (1 + total) ** (365.0 / days) - 1 if days > 0 else 0.0
    vol = float(ret.std() * np.sqrt(TRADING_DAYS)) if len(ret) > 1 else 0.0
    mdd = _max_drawdown(nav)
    sharpe = _sharpe(ann, vol)

    month_ret = period_return(nav, month_begin, month_end)
    three_m_start = month_end - pd.DateOffset(months=3) + pd.Timedelta(days=1)
    ret_3m = period_return(nav, three_m_start, month_end)
    ytd_start = pd.Timestamp(f"{month_end.year}-01-01")
    ytd = period_return(nav, ytd_start, month_end)

    b_month = period_return(bench.dropna(), month_begin, month_end) if bench.notna().any() else None
    b_3m = period_return(bench.dropna(), three_m_start, month_end) if bench.notna().any() else None
    b_ytd = period_return(bench.dropna(), ytd_start, month_end) if bench.notna().any() else None
    b_total = None
    b_mdd = None
    b_sharpe = None
    if bench.notna().sum() >= 2:
        b = bench.dropna()
        b_total = _total_return(float(b.iloc[0]), float(b.iloc[-1]))
        b_mdd = _max_drawdown(b)
        b_ret = b.pct_change().dropna()
        b_days = max((b.index[-1] - b.index[0]).days, 1)
        b_ann = (1 + b_total) ** (365.0 / b_days) - 1
        b_vol = float(b_ret.std() * np.sqrt(TRADING_DAYS)) if len(b_ret) > 1 else 0.0
        b_sharpe = _sharpe(b_ann, b_vol)

    return {
        "month": month_ret,
        "ret_3m": ret_3m,
        "ytd": ytd,
        "inception": total,
        "mdd": mdd,
        "sharpe": sharpe,
        "b_month": b_month,
        "b_3m": b_3m,
        "b_ytd": b_ytd,
        "b_inception": b_total,
        "b_mdd": b_mdd,
        "b_sharpe": b_sharpe,
        "unit_nav": float(df["unit_nav"].iloc[-1]) if pd.notna(df["unit_nav"].iloc[-1]) else float(nav.iloc[-1]),
        "cum_nav": float(nav.iloc[-1]),
    }


def calc_monthly_matrix(df: pd.DataFrame) -> list[dict[str, Any]]:
    nav = df.set_index("date")["nav"]
    month_end = nav.resample("ME").last().dropna()
    monthly_ret = month_end.pct_change()
    if not month_end.empty:
        monthly_ret.iloc[0] = month_end.iloc[0] / nav.iloc[0] - 1
    by_year: dict[int, dict[int, float]] = {}
    for dt, ret in monthly_ret.items():
        by_year.setdefault(dt.year, {})[dt.month] = float(ret)
    rows = []
    for year in sorted(by_year):
        months = by_year[year]
        annual = 1.0
        cells = {}
        for m in range(1, 13):
            if m in months:
                cells[m] = months[m]
                annual *= 1 + months[m]
            else:
                cells[m] = None
        rows.append({"year": year, "months": cells, "annual": annual - 1 if any(v is not None for v in cells.values()) else None})
    return rows


def draw_section_bar(ax, y: float, title: str, fp_bold: FontProperties | None, width: float = 1.0) -> float:
    bar_h = 0.028
    ax.add_patch(Rectangle((0.035, y - bar_h), width - 0.07, bar_h, facecolor=C_NAVY, edgecolor="none", transform=ax.transAxes, zorder=2))
    ax.plot([0.05, 0.05], [y - bar_h + 0.005, y - 0.005], color="white", lw=1.6, transform=ax.transAxes, zorder=3, solid_capstyle="round")
    ax.text(0.065, y - bar_h / 2, title, transform=ax.transAxes, va="center", ha="left", color="white", fontsize=10, fontproperties=fp_bold, zorder=3)
    return y - bar_h - 0.012


def draw_overview_table(ax, y: float, overview: dict[str, str], fp: FontProperties | None, fp_bold: FontProperties | None) -> float:
    rows = [
        [("管理人", overview.get("manager", "--")), ("投资经理", overview.get("investment_manager", "--"))],
        [("托管人", overview.get("custodian", "--")), ("成立时间", overview.get("inception_date", "--"))],
        [("产品类型", overview.get("product_type", "--")), ("投资策略", overview.get("strategy", "--"))],
        [("期末单位净值", overview.get("unit_nav", "--")), ("期末累计单位净值", overview.get("cum_nav", "--"))],
    ]
    row_h = 0.026
    col_w = [0.12, 0.345, 0.12, 0.345]
    x0 = 0.035
    table_w = sum(col_w)
    for i, row in enumerate(rows):
        yy = y - (i + 1) * row_h
        bg = C_ROW if i % 2 == 0 else C_BG
        ax.add_patch(Rectangle((x0, yy), table_w, row_h, facecolor=bg, edgecolor=C_BORDER, lw=0.6, transform=ax.transAxes, zorder=2))
        xs = x0
        cells = [row[0][0], row[0][1], row[1][0], row[1][1]]
        for j, (text, w) in enumerate(zip(cells, col_w)):
            is_label = j % 2 == 0
            if is_label:
                ax.add_patch(Rectangle((xs, yy), w, row_h, facecolor="#EDF2F7", edgecolor=C_BORDER, lw=0.6, transform=ax.transAxes, zorder=3))
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
    return y - len(rows) * row_h - 0.014


def draw_wrapped_text(ax, text: str, x: float, y: float, width: float, fp: FontProperties | None, fontsize: float = 8.2, line_h: float = 0.018) -> float:
    content = (text or "").strip() or "暂无投资经理简介。"
    # Approximate wrap by character count for CJK
    max_chars = 48
    lines: list[str] = []
    buf = ""
    for ch in content:
        buf += ch
        if len(buf) >= max_chars or ch == "\n":
            lines.append(buf.replace("\n", "").strip())
            buf = ""
    if buf.strip():
        lines.append(buf.strip())
    for i, line in enumerate(lines[:5]):
        ax.text(x, y - i * line_h, line, transform=ax.transAxes, ha="left", va="top", fontsize=fontsize, color=C_TEXT, fontproperties=fp)
    return y - min(len(lines), 5) * line_h - 0.012


def draw_perf_basic(ax, y: float, metrics: dict[str, Any], product_label: str, bench_label: str, fp: FontProperties | None, fp_bold: FontProperties | None) -> float:
    headers = ["", "本月收益率", "近三月收益率", "今年以来收益率", "成立以来收益率", "成立以来最大回撤", "成立以来夏普比率"]
    fund_row = [
        product_label,
        _fmt_pct(metrics.get("month")),
        _fmt_pct(metrics.get("ret_3m")),
        _fmt_pct(metrics.get("ytd")),
        _fmt_pct(metrics.get("inception")),
        _fmt_pct(metrics.get("mdd"), signed=False),
        _fmt_num(metrics.get("sharpe"), 2),
    ]
    bench_row = [
        bench_label,
        _fmt_pct(metrics.get("b_month")),
        _fmt_pct(metrics.get("b_3m")),
        _fmt_pct(metrics.get("b_ytd")),
        _fmt_pct(metrics.get("b_inception")),
        _fmt_pct(metrics.get("b_mdd"), signed=False),
        _fmt_num(metrics.get("b_sharpe"), 2),
    ]
    ax.text(0.035, y, "业绩基本情况", transform=ax.transAxes, ha="left", va="top", fontsize=8.5, color=C_NAVY, fontproperties=fp_bold)
    y -= 0.018
    row_h = 0.02
    widths = [0.12, 0.12, 0.12, 0.13, 0.13, 0.145, 0.135]
    x0 = 0.035
    for r_i, row in enumerate([headers, fund_row, bench_row]):
        yy = y - (r_i + 1) * row_h
        xs = x0
        for j, (cell, w) in enumerate(zip(row, widths)):
            bg = C_NAVY if r_i == 0 else (C_ROW if r_i == 1 else C_BG)
            fg = "white" if r_i == 0 else C_TEXT
            ax.add_patch(Rectangle((xs, yy), w, row_h, facecolor=bg, edgecolor=C_BORDER, lw=0.5, transform=ax.transAxes, zorder=2))
            # First column may still be long — shrink font slightly to stay inside the cell.
            fontsize = 6.2 if (j == 0 and r_i > 0 and len(str(cell)) > 8) else 6.8
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
    return y - 3 * row_h - 0.012


def draw_monthly_matrix(ax, y: float, matrix: list[dict[str, Any]], fp: FontProperties | None, fp_bold: FontProperties | None) -> float:
    ax.text(0.035, y, "成立以来业绩情况", transform=ax.transAxes, ha="left", va="top", fontsize=8.5, color=C_NAVY, fontproperties=fp_bold)
    y -= 0.018
    headers = ["年份"] + [f"{m}月" for m in range(1, 13)] + ["年度累计"]
    row_h = 0.018
    widths = [0.055] + [0.065] * 12 + [0.085]
    x0 = 0.035
    # keep last 4 years max for space
    rows = matrix[-4:]
    for r_i, row in enumerate([None, *rows]):
        yy = y - (r_i + 1) * row_h
        xs = x0
        if r_i == 0:
            cells = headers
        else:
            assert row is not None
            cells = [str(row["year"])]
            for m in range(1, 13):
                cells.append(_fmt_pct(row["months"].get(m), signed=True) if row["months"].get(m) is not None else "")
            cells.append(_fmt_pct(row["annual"], signed=True) if row["annual"] is not None else "")
        for j, (cell, w) in enumerate(zip(cells, widths)):
            bg = C_NAVY if r_i == 0 else (C_ROW if r_i % 2 == 0 else C_BG)
            fg = "white" if r_i == 0 else C_TEXT
            ax.add_patch(Rectangle((xs, yy), w, row_h, facecolor=bg, edgecolor=C_BORDER, lw=0.4, transform=ax.transAxes, zorder=2))
            ax.text(xs + w / 2, yy + row_h / 2, cell, transform=ax.transAxes, ha="center", va="center", fontsize=6.2, color=fg, fontproperties=fp_bold if r_i == 0 or j == 0 else fp, zorder=3)
            xs += w
    return y - (len(rows) + 1) * row_h - 0.012


def draw_hbar_chart(ax_plot, items: list[dict[str, Any]], title: str, fp: FontProperties | None, fp_bold: FontProperties | None, color: str = C_BAR) -> None:
    ax_plot.set_title(title, fontsize=8.5, color=C_NAVY, fontproperties=fp_bold, loc="left", pad=4)
    if not items:
        ax_plot.text(0.5, 0.5, "暂无持仓数据", ha="center", va="center", fontsize=8, color=C_MUTED, fontproperties=fp, transform=ax_plot.transAxes)
        ax_plot.set_xticks([])
        ax_plot.set_yticks([])
        for spine in ax_plot.spines.values():
            spine.set_visible(False)
        return
    names = [_display_short_name("", str(i.get("name", "")))[:10] for i in items][::-1]
    pcts = [float(i.get("pct", 0) or 0) for i in items][::-1]
    y_pos = np.arange(len(names))
    ax_plot.barh(y_pos, pcts, color=color, height=0.55, zorder=2)
    ax_plot.set_yticks(y_pos)
    ax_plot.set_yticklabels(names, fontsize=6.5, fontproperties=fp)
    ax_plot.set_xlabel("%", fontsize=7, color=C_MUTED, fontproperties=fp)
    ax_plot.tick_params(axis="x", labelsize=6.5, colors=C_MUTED)
    ax_plot.tick_params(axis="y", length=0, pad=1)
    xmax = max(pcts) * 1.25 if pcts else 1
    ax_plot.set_xlim(0, max(xmax, 1))
    for yi, pct in zip(y_pos, pcts):
        ax_plot.text(pct + xmax * 0.02, yi, f"{pct:.2f}%", va="center", ha="left", fontsize=6.5, color=C_TEXT, fontproperties=fp)
    ax_plot.spines["top"].set_visible(False)
    ax_plot.spines["right"].set_visible(False)
    ax_plot.spines["left"].set_color(C_BORDER)
    ax_plot.spines["bottom"].set_color(C_BORDER)
    ax_plot.grid(axis="x", color="#EDF2F7", lw=0.6, zorder=1)


def render_report(nav_df: pd.DataFrame, config: dict[str, Any], output_dir: Path) -> tuple[Path, Path]:
    fp, fp_bold = configure_cn_font()
    product_name = str(config.get("product_name") or "私募基金")
    short_name = _display_short_name(str(config.get("short_name") or ""), product_name)
    brand = str(config.get("brand_name") or "内部资料")
    watermark = str(config.get("watermark") or brand)
    end_date = pd.Timestamp(config["end_date"])
    month_begin = pd.Timestamp(config.get("month_begin") or f"{end_date.year}-{end_date.month:02d}-01")
    bench_label = str(config.get("benchmark_label") or "沪深300")
    overview = dict(config.get("overview") or {})
    manager_bio = str(config.get("manager_bio") or "")
    asset_alloc = list(config.get("asset_allocation") or [])
    industry_alloc = list(config.get("industry_allocation") or [])
    industry_title = str(config.get("industry_title") or "前五大行业配置")

    nav_df = nav_df[nav_df["date"] <= end_date].copy()
    if len(nav_df) < 2:
        raise ValueError("报告截止日期之前净值数据不足")

    metrics = calc_metrics(nav_df, month_begin, end_date)
    overview.setdefault("unit_nav", _fmt_num(metrics["unit_nav"], 4))
    overview.setdefault("cum_nav", _fmt_num(metrics["cum_nav"], 4))
    overview["inception_date"] = overview.get("inception_date") or _fmt_date_cn(str(config.get("inception_date") or ""))
    matrix = calc_monthly_matrix(nav_df)

    fig = plt.figure(figsize=(8.27, 11.69), dpi=160, facecolor=C_BG)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    # watermark
    ax.text(0.5, 0.52, watermark, transform=ax.transAxes, ha="center", va="center", fontsize=42, color="#E2E8F0", alpha=0.55, rotation=28, fontproperties=fp_bold, zorder=0)

    # logo / brand top-right
    ax.text(0.965, 0.965, brand, transform=ax.transAxes, ha="right", va="top", fontsize=9, color=C_NAVY, fontproperties=fp_bold, zorder=2)
    logo_sub = str(config.get("logo_subtitle") or "")
    if logo_sub:
        ax.text(0.965, 0.948, logo_sub, transform=ax.transAxes, ha="right", va="top", fontsize=6.5, color=C_MUTED, fontproperties=fp, zorder=2)

    title = f"{product_name} {end_date.year} 年 {end_date.month} 月投资报告"
    ax.text(0.5, 0.955, title, transform=ax.transAxes, ha="center", va="top", fontsize=13.5, color=C_TEXT, fontproperties=fp_bold, zorder=2)

    y = 0.925
    y = draw_section_bar(ax, y, "产品概览", fp_bold)
    y = draw_overview_table(ax, y, overview, fp, fp_bold)

    y = draw_section_bar(ax, y, "主要投资经理简介", fp_bold)
    y = draw_wrapped_text(ax, manager_bio, 0.045, y, 0.91, fp)

    y = draw_section_bar(ax, y, "净值走势", fp_bold)

    # NAV chart inset — reserve bottom pad so x-axis dates don't collide with next section.
    chart_h = 0.185
    label_pad = 0.032
    chart_bottom = y - chart_h
    ax_nav = fig.add_axes([0.10, chart_bottom + label_pad, 0.80, chart_h - label_pad - 0.008])
    nav_indexed = nav_df["nav"] / nav_df["nav"].iloc[0]
    ax_nav.plot(nav_df["date"], nav_indexed, color=C_RED, lw=1.6, label=short_name, zorder=3)
    if nav_df["bench"].notna().sum() >= 2:
        bench_series = nav_df.dropna(subset=["bench"])
        bench_indexed = bench_series["bench"] / bench_series["bench"].iloc[0]
        ax_nav.plot(bench_series["date"], bench_indexed, color=C_BLUE, lw=1.3, label=bench_label, zorder=2)
    ax_nav.legend(loc="upper left", fontsize=7, frameon=False, prop=fp)
    ax_nav.grid(True, color="#EDF2F7", lw=0.7)
    ax_nav.spines["top"].set_visible(False)
    ax_nav.spines["right"].set_visible(False)
    ax_nav.tick_params(axis="both", labelsize=6.5, colors=C_MUTED)
    ax_nav.tick_params(axis="x", pad=2)
    ax_nav.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    ax_nav.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4, maxticks=7))
    for label in ax_nav.get_xticklabels() + ax_nav.get_yticklabels():
        if fp:
            label.set_fontproperties(fp)
    y = chart_bottom - 0.01

    y = draw_section_bar(ax, y, "业绩表现", fp_bold)
    y = draw_perf_basic(ax, y, metrics, short_name, bench_label, fp, fp_bold)
    y = draw_monthly_matrix(ax, y, matrix, fp, fp_bold)

    y = draw_section_bar(ax, y, "持仓结构", fp_bold)
    hold_h = min(0.16, max(0.12, y - 0.06))
    hold_bottom = y - hold_h
    # Leave a gap + room for short y-labels on the right chart.
    ax_left = fig.add_axes([0.10, hold_bottom + 0.015, 0.34, hold_h - 0.025])
    ax_right = fig.add_axes([0.58, hold_bottom + 0.015, 0.35, hold_h - 0.025])
    draw_hbar_chart(ax_left, asset_alloc[:6], "大类资产配置", fp, fp_bold, color=C_BAR)
    draw_hbar_chart(ax_right, industry_alloc[:5], industry_title, fp, fp_bold, color="#DD6B20")

    output_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{short_name}_{end_date.year}年{end_date.month}月投资报告".replace("/", "_")
    png_path = output_dir / f"{stem}.png"
    pdf_path = output_dir / f"{stem}.pdf"
    fig.savefig(png_path, dpi=160, facecolor=C_BG, bbox_inches="tight", pad_inches=0.15)
    fig.savefig(pdf_path, dpi=160, facecolor=C_BG, bbox_inches="tight", pad_inches=0.15)
    plt.close(fig)
    return png_path, pdf_path


def main() -> int:
    parser = argparse.ArgumentParser(description="单产品官方月报（投资报告版）生成器")
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
