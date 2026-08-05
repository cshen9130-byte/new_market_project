#!/usr/bin/env python3
"""
低波稳健FOF 1号 产品周报生成器（单文件版）

从一份净值文件（CSV 或 Excel）生成手机浏览与 PDF 打印适用的单页周报（PNG + PDF）。
可独立复制到其他项目使用，依赖见 requirements.txt。

用法:
    python generate_fof_weekly_report.py 衡颐海泰1号_团队净值_2026-06-30.csv
    python generate_fof_weekly_report.py nav.xlsx -o ./output
"""

from __future__ import annotations

import argparse
import glob
import os
import sys
from pathlib import Path

import matplotlib

# Headless/server render — must be set before pyplot import.
matplotlib.use("Agg")

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.font_manager import FontProperties, fontManager
from matplotlib.patches import FancyBboxPatch, Polygon as MplPolygon, Rectangle, Wedge, Circle
from matplotlib.lines import Line2D

# ── 配色（中国基金惯例：红涨绿跌，融入高端金色与深红） ──────────────────────────
C_PRIMARY = "#8C1D1D"
C_PRIMARY_DARK = "#5C0A0A"
C_ACCENT = "#D32F2F"
C_GOLD = "#C5A059"
C_UP = "#E53935"
C_DOWN = "#2E7D32"
C_BG = "#F8FAFC"
C_CARD = "#FFFFFF"
C_GRAY = "#F1F5F9"
C_TEXT = "#1E293B"
C_TEXT_LIGHT = "#64748B"
C_BORDER = "#E2E8F0"

PRODUCT_NAME = "海泰1号"
REPORT_TITLE = "低波稳健FOF 1号"
PRODUCT_TAGLINE = "低波动 · 稳健运作 · 强势股策略"

REPORT_KIND_LABELS: dict[str, dict[str, str]] = {
    "weekly": {
        "kind_name": "产品周报",
        "period_name": "本周",
        "period_return": "本周收益",
        "period_broadcast": "本周业绩播报",
        "period_range_label": "本周区间",
        "period_highlights": "本周要点",
        "file_suffix": "周报",
    },
    "monthly": {
        "kind_name": "产品月报",
        "period_name": "本月",
        "period_return": "本月收益",
        "period_broadcast": "本月业绩播报",
        "period_range_label": "本月区间",
        "period_highlights": "本月要点",
        "file_suffix": "月报",
    },
}


def normalize_report_kind(kind: str | None) -> str:
    normalized = (kind or "weekly").strip().lower()
    return normalized if normalized in REPORT_KIND_LABELS else "weekly"


def normalize_report_layout(layout: str | None, report_kind: str | None = "weekly") -> str:
    normalized = (layout or "").strip().lower()
    if normalized in ("curve", "review"):
        return normalized
    return "review" if normalize_report_kind(report_kind) == "monthly" else "curve"


# Monthly report palette — landscape investor-letter style (distinct from weekly red portrait card)
M_NAVY = "#1A365D"
M_NAVY_MID = "#2C5282"
M_GOLD = "#C9A227"
M_GOLD_PALE = "#F0E6C8"
M_BG_MONTHLY = "#EEF2F7"
M_PANEL = "#FFFFFF"
M_BORDER_M = "#CBD5E1"

# Non-weekend A-share market holidays (SSE/SZSE closed). Keep local — never fetch via akshare.
# Cover the typical report window for this product (2023–2027).
_CN_MARKET_HOLIDAYS = frozenset(
    {
        # 2023
        "2023-01-02",
        "2023-01-23", "2023-01-24", "2023-01-25", "2023-01-26", "2023-01-27",
        "2023-04-05",
        "2023-05-01", "2023-05-02", "2023-05-03",
        "2023-06-22", "2023-06-23",
        "2023-09-29",
        "2023-10-02", "2023-10-03", "2023-10-04", "2023-10-05", "2023-10-06",
        # 2024
        "2024-01-01",
        "2024-02-09", "2024-02-12", "2024-02-13", "2024-02-14", "2024-02-15", "2024-02-16",
        "2024-04-04", "2024-04-05",
        "2024-05-01", "2024-05-02", "2024-05-03",
        "2024-06-10",
        "2024-09-16", "2024-09-17",
        "2024-10-01", "2024-10-02", "2024-10-03", "2024-10-04", "2024-10-07",
        # 2025
        "2025-01-01",
        "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31", "2025-02-03", "2025-02-04",
        "2025-04-04",
        "2025-05-01", "2025-05-02", "2025-05-05",
        "2025-05-31",
        "2025-10-01", "2025-10-02", "2025-10-03", "2025-10-06", "2025-10-07", "2025-10-08",
        # 2026
        "2026-01-01", "2026-01-02",
        "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-23",
        "2026-04-06",
        "2026-05-01", "2026-05-04", "2026-05-05",
        "2026-06-19",
        "2026-09-25",
        "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07",
        # 2027 (partial / expected)
        "2027-01-01",
    }
)


def count_cn_trading_days(start: pd.Timestamp, end: pd.Timestamp) -> int:
    """统计首尾日期之间（含首尾）的 A 股交易日数量（本地日历，不访问网络）。"""
    start = pd.Timestamp(start).normalize()
    end = pd.Timestamp(end).normalize()
    if end < start:
        return 0
    days = pd.bdate_range(start, end)
    return int(sum(d.strftime("%Y-%m-%d") not in _CN_MARKET_HOLIDAYS for d in days))


def _parse_pct(val) -> float:
    if pd.isna(val) or str(val).strip() in ("--", ""):
        return np.nan
    return float(str(val).replace("%", "").strip()) / 100


def _fill_csi300_from_akshare(df: pd.DataFrame) -> pd.DataFrame:
    """用 akshare 补齐缺失的沪深300收盘价（仅在本地数据完全缺失时作为最后手段）。"""
    missing = df["csi300"].isna()
    if not missing.any():
        return df

    # Allow ops to force offline generation (akshare remote calls often hang).
    if os.environ.get("FOF_REPORT_DISABLE_AKSHARE", "").strip() in ("1", "true", "yes"):
        return df

    try:
        import akshare as ak
    except ImportError:
        return df

    try:
        index_df = ak.stock_zh_index_daily(symbol="sh000300")
    except Exception as exc:  # noqa: BLE001 — network/source failures should not hang the report
        print(f"[warn] akshare 补齐沪深300失败: {exc}", file=sys.stderr)
        return df

    index_df["date"] = pd.to_datetime(index_df["date"])
    bench_map = index_df.set_index("date")["close"]

    out = df.copy()
    for idx in out.index[missing]:
        date = out.at[idx, "date"]
        if date in bench_map.index:
            out.at[idx, "csi300"] = float(bench_map.loc[date])
    return out


def load_nav_data(file_path: str) -> pd.DataFrame:
    """加载净值文件，自动补齐沪深300并推导日收益率。"""
    if file_path.lower().endswith(".csv"):
        raw = pd.read_csv(file_path)
        col_map = {
            raw.columns[0]: "date",
            raw.columns[1]: "unit_nav",
            raw.columns[2]: "cum_nav",
            raw.columns[3]: "adj_nav",
            raw.columns[4]: "pct_chg",
        }
        if len(raw.columns) > 5:
            col_map[raw.columns[5]] = "csi300"
        df = raw.rename(columns=col_map)
    else:
        df = pd.read_excel(file_path)
        col_map = {
            df.columns[0]: "date",
            df.columns[1]: "unit_nav",
            df.columns[2]: "cum_nav",
            df.columns[3]: "adj_nav",
            df.columns[4]: "pct_chg",
        }
        if len(df.columns) > 5:
            col_map[df.columns[5]] = "csi300"
        df = df.rename(columns=col_map)

    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)

    if "csi300" not in df.columns:
        df["csi300"] = np.nan

    # Node already injects benchmark prices into the CSV. Prefer local fill/ffill —
    # never block report generation on a remote akshare download for a few gaps.
    df["csi300"] = pd.to_numeric(df["csi300"], errors="coerce")
    df["csi300"] = df["csi300"].ffill().bfill()
    if df["csi300"].isna().all():
        df = _fill_csi300_from_akshare(df)
        df["csi300"] = df["csi300"].ffill().bfill()

    still_missing = df["csi300"].isna()
    if still_missing.any():
        missing_dates = df.loc[still_missing, "date"].dt.strftime("%Y-%m-%d").tolist()
        raise ValueError(f"无法补齐沪深300数据: {missing_dates[:5]}{'...' if len(missing_dates) > 5 else ''}")

    df["daily_ret"] = df["pct_chg"].apply(_parse_pct)
    df["daily_ret"] = df["daily_ret"].fillna(df["adj_nav"].pct_change())
    return df


# Retained for reference; the Sharpe display uses annualized return / volatility
# (no risk-free subtraction) to match the historical reports.
RISK_FREE_RATE = 0.02


def normalize_nav_frequency(freq: str | None) -> str:
    normalized = (freq or "weekly").strip().lower()
    if normalized in ("daily", "weekly", "monthly"):
        return normalized
    return "weekly"


def periods_per_year_for_frequency(freq: str | None) -> int:
    normalized = normalize_nav_frequency(freq)
    if normalized == "daily":
        return 252
    if normalized == "monthly":
        return 12
    return 52


def apply_nav_frequency(df: pd.DataFrame, freq: str | None) -> pd.DataFrame:
    """Resample NAV series to the requested frequency before metrics/charting."""
    normalized = normalize_nav_frequency(freq)
    if normalized == "daily":
        return df

    work = df.sort_values("date").set_index("date")
    rule = "W-FRI" if normalized == "weekly" else "ME"
    resampled = work.resample(rule).last()
    resampled = resampled.dropna(subset=["adj_nav"]).reset_index()

    # Clamp period-end labels to the actual last data date so that a partial
    # week/month (e.g. data ending on a Wednesday) is not labeled with the
    # upcoming Friday/month-end, which would otherwise be excluded when the
    # caller filters with `date <= as_of`.
    max_actual_date = df["date"].max()
    resampled["date"] = resampled["date"].apply(lambda d: min(d, max_actual_date))

    resampled["daily_ret"] = resampled["adj_nav"].pct_change()
    resampled["pct_chg"] = resampled["daily_ret"].apply(
        lambda x: f"{x * 100:+.2f}%" if pd.notna(x) else "--"
    )
    return resampled


def compute_interval_returns(df: pd.DataFrame, fund_name: str = PRODUCT_NAME) -> list[dict]:
    """按年计算各月收益率、胜率与全年收益。"""
    work = df.copy()
    work["year"] = work["date"].dt.year
    work["month"] = work["date"].dt.month

    eom = work.groupby(["year", "month"], as_index=False).last()
    eom = eom.sort_values(["year", "month"]).reset_index(drop=True)
    eom["prev_nav"] = eom["adj_nav"].shift(1)
    eom["ret"] = eom["adj_nav"] / eom["prev_nav"] - 1.0

    min_year = int(work["year"].min())
    max_year = int(work["year"].max())
    rows: list[dict] = []

    for year in range(max_year, min_year - 1, -1):
        year_eom = eom[eom["year"] == year]
        row: dict = {"year": year, "fund": fund_name}
        month_rets: list[float] = []

        for month in range(1, 13):
            month_row = year_eom[year_eom["month"] == month]
            if month_row.empty:
                row[month] = None
                continue

            ret = month_row.iloc[0]["ret"]
            if pd.isna(ret):
                row[month] = None
            else:
                row[month] = float(ret)
                month_rets.append(float(ret))

        row["win_rate"] = (
            sum(1 for r in month_rets if r > 0) / len(month_rets) if month_rets else None
        )
        row["annual"] = float(np.prod([1 + r for r in month_rets]) - 1) if month_rets else None
        if month_rets:
            rows.append(row)

    return rows


_SCRIPT_DIR = Path(__file__).resolve().parent
_FONTS_DIR = _SCRIPT_DIR / "fonts"

_CN_FONT_CANDIDATE_NAMES = [
    "Noto Sans CJK SC",
    "Noto Sans SC",
    "Source Han Sans SC",
    "WenQuanYi Micro Hei",
    "WenQuanYi Zen Hei",
    "Microsoft YaHei",
    "SimHei",
    "SimSun",
    "PingFang SC",
]

_CN_FONT_FILE_KEYWORDS = (
    "notosanscjk",
    "notosanssc",
    "sourcehansans",
    "wqy",
    "microhei",
    "zenhei",
    "simhei",
    "yahei",
    "simsun",
    "pingfang",
)


def _is_usable_font_path(path: str | os.PathLike[str]) -> bool:
    candidate = str(path)
    if not candidate or not os.path.isfile(candidate):
        return False
    lower = candidate.lower()
    return "dejavu" not in lower and lower.endswith((".ttf", ".ttc", ".otf"))


def _can_load_font_path(path: str | os.PathLike[str]) -> bool:
    candidate = str(path)
    if not _is_usable_font_path(candidate):
        return False
    try:
        if os.path.getsize(candidate) < 100_000:
            return False
    except OSError:
        return False
    try:
        fontManager.addfont(candidate)
        return True
    except Exception:
        pass
    try:
        FontProperties(fname=candidate).get_name()
        return True
    except Exception:
        return False


def _legacy_font_paths() -> list[str]:
    return [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyhbd.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/wqy-microhei/wqy-microhei.ttc",
    ]


def _iter_font_search_dirs() -> list[str]:
    dirs = [
        str(_FONTS_DIR),
        os.environ.get("FOF_REPORT_FONT_DIR", ""),
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        os.path.expanduser("~/.local/share/fonts"),
        os.path.expanduser("~/.fonts"),
        "C:/Windows/Fonts",
        "/System/Library/Fonts",
        "/Library/Fonts",
    ]
    return [d for d in dirs if d and os.path.isdir(d)]


def _collect_cn_font_candidates() -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()

    def add(path: str | os.PathLike[str] | None) -> None:
        if not path:
            return
        normalized = os.path.normpath(str(path))
        if normalized in seen:
            return
        seen.add(normalized)
        candidates.append(normalized)

    for path in _legacy_font_paths():
        add(path)

    env_path = os.environ.get("FOF_REPORT_FONT_PATH", "").strip()
    add(env_path)
    add(_FONTS_DIR / "NotoSansSC-Regular.otf")

    for search_dir in _iter_font_search_dirs():
        if search_dir == str(_FONTS_DIR):
            continue
        if not os.path.isdir(search_dir):
            continue
        for root, _, files in os.walk(search_dir):
            for filename in files:
                lower = filename.lower()
                if not lower.endswith((".ttf", ".ttc", ".otf")):
                    continue
                if any(key in lower for key in _CN_FONT_FILE_KEYWORDS):
                    add(os.path.join(root, filename))

    for name in _CN_FONT_CANDIDATE_NAMES:
        try:
            add(fontManager.findfont(FontProperties(family=name), fallback_to_default=False))
        except Exception:
            continue

    return candidates


def find_cn_font_path() -> str | None:
    for path in _collect_cn_font_candidates():
        if _can_load_font_path(path):
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
    try:
        family = fp.get_name()
    except Exception:
        family = os.path.basename(path)

    matplotlib.rcParams["axes.unicode_minus"] = False
    matplotlib.rcParams["font.sans-serif"] = [family, "DejaVu Sans"]
    matplotlib.rcParams["font.family"] = "sans-serif"

    fp_bold = FontProperties(fname=path)
    try:
        fp_bold.set_weight("bold")
    except Exception:
        pass
    return fp, fp_bold


def get_cn_font() -> FontProperties | None:
    fp, _ = configure_cn_font()
    return fp


def find_nav_file(base_dir: str) -> str:
    patterns = [
        os.path.join(base_dir, "*团队净值*.csv"),
        os.path.join(base_dir, "*净值*.csv"),
        os.path.join(base_dir, "*净值*.xlsx"),
        os.path.join(base_dir, "*.csv"),
        os.path.join(base_dir, "*.xlsx"),
    ]
    for pattern in patterns:
        files = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
        if files:
            return files[0]
    raise FileNotFoundError(f"未找到净值数据文件: {base_dir}")


def risk_return_series(nav: pd.Series, nav_frequency: str | None = None) -> tuple[pd.Series, int]:
    """Build return series and annualization factor for risk metrics."""
    nav = nav.sort_index()
    periods_per_year = periods_per_year_for_frequency(nav_frequency)
    if len(nav) <= 1:
        return nav.pct_change().dropna(), periods_per_year
    return nav.pct_change().dropna(), periods_per_year


def compute_metrics(
    df: pd.DataFrame,
    as_of_date: pd.Timestamp | None = None,
    nav_frequency: str | None = None,
    week_begin: pd.Timestamp | None = None,
    report_kind: str | None = "weekly",
) -> dict:
    work = df.copy()
    if as_of_date is not None:
        as_of_date = pd.Timestamp(as_of_date).normalize()
        work = work[work["date"] <= as_of_date].copy()
        if work.empty:
            raise ValueError(f"截至 {as_of_date.date()} 无净值数据")

    series = work.set_index("date")["adj_nav"]
    bench = work.set_index("date")["csi300"]

    start_nav = float(series.iloc[0])
    end_nav = float(series.iloc[-1])
    total_return = end_nav / start_nav - 1.0

    returns, periods_per_year = risk_return_series(series, nav_frequency)
    years = max((series.index[-1] - series.index[0]).days / 365.25, 1 / 365.25)
    annual_return = (end_nav / start_nav) ** (1 / years) - 1.0
    volatility = returns.std(ddof=1) * np.sqrt(periods_per_year) if len(returns) > 1 else 0.0

    wealth = series / start_nav
    roll_max = wealth.cummax()
    drawdown = (wealth - roll_max) / roll_max
    max_drawdown = float(drawdown.min()) if not drawdown.empty else 0.0

    # Sharpe here follows the house convention of annualized return over
    # annualized volatility (no risk-free subtraction), matching the historical
    # reference reports (e.g. 20.57% / 7.09% = 2.90).
    sharpe = annual_return / volatility if volatility > 0 else 0.0
    calmar = annual_return / abs(max_drawdown) if max_drawdown < 0 else 0.0

    win_rate = (returns > 0).sum() / len(returns) if len(returns) > 0 else 0.0
    max_daily_gain = returns.max() if len(returns) > 0 else 0.0
    max_daily_loss = returns.min() if len(returns) > 0 else 0.0

    bench_nav = bench.sort_index()
    bench_returns = bench_nav.pct_change().dropna()
    bench_start = float(bench_nav.iloc[0])
    bench_end = float(bench_nav.iloc[-1])
    bench_years = max((bench_nav.index[-1] - bench_nav.index[0]).days / 365.25, 1 / 365.25)
    bench_annual_return = (bench_end / bench_start) ** (1 / bench_years) - 1.0
    annual_excess = annual_return - bench_annual_return

    ref_date = pd.Timestamp(as_of_date).normalize() if as_of_date is not None else work["date"].iloc[-1]
    kind = normalize_report_kind(report_kind)
    if week_begin is not None:
        week_begin = pd.Timestamp(week_begin).normalize()
        week_mask = (work["date"] >= week_begin) & (work["date"] <= ref_date)
        week_df = work[week_mask]
        if len(week_df) < 1:
            week_df = work.tail(5)
        week_start = week_begin
        week_end = ref_date
        print(f"[compute_metrics] explicit range: week_start={week_start.date()} week_end={week_end.date()} week_df_len={len(week_df)}")
    elif kind == "monthly":
        month_start = ref_date.replace(day=1)
        week_mask = (work["date"] >= month_start) & (work["date"] <= ref_date)
        week_df = work[week_mask]
        if len(week_df) < 1:
            week_df = work.tail(5)
        week_start = month_start
        week_end = ref_date
        print(f"[compute_metrics] monthly default range: week_start={week_start.date()} week_end={week_end.date()} week_df_len={len(week_df)}")
    else:
        ref_iso_week = ref_date.isocalendar()[1]
        ref_iso_year = ref_date.isocalendar()[0]
        week_mask = work["date"].apply(
            lambda d: d.isocalendar()[1] == ref_iso_week and d.isocalendar()[0] == ref_iso_year
        )
        week_df = work[week_mask]
        if len(week_df) < 1:
            week_df = work.tail(5)
        week_start = week_df["date"].iloc[0]
        week_end = week_df["date"].iloc[-1]
    week_start_loc = work.index.get_loc(week_df.index[0])
    if week_start_loc > 0:
        prior_row = work.iloc[week_start_loc - 1]
        week_return = float(week_df["adj_nav"].iloc[-1] / prior_row["adj_nav"] - 1)
        week_bench = float(week_df["csi300"].iloc[-1] / prior_row["csi300"] - 1)
    else:
        week_return = float(week_df["adj_nav"].iloc[-1] / week_df["adj_nav"].iloc[0] - 1)
        week_bench = float(week_df["csi300"].iloc[-1] / week_df["csi300"].iloc[0] - 1)
    week_excess = week_return - week_bench

    report_year = int(ref_date.year)
    prev_year_df = work[work["date"].dt.year == report_year - 1]
    if not prev_year_df.empty:
        ytd_start_nav = float(prev_year_df["adj_nav"].iloc[-1])
        ytd_start_bench = float(prev_year_df["csi300"].iloc[-1])
        ytd_return = float(work["adj_nav"].iloc[-1] / ytd_start_nav - 1)
        ytd_bench = float(work["csi300"].iloc[-1] / ytd_start_bench - 1)
    else:
        ytd_df = work[work["date"].dt.year == report_year]
        if len(ytd_df) > 1:
            ytd_return = float(ytd_df["adj_nav"].iloc[-1] / ytd_df["adj_nav"].iloc[0] - 1)
            ytd_bench = float(ytd_df["csi300"].iloc[-1] / ytd_df["csi300"].iloc[0] - 1)
        else:
            ytd_return = total_return
            ytd_bench = float(bench.iloc[-1] / bench.iloc[0] - 1)

    bench_total = float(bench.iloc[-1] / bench.iloc[0] - 1)
    excess_total = total_return - bench_total

    week_high_nav = float(week_df["adj_nav"].max())
    week_high_date = week_df.loc[week_df["adj_nav"].idxmax(), "date"]
    prior_df = work[work["date"] < week_start]
    prior_max_nav = float(prior_df["adj_nav"].max()) if not prior_df.empty else float("-inf")
    is_week_all_time_high = week_high_nav > prior_max_nav + 1e-9

    return {
        "start_date": work["date"].iloc[0],
        # Report as-of date (selected week/month end), not last NAV observation.
        # Sparse/weekly series can end earlier than the chosen period end; the
        # header "数据截至" should still reflect the user-selected cutoff.
        "end_date": ref_date,
        "week_start": week_start,
        "week_end": week_end,
        "start_nav": start_nav,
        "end_nav": end_nav,
        "total_return": total_return,
        "annual_return": annual_return,
        "volatility": volatility,
        "max_drawdown": max_drawdown,
        "sharpe": sharpe,
        "calmar": calmar,
        "week_return": week_return,
        "week_bench": week_bench,
        "week_excess": week_excess,
        "ytd_return": ytd_return,
        "ytd_bench": ytd_bench,
        "bench_total": bench_total,
        "excess_total": excess_total,
        "trading_days": count_cn_trading_days(work["date"].iloc[0], work["date"].iloc[-1]),
        "win_rate": win_rate,
        "max_daily_gain": max_daily_gain,
        "max_daily_loss": max_daily_loss,
        "annual_excess": annual_excess,
        "week_df": week_df,
        "week_high_nav": week_high_nav,
        "week_high_date": week_high_date,
        "is_week_all_time_high": is_week_all_time_high,
    }


def fmt_pct(val: float, signed: bool = True) -> str:
    if signed:
        return f"{val * 100:+.2f}%"
    return f"{val * 100:.2f}%"


def build_highlights(
    metrics: dict,
    benchmark_label: str = "沪深300",
    report_kind: str | None = "weekly",
) -> list[str]:
    labels = REPORT_KIND_LABELS[normalize_report_kind(report_kind)]
    period_name = labels["period_name"]
    wr = metrics["week_return"]
    wb = metrics["week_bench"]
    we = metrics["week_excess"]
    tr = metrics["total_return"]
    md = metrics["max_drawdown"]
    week_high_nav = metrics["week_high_nav"]
    week_high_date = metrics["week_high_date"]
    is_new_high = metrics["is_week_all_time_high"]
    week_end = metrics["week_end"]
    weekday = ["一", "二", "三", "四", "五", "六", "日"][week_high_date.weekday()]
    day_label = f"{week_high_date.day}日" if normalize_report_kind(report_kind) == "monthly" else f"周{weekday}"
    range_label = "月内" if normalize_report_kind(report_kind) == "monthly" else "周内"

    if wr >= 0:
        line1 = f"• 策略表现：{period_name}净值累计上涨{wr * 100:.2f}%，"
    else:
        line1 = f"• 策略表现：{period_name}净值累计下跌{abs(wr) * 100:.2f}%，"

    if is_new_high:
        line2 = f"  {day_label}升至{week_high_nav:.4f}，创运作以来阶段新高。"
    elif wr < 0 and pd.Timestamp(week_high_date).normalize() == pd.Timestamp(week_end).normalize():
        line2 = f"  {day_label}净值{week_high_nav:.4f}。"
    else:
        line2 = f"  {day_label}升至{week_high_nav:.4f}（{range_label}最高）。"

    if we >= 0:
        line3 = f"• 市场环境：{benchmark_label}{period_name}{wb * 100:+.2f}%，"
        line4 = f"  策略跑赢基准{we * 100:.2f}个百分点，超额能力突出。"
    else:
        line3 = f"• 市场环境：{benchmark_label}{period_name}强势+{wb * 100:.2f}%，"
        line4 = f"  产品低beta特征显现，稳健参与上涨，控制波动。"

    line5 = f"• 运作情况：运作以来累计{tr * 100:+.2f}%，最大回撤"
    line6 = f"  {md * 100:.2f}%，强势股策略持续稳健运作。"

    return [line1, line2, line3, line4, line5, line6]


def ret_color(val: float) -> str:
    if val > 0:
        return C_UP
    if val < 0:
        return C_DOWN
    return C_TEXT


def draw_text(ax, x, y, text, fp, size=12, color=C_TEXT, weight="normal", ha="left", va="center"):
    if fp is not None:
        font_file = fp.get_file()
        font_props = FontProperties(fname=font_file) if font_file else FontProperties(family=fp.get_name())
        if weight != "normal":
            font_props.set_weight(weight)
        ax.text(
            x, y, text,
            fontproperties=font_props, fontsize=size, color=color, ha=ha, va=va,
        )
        return
    ax.text(x, y, text, fontsize=size, color=color, weight=weight, ha=ha, va=va)


def draw_kpi_card(ax, x, y, w, h, label, value, fp, value_color=None):
    shadow = FancyBboxPatch(
        (x + 0.002, y - 0.002), w, h,
        boxstyle="round,pad=0.008,rounding_size=0.015",
        facecolor="#000000", edgecolor="none", alpha=0.03,
        transform=ax.transAxes, clip_on=False,
    )
    ax.add_patch(shadow)

    card = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.008,rounding_size=0.015",
        facecolor=C_CARD, edgecolor=C_BORDER, linewidth=0.8,
        transform=ax.transAxes, clip_on=False,
    )
    ax.add_patch(card)

    draw_text(ax, x + w / 2, y + h * 0.68, label, fp, size=10, color=C_TEXT_LIGHT, ha="center")
    draw_text(
        ax, x + w / 2, y + h * 0.30, value, fp,
        size=16, color=value_color or C_TEXT, weight="bold", ha="center",
    )


def draw_interval_returns_table(
    ax,
    x: float,
    y: float,
    w: float,
    h: float,
    rows: list[dict],
    fp,
    fp_bold,
):
    draw_container_card(ax, x, y, w, h, "区间收益率", fp_bold, fp)

    headers = ["年份"] + [f"{m}月" for m in range(1, 13)] + ["胜率", "全年"]
    n_cols = len(headers)
    table_x = x + 0.012
    table_y = y + 0.012
    table_w = w - 0.024
    table_h = h - 0.038
    col_w = table_w / n_cols
    row_h = table_h / (len(rows) + 1)

    for i, header in enumerate(headers):
        cx = table_x + i * col_w
        cy = table_y + table_h - row_h
        ax.add_patch(
            Rectangle(
                (cx, cy), col_w, row_h,
                transform=ax.transAxes, facecolor=C_GRAY, edgecolor=C_BORDER,
                linewidth=0.5, clip_on=False,
            )
        )
        draw_text(
            ax, cx + col_w / 2, cy + row_h / 2, header, fp,
            size=6.5, color=C_TEXT, weight="bold", ha="center",
        )

    for r_idx, row in enumerate(rows):
        cy = table_y + table_h - (r_idx + 2) * row_h
        bg = C_CARD if r_idx % 2 == 0 else C_GRAY
        for i in range(n_cols):
            cx = table_x + i * col_w
            ax.add_patch(
                Rectangle(
                    (cx, cy), col_w, row_h,
                    transform=ax.transAxes, facecolor=bg, edgecolor=C_BORDER,
                    linewidth=0.3, clip_on=False, alpha=0.5 if bg == C_GRAY else 1.0,
                )
            )

        values: list[tuple[str, str]] = [(str(row["year"]), C_TEXT)]
        for month in range(1, 13):
            val = row.get(month)
            if val is None:
                values.append(("-", C_TEXT_LIGHT))
            else:
                values.append((f"{val * 100:.2f}%", ret_color(val)))

        win = row.get("win_rate")
        values.append((f"{win * 100:.2f}%" if win is not None else "-", C_TEXT))
        annual = row.get("annual")
        values.append(
            (
                f"{annual * 100:.2f}%" if annual is not None else "-",
                ret_color(annual) if annual is not None else C_TEXT,
            )
        )

        for i, (text, color) in enumerate(values):
            cx = table_x + i * col_w
            weight = "bold" if i >= n_cols - 2 and text != "-" else "normal"
            draw_text(
                ax, cx + col_w / 2, cy + row_h / 2, text, fp,
                size=6, color=color, weight=weight, ha="center",
            )


def draw_container_card(ax, x, y, w, h, title, fp_bold, fp):
    shadow = FancyBboxPatch(
        (x + 0.003, y - 0.003), w, h,
        boxstyle="round,pad=0.01,rounding_size=0.015",
        facecolor="#000000", edgecolor="none", alpha=0.03,
        transform=ax.transAxes, clip_on=False,
    )
    ax.add_patch(shadow)

    card = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.01,rounding_size=0.015",
        facecolor=C_CARD, edgecolor=C_BORDER, linewidth=0.8,
        transform=ax.transAxes, clip_on=False,
    )
    ax.add_patch(card)

    accent = Rectangle(
        (x + 0.015, y + h - 0.024), 0.006, 0.015,
        transform=ax.transAxes, color=C_PRIMARY, clip_on=False,
    )
    ax.add_patch(accent)

    draw_text(
        ax, x + 0.026, y + h - 0.017, title, fp_bold or fp,
        size=12, weight="bold", color=C_PRIMARY,
    )


def ensure_integrated_horse() -> str:
    dst_path = Path(__file__).parent / "integrated_horse.png"
    if dst_path.exists():
        return str(dst_path)
    
    src_path = Path(__file__).parent / "generated_galloping_horse.png"
    if not src_path.exists():
        workspace_assets = Path(__file__).parent.parent / "assets"
        for p in workspace_assets.glob("*generated_galloping_horse*.png"):
            src_path = p
            break
            
    if not src_path.exists():
        return ""
        
    try:
        from PIL import Image, ImageDraw, ImageFilter
        img = Image.open(src_path).convert('RGBA')
        w, h = img.size
        horse_resized = img.resize((480, int(480 * h / w)), Image.Resampling.LANCZOS)
        bw, bh = horse_resized.size

        mask = Image.new('L', (bw, bh), 0)
        draw = ImageDraw.Draw(mask)
        pad = 8
        draw.rounded_rectangle([pad, pad, bw - pad, bh - pad], radius=24, fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(8))

        horse_resized.putalpha(mask)

        border_layer = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
        bdraw = ImageDraw.Draw(border_layer)
        bdraw.rounded_rectangle([pad+3, pad+3, bw - pad - 3, bh - pad - 3], radius=20, outline=(250, 240, 137, 240), width=3)

        horse_final = Image.alpha_composite(horse_resized, border_layer)
        horse_final.save(dst_path)
        return str(dst_path)
    except Exception as exc:
        print(f"[ensure_integrated_horse warning]: {exc}")
        return ""


def ensure_gold_header_seal() -> str:
    art_path = Path(__file__).parent / "gold_header_seal.png"
    if art_path.exists():
        return str(art_path)
    
    try:
        from PIL import Image, ImageDraw, ImageFont

        W, H = 600, 200
        img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        GOLD_LIGHT = (250, 240, 137, 255)
        GOLD_MAIN  = (212, 160, 23, 255)

        sx, sy, sw, sh = 420, 30, 130, 130
        draw.rounded_rectangle([sx, sy, sx+sw, sy+sh], radius=16, outline=GOLD_LIGHT, width=3)
        draw.rounded_rectangle([sx+4, sy+4, sx+sw-4, sy+sh-4], radius=12, outline=GOLD_MAIN, width=1)

        font_seal = None
        font_sub = None
        try:
            font_seal = ImageFont.truetype('simhei.ttf', 44)
            font_sub  = ImageFont.truetype('simhei.ttf', 20)
        except:
            pass

        if font_seal:
            draw.text((sx+18, sy+14), '丙', fill=GOLD_LIGHT, font=font_seal)
            draw.text((sx+70, sy+14), '午', fill=GOLD_LIGHT, font=font_seal)
            draw.text((sx+18, sy+66), '马', fill=GOLD_LIGHT, font=font_seal)
            draw.text((sx+70, sy+66), '年', fill=GOLD_LIGHT, font=font_seal)

        if font_sub:
            draw.text((230, 60), '丙午马年 · 龙马精神', fill=GOLD_LIGHT, font=font_sub)
            draw.text((230, 95), '岁在丙午 · 祥瑞开新', fill=(250, 240, 137, 200), font=font_sub)

        img.save(art_path)
        return str(art_path)
    except Exception as exc:
        print(f"[ensure_gold_header_seal] warning: {exc}")
        return ""


def _extract_recent_monthly_returns(interval_rows: list[dict], end_date: pd.Timestamp) -> list[tuple[str, float | None]]:
    """Last 12 calendar months ending at end_date, for the monthly bar chart."""
    by_ym: dict[tuple[int, int], float | None] = {}
    for row in interval_rows:
        year = int(row["year"])
        for month in range(1, 13):
            val = row.get(month)
            by_ym[(year, month)] = float(val) if val is not None else None

    out: list[tuple[str, float | None]] = []
    cursor = pd.Timestamp(end_date.year, end_date.month, 1)
    for _ in range(12):
        key = (int(cursor.year), int(cursor.month))
        label = cursor.strftime("%y/%m")
        out.append((label, by_ym.get(key)))
        cursor = cursor - pd.DateOffset(months=1)
    out.reverse()
    return out


def _prepare_report_context(
    nav_file: str,
    *,
    week_begin: str | None,
    week_end: str | None,
    product_name: str,
    nav_frequency: str | None,
    report_kind: str,
) -> dict:
    kind = normalize_report_kind(report_kind)
    raw_df = load_nav_data(nav_file)
    first_adj = float(raw_df["adj_nav"].iloc[0]) if len(raw_df) > 0 else 1.0
    if first_adj > 0 and abs(first_adj - 1.0) > 1e-6:
        raw_df = raw_df.copy()
        raw_df["adj_nav"] = raw_df["adj_nav"] / first_adj
    df = apply_nav_frequency(raw_df, nav_frequency)
    as_of = pd.Timestamp(week_end).normalize() if week_end else None
    report_week_begin = pd.Timestamp(week_begin).normalize() if week_begin else None
    if as_of is not None:
        if as_of < df["date"].min() or as_of > df["date"].max():
            raise ValueError(
                f"所选日期 {as_of.date()} 超出净值区间 "
                f"{df['date'].min().date()} ~ {df['date'].max().date()}"
            )
    if report_week_begin is not None and as_of is not None and report_week_begin > as_of:
        raise ValueError(
            f"报告开始日期 {report_week_begin.date()} 不能晚于结束日期 {as_of.date()}"
        )

    plot_df = df[df["date"] <= as_of].copy() if as_of is not None else df
    daily_plot_df = raw_df[raw_df["date"] <= as_of].copy() if as_of is not None else raw_df.copy()
    interval_rows = compute_interval_returns(daily_plot_df, fund_name=product_name)
    metrics = compute_metrics(df, as_of, nav_frequency, report_week_begin, report_kind=kind)

    cur_year = int(as_of.year) if as_of is not None else int(daily_plot_df["date"].dt.year.max())
    year_row = next((r for r in interval_rows if r["year"] == cur_year), None)
    if year_row and year_row.get("annual") is not None:
        metrics["ytd_return"] = float(year_row["annual"])

    return {
        "kind": kind,
        "plot_df": plot_df,
        "interval_rows": interval_rows,
        "metrics": metrics,
        "as_of": as_of,
    }


def _save_report_figure(
    fig,
    output_dir: str,
    report_title: str,
    end_date: pd.Timestamp,
    file_suffix: str,
) -> tuple[str, str]:
    os.makedirs(output_dir, exist_ok=True)
    date_str = end_date.strftime("%Y%m%d")
    png_path = os.path.join(output_dir, f"{report_title}{file_suffix}_{date_str}.png")
    pdf_path = os.path.join(output_dir, f"{report_title}{file_suffix}_{date_str}.pdf")
    # dpi=150 is sharp enough for screen preview and much faster than 200 on small CPUs.
    fig.savefig(png_path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor(), pad_inches=0.08)

    # Build PDF from the PNG instead of a second matplotlib render via PdfPages.
    try:
        from PIL import Image

        with Image.open(png_path) as img:
            img.convert("RGB").save(pdf_path, "PDF", resolution=150.0)
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] PNG→PDF 转换失败，回退 matplotlib PdfPages: {exc}", file=sys.stderr)
        from matplotlib.backends.backend_pdf import PdfPages

        with PdfPages(pdf_path) as pdf:
            pdf.savefig(fig, bbox_inches="tight", facecolor=fig.get_facecolor(), pad_inches=0.08)

    plt.close(fig)
    return png_path, pdf_path


def _make_weekly_report(
    ctx: dict,
    *,
    output_dir: str,
    product_name: str,
    report_title: str,
    product_tagline: str,
    benchmark_label: str,
) -> tuple[str, str]:
    labels = REPORT_KIND_LABELS[ctx["kind"]]
    plot_df = ctx["plot_df"]
    interval_rows = ctx["interval_rows"]
    metrics = ctx["metrics"]

    fp, fp_bold = configure_cn_font()
    if fp is None:
        raise RuntimeError(
            "未找到可用的中文字体。请在服务器执行: bash scripts/deploy/setup-haitai-week-report.sh"
        )

    fig_w, fig_h = 7.5, 12.5
    fig = plt.figure(figsize=(fig_w, fig_h), facecolor=C_BG)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    for y_coord in np.linspace(0.1, 1.0, 50):
        alpha = (y_coord - 0.1) / 0.9 * 0.04
        rect = Rectangle(
            (0, y_coord), 1, 0.02, transform=ax.transAxes,
            color="#94A3B8", alpha=alpha, zorder=-10, clip_on=False,
        )
        ax.add_patch(rect)

    ax.add_patch(
        Rectangle(
            (0.015, 0.015), 0.97, 0.97, transform=ax.transAxes,
            facecolor="none", edgecolor=C_GOLD, linewidth=0.5, clip_on=False, zorder=10,
        )
    )

    week_range = (
        f"{metrics['week_start'].strftime('%Y.%m.%d')}"
        f" – {metrics['week_end'].strftime('%Y.%m.%d')}"
    )
    report_date = metrics["end_date"].strftime("%Y年%m月%d日")

    ax.add_patch(Rectangle((0, 0.915), 1, 0.085, transform=ax.transAxes, color=C_PRIMARY, clip_on=False))
    ax.add_patch(Rectangle((0, 0.911), 1, 0.004, transform=ax.transAxes, color=C_GOLD, clip_on=False))

    for offset in np.linspace(-0.2, 1.2, 20):
        ax.plot(
            [offset, offset + 0.12], [0.915, 1.0], transform=ax.transAxes,
            color="white", alpha=0.04, linewidth=0.8, clip_on=True,
        )

    draw_text(ax, 0.06, 0.962, report_title, fp_bold or fp, size=22, color="white", weight="bold")
    draw_text(ax, 0.06, 0.932, labels["kind_name"], fp, size=13, color="#FFCDD2")
    draw_text(ax, 0.94, 0.962, report_date, fp, size=11, color="white", ha="right")
    draw_text(
        ax, 0.94, 0.932,
        f"数据截至 {metrics['end_date'].strftime('%Y-%m-%d')}",
        fp, size=9, color="#FFCDD2", ha="right",
    )

    ax.add_patch(Rectangle((0.042, 0.872), 0.92, 0.03, transform=ax.transAxes, color="black", alpha=0.02, clip_on=False))
    ax.add_patch(Rectangle((0.04, 0.875), 0.92, 0.03, transform=ax.transAxes, facecolor="white", edgecolor=C_GOLD, linewidth=0.8, clip_on=False))
    ax.add_patch(Rectangle((0.04, 0.875), 0.008, 0.03, transform=ax.transAxes, color=C_PRIMARY, clip_on=False))

    draw_text(ax, 0.06, 0.89, f"{labels['period_broadcast']}（{week_range}）", fp_bold or fp, size=10, color=C_PRIMARY, weight="bold")
    draw_text(ax, 0.94, 0.89, product_tagline, fp, size=10, color=C_TEXT_LIGHT, ha="right")

    kpi_row1_y = 0.795
    kpi_h = 0.072
    kpi_w = 0.21
    gap = 0.025
    x0 = 0.04

    row1 = [
        (labels["period_return"], fmt_pct(metrics["week_return"]), ret_color(metrics["week_return"])),
        ("今年以来", fmt_pct(metrics["ytd_return"]), ret_color(metrics["ytd_return"])),
        ("运作以来", fmt_pct(metrics["total_return"]), ret_color(metrics["total_return"])),
        ("最新净值", f"{metrics['end_nav']:.4f}", C_TEXT),
    ]
    for i, (label, value, color) in enumerate(row1):
        draw_kpi_card(ax, x0 + i * (kpi_w + gap), kpi_row1_y, kpi_w, kpi_h, label, value, fp, color)

    kpi_row2_y = 0.712
    row2 = [
        ("夏普比率", f"{metrics['sharpe']:.2f}", C_PRIMARY),
        ("年化波动", fmt_pct(metrics["volatility"], signed=False), C_TEXT),
        ("最大回撤", fmt_pct(metrics["max_drawdown"]), C_DOWN if metrics["max_drawdown"] < 0 else C_TEXT),
        ("超额收益", fmt_pct(metrics["excess_total"]), ret_color(metrics["excess_total"])),
    ]
    for i, (label, value, color) in enumerate(row2):
        draw_kpi_card(ax, x0 + i * (kpi_w + gap), kpi_row2_y, kpi_w, kpi_h, label, value, fp, color)

    chart_top = 0.68
    chart_bottom = 0.41
    chart_left = 0.08
    chart_right = 0.92

    draw_container_card(
        ax, 0.04, chart_bottom, 0.92, chart_top - chart_bottom,
        f"累计收益率走势（对比{benchmark_label}）", fp_bold, fp,
    )

    chart_ax = fig.add_axes([
        chart_left, chart_bottom + 0.02, chart_right - chart_left, chart_top - chart_bottom - 0.05,
    ])
    chart_ax.set_facecolor(C_CARD)

    start_nav = float(plot_df["adj_nav"].iloc[0])
    fund_cum = (plot_df.set_index("date")["adj_nav"] / start_nav - 1) * 100
    bench_cum = (plot_df.set_index("date")["csi300"] / plot_df["csi300"].iloc[0] - 1) * 100

    chart_ax.plot(fund_cum.index, fund_cum.values, color=C_UP, linewidth=2.2, label=product_name, zorder=3)
    chart_ax.fill_between(fund_cum.index, fund_cum.values, 0, color=C_UP, alpha=0.08, zorder=2)
    chart_ax.plot(
        bench_cum.index, bench_cum.values, color="#64748B", linewidth=1.5,
        linestyle="--", label=benchmark_label, zorder=1,
    )
    chart_ax.axvspan(metrics["week_start"], metrics["week_end"], color=C_UP, alpha=0.12, label=labels["period_range_label"], zorder=0)

    last_date = fund_cum.index[-1]
    last_val = fund_cum.values[-1]
    chart_ax.plot(last_date, last_val, marker="o", color=C_UP, markersize=5, zorder=5)
    chart_ax.annotate(
        f"{last_val:+.2f}%",
        xy=(last_date, last_val),
        xytext=(8, 0),
        textcoords="offset points",
        fontsize=8,
        fontproperties=fp,
        color="white",
        weight="bold",
        va="center",
        bbox=dict(boxstyle="round,pad=0.2", facecolor=C_UP, edgecolor="none", alpha=0.95),
        zorder=6,
    )

    chart_ax.axhline(0, color=C_BORDER, linewidth=0.8, linestyle="-", alpha=0.8)
    chart_ax.grid(True, alpha=0.15, linestyle=":", color="#94A3B8")

    span_days = (fund_cum.index[-1] - fund_cum.index[0]).days
    if span_days > 730:
        date_locator = mdates.MonthLocator(interval=6)
        date_formatter = mdates.DateFormatter("%Y/%m")
    elif span_days > 365:
        date_locator = mdates.MonthLocator(interval=3)
        date_formatter = mdates.DateFormatter("%Y/%m")
    elif span_days > 120:
        date_locator = mdates.MonthLocator()
        date_formatter = mdates.DateFormatter("%Y/%m")
    else:
        date_locator = mdates.WeekdayLocator(byweekday=mdates.MO, interval=2)
        date_formatter = mdates.DateFormatter("%m/%d")
    chart_ax.xaxis.set_major_locator(date_locator)
    chart_ax.xaxis.set_major_formatter(date_formatter)
    chart_ax.tick_params(axis="x", labelsize=8, colors=C_TEXT_LIGHT, rotation=0, pad=2)
    chart_ax.tick_params(axis="y", labelsize=8, colors=C_TEXT_LIGHT)
    chart_ax.spines["top"].set_visible(False)
    chart_ax.spines["right"].set_visible(False)
    chart_ax.spines["left"].set_color(C_BORDER)
    chart_ax.spines["bottom"].set_color(C_BORDER)

    ylabel_kwargs = dict(transform=chart_ax.transAxes, fontsize=8, color=C_TEXT_LIGHT, ha="left", va="top", zorder=10)
    if fp:
        ylabel_kwargs["fontproperties"] = fp
    chart_ax.text(0.02, 0.88, "收益率 (%)", **ylabel_kwargs)

    legend_kwargs = dict(
        loc="upper left", bbox_to_anchor=(0.15, 1.0), fontsize=8,
        framealpha=0.95, facecolor="white", edgecolor=C_BORDER,
    )
    if fp:
        legend_kwargs["prop"] = fp
    chart_ax.legend(**legend_kwargs)

    table_top = 0.39
    table_bottom = 0.255
    draw_interval_returns_table(
        ax, 0.04, table_bottom, 0.92, table_top - table_bottom,
        interval_rows, fp, fp_bold,
    )

    bottom_y = 0.095
    bottom_h = 0.14

    draw_container_card(ax, 0.04, bottom_y, 0.44, bottom_h, labels["period_highlights"], fp_bold, fp)
    highlights = build_highlights(metrics, benchmark_label, report_kind=ctx["kind"])
    for i, line in enumerate(highlights):
        draw_text(ax, 0.06, bottom_y + bottom_h - 0.042 - i * 0.016, line, fp, size=8.5, color=C_TEXT)

    draw_container_card(ax, 0.52, bottom_y, 0.44, bottom_h, "核心指标一览", fp_bold, fp)
    table_items = [
        ("成立日期", metrics["start_date"].strftime("%Y-%m-%d")),
        ("运作天数", f"{metrics['trading_days']} 个交易日"),
        ("初始净值", "1.0000"),
        ("年化收益", fmt_pct(metrics["annual_return"])),
        ("卡玛比率", f"{metrics['calmar']:.2f}"),
        ("日度胜率", fmt_pct(metrics["win_rate"], signed=False)),
    ]
    for i, (label, value) in enumerate(table_items):
        row_y = bottom_y + bottom_h - 0.042 - i * 0.016
        if i % 2 == 0:
            ax.add_patch(
                Rectangle(
                    (0.535, row_y - 0.005), 0.41, 0.012, transform=ax.transAxes,
                    color=C_GRAY, alpha=0.5, clip_on=False,
                )
            )
        draw_text(ax, 0.55, row_y, label, fp, size=8, color=C_TEXT_LIGHT)

        val_color = C_TEXT
        if "收益" in label:
            try:
                val_color = ret_color(float(value.replace("%", "").replace("+", "")) / 100)
            except ValueError:
                pass
        draw_text(ax, 0.93, row_y, value, fp, size=8, color=val_color, weight="bold", ha="right")

    ax.add_patch(Rectangle((0, 0), 1, 0.06, transform=ax.transAxes, color=C_PRIMARY, clip_on=False))
    disclaimer = "本报告仅供合格投资者及合作渠道参考，不构成投资建议。过往业绩不代表未来表现，市场有风险，投资需谨慎。"
    draw_text(ax, 0.5, 0.03, disclaimer, fp, size=7.5, color="white", ha="center")

    return _save_report_figure(
        fig, output_dir, report_title, metrics["end_date"],
        "月报曲线版" if ctx["kind"] == "monthly" else labels["file_suffix"],
    )


def _make_monthly_report(
    ctx: dict,
    *,
    output_dir: str,
    product_name: str,
    report_title: str,
    product_tagline: str,
    benchmark_label: str,
) -> tuple[str, str]:
    """Light Chinese-style monthly report — red accents, horse-year motif, seal stamp."""
    labels = REPORT_KIND_LABELS["monthly"]
    plot_df = ctx["plot_df"]
    interval_rows = ctx["interval_rows"]
    metrics = ctx["metrics"]
    end_date = metrics["end_date"]
    month_label = end_date.strftime("%Y年%m月")
    period_range = (
        f"{metrics['week_start'].strftime('%Y.%m.%d')} – {metrics['week_end'].strftime('%Y.%m.%d')}"
    )

    fp, fp_bold = configure_cn_font()
    if fp is None:
        raise RuntimeError(
            "未找到可用的中文字体。请在服务器执行: bash scripts/deploy/setup-haitai-week-report.sh"
        )

    # ── Chinese New Year (Horse) palette ────────────────────────────────────
    C_BG        = "#FEF9F7"   # warm paper white
    C_WHITE     = "#FFFFFF"
    C_RED       = "#C0282E"   # 朱砂红 Chinese vermillion
    C_RED_DEEP  = "#7B1D1D"   # deep lacquer red (header)
    C_RED_MID   = "#9B2C2C"
    C_RED_LIGHT = "#FED7D7"   # blush
    C_RED_PALE  = "#FFF5F5"   # near-white blush (tile bg)
    C_GOLD      = "#B7791F"   # antique gold
    C_GOLD_PALE = "#FAF089"   # pale gold
    C_DOWN      = "#276749"   # forest green (negative; Chinese: green = down)
    C_INK       = "#1A202C"   # near-black ink
    C_DIM       = "#718096"
    C_BORDER    = "#E2E8F0"

    def ch_color(val: float) -> str:
        return C_RED if val > 0 else (C_DOWN if val < 0 else C_INK)

    month_ret = metrics["week_return"]

    # Figure: 9×13 inches portrait
    # x-units span 9"; y-units span 13"
    FIG_W, FIG_H = 9.0, 13.0

    fig = plt.figure(figsize=(FIG_W, FIG_H), facecolor=C_BG)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    # ── Background: faint diagonal texture lines ────────────────────────────
    for xi in np.arange(-0.3, 1.3, 0.055):
        ax.plot([xi, xi + 1.0], [0.07, 0.88], color=C_RED,
                alpha=0.025, linewidth=0.6, transform=ax.transAxes,
                clip_on=True, zorder=0)

    # ── Large "马" watermark ─────────────────────────────────────────────────
    ax.text(
        0.76, 0.48, "马",
        transform=ax.transAxes,
        fontsize=310, color=C_RED_LIGHT, alpha=0.18,
        ha="center", va="center", weight="bold",
        rotation=-12, zorder=0,
        fontproperties=fp_bold or fp,
    )

    # ── HEADER: deep-red band with wavy bottom edge ──────────────────────────
    wave_xs = np.linspace(0, 1, 200)
    wave_ys = 0.875 - 0.008 * np.sin(wave_xs * 8 * np.pi + 0.3)
    header_verts = (
        [(0, 1.01), (1, 1.01), (1, wave_ys[-1])]
        + list(zip(wave_xs[::-1], wave_ys[::-1]))
    )
    ax.add_patch(MplPolygon(header_verts, closed=True, transform=ax.transAxes,
                            facecolor=C_RED_DEEP, edgecolor="none",
                            clip_on=False, zorder=1))
    ax.add_patch(Rectangle((0, 0.994), 1, 0.006, transform=ax.transAxes,
                            color=C_GOLD, clip_on=False, zorder=2))
    ax.plot(wave_xs, wave_ys, transform=ax.transAxes,
            color=C_GOLD, linewidth=1.4, clip_on=False, zorder=2, alpha=0.7)
    for xi in np.arange(0.03, 0.65, 0.040):
        ax.text(xi, 0.978, "◆", transform=ax.transAxes,
                color=C_GOLD_PALE, alpha=0.28, fontsize=4.5,
                ha="center", va="center", clip_on=False, zorder=2)

    # Header text (left side)
    draw_text(ax, 0.05, 0.962, report_title,
              fp_bold or fp, size=21, color="white", weight="bold")
    draw_text(ax, 0.05, 0.910,
              labels["kind_name"] + "  ·  " + month_label,
              fp, size=11.5, color=C_GOLD_PALE)
    draw_text(ax, 0.05, 0.886, f"数据截至 {end_date.strftime('%Y年%m月%d日')}",
              fp, size=8.5, color="#FFCDD2")

    # ── GENERATED HORSE ARTWORK (Integrated softly into top-right header) ───
    horse_art_file = ensure_integrated_horse()
    if horse_art_file and os.path.exists(horse_art_file):
        try:
            horse_img = plt.imread(horse_art_file)
            ax.imshow(horse_img, extent=[0.76, 0.95, 0.880, 0.988], zorder=4, aspect='auto')
        except Exception as e:
            print(f"[imshow integrated horse warning]: {e}")

    draw_text(ax, 0.68, 0.942, "丙午马年", fp_bold or fp, size=13, color=C_GOLD_PALE, ha="center", weight="bold")
    draw_text(ax, 0.68, 0.910, "龙马精神 · 祥瑞开新", fp, size=8, color=C_GOLD_PALE, ha="center")

    # ── HERO CARD: ring KPI + 6 stat tiles ──────────────────────────────────
    ax.add_patch(FancyBboxPatch(
        (0.04, 0.630), 0.92, 0.224,
        boxstyle="round,pad=0.006,rounding_size=0.012",
        facecolor=C_WHITE, edgecolor=C_BORDER, linewidth=0.8,
        transform=ax.transAxes, clip_on=False, zorder=2,
    ))
    ax.add_patch(Rectangle((0.040, 0.630), 0.007, 0.224,
                            transform=ax.transAxes, color=C_RED,
                            clip_on=False, zorder=3))
    ax.add_patch(Rectangle((0.040, 0.848), 0.920, 0.006,
                            transform=ax.transAxes, color=C_RED,
                            clip_on=False, zorder=3))

    # Circular ring KPI (left column — labels kept inside ring only)
    ring_cx, ring_cy, ring_r = 0.145, 0.748, 0.060
    ax.add_patch(Wedge(
        (ring_cx, ring_cy), ring_r, 0, 360, width=0.022,
        transform=ax.transAxes, facecolor=C_RED_LIGHT,
        edgecolor=C_BORDER, linewidth=0.4, clip_on=False, zorder=4,
    ))
    arc_pct = min(abs(month_ret) / 0.50, 1.0)
    arc_deg = arc_pct * 270.0
    arc_col = ch_color(month_ret)
    if arc_deg > 1:
        ax.add_patch(Wedge(
            (ring_cx, ring_cy), ring_r, 90, 90 - arc_deg,
            width=0.022, transform=ax.transAxes,
            facecolor=arc_col, edgecolor="none", clip_on=False, zorder=5,
        ))
    draw_text(ax, ring_cx, ring_cy + 0.012, "本月收益",
              fp, size=7.5, color=C_DIM, ha="center")
    draw_text(ax, ring_cx, ring_cy - 0.014, fmt_pct(month_ret),
              fp_bold or fp, size=13, color=arc_col, weight="bold", ha="center")
    # Excess / benchmark below the ring (outside the wedge)
    bench_line_y = ring_cy - ring_r - 0.022
    draw_text(
        ax, ring_cx, bench_line_y,
        f"超额 {fmt_pct(metrics['week_excess'])} · {benchmark_label} {fmt_pct(metrics['week_bench'])}",
        fp, size=6.5, color=C_DIM, ha="center",
    )

    # 6 stat tiles (2 rows × 3 cols) — span full width to the right of ring
    tile_items = [
        ("今年以来",   fmt_pct(metrics["ytd_return"]),              ch_color(metrics["ytd_return"])),
        ("运作以来",   fmt_pct(metrics["total_return"]),            ch_color(metrics["total_return"])),
        ("最新净值",   f"{metrics['end_nav']:.4f}",                C_INK),
        ("夏普比率",   f"{metrics['sharpe']:.2f}",                 C_RED_MID),
        ("最大回撤",   fmt_pct(metrics["max_drawdown"]),            ch_color(metrics["max_drawdown"])),
        ("年化波动率", fmt_pct(metrics["volatility"], signed=False), C_DIM),
    ]
    tile_x0, tile_x1 = 0.265, 0.945
    th, tgy = 0.081, 0.012
    tgx = 0.014
    tw = (tile_x1 - tile_x0 - 2 * tgx) / 3
    row1_y, row2_y = 0.760, 0.760 - th - tgy
    for i, (lbl, val, col) in enumerate(tile_items):
        ci, ri = i % 3, i // 3
        tx = tile_x0 + ci * (tw + tgx)
        ty = row1_y if ri == 0 else row2_y
        ax.add_patch(FancyBboxPatch(
            (tx, ty), tw, th,
            boxstyle="round,pad=0.003,rounding_size=0.006",
            facecolor=C_RED_PALE, edgecolor=C_RED_LIGHT, linewidth=0.6,
            transform=ax.transAxes, clip_on=False, zorder=3,
        ))
        ax.add_patch(Rectangle(
            (tx, ty + th - 0.005), tw, 0.005,
            transform=ax.transAxes, color=C_RED, clip_on=False, zorder=4,
        ))
        draw_text(ax, tx + tw / 2, ty + th - 0.024, lbl,
                  fp, size=7.5, color=C_DIM, ha="center")
        draw_text(ax, tx + tw / 2, ty + 0.027, val,
                  fp_bold or fp, size=11.5, color=col, weight="bold", ha="center")

    # ── 12-MONTH BAR CHART (left block) ─────────────────────────────────────
    ax.add_patch(FancyBboxPatch(
        (0.04, 0.420), 0.54, 0.188,
        boxstyle="round,pad=0.006,rounding_size=0.012",
        facecolor=C_WHITE, edgecolor=C_BORDER, linewidth=0.8,
        transform=ax.transAxes, clip_on=False, zorder=2,
    ))
    ax.add_patch(Rectangle((0.040, 0.420), 0.007, 0.188,
                            transform=ax.transAxes, color=C_RED,
                            clip_on=False, zorder=3))
    draw_text(ax, 0.076, 0.592, "近12个月月度收益",
              fp_bold or fp, size=10, color=C_RED_DEEP, weight="bold")

    bar_ax = fig.add_axes([0.073, 0.452, 0.490, 0.118])
    bar_ax.set_facecolor(C_WHITE)
    monthly_bars = _extract_recent_monthly_returns(interval_rows, end_date)
    # Compact labels: "25/7" instead of "25/07" to reduce overlap
    x_labels = []
    for lbl, _ in monthly_bars:
        if "/" in lbl:
            yr, mo = lbl.split("/", 1)
            x_labels.append(f"{yr}/{int(mo)}")
        else:
            x_labels.append(lbl)
    y_vals   = [item[1] * 100 if item[1] is not None else 0 for item in monthly_bars]
    bar_cols = [ch_color(v / 100) if item[1] is not None else C_BORDER
                for v, item in zip(y_vals, monthly_bars)]
    bar_ax.bar(range(len(x_labels)), y_vals, color=bar_cols,
               width=0.68, edgecolor="none", zorder=3)
    bar_ax.axhline(0, color=C_BORDER, linewidth=0.8, zorder=4)
    bar_ax.set_xticks(range(len(x_labels)))
    bar_ax.set_xticklabels(x_labels, fontsize=5, color=C_DIM, rotation=45, ha="right")
    bar_ax.tick_params(axis="x", pad=1)
    bar_ax.tick_params(axis="y", labelsize=6, colors=C_DIM)
    for sp in bar_ax.spines.values():
        sp.set_color(C_BORDER)
        sp.set_alpha(0.5)
    bar_ax.spines["top"].set_visible(False)
    bar_ax.spines["right"].set_visible(False)
    bar_ax.set_facecolor(C_WHITE)
    bar_ax.grid(axis="y", alpha=0.12, linestyle=":", color=C_DIM)
    for label in bar_ax.get_xticklabels():
        if fp:
            label.set_fontproperties(fp)

    # ── REVIEW PANEL (right block) ───────────────────────────────────────────
    ax.add_patch(FancyBboxPatch(
        (0.60, 0.420), 0.36, 0.188,
        boxstyle="round,pad=0.006,rounding_size=0.012",
        facecolor=C_WHITE, edgecolor=C_RED, linewidth=1.0,
        transform=ax.transAxes, clip_on=False, zorder=2,
    ))
    ax.add_patch(FancyBboxPatch(
        (0.60, 0.570), 0.36, 0.038,
        boxstyle="round,pad=0.004,rounding_size=0.008",
        facecolor=C_RED, edgecolor="none",
        transform=ax.transAxes, clip_on=False, zorder=3,
    ))
    draw_text(ax, 0.780, 0.590, f"{month_label}  回顾",
              fp_bold or fp, size=10, color="white", weight="bold", ha="center")
    draw_text(ax, 0.614, 0.560, period_range, fp, size=7, color=C_DIM)
    highlights = build_highlights(metrics, benchmark_label, report_kind="monthly")
    for i, line in enumerate(highlights[:5]):
        txt_col = C_INK if i % 2 == 0 else C_DIM
        draw_text(ax, 0.612, 0.546 - i * 0.027, line, fp, size=7.5, color=txt_col)

    # ── CUMULATIVE CHART ─────────────────────────────────────────────────────
    cum_card_bottom = 0.138
    cum_card_h = 0.259
    ax.add_patch(FancyBboxPatch(
        (0.04, cum_card_bottom), 0.92, cum_card_h,
        boxstyle="round,pad=0.006,rounding_size=0.012",
        facecolor=C_WHITE, edgecolor=C_BORDER, linewidth=0.8,
        transform=ax.transAxes, clip_on=False, zorder=2,
    ))
    ax.add_patch(Rectangle((0.040, cum_card_bottom), 0.007, cum_card_h,
                            transform=ax.transAxes, color=C_RED,
                            clip_on=False, zorder=3))
    draw_text(ax, 0.076, 0.379,
              f"累计收益率（{product_name}  vs  {benchmark_label}）",
              fp_bold or fp, size=10, color=C_RED_DEEP, weight="bold")

    cum_ax = fig.add_axes([0.078, 0.255, 0.868, 0.095])
    cum_ax.set_facecolor(C_WHITE)
    start_nav = float(plot_df["adj_nav"].iloc[0])
    fund_cum  = (plot_df.set_index("date")["adj_nav"] / start_nav - 1) * 100
    bench_cum = (plot_df.set_index("date")["csi300"] / plot_df["csi300"].iloc[0] - 1) * 100
    cum_ax.fill_between(fund_cum.index, fund_cum.values, 0,
                        color=C_RED, alpha=0.08, zorder=2)
    cum_ax.plot(fund_cum.index, fund_cum.values,
                color=C_RED, linewidth=2.2, label=product_name, zorder=3)
    cum_ax.plot(bench_cum.index, bench_cum.values,
                color=C_DIM, linewidth=1.4, linestyle="--",
                label=benchmark_label, zorder=1, alpha=0.75)
    cum_ax.axvspan(metrics["week_start"], metrics["week_end"],
                   color=C_GOLD, alpha=0.12, zorder=0)
    cum_ax.axhline(0, color=C_BORDER, linewidth=0.7)
    last_y = fund_cum.values[-1]
    last_x = fund_cum.index[-1]
    cum_ax.annotate(
        f"{last_y:+.1f}%", xy=(last_x, last_y),
        xytext=(-42, 10), textcoords="offset points",
        fontsize=9, color=C_RED, weight="bold", fontproperties=fp,
        arrowprops=dict(arrowstyle="-", color=C_RED, alpha=0.45, lw=0.8),
    )
    # Trim x-axis to data range (avoid empty space past last date)
    x_min = fund_cum.index.min()
    x_max = fund_cum.index.max()
    x_pad = pd.Timedelta(days=20)
    cum_ax.set_xlim(x_min - x_pad, x_max + x_pad)
    cum_ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
    cum_ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y/%m"))
    cum_ax.tick_params(axis="both", labelsize=7, colors=C_DIM)
    cum_ax.tick_params(axis="x", pad=2)
    for sp in cum_ax.spines.values():
        sp.set_color(C_BORDER)
        sp.set_alpha(0.5)
    cum_ax.spines["top"].set_visible(False)
    cum_ax.spines["right"].set_visible(False)
    cum_ax.set_facecolor(C_WHITE)
    cum_ax.grid(alpha=0.10, linestyle=":", color=C_DIM)
    for label in cum_ax.get_xticklabels():
        if fp:
            label.set_fontproperties(fp)
    legend_elements = [
        Line2D([0], [0], color=C_RED, lw=2, label=product_name),
        Line2D([0], [0], color=C_DIM, lw=1.4, linestyle="--", label=benchmark_label),
    ]
    legend_kw = dict(handles=legend_elements, loc="upper left",
                     fontsize=7, framealpha=0.9, facecolor=C_WHITE, edgecolor=C_BORDER)
    if fp:
        legend_kw["prop"] = fp
    cum_ax.legend(**legend_kw)

    # ── MONTHLY RETURN TABLE (below cumulative chart) ───────────────────────
    draw_text(ax, 0.076, 0.228, "月度收益明细",
              fp_bold or fp, size=8, color=C_RED_DEEP, weight="bold")

    n = len(monthly_bars)
    tbl_x0, tbl_y, tbl_w = 0.076, 0.175, 0.868
    lbl_w = 0.048
    row_h = 0.022
    tbl_h = row_h * 2
    col_w = (tbl_w - lbl_w) / n

    # Outer table border
    ax.add_patch(FancyBboxPatch(
        (tbl_x0, tbl_y), tbl_w, tbl_h,
        boxstyle="round,pad=0.002,rounding_size=0.004",
        facecolor=C_WHITE, edgecolor=C_BORDER, linewidth=0.8,
        transform=ax.transAxes, clip_on=False, zorder=3,
    ))
    # Horizontal divider between header & data rows
    ax.add_patch(Rectangle(
        (tbl_x0, tbl_y + row_h), tbl_w, 0.0012,
        transform=ax.transAxes, color=C_BORDER, clip_on=False, zorder=4,
    ))
    # Vertical divider after label column
    ax.add_patch(Rectangle(
        (tbl_x0 + lbl_w, tbl_y), 0.0012, tbl_h,
        transform=ax.transAxes, color=C_BORDER, clip_on=False, zorder=4,
    ))

    # Header row background (month labels)
    ax.add_patch(Rectangle(
        (tbl_x0 + lbl_w, tbl_y + row_h), tbl_w - lbl_w, row_h,
        transform=ax.transAxes, facecolor=C_RED_PALE, edgecolor="none",
        clip_on=False, zorder=3,
    ))

    # Row labels
    draw_text(ax, tbl_x0 + lbl_w / 2, tbl_y + row_h + row_h / 2, "月份",
              fp_bold or fp, size=6.5, color=C_RED_MID, ha="center", va="center", weight="bold")
    draw_text(ax, tbl_x0 + lbl_w / 2, tbl_y + row_h / 2, "收益率",
              fp_bold or fp, size=6.5, color=C_RED_MID, ha="center", va="center", weight="bold")

    for i, (lbl, ret) in enumerate(monthly_bars):
        cx = tbl_x0 + lbl_w + i * col_w
        # Column divider
        if i > 0:
            ax.add_patch(Rectangle(
                (cx, tbl_y), 0.0008, tbl_h,
                transform=ax.transAxes, color=C_BORDER, clip_on=False, zorder=4, alpha=0.6,
            ))
        # Compact month label
        if "/" in lbl:
            yr, mo = lbl.split("/", 1)
            month_lbl = f"{yr}/{int(mo)}"
        else:
            month_lbl = lbl
        draw_text(ax, cx + col_w / 2, tbl_y + row_h + row_h / 2, month_lbl,
                  fp, size=6, color=C_DIM, ha="center", va="center")
        # Return value with Chinese color convention
        if ret is not None:
            val_txt = f"{ret * 100:+.1f}%"
            val_col = ch_color(ret)
        else:
            val_txt = "--"
            val_col = C_DIM
        draw_text(ax, cx + col_w / 2, tbl_y + row_h / 2, val_txt,
                  fp_bold or fp, size=6.5, color=val_col, ha="center", va="center", weight="bold")

    # ── FOOTER ──────────────────────────────────────────────────────────────
    ax.add_patch(Rectangle((0, 0), 1, 0.078, transform=ax.transAxes,
                            color=C_RED_DEEP, clip_on=False, zorder=1))
    ax.add_patch(Rectangle((0, 0.076), 1, 0.003, transform=ax.transAxes,
                            color=C_GOLD, clip_on=False, zorder=2))
    for xi in np.arange(0.03, 1.0, 0.040):
        ax.text(xi, 0.056, "◆", transform=ax.transAxes,
                color=C_GOLD_PALE, alpha=0.18, fontsize=4.5,
                ha="center", va="center", clip_on=False, zorder=2)
    disclaimer = (
        "本报告仅供合格投资者及合作渠道参考，不构成投资建议。"
        "过往业绩不代表未来表现，市场有风险，投资需谨慎。"
    )
    draw_text(ax, 0.50, 0.044, disclaimer, fp, size=7, color="#FFCDD2", ha="center")
    draw_text(ax, 0.50, 0.022, product_tagline, fp, size=7.5, color=C_GOLD_PALE, ha="center")

    return _save_report_figure(fig, output_dir, report_title, end_date, "月报回顾版")


def make_report(
    nav_file: str,
    output_dir: str | None = None,
    *,
    week_begin: str | None = None,
    week_end: str | None = None,
    product_name: str = PRODUCT_NAME,
    report_title: str = REPORT_TITLE,
    product_tagline: str = PRODUCT_TAGLINE,
    benchmark_label: str = "沪深300",
    nav_frequency: str | None = "weekly",
    report_kind: str | None = "weekly",
    report_layout: str | None = None,
) -> tuple[str, str]:
    kind = normalize_report_kind(report_kind)
    layout = normalize_report_layout(report_layout, kind)
    print(
        f"[make_report] week_begin={week_begin!r} week_end={week_end!r} "
        f"nav_frequency={nav_frequency!r} report_kind={kind!r} report_layout={layout!r}"
    )
    output_dir = output_dir or str(Path(nav_file).parent)

    ctx = _prepare_report_context(
        nav_file,
        week_begin=week_begin,
        week_end=week_end,
        product_name=product_name,
        nav_frequency=nav_frequency,
        report_kind=kind,
    )
    metrics = ctx["metrics"]

    if kind == "monthly" and layout == "review":
        png_path, pdf_path = _make_monthly_report(
            ctx,
            output_dir=output_dir,
            product_name=product_name,
            report_title=report_title,
            product_tagline=product_tagline,
            benchmark_label=benchmark_label,
        )
    else:
        png_path, pdf_path = _make_weekly_report(
            ctx,
            output_dir=output_dir,
            product_name=product_name,
            report_title=report_title,
            product_tagline=product_tagline,
            benchmark_label=benchmark_label,
        )

    print(f"净值文件: {os.path.basename(nav_file)}")
    print(f"数据区间: {metrics['start_date'].date()} ~ {metrics['end_date'].date()}")
    print(f"PNG 已生成: {png_path}")
    print(f"PDF 已生成: {pdf_path}")
    return png_path, pdf_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=f"{REPORT_TITLE} 周报生成器")
    parser.add_argument(
        "nav_file",
        nargs="?",
        help="净值文件路径（CSV 或 Excel）；省略时在脚本目录自动查找",
    )
    parser.add_argument(
        "-o", "--output",
        help="输出目录（默认与净值文件同目录）",
    )
    parser.add_argument(
        "--week-begin",
        help="报告周开始日期 (YYYY-MM-DD)，与 --week-end 一起指定报告覆盖区间",
    )
    parser.add_argument(
        "--week-end",
        help="报告周结束日期 (YYYY-MM-DD)，默认使用净值最新日期",
    )
    parser.add_argument(
        "--product-name",
        default=PRODUCT_NAME,
        help="图表与文案中的产品简称",
    )
    parser.add_argument(
        "--report-title",
        default=REPORT_TITLE,
        help="报告标题（页眉与文件名）",
    )
    parser.add_argument(
        "--product-tagline",
        default=PRODUCT_TAGLINE,
        help="页眉右侧标语",
    )
    parser.add_argument(
        "--benchmark-label",
        default="沪深300",
        help="基准名称（图表与文案）",
    )
    parser.add_argument(
        "--nav-frequency",
        default="weekly",
        choices=["daily", "weekly", "monthly"],
        help="净值频率：daily=日频, weekly=周频, monthly=月频",
    )
    parser.add_argument(
        "--report-kind",
        default="weekly",
        choices=["weekly", "monthly"],
        help="报告类型：weekly=周报, monthly=月报",
    )
    parser.add_argument(
        "--report-layout",
        choices=["curve", "review"],
        help="月报版式：curve=竖版曲线, review=横版回顾",
    )
    args = parser.parse_args(argv)

    nav_file = args.nav_file
    if not nav_file:
        nav_file = find_nav_file(str(Path(__file__).parent))

    nav_file = str(Path(nav_file).resolve())
    if not os.path.isfile(nav_file):
        print(f"错误: 找不到净值文件 {nav_file}", file=sys.stderr)
        return 1

    try:
        make_report(
            nav_file,
            args.output,
            week_begin=args.week_begin,
            week_end=args.week_end,
            product_name=args.product_name,
            report_title=args.report_title,
            product_tagline=args.product_tagline,
            benchmark_label=args.benchmark_label,
            nav_frequency=args.nav_frequency,
            report_kind=args.report_kind,
            report_layout=args.report_layout,
        )
    except Exception as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
