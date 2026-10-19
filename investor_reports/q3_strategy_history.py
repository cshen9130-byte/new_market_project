# -*- coding: utf-8 -*-
"""Longer same-strategy history for the Q3 investor report.

Source: custom fund 380003 in market_dashboard_storage, benchmark IF
(the series the fund page labels 沪深300). Cut off at the report date.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from pathlib import Path

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import psycopg2
from matplotlib.patches import Rectangle
from matplotlib.transforms import blended_transform_factory

NAV_FILE = Path(r"d:\coding\market_dashboard_storage\custom_funds\nav\380003.json")
ENV_FILE = Path(r"d:\coding\market_website\.env.local")
CUTOFF = "2026-09-30"

C_NAVY = "#1A365D"
C_RED = "#C53030"
C_BLUE = "#2B6CB0"
C_TEXT = "#1A202C"
C_MUTED = "#718096"
C_BORDER = "#CBD5E1"
C_BG = "#FFFFFF"
C_ROW = "#F7FAFC"
C_NOTE_BG = "#F8FAFC"



def _weekly(points):
    """Last weekday of each Monday-start week. Same rule as the quarterly report."""
    buckets = {}
    for row in points:
        dt = datetime.fromisoformat(row[0])
        if dt.weekday() >= 5:
            continue
        monday = (dt - timedelta(days=dt.weekday())).date().isoformat()
        buckets[monday] = row
    sampled = [buckets[key] for key in sorted(buckets)]
    if len(sampled) < 2:
        raise RuntimeError("weekly nav series is too short")
    return sampled


def _pct(value: float) -> str:
    sign = "+" if value > 0 else ""
    return f"{sign}{value * 100:.2f}%"


def _plain_pct(value: float) -> str:
    return f"{value * 100:.2f}%"


def _ratio(value: float) -> str:
    return f"{value:.2f}"


def _periods_per_year(dates: list[datetime]) -> float:
    """Same bucket as the fund detail page: median gap picks 252/52/26/12/4."""
    if len(dates) < 2:
        return 52.0
    gaps = sorted((dates[i] - dates[i - 1]).days for i in range(1, len(dates)))
    median_gap = gaps[len(gaps) // 2] or 1
    if median_gap <= 2:
        return 252.0
    if median_gap <= 10:
        return 52.0
    if median_gap <= 20:
        return 26.0
    if median_gap <= 45:
        return 12.0
    return 4.0


def _sample_std(values: list[float]) -> float:
    count = len(values)
    if count < 2:
        return float("nan")
    mean = sum(values) / count
    return math.sqrt(sum((value - mean) ** 2 for value in values) / (count - 1))


def _risk_ratios(navs: list[float], dates: list[datetime], ann: float, max_dd: float) -> dict[str, float]:
    """Detail-page volatility: sample std × sqrt(periods per year). Sharpe and Sortino use Rf=2%."""
    rf = 0.02
    returns = [navs[i] / navs[i - 1] - 1 for i in range(1, len(navs)) if navs[i - 1] > 0]
    per_year = _periods_per_year(dates)
    ann_vol = _sample_std(returns) * math.sqrt(per_year)
    excess = ann - rf
    sharpe = excess / ann_vol if ann_vol > 0 else float("nan")
    drawdown = abs(max_dd)
    calmar = ann / drawdown if drawdown >= 1e-4 else float("nan")
    downside = [value for value in returns if value < 0]
    downside_risk = (
        math.sqrt(sum(value * value for value in downside) / len(downside)) * math.sqrt(per_year)
        if downside
        else 0.0
    )
    sortino = excess / downside_risk if downside_risk > 0 else float("nan")
    return {"ann_vol": ann_vol, "sharpe": sharpe, "calmar": calmar, "sortino": sortino}


def _mdd(values: list[float]) -> float:
    peak = values[0]
    worst = 0.0
    for value in values:
        if value > peak:
            peak = value
        dd = value / peak - 1
        if dd < worst:
            worst = dd
    return worst


def _db_url() -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError("DATABASE_URL missing")


def load_strategy_history(
    nav_file: Path | None = None,
    *,
    product_name: str = "金舆追风1号",
    inception: str = "2026年7月15日",
    brand: str = "上海金舆资产管理",
    watermark: str = "金舆",
) -> dict:
    raw = json.loads((nav_file or NAV_FILE).read_text(encoding="utf-8"))
    series = sorted(
        (row["nav_date"], float(row["unit_nav"]))
        for row in raw
        if row["nav_date"] <= CUTOFF
    )
    if len(series) < 2:
        raise RuntimeError("same-strategy nav series is empty")

    conn = psycopg2.connect(_db_url())
    cur = conn.cursor()
    cur.execute(
        """
        SELECT DISTINCT ON (trade_date) trade_date::text, close::float
        FROM raw_spot_daily
        WHERE symbol = 'IF'
          AND trade_date >= %s
          AND trade_date <= %s
          AND close IS NOT NULL
          AND close > 0
        ORDER BY trade_date ASC, fetched_at DESC
        """,
        (series[0][0], CUTOFF),
    )
    bench = cur.fetchall()
    conn.close()
    if len(bench) < 2:
        raise RuntimeError("沪深300 benchmark series is empty")

    last_b = None
    bi = 0
    points: list[tuple[str, float, float]] = []
    for day, nav in series:
        while bi < len(bench) and bench[bi][0] <= day:
            last_b = bench[bi][1]
            bi += 1
        if last_b is None:
            continue
        points.append((day, nav, last_b))

    points = _weekly(points)

    start_nav = points[0][1]
    end_nav = points[-1][1]
    start_b = points[0][2]
    end_b = points[-1][2]
    d0 = datetime.fromisoformat(points[0][0])
    d1 = datetime.fromisoformat(points[-1][0])
    days = (d1 - d0).days
    total = end_nav / start_nav - 1
    bench_total = end_b / start_b - 1
    ann = (1 + total) ** (365 / days) - 1
    bench_ann = (1 + bench_total) ** (365 / days) - 1
    mdd = _mdd([row[1] for row in points])
    risk = _risk_ratios(
        [row[1] for row in points],
        [datetime.fromisoformat(row[0]) for row in points],
        ann,
        mdd,
    )

    years = _year_rows(points)

    return {
        "product_name": product_name,
        "inception": inception,
        "brand": brand,
        "watermark": watermark,
        "points": points,
        "start": points[0][0],
        "end": points[-1][0],
        "n": len(points),
        "days": days,
        "start_nav": start_nav,
        "end_nav": end_nav,
        "total": total,
        "ann": ann,
        "mdd": mdd,
        "ann_vol": risk["ann_vol"],
        "sharpe": risk["sharpe"],
        "calmar": risk["calmar"],
        "sortino": risk["sortino"],
        "bench_total": bench_total,
        "bench_ann": bench_ann,
        "bench_mdd": _mdd([row[2] for row in points]),
        "years": years,
    }


def _cn_date(iso: str) -> str:
    day = datetime.fromisoformat(iso[:10])
    return f"{day.year}年{day.month}月{day.day}日"


def _last_on_or_before(points, day: str):
    prev = points[0]
    for row in points:
        if row[0] <= day:
            prev = row
        else:
            break
    return prev


def _year_rows(points) -> list[dict]:
    start = datetime.fromisoformat(points[0][0])
    end = datetime.fromisoformat(points[-1][0])
    built = []
    for year in range(start.year, end.year):
        year_end = _last_on_or_before(points, f"{year}-12-31")
        base = points[0] if year == start.year else _last_on_or_before(points, f"{year - 1}-12-31")
        if base[0] >= year_end[0]:
            continue
        built.append((f"{year}年", base, year_end))
    base = _last_on_or_before(points, f"{end.year - 1}-12-31")
    if base[0] < points[0][0]:
        base = points[0]
    cutoff = datetime.fromisoformat(CUTOFF)
    if end.month == 12 and end.day == 31:
        end_label = f"{end.year}年"
    elif abs((cutoff - end).days) <= 10:
        end_label = f"{cutoff.year}年至{cutoff.month}月{cutoff.day}日"
    else:
        end_label = f"{end.year}年至{end.month}月{end.day}日"
    built.append((end_label, base, points[-1]))
    built.append((f"{points[0][0]}起", points[0], points[-1]))
    rows = []
    for label, a, b in built:
        rows.append({"label": label, "fund": b[1] / a[1] - 1, "bench": b[2] / a[2] - 1})
    return rows


def _header(ax, font, font_bold, brand: str):
    ax.add_patch(Rectangle((0, 0.958), 1, 0.042, facecolor=C_NAVY, edgecolor="none", transform=ax.transAxes, zorder=1))
    ax.text(0.046, 0.979, "CONFIDENTIAL    ·    仅供指定机构投资者", transform=ax.transAxes, ha="left", va="center", fontsize=7.4, color="#E2E8F0", fontproperties=font, zorder=2)
    ax.text(0.954, 0.979, brand, transform=ax.transAxes, ha="right", va="center", fontsize=8.6, color="white", fontproperties=font_bold, zorder=2)
    ax.add_patch(Rectangle((0, 0.954), 1, 0.004, facecolor=C_RED, edgecolor="none", transform=ax.transAxes, zorder=1))


def _section(ax, y, title, font_bold) -> float:
    bar_h = 0.0245
    ax.add_patch(Rectangle((0.046, y - bar_h), 0.908, bar_h, facecolor=C_NAVY, edgecolor="none", transform=ax.transAxes, zorder=2))
    ax.plot([0.059, 0.059], [y - bar_h + 0.005, y - 0.005], color="white", lw=1.6, transform=ax.transAxes, zorder=3, solid_capstyle="round")
    ax.text(0.074, y - bar_h / 2, title, transform=ax.transAxes, va="center", ha="left", color="white", fontsize=9.3, fontproperties=font_bold, zorder=3)
    return y - bar_h - 0.012


def _kpi_row(ax, y, items, font, font_bold) -> float:
    box_h = 0.064
    gap = 0.012
    width = (0.908 - gap * 3) / 4
    x0 = 0.046
    for i, (label, value, hint) in enumerate(items):
        x = x0 + i * (width + gap)
        ax.add_patch(Rectangle((x, y - box_h), width, box_h, facecolor="#F8FAFC", edgecolor=C_BORDER, lw=0.7, transform=ax.transAxes, zorder=2))
        ax.text(x + width / 2, y - 0.015, label, transform=ax.transAxes, ha="center", va="top", fontsize=7.2, color=C_MUTED, fontproperties=font, zorder=3)
        ax.text(x + width / 2, y - 0.036, value, transform=ax.transAxes, ha="center", va="center", fontsize=11.4, color=C_NAVY, fontproperties=font_bold, zorder=3)
        ax.text(x + width / 2, y - 0.052, hint, transform=ax.transAxes, ha="center", va="top", fontsize=6.3, color=C_MUTED, fontproperties=font, zorder=3)
    return y - box_h


def render_history_page(font, font_bold, history: dict, page_label: str = "第 3 页 / 共 3 页"):
    fig = plt.figure(figsize=(8.27, 11.69), dpi=150, facecolor=C_BG)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.text(0.68, 0.55, history.get("watermark", "金舆"), transform=ax.transAxes, ha="center", va="center", fontsize=52, color="#E7EDF4", rotation=28, fontproperties=font_bold, zorder=0)
    _header(ax, font, font_bold, history.get("brand", "上海金舆资产管理"))

    ax.text(0.5, 0.936, "同策略历史业绩", transform=ax.transAxes, ha="center", va="top", fontsize=15.2, color=C_TEXT, fontproperties=font_bold, zorder=2)
    ax.text(0.5, 0.910, "策略过往表现", transform=ax.transAxes, ha="center", va="top", fontsize=12.2, color=C_NAVY, fontproperties=font_bold, zorder=2)
    ax.text(
        0.5, 0.886,
        f"{_cn_date(history['start'])}    至    {_cn_date(history['end'])}",
        transform=ax.transAxes, ha="center", va="top", fontsize=8.6, color=C_MUTED, fontproperties=font, zorder=2,
    )
    intro_lines = [
        f"{history.get('product_name', '本产品')}于{history.get('inception', '')}成立。本页补充同一策略自{_cn_date(history['start'])}起的历史净值，供了解策略过往表现。",
    ]
    for i, line in enumerate(intro_lines):
        ax.text(0.058, 0.862 - i * 0.0172, line, transform=ax.transAxes, ha="left", va="top", fontsize=8.3, color=C_TEXT, fontproperties=font, zorder=4)

    y = _section(ax, 0.838, "一、区间业绩", font_bold)
    y = _kpi_row(
        ax, y,
        [
            ("累计收益", _pct(history["total"]), f"自{history['start']}"),
            ("年化收益", _pct(history["ann"]), f"{history['days']}个自然日"),
            ("最大回撤", _pct(history["mdd"]), "区间内"),
            ("期末单位净值", f"{history['end_nav']:.4f}", history["end"]),
        ],
        font, font_bold,
    )
    y -= 0.008
    y = _kpi_row(
        ax, y,
        [
            ("年化波动率", _plain_pct(history["ann_vol"]), "按周净值"),
            ("夏普比率", _ratio(history["sharpe"]), "Rf=2.00%"),
            ("卡玛比率", _ratio(history["calmar"]), "年化收益 / 最大回撤"),
            ("索提诺比率", _ratio(history["sortino"]), "Rf=2.00%"),
        ],
        font, font_bold,
    )
    y -= 0.012

    y = _section(ax, y, "二、累计收益走势（起点 = 0）", font_bold)
    many_years = len(history["years"]) > 5
    row_h = 0.0195 if many_years else 0.026
    if many_years:
        note_h_est = 0.016 + 2 * 0.016
        chart_bottom = 0.064 + note_h_est + 0.014 + (1 + len(history["years"])) * row_h + 0.0365 + 0.026
    else:
        chart_bottom = 0.348
    chart_h = y - chart_bottom - 0.02
    ax_chart = fig.add_axes([0.10, chart_bottom, 0.82, chart_h])
    n0 = history["points"][0][1]
    b0 = history["points"][0][2]
    dates = [datetime.fromisoformat(row[0]) for row in history["points"]]
    fund = [(row[1] / n0 - 1) * 100 for row in history["points"]]
    bench = [(row[2] / b0 - 1) * 100 for row in history["points"]]
    season_start = datetime(2026, 7, 1)
    season_end = datetime(2026, 9, 30)
    ax_chart.axvspan(season_start, season_end, color=C_NAVY, alpha=0.10, zorder=0, lw=0)
    ax_chart.axvline(season_start, color=C_NAVY, lw=0.7, alpha=0.45, zorder=1)
    ax_chart.plot(dates, fund, color=C_RED, lw=1.7, label="同策略", zorder=3)
    ax_chart.plot(dates, bench, color=C_BLUE, lw=1.15, label="沪深300", zorder=2)
    ax_chart.axhline(0, color="#E2E8F0", lw=0.8, zorder=1)
    ax_chart.text(
        season_start + (season_end - season_start) / 2,
        0.03,
        "本季度",
        transform=blended_transform_factory(ax_chart.transData, ax_chart.transAxes),
        ha="center",
        va="bottom",
        fontsize=7,
        color=C_NAVY,
        fontproperties=font,
        zorder=4,
    )
    ax_chart.legend(loc="upper left", frameon=False, prop=font, fontsize=8)
    ax_chart.grid(True, color="#EDF2F7", lw=0.6)
    ax_chart.spines["top"].set_visible(False)
    ax_chart.spines["right"].set_visible(False)
    ax_chart.tick_params(axis="both", labelsize=7, colors=C_MUTED)
    ax_chart.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _p: f"{v:.0f}%"))
    ax_chart.set_xlim(dates[0], dates[-1])
    span_days = (dates[-1] - dates[0]).days
    if span_days > 1400:
        ax_chart.xaxis.set_major_locator(mdates.YearLocator())
        ax_chart.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
    else:
        ax_chart.xaxis.set_major_locator(mdates.MonthLocator(interval=4))
        ax_chart.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    for label in ax_chart.get_xticklabels() + ax_chart.get_yticklabels():
        label.set_fontproperties(font)
    fig.canvas.draw()

    y = chart_bottom - 0.030
    y = _section(ax, y, "三、分年收益", font_bold)
    headers = ["区间", "同策略", "沪深300"]
    col_w = [0.36, 0.274, 0.274]
    yy = y - row_h
    xs = 0.046
    for title, w in zip(headers, col_w):
        ax.add_patch(Rectangle((xs, yy), w, row_h, facecolor=C_NAVY, edgecolor="#163055", lw=0.4, transform=ax.transAxes, zorder=2))
        ax.text(xs + w / 2, yy + row_h / 2, title, transform=ax.transAxes, ha="center", va="center", fontsize=8, color="white", fontproperties=font_bold, zorder=3)
        xs += w
    for i, row in enumerate(history["years"]):
        yy -= row_h
        vals = [row["label"], _pct(row["fund"]), _pct(row["bench"])]
        xs = 0.046
        last = i == len(history["years"]) - 1
        for j, (cell, w) in enumerate(zip(vals, col_w)):
            if last:
                bg = "#E8EEF6"
            else:
                bg = "#EDF2F7" if j == 0 else (C_BG if i % 2 == 0 else C_ROW)
            ax.add_patch(Rectangle((xs, yy), w, row_h, facecolor=bg, edgecolor=C_BORDER, lw=0.45, transform=ax.transAxes, zorder=2))
            ax.text(
                xs + w / 2, yy + row_h / 2, cell,
                transform=ax.transAxes, ha="center", va="center", fontsize=8,
                color=C_NAVY if last else C_TEXT,
                fontproperties=font_bold if last or j == 0 else font, zorder=3,
            )
            xs += w
    y = yy - 0.014
    note_lines = [
        "\u51c0\u503c\u6309\u5468\u53d6\u6837\uff0c\u6bcf\u5468\u53d6\u6700\u540e\u4e00\u4e2a\u4ea4\u6613\u65e5\u3002\u5206\u5e74\u6536\u76ca\u6309\u5404\u5e74\u672b\u6700\u540e\u4e00\u4e2a\u5468\u51c0\u503c\u8ba1\u7b97\u3002",
        "\u57fa\u51c6\u4e3a\u6caa\u6df1300\u540c\u671f\u4ef7\u683c\u6307\u6570\u3002\u590f\u666e\u6bd4\u7387\u3001\u7d22\u63d0\u8bfa\u6bd4\u7387\u6309\u65e0\u98ce\u9669\u5229\u73872%\u8ba1\u7b97\u3002",
    ]
    note_h = 0.016 + len(note_lines) * 0.016
    ax.add_patch(Rectangle((0.046, y - note_h), 0.908, note_h, facecolor=C_NOTE_BG, edgecolor=C_BORDER, lw=0.6, transform=ax.transAxes, zorder=2))
    ax.add_patch(Rectangle((0.046, y - note_h), 0.005, note_h, facecolor=C_NAVY, edgecolor="none", transform=ax.transAxes, zorder=3))
    ny = y - 0.010
    for line in note_lines:
        ax.text(0.062, ny, line, transform=ax.transAxes, ha="left", va="top", fontsize=7.2, color="#2D3748", fontproperties=font, zorder=4)
        ny -= 0.016

    ax.add_patch(Rectangle((0.046, 0.052), 0.908, 0.0008, facecolor=C_BORDER, edgecolor="none", transform=ax.transAxes, zorder=2))
    ax.text(
        0.5, 0.040,
        "风险提示：历史净值不构成投资建议。私募基金有投资风险，过往业绩不预示未来表现。",
        transform=ax.transAxes, ha="center", va="top", fontsize=6.4, color=C_MUTED, fontproperties=font, zorder=4,
    )
    ax.text(
        0.5, 0.024,
        f"数据截止日  2026年9月30日      ·      {history['n']}个周净值      ·      基准为沪深300      ·      {page_label}",
        transform=ax.transAxes, ha="center", va="top", fontsize=6.3, color="#A0AEC0", fontproperties=font, zorder=4,
    )
    return fig
