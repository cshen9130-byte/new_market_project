# -*- coding: utf-8 -*-
"""MOM portfolio concentration-rule backtest and Word report.

Reproduces 日间风控 VaR 沙盒 MCR:
  dv[i] = sigma[i] * signed_mv[i]
  mcr[i] = |dv[i] * (Corr @ dv)[i]|
then tests 单品种 MCR < 30% / 单板块 MCR < 50% and a grid of alternatives.
"""
from __future__ import annotations

import json
import math
import os
import pickle
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import psycopg2
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor
from dotenv import load_dotenv
from matplotlib.font_manager import FontProperties, fontManager

ROOT = Path(__file__).resolve().parents[2]
for p in (ROOT / ".env.local", ROOT / ".env"):
    if p.exists():
        load_dotenv(p, override=False)

DB_URL = os.environ.get("DATABASE_URL") or (
    "postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
)
OUT_DIR = ROOT / "reports"
CHART_DIR = OUT_DIR / "_mcr_risk_rules_charts"
CACHE_PATH = OUT_DIR / "_mcr_risk_rules_cache.pkl"
REPORT_PATH = OUT_DIR / "MOM组合集中度风险规则回测报告.docx"
REPORT_PATH_ASCII = OUT_DIR / "MOM_portfolio_MCR_risk_rules_report.docx"

VOL_DAYS = 20
CORR_DAYS = 252
CORR_MIN = 60
MV_MIN = 1000.0
Z95 = 1.6449

NAVY = RGBColor(0x1A, 0x36, 0x5D)
GOLD = RGBColor(0xB8, 0x86, 0x0B)
TEXT = RGBColor(0x2D, 0x37, 0x48)
MUTED = RGBColor(0x64, 0x74, 0x8B)
RED = RGBColor(0xC5, 0x30, 0x30)
GREEN = RGBColor(0x2F, 0x85, 0x5A)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
AMBER = RGBColor(0xB4, 0x53, 0x09)

C_NAVY = "#1A365D"
C_TEAL = "#2B6CB0"
C_GOLD = "#C9A227"
C_GREEN = "#2F855A"
C_RED = "#C53030"


def cn_pnl_color(v) -> str:
    """A-share convention: red = positive, green = negative."""
    return C_RED if v >= 0 else C_GREEN
C_ORANGE = "#DD6B20"
C_GRAY = "#718096"
C_PURPLE = "#6B46C1"
C_PINK = "#B83280"
PALETTE = [C_NAVY, C_TEAL, C_GOLD, C_GREEN, C_ORANGE, C_PURPLE, C_RED, C_GRAY, C_PINK]

ACCT_FILTER = """
  UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
  AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
  AND TRIM("账户"::text) NOT LIKE '%国信%'
  AND TRIM("账户"::text) <> '665300200077'
"""

AKSHARE_CODE = {
    "A": "A0.DCE", "AD": "AD0.SHF", "AG": "AG0.SHF", "AL": "AL0.SHF", "AO": "AO0.SHF",
    "AP": "AP0.CZC", "AU": "AU0.SHF", "B": "B0.DCE", "BB": "BB0.DCE", "BC": "BCM.INE",
    "BR": "BR0.SHF", "BU": "BU0.SHF", "BZ": "BZ0.DCE", "C": "C0.DCE", "CF": "CF0.CZC",
    "CJ": "CJ0.CZC", "CS": "CS0.DCE", "CU": "CU0.SHF", "CY": "CY0.CZC", "EB": "EB0.DCE",
    "EC": "ECM.INE", "EG": "EG0.DCE", "FB": "FB0.DCE", "FG": "FG0.CZC", "FU": "FU0.SHF",
    "HC": "HC0.SHF", "I": "I0.DCE", "IC": "IC0.CFE", "IF": "IF0.CFE", "IH": "IH0.CFE",
    "IM": "IM0.CFE", "J": "J0.DCE", "JD": "JD0.DCE", "JM": "JM0.DCE", "JR": "JR0.CZC",
    "L": "L0.DCE", "LC": "LCM.GFE", "LG": "LG0.DCE", "LH": "LH0.DCE", "LR": "LR0.CZC",
    "LU": "LUM.INE", "M": "M0.DCE", "MA": "MA0.CZC", "NI": "NI0.SHF", "NR": "NRM.INE",
    "OI": "OI0.CZC", "OP": "OP0.SHF", "P": "P0.DCE", "PB": "PB0.SHF", "PD": "PDM.GFE",
    "PF": "PF0.CZC", "PG": "PG0.DCE", "PK": "PK0.CZC", "PL": "PL0.CZC", "PM": "PM0.CZC",
    "PP": "PP0.DCE", "PR": "PR0.CZC", "PS": "PSM.GFE", "PT": "PTM.GFE", "PX": "PX0.CZC",
    "RB": "RB0.SHF", "RI": "RI0.CZC", "RM": "RM0.CZC", "RR": "RR0.DCE", "RS": "RS0.CZC",
    "RU": "RU0.SHF", "SA": "SA0.CZC", "SC": "SCM.INE", "SF": "SF0.CZC", "SH": "SH0.CZC",
    "SI": "SIM.GFE", "SM": "SM0.CZC", "SN": "SN0.SHF", "SP": "SP0.SHF", "SR": "SR0.CZC",
    "SS": "SS0.SHF", "TA": "TA0.CZC", "T": "T0.CFE", "TF": "TF0.CFE", "TL": "TL0.CFE",
    "TS": "TS0.CFE", "UR": "UR0.CZC", "V": "V0.DCE", "WH": "WH0.CZC", "WR": "WR0.SHF",
    "Y": "Y0.DCE", "ZC": "ZC0.CZC", "ZN": "ZN0.SHF",
}

PROD_NAMES = {
    "C": "玉米", "CS": "淀粉", "WH": "强麦", "PM": "普麦", "RR": "粳米", "RI": "早籼稻",
    "JR": "粳稻", "LR": "晚籼稻", "A": "黄大豆1号", "B": "黄大豆2号", "M": "豆粕",
    "Y": "豆油", "RM": "菜籽粕", "OI": "菜籽油", "RS": "油菜籽", "PK": "花生", "P": "棕榈油",
    "SR": "白糖", "CF": "棉花", "CY": "棉纱", "LG": "原木", "SP": "纸浆", "OP": "双胶纸",
    "AP": "苹果", "CJ": "红枣", "LH": "生猪", "JD": "鸡蛋", "AU": "黄金", "AG": "白银",
    "PT": "铂", "PD": "钯", "CU": "沪铜", "BC": "国际铜", "AL": "沪铝", "AO": "氧化铝",
    "AD": "铝合金", "ZN": "沪锌", "PB": "沪铅", "NI": "沪镍", "SN": "沪锡", "LC": "碳酸锂",
    "PS": "多晶硅", "SI": "工业硅", "I": "铁矿石", "SF": "硅铁", "SM": "锰硅", "RB": "螺纹钢",
    "HC": "热卷", "SS": "不锈钢", "WR": "线材", "JM": "焦煤", "J": "煤炭", "ZC": "动力煤",
    "FG": "玻璃", "BB": "胶合板", "FB": "纤维板", "SC": "原油", "FU": "燃料油",
    "LU": "低硫燃料油", "PG": "液化石油气", "BU": "沥青", "TA": "PTA", "EG": "乙二醇",
    "PF": "短纤", "PR": "瓶片", "PL": "丙烯", "PP": "聚丙烯", "L": "塑料", "BZ": "纯苯",
    "PX": "对二甲苯", "EB": "苯乙烯", "RU": "天然橡胶", "BR": "丁二烯橡胶", "NR": "20号胶",
    "SA": "纯碱", "SH": "烧碱", "V": "PVC", "UR": "尿素", "MA": "甲醇", "EC": "航运指数",
    "IH": "上证50", "IF": "沪深300", "IC": "中证500", "IM": "中证1000", "MO": "中证1000期权",
    "TS": "2年期国债", "TF": "5年期国债", "T": "10年期国债", "TL": "30年期国债",
}

CHINESE_TO_TICKER = {
    "玉米": "C", "淀粉": "CS", "强麦": "WH", "普麦": "PM", "粳米": "RR", "早籼稻": "RI",
    "粳稻": "JR", "晚籼稻": "LR", "黄大豆1号": "A", "黄大豆2号": "B", "大豆1号": "A",
    "大豆2号": "B", "豆粕": "M", "豆油": "Y", "菜籽粕": "RM", "菜粕": "RM", "菜籽油": "OI",
    "菜油": "OI", "油菜籽": "RS", "花生": "PK", "棕榈油": "P", "白糖": "SR", "棉花": "CF",
    "棉纱": "CY", "原木": "LG", "纸浆": "SP", "双胶纸": "OP", "苹果": "AP", "红枣": "CJ",
    "生猪": "LH", "鸡蛋": "JD", "黄金": "AU", "白银": "AG", "铂": "PT", "钯": "PD",
    "沪铜": "CU", "铜": "CU", "国际铜": "BC", "沪铝": "AL", "铝": "AL", "氧化铝": "AO",
    "铝合金": "AD", "沪锌": "ZN", "锌": "ZN", "沪铅": "PB", "铅": "PB", "沪镍": "NI",
    "镍": "NI", "沪锡": "SN", "锡": "SN", "碳酸锂": "LC", "多晶硅": "PS", "工业硅": "SI",
    "铁矿石": "I", "铁矿": "I", "硅铁": "SF", "锰硅": "SM", "螺纹钢": "RB", "螺纹": "RB",
    "热卷": "HC", "热轧卷板": "HC", "不锈钢": "SS", "线材": "WR", "焦煤": "JM", "煤炭": "J",
    "焦炭": "J", "动力煤": "ZC", "玻璃": "FG", "胶合板": "BB", "纤维板": "FB", "原油": "SC",
    "燃料油": "FU", "低硫燃料油": "LU", "低硫油": "LU", "液化石油气": "PG", "液化气": "PG",
    "沥青": "BU", "石油沥青": "BU", "PTA": "TA", "乙二醇": "EG", "短纤": "PF", "瓶片": "PR",
    "丙烯": "PL", "聚丙烯": "PP", "塑料": "L", "线型低密度聚乙烯": "L", "纯苯": "BZ",
    "对二甲苯": "PX", "苯乙烯": "EB", "天然橡胶": "RU", "橡胶": "RU", "丁二烯橡胶": "BR",
    "20号胶": "NR", "纯碱": "SA", "烧碱": "SH", "PVC": "V", "尿素": "UR", "甲醇": "MA",
    "航运指数": "EC", "上证50": "IH", "沪深300": "IF", "中证500": "IC", "中证1000": "IM",
    "2年期国债": "TS", "5年期国债": "TF", "10年期国债": "T", "30年期国债": "TL", "国债": "T",
}

PROD_SECTOR = {
    "C": "农产", "CS": "农产", "WH": "农产", "PM": "农产", "RR": "农产", "RI": "农产",
    "JR": "农产", "LR": "农产", "A": "农产", "B": "农产", "M": "农产", "Y": "农产",
    "RM": "农产", "OI": "农产", "RS": "农产", "PK": "农产", "P": "农产", "SR": "农产",
    "CF": "农产", "CY": "农产", "LG": "农产", "SP": "农产", "OP": "农产",
    "AP": "生鲜", "CJ": "生鲜", "LH": "生鲜", "JD": "生鲜",
    "AU": "贵金属", "AG": "贵金属", "PT": "贵金属", "PD": "贵金属",
    "CU": "有色", "BC": "有色", "AL": "有色", "AO": "有色", "AD": "有色", "ZN": "有色",
    "PB": "有色", "NI": "有色", "SN": "有色",
    "LC": "新能源", "PS": "新能源", "SI": "新能源",
    "I": "黑色", "SF": "黑色", "SM": "黑色", "RB": "黑色", "HC": "黑色", "SS": "黑色",
    "WR": "黑色", "JM": "黑色", "J": "黑色", "ZC": "黑色", "FG": "黑色", "BB": "黑色",
    "FB": "黑色",
    "SC": "能源化工", "FU": "能源化工", "LU": "能源化工", "PG": "能源化工", "BU": "能源化工",
    "TA": "能源化工", "EG": "能源化工", "PF": "能源化工", "PR": "能源化工", "PL": "能源化工",
    "PP": "能源化工", "L": "能源化工", "BZ": "能源化工", "PX": "能源化工", "EB": "能源化工",
    "RU": "能源化工", "BR": "能源化工", "NR": "能源化工", "SA": "能源化工", "SH": "能源化工",
    "V": "能源化工", "UR": "能源化工", "MA": "能源化工",
    "EC": "航运",
    "IH": "股指", "IF": "股指", "IC": "股指", "IM": "股指", "MO": "股指",
    "TS": "国债", "TF": "国债", "T": "国债", "TL": "国债",
}

PROD_SUB_SECTOR = {
    "C": "谷物", "CS": "谷物", "WH": "谷物", "PM": "谷物", "RR": "谷物", "RI": "谷物",
    "JR": "谷物", "LR": "谷物", "A": "油脂油料", "B": "油脂油料", "M": "油脂油料",
    "Y": "油脂油料", "RM": "油脂油料", "OI": "油脂油料", "RS": "油脂油料", "PK": "油脂油料",
    "P": "油脂油料", "SR": "软商品", "CF": "软商品", "CY": "软商品", "LG": "林业",
    "SP": "林业", "OP": "林业", "AP": "生鲜", "CJ": "生鲜", "LH": "生鲜", "JD": "生鲜",
    "AU": "贵金属", "AG": "贵金属", "PT": "贵金属", "PD": "贵金属", "CU": "有色",
    "BC": "有色", "AL": "有色", "AO": "有色", "AD": "有色", "ZN": "有色", "PB": "有色",
    "NI": "有色", "SN": "有色", "LC": "新能源", "PS": "新能源", "SI": "新能源",
    "I": "原材", "SF": "原材", "SM": "原材", "RB": "成材", "HC": "成材", "SS": "成材",
    "WR": "成材", "JM": "煤炭", "J": "煤炭", "ZC": "煤炭", "FG": "建材", "BB": "建材",
    "FB": "建材", "SC": "油品", "FU": "油品", "LU": "油品", "PG": "油品", "BU": "油品",
    "TA": "聚酯", "EG": "聚酯", "PF": "聚酯", "PR": "聚酯", "PL": "烯烃", "PP": "烯烃",
    "L": "烯烃", "BZ": "芳烃", "PX": "芳烃", "EB": "芳烃", "RU": "橡胶", "BR": "橡胶",
    "NR": "橡胶", "SA": "盐化工", "SH": "盐化工", "V": "盐化工", "UR": "煤化工",
    "MA": "煤化工", "EC": "航运", "IH": "股指", "IF": "股指", "IC": "股指", "IM": "股指",
    "MO": "股指", "TS": "国债", "TF": "国债", "T": "国债", "TL": "国债",
}

_CN_FONT: FontProperties | None = None


def num_expr(col: str) -> str:
    return (
        f"COALESCE(NULLIF(REPLACE(REPLACE(COALESCE(\"{col}\"::text, ''), ',', ''), "
        f"' ', ''), '')::numeric, 0)"
    )


def get_prefix(contract: str) -> str:
    if not contract:
        return contract
    c = str(contract).strip()
    m = re.match(r"^[A-Za-z]+", c)
    if m:
        return m.group(0).upper()
    if c in CHINESE_TO_TICKER:
        return CHINESE_TO_TICKER[c]
    stripped = re.sub(r"\d+$", "", c).strip()
    if stripped and stripped in CHINESE_TO_TICKER:
        return CHINESE_TO_TICKER[stripped]
    best = ""
    best_ticker = c.upper()
    for cn, ticker in CHINESE_TO_TICKER.items():
        if c.startswith(cn) and len(cn) > len(best):
            best = cn
            best_ticker = ticker
    return best_ticker if best else c.upper()


def prod_label(prod: str) -> str:
    cn = PROD_NAMES.get(prod)
    return f"{prod}（{cn}）" if cn else prod


def sector_of(prod: str) -> str:
    return PROD_SECTOR.get(prod, "其他")


def sub_of(prod: str) -> str:
    return PROD_SUB_SECTOR.get(prod, "其他")


def to_num(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(str(v).replace(",", "").replace("%", "").replace(" ", ""))
    except (TypeError, ValueError):
        return 0.0


def zero_rollover_spikes(rets: np.ndarray) -> np.ndarray:
    out = rets.astype(float).copy()
    n = len(out)
    if n < 2:
        return out
    min_thr, k, lookback = 0.06, 12.0, 40
    for i in range(lookback, n):
        win = np.sort(np.abs(out[i - lookback : i]))
        med = win[len(win) // 2]
        devs = np.sort(np.abs(win - med))
        mad = devs[len(devs) // 2]
        thr = max(min_thr, med + k * mad * 1.4826)
        if abs(rets[i]) > thr:
            out[i] = 0.0
    return out


def floor_index(arr: list[str], target: str) -> int:
    lo, hi, idx = 0, len(arr) - 1, -1
    while lo <= hi:
        mid = (lo + hi) >> 1
        if arr[mid] <= target:
            idx = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return idx


def std_sample(xs: np.ndarray) -> float:
    xs = xs[np.isfinite(xs)]
    if len(xs) < 2:
        return 0.0
    return float(np.std(xs, ddof=1))


def max_drawdown(nav: np.ndarray) -> float:
    peak = np.maximum.accumulate(nav)
    dd = (peak - nav) / np.where(peak > 0, peak, np.nan)
    return float(np.nanmax(dd)) if len(dd) else 0.0


def downside_std(rets: np.ndarray) -> float:
    neg = rets[rets < 0]
    if len(neg) < 2:
        return 0.0
    return float(np.sqrt(np.mean(neg**2)))


def ann_stats(rets: np.ndarray) -> dict:
    rets = np.asarray(rets, dtype=float)
    rets = rets[np.isfinite(rets)]
    empty = {
        "ann_ret": 0.0, "ann_vol": 0.0, "sharpe": 0.0, "mdd": 0.0, "calmar": 0.0,
        "daily_vol": 0.0, "down_vol": 0.0, "up_vol": 0.0, "sortino": 0.0,
        "abs_mean": 0.0, "p05": 0.0, "p95": 0.0,
    }
    if len(rets) < 2:
        return empty
    mu = float(np.mean(rets))
    vol = float(np.std(rets, ddof=1))
    nav = np.cumprod(1.0 + rets)
    mdd = max_drawdown(np.concatenate([[1.0], nav]))
    ann_ret = mu * 252
    ann_vol = vol * math.sqrt(252)
    sharpe = ann_ret / ann_vol if ann_vol > 1e-12 else 0.0
    calmar = ann_ret / mdd if mdd > 1e-12 else 0.0
    down = downside_std(rets)
    up = downside_std(-rets)
    sortino = ann_ret / (down * math.sqrt(252)) if down > 1e-12 else 0.0
    return {
        "ann_ret": ann_ret,
        "ann_vol": ann_vol,
        "sharpe": sharpe,
        "mdd": mdd,
        "calmar": calmar,
        "daily_vol": vol,
        "down_vol": down * math.sqrt(252),
        "up_vol": up * math.sqrt(252),
        "sortino": sortino,
        "abs_mean": float(np.mean(np.abs(rets))),
        "p05": float(np.quantile(rets, 0.05)),
        "p95": float(np.quantile(rets, 0.95)),
    }


def wan(x: float) -> str:
    return f"{x / 1e4:,.1f}"


def pct(x: float, digits: int = 1) -> str:
    return f"{x * 100:.{digits}f}%"


def signed_wan(x: float) -> str:
    v = x / 1e4
    return f"{v:+,.1f}" if v != 0 else "0.0"


def configure_matplotlib() -> None:
    global _CN_FONT
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["figure.facecolor"] = "white"
    plt.rcParams["axes.facecolor"] = "white"
    plt.rcParams["axes.edgecolor"] = "#CBD5E0"
    for path in (
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
    ):
        if os.path.isfile(path):
            try:
                fontManager.addfont(path)
                _CN_FONT = FontProperties(fname=path)
                plt.rcParams["font.family"] = "sans-serif"
                plt.rcParams["font.sans-serif"] = [_CN_FONT.get_name(), "Microsoft YaHei", "SimHei"]
                return
            except Exception:
                continue
    _CN_FONT = FontProperties(family="Microsoft YaHei")


def fp() -> dict:
    return {"fontproperties": _CN_FONT} if _CN_FONT is not None else {}


def set_run_font(run, *, size=11, bold=False, color=None, name="微软雅黑"):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def add_text(p, text, *, size=11, bold=False, color=None):
    run = p.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color)
    return run


def para(doc, text="", *, size=11, bold=False, color=None, align=None, space_after=8, space_before=0):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.line_spacing = 1.22
    if align:
        p.alignment = align
    if text:
        add_text(p, text, size=size, bold=bold, color=color or TEXT)
    return p


def heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        set_run_font(run, size=16 if level == 1 else 13 if level == 2 else 12, bold=True, color=NAVY)
    return p


def shade(cell, hex_color: str):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


def set_cell_border(cell):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "CBD5E0")
        tcBorders.append(el)
    tcPr.append(tcBorders)


def cell_text(cell, text, *, size=9, bold=False, color=None, align="center"):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.alignment = {
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
        "left": WD_ALIGN_PARAGRAPH.LEFT,
    }.get(align, WD_ALIGN_PARAGRAPH.CENTER)
    add_text(p, "" if text is None else str(text), size=size, bold=bold, color=color)
    set_cell_border(cell)


def add_table(doc, headers, rows, col_widths=None):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    for i, h in enumerate(headers):
        cell_text(table.rows[0].cells[i], h, size=8, bold=True, color=WHITE)
        shade(table.rows[0].cells[i], "1A365D")
    for r_i, row in enumerate(rows):
        fill = "F7FAFC" if r_i % 2 == 0 else "FFFFFF"
        for c_i, val in enumerate(row):
            cell_text(table.rows[r_i + 1].cells[c_i], val, size=8, color=TEXT, align="center")
            shade(table.rows[r_i + 1].cells[c_i], fill)
    if col_widths:
        for row in table.rows:
            for i, w in enumerate(col_widths):
                row.cells[i].width = Cm(w)
    return table


def add_picture(doc, path: Path, width_in=6.3):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(2)
    p.add_run().add_picture(str(path), width=Inches(width_in))
    return p


def caption(doc, text: str):
    para(doc, text, size=8, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)


def _add_field(run, instr: str, placeholder: str = "1"):
    r = run._r
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    text = OxmlElement("w:instrText")
    text.set(qn("xml:space"), "preserve")
    text.text = f" {instr} "
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    result = OxmlElement("w:t")
    result.text = placeholder
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    r.append(begin)
    r.append(text)
    r.append(sep)
    r.append(result)
    r.append(end)


def add_page_numbers(doc):
    for section in doc.sections:
        footer = section.footer
        footer.is_linked_to_previous = False
        p = footer.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(4)
        add_text(p, "MOM 集中度风控  ·  ", size=8, color=MUTED)
        run_page = p.add_run()
        set_run_font(run_page, size=8, color=MUTED)
        _add_field(run_page, "PAGE", "1")
        add_text(p, " / ", size=8, color=MUTED)
        run_n = p.add_run()
        set_run_font(run_n, size=8, color=MUTED)
        _add_field(run_n, "NUMPAGES", "1")


def update_fields_on_open(doc):
    """Ask Word to refresh PAGE/NUMPAGES when the file is opened."""
    settings = doc.settings.element
    existing = settings.find(qn("w:updateFields"))
    if existing is None:
        el = OxmlElement("w:updateFields")
        el.set(qn("w:val"), "true")
        settings.append(el)


def freeze_page_numbers(path: Path):
    """If Word is installed, compute PAGE/NUMPAGES so the footer is not 1/1."""
    try:
        import win32com.client  # type: ignore
    except ImportError:
        return
    word = None
    try:
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0
        doc = word.Documents.Open(str(path.resolve()), ReadOnly=False)
        doc.Fields.Update()
        for section in doc.Sections:
            for i in range(1, 4):
                try:
                    section.Footers(i).Range.Fields.Update()
                except Exception:
                    pass
        doc.Repaginate()
        doc.Save()
        doc.Close(False)
        print("updated page fields", path.name)
    except Exception as exc:
        print("page-number update skipped:", exc)
    finally:
        if word is not None:
            try:
                word.Quit()
            except Exception:
                pass


def set_narrow_margins(doc):
    for s in doc.sections:
        s.top_margin = Cm(1.8)
        s.bottom_margin = Cm(2.2)
        s.left_margin = Cm(2.0)
        s.right_margin = Cm(2.0)
        s.footer_distance = Cm(1.0)


def explain_rule_spec(s: dict) -> str:
    """Human-readable decoding of a backtest spec / short label."""
    kind = s.get("kind")
    if kind == "pred_vol":
        uni = (
            "只缩热门品种（碳酸锂 LC、工业硅 SI、多晶硅 PS、黄金 AU、白银 AG、铂 PT、钯 PD、沪铜 CU）"
            if s.get("universe")
            else "整本书按同一比例缩放"
        )
        tgt = s.get("target") or 0
        return f"沙盒预测年化波动超过 {tgt:.0%} 时，按「目标/预测」压缩仓位；{uni}。T+1 生效。"
    if kind == "real_vol":
        tgt = s.get("target") or 0
        return f"已实现 20 日年化波动超过 {tgt:.0%} 时，整本书按「目标/实现波动」压缩。T+1 生效。"
    if kind == "prod_mv_cap":
        prods = "、".join(s.get("products") or ["指定品种"])
        cap = s.get("cap_frac") or 0
        return f"{prods} |净市值| 不得超过累计净资本的 {cap:.0%}；超限按比例压缩。"
    if kind == "sector_mv_cap":
        secs = "、".join(s.get("sectors") or ["指定板块"])
        cap = s.get("cap_frac") or 0
        return f"{secs} 板块 |净市值| 不得超过累计净资本的 {cap:.0%}。"
    if kind == "combo":
        cap = s.get("cap_frac") or 0
        vt = s.get("vol_target") or 0
        uni = "再按预测波动缩热门" if s.get("universe") else "再按预测波动缩全书"
        return (
            f"碳酸锂 |净市值| < 累计净资本 {cap:.0%}；"
            f"若预测年化波动仍超过 {vt:.0%}，{uni}（目标 {vt:.0%}）。"
        )

    bits = []
    mode = s.get("mode", "mcr")
    metric = {"mcr": "MCR", "sub_mcr": "MCR（板块用细分分类）", "mv": "|净市值|/累计净资本"}.get(mode, mode)
    p, sec = s.get("prod_cap"), s.get("sector_cap")
    if s.get("soft_prod_cap") is not None:
        bits.append(
            f"软顶（只对亏损品种）：品种 {s['soft_prod_cap']:.0%}"
            f"/板块 {s.get('soft_sector_cap') or 0:.0%}；"
            f"硬顶（任何人超限都砍）：品种 {s.get('hard_prod_cap') or 0:.0%}"
            f"/板块 {s.get('hard_sector_cap') or 0:.0%}。"
        )
    else:
        if p is not None and sec is not None:
            bits.append(f"限额：单品种{metric}<{p:.0%} 且 单板块{metric}<{sec:.0%}。")
        elif p is not None:
            bits.append(f"限额：仅单品种{metric}<{p:.0%}。")
        elif sec is not None:
            bits.append(f"限额：仅单板块{metric}<{sec:.0%}。")
    if s.get("prod_allow"):
        labs = "、".join(prod_label(p) for p in s["prod_allow"])
        bits.append(f"品种腿只盯 {labs}，其他品种即使超限也不砍。")
    if s.get("sector_allow"):
        bits.append(
            f"板块腿只盯 {'、'.join(s['sector_allow'])}；"
            "超限时压缩该板块内全部品种（贵金属含铂钯，生鲜含苹果/红枣）。"
        )

    if s.get("loser_only"):
        lb = int(s.get("loser_lb") or 5)
        thr = s.get("loser_ret_thr")
        if thr is not None:
            bits.append(f"只砍近{lb}日收益 < {thr:.0%} 的超限品种。")
        else:
            bits.append(f"只砍近{lb}日估算盈亏为负的超限品种（L{lb}）。")
    if s.get("winner_only"):
        lb = int(s.get("loser_lb") or 5)
        bits.append(f"只砍近{lb}日估算盈亏为正的超限品种（对照）。")
    if s.get("var_q"):
        vm = "扩张窗口" if s.get("var_mode") == "expanding" else "全样本"
        bits.append(f"仅当组合 VaR/权益 ≥ {vm} {s['var_q']:.0%} 分位时启动。")
    if s.get("var_abs"):
        bits.append(f"仅当组合 VaR/权益 ≥ {s['var_abs']:.1%} 时启动。")
    if s.get("port_loser"):
        bits.append(f"仅当组合近{int(s.get('port_lb') or 5)}日估算盈亏为负时启动。")
    if s.get("dd_min"):
        bits.append(f"仅当官方净值回撤 ≥ {s['dd_min']:.0%} 时启动。")
    if s.get("stress_full"):
        bits.append(
            f"平时只砍亏；VaR/权益 ≥ {s.get('stress_var_abs') or 0:.1%} 时改为超限全砍。"
        )
    if not bits:
        return s.get("name") or s.get("short") or ""
    return "".join(bits)


def abbrev_token_rows() -> list[list[str]]:
    return [
        ["MCR", "边际风险贡献（Marginal Contribution to Risk）。品种 i：|dv_i × (Corr@dv)_i|，再除以组合加总得到份额。"],
        ["30/50 金银猪蛋", "MCR 30/50，但品种腿只盯金/银/生猪/鸡蛋，板块腿只盯贵金属/生鲜。锂、能化、股指超限不动。"],
        ["仅品种 a", "只设单品种限额 a%，不设板块限额。"],
        ["仅板块 b", "只设单板块限额 b%，不设品种限额。"],
        ["市值 a/b", "用 |净市值|/累计净资本 代替 MCR 做限额。"],
        ["细分", "板块聚合改用更细的分类（如新能源拆开），限额写在第二位，如「品种25+细分40」。"],
        ["Ln / 只砍亏", "只干预近 n 个交易日估算盈亏为负的超限品种。正文「只砍亏」= L5。"],
        ["只砍盈", "对照：只砍近 5 日估算盈利的超限品种。"],
        ["L5ret-k", "近 5 日收益 < −k% 才砍（比「估算盈亏为负」更严）。"],
        ["VQxx", "仅当组合 VaR/权益 ≥ 全样本 xx% 分位的日子才启动限额。"],
        ["VQxx扩", "同上，分位用扩张窗口（无前视），可落地。"],
        ["Vx.x / V2.5", "仅当组合 VaR/权益 ≥ x.x%（绝对门槛）才启动。"],
        ["高VaR", "正文简称，等同 VQ60（全样本 60% 分位）。"],
        ["DD≥x% / DDx", "仅当官方净值从高点回撤 ≥ x% 时启动。例：DD5 = 回撤 5%。"],
        ["L5+DD5", "同时满足「近 5 日品种亏损」和「净值回撤 ≥ 5%」。加号 = 且。"],
        ["L5+VQxx", "同时满足 L5 与高 VaR 分位。"],
        ["组合亏 n 日", "组合（不是单品种）近 n 日估算盈亏为负才启动。"],
        ["软 a 硬 b", "亏损品种按软顶 a 压缩；任何人（含盈利）超过硬顶 b 都压缩。"],
        ["压 x% 全砍", "平时只砍亏；VaR/权益 ≥ x% 的压力日改为超限全砍。"],
        ["预测波 x% 全书", "沙盒预测年化波动 > x% 时，整本书缩到 x%。"],
        ["预测波 x% 热门", "同上，但只缩锂/硅/贵金属/铜等尖峰品种。"],
        ["实现波 x%", "用已实现 20 日年化波动代替预测波动做同一套缩放。"],
        ["锂市值 x%", "碳酸锂 |净市值| < 累计净资本的 x%。"],
        ["新能源市值 x%", "新能源板块 |净市值| < 累计净资本的 x%。"],
        ["T+1", "T 日收盘后算信号，次日开盘按比例缩放（本回测一律如此）。"],
        ["k", "压缩系数，通常 k = 限额 / 当前份额，仓位乘 k。"],
        ["VaR", "组合 95% 一日风险价值，来自日间风控沙盒。"],
        ["NAV", "官方累计单位净值。"],
        ["MDD", "最大回撤。"],
        ["夏普", "年化收益 / 年化波动（无风险利率按 0）。"],
        ["Calmar", "年化收益 / 最大回撤。"],
        ["净效果", "规则后累计盈亏 − 实际累计盈亏 = 避免亏损 − 让渡盈利。"],
        ["避免 / 让渡", "砍仓后少亏的钱 / 砍仓后少赚的钱。"],
        ["RX000", "组合层对冲账户；可用同一套 k 而不改投顾指令。"],
        ["LC/SI/PS/AU/AG/CU", "碳酸锂 / 工业硅 / 多晶硅 / 黄金 / 白银 / 沪铜。PT/PD 为铂/钯。"],
        ["热门", "制造 2026-01–04 波动尖峰的品种：锂、硅、贵金属、铜。"],
        ["沙盒", "日间风控 VaR 沙盒，计算 MCR 与预测波动的引擎。"],
        ["累计净资本", "官方资金曲线分母，市值占比、锂硬顶都用它。"],
        ["Q1 / 1–4月", "本报告窗口：2026-01-01 至 2026-04-30 的波动尖峰段。"],
    ]


_FAMILY_LABEL = {
    "grid": "限额网格",
    "mv": "市值限额",
    "cond": "带条件限额",
    "vol": "波动/市值缩放",
    "scoped": "限定品种/板块",
}


def _abbrev_rule_rows(results) -> list[list[str]]:
    rows = []
    seen = set()
    for r in results:
        s = r["spec"] if isinstance(r, dict) and "spec" in r else r
        short = s.get("short") or ""
        if not short or short in seen:
            continue
        seen.add(short)
        fam = _FAMILY_LABEL.get(s.get("family") or "", s.get("family") or "")
        rows.append([short, fam, s.get("name") or "", explain_rule_spec(s)])
    return rows


def write_abbrev_appendix(doc, alts, vol_bts):
    doc.add_page_break()
    heading(doc, "附录、简称与术语对照", 1)
    para(
        doc,
        "正文图表为排版把规则写成「MCR 25/45 L5+DD5」这类缩写。"
        "先读 A.1 的构词规则，再在 A.2 按简称查完整定义。加号表示同时满足（且），斜杠表示品种限额/板块限额。",
    )

    heading(doc, "A.1 构词与通用术语", 2)
    add_table(
        doc,
        ["简称 / 词素", "含义"],
        abbrev_token_rows(),
        col_widths=[4.2, 12.5],
    )
    caption(doc, "表 A.1  正文缩写的构词规则。Ln、VQxx、DDx 可与 MCR a/b 任意组合。")

    heading(doc, "A.2 本报告出现的规则简称", 2)
    para(
        doc,
        "下表覆盖限额网格、条件规则与第六节波动规则的全部 short 标签，与脚本 spec['short'] 一一对应。",
        size=10,
        color=MUTED,
    )
    rule_rows = _abbrev_rule_rows(list(alts or []) + list(vol_bts or []))
    add_table(
        doc,
        ["简称", "类别", "全称", "定义"],
        rule_rows,
        col_widths=[3.4, 2.4, 4.6, 6.3],
    )
    caption(doc, f"表 A.2  回测规则简称一览（共 {len(rule_rows)} 条）。")


# ── data + MCR ──────────────────────────────────────────────────────────────


def rebuild_mom_nav(dates, pnl, flows):
    """Same recursion as /ma/api/mom-analysis/product-nav."""
    nav = 1.0
    capital = 0.0
    navs, rets, prev_caps, caps = [], [], [], []
    for p, f in zip(pnl, flows):
        prev = capital
        ret = (p / prev) if prev > 0 else 0.0
        nav *= 1.0 + ret
        capital = capital + f + p
        navs.append(nav)
        rets.append(ret)
        prev_caps.append(prev)
        caps.append(capital)
    return {
        "dates": list(dates),
        "nav": np.asarray(navs, dtype=float),
        "ret": np.asarray(rets, dtype=float),
        "pnl": np.asarray(pnl, dtype=float),
        "flow": np.asarray(flows, dtype=float),
        "prev_capital": np.asarray(prev_caps, dtype=float),
        "capital": np.asarray(caps, dtype=float),
    }


def mom_nav_stats(nav: np.ndarray, daily_rets: np.ndarray) -> dict:
    """Match 风险日报净值曲线 KPI: CAGR, population vol, Sharpe = CAGR/vol."""
    nav = np.asarray(nav, dtype=float)
    daily_rets = np.asarray(daily_rets, dtype=float)
    n = len(nav)
    empty = {
        "ann_ret": 0.0, "ann_vol": 0.0, "sharpe": 0.0, "mdd": 0.0, "calmar": 0.0,
        "daily_vol": 0.0, "down_vol": 0.0, "up_vol": 0.0, "sortino": 0.0,
        "abs_mean": 0.0, "p05": 0.0, "p95": 0.0, "total_ret": 0.0,
    }
    if n < 2:
        return empty
    start = nav[0] if nav[0] > 0 else 1.0
    nav_n = nav / start
    total_ret = float(nav_n[-1] - 1.0)
    years = n / 252.0
    ann_ret = float(nav_n[-1] ** (1.0 / years) - 1.0) if years > 0 and nav_n[-1] > 0 else 0.0
    mean = float(np.mean(daily_rets))
    var = float(np.mean((daily_rets - mean) ** 2))
    daily_vol = math.sqrt(var)
    ann_vol = daily_vol * math.sqrt(252)
    sharpe = ann_ret / ann_vol if ann_vol > 1e-12 else 0.0
    mdd = max_drawdown(nav_n)
    calmar = ann_ret / mdd if mdd > 1e-12 else 0.0
    neg = daily_rets[daily_rets < 0]
    pos = daily_rets[daily_rets > 0]
    down = math.sqrt(float(np.mean(neg**2))) if len(neg) else 0.0
    up = math.sqrt(float(np.mean(pos**2))) if len(pos) else 0.0
    down_vol = down * math.sqrt(252)
    up_vol = up * math.sqrt(252)
    sortino = ann_ret / down_vol if down_vol > 1e-12 else 0.0
    return {
        "ann_ret": ann_ret,
        "ann_vol": ann_vol,
        "sharpe": sharpe,
        "mdd": mdd,
        "calmar": calmar,
        "daily_vol": daily_vol,
        "down_vol": down_vol,
        "up_vol": up_vol,
        "sortino": sortino,
        "abs_mean": float(np.mean(np.abs(daily_rets))),
        "p05": float(np.quantile(daily_rets, 0.05)),
        "p95": float(np.quantile(daily_rets, 0.95)),
        "total_ret": total_ret,
    }


def load_official_mom_nav(conn) -> dict:
    """Reproduce the MOM 净值曲线 series (not 客户权益之和)."""
    cur = conn.cursor()
    cur.execute(
        f"""
        SELECT "交易日期"::text,
               SUM({num_expr("当日盈亏")} - {num_expr("当日手续费")}
                   + {num_expr("权利金收入")} - {num_expr("权利金支出")})::text
        FROM mom_daily_reports
        GROUP BY 1 ORDER BY 1
        """
    )
    pnl_map = {d: to_num(v) for d, v in cur.fetchall()}
    try:
        cur.execute(
            """
            SELECT trade_date::text,
                   (COALESCE(realized_pl,0)+COALESCE(mtm_pl,0)+COALESCE(exercise_pl,0)
                    -COALESCE(commission,0))::text
            FROM guosen_account_summary
            WHERE client_id = '665300200077'
            """
        )
        for d, v in cur.fetchall():
            pnl_map[d] = pnl_map.get(d, 0.0) - to_num(v)
    except Exception:
        conn.rollback()
    flow_map: dict[str, float] = defaultdict(float)
    try:
        cur.execute(
            """
            SELECT confirmation_date::date::text,
                   SUM(CASE
                     WHEN transaction_type IN ('认购确认', '申购确认') THEN
                       COALESCE(confirmed_amount,0)-COALESCE(handling_fee,0)-COALESCE(performance_fee,0)
                     WHEN transaction_type IN ('赎回确认', '分红确认') THEN
                       -(COALESCE(confirmed_amount,0)+COALESCE(handling_fee,0)+COALESCE(performance_fee,0))
                     ELSE 0 END)::text
            FROM mom_fund_transactions
            WHERE transaction_type IN ('认购确认','申购确认','赎回确认','分红确认')
              AND confirmation_date IS NOT NULL
            GROUP BY 1
            """
        )
        for d, v in cur.fetchall():
            flow_map[d] += to_num(v)
    except Exception:
        conn.rollback()
    try:
        cur.execute(
            """
            SELECT flow_date::date::text, SUM(net_flow)::text
            FROM mom_manual_capital_flows
            GROUP BY 1
            """
        )
        for d, v in cur.fetchall():
            flow_map[d] += to_num(v)
    except Exception:
        conn.rollback()
    dates = sorted(set(pnl_map) | set(flow_map))
    pnl = [pnl_map.get(d, 0.0) for d in dates]
    flows = [flow_map.get(d, 0.0) for d in dates]
    out = rebuild_mom_nav(dates, pnl, flows)
    st = mom_nav_stats(out["nav"], out["ret"])
    print(
        f"official MOM nav last={out['nav'][-1]:.4f} "
        f"cum={st['total_ret']*100:.2f}% ann={st['ann_ret']*100:.2f}% "
        f"vol={st['ann_vol']*100:.2f}% mdd={st['mdd']*100:.2f}% sharpe={st['sharpe']:.2f} "
        f"n={len(dates)} {dates[0]}->{dates[-1]}"
    )
    return out


def load_raw():
    print("connecting", DB_URL.split("@")[-1])
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    cur.execute(
        f"""
        SELECT "交易日期"::text AS d, UPPER(TRIM("合约")) AS contract,
               SUM(CASE WHEN {num_expr("买持仓")} > 0
                        THEN {num_expr("持仓市値")}
                        ELSE -{num_expr("持仓市値")} END)::text AS mv
        FROM mom_position_details
        WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
          AND {ACCT_FILTER}
          AND UPPER(TRIM("合约")) !~ '[0-9][CP][0-9]'
          AND TRIM("合约") NOT LIKE '%-%-%'
        GROUP BY 1, 2
        ORDER BY 1
        """
    )
    pos_rows = cur.fetchall()
    cur.execute(
        f"""
        SELECT "交易日期"::text AS d,
               SUM({num_expr("当日盈亏")} - {num_expr("当日手续费")}
                   + {num_expr("权利金收入")} - {num_expr("权利金支出")})::text AS pnl,
               SUM({num_expr("客户权益")})::text AS equity
        FROM mom_daily_reports
        WHERE "交易日期" IS NOT NULL AND {ACCT_FILTER}
        GROUP BY 1
        ORDER BY 1
        """
    )
    pnl_rows = cur.fetchall()
    cur.execute(
        """
        SELECT trade_date::text, code, pct_change::text
        FROM raw_akshare_futures_daily
        WHERE pct_change IS NOT NULL
        ORDER BY trade_date
        """
    )
    px_rows = cur.fetchall()
    conn.close()
    print(f"loaded pos={len(pos_rows)} pnl={len(pnl_rows)} px={len(px_rows)}")
    return pos_rows, pnl_rows, px_rows


def build_panels(pos_rows, pnl_rows, px_rows):
    prod_mv: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    dates = set()
    for d, contract, mv in pos_rows:
        prod = get_prefix(contract)
        v = to_num(mv)
        if not d or not prod:
            continue
        prod_mv[prod][d] += v
        dates.add(d)
    trading_dates = sorted(dates)

    pnl_map, eq_map = {}, {}
    for d, pnl, eq in pnl_rows:
        pnl_map[d] = to_num(pnl)
        eq_map[d] = to_num(eq)

    pct_map: dict[str, dict[str, float]] = defaultdict(dict)
    for d, code, pct in px_rows:
        pct_map[code][d] = to_num(pct) / 100.0
    mkt_dates = sorted({d for m in pct_map.values() for d in m})
    return prod_mv, trading_dates, pnl_map, eq_map, pct_map, mkt_dates


def compute_history(prod_mv, trading_dates, pct_map, mkt_dates):
    needed = VOL_DAYS + CORR_MIN
    codes = sorted({AKSHARE_CODE[p] for p in prod_mv if p in AKSHARE_CODE})
    clean = {}
    raw_mat = {}
    for code in codes:
        raw = np.array([pct_map.get(code, {}).get(d, 0.0) for d in mkt_dates], dtype=float)
        raw_mat[code] = raw
        clean[code] = zero_rollover_spikes(raw)

    days = []
    for date in trading_dates:
        mkt_idx = floor_index(mkt_dates, date)
        if mkt_idx < needed:
            continue
        corr_len = min(CORR_DAYS, mkt_idx)
        items = []
        for prod, by_d in prod_mv.items():
            if prod not in AKSHARE_CODE:
                continue
            mv = by_d.get(date, 0.0)
            if abs(mv) >= MV_MIN:
                items.append((prod, mv))
        if len(items) < 2:
            continue
        items.sort(key=lambda x: -abs(x[1]))
        prods = [p for p, _ in items]
        mvs = np.array([v for _, v in items], dtype=float)
        n = len(prods)
        sigmas = np.zeros(n)
        for i, prod in enumerate(prods):
            code = AKSHARE_CODE[prod]
            sl = clean[code][mkt_idx - VOL_DAYS : mkt_idx]
            sl = sl[sl != 0]
            sigmas[i] = std_sample(sl)
        ret_win = np.zeros((corr_len, n))
        for i, prod in enumerate(prods):
            ret_win[:, i] = raw_mat[AKSHARE_CODE[prod]][mkt_idx - corr_len : mkt_idx]
        with np.errstate(invalid="ignore", divide="ignore"):
            corr = np.corrcoef(ret_win, rowvar=False)
        corr = np.nan_to_num(corr, nan=0.0, posinf=0.0, neginf=0.0)
        np.fill_diagonal(corr, 1.0)
        dv = sigmas * mvs
        cov_sum = corr @ dv
        mcr = np.abs(dv * cov_sum)
        mcr[mcr < 1] = 0.0
        total = float(mcr.sum())
        if total <= 0:
            continue
        prod_pct = {prods[i]: float(mcr[i] / total) for i in range(n) if mcr[i] > 0}
        sector_raw: dict[str, float] = defaultdict(float)
        sub_raw: dict[str, float] = defaultdict(float)
        for i, prod in enumerate(prods):
            if mcr[i] <= 0:
                continue
            sector_raw[sector_of(prod)] += float(mcr[i])
            sub_raw[sub_of(prod)] += float(mcr[i])
        sector_pct = {k: v / total for k, v in sector_raw.items()}
        sub_pct = {k: v / total for k, v in sub_raw.items()}
        port_var = float(dv @ corr @ dv)
        port_sigma = math.sqrt(port_var) if port_var > 0 else 0.0
        gross = float(np.abs(mvs).sum())
        mv_share = {prods[i]: abs(mvs[i]) / gross for i in range(n)} if gross > 0 else {}
        sector_mv: dict[str, float] = defaultdict(float)
        for i, prod in enumerate(prods):
            sector_mv[sector_of(prod)] += abs(mvs[i])
        sector_mv_share = {k: v / gross for k, v in sector_mv.items()} if gross > 0 else {}
        days.append(
            {
                "date": date,
                "prods": prods,
                "mvs": mvs,
                "sigmas": sigmas,
                "prod_mcr": prod_pct,
                "sector_mcr": sector_pct,
                "sub_mcr": sub_pct,
                "mv_share": mv_share,
                "sector_mv_share": sector_mv_share,
                "port_sigma": port_sigma,
                "var95": Z95 * port_sigma,
                "gross_mv": gross,
                "n_prod": n,
            }
        )
    print(f"mcr days={len(days)} first={days[0]['date'] if days else '-'} last={days[-1]['date'] if days else '-'}")
    return days


def next_return(pct_map, mkt_dates, prod: str, date: str) -> float:
    code = AKSHARE_CODE.get(prod)
    if not code:
        return 0.0
    idx = floor_index(mkt_dates, date)
    if idx < 0 or idx + 1 >= len(mkt_dates):
        return 0.0
    nxt = mkt_dates[idx + 1]
    return float(pct_map.get(code, {}).get(nxt, 0.0))


def scale_factors(
    day: dict,
    prod_cap: float | None,
    sector_cap: float | None,
    *,
    mode="mcr",
    prod_allow=None,
    sector_allow=None,
) -> dict[str, float]:
    k = {p: 1.0 for p in day["prods"]}
    allow_p = set(prod_allow) if prod_allow else None
    allow_s = set(sector_allow) if sector_allow else None
    if mode == "mcr":
        if prod_cap is not None:
            for p, share in day["prod_mcr"].items():
                if allow_p is not None and p not in allow_p:
                    continue
                if share > prod_cap and share > 0:
                    k[p] = min(k[p], prod_cap / share)
        if sector_cap is not None:
            for sec, share in day["sector_mcr"].items():
                if allow_s is not None and sec not in allow_s:
                    continue
                if share > sector_cap and share > 0:
                    ks = sector_cap / share
                    for p in day["prods"]:
                        if sector_of(p) == sec:
                            k[p] = min(k[p], ks)
    elif mode == "mv":
        if prod_cap is not None:
            for p, share in day["mv_share"].items():
                if allow_p is not None and p not in allow_p:
                    continue
                if share > prod_cap and share > 0:
                    k[p] = min(k[p], prod_cap / share)
        if sector_cap is not None:
            for sec, share in day["sector_mv_share"].items():
                if allow_s is not None and sec not in allow_s:
                    continue
                if share > sector_cap and share > 0:
                    ks = sector_cap / share
                    for p in day["prods"]:
                        if sector_of(p) == sec:
                            k[p] = min(k[p], ks)
    elif mode == "sub_mcr":
        if prod_cap is not None:
            for p, share in day["prod_mcr"].items():
                if allow_p is not None and p not in allow_p:
                    continue
                if share > prod_cap and share > 0:
                    k[p] = min(k[p], prod_cap / share)
        if sector_cap is not None:
            for sub, share in day["sub_mcr"].items():
                if allow_s is not None and sub not in allow_s:
                    continue
                if share > sector_cap and share > 0:
                    ks = sector_cap / share
                    for p in day["prods"]:
                        if sub_of(p) == sub:
                            k[p] = min(k[p], ks)
    return k


def trailing_prod_pnl(days, idx: int, prod: str, lookback: int, pct_map, mkt_dates) -> float:
    s = 0.0
    for j in range(max(0, idx - lookback), idx):
        d = days[j]
        if prod not in d["prods"]:
            continue
        mv = float(d["mvs"][d["prods"].index(prod)])
        s += mv * next_return(pct_map, mkt_dates, prod, d["date"])
    return s


def trailing_prod_ret(days, idx: int, prod: str, lookback: int, pct_map, mkt_dates) -> float:
    pnl = 0.0
    notion = 0.0
    for j in range(max(0, idx - lookback), idx):
        d = days[j]
        if prod not in d["prods"]:
            continue
        mv = float(d["mvs"][d["prods"].index(prod)])
        pnl += mv * next_return(pct_map, mkt_dates, prod, d["date"])
        notion += abs(mv)
    return pnl / notion if notion > 0 else 0.0


def _expanding_quantile(series: np.ndarray, idx: int, q: float, min_n: int = 40) -> float:
    sl = series[: idx + 1]
    sl = sl[np.isfinite(sl)]
    if len(sl) < max(8, min_n // 4):
        return float("nan")
    return float(np.nanquantile(sl, q))


def _align_official_series(days, official: dict):
    dates = [d["date"] for d in days]
    cap_map = {d: c for d, c in zip(official["dates"], official["prev_capital"])}
    pnl_map = {d: p for d, p in zip(official["dates"], official["pnl"])}
    nav_map = {d: n for d, n in zip(official["dates"], official["nav"])}
    prev_cap = np.array([cap_map.get(d, np.nan) for d in dates], dtype=float)
    var_ratio = np.array([
        day["var95"] / prev_cap[i] if prev_cap[i] > 0 else np.nan for i, day in enumerate(days)
    ], dtype=float)
    port_pnl = np.array([pnl_map.get(d, 0.0) for d in dates], dtype=float)
    dd = np.zeros(len(dates))
    peak = 0.0
    for i, d in enumerate(dates):
        v = nav_map.get(d)
        if v is None:
            dd[i] = dd[i - 1] if i else 0.0
            continue
        peak = max(peak, float(v))
        dd[i] = (peak - float(v)) / peak if peak > 0 else 0.0
    return dates, prev_cap, var_ratio, port_pnl, dd


def _is_name_loser(days, idx, prod, spec, pct_map, mkt_dates) -> bool:
    lb = int(spec.get("loser_lb", 5))
    ret_thr = spec.get("loser_ret_thr")
    if ret_thr is not None:
        return trailing_prod_ret(days, idx, prod, lb, pct_map, mkt_dates) < float(ret_thr)
    pnl_thr = float(spec.get("loser_pnl_thr", 0.0))
    return trailing_prod_pnl(days, idx, prod, lb, pct_map, mkt_dates) < pnl_thr


def _day_var_stress(var_ratio: np.ndarray, i: int, spec: dict, full_thr: float) -> bool:
    vr = var_ratio[i]
    if not np.isfinite(vr):
        return False
    if spec.get("var_abs"):
        return vr >= float(spec["var_abs"])
    if spec.get("var_q"):
        if spec.get("var_mode") == "expanding":
            thr = _expanding_quantile(var_ratio, i, float(spec["var_q"]))
            return np.isfinite(thr) and vr >= thr
        return vr >= full_thr
    if spec.get("stress_var_abs"):
        return vr >= float(spec["stress_var_abs"])
    if spec.get("stress_var_q"):
        if spec.get("var_mode") == "expanding":
            thr = _expanding_quantile(var_ratio, i, float(spec["stress_var_q"]))
            return np.isfinite(thr) and vr >= thr
        thr = np.nanquantile(var_ratio, float(spec["stress_var_q"]))
        return vr >= thr
    return False


def apply_rule(days, official: dict, pct_map, mkt_dates, spec: dict) -> dict:
    """Overlay cuts on the official MOM product NAV (累计净资本口径)."""
    dates, prev_cap, var_ratio, port_pnl, dd = _align_official_series(days, official)
    full_thr = np.nanquantile(var_ratio, spec.get("var_q", 0.0)) if spec.get("var_q") else 0.0
    mode = spec.get("mode", "mcr")
    soft_p = spec.get("soft_prod_cap", spec.get("prod_cap"))
    soft_s = spec.get("soft_sector_cap", spec.get("sector_cap"))
    hard_p = spec.get("hard_prod_cap")
    hard_s = spec.get("hard_sector_cap")
    var_is_gate = bool(spec.get("var_q") or spec.get("var_abs"))

    avoided = np.zeros(len(days))
    saved = np.zeros(len(days))
    given = np.zeros(len(days))
    intervened = np.zeros(len(days), dtype=bool)
    cut_amt = np.zeros(len(days))
    event_log = []

    for i, day in enumerate(days):
        if i + 1 >= len(days):
            continue
        is_stress = _day_var_stress(var_ratio, i, spec, full_thr)
        if var_is_gate and not is_stress:
            continue
        if spec.get("port_loser"):
            lb = int(spec.get("port_lb", 5))
            trail_p = float(port_pnl[max(0, i - lb) : i].sum())
            if trail_p >= 0:
                continue
        if spec.get("dd_min") and dd[i] < float(spec["dd_min"]):
            continue
        k_soft = scale_factors(
            day, soft_p, soft_s, mode=mode,
            prod_allow=spec.get("prod_allow"),
            sector_allow=spec.get("sector_allow"),
        )
        if hard_p is not None or hard_s is not None:
            k_hard = scale_factors(
                day, hard_p, hard_s, mode=mode,
                prod_allow=spec.get("prod_allow"),
                sector_allow=spec.get("sector_allow"),
            )
        else:
            k_hard = {p: 1.0 for p in day["prods"]}
        apply_loser = bool(spec.get("loser_only")) and not (spec.get("stress_full") and is_stress)
        apply_winner = bool(spec.get("winner_only"))
        kmap = {}
        for p in day["prods"]:
            k = k_hard.get(p, 1.0)
            use_soft = True
            if apply_loser:
                use_soft = _is_name_loser(days, i, p, spec, pct_map, mkt_dates)
            elif apply_winner:
                use_soft = not _is_name_loser(days, i, p, spec, pct_map, mkt_dates)
            if use_soft:
                k = min(k, k_soft.get(p, 1.0))
            kmap[p] = k
        day_avoid = 0.0
        cuts = []
        for j, prod in enumerate(day["prods"]):
            k = kmap.get(prod, 1.0)
            if k >= 0.999:
                continue
            recon = float(day["mvs"][j]) * next_return(pct_map, mkt_dates, prod, day["date"])
            delta = (1.0 - k) * recon
            day_avoid += delta
            cuts.append((prod, 1.0 - k, recon, delta))
        if not cuts:
            continue
        # apply on next session (T+1)
        t1 = i + 1
        avoided[t1] += day_avoid
        saved[t1] += sum(max(0.0, -dlt) for _, _, _, dlt in cuts)
        given[t1] += sum(max(0.0, dlt) for _, _, _, dlt in cuts)
        intervened[t1] = True
        cut_amt[t1] += sum((1 - k) * abs(float(day["mvs"][day["prods"].index(p)])) for p, k, _, _ in ((c[0], kmap[c[0]], 0, 0) for c in cuts))
        top = sorted(cuts, key=lambda x: -abs(x[3]))[:3]
        event_log.append(
            {
                "signal_date": day["date"],
                "pnl_date": dates[t1],
                "n_cut": len(cuts),
                "avoided": day_avoid,
                "saved": sum(max(0.0, -dlt) for *_, dlt in cuts),
                "given": sum(max(0.0, dlt) for *_, dlt in cuts),
                "top": [(p, prod_label(p), cut, recon, dlt) for p, cut, recon, dlt in top],
                "cut_prods": [(p, prod_label(p)) for p, *_ in cuts],
                "max_prod": max(day["prod_mcr"].values()) if day["prod_mcr"] else 0,
                "max_prod_name": max(day["prod_mcr"], key=day["prod_mcr"].get) if day["prod_mcr"] else "",
                "max_sec": max(day["sector_mcr"].values()) if day["sector_mcr"] else 0,
                "max_sec_name": max(day["sector_mcr"], key=day["sector_mcr"].get) if day["sector_mcr"] else "",
            }
        )

    avoid_map = {dates[i]: float(avoided[i]) for i in range(len(dates))}
    int_dates = {dates[i] for i, flag in enumerate(intervened) if flag}
    off_dates = official["dates"]
    off_avoid = np.array([avoid_map.get(d, 0.0) for d in off_dates], dtype=float)
    cf_pnl = official["pnl"] - off_avoid
    rebuilt_a = rebuild_mom_nav(off_dates, official["pnl"], official["flow"])
    rebuilt_c = rebuild_mom_nav(off_dates, cf_pnl, official["flow"])
    actual_ret = rebuilt_a["ret"]
    cf_ret = rebuilt_c["ret"]
    actual = rebuilt_a["pnl"]
    cf = rebuilt_c["pnl"]
    a_st = mom_nav_stats(rebuilt_a["nav"], actual_ret)
    c_st = mom_nav_stats(rebuilt_c["nav"], cf_ret)
    nav_a = rebuilt_a["nav"]
    nav_c = rebuilt_c["nav"]
    mask = np.array([d in int_dates for d in off_dates])
    quiet = ~mask
    def _vol(x, m):
        sl = x[m]
        sl = sl[np.isfinite(sl)]
        if len(sl) < 2:
            return 0.0
        mu = float(np.mean(sl))
        return math.sqrt(float(np.mean((sl - mu) ** 2))) * math.sqrt(252)
    shrink = np.mean(np.abs(cf_ret[mask]) < np.abs(actual_ret[mask]) - 1e-12) if mask.any() else 0.0
    saved_map = {dates[i]: float(saved[i]) for i in range(len(dates))}
    given_map = {dates[i]: float(given[i]) for i in range(len(dates))}
    saved_off = np.array([saved_map.get(d, 0.0) for d in off_dates])
    given_off = np.array([given_map.get(d, 0.0) for d in off_dates])
    return {
        "spec": spec,
        "dates": off_dates,
        "actual": actual,
        "cf": cf,
        "avoided": off_avoid,
        "saved": saved_off,
        "given": given_off,
        "intervened": mask,
        "actual_ret": actual_ret,
        "cf_ret": cf_ret,
        "nav_a": nav_a,
        "nav_c": nav_c,
        "a_st": a_st,
        "c_st": c_st,
        "event_log": event_log,
        "n_signal": len(event_log),
        "net": float(cf.sum() - actual.sum()),
        "saved_sum": float(saved_off.sum()),
        "given_sum": float(given_off.sum()),
        "worst_a": float(np.min(actual)) if len(actual) else 0.0,
        "worst_c": float(np.min(cf)) if len(cf) else 0.0,
        "p05_a": float(np.quantile(actual, 0.05)) if len(actual) else 0.0,
        "p05_c": float(np.quantile(cf, 0.05)) if len(cf) else 0.0,
        "equity": rebuilt_a["prev_capital"],
        "vol_int_a": _vol(actual_ret, mask),
        "vol_int_c": _vol(cf_ret, mask),
        "vol_quiet_a": _vol(actual_ret, quiet),
        "vol_quiet_c": _vol(cf_ret, quiet),
        "shrink_share": float(shrink),
        "n_int_days": int(mask.sum()),
    }


SPIKE_WIN = ("2025-12-30", "2026-03-31")
Q1_WIN = ("2026-01-01", "2026-04-30")
VOL_HOT = {"LC", "SI", "PS", "AU", "AG", "PT", "PD", "CU"}
# 30/50 scoped: product cap only on 金/银/生猪/鸡蛋; sector cap only on 贵金属/生鲜
SCOPED_30_50_PRODS = ["AU", "AG", "LH", "JD"]
SCOPED_30_50_SECTORS = ["贵金属", "生鲜"]
NE_PRODS = {p for p, s in PROD_SECTOR.items() if s == "新能源"}


def pred_ann_vol(day: dict, capital: float) -> float:
    if capital <= 0 or day.get("port_sigma", 0) <= 0:
        return 0.0
    return float(day["port_sigma"] / capital * math.sqrt(252))


def window_mask(dates, start: str, end: str) -> np.ndarray:
    return np.array([start <= d <= end for d in dates])


def window_vol(rets: np.ndarray, mask: np.ndarray) -> float:
    sl = np.asarray(rets, dtype=float)[mask]
    sl = sl[np.isfinite(sl)]
    if len(sl) < 2:
        return 0.0
    mu = float(np.mean(sl))
    return math.sqrt(float(np.mean((sl - mu) ** 2))) * math.sqrt(252)


def attach_window_stats(bt: dict) -> dict:
    dates = bt["dates"]
    roll_a = rolling_ann_vol(bt["actual_ret"]) / 100.0
    roll_c = rolling_ann_vol(bt["cf_ret"]) / 100.0
    for key, win in (("spike", SPIKE_WIN), ("q1", Q1_WIN)):
        msk = window_mask(dates, *win)
        bt[f"vol_{key}_a"] = window_vol(bt["actual_ret"], msk)
        bt[f"vol_{key}_c"] = window_vol(bt["cf_ret"], msk)
        bt[f"pnl_{key}_a"] = float(bt["actual"][msk].sum()) if msk.any() else 0.0
        bt[f"pnl_{key}_c"] = float(bt["cf"][msk].sum()) if msk.any() else 0.0
        bt[f"peak_roll_{key}_a"] = float(np.nanmax(roll_a[msk])) if msk.any() else 0.0
        bt[f"peak_roll_{key}_c"] = float(np.nanmax(roll_c[msk])) if msk.any() else 0.0
        bt[f"n_{key}"] = int(msk.sum())
    quiet = ~window_mask(dates, *Q1_WIN)
    bt["vol_rest_a"] = window_vol(bt["actual_ret"], quiet)
    bt["vol_rest_c"] = window_vol(bt["cf_ret"], quiet)
    return bt


def apply_scale_overlay(days, official: dict, pct_map, mkt_dates, spec: dict) -> dict:
    """Book / name haircut overlay; same T+1 NAV rebuild as apply_rule."""
    dates, prev_cap, _var_ratio, _port_pnl, _dd = _align_official_series(days, official)
    ret_map = {d: r for d, r in zip(official["dates"], official["ret"])}
    day_rets = np.array([ret_map.get(d, 0.0) for d in dates], dtype=float)
    real_vol = (
        pd.Series(day_rets, dtype=float).rolling(20, min_periods=20).std(ddof=1).to_numpy()
        * math.sqrt(252)
    )
    kind = spec.get("kind", "pred_vol")
    target = float(spec.get("target", 0.20))
    universe = spec.get("universe")
    products = set(spec.get("products") or [])
    sectors = set(spec.get("sectors") or [])
    cap_frac = spec.get("cap_frac")

    kmaps = []
    for i, day in enumerate(days):
        k = {p: 1.0 for p in day["prods"]}
        capital = float(prev_cap[i]) if np.isfinite(prev_cap[i]) else 0.0
        if kind in ("pred_vol", "pred_vol_hot"):
            pred = pred_ann_vol(day, capital)
            if pred > target:
                scale = min(max(target / pred, 0.15), 1.0)
                for p in day["prods"]:
                    if universe is None or p in universe:
                        k[p] = min(k[p], scale)
        if kind == "real_vol":
            rv = real_vol[i]
            if np.isfinite(rv) and rv > target:
                scale = min(max(target / rv, 0.15), 1.0)
                for p in day["prods"]:
                    k[p] = min(k[p], scale)
        if kind in ("prod_mv_cap", "combo") and products and cap_frac and capital > 0:
            limit = float(cap_frac) * capital
            for j, p in enumerate(day["prods"]):
                if p not in products:
                    continue
                mv = abs(float(day["mvs"][j]))
                if mv > limit > 0:
                    k[p] = min(k[p], limit / mv)
        if kind in ("sector_mv_cap", "combo") and sectors and cap_frac and capital > 0:
            limit = float(cap_frac) * capital
            sec_abs: dict[str, float] = defaultdict(float)
            for j, p in enumerate(day["prods"]):
                sec = sector_of(p)
                if sec in sectors:
                    sec_abs[sec] += abs(float(day["mvs"][j]))
            for sec, tot in sec_abs.items():
                if tot > limit > 0:
                    ks = limit / tot
                    for p in day["prods"]:
                        if sector_of(p) == sec:
                            k[p] = min(k[p], ks)
        if kind == "combo" and spec.get("vol_target"):
            pred = pred_ann_vol(day, capital)
            vt = float(spec["vol_target"])
            if pred > vt:
                scale = min(max(vt / pred, 0.15), 1.0)
                hot = universe if universe is not None else set(day["prods"])
                for p in day["prods"]:
                    if p in hot:
                        k[p] = min(k[p], scale)
        kmaps.append(k)

    # reuse apply_rule settlement by injecting a dummy spec and walking kmaps
    avoided = np.zeros(len(days))
    saved = np.zeros(len(days))
    given = np.zeros(len(days))
    intervened = np.zeros(len(days), dtype=bool)
    event_log = []
    for i, day in enumerate(days):
        if i + 1 >= len(days):
            continue
        kmap = kmaps[i]
        cuts = []
        day_avoid = 0.0
        for j, prod in enumerate(day["prods"]):
            kk = kmap.get(prod, 1.0)
            if kk >= 0.999:
                continue
            recon = float(day["mvs"][j]) * next_return(pct_map, mkt_dates, prod, day["date"])
            delta = (1.0 - kk) * recon
            day_avoid += delta
            cuts.append((prod, 1.0 - kk, recon, delta))
        if not cuts:
            continue
        t1 = i + 1
        avoided[t1] += day_avoid
        saved[t1] += sum(max(0.0, -dlt) for *_, dlt in cuts)
        given[t1] += sum(max(0.0, dlt) for *_, dlt in cuts)
        intervened[t1] = True
        top = sorted(cuts, key=lambda x: -abs(x[3]))[:3]
        event_log.append(
            {
                "signal_date": day["date"],
                "pnl_date": dates[t1],
                "n_cut": len(cuts),
                "avoided": day_avoid,
                "saved": sum(max(0.0, -dlt) for *_, dlt in cuts),
                "given": sum(max(0.0, dlt) for *_, dlt in cuts),
                "top": [(p, prod_label(p), cut, recon, dlt) for p, cut, recon, dlt in top],
                "max_prod": max(day["prod_mcr"].values()) if day["prod_mcr"] else 0,
                "max_prod_name": max(day["prod_mcr"], key=day["prod_mcr"].get) if day["prod_mcr"] else "",
                "max_sec": max(day["sector_mcr"].values()) if day["sector_mcr"] else 0,
                "max_sec_name": max(day["sector_mcr"], key=day["sector_mcr"].get) if day["sector_mcr"] else "",
            }
        )

    avoid_map = {dates[i]: float(avoided[i]) for i in range(len(dates))}
    int_dates = {dates[i] for i, flag in enumerate(intervened) if flag}
    off_dates = official["dates"]
    off_avoid = np.array([avoid_map.get(d, 0.0) for d in off_dates], dtype=float)
    cf_pnl = official["pnl"] - off_avoid
    rebuilt_a = rebuild_mom_nav(off_dates, official["pnl"], official["flow"])
    rebuilt_c = rebuild_mom_nav(off_dates, cf_pnl, official["flow"])
    actual_ret, cf_ret = rebuilt_a["ret"], rebuilt_c["ret"]
    a_st = mom_nav_stats(rebuilt_a["nav"], actual_ret)
    c_st = mom_nav_stats(rebuilt_c["nav"], cf_ret)
    mask = np.array([d in int_dates for d in off_dates])
    saved_off = np.array([0.0] * len(off_dates))
    given_off = np.array([0.0] * len(off_dates))
    saved_map = {dates[i]: float(saved[i]) for i in range(len(dates))}
    given_map = {dates[i]: float(given[i]) for i in range(len(dates))}
    saved_off = np.array([saved_map.get(d, 0.0) for d in off_dates])
    given_off = np.array([given_map.get(d, 0.0) for d in off_dates])
    bt = {
        "spec": spec,
        "dates": off_dates,
        "actual": rebuilt_a["pnl"],
        "cf": rebuilt_c["pnl"],
        "avoided": off_avoid,
        "saved": saved_off,
        "given": given_off,
        "intervened": mask,
        "actual_ret": actual_ret,
        "cf_ret": cf_ret,
        "nav_a": rebuilt_a["nav"],
        "nav_c": rebuilt_c["nav"],
        "a_st": a_st,
        "c_st": c_st,
        "event_log": event_log,
        "n_signal": len(event_log),
        "net": float(rebuilt_c["pnl"].sum() - rebuilt_a["pnl"].sum()),
        "saved_sum": float(saved_off.sum()),
        "given_sum": float(given_off.sum()),
        "worst_a": float(np.min(rebuilt_a["pnl"])) if len(rebuilt_a["pnl"]) else 0.0,
        "worst_c": float(np.min(rebuilt_c["pnl"])) if len(rebuilt_c["pnl"]) else 0.0,
        "p05_a": float(np.quantile(rebuilt_a["pnl"], 0.05)) if len(rebuilt_a["pnl"]) else 0.0,
        "p05_c": float(np.quantile(rebuilt_c["pnl"], 0.05)) if len(rebuilt_c["pnl"]) else 0.0,
        "equity": rebuilt_a["prev_capital"],
        "n_int_days": int(mask.sum()),
        "vol_int_a": 0.0,
        "vol_int_c": 0.0,
        "vol_quiet_a": 0.0,
        "vol_quiet_c": 0.0,
        "shrink_share": 0.0,
    }
    return attach_window_stats(bt)


def vol_rule_specs() -> list[dict]:
    return [
        spec("预测年化波动>18%时整本书缩到18%", "预测波18%全书", extra=True, family="vol",
             kind="pred_vol", target=0.18),
        spec("预测年化波动>20%时整本书缩到20%", "预测波20%全书", extra=True, family="vol",
             kind="pred_vol", target=0.20),
        spec("预测年化波动>16%时整本书缩到16%", "预测波16%全书", extra=True, family="vol",
             kind="pred_vol", target=0.16),
        spec("预测年化波动>18%时只缩锂/硅/贵金属/铜", "预测波18%热门", extra=True, family="vol",
             kind="pred_vol", target=0.18, universe=VOL_HOT),
        spec("预测年化波动>20%时只缩锂/硅/贵金属/铜", "预测波20%热门", extra=True, family="vol",
             kind="pred_vol", target=0.20, universe=VOL_HOT),
        spec("已实现20日年化波动>20%时整本书缩到20%", "实现波20%全书", extra=True, family="vol",
             kind="real_vol", target=0.20),
        spec("已实现20日年化波动>18%时整本书缩到18%", "实现波18%全书", extra=True, family="vol",
             kind="real_vol", target=0.18),
        spec("碳酸锂净市值<累计净资本12%", "锂市值12%", extra=True, family="vol",
             kind="prod_mv_cap", products=["LC"], cap_frac=0.12),
        spec("碳酸锂净市值<累计净资本8%", "锂市值8%", extra=True, family="vol",
             kind="prod_mv_cap", products=["LC"], cap_frac=0.08),
        spec("碳酸锂净市值<累计净资本15%", "锂市值15%", extra=True, family="vol",
             kind="prod_mv_cap", products=["LC"], cap_frac=0.15),
        spec("新能源板块净市值<累计净资本15%", "新能源市值15%", extra=True, family="vol",
             kind="sector_mv_cap", sectors=["新能源"], cap_frac=0.15),
        spec("锂<12%资本 且 预测波动>18%时再缩热门", "锂12%+预测18%热门", extra=True, family="vol",
             kind="combo", products=["LC"], cap_frac=0.12, vol_target=0.18, universe=VOL_HOT),
        spec("锂<10%资本 且 预测波动>20%时全书缩到20%", "锂10%+预测20%全书", extra=True, family="vol",
             kind="combo", products=["LC"], cap_frac=0.10, vol_target=0.20),
    ]


def run_vol_rules(days, official, pct_map, mkt_dates):
    out = []
    specs = vol_rule_specs()
    for i, s in enumerate(specs):
        print(f"vol-rule {i+1}/{len(specs)} {s['short']}")
        out.append(apply_scale_overlay(days, official, pct_map, mkt_dates, s))
    return out


def summarize_thresholds(days) -> dict:
    max_prod, max_sec, max_sub = [], [], []
    max_prod_name, max_sec_name = [], []
    dates = []
    prod_breach_days = Counter()
    sec_breach_days = Counter()
    prod_max_hist = Counter()
    for d in days:
        dates.append(d["date"])
        if d["prod_mcr"]:
            p = max(d["prod_mcr"], key=d["prod_mcr"].get)
            max_prod.append(d["prod_mcr"][p])
            max_prod_name.append(p)
            prod_max_hist[p] += 1
            for k, v in d["prod_mcr"].items():
                if v >= 0.30:
                    prod_breach_days[k] += 1
        else:
            max_prod.append(0.0)
            max_prod_name.append("")
        if d["sector_mcr"]:
            s = max(d["sector_mcr"], key=d["sector_mcr"].get)
            max_sec.append(d["sector_mcr"][s])
            max_sec_name.append(s)
            for k, v in d["sector_mcr"].items():
                if v >= 0.50:
                    sec_breach_days[k] += 1
        else:
            max_sec.append(0.0)
            max_sec_name.append("")
        max_sub.append(max(d["sub_mcr"].values()) if d["sub_mcr"] else 0.0)
    mp, ms = np.array(max_prod), np.array(max_sec)
    return {
        "dates": dates,
        "max_prod": mp,
        "max_sec": ms,
        "max_sub": np.array(max_sub),
        "max_prod_name": max_prod_name,
        "max_sec_name": max_sec_name,
        "prod_breach_days": prod_breach_days,
        "sec_breach_days": sec_breach_days,
        "prod_max_hist": prod_max_hist,
        "n": len(days),
        "prod_ge": {t: float((mp >= t).mean()) for t in (0.20, 0.25, 0.30, 0.35, 0.40, 0.50)},
        "sec_ge": {t: float((ms >= t).mean()) for t in (0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.70)},
        "both_30_50": float(((mp >= 0.30) | (ms >= 0.50)).mean()),
        "and_30_50": float(((mp >= 0.30) & (ms >= 0.50)).mean()),
    }


def cond_next_ret(days, official) -> list[tuple]:
    ret_map = {d: r for d, r in zip(official["dates"], official["ret"])}
    pnl_map = {d: p for d, p in zip(official["dates"], official["pnl"])}
    rows = []
    bins = [(0, 0.20), (0.20, 0.30), (0.30, 0.40), (0.40, 1.01)]
    labels = ["<20%", "20–30%", "30–40%", "≥40%"]
    for (lo, hi), lab in zip(bins, labels):
        rets, pnls = [], []
        for i, d in enumerate(days[:-1]):
            mx = max(d["prod_mcr"].values()) if d["prod_mcr"] else 0
            if lo <= mx < hi:
                nxt = days[i + 1]["date"]
                if nxt in ret_map:
                    rets.append(float(ret_map[nxt]))
                    pnls.append(float(pnl_map.get(nxt, 0)))
        arr = np.array(rets) if rets else np.array([0.0])
        rows.append(
            {
                "label": lab,
                "n": len(rets),
                "mean": float(np.mean(arr)) if len(rets) else 0,
                "p05": float(np.quantile(arr, 0.05)) if len(rets) else 0,
                "worst": float(np.min(arr)) if len(rets) else 0,
                "mean_pnl": float(np.mean(pnls)) if pnls else 0,
                "neg_share": float(np.mean(np.array(rets) < 0)) if rets else 0,
            }
        )
    return rows


def breach_trail_diagnostics(days, pct_map, mkt_dates, prod_cap=0.25, sector_cap=0.45, lookbacks=(3, 5, 10, 20)) -> dict:
    """Would-cut names under an unconditional cap, split by trailing product PnL."""
    by_lb = {}
    for lb in lookbacks:
        losers, winners = [], []
        for i, day in enumerate(days[:-1]):
            kmap = scale_factors(day, prod_cap, sector_cap, mode="mcr")
            for j, prod in enumerate(day["prods"]):
                k = kmap.get(prod, 1.0)
                if k >= 0.999:
                    continue
                recon = float(day["mvs"][j]) * next_return(pct_map, mkt_dates, prod, day["date"])
                avoided = (1.0 - k) * recon
                trail = trailing_prod_pnl(days, i, prod, lb, pct_map, mkt_dates)
                rec = {"recon": recon, "avoided": avoided, "trail": trail}
                (losers if trail < 0 else winners).append(rec)
        def _summ(rows):
            rec = np.array([r["recon"] for r in rows], dtype=float) if rows else np.array([])
            avd = np.array([r["avoided"] for r in rows], dtype=float) if rows else np.array([])
            return {
                "n": len(rows),
                "mean_recon": float(rec.mean()) if len(rec) else 0.0,
                "neg_share": float(np.mean(rec < 0)) if len(rec) else 0.0,
                "avoided": float(avd.sum()) if len(avd) else 0.0,
                "net_if_cut": float(-avd.sum()) if len(avd) else 0.0,
                "p05_recon": float(np.quantile(rec, 0.05)) if len(rec) else 0.0,
            }
        by_lb[lb] = {"losers": _summ(losers), "winners": _summ(winners)}
    return {"prod_cap": prod_cap, "sector_cap": sector_cap, "by_lb": by_lb}


def var_regime_diagnostics(days, official) -> list[dict]:
    dates, _prev_cap, var_ratio, port_pnl, _dd = _align_official_series(days, official)
    pnl_map = {d: p for d, p in zip(official["dates"], official["pnl"])}
    rows = []
    for q in (0.50, 0.60, 0.70, 0.80):
        thr = float(np.nanquantile(var_ratio, q))
        hi, lo = [], []
        for i, day in enumerate(days[:-1]):
            nxt = pnl_map.get(days[i + 1]["date"], np.nan)
            if not np.isfinite(nxt) or not np.isfinite(var_ratio[i]):
                continue
            (hi if var_ratio[i] >= thr else lo).append(nxt)
        def _s(xs, lab):
            a = np.array(xs, dtype=float)
            return {
                "label": lab,
                "q": q,
                "thr": thr,
                "n": len(a),
                "mean": float(a.mean()) if len(a) else 0.0,
                "p05": float(np.quantile(a, 0.05)) if len(a) else 0.0,
                "worst": float(a.min()) if len(a) else 0.0,
                "neg_share": float(np.mean(a < 0)) if len(a) else 0.0,
            }
        rows.append(_s(hi, f"VaR/权益≥Q{int(q*100)}"))
        rows.append(_s(lo, f"VaR/权益<Q{int(q*100)}"))
    return rows


# ── charts ──────────────────────────────────────────────────────────────────


def savefig(name: str) -> Path:
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    path = CHART_DIR / name
    plt.tight_layout()
    plt.savefig(path, dpi=160, bbox_inches="tight")
    plt.close()
    return path


def chart_max_mcr_ts(th) -> Path:
    fig, ax = plt.subplots(figsize=(10.2, 3.8))
    x = pd.to_datetime(th["dates"])
    ax.plot(x, th["max_prod"] * 100, color=C_TEAL, lw=1.2, label="单品种最大MCR")
    ax.plot(x, th["max_sec"] * 100, color=C_ORANGE, lw=1.2, label="单板块最大MCR")
    ax.axhline(30, color=C_TEAL, ls="--", lw=0.9, alpha=0.8)
    ax.axhline(50, color=C_ORANGE, ls="--", lw=0.9, alpha=0.8)
    ax.fill_between(x, 30, th["max_prod"] * 100, where=th["max_prod"] * 100 > 30, color=C_TEAL, alpha=0.18)
    ax.fill_between(x, 50, th["max_sec"] * 100, where=th["max_sec"] * 100 > 50, color=C_ORANGE, alpha=0.18)
    ax.set_ylabel("边际贡献占比 (%)", **fp())
    ax.set_title("组合每日最大品种 / 板块边际贡献占比", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False)
    ax.grid(True, axis="y", color="#EDF2F7", lw=0.8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return savefig("01_max_mcr_ts.png")


def chart_hist(th) -> Path:
    fig, axes = plt.subplots(1, 2, figsize=(10.2, 3.6))
    axes[0].hist(th["max_prod"] * 100, bins=22, color=C_TEAL, edgecolor="white")
    axes[0].axvline(30, color=C_RED, ls="--", lw=1.2)
    axes[0].set_title("单品种最大MCR分布", **fp())
    axes[0].set_xlabel("占比 (%)", **fp())
    axes[1].hist(th["max_sec"] * 100, bins=22, color=C_ORANGE, edgecolor="white")
    axes[1].axvline(50, color=C_RED, ls="--", lw=1.2)
    axes[1].set_title("单板块最大MCR分布", **fp())
    axes[1].set_xlabel("占比 (%)", **fp())
    for ax in axes:
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.grid(True, axis="y", color="#EDF2F7")
    return savefig("02_mcr_hist.png")


def chart_breach_rank(th) -> Path:
    items = th["prod_breach_days"].most_common(12)
    fig, ax = plt.subplots(figsize=(10.2, 3.8))
    if items:
        labels = [prod_label(k) for k, _ in items][::-1]
        vals = [v for _, v in items][::-1]
        ax.barh(labels, vals, color=C_NAVY)
    ax.set_title("单品种MCR≥30% 的交易日次数（Top 12）", **fp())
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    plt.yticks(**fp())
    return savefig("03_prod_breach_rank.png")


def chart_sector_breach(th) -> Path:
    items = th["sec_breach_days"].most_common()
    fig, ax = plt.subplots(figsize=(8.6, 3.4))
    if items:
        labels = [k for k, _ in items][::-1]
        vals = [v for _, v in items][::-1]
        ax.barh(labels, vals, color=C_ORANGE)
    ax.set_title("单板块MCR≥50% 的交易日次数", **fp())
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    plt.yticks(**fp())
    return savefig("04_sector_breach_rank.png")


def chart_nav(bt, title: str, fname: str) -> Path:
    fig, ax = plt.subplots(figsize=(10.2, 3.8))
    x = pd.to_datetime(bt["dates"])
    ax.plot(x, bt["nav_a"], color=C_GRAY, lw=1.3, label="实际组合")
    ax.plot(x, bt["nav_c"], color=C_NAVY, lw=1.5, label="施加规则后")
    ax.set_title(title, **fp())
    ax.set_ylabel("MOM产品累计净值", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False)
    ax.grid(True, axis="y", color="#EDF2F7")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return savefig(fname)


def chart_nav_overlay(series: list[tuple], title: str, fname: str) -> Path:
    fig, ax = plt.subplots(figsize=(10.2, 3.8))
    colors = [C_GRAY, C_TEAL, C_NAVY, C_ORANGE, C_GREEN, C_PURPLE]
    for i, (label, dates, nav, lw) in enumerate(series):
        ax.plot(pd.to_datetime(dates), nav, color=colors[i % len(colors)], lw=lw, label=label)
    ax.set_title(title, **fp())
    ax.set_ylabel("MOM产品累计净值", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False)
    ax.grid(True, axis="y", color="#EDF2F7")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return savefig(fname)


def chart_saved_vs_given(bt, fname: str) -> Path:
    fig, ax = plt.subplots(figsize=(10.2, 3.6))
    x = pd.to_datetime(bt["dates"])
    saved_c = np.cumsum(bt["saved"]) / 1e4
    given_c = np.cumsum(bt["given"]) / 1e4
    net_c = np.cumsum(bt["cf"] - bt["actual"]) / 1e4
    ax.plot(x, saved_c, color=C_RED, lw=1.4, label="累计避免亏损")
    ax.plot(x, given_c, color=C_GREEN, lw=1.4, label="累计让渡盈利")
    ax.plot(x, net_c, color=C_NAVY, lw=1.6, label="净效果（规则−实际）")
    ax.axhline(0, color="#A0AEC0", lw=0.8)
    ax.set_ylabel("万元", **fp())
    ax.set_title("规则干预的损益分解（T+1 持仓缩放）", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False)
    ax.grid(True, axis="y", color="#EDF2F7")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return savefig(fname)


def chart_dd(bt, fname: str) -> Path:
    def dd(nav):
        peak = np.maximum.accumulate(nav)
        return (nav / peak - 1.0) * 100

    fig, ax = plt.subplots(figsize=(10.2, 3.4))
    x = pd.to_datetime(bt["dates"])
    ax.fill_between(x, dd(bt["nav_a"]), 0, color=C_GRAY, alpha=0.35, label="实际回撤")
    ax.plot(x, dd(bt["nav_c"]), color=C_NAVY, lw=1.3, label="规则回撤")
    ax.set_ylabel("回撤 (%)", **fp())
    ax.set_title("净值回撤对比", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return savefig(fname)


def chart_cond(cond_rows) -> Path:
    fig, ax = plt.subplots(figsize=(8.4, 3.6))
    labels = [r["label"] for r in cond_rows]
    means = [r["mean"] * 10000 for r in cond_rows]
    colors = [cn_pnl_color(v) for v in means]
    ax.bar(labels, means, color=colors)
    ax.axhline(0, color="#A0AEC0", lw=0.8)
    ax.set_ylabel("次日收益（bp）", **fp())
    ax.set_title("按当日最大单品种MCR分组的次日组合收益", **fp())
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    plt.xticks(**fp())
    return savefig("08_cond_next_ret.png")


def chart_grid_heatmap(grid_rows) -> Path:
    def plain(r):
        s = r["spec"]
        return (
            s.get("mode") == "mcr"
            and s.get("prod_cap")
            and s.get("sector_cap")
            and not s.get("loser_only")
            and not s.get("winner_only")
            and not s.get("var_q")
            and not s.get("var_abs")
            and not s.get("hard_prod_cap")
            and not s.get("port_loser")
            and not s.get("dd_min")
            and not s.get("stress_full")
            and s.get("family", "grid") == "grid"
        )

    prods = sorted({r["spec"]["prod_cap"] for r in grid_rows if plain(r)})
    secs = sorted({r["spec"]["sector_cap"] for r in grid_rows if plain(r)})
    mat = np.full((len(prods), len(secs)), np.nan)
    for r in grid_rows:
        if not plain(r):
            continue
        p, s = r["spec"]["prod_cap"], r["spec"]["sector_cap"]
        if p in prods and s in secs:
            i, j = prods.index(p), secs.index(s)
            mat[i, j] = r["net"] / 1e4
    fig, ax = plt.subplots(figsize=(8.8, 4.2))
    im = ax.imshow(mat, cmap="RdYlGn_r", aspect="auto")
    ax.set_xticks(range(len(secs)))
    ax.set_yticks(range(len(prods)))
    ax.set_xticklabels([f"{int(s*100)}%" for s in secs])
    ax.set_yticklabels([f"{int(p*100)}%" for p in prods])
    ax.set_xlabel("单板块MCR上限", **fp())
    ax.set_ylabel("单品种MCR上限", **fp())
    ax.set_title("规则网格：累计净效果（万元，红=规则优于实际）", **fp())
    for i in range(len(prods)):
        for j in range(len(secs)):
            if np.isfinite(mat[i, j]):
                ax.text(j, i, f"{mat[i, j]:.0f}", ha="center", va="center", fontsize=7, color="#1A202C")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    return savefig("09_grid_heatmap.png")


def rolling_ann_vol(rets: np.ndarray, window: int = 20) -> np.ndarray:
    s = pd.Series(rets, dtype=float)
    return (s.rolling(window, min_periods=window).std(ddof=1) * math.sqrt(252) * 100).to_numpy()


def chart_rolling_vol(series: list[tuple], fname: str) -> Path:
    fig, ax = plt.subplots(figsize=(10.2, 3.8))
    colors = [C_GRAY, C_TEAL, C_NAVY, C_ORANGE]
    for i, (label, dates, rets, lw) in enumerate(series):
        ax.plot(pd.to_datetime(dates), rolling_ann_vol(rets), color=colors[i % len(colors)], lw=lw, label=label)
    ax.set_ylabel("20日滚动年化波动 (%)", **fp())
    ax.set_title("组合波动是否被规则压下来？", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False)
    ax.grid(True, axis="y", color="#EDF2F7")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return savefig(fname)


def chart_risk_bars(rows: list[dict], fname: str) -> Path:
    labels = [r["label"] for r in rows]
    x = np.arange(len(labels))
    fig, axes = plt.subplots(1, 3, figsize=(10.4, 3.6))
    specs = [
        ("ann_vol", "年化波动 (%)", lambda v: v * 100, C_TEAL),
        ("mdd", "最大回撤 (%)", lambda v: v * 100, C_ORANGE),
        ("sharpe", "夏普", lambda v: v, C_NAVY),
    ]
    for ax, (key, title, xf, color) in zip(axes, specs):
        vals = [xf(r[key]) for r in rows]
        cols = [C_GRAY if i == 0 else color for i in range(len(vals))]
        ax.bar(x, vals, color=cols, width=0.72)
        ax.set_title(title, **fp())
        ax.set_xticks(x)
        ax.set_xticklabels(labels, rotation=28, ha="right")
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        for tick in ax.get_xticklabels():
            tick.set_fontproperties(_CN_FONT)
            tick.set_fontsize(8)
        for i, v in enumerate(vals):
            ax.text(i, v, f"{v:.2f}", ha="center", va="bottom", fontsize=7)
    fig.suptitle("关键规则的波动 / 回撤 / 夏普（灰柱=实际组合）", **fp(), y=1.02)
    return savefig(fname)


def chart_ret_hist(bt, fname: str) -> Path:
    fig, ax = plt.subplots(figsize=(10.2, 3.6))
    a = bt["actual_ret"] * 100
    c = bt["cf_ret"] * 100
    lo, hi = np.nanpercentile(np.concatenate([a, c]), [0.5, 99.5])
    bins = np.linspace(lo, hi, 28)
    ax.hist(a, bins=bins, color=C_GRAY, alpha=0.55, label="实际日收益")
    ax.hist(c, bins=bins, color=C_NAVY, alpha=0.45, label="30%/50% 规则日收益")
    ax.axvline(0, color="#A0AEC0", lw=0.8)
    ax.set_xlabel("日收益率 (%)", **fp())
    ax.set_title("日收益分布：规则有没有削掉左右两边的大波动？", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return savefig(fname)


def _rule_kind(spec: dict) -> str:
    if spec.get("prod_allow") or spec.get("sector_allow") or spec.get("family") == "scoped":
        return "scoped"
    if spec.get("family") == "mv":
        return "mv"
    if spec.get("winner_only"):
        return "ctrl"
    if spec.get("hard_prod_cap") or spec.get("stress_full"):
        return "tier"
    if spec.get("loser_only") and (spec.get("var_q") or spec.get("var_abs") or spec.get("port_loser") or spec.get("dd_min")):
        return "and"
    if spec.get("loser_only"):
        return "loser"
    if spec.get("var_q") or spec.get("var_abs"):
        return "var"
    if spec.get("port_loser") or spec.get("dd_min"):
        return "port"
    if spec.get("family") == "cond":
        return "other"
    return "grid"


def _annotate_spaced(ax, items, fontsize=8):
    """Place a few labels with offset-point callouts; skip if the box would overlap."""
    fig = ax.figure
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    boxes = []
    offsets = [
        (8, 10), (8, -14), (-10, 10), (-10, -14),
        (16, 4), (-18, 4), (4, 18), (4, -20),
        (20, 14), (-22, 14), (20, -16), (-22, -16),
        (0, 22), (0, -24), (26, 0), (-28, 0),
        (14, 22), (-16, 22), (14, -24), (-16, -24),
    ]
    seen_xy = set()
    for x, y, lab in items:
        key = (round(x, 3), round(y, 1), lab)
        if key in seen_xy:
            continue
        seen_xy.add(key)
        placed = False
        for dx, dy in offsets:
            ann = ax.annotate(
                lab,
                (x, y),
                xytext=(dx, dy),
                textcoords="offset points",
                fontsize=fontsize,
                color="#1A365D",
                ha="left" if dx >= 0 else "right",
                va="bottom" if dy >= 0 else "top",
                arrowprops=dict(arrowstyle="-", color="#A0AEC0", lw=0.55),
                **fp(),
            )
            fig.canvas.draw()
            bb = ann.get_window_extent(renderer=renderer).expanded(1.08, 1.18)
            if any(bb.overlaps(b) for b in boxes):
                ann.remove()
                continue
            boxes.append(bb)
            placed = True
            break
        if not placed:
            pass


def _pick_scatter_labels(alts, extra_shorts=None, k_top=5) -> list[str]:
    prefer = {
        "MCR 30/50", "MCR 20/60", "MCR 25/45", "仅品种30", "仅板块50",
        "品种25+细分40", "市值 20/40", "市值 15/35",
        "25/45 只砍亏", "20/40 L5", "仅品种25 L5", "25/45 L5+DD5",
        "25+细分40 L5", "25/45 高VaR", "25/45 只砍盈", "25/45 组合亏5日",
        "软20硬30 L5", "30/50 L5", "30/50 金银猪蛋",
    }
    if extra_shorts:
        prefer |= set(extra_shorts)
    by_short = {r["spec"]["short"]: r for r in alts}
    chosen = [s for s in prefer if s in by_short and s != "25/45 L5"]
    ranked = sorted(alts, key=lambda r: -r["net"])
    for r in ranked[:k_top] + ranked[-2:]:
        s = r["spec"]["short"]
        if s != "25/45 L5" and s not in chosen:
            chosen.append(s)
    return chosen


def chart_scatter_rules(alts) -> Path:
    kind_color = {
        "grid": C_TEAL,
        "mv": C_GRAY,
        "loser": C_RED,
        "var": C_ORANGE,
        "and": C_NAVY,
        "tier": C_PURPLE,
        "port": C_TEAL,
        "ctrl": C_GREEN,
        "scoped": C_GOLD,
        "other": C_GRAY,
    }
    kind_label = {
        "grid": "MCR网格",
        "mv": "市值限额",
        "loser": "只砍亏",
        "var": "高VaR门",
        "and": "复合条件",
        "tier": "软硬顶",
        "port": "组合门",
        "ctrl": "反例",
        "scoped": "限定名单",
        "other": "其他",
    }
    fig, ax = plt.subplots(figsize=(10.4, 5.6))
    seen_kind = set()
    pts = []
    for r in alts:
        kind = _rule_kind(r["spec"])
        x, y = r["c_st"]["mdd"] * 100, r["net"] / 1e4
        lbl = kind_label[kind] if kind not in seen_kind else None
        seen_kind.add(kind)
        ax.scatter(x, y, s=42 + r["n_signal"] * 0.12, color=kind_color[kind], alpha=0.78, label=lbl, zorder=3)
        pts.append((x, y, r))
    want = set(_pick_scatter_labels(alts))
    labels = [(x, y, r["spec"]["short"]) for x, y, r in pts if r["spec"]["short"] in want]
    _annotate_spaced(ax, labels, fontsize=8)
    ax.axhline(0, color="#A0AEC0", lw=0.8)
    ax.margins(0.14, 0.20)
    ax.set_xlabel("规则净值最大回撤 (%)", **fp())
    ax.set_ylabel("相对实际的累计净效果（万元）", **fp())
    ax.set_title("备选规则：回撤 vs 净效果（只标关键点；点大小=干预次数）", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False, loc="center left", bbox_to_anchor=(1.01, 0.5))
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(True, color="#EDF2F7", lw=0.7)
    fig.subplots_adjust(right=0.78)
    return savefig("10_rule_scatter.png")


def chart_trail_split(diag: dict) -> Path:
    lbs = sorted(diag["by_lb"])
    x = np.arange(len(lbs))
    w = 0.36
    loser_net = [diag["by_lb"][lb]["losers"]["net_if_cut"] / 1e4 for lb in lbs]
    win_net = [diag["by_lb"][lb]["winners"]["net_if_cut"] / 1e4 for lb in lbs]
    fig, ax = plt.subplots(figsize=(10.2, 3.8))
    ax.bar(x - w / 2, loser_net, w, color=[cn_pnl_color(v) for v in loser_net],
           edgecolor="#1A365D", lw=0.6, label="只砍近N日亏损品种")
    ax.bar(x + w / 2, win_net, w, color=[cn_pnl_color(v) for v in win_net],
           hatch="///", edgecolor="#1A365D", lw=0.6, label="只砍近N日盈利品种")
    ax.axhline(0, color="#A0AEC0", lw=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels([f"{lb}日" for lb in lbs])
    ax.set_ylabel("若按此过滤，累计净效果（万元）", **fp())
    ax.set_title("25/45 超限名单：按近N日品种盈亏过滤后的潜在净效果", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(True, axis="y", color="#EDF2F7")
    return savefig("15_cond_trail_split.png")


def chart_lookback_sweep(alts) -> Path:
    rows = []
    for r in alts:
        s = r["spec"]
        if not s.get("loser_only") or s.get("var_q") or s.get("var_abs") or s.get("port_loser") or s.get("dd_min"):
            continue
        if s.get("hard_prod_cap") or s.get("stress_full") or s.get("mode") != "mcr":
            continue
        if abs((s.get("prod_cap") or 0) - 0.25) > 1e-9 or abs((s.get("sector_cap") or 0) - 0.45) > 1e-9:
            continue
        if s.get("loser_ret_thr") is not None:
            continue
        rows.append((int(s.get("loser_lb", 5)), r))
    rows.sort(key=lambda x: x[0])
    # de-dup lookback
    seen = {}
    for lb, r in rows:
        seen[lb] = r
    lbs = sorted(seen)
    fig, ax1 = plt.subplots(figsize=(10.2, 3.8))
    nets = [seen[lb]["net"] / 1e4 for lb in lbs]
    ns = [seen[lb]["n_signal"] for lb in lbs]
    ax1.plot(lbs, nets, color=C_NAVY, marker="o", lw=1.6, label="净效果（万元）")
    ax1.axhline(0, color="#A0AEC0", lw=0.8)
    ax1.set_xlabel("亏损回看天数", **fp())
    ax1.set_ylabel("累计净效果（万元）", **fp())
    ax2 = ax1.twinx()
    ax2.plot(lbs, ns, color=C_ORANGE, marker="s", lw=1.2, ls="--", label="干预日")
    ax2.set_ylabel("干预日数", **fp())
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1 + h2, l1 + l2, prop=_CN_FONT, fontsize=8, frameon=False)
    ax1.set_title("同一套 25/45：只砍亏的回看窗口扫描", **fp())
    ax1.spines["top"].set_visible(False)
    return savefig("16_cond_lookback_sweep.png")


def chart_var_sweep(alts) -> Path:
    def pick(mode, key="var_q"):
        pts = []
        for r in alts:
            s = r["spec"]
            if s.get("loser_only") or s.get("hard_prod_cap") or s.get("port_loser"):
                continue
            if abs((s.get("prod_cap") or 0) - 0.25) > 1e-9:
                continue
            if key == "var_q" and s.get("var_q") and s.get("var_mode", "full") == mode and not s.get("var_abs"):
                pts.append((float(s["var_q"]), r["net"] / 1e4, r["n_signal"]))
            if key == "var_abs" and s.get("var_abs") and not s.get("var_q"):
                pts.append((float(s["var_abs"]), r["net"] / 1e4, r["n_signal"]))
        pts.sort()
        return pts

    fig, axes = plt.subplots(1, 2, figsize=(10.4, 3.8), sharey=True)
    full = pick("full")
    exp = pick("expanding")
    abso = pick("full", "var_abs")
    if full:
        axes[0].plot([p[0] * 100 for p in full], [p[1] for p in full], color=C_NAVY, marker="o", lw=1.5, label="全样本分位（有前视）")
    if exp:
        axes[0].plot([p[0] * 100 for p in exp], [p[1] for p in exp], color=C_TEAL, marker="s", lw=1.5, label="扩张窗口分位")
    if abso:
        axes[1].plot([p[0] * 100 for p in abso], [p[1] for p in abso], color=C_ORANGE, marker="^", lw=1.5, label="绝对门槛")
    axes[0].set_xlabel("VaR/权益分位 (%)", **fp())
    axes[1].set_xlabel("VaR/权益绝对门槛 (%)", **fp())
    axes[0].set_ylabel("累计净效果（万元）", **fp())
    axes[0].set_title("分位门槛", **fp())
    axes[1].set_title("绝对门槛", **fp())
    for ax in axes:
        ax.axhline(0, color="#A0AEC0", lw=0.8)
        ax.legend(prop=_CN_FONT, fontsize=8, frameon=False)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.grid(True, axis="y", color="#EDF2F7")
    fig.suptitle("25/45 只在「高VaR日」启动：门槛越高，越容易错过低波动的集中度事故", **fp(), y=1.02)
    return savefig("17_cond_var_sweep.png")


def chart_cond_scatter(alts) -> Path:
    colors = {
        "loser": C_RED,
        "var": C_ORANGE,
        "and": C_NAVY,
        "tier": C_PURPLE,
        "port": "#2B6CB0",
        "ctrl": C_GREEN,
        "other": C_GRAY,
    }
    kind_label = {
        "loser": "只砍亏",
        "var": "高VaR门",
        "and": "组合条件",
        "tier": "软硬/压力",
        "port": "组合/回撤门",
        "ctrl": "反例（只砍盈）",
        "other": "其他",
    }
    fig, ax = plt.subplots(figsize=(10.4, 5.6))
    seen_kind = set()
    conds = [r for r in alts if r["spec"].get("family") == "cond"]
    for r in conds:
        kind = _rule_kind(r["spec"])
        x, y = r["c_st"]["mdd"] * 100, r["net"] / 1e4
        lbl = kind_label.get(kind, kind) if kind not in seen_kind else None
        seen_kind.add(kind)
        ax.scatter(x, y, s=40 + r["n_signal"] * 0.12, color=colors.get(kind, C_GRAY), alpha=0.8, label=lbl, zorder=3)
    want = set(_pick_scatter_labels(
        conds,
        extra_shorts={"25/45 L3", "25/45 L10", "25/45 L5+DD5", "L5+压3%全砍", "软25硬40 L5"},
        k_top=4,
    ))
    labels = [
        (r["c_st"]["mdd"] * 100, r["net"] / 1e4, r["spec"]["short"])
        for r in conds if r["spec"]["short"] in want
    ]
    _annotate_spaced(ax, labels, fontsize=8)
    ax.axhline(0, color="#A0AEC0", lw=0.8)
    ax.margins(0.14, 0.20)
    ax.set_xlabel("规则净值最大回撤 (%)", **fp())
    ax.set_ylabel("相对实际的累计净效果（万元）", **fp())
    ax.set_title("带条件规则：回撤 vs 净效果（只标关键点；颜色见图例）", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False, loc="center left", bbox_to_anchor=(1.01, 0.5))
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(True, color="#EDF2F7", lw=0.7)
    fig.subplots_adjust(right=0.78)
    return savefig("18_cond_scatter.png")


def chart_var_regime(var_rows) -> Path:
    # one grouped bar for Q60 mean next pnl
    labs, means = [], []
    for r in var_rows:
        if abs(r["q"] - 0.60) > 1e-9:
            continue
        labs.append(r["label"].replace("VaR/权益", "VaR"))
        means.append(r["mean"] / 1e4)
    fig, ax = plt.subplots(figsize=(8.4, 3.6))
    cols = [cn_pnl_color(v) for v in means]
    ax.bar(labs, means, color=cols)
    ax.axhline(0, color="#A0AEC0", lw=0.8)
    ax.set_ylabel("次日官方盈亏均值（万元）", **fp())
    ax.set_title("高VaR日的次日均值其实更好：只在高VaR启动会切掉风险溢价", **fp())
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    plt.xticks(**fp())
    return savefig("19_var_regime_next.png")


def chart_vol_rules_roll(series: list[tuple], fname: str) -> Path:
    fig, ax = plt.subplots(figsize=(10.2, 3.9))
    colors = [C_GRAY, C_TEAL, C_NAVY, C_ORANGE, C_GREEN, C_PURPLE, C_RED]
    for i, (label, dates, rets, lw) in enumerate(series):
        ax.plot(pd.to_datetime(dates), rolling_ann_vol(rets), color=colors[i % len(colors)], lw=lw, label=label)
    ax.axhline(20, color=C_RED, ls="--", lw=0.9, alpha=0.75)
    ax.axvspan(pd.Timestamp("2026-01-01"), pd.Timestamp("2026-04-30"), color=C_ORANGE, alpha=0.08)
    ax.set_ylabel("20日滚动年化波动 (%)", **fp())
    ax.set_title("针对 2026 年一季度尖峰：波动目标规则能否把滚动波动压回 20% 以下？", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False, ncol=2)
    ax.grid(True, axis="y", color="#EDF2F7")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return savefig(fname)


def chart_vol_zoom(series: list[tuple], fname: str) -> Path:
    fig, ax = plt.subplots(figsize=(10.2, 3.6))
    colors = [C_GRAY, C_TEAL, C_NAVY, C_ORANGE, C_GREEN]
    for i, (label, dates, rets, lw) in enumerate(series):
        x = pd.to_datetime(dates)
        y = rolling_ann_vol(rets)
        msk = (x >= pd.Timestamp("2025-12-01")) & (x <= pd.Timestamp("2026-05-15"))
        ax.plot(x[msk], y[msk], color=colors[i % len(colors)], lw=lw, label=label)
    ax.axhline(20, color=C_RED, ls="--", lw=0.9, alpha=0.75)
    ax.set_ylabel("20日滚动年化波动 (%)", **fp())
    ax.set_title("2025-12 至 2026-05 放大：尖峰从哪一天开始、规则有没有削掉", **fp())
    ax.legend(prop=_CN_FONT, fontsize=8, frameon=False)
    ax.grid(True, axis="y", color="#EDF2F7")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return savefig(fname)


# ── report ──────────────────────────────────────────────────────────────────


def _rule_table_rows(rules, bt0):
    rows = []
    for r in rules:
        rows.append(
            [
                r["spec"]["short"],
                str(r["n_signal"]),
                signed_wan(r["net"]),
                wan(r["saved_sum"]),
                wan(r["given_sum"]),
                pct(r["c_st"]["ann_vol"]),
                pct(r["c_st"]["mdd"]),
                f"{r['c_st']['sharpe']:.2f}",
                f"{r['c_st']['calmar']:.2f}",
                signed_wan(r["worst_c"] - bt0["worst_a"]),
            ]
        )
    return rows


def write_report(th, days, bt0, alts, cond_rows, charts, first_d, last_d, trail_diag=None, var_diag=None, vol_bts=None):
    doc = Document()
    set_narrow_margins(doc)
    add_page_numbers(doc)
    update_fields_on_open(doc)
    style = doc.styles["Normal"]
    style.font.name = "微软雅黑"
    style.element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    style.font.size = Pt(11)
    style.font.color.rgb = TEXT

    p = para(doc, "MOM 每日风控  ·  内部研究备忘", size=11, color=GOLD, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    p.paragraph_format.first_line_indent = None
    t = para(doc, "组合集中度风险限额：历史触及、规则回测与备选方案", size=20, bold=True, color=NAVY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=6)
    t.runs[0].font.size = Pt(20)
    para(
        doc,
        f"数据区间 {first_d} 至 {last_d}  ·  {th['n']} 个可计算交易日  ·  报告日 {datetime.now().strftime('%Y-%m-%d')}",
        size=10,
        color=MUTED,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        space_after=14,
    )

    heading(doc, "一、结论摘要", 1)
    a, c = bt0["a_st"], bt0["c_st"]
    net = bt0["net"]
    better = net > 0
    para(
        doc,
        f"本备忘用与日间风控「VaR沙盒」完全相同的边际波动贡献（MCR）公式，回测两条拟议限额："
        f"单品种边际贡献占比 < 30%、单板块边际贡献占比 < 50%。规则在收盘后观察当日持仓 MCR，"
        f"于下一交易日按超限幅度等比压缩超限品种（及超限板块内全部品种）的名义敞口；"
        f"不把砍下来的风险再配置到其他品种，因此这是一条「只减不补」的风控叠加，而不是再优化。"
        f"绩效与风险一律按风险日报「净值曲线」同一套 MOM 产品净值计算："
        f"日收益 = 当日盈亏 / 上日累计净资本（申购赎回累计后再加当日盈亏），"
        f"年化收益用区间 CAGR，波动用日收益总体标准差×√252，夏普 = CAGR / 年化波动。"
        f"这不是各期货账户客户权益之和，也不是用规则权重另造一条组合。",
    )
    para(
        doc,
        f"在 {first_d}–{last_d} 样本上，单品种 MCR 曾有 {pct(th['prod_ge'][0.30])} 的交易日触及或超过 30%，"
        f"单板块 MCR 曾有 {pct(th['sec_ge'][0.50])} 的交易日触及或超过 50%；"
        f"两条限额任意一条触发的交易日占比为 {pct(th['both_30_50'])}。"
        f"按 T+1 持仓缩放回测，30%/50% 规则累计{'提升' if better else '降低'}组合盈亏 "
        f"{signed_wan(net)} 万元："
        f"其中避免亏损 {wan(bt0['saved_sum'])} 万元，同时让渡盈利 {wan(bt0['given_sum'])} 万元。"
        f"净值最大回撤由 {pct(a['mdd'])} {'降至' if c['mdd'] < a['mdd'] else '变为'} {pct(c['mdd'])}，"
        f"年化波动由 {pct(a['ann_vol'])} 变为 {pct(c['ann_vol'])}"
        f"（相对 {(c['ann_vol']/a['ann_vol']-1)*100:+.1f}%），"
        f"夏普由 {a['sharpe']:.2f} 变为 {c['sharpe']:.2f}。"
        f"{'也就是说：盈亏对冲的同时，组合波动几乎没有被削下来。' if abs(c['ann_vol']/a['ann_vol']-1) < 0.03 else '波动与回撤随规则一起下降，夏普的变化取决于收益是否也被切掉。'}"
        f"规则共干预 {bt0['n_signal']} 个交易日（信号日），约占样本的 {pct(bt0['n_signal']/max(th['n']-1,1))}。",
    )

    ranked = sorted(alts, key=lambda r: (-(r["net"]), r["c_st"]["mdd"]))
    loser = next((r for r in alts if r["spec"]["short"] == "25/45 只砍亏"), None)
    if loser is None:
        loser = next((r for r in alts if r["spec"].get("loser_only") and not r["spec"].get("var_q") and not r["spec"].get("hard_prod_cap")), None)
    tight = next((r for r in alts if r["spec"]["short"] == "MCR 20/60"), ranked[0])
    r_dd = next((r for r in alts if r["spec"]["short"] == "25/45 L5+DD5"), None)
    r_prod25 = next((r for r in alts if r["spec"]["short"] == "仅品种25 L5"), None)
    r_2040 = next((r for r in alts if r["spec"]["short"] == "20/40 L5"), None)
    r_scope = next((r for r in alts if r["spec"]["short"] == "30/50 金银猪蛋"), None)
    rec = r_dd or (loser if loser and loser["net"] > 0 else ranked[0])
    dd_txt = ""
    if r_dd:
        dd_txt = (
            f"综合净效果与干预次数，本样本最值得写成制度的是「{r_dd['spec']['short']}」："
            f"{r_dd['spec']['name']}。"
            f"相对实际组合净效果 {signed_wan(r_dd['net'])} 万元，"
            f"避免亏损 {wan(r_dd['saved_sum'])} 万元、让渡盈利 {wan(r_dd['given_sum'])} 万元，"
            f"最大回撤 {pct(a['mdd'])}→{pct(r_dd['c_st']['mdd'])}，夏普 {a['sharpe']:.2f}→{r_dd['c_st']['sharpe']:.2f}，"
            f"但只干预 {r_dd['n_signal']} 个交易日"
            f"（约占可计算日的 {pct(r_dd['n_signal']/max(th['n']-1,1))}）。"
            f"对比：无条件 30/50 干预 {bt0['n_signal']} 日、净效果仅 {signed_wan(bt0['net'])} 万；"
            + (
                f"「25/45 只砍亏」净效果 {signed_wan(loser['net'])} 万，却要动手 {loser['n_signal']} 日；"
                if loser else ""
            )
            + "少干预、效果不差，是把 L5+DD5 放在结论第一条的原因。"
        )
    else:
        dd_txt = (
            f"综合净效果、回撤与干预次数，更值得写成日常硬限额的是：{rec['spec']['name']}。"
            f"该方案净效果 {signed_wan(rec['net'])} 万元，干预 {rec['n_signal']} 日。"
        )
    alt_txt = ""
    if r_prod25:
        alt_txt += (
            f"若不想等净值先回撤 5%、而要全年日常开关，次选是「{r_prod25['spec']['short']}」"
            f"（净效果 {signed_wan(r_prod25['net'])} 万，干预 {r_prod25['n_signal']} 日）。"
        )
    if r_2040:
        alt_txt += (
            f"「{r_2040['spec']['short']}」累计净效果更高（{signed_wan(r_2040['net'])} 万），"
            f"但干预 {r_2040['n_signal']} 日，已经不像限额。"
        )
    scope_txt = ""
    if r_scope:
        scope_txt = (
            f"另测「{r_scope['spec']['short']}」：30%/50% 限额只作用于金、银、生猪、鸡蛋，"
            f"板块腿只作用于贵金属、生鲜（锂/能化/股指超限一律不砍）。"
            f"净效果 {signed_wan(r_scope['net'])} 万，干预 {r_scope['n_signal']} 日"
            f"（全书 30/50 为 {bt0['n_signal']} 日）。详见 4.3。"
        )
    para(
        doc,
        f"30%/50% 在这段历史上接近「盈亏中性的保险」：避免的亏损与让渡的盈利几乎抵消。"
        f"网格显示，真正改善累计盈亏的是更紧的单品种上限（约 20%–25%），而不是更紧的板块上限。"
        f"但单品种 20% 在样本里几乎天天触发，已经不像限额、更像持续去集中度叠加。"
        f"{dd_txt}{alt_txt}{scope_txt}"
        f"条件规则深挖见第五章：近 5 日亏损过滤是唯一站得住的品种层开关；"
        f"「仅高VaR日启动」和「组合近5日亏损才启动」在样本里净效果为负或接近零，不能当唯一点火器。"
        f"若接受几乎每日微调，单品种 MCR<20%（{tight['spec']['short']}）的净效果可以更高，"
        f"只作研究对照，不宜直接当值班硬限额。"
        f"另外：全年 21% 波动几乎全部来自 2026 年 1–4 月碳酸锂双向暴打（窗口内约 35%，窗口外约 13%）。"
        f"MCR 限额削不掉这段滚动波动尖峰；要压到 20% 附近必须用预测波动缩书或碳酸锂市值硬顶，见第六章。",
    )

    heading(doc, "二、规则定义与计算方法", 1)
    heading(doc, "2.1 与线上 VaR 沙盒一致的 MCR", 2)
    para(
        doc,
        "品种 i 的人民币波动 dv_i = σ_i × 净持仓市值（多正空负）。σ_i 取该品种主力连续合约近 20 个交易日收益率样本标准差"
        "（已剔除换月尖刺）；相关矩阵取近 252 个交易日，样本初期不足 252 日时用不少于 60 日的扩张窗口，以便覆盖 2025 年下半年持仓。边际贡献",
    )
    para(doc, "MCR_i = | dv_i × Σ_j (dv_j × ρ_ij) |，   占比 = MCR_i / Σ MCR。", size=11, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    para(
        doc,
        "板块（及细分）占比是板块内品种 MCR 之和再除以合计。这与风险日报右侧「品种 / 板块边际波动贡献占比」饼图同一套数。"
        "排除国信/国投对照账户、期权合约与组合期权腿，与线上默认过滤一致。",
    )
    heading(doc, "2.2 拟议限额如何执行（回测假设）", 2)
    para(
        doc,
        "T 日收盘后若某品种 MCR 占比超过上限 u，则把该品种名义敞口乘以 k = u / MCR%；"
        "若某板块超限，则板块内所有品种同比例压缩。两规则同时触发时取更严的 k。"
        "压缩在 T+1 生效，用 T 日净市值 × T+1 品种涨跌估算被砍掉的盈亏，再从组合实际当日盈亏中扣除该部分。"
        "手续费、权利金、期权与盘中交易等无法用市值×涨跌还原的部分保持不变。"
        "假设：无滑点、可按比例减仓、减仓资金不转入其他品种。因此「节省亏损」是上限口径——实盘会略差。",
    )

    heading(doc, "三、历史阈值触及统计", 1)
    para(
        doc,
        f"样本内单品种最大 MCR 中位数为 {np.median(th['max_prod'])*100:.1f}%、"
        f"均值 {np.mean(th['max_prod'])*100:.1f}%、"
        f"最高 {np.max(th['max_prod'])*100:.1f}%（{th['dates'][int(np.argmax(th['max_prod']))]}，"
        f"{prod_label(th['max_prod_name'][int(np.argmax(th['max_prod']))] )}）。"
        f"单板块最大 MCR 中位数 {np.median(th['max_sec'])*100:.1f}%、"
        f"最高 {np.max(th['max_sec'])*100:.1f}%（{th['dates'][int(np.argmax(th['max_sec']))]}，"
        f"{th['max_sec_name'][int(np.argmax(th['max_sec']))]}）。"
        f"30% 品种限额并不极端：约三分之一左右的日子会碰到；50% 板块限额更松，触发更少。",
    )
    add_picture(doc, charts["ts"])
    caption(doc, "图1  每日最大单品种 / 单板块 MCR。虚线为拟议 30% 与 50% 限额，色块为超限区域。")
    add_picture(doc, charts["hist"])
    caption(doc, "图2  最大 MCR 的经验分布。红色虚线为拟议阈值。")

    add_table(
        doc,
        ["阈值", "单品种最大MCR≥阈值的交易日占比", "阈值", "单板块最大MCR≥阈值的交易日占比"],
        [
            [f"{int(t*100)}%", pct(th["prod_ge"][t]), f"{int(s*100)}%", pct(th["sec_ge"][s])]
            for t, s in zip((0.20, 0.25, 0.30, 0.35, 0.40, 0.50), (0.35, 0.40, 0.45, 0.50, 0.55, 0.60))
        ],
    )
    caption(doc, "表1  不同宽松程度下的历史触发频率。30%/50% 是「中等偏松」的一对。")

    add_picture(doc, charts["prod_rank"])
    caption(doc, "图3  哪些品种最常把组合的边际波动贡献顶过 30%。")
    add_picture(doc, charts["sec_rank"])
    caption(doc, "图4  板块层面 ≥50% 的触发次数。能源化工、股指、贵金属通常是集中度来源。")

    heading(doc, "3.1 高集中度之后，组合次日是否更容易亏？", 2)
    para(
        doc,
        "限额要有价值，高 MCR 应至少与更差的左尾或更高的次日亏损概率相联系，而不能只是「持仓看起来不舒服」。"
        "下图按 T 日最大单品种 MCR 分组，看 T+1 组合收益（用客户权益作分母）。",
    )
    add_picture(doc, charts["cond"])
    caption(doc, "图5  条件期望：高品种集中度分组的次日收益（基点）。")
    add_table(
        doc,
        ["当日最大品种MCR", "样本日", "次日均收益", "次日5%分位", "次日最差", "次日亏损日占比", "次日均盈亏(万)"],
        [
            [
                r["label"],
                str(r["n"]),
                f"{r['mean']*100:.2f}%",
                f"{r['p05']*100:.2f}%",
                f"{r['worst']*100:.2f}%",
                pct(r["neg_share"]),
                wan(r["mean_pnl"]),
            ]
            for r in cond_rows
        ],
    )
    caption(doc, "表2  高 MCR 分组的次日分布。若 ≥30% 组左尾更深或亏损占比更高，则硬限额具有保险价值。")

    # worst official-PnL days vs prior MCR day
    worst_idx = np.argsort(bt0["actual"])[:12]
    day_by_date = {d["date"]: d for d in days}
    mcr_dates = [d["date"] for d in days]
    wrows = []
    for i in worst_idx:
        d = bt0["dates"][i]
        prev = None
        for md in mcr_dates:
            if md < d:
                prev = day_by_date[md]
            else:
                break
        if prev is None:
            continue
        wrows.append(
            [
                d,
                signed_wan(bt0["actual"][i]),
                f"{max(prev['prod_mcr'].values())*100:.1f}%" if prev["prod_mcr"] else "-",
                prod_label(max(prev["prod_mcr"], key=prev["prod_mcr"].get)) if prev["prod_mcr"] else "-",
                f"{max(prev['sector_mcr'].values())*100:.1f}%" if prev["sector_mcr"] else "-",
                max(prev["sector_mcr"], key=prev["sector_mcr"].get) if prev["sector_mcr"] else "-",
                signed_wan(bt0["cf"][i] - bt0["actual"][i]),
            ]
        )
    heading(doc, "3.2 历史最差亏损日的前一日集中度", 2)
    para(doc, "若大亏日前一日已经顶着限额，则规则有机会在次日少亏；若大亏发生在分散持仓上，集中度限额帮不上忙。")
    add_table(
        doc,
        ["亏损日", "实际盈亏(万)", "前日最大品种MCR", "品种", "前日最大板块MCR", "板块", "30/50规则当日改善(万)"],
        wrows,
    )
    caption(doc, "表3  样本内最差交易日与前一日 MCR。最后一列为 30%/50% 规则在该日的盈亏改善。")

    heading(doc, "四、30% / 50% 规则回测", 1)
    para(
        doc,
        f"基准就是风险日报上的 MOM 产品净值（截图里最新净值约 1.53、累计收益约 53%、回撤约 17%、年化波动约 21%、夏普约 2.08 那条）。"
        f"反事实只替换每日盈亏（减去被规则砍掉的品种估算盈亏），申购赎回现金流保持不变，再按同一公式重算累计净资本与净值。"
        f"实际累计收益 {pct(a.get('total_ret', a['ann_ret']))}，规则后 {pct(c.get('total_ret', c['ann_ret']))}；"
        f"累计盈亏 {wan(float(bt0['actual'].sum()))} 万元 → {wan(float(bt0['cf'].sum()))} 万元。",
    )
    add_picture(doc, charts["nav0"])
    caption(doc, "图6  实际净值 vs 施加 单品种MCR<30% 且 单板块MCR<50% 后的反事实净值。")
    add_picture(doc, charts["decomp0"])
    caption(doc, "图7  避免亏损、让渡盈利与净效果的累计路径。净效果=避免亏损−让渡盈利。")
    add_picture(doc, charts["dd0"])
    caption(doc, "图8  回撤对比。集中度限额的主要价值通常出现在左尾，而不是提高平均收益。")

    add_table(
        doc,
        ["指标", "实际组合", "30%/50% 规则", "变化"],
        [
            ["累计收益（净值）", pct(a.get("total_ret", 0)), pct(c.get("total_ret", 0)), f"{(c.get('total_ret',0)-a.get('total_ret',0))*100:+.2f}pt"],
            ["累计盈亏（万元）", wan(float(bt0["actual"].sum())), wan(float(bt0["cf"].sum())), signed_wan(net)],
            ["避免亏损（万元）", "—", wan(bt0["saved_sum"]), wan(bt0["saved_sum"])],
            ["让渡盈利（万元）", "—", wan(bt0["given_sum"]), f"-{wan(bt0['given_sum'])}"],
            ["年化收益", pct(a["ann_ret"]), pct(c["ann_ret"]), f"{(c['ann_ret']-a['ann_ret'])*100:+.2f}pt"],
            ["年化波动", pct(a["ann_vol"]), pct(c["ann_vol"]), f"{(c['ann_vol']-a['ann_vol'])*100:+.2f}pt"],
            ["下行波动（年化）", pct(a["down_vol"]), pct(c["down_vol"]), f"{(c['down_vol']-a['down_vol'])*100:+.2f}pt"],
            ["上行波动（年化）", pct(a["up_vol"]), pct(c["up_vol"]), f"{(c['up_vol']-a['up_vol'])*100:+.2f}pt"],
            ["夏普", f"{a['sharpe']:.2f}", f"{c['sharpe']:.2f}", f"{c['sharpe']-a['sharpe']:+.2f}"],
            ["索提诺", f"{a['sortino']:.2f}", f"{c['sortino']:.2f}", f"{c['sortino']-a['sortino']:+.2f}"],
            ["最大回撤", pct(a["mdd"]), pct(c["mdd"]), f"{(c['mdd']-a['mdd'])*100:+.2f}pt"],
            ["卡玛", f"{a['calmar']:.2f}", f"{c['calmar']:.2f}", f"{c['calmar']-a['calmar']:+.2f}"],
            ["最差单日盈亏（万）", signed_wan(bt0["worst_a"]), signed_wan(bt0["worst_c"]), signed_wan(bt0["worst_c"] - bt0["worst_a"])],
            ["盈亏5%分位（万）", signed_wan(bt0["p05_a"]), signed_wan(bt0["p05_c"]), signed_wan(bt0["p05_c"] - bt0["p05_a"])],
            ["干预日数 / 信号日", "—", str(bt0["n_signal"]), pct(bt0["n_signal"] / max(th["n"] - 1, 1))],
        ],
    )
    caption(doc, "表4  30%/50% 规则的绩效对照。变化列对「避免/让渡」给出绝对值，其余为规则减实际。")

    heading(doc, "4.2 波动、回撤与夏普：30/50 有没有把组合「削薄」？", 2)
    vol_chg = (c["ann_vol"] - a["ann_vol"]) / a["ann_vol"] if a["ann_vol"] > 0 else 0.0
    mdd_chg = (c["mdd"] - a["mdd"]) / a["mdd"] if a["mdd"] > 0 else 0.0
    down_chg = (c["down_vol"] - a["down_vol"]) / a["down_vol"] if a["down_vol"] > 0 else 0.0
    up_chg = (c["up_vol"] - a["up_vol"]) / a["up_vol"] if a["up_vol"] > 0 else 0.0
    if vol_chg < -0.02:
        vol_verdict = f"会。样本内年化波动从 {pct(a['ann_vol'])} 降到 {pct(c['ann_vol'])}，相对降幅 {vol_chg*100:.1f}%。"
    elif vol_chg > 0.02:
        vol_verdict = f"没有。年化波动从 {pct(a['ann_vol'])} 升到 {pct(c['ann_vol'])}（{vol_chg*100:+.1f}%）。"
    else:
        vol_verdict = (
            f"几乎没有。年化波动 {pct(a['ann_vol'])} → {pct(c['ann_vol'])}，相对变化仅 {vol_chg*100:+.1f}%，"
            f"在统计上可以看成同一条波动路径。"
        )
    para(
        doc,
        f"30%/50% 同时砍掉盈利与亏损，净盈亏接近零，并不自动等于「波动也下来了」。"
        f"波动是否下降，取决于被砍掉的是不是当日的大波动，而不是盈亏是否对冲。"
        f"结论：{vol_verdict}"
        f"最大回撤 {pct(a['mdd'])} → {pct(c['mdd'])}（相对 {mdd_chg*100:+.1f}%），"
        f"夏普 {a['sharpe']:.2f} → {c['sharpe']:.2f}（{c['sharpe']-a['sharpe']:+.2f}）。"
        f"下行波动变化 {down_chg*100:+.1f}%，上行波动变化 {up_chg*100:+.1f}%——"
        f"{'左右尾几乎对称变薄，所以夏普几乎不动或仅随波动微升' if abs(down_chg-up_chg)<0.05 else '左右尾不对称，规则对收益质量有方向性影响'}。",
    )
    para(
        doc,
        f"把交易日拆开看更清楚：规则只在干预日改持仓，安静日两条路径应当重合。"
        f"干预日（{bt0['n_int_days']} 天）上，实际年化波动 {pct(bt0['vol_int_a'])}，规则后 {pct(bt0['vol_int_c'])}；"
        f"非干预日实际 {pct(bt0['vol_quiet_a'])}、规则后 {pct(bt0['vol_quiet_c'])}。"
        f"干预日里，有 {pct(bt0['shrink_share'])} 的日子 |日收益| 被缩小。"
        f"{'因此 30/50 对波动的贡献很弱：它切的是集中度，不是必然切到组合的大波动日。' if abs(vol_chg)<0.03 else '波动下降主要发生在干预日，安静日几乎不变，说明规则本身在起阻尼作用。'}",
    )
    if "roll_vol" in charts:
        add_picture(doc, charts["roll_vol"])
        caption(doc, "图9  20 日滚动年化波动。30/50 几乎贴着实际线：集中度限额削不掉 2026 年 1–4 月那一段 50%+ 的尖峰。能压尖峰的规则见第六章图20。")
    if "risk_bars" in charts:
        add_picture(doc, charts["risk_bars"])
        caption(doc, "图10  实际组合与关键规则的年化波动、最大回撤、夏普。灰柱为实盘。")
    if "ret_hist" in charts:
        add_picture(doc, charts["ret_hist"])
        caption(doc, "图11  日收益直方图。左右两尾若同时变矮，才是「牺牲利润 + 避免亏损」换来的波动下降。")

    featured = []
    want = ["MCR 30/50", "MCR 25/45", "MCR 20/60", "25/45 只砍亏", "30/50 金银猪蛋"]
    by_short = {r["spec"]["short"]: r for r in alts}
    for k in want:
        if k in by_short:
            featured.append(by_short[k])
    rrows = [[
        "实际组合",
        "—",
        pct(a["ann_vol"]),
        pct(a["down_vol"]),
        pct(a["mdd"]),
        f"{a['sharpe']:.2f}",
        f"{a['sortino']:.2f}",
        f"{a['calmar']:.2f}",
        "0.0",
    ]]
    for r in featured:
        st, ast = r["c_st"], r["a_st"]
        rrows.append([
            r["spec"]["short"],
            str(r["n_signal"]),
            f"{pct(st['ann_vol'])}（{(st['ann_vol']/ast['ann_vol']-1)*100:+.1f}%）" if ast["ann_vol"] else pct(st["ann_vol"]),
            pct(st["down_vol"]),
            f"{pct(st['mdd'])}（{(st['mdd']/ast['mdd']-1)*100:+.1f}%）" if ast["mdd"] else pct(st["mdd"]),
            f"{st['sharpe']:.2f}（{st['sharpe']-ast['sharpe']:+.2f}）",
            f"{st['sortino']:.2f}",
            f"{st['calmar']:.2f}",
            signed_wan(r["net"]),
        ])
    add_table(
        doc,
        ["规则", "干预日", "年化波动（相对实际）", "下行波动", "最大回撤（相对实际）", "夏普（变化）", "索提诺", "卡玛", "净效果(万)"],
        rrows,
    )
    caption(
        doc,
        "表4-附  风险指标对照。括号为相对实际组合的变化。"
        "30/50 若波动/回撤几乎不动，说明它主要是盈亏对冲，不是降波工具；"
        "20/60 与「只砍亏」若波动和回撤同时下降且夏普上升，才同时具备保险与效率。",
    )

    heading(doc, "4.1 干预最大的若干交易日", 2)
    ev = sorted(bt0["event_log"], key=lambda e: -abs(e["avoided"]))[:10]
    erows = []
    for e in ev:
        tops = "；".join(
            f"{lab} 砍{cut*100:.0f}% 估盈亏{signed_wan(recon)}"
            for _p, lab, cut, recon, _d in e["top"][:2]
        )
        erows.append(
            [
                e["signal_date"],
                e["pnl_date"],
                f"{e['max_prod']*100:.1f}% {prod_label(e['max_prod_name'])}",
                f"{e['max_sec']*100:.1f}% {e['max_sec_name']}",
                signed_wan(-e["avoided"]),
                wan(e["saved"]),
                wan(e["given"]),
                tops,
            ]
        )
    add_table(
        doc,
        ["信号日", "生效日", "最大品种MCR", "最大板块MCR", "当日净效果(万)", "避免亏损", "让渡盈利", "主要压缩"],
        erows,
    )
    caption(doc, "表5  按 |净效果| 排序的前十大干预。净效果为正表示规则让该日少亏或多赚。")

    heading(doc, "4.3 只盯金、银、生猪、鸡蛋 / 贵金属、生鲜", 2)
    r_scope = next((r for r in alts if r["spec"]["short"] == "30/50 金银猪蛋"), None)
    if r_scope is not None:
        para(
            doc,
            "全书 30/50 会同时砍碳酸锂、能化、股指等所有超限名字。"
            "若值班只想管贵金属与生鲜这两条线，可以把同一套阈值收窄："
            "品种 MCR<30% 只对黄金、白银、生猪、鸡蛋生效；"
            "板块 MCR<50% 只对贵金属、生鲜生效。"
            "贵金属超限时，板块内的铂、钯会随金、银同比例压缩；生鲜超限时苹果、红枣同理。"
            "锂、能化、股指即使顶满饼图，这条规则也不动手。执行仍是 T+1、只减不补。",
        )
        para(
            doc,
            f"相对全书 30/50（干预 {bt0['n_signal']} 日、净效果 {signed_wan(bt0['net'])} 万），"
            f"「{r_scope['spec']['short']}」干预 {r_scope['n_signal']} 日、"
            f"净效果 {signed_wan(r_scope['net'])} 万，"
            f"避免亏损 {wan(r_scope['saved_sum'])} 万、让渡盈利 {wan(r_scope['given_sum'])} 万，"
            f"年化波动 {pct(a['ann_vol'])}→{pct(r_scope['c_st']['ann_vol'])}，"
            f"最大回撤 {pct(a['mdd'])}→{pct(r_scope['c_st']['mdd'])}，"
            f"夏普 {a['sharpe']:.2f}→{r_scope['c_st']['sharpe']:.2f}。"
            f"{'干预明显少于全书 30/50，因为样本里大量超限来自锂与能化，不在这份名单里。' if r_scope['n_signal'] < bt0['n_signal'] else '干预次数并未明显少于全书，说明金/银/猪/蛋或贵金属/生鲜本身就是 30/50 的主要触发源。'}",
        )
        sc_a, sc_c = r_scope["a_st"], r_scope["c_st"]
        add_table(
            doc,
            ["指标", "实际组合", "全书 30/50", "30/50 金银猪蛋"],
            [
                ["干预日 / 信号日", "—", str(bt0["n_signal"]), str(r_scope["n_signal"])],
                ["累计盈亏（万元）", wan(float(bt0["actual"].sum())), wan(float(bt0["cf"].sum())), wan(float(r_scope["cf"].sum()))],
                ["净效果（万元）", "0.0", signed_wan(bt0["net"]), signed_wan(r_scope["net"])],
                ["避免亏损（万元）", "—", wan(bt0["saved_sum"]), wan(r_scope["saved_sum"])],
                ["让渡盈利（万元）", "—", wan(bt0["given_sum"]), wan(r_scope["given_sum"])],
                ["年化波动", pct(a["ann_vol"]), pct(c["ann_vol"]), pct(sc_c["ann_vol"])],
                ["最大回撤", pct(a["mdd"]), pct(c["mdd"]), pct(sc_c["mdd"])],
                ["夏普", f"{a['sharpe']:.2f}", f"{c['sharpe']:.2f}", f"{sc_c['sharpe']:.2f}"],
                ["最差单日盈亏（万）", signed_wan(bt0["worst_a"]), signed_wan(bt0["worst_c"]), signed_wan(r_scope["worst_c"])],
            ],
        )
        caption(doc, "表5-附  全书 30/50 与「只盯金/银/生猪/鸡蛋 + 贵金属/生鲜」对照。")
        cut_cnt = Counter()
        for e in r_scope["event_log"]:
            for _p, lab in e.get("cut_prods") or [(t[0], t[1]) for t in e.get("top", [])]:
                cut_cnt[lab] += 1
        if cut_cnt:
            crow = [[lab, str(n), pct(n / max(r_scope["n_signal"], 1))] for lab, n in cut_cnt.most_common(8)]
            add_table(doc, ["被压缩品种", "出现天数", "占本规则信号日"], crow)
            caption(doc, "表5-附2  「30/50 金银猪蛋」实际动手的品种。名单外的锂/能化/股指不会出现。")
        if "nav_scoped" in charts:
            add_picture(doc, charts["nav_scoped"])
            caption(doc, "图6-附  实际净值 vs 全书 30/50 vs 只盯金/银/猪/蛋与贵金属/生鲜。")
        evs = sorted(r_scope["event_log"], key=lambda e: -abs(e["avoided"]))[:8]
        erows = []
        for e in evs:
            tops = "；".join(
                f"{lab} 砍{cut*100:.0f}%"
                for _p, lab, cut, _recon, _d in e["top"][:3]
            )
            erows.append(
                [
                    e["signal_date"],
                    e["pnl_date"],
                    f"{e['max_prod']*100:.1f}% {prod_label(e['max_prod_name'])}",
                    f"{e['max_sec']*100:.1f}% {e['max_sec_name']}",
                    signed_wan(-e["avoided"]),
                    wan(e["saved"]),
                    wan(e["given"]),
                    tops,
                ]
            )
        if erows:
            add_table(
                doc,
                ["信号日", "生效日", "当日最大品种MCR", "当日最大板块MCR", "净效果(万)", "避免亏损", "让渡盈利", "本规则压缩"],
                erows,
            )
            caption(
                doc,
                "表5-附3  本规则 |净效果| 最大的干预日。"
                "「当日最大品种/板块 MCR」仍是全书饼图，可能是锂或能化；"
                "右侧「本规则压缩」才是实际被砍的金/银/猪/蛋或贵金属/生鲜。",
            )

    heading(doc, "五、有没有更好的规则？", 1)
    para(
        doc,
        "在同一套 T+1 缩放框架下比较三类规则：（1）品种/板块 MCR 上限网格；"
        "（2）更易执行的市值集中度上限（不依赖波动与相关）；（3）带条件的规则。"
        "第（3）类是本章重点：不只比较「25/45 只砍近5日亏损」和「高VaR日才启动」两条，"
        "而是把回看窗口、亏损强度、VaR 分位/绝对门槛、扩张窗口（避免用全样本分位偷看未来）、"
        "组合近5日盈亏、净值回撤门槛、软硬双档、以及「平时只砍亏 / 压力日全砍」全部跑完。"
        "另试「品种 25% + 细分板块 40%」，因为能源化工内部的油品/煤化工/芳烃往往比大板块更同涨同跌。",
    )

    heading(doc, "5.1 无条件网格与市值规则", 2)
    add_picture(doc, charts["heat"])
    caption(doc, "图12  无条件 MCR 上限网格的累计净效果（万元）。红色表示规则优于实盘（A股红涨绿跌）。")
    add_picture(doc, charts["scatter"])
    caption(doc, "图13  备选规则的回撤–净效果散点。只标关键规则，其余用颜色区分；理想区域是左上。")

    headline_cond = {"25/45 只砍亏", "30/50 高VaR", "25/45 高VaR"}
    show = [r for r in alts if r["spec"].get("family") != "cond" or r["spec"]["short"] in headline_cond]
    show = sorted(show, key=lambda r: (-r["net"], r["c_st"]["mdd"]))
    add_table(
        doc,
        ["规则", "干预日", "净效果(万)", "避免亏损", "让渡盈利", "年化波动", "最大回撤", "夏普", "卡玛", "最差日改善"],
        _rule_table_rows(show, bt0),
    )
    caption(doc, "表6  网格、市值规则，以及三条最初的条件规则。完整条件扫描见表7–表9。")

    if "nav_rec" in charts:
        add_picture(doc, charts["nav_rec"])
        caption(doc, "图14  实际净值与 30%/50%、只砍亏、以及结论首选「25/45 L5+DD5」（仅回撤≥5%时启动，干预 48 日）对照。")

    heading(doc, "5.2 条件规则的机制：该砍谁、该在哪天砍", 2)
    by_short = {r["spec"]["short"]: r for r in alts}
    l5 = by_short.get("25/45 只砍亏")
    win_ctrl = by_short.get("25/45 只砍盈")
    v60 = by_short.get("25/45 高VaR") or by_short.get("25/45 VQ60")
    para(
        doc,
        "无条件 25/45 会同时压缩刚赚钱的超限品种和正在亏的超限品种。"
        "把 25/45 的「本会压缩」名单按近 N 日该品种估算盈亏拆开，看次日被砍掉的那一截（(1−k)×次日还原盈亏）"
        "符号是否可分，才能判断「只砍亏」是不是在捡钱，而不是事后拟合的故事。",
    )
    if trail_diag and "trail" in charts:
        add_picture(doc, charts["trail"])
        caption(
            doc,
            "图15  同一份 25/45 超限名单，按近 N 日品种盈亏过滤后的潜在净效果。"
            "柱色按 A 股习惯：红正绿负；斜线柱=只砍盈利侧。只有两边符号相反，过滤器才有独立信息。",
        )
        trows = []
        for lb in sorted(trail_diag["by_lb"]):
            lo, wi = trail_diag["by_lb"][lb]["losers"], trail_diag["by_lb"][lb]["winners"]
            trows.append([
                f"{lb}日",
                str(lo["n"]),
                signed_wan(lo["net_if_cut"]),
                pct(lo["neg_share"]),
                signed_wan(lo["p05_recon"]),
                str(wi["n"]),
                signed_wan(wi["net_if_cut"]),
                pct(wi["neg_share"]),
            ])
        add_table(
            doc,
            ["回看", "亏损侧条数", "只砍亏净效果", "次日亏损占比", "次日5%分位", "盈利侧条数", "只砍盈净效果", "次日亏损占比"],
            trows,
        )
        caption(doc, "表7  过滤器诊断。净效果按压缩比例加权，与回测口径一致。")
        d5 = trail_diag["by_lb"].get(5, {})
        if d5:
            para(
                doc,
                f"样本里近 5 日是唯一能把两侧拆开的窗口：只砍亏损侧潜在净效果 {signed_wan(d5['losers']['net_if_cut'])} 万元，"
                f"只砍盈利侧 {signed_wan(d5['winners']['net_if_cut'])} 万元。"
                f"3 日窗口两侧都略正，10 日、20 日窗口几乎没有判别力——"
                f"更长的「亏损」定义把已经走完的趋势和即将反转的名字混在一起。"
                f"{'反例「只砍近5日盈利品种」回测净效果 ' + signed_wan(win_ctrl['net']) + ' 万元，与诊断同向，说明 5 日过滤器不是把同一批干预换个名字。' if win_ctrl else ''}",
            )
    if "lookback" in charts:
        add_picture(doc, charts["lookback"])
        caption(doc, "图16  把「只砍亏」嵌进完整 T+1 回测后，回看窗口扫描。峰值应落在 5 日附近。")

    para(
        doc,
        "另一条直觉是：只在组合 95% VaR / 权益偏高时启动，平时不动手。"
        "这在值班上很好写，但样本并不支持它单独当开关。",
    )
    if var_diag and "var_reg" in charts:
        add_picture(doc, charts["var_reg"])
        caption(doc, "图17  按当日 VaR/权益是否高于全样本 60% 分位，看次日官方盈亏均值。")
        vrows = []
        for r in var_diag:
            vrows.append([
                r["label"],
                f"{r['thr']*100:.2f}%",
                str(r["n"]),
                signed_wan(r["mean"]),
                signed_wan(r["p05"]),
                signed_wan(r["worst"]),
                pct(r["neg_share"]),
            ])
        add_table(
            doc,
            ["分组", "门槛(VaR/权益)", "次日样本", "次日均盈亏(万)", "次日5%分位", "次日最差", "次日亏损日占比"],
            vrows,
        )
        caption(
            doc,
            "表8  高 VaR 日均值更好、左尾也更深。只在高 VaR 启动，等于主动放弃一段风险溢价，"
            "同时仍可能漏掉「波动不高但名字很集中」的事故。",
        )
    # worst official days vs whether a high-VaR gate would even be on
    worst_idx = np.argsort(bt0["actual"])[:8]
    day_by_date = {d["date"]: d for d in days}
    mcr_dates = [d["date"] for d in days]
    cap_map = {d: c for d, c in zip(bt0["dates"], bt0["equity"])}
    q60_thr = 0.0196
    if var_diag:
        for vr_row in var_diag:
            if abs(vr_row.get("q", 0) - 0.60) < 1e-9 and "≥" in vr_row.get("label", ""):
                q60_thr = float(vr_row["thr"])
                break
    wrows = []
    for i in worst_idx:
        d = bt0["dates"][i]
        prev = None
        for md in mcr_dates:
            if md < d:
                prev = day_by_date[md]
            else:
                break
        if prev is None:
            continue
        eq = cap_map.get(prev["date"], np.nan)
        vr = (prev["var95"] / eq) if eq and eq > 0 else float("nan")
        mx = max(prev["prod_mcr"].values()) if prev["prod_mcr"] else 0
        pname = prod_label(max(prev["prod_mcr"], key=prev["prod_mcr"].get)) if prev["prod_mcr"] else "-"
        def _delta(short):
            r = by_short.get(short)
            if r is None:
                return "-"
            j = r["dates"].index(d) if d in r["dates"] else None
            return signed_wan(r["cf"][j] - r["actual"][j]) if j is not None else "-"
        wrows.append([
            d,
            signed_wan(bt0["actual"][i]),
            f"{mx*100:.1f}% {pname}",
            f"{vr*100:.2f}%" if np.isfinite(vr) else "-",
            "是" if np.isfinite(vr) and vr >= q60_thr else "否",
            _delta("MCR 30/50"),
            _delta("MCR 25/45"),
            _delta("25/45 只砍亏"),
            _delta("25/45 高VaR"),
        ])
    add_table(
        doc,
        ["亏损日", "实际(万)", "前日最大品种MCR", "前日VaR/权益", "高于Q60?", "30/50", "25/45", "25/45只砍亏", "25/45高VaR"],
        wrows,
    )
    caption(
        doc,
        "表9  样本内最差 8 个官方盈亏日。碳酸锂多次在 24%–33% 附近把组合打穿——"
        "30% 硬限额会漏掉其中若干天；50% 板块限额在这些日子从未碰到。"
        "2026-06-22 鸡蛋集中度事故发生在 VaR/权益仅约 1.3% 的日子，高 VaR 门是关着的。",
    )

    heading(doc, "5.3 条件规则回测：哪些变体真的更好", 2)
    para(
        doc,
        "下面把条件规则分成四组：回看窗口、VaR 开关、品种过滤器叠在不同限额上、"
        "以及双档 / 压力日全砍 / 组合层门槛。VaR 分位同时给了全样本（有前视，偏乐观）和扩张窗口（可实盘）。",
    )
    if "var_sweep" in charts:
        add_picture(doc, charts["var_sweep"])
        caption(doc, "图18  25/45 仅在高 VaR 日启动的门槛扫描。绝对门槛 2% / 2.5% / 3% / 4% 画在同一张图上便于对照。")
    if "cond_scatter" in charts:
        add_picture(doc, charts["cond_scatter"])
        caption(doc, "图19  带条件规则散点。只标关键点，颜色见图例，避免标签叠在一起。")

    def _by_shorts(names):
        return [by_short[n] for n in names if n in by_short]

    lb_names = ["25/45 L3", "25/45 L4", "25/45 只砍亏", "25/45 L5", "25/45 L6", "25/45 L8", "25/45 L10", "25/45 L20"]
    add_table(
        doc,
        ["规则", "干预日", "净效果(万)", "避免亏损", "让渡盈利", "年化波动", "最大回撤", "夏普", "卡玛", "最差日改善"],
        _rule_table_rows(_by_shorts(lb_names), bt0),
    )
    caption(doc, "表10  同一套 25/45，只改亏损回看天数。L5 与「25/45 只砍亏」是同一条规则。")

    var_names = [
        "25/45 高VaR", "25/45 VQ50", "25/45 VQ60", "25/45 VQ70", "25/45 VQ80",
        "25/45 VQ50扩", "25/45 VQ60扩", "25/45 VQ70扩", "25/45 VQ80扩",
        "25/45 V2.0", "25/45 V2.5", "25/45 V3.0", "25/45 V4.0",
        "30/50 高VaR", "30/50 VQ70扩",
    ]
    add_table(
        doc,
        ["规则", "干预日", "净效果(万)", "避免亏损", "让渡盈利", "年化波动", "最大回撤", "夏普", "卡玛", "最差日改善"],
        _rule_table_rows(_by_shorts(var_names), bt0),
    )
    caption(doc, "表11  高 VaR 日才启动。带「扩」的是扩张窗口分位，没有用到未来的 VaR/权益分布。")

    mix_names = [
        "25/45 只砍亏", "20/40 L5", "25/40 L5", "30/50 L5", "仅品种25 L5", "25+细分40 L5",
        "25/45 L5ret-1", "25/45 L5ret-2", "25/45 L5ret-3",
        "25/45 L5+VQ60", "25/45 L5+V2.5", "25/45 L5+VQ70扩",
        "25/45 组合亏5日", "25/45 L5+组合亏", "25/45 DD≥5%", "25/45 L5+DD5",
        "软25硬40 L5", "软25硬35 L5", "软20硬30 L5",
        "L5+压3%全砍", "L5+压2.5%全砍", "25/45 只砍盈",
        "品种25+细分40",
    ]
    add_table(
        doc,
        ["规则", "干预日", "净效果(万)", "避免亏损", "让渡盈利", "年化波动", "最大回撤", "夏普", "卡玛", "最差日改善"],
        _rule_table_rows(_by_shorts(mix_names), bt0),
    )
    caption(
        doc,
        "表12  过滤器叠限额、更严的亏损定义、VaR/组合/回撤与门、软硬双档、压力日全砍，以及只砍盈反例。"
        "「仅品种25 L5」去掉板块腿，因为最差亏损日的板块 MCR 很少碰到 45%–50%。",
    )

    conds = [r for r in alts if r["spec"].get("family") == "cond"]
    best_cond = sorted(conds, key=lambda r: (-r["net"], r["c_st"]["mdd"]))[:5] if conds else []
    best_txt = "；".join(f"{r['spec']['short']}（{signed_wan(r['net'])}万，回撤{pct(r['c_st']['mdd'])}，干预{r['n_signal']}日）" for r in best_cond)
    l5_txt = ""
    if l5:
        l5_txt = (
            f"基准「25/45 只砍亏」净效果 {signed_wan(l5['net'])} 万元，"
            f"避免亏损 {wan(l5['saved_sum'])}、让渡 {wan(l5['given_sum'])}，"
            f"回撤 {pct(l5['c_st']['mdd'])}，夏普 {l5['c_st']['sharpe']:.2f}，干预 {l5['n_signal']} 日。"
        )
    v60_txt = ""
    if v60:
        v60_txt = (
            f"「25/45 高VaR」净效果 {signed_wan(v60['net'])} 万元，干预 {v60['n_signal']} 日，"
            f"回撤 {pct(v60['c_st']['mdd'])}——"
            f"{'显著弱于只砍亏，且最差日改善有限' if (l5 and v60['net'] < l5['net']) else '作为对照列出'}。"
        )
    sub = by_short.get("品种25+细分40")
    sub_l5 = by_short.get("25+细分40 L5")
    sub_txt = ""
    if sub:
        sub_txt = (
            f"无条件「品种25+细分40」净效果 {signed_wan(sub['net'])} 万元、干预 {sub['n_signal']} 日；"
            + (f"加上只砍亏后为 {signed_wan(sub_l5['net'])} 万元。" if sub_l5 else "")
            + "细分腿能管住油品/芳烃/煤化工的同涨同跌，但对碳酸锂这种本身就是细分板块的名字，并不比大板块更紧。"
        )
    para(doc, f"条件规则按净效果前五：{best_txt}。{l5_txt}{v60_txt}{sub_txt}")

    heading(doc, "5.4 推荐顺序", 2)
    top_net = sorted(alts, key=lambda r: -r["net"])[:3]
    top_mdd = sorted(alts, key=lambda r: (r["c_st"]["mdd"], -r["net"]))[:3]
    top_cal = sorted(alts, key=lambda r: -r["c_st"]["calmar"])[:3]
    net_txt = "；".join(f"{r['spec']['short']}（{signed_wan(r['net'])}万）" for r in top_net)
    mdd_txt = "；".join(f"{r['spec']['short']}（回撤{pct(r['c_st']['mdd'])}）" for r in top_mdd)
    cal_txt = "；".join(f"{r['spec']['short']}（{r['c_st']['calmar']:.2f}）" for r in top_cal)
    para(doc, f"按累计净效果前三（含无条件网格）：{net_txt}。按最大回撤前三：{mdd_txt}。按卡玛前三：{cal_txt}。")

    r_2040 = by_short.get("20/40 L5")
    r_prod25 = by_short.get("仅品种25 L5")
    r_dd = by_short.get("25/45 L5+DD5")
    r_sub = by_short.get("25+细分40 L5")
    r_tier = by_short.get("软25硬40 L5")
    r_var = by_short.get("25/45 高VaR")
    r_port = by_short.get("25/45 组合亏5日")
    r_win = by_short.get("25/45 只砍盈")
    r_stress = by_short.get("L5+压3%全砍")

    def _one(r, fallback=""):
        if r is None:
            return fallback
        return (
            f"{r['spec']['short']}：净效果 {signed_wan(r['net'])} 万，"
            f"干预 {r['n_signal']} 日，回撤 {pct(r['c_st']['mdd'])}，夏普 {r['c_st']['sharpe']:.2f}"
        )

    para(
        doc,
        "条件扫描之后，不宜再把「净效果最高的一条」直接写成唯一硬限额。"
        "20/40 只砍亏的累计净效果确实最高，但干预日超过四成，已经接近持续去集中度，而不像限额。"
        "结论里的首选是少动手的那条：25/45 L5+DD5。",
    )
    para(
        doc,
        "落地建议（按优先级）："
        f"第一层（首选写成制度）：「{r_dd['spec']['short'] if r_dd else '25/45 L5+DD5'}」——"
        f"品种 MCR<25%、板块 MCR<45%，只砍近 5 日亏损品种，且仅在净值回撤≥5% 时启动。"
        f"{_one(r_dd)}。"
        f"样本里净效果接近甚至优于全年只砍亏，干预只有 {r_dd['n_signal'] if r_dd else 48} 日，少干预是它排第一的原因。"
        f"第二层（不想等回撤、要全年日常开关）：「单品种 MCR<25%，且近 5 日该品种估算盈亏为负」。"
        f"不必再挂 45% 板块腿——最差亏损日的板块 MCR 很少碰到 45%–50%，去掉之后"
        f"{_one(r_prod25) or '净效果略好、干预更少'}。"
        f"若希望油品/芳烃/煤化工的同涨同跌也被管住，用「25+细分40 L5」替代板块腿"
        f"（{_one(r_sub)}）。原来的「25/45 只砍亏」仍可用，数字很接近（{_one(l5)}）。"
        f"第三层（研究/沙盒上界，不作为值班硬门槛）：{_one(r_2040)}；"
        f"无条件单品种 20% 仍然是网格里净效果最高的对照，触发过频。"
        f"若必须有一条「不管盈亏的硬顶」，用软 25 / 硬 40（{_one(r_tier)}），"
        f"防止盈利名字把单品种 MCR 顶到 40% 以上。",
    )
    para(
        doc,
        "明确不要写成制度的："
        f"「仅高 VaR 日启动」单独当开关（{_one(r_var)}）——高 VaR 日次日均值更好，且会漏掉低波动的集中度事故（如 2026-06-22 鸡蛋，前日 VaR/权益约 1.3%）；"
        f"「组合近 5 日亏损才启动」是整张表最差的套件之一（{_one(r_port)}），组合刚亏完的次日均值并不更差，却把过滤器安在了错误的层级；"
        f"「只砍近 5 日盈利品种」净效果为负（{_one(r_win)}），说明 5 日亏损过滤不是把同一批干预换个名字；"
        f"「平时只砍亏、压力日连盈利超限也砍」没有比单纯只砍亏更好（{_one(r_stress)}）；"
        "只限板块 50%、以及市值 20/40 或 15/35，都不能替代 MCR。"
        "30%/50% 无条件规则继续留作黄色预警：样本内接近盈亏中性。"
        f"{('若值班只想管贵金属与生鲜：' + _one(by_short.get('30/50 金银猪蛋')) + '。锂/能化/股指超限时这条不动手，不能替代全书限额或 L5+DD5。') if by_short.get('30/50 金银猪蛋') else ''}",
    )

    heading(doc, "六、如何削掉 2026 年一季度的波动尖峰", 1)
    vol_bts = vol_bts or []
    by_v = {r["spec"]["short"]: r for r in vol_bts}
    attach_window_stats(bt0)
    q1_vol_a = bt0.get("vol_q1_a", 0.0)
    rest_vol_a = bt0.get("vol_rest_a", 0.0)
    spike_vol_a = bt0.get("vol_spike_a", 0.0)
    q1_pnl_a = bt0.get("pnl_q1_a", 0.0)
    peak_a = bt0.get("peak_roll_q1_a", 0.0)
    para(
        doc,
        f"图9 里 30/50、20/60、只砍亏三条滚动波动几乎贴在实盘上，不是计算错了——"
        f"集中度限额切的是「谁占比高」，不是「组合今天有多大」。"
        f"把样本拆开看：2026-01-01 至 2026-04-30 这 {bt0.get('n_q1', 0)} 个交易日，"
        f"官方年化波动 {pct(q1_vol_a)}，20 日滚动波动最高 {pct(peak_a)}（峰值在 2026-03-05 附近）；"
        f"窗口外其余交易日只有 {pct(rest_vol_a)}。全年 21% 的年化波动，几乎全部来自这一段。"
        f"窗口内官方累计盈亏 {signed_wan(q1_pnl_a)} 万元，所以这不是一段纯亏损，而是「高波动、高换手、碳酸锂双向暴打」的赚钱尖峰。"
        f"要戏剧性地压波动，必须直接砍名义敞口或按预测波动缩书，而不是再把 MCR 上限从 30% 调到 25%。",
    )
    para(
        doc,
        "窗口归因（持仓市值×次日涨跌）：碳酸锂的 |盈亏| 远高于第二名黄金；"
        "77 个交易日里有锂持仓，约 50 天是组合最大 MCR 品种，均值约 28%、最高 40%，"
        "净市值均值近千万、峰值超过两千万。"
        "沙盒预测年化波动在窗口内均值约 39%、最高约 74%，而且窗口内几乎每天都高于 18%；"
        "窗口外预测波动均值约 14%。"
        "因此「预测波动 >18% 才缩书」会自动对准这段异常，平时很少动手——这正是图9 其余时间已经低于 20% 时所需要的开关。",
    )
    if "vol_roll" in charts:
        add_picture(doc, charts["vol_roll"])
        caption(doc, "图20  20 日滚动年化波动。橙色底是 2026 年 1–4 月；红色虚线是 20% 目标。MCR 规则几乎贴着灰线，波动目标规则才会离开灰线。")
    if "vol_zoom" in charts:
        add_picture(doc, charts["vol_zoom"])
        caption(doc, "图21  2025-12 至 2026-05 放大。好规则应在 1 月上旬就开始压，而不是等 20 日实现波动已经到 50% 再动手。")
    if "vol_nav" in charts:
        add_picture(doc, charts["vol_nav"])
        caption(doc, "图22  净值对照。压波动几乎必然让出窗口内一部分趋势利润，看的是波动降幅是否配得上让出的收益。")
    if "vol_bars" in charts:
        add_picture(doc, charts["vol_bars"])
        caption(doc, "图23  全年年化波动 / 最大回撤 / 夏普。灰柱为实盘。目标是左柱明显下降、夏普不塌。")

    vrows = []
    for r in vol_bts:
        vrows.append([
            r["spec"]["short"],
            str(r["n_signal"]),
            pct(r["c_st"]["ann_vol"]),
            f"{(r['c_st']['ann_vol']/r['a_st']['ann_vol']-1)*100:+.1f}%" if r["a_st"]["ann_vol"] else "—",
            pct(r.get("vol_q1_c", 0.0)),
            pct(r.get("peak_roll_q1_c", 0.0)),
            pct(r.get("vol_rest_c", 0.0)),
            pct(r["c_st"]["mdd"]),
            f"{r['c_st']['sharpe']:.2f}",
            signed_wan(r["net"]),
            signed_wan(r.get("pnl_q1_c", 0.0) - r.get("pnl_q1_a", 0.0)),
        ])
    add_table(
        doc,
        ["规则", "干预日", "全年波动", "相对实际", "1–4月波动", "1–4月滚动峰值", "窗口外波动", "最大回撤", "夏普", "全年净效果", "1–4月净效果"],
        vrows,
    )
    caption(
        doc,
        "表13  波动目标与锂/新能源市值硬顶。全年波动要明显低于 21%，1–4 月波动要靠近窗口外的 ~13%，"
        "才算真正对着图9 的尖峰在做事。实现波动开关会晚一拍（滚动窗口已经被尖峰污染），预测波动开关更早。",
    )

    # pick vol rules
    v_pred18 = by_v.get("预测波18%全书")
    v_pred20 = by_v.get("预测波20%全书")
    v_hot = by_v.get("预测波18%热门")
    v_real = by_v.get("实现波20%全书")
    v_lc = by_v.get("锂市值12%") or by_v.get("锂市值8%")
    v_combo = by_v.get("锂12%+预测18%热门") or by_v.get("锂10%+预测20%全书")
    scored = [
        r for r in vol_bts
        if r["c_st"]["ann_vol"] <= bt0["a_st"]["ann_vol"] * 0.85
        and r.get("vol_q1_c", 1.0) <= bt0.get("vol_q1_a", 1.0) * 0.80
        and r["c_st"]["sharpe"] >= bt0["a_st"]["sharpe"] - 0.10
    ]
    scored = sorted(scored, key=lambda r: (-r["c_st"]["sharpe"], r["c_st"]["ann_vol"]))
    rec_vol = scored[0] if scored else (by_v.get("预测波18%热门") or v_pred18 or (vol_bts[0] if vol_bts else None))

    def _vtxt(r):
        if r is None:
            return ""
        return (
            f"{r['spec']['short']}：全年波动 {pct(r['a_st']['ann_vol'])}→{pct(r['c_st']['ann_vol'])}"
            f"（{(r['c_st']['ann_vol']/r['a_st']['ann_vol']-1)*100:+.1f}%），"
            f"1–4月 {pct(r.get('vol_q1_a',0))}→{pct(r.get('vol_q1_c',0))}，"
            f"滚动峰值 {pct(r.get('peak_roll_q1_a',0))}→{pct(r.get('peak_roll_q1_c',0))}，"
            f"窗口外 {pct(r.get('vol_rest_c',0))}，"
            f"夏普 {r['a_st']['sharpe']:.2f}→{r['c_st']['sharpe']:.2f}，"
            f"全年净效果 {signed_wan(r['net'])} 万，1–4月净效果 {signed_wan(r.get('pnl_q1_c',0)-r.get('pnl_q1_a',0))} 万，"
            f"干预 {r['n_signal']} 日。"
        )

    para(
        doc,
        "读表的方式：先看「1–4月波动」和「滚动峰值」降了多少，再看窗口外有没有被误伤，最后才看净效果。"
        "有一个必须写明的权衡：1–4 月官方累计是赚钱的（约 +1366 万）。"
        "把全书按预测波动一刀切，尖峰会下来，但窗口内的趋势利润也会被切掉，全年夏普从 2.08 掉到 1.2–1.6。"
        "只缩「制造尖峰的名字」（碳酸锂、工业硅、多晶硅、黄金、白银、沪铜）则波动同样能从 21% 降到 17% 附近，"
        "夏普反而升到 2.6–2.7，因为被切掉的是锂的双向暴打，不是生猪/鸡蛋/塑料那段利润。"
        f"{_vtxt(v_pred18)}{_vtxt(v_pred20)}"
        f"{'只缩热门：' + _vtxt(v_hot) if v_hot else ''}"
        f"{'用已经实现的 20 日波动当开关会晚一拍：滚动窗口先被尖峰污染，峰值压不干净。' + _vtxt(v_real) if v_real else ''}"
        f"{'只给碳酸锂加市值硬顶，全年波动只降到约 20%，滚动峰值仍在 50% 以上——锂不是唯一的尖峰来源，黄金也在打。' + _vtxt(v_lc) if v_lc else ''}"
        f"{'锂硬顶 + 预测波动缩热门：' + _vtxt(v_combo) if v_combo else ''}",
    )
    if rec_vol is not None:
        para(
            doc,
            f"若目标就是「把图9 的尖峰压回 20% 附近，其余时间尽量别动」，优先落地："
            f"{rec_vol['spec']['name']}。"
            f"{_vtxt(rec_vol)}"
            f"执行可以仍走 T+1 缩放（投顾仓压缩），或把同一套 k 放到 RX000 反向对冲、不改投顾指令。"
            f"值班一句话：收盘后看沙盒预测年化波动；超过 18%（或 20%）则把全书（或锂/硅/贵金属/铜）"
            f"按 目标/预测 的比例降到目标。平时预测波动在 14% 左右，这条规则不会全年骚扰。"
            f"不要指望 MCR 30/50 或只砍亏来完成这件事——它们在尖峰期几乎不改变滚动波动。",
        )

    heading(doc, "七、落地与局限", 1)
    para(
        doc,
        "看板：在现有 VaR 沙盒饼图旁标红 30%/50%（或最终选定的限额），并列出超限品种的建议压缩手数；"
        "另加一条预测年化波动与 18%/20% 目标的对比，以及碳酸锂净市值 / 累计净资本。"
        "流程：T 日 15:30 后用当日持仓重算 MCR 与预测波动；超限账户/品种进入次日开盘减仓清单；"
        "若预测波动超过目标，按 目标/预测 缩书或由 RX000 对冲。盘中不强制（本回测也未假设盘中可砍）。"
        "考核：按「避免亏损 / 让渡盈利」双计，避免风控被理解成只准减亏不准减盈；"
        "波动目标规则另记窗口内让出的趋势利润，避免只看全年夏普。",
    )
    para(
        doc,
        "局限：样本约一年（2025-07 至 2026-09），含碳酸锂单边与一段商品/股指波动，外推需谨慎；"
        "「近 5 日亏损」在本样本里判别力最好，但不保证下一阶段仍是 5 日而不是 4 日或 6 日——"
        "写成制度时请锁定「近一周估算盈亏为负」，不要把 5 当成精确参数。"
        "全样本 VaR 分位有前视，实盘只能用扩张窗口或绝对门槛（例如 2.5%–3.0%）。"
        "市值×涨跌忽略盘中调仓与滑点；减仓资金未再配置，若交易员把风险挪到相关品种，保险效果会被对冲掉；"
        "相关窗口 252 日在新品/新合约上不稳定。建议每季度用最新持仓再跑一遍本脚本，而不是把阈值写成永远不变的制度。",
    )
    para(
        doc,
        "复现：scripts/ma/generate_mcr_risk_rules_report.py，只读 public.mom_position_details / mom_daily_reports / "
        "raw_akshare_futures_daily，不改动 MOM 表或 ETL。"
        "规则简称见附录。",
        size=9,
        color=MUTED,
    )

    write_abbrev_appendix(doc, alts, vol_bts)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc.save(REPORT_PATH)
    try:
        doc.save(REPORT_PATH_ASCII)
    except Exception:
        pass
    freeze_page_numbers(REPORT_PATH)
    freeze_page_numbers(REPORT_PATH_ASCII)
    print("wrote", REPORT_PATH)


def spec(name, short, prod_cap=None, sector_cap=None, mode="mcr", loser_only=False, var_q=0.0, extra=False, family="grid", **kw):
    out = {
        "name": name,
        "short": short,
        "prod_cap": prod_cap,
        "sector_cap": sector_cap,
        "mode": mode,
        "loser_only": loser_only,
        "var_q": var_q,
        "extra": extra,
        "family": family,
    }
    out.update(kw)
    return out


def conditional_specs() -> list[dict]:
    """Deep grid for 带条件规则. Kept separate so Table 6 stays readable."""
    out = []
    # lookback sweep on the 25/45 book
    for lb in (3, 4, 5, 6, 8, 10, 20):
        out.append(spec(
            f"MCR 25/45，只砍近{lb}日亏损品种", f"25/45 L{lb}",
            0.25, 0.45, loser_only=True, extra=True, family="cond", loser_lb=lb,
        ))
    # same filter on other caps / sub-sector
    for p, s, short, mode in (
        (0.20, 0.40, "20/40 L5", "mcr"),
        (0.25, 0.40, "25/40 L5", "mcr"),
        (0.30, 0.50, "30/50 L5", "mcr"),
        (0.25, None, "仅品种25 L5", "mcr"),
        (0.25, 0.40, "25+细分40 L5", "sub_mcr"),
    ):
        out.append(spec(
            f"{short}：只砍近5日亏损品种", short,
            p, s, mode=mode, loser_only=True, extra=True, family="cond", loser_lb=5,
        ))
    # stronger loser definition (5d return vs notional)
    for thr, tag in ((-0.01, "L5ret-1"), (-0.02, "L5ret-2"), (-0.03, "L5ret-3")):
        out.append(spec(
            f"MCR 25/45，只砍近5日收益<{int(thr*100)}%的超限品种", f"25/45 {tag}",
            0.25, 0.45, loser_only=True, extra=True, family="cond",
            loser_lb=5, loser_ret_thr=thr,
        ))
    # VaR as a day-level gate (full-sample vs expanding; quantile vs absolute)
    for q, tag in ((0.50, "VQ50"), (0.60, "VQ60"), (0.70, "VQ70"), (0.80, "VQ80")):
        out.append(spec(
            f"MCR 25/45，仅VaR/权益≥全样本Q{int(q*100)}启动", f"25/45 {tag}",
            0.25, 0.45, extra=True, family="cond", var_q=q, var_mode="full",
        ))
        out.append(spec(
            f"MCR 25/45，仅VaR/权益≥扩张窗口Q{int(q*100)}启动", f"25/45 {tag}扩",
            0.25, 0.45, extra=True, family="cond", var_q=q, var_mode="expanding",
        ))
    for abs_v, tag in ((0.020, "V2.0"), (0.025, "V2.5"), (0.030, "V3.0"), (0.040, "V4.0")):
        out.append(spec(
            f"MCR 25/45，仅VaR/权益≥{abs_v*100:.1f}%启动", f"25/45 {tag}",
            0.25, 0.45, extra=True, family="cond", var_abs=abs_v,
        ))
    out.append(spec(
        "MCR 30/50，仅VaR/权益≥全样本Q60启动", "30/50 VQ60",
        0.30, 0.50, extra=True, family="cond", var_q=0.60, var_mode="full",
    ))
    out.append(spec(
        "MCR 30/50，仅VaR/权益≥扩张窗口Q70启动", "30/50 VQ70扩",
        0.30, 0.50, extra=True, family="cond", var_q=0.70, var_mode="expanding",
    ))
    # AND: loser + high VaR
    out.append(spec(
        "MCR 25/45，高VaR日且只砍近5日亏损品种", "25/45 L5+VQ60",
        0.25, 0.45, loser_only=True, extra=True, family="cond",
        loser_lb=5, var_q=0.60, var_mode="full",
    ))
    out.append(spec(
        "MCR 25/45，VaR/权益≥2.5%且只砍近5日亏损品种", "25/45 L5+V2.5",
        0.25, 0.45, loser_only=True, extra=True, family="cond",
        loser_lb=5, var_abs=0.025,
    ))
    out.append(spec(
        "MCR 25/45，扩张窗口高VaR且只砍近5日亏损品种", "25/45 L5+VQ70扩",
        0.25, 0.45, loser_only=True, extra=True, family="cond",
        loser_lb=5, var_q=0.70, var_mode="expanding",
    ))
    # portfolio-level gates
    out.append(spec(
        "MCR 25/45，仅组合近5日估算盈亏为负时启动", "25/45 组合亏5日",
        0.25, 0.45, extra=True, family="cond", port_loser=True, port_lb=5,
    ))
    out.append(spec(
        "MCR 25/45，组合近5日为负且只砍品种亏损", "25/45 L5+组合亏",
        0.25, 0.45, loser_only=True, extra=True, family="cond",
        loser_lb=5, port_loser=True, port_lb=5,
    ))
    out.append(spec(
        "MCR 25/45，仅净值回撤≥5%时启动", "25/45 DD≥5%",
        0.25, 0.45, extra=True, family="cond", dd_min=0.05,
    ))
    out.append(spec(
        "MCR 25/45，回撤≥5%且只砍近5日亏损品种", "25/45 L5+DD5",
        0.25, 0.45, loser_only=True, extra=True, family="cond",
        loser_lb=5, dd_min=0.05,
    ))
    # two-tier: hard ceiling always, soft cap only on losers
    out.append(spec(
        "软25/硬40 + 板块软45/硬60，中间带只砍亏", "软25硬40 L5",
        0.25, 0.45, extra=True, family="cond", loser_only=True, loser_lb=5,
        soft_prod_cap=0.25, soft_sector_cap=0.45, hard_prod_cap=0.40, hard_sector_cap=0.60,
    ))
    out.append(spec(
        "软25/硬35 + 板块软45/硬55，中间带只砍亏", "软25硬35 L5",
        0.25, 0.45, extra=True, family="cond", loser_only=True, loser_lb=5,
        soft_prod_cap=0.25, soft_sector_cap=0.45, hard_prod_cap=0.35, hard_sector_cap=0.55,
    ))
    out.append(spec(
        "软20/硬30 + 板块软40/硬50，中间带只砍亏", "软20硬30 L5",
        0.20, 0.40, extra=True, family="cond", loser_only=True, loser_lb=5,
        soft_prod_cap=0.20, soft_sector_cap=0.40, hard_prod_cap=0.30, hard_sector_cap=0.50,
    ))
    # stress: quiet days loser-only, stressed days cut all breaches
    out.append(spec(
        "平时25/45只砍亏，VaR/权益≥3%时全砍超限", "L5+压3%全砍",
        0.25, 0.45, extra=True, family="cond", loser_only=True, loser_lb=5,
        stress_full=True, stress_var_abs=0.03,
    ))
    out.append(spec(
        "平时25/45只砍亏，VaR/权益≥2.5%时全砍超限", "L5+压2.5%全砍",
        0.25, 0.45, extra=True, family="cond", loser_only=True, loser_lb=5,
        stress_full=True, stress_var_abs=0.025,
    ))
    # negative control
    out.append(spec(
        "MCR 25/45，只砍近5日盈利品种（对照）", "25/45 只砍盈",
        0.25, 0.45, extra=True, family="cond", winner_only=True, loser_lb=5,
    ))
    return out


def run_all(days, official, pct_map, mkt_dates):
    base = spec("单品种MCR<30% 且 单板块MCR<50%", "MCR 30/50", 0.30, 0.50, family="grid")
    grid = []
    for p in (0.20, 0.25, 0.30, 0.35, 0.40):
        for s in (0.40, 0.45, 0.50, 0.55, 0.60):
            extra = not (abs(p - 0.30) < 1e-9 and abs(s - 0.50) < 1e-9)
            grid.append(spec(
                f"品种MCR<{int(p*100)}% 板块MCR<{int(s*100)}%",
                f"MCR {int(p*100)}/{int(s*100)}", p, s, extra=extra, family="grid",
            ))
    extras = [
        spec("仅单品种MCR<30%", "仅品种30", 0.30, None, extra=True, family="grid"),
        spec("仅单板块MCR<50%", "仅板块50", None, 0.50, extra=True, family="grid"),
        spec("品种MCR<25% 且 细分板块<40%", "品种25+细分40", 0.25, 0.40, mode="sub_mcr", extra=True, family="grid"),
        spec("品种市值<20% 且 板块市值<40%", "市值 20/40", 0.20, 0.40, mode="mv", extra=True, family="mv"),
        spec("品种市值<15% 且 板块市值<35%", "市值 15/35", 0.15, 0.35, mode="mv", extra=True, family="mv"),
        spec("MCR 25/45，只砍近5日亏损品种", "25/45 只砍亏", 0.25, 0.45, loser_only=True, extra=True, family="cond", loser_lb=5),
        spec("MCR 30/50，仅高VaR日启动", "30/50 高VaR", 0.30, 0.50, var_q=0.60, extra=True, family="cond", var_mode="full"),
        spec("MCR 25/45，仅高VaR日启动", "25/45 高VaR", 0.25, 0.45, var_q=0.60, extra=True, family="cond", var_mode="full"),
        spec("品种MCR<25% 且 板块MCR<45%", "MCR 25/45", 0.25, 0.45, extra=True, family="grid"),
        spec(
            "MCR 30/50，品种仅限金/银/生猪/鸡蛋，板块仅限贵金属/生鲜",
            "30/50 金银猪蛋",
            0.30, 0.50, extra=True, family="scoped",
            prod_allow=list(SCOPED_30_50_PRODS),
            sector_allow=list(SCOPED_30_50_SECTORS),
        ),
    ]
    specs = [base] + [s for s in grid if s["extra"]] + extras + conditional_specs()
    # de-dup by short
    seen = set()
    uniq = []
    for s in specs:
        if s["short"] in seen:
            continue
        seen.add(s["short"])
        uniq.append(s)

    results = []
    for i, s in enumerate(uniq):
        print(f"backtest {i+1}/{len(uniq)} {s['short']}")
        results.append(apply_rule(days, official, pct_map, mkt_dates, s))
    bt0 = next(r for r in results if r["spec"]["short"] == "MCR 30/50")
    return bt0, results


def main():
    configure_matplotlib()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CHART_DIR.mkdir(parents=True, exist_ok=True)

    if CACHE_PATH.exists() and os.environ.get("MCR_REBUILD") != "1":
        print("loading cache", CACHE_PATH)
        with CACHE_PATH.open("rb") as f:
            blob = pickle.load(f)
        days = blob["days"]
        pnl_map, eq_map, pct_map, mkt_dates = blob["pnl_map"], blob["eq_map"], blob["pct_map"], blob["mkt_dates"]
    else:
        pos_rows, pnl_rows, px_rows = load_raw()
        prod_mv, trading_dates, pnl_map, eq_map, pct_map, mkt_dates = build_panels(pos_rows, pnl_rows, px_rows)
        days = compute_history(prod_mv, trading_dates, pct_map, mkt_dates)
        with CACHE_PATH.open("wb") as f:
            pickle.dump(
                {"days": days, "pnl_map": pnl_map, "eq_map": eq_map, "pct_map": pct_map, "mkt_dates": mkt_dates},
                f,
            )
        print("cached", CACHE_PATH)

    if len(days) < 30:
        raise SystemExit(f"too few MCR days: {len(days)}")

    conn = psycopg2.connect(DB_URL)
    try:
        official = load_official_mom_nav(conn)
    finally:
        conn.close()

    th = summarize_thresholds(days)
    cond_rows = cond_next_ret(days, official)
    trail_diag = breach_trail_diagnostics(days, pct_map, mkt_dates, lookbacks=(3, 4, 5, 6, 8, 10, 20))
    var_diag = var_regime_diagnostics(days, official)
    bt0, alts = run_all(days, official, pct_map, mkt_dates)
    vol_bts = run_vol_rules(days, official, pct_map, mkt_dates)
    attach_window_stats(bt0)

    print("charts")
    rec_bt = next((r for r in alts if r["spec"]["short"] == "25/45 只砍亏"), None)
    dd_bt = next((r for r in alts if r["spec"]["short"] == "25/45 L5+DD5"), None)
    scoped_bt = next((r for r in alts if r["spec"]["short"] == "30/50 金银猪蛋"), None)
    tight_bt = next((r for r in alts if r["spec"]["short"] == "MCR 20/60"), None)
    mid_bt = next((r for r in alts if r["spec"]["short"] == "MCR 25/45"), None)
    roll = [("实际", bt0["dates"], bt0["actual_ret"], 1.4), ("MCR 30/50", bt0["dates"], bt0["cf_ret"], 1.3)]
    if tight_bt is not None:
        roll.append(("MCR 20/60", tight_bt["dates"], tight_bt["cf_ret"], 1.2))
    if rec_bt is not None:
        roll.append((rec_bt["spec"]["short"], rec_bt["dates"], rec_bt["cf_ret"], 1.2))
    if dd_bt is not None:
        roll.append((dd_bt["spec"]["short"], dd_bt["dates"], dd_bt["cf_ret"], 1.6))
    bar_rows = [
        {"label": "实际", "ann_vol": bt0["a_st"]["ann_vol"], "mdd": bt0["a_st"]["mdd"], "sharpe": bt0["a_st"]["sharpe"]},
        {"label": "30/50", "ann_vol": bt0["c_st"]["ann_vol"], "mdd": bt0["c_st"]["mdd"], "sharpe": bt0["c_st"]["sharpe"]},
    ]
    if mid_bt is not None:
        bar_rows.append({"label": "25/45", "ann_vol": mid_bt["c_st"]["ann_vol"], "mdd": mid_bt["c_st"]["mdd"], "sharpe": mid_bt["c_st"]["sharpe"]})
    if tight_bt is not None:
        bar_rows.append({"label": "20/60", "ann_vol": tight_bt["c_st"]["ann_vol"], "mdd": tight_bt["c_st"]["mdd"], "sharpe": tight_bt["c_st"]["sharpe"]})
    if rec_bt is not None:
        bar_rows.append({"label": "25/45只砍亏", "ann_vol": rec_bt["c_st"]["ann_vol"], "mdd": rec_bt["c_st"]["mdd"], "sharpe": rec_bt["c_st"]["sharpe"]})
    if dd_bt is not None:
        bar_rows.append({"label": "L5+DD5", "ann_vol": dd_bt["c_st"]["ann_vol"], "mdd": dd_bt["c_st"]["mdd"], "sharpe": dd_bt["c_st"]["sharpe"]})
    if scoped_bt is not None:
        bar_rows.append({"label": "金银猪蛋", "ann_vol": scoped_bt["c_st"]["ann_vol"], "mdd": scoped_bt["c_st"]["mdd"], "sharpe": scoped_bt["c_st"]["sharpe"]})
    charts = {
        "ts": chart_max_mcr_ts(th),
        "hist": chart_hist(th),
        "prod_rank": chart_breach_rank(th),
        "sec_rank": chart_sector_breach(th),
        "cond": chart_cond(cond_rows),
        "nav0": chart_nav(bt0, "MOM产品净值：实际 vs 单品种30% + 单板块50%", "05_nav_30_50.png"),
        "decomp0": chart_saved_vs_given(bt0, "06_saved_given_30_50.png"),
        "dd0": chart_dd(bt0, "07_dd_30_50.png"),
        "roll_vol": chart_rolling_vol(roll, "12_rolling_vol.png"),
        "risk_bars": chart_risk_bars(bar_rows, "13_risk_bars.png"),
        "ret_hist": chart_ret_hist(bt0, "14_ret_hist_30_50.png"),
        "heat": chart_grid_heatmap(alts),
        "scatter": chart_scatter_rules(alts),
        "trail": chart_trail_split(trail_diag),
        "lookback": chart_lookback_sweep(alts),
        "var_sweep": chart_var_sweep(alts),
        "cond_scatter": chart_cond_scatter(alts),
        "var_reg": chart_var_regime(var_diag),
    }
    if rec_bt is not None or dd_bt is not None:
        overlay = [("实际组合", bt0["dates"], bt0["nav_a"], 1.3), ("MCR 30/50", bt0["dates"], bt0["nav_c"], 1.3)]
        if tight_bt is not None:
            overlay.append(("MCR 20/60", tight_bt["dates"], tight_bt["nav_c"], 1.2))
        if rec_bt is not None:
            overlay.append((rec_bt["spec"]["short"], rec_bt["dates"], rec_bt["nav_c"], 1.3))
        if dd_bt is not None:
            overlay.append((dd_bt["spec"]["short"], dd_bt["dates"], dd_bt["nav_c"], 1.8))
        charts["nav_rec"] = chart_nav_overlay(overlay, "MOM产品净值对照：实际 / 30·50 / 只砍亏 / L5+DD5", "11_nav_overlay.png")
    if scoped_bt is not None:
        charts["nav_scoped"] = chart_nav_overlay(
            [
                ("实际组合", bt0["dates"], bt0["nav_a"], 1.4),
                ("MCR 30/50 全书", bt0["dates"], bt0["nav_c"], 1.2),
                (scoped_bt["spec"]["short"], scoped_bt["dates"], scoped_bt["nav_c"], 1.8),
            ],
            "MOM产品净值：全书30/50 vs 只盯金/银/生猪/鸡蛋与贵金属/生鲜",
            "24_nav_scoped_30_50.png",
        )
    v_by = {r["spec"]["short"]: r for r in vol_bts}
    v_pred = v_by.get("预测波18%全书")
    v_hot = v_by.get("预测波18%热门")
    v_lc = v_by.get("锂市值12%")
    v_combo = v_by.get("锂12%+预测18%热门")
    v_real = v_by.get("实现波20%全书")
    vroll = [("实际", bt0["dates"], bt0["actual_ret"], 1.5), ("MCR 30/50", bt0["dates"], bt0["cf_ret"], 1.1)]
    if rec_bt is not None:
        vroll.append(("25/45只砍亏", rec_bt["dates"], rec_bt["cf_ret"], 1.1))
    if dd_bt is not None:
        vroll.append(("L5+DD5", dd_bt["dates"], dd_bt["cf_ret"], 1.3))
    if v_pred is not None:
        vroll.append(("预测波18%全书", v_pred["dates"], v_pred["cf_ret"], 1.6))
    if v_hot is not None:
        vroll.append(("预测波18%热门", v_hot["dates"], v_hot["cf_ret"], 1.4))
    if v_combo is not None:
        vroll.append(("锂12%+预测18%热门", v_combo["dates"], v_combo["cf_ret"], 1.4))
    charts["vol_roll"] = chart_vol_rules_roll(vroll, "20_vol_target_roll.png")
    charts["vol_zoom"] = chart_vol_zoom(vroll, "21_vol_spike_zoom.png")
    vnav = [("实际组合", bt0["dates"], bt0["nav_a"], 1.3)]
    if v_pred is not None:
        vnav.append(("预测波18%全书", v_pred["dates"], v_pred["nav_c"], 1.5))
    if v_hot is not None:
        vnav.append(("预测波18%热门", v_hot["dates"], v_hot["nav_c"], 1.3))
    if v_lc is not None:
        vnav.append(("锂市值12%", v_lc["dates"], v_lc["nav_c"], 1.2))
    if v_combo is not None:
        vnav.append(("锂12%+预测18%热门", v_combo["dates"], v_combo["nav_c"], 1.4))
    charts["vol_nav"] = chart_nav_overlay(vnav, "波动目标规则的净值对照", "22_vol_target_nav.png")
    vbar = [
        {"label": "实际", "ann_vol": bt0["a_st"]["ann_vol"], "mdd": bt0["a_st"]["mdd"], "sharpe": bt0["a_st"]["sharpe"]},
    ]
    for key in ("预测波18%全书", "预测波18%热门", "实现波20%全书", "锂市值12%", "锂12%+预测18%热门"):
        r = v_by.get(key)
        if r is not None:
            vbar.append({"label": r["spec"]["short"], "ann_vol": r["c_st"]["ann_vol"], "mdd": r["c_st"]["mdd"], "sharpe": r["c_st"]["sharpe"]})
    charts["vol_bars"] = chart_risk_bars(vbar, "23_vol_target_bars.png")
    write_report(
        th, days, bt0, alts, cond_rows, charts, official["dates"][0], official["dates"][-1],
        trail_diag=trail_diag, var_diag=var_diag, vol_bts=vol_bts,
    )
    summary = {
        "n_days": th["n"],
        "first": days[0]["date"],
        "last": days[-1]["date"],
        "prod_ge_30": th["prod_ge"][0.30],
        "sec_ge_50": th["sec_ge"][0.50],
        "rule_30_50_net": bt0["net"],
        "saved": bt0["saved_sum"],
        "given": bt0["given_sum"],
        "mdd_actual": bt0["a_st"]["mdd"],
        "mdd_rule": bt0["c_st"]["mdd"],
        "vol_actual": bt0["a_st"]["ann_vol"],
        "vol_rule": bt0["c_st"]["ann_vol"],
        "sharpe_actual": bt0["a_st"]["sharpe"],
        "sharpe_rule": bt0["c_st"]["sharpe"],
        "vol_int_a": bt0["vol_int_a"],
        "vol_int_c": bt0["vol_int_c"],
        "total_ret_actual": bt0["a_st"].get("total_ret"),
        "total_ret_rule": bt0["c_st"].get("total_ret"),
        "report": str(REPORT_PATH),
        "q1_vol_actual": bt0.get("vol_q1_a"),
        "rest_vol_actual": bt0.get("vol_rest_a"),
        "vol_rules": [
            {
                "short": r["spec"]["short"],
                "ann_vol": r["c_st"]["ann_vol"],
                "q1_vol": r.get("vol_q1_c"),
                "peak_q1": r.get("peak_roll_q1_c"),
                "rest_vol": r.get("vol_rest_c"),
                "sharpe": r["c_st"]["sharpe"],
                "net": r["net"],
                "n_signal": r["n_signal"],
            }
            for r in vol_bts
        ],
        "cond_top": [
            {
                "short": r["spec"]["short"],
                "net": r["net"],
                "mdd": r["c_st"]["mdd"],
                "sharpe": r["c_st"]["sharpe"],
                "n_signal": r["n_signal"],
            }
            for r in sorted(
                [x for x in alts if x["spec"].get("family") == "cond"],
                key=lambda x: -x["net"],
            )[:8]
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
