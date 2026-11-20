# -*- coding: utf-8 -*-
"""内部讨论材料：轧差市值小，不等于单边敞口小。

持仓：%TEMP%/mom-pos-1118.json（2026-11-18 MOM 结算单明细）
行情：%TEMP%/chem-px.json、idx-px.json（主力连续收盘价）
输出：docs/reports/轧差市值与风险贡献占比.docx
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor, Emu

ASOF = "2026-11-18"
SCALE = 76_739_267
ROOT = Path(r"d:\coding\market_website")
OUT = ROOT / "docs" / "reports" / "轧差市值与风险贡献占比.docx"
ASSET = Path(os.environ["TEMP"]) / "risk-note-assets"

# 风险报告「板块持仓分析」2026-11-18 已核对的列值。
TABLE = [
    ("能源化工", 8.6, 56.5, 27.2, 35.4),
    ("农产", 42.1, 23.4, 11.9, 9.4),
    ("黑色", 18.0, 5.0, 12.4, 12.9),
    ("股指", 6.8, 5.6, 26.3, 32.5),
]

SECTOR = {}
for name, prods in {
    "能源化工": [
        "SC", "FU", "LU", "PG", "BU", "TA", "EG", "PF", "PR", "PL", "PP", "L",
        "BZ", "PX", "EB", "RU", "BR", "NR", "SA", "SH", "V", "UR", "MA",
    ],
    "股指": ["IH", "IF", "IC", "IM"],
}.items():
    for p in prods:
        SECTOR[p] = name

CN = {
    "MA": "甲醇", "L": "塑料", "PP": "聚丙烯", "TA": "PTA", "PX": "对二甲苯",
    "EB": "苯乙烯", "V": "PVC", "FU": "燃料油", "EG": "乙二醇", "RU": "橡胶",
    "SA": "纯碱", "SH": "烧碱", "BR": "顺丁", "UR": "尿素", "PF": "短纤",
    "BZ": "纯苯", "BU": "沥青", "LU": "低硫燃油", "SC": "原油", "NR": "20号胶",
    "PR": "瓶片", "PG": "液化气", "PL": "丙烯",
    "IM": "中证1000", "IC": "中证500", "IF": "沪深300", "IH": "上证50",
}

NAVY = "1B3A4B"
RED = "9B2C2C"
BLUE = "1D4E89"
INK = "1F2937"
MUTED = "5C6B7A"


def prefix(contract: str) -> str:
    # 与 getPrefix 相同：取合约开头的全部字母，再用板块表做整词匹配。
    # 不能退回首字母，否则 LH、LC、LR 会被当成塑料 L。
    i = 0
    while i < len(contract) and contract[i].isalpha():
        i += 1
    return contract[:i].upper()


def wan(x: float, nd=0) -> str:
    v = x / 10000.0
    if nd == 0:
        return f"{v:,.0f}"
    return f"{v:,.{nd}f}"


def setup_font() -> None:
    for fp in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(fp):
            font_manager.fontManager.addfont(fp)
    plt.rcParams.update({
        "font.sans-serif": ["Microsoft YaHei", "SimHei"],
        "font.family": "sans-serif",
        "axes.unicode_minus": False,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "axes.edgecolor": "#E5E7EB",
        "axes.labelcolor": "#1F2937",
        "xtick.color": "#1F2937",
        "ytick.color": "#1F2937",
        "text.color": "#1F2937",
        "axes.titlecolor": "#1B3A4B",
        "axes.titlesize": 13,
        "axes.titleweight": "regular",
        "font.size": 10,
    })


def load_positions() -> dict[str, dict]:
    path = Path(os.environ["TEMP"]) / "mom-pos-1118.json"
    rows = json.loads(path.read_text(encoding="utf-8"))["rows"]
    books = {
        "能源化工": {"long": 0.0, "short": 0.0, "mv": {}},
        "股指": {"long": 0.0, "short": 0.0, "mv": {}},
    }
    for row in rows:
        prod = prefix(row["contract"])
        sector = SECTOR.get(prod)
        if sector is None:
            continue
        mv = float(row["positionMv"] or 0)
        long_lots = float(row["longLots"] or 0)
        short_lots = float(row["shortLots"] or 0)
        if long_lots > 0 and short_lots == 0:
            books[sector]["long"] += mv
            books[sector]["mv"][prod] = books[sector]["mv"].get(prod, 0.0) + mv
        elif short_lots > 0 and long_lots == 0:
            books[sector]["short"] += mv
            books[sector]["mv"][prod] = books[sector]["mv"].get(prod, 0.0) - mv
    return books


def load_returns() -> dict[str, dict[str, float]]:
    series: dict[str, dict[str, float]] = {}
    temp = Path(os.environ["TEMP"])
    for name in ("chem-px.json", "idx-px.json"):
        blob = json.loads((temp / name).read_text(encoding="utf-8"))
        for prod, bars in blob.items():
            bars = sorted(bars, key=lambda x: x["date"])
            out = {}
            prev = None
            for bar in bars:
                if bar["date"] >= ASOF:
                    break
                close = bar["close"]
                if prev not in (None, 0) and close:
                    r = close / prev - 1.0
                    if abs(r) < 0.15:
                        out[bar["date"]] = r
                prev = close
            series[prod] = out
    return series


def pearson(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 40:
        return float("nan")
    if np.std(a) == 0 or np.std(b) == 0:
        return float("nan")
    return float(np.corrcoef(a, b)[0, 1])


def analyze(books, returns) -> dict:
    out = {}
    for sector, book in books.items():
        mv = {k: v for k, v in book["mv"].items() if abs(v) > 1}
        prods = sorted(mv, key=lambda p: -abs(mv[p]))
        # 252 日窗口取各品种日期的并集中、截至持仓日前的最后 252 个交易日。
        dates = sorted({d for p in prods for d in returns.get(p, {})})
        window = dates[-252:]
        window_set = set(window)
        sig = {}
        for p in prods:
            own = [returns[p][d] for d in sorted(returns.get(p, {})) if d < ASOF]
            tail = own[-20:]
            sig[p] = float(np.std(tail, ddof=1)) if len(tail) >= 15 else float("nan")
        n = len(prods)
        corr = np.eye(n)
        for i in range(n):
            for j in range(i + 1, n):
                ri, rj = returns.get(prods[i], {}), returns.get(prods[j], {})
                common = [d for d in window if d in ri and d in rj]
                c = pearson(
                    np.array([ri[d] for d in common]),
                    np.array([rj[d] for d in common]),
                )
                corr[i, j] = corr[j, i] = 0.0 if np.isnan(c) else c
        w_sum = w_dot = 0.0
        h_sum = h_dot = h_n = 0.0
        s_sum = s_dot = s_n = 0.0
        u_sum = u_dot = u_n = 0
        pairs = []
        for i in range(n):
            for j in range(i + 1, n):
                w = abs(mv[prods[i]]) * abs(mv[prods[j]])
                c = corr[i, j]
                w_sum += w
                w_dot += w * c
                u_sum += 1
                u_dot += c
                u_n += 1
                opposite = mv[prods[i]] * mv[prods[j]] < 0
                if opposite:
                    h_sum += w
                    h_dot += w * c
                    h_n += 1
                else:
                    s_sum += w
                    s_dot += w * c
                    s_n += 1
                pairs.append({
                    "a": prods[i], "b": prods[j], "corr": c, "w": w,
                    "opposite": opposite,
                    "av": mv[prods[i]], "bv": mv[prods[j]],
                })
        dv = np.array([sig[p] * mv[p] for p in prods])
        var = float(dv @ corr @ dv)
        std = var ** 0.5
        perfect = abs(float(dv.sum()))
        gross_abs = sum(abs(v) for v in mv.values())
        avg_sig = sum(abs(mv[p]) * sig[p] for p in prods) / gross_abs
        ann = std * np.sqrt(252)
        out[sector] = {
            "long": book["long"],
            "short": book["short"],
            "net": book["long"] - book["short"],
            "contract": book["long"] + book["short"],
            "gross_abs": gross_abs,
            "n": n,
            "mv": mv,
            "prods": prods,
            "sig": sig,
            "corr_u": u_dot / u_n,
            "corr_w": w_dot / w_sum,
            "corr_h": h_dot / h_sum if h_sum else float("nan"),
            "corr_s": s_dot / s_sum if s_sum else float("nan"),
            "n_h": int(h_n),
            "n_s": int(s_n),
            "pairs": pairs,
            "std_ann": ann,
            "perfect_ann": perfect * np.sqrt(252),
            "multiple": std / perfect if perfect else float("nan"),
            "uncorr_ratio": var / float(np.sum(dv ** 2)),
            "avg_sig": avg_sig * np.sqrt(252),
            "equiv": ann / (avg_sig * np.sqrt(252)),
            "window": len(window),
        }
    return out


def style_ax(ax) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color="#EEF2F6", zorder=0)
    ax.set_axisbelow(True)


def chart_rank(path: Path) -> None:
    rows = sorted(TABLE, key=lambda r: -r[2])
    labels = [r[0] for r in rows]
    net = [r[1] for r in rows]
    risk = [r[2] for r in rows]
    x = np.arange(len(labels))
    w = 0.36
    fig, ax = plt.subplots(figsize=(7.4, 4.15))
    b1 = ax.bar(x - w / 2, net, w, color="#8AA0B4", label="轧差占比", zorder=2)
    b2 = ax.bar(x + w / 2, risk, w, color="#9B2C2C", label="风险贡献占比", zorder=2)
    for bars in (b1, b2):
        for bar in bars:
            h = bar.get_height()
            ax.text(bar.get_x() + bar.get_width() / 2, h + 0.8, f"{h:.1f}%",
                    ha="center", va="bottom", fontsize=8.5, color="#1F2937")
    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.set_ylabel("占组合的百分比")
    ax.set_ylim(0, 72)
    ax.set_title("轧差占比和风险贡献占比，排序是反的")
    ax.legend(frameon=False, ncol=2, loc="upper right")
    style_ax(ax)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close()


def chart_curve(path: Path, rho: float) -> None:
    xs = np.linspace(0, 1, 400)
    ys = np.sqrt(2 * (1 - xs))
    fig, ax = plt.subplots(figsize=(7.4, 4.15))
    ax.plot(xs, ys, color="#1B3A4B", lw=2.2, zorder=2)
    ax.axhline(0, color="#E5E7EB", lw=1)
    y = float(np.sqrt(2 * (1 - rho)))
    ax.scatter([rho], [y], color="#9B2C2C", s=42, zorder=3)
    ax.annotate(
        f"能化对冲对相关 {rho:.2f}\n等额反向后仍留下单边波动的 {y * 100:.0f}%",
        xy=(rho, y), xytext=(0.18, y + 0.18),
        fontsize=9, color="#9B2C2C",
        arrowprops=dict(arrowstyle="->", color="#9B2C2C", lw=0.8),
    )
    ax.annotate(
        "只有相关系数等于 1\n净敞口才等于真实敞口",
        xy=(1, 0), xytext=(0.62, 0.38),
        fontsize=9, color="#1D4E89",
        arrowprops=dict(arrowstyle="->", color="#1D4E89", lw=0.8),
    )
    ax.set_xlim(0, 1.02)
    ax.set_ylim(-0.05, 1.65)
    ax.set_xlabel("两腿收益率的相关系数")
    ax.set_ylabel("剩下的盈亏波动 ÷ 单边盈亏波动")
    ax.set_title("等额反向时，净敞口始终是 0")
    style_ax(ax)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close()


def chart_layers(path: Path, stats: dict) -> None:
    metrics = ["合约多空合计", "同品种轧差之后", "按相关性折算的\n等效单边", "板块净额"]
    fig, ax = plt.subplots(figsize=(7.4, 4.3))
    x = np.arange(len(metrics))
    w = 0.36
    for i, (sector, color) in enumerate((("能源化工", "#9B2C2C"), ("股指", "#1D4E89"))):
        s = stats[sector]
        base = abs(s["net"])
        vals = [s["contract"] / base, s["gross_abs"] / base, s["equiv"] / base, 1.0]
        bars = ax.bar(x + (i - 0.5) * w, vals, w, color=color, label=sector, zorder=2)
        for bar, v in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.4,
                    f"{v:.1f}倍", ha="center", va="bottom", fontsize=8, color=color)
    ax.axhline(1, color="#8AA0B4", lw=0.8, ls="--", zorder=1)
    ax.set_xticks(x)
    ax.set_xticklabels(metrics)
    ax.set_ylabel("相对板块净额的倍数")
    ax.set_ylim(0, 40)
    ax.set_title("相对净额，能化还剩一大截，股指已经接近净额")
    ax.legend(frameon=False, ncol=2)
    style_ax(ax)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close()


def chart_pairs(path: Path, chem: dict) -> None:
    opp = sorted([p for p in chem["pairs"] if p["opposite"]], key=lambda p: -p["w"])[:6]
    same = sorted([p for p in chem["pairs"] if not p["opposite"]], key=lambda p: -p["w"])[:1]
    rows = list(reversed(opp + same))

    def lab(p):
        def one(code, mv):
            d = "多" if mv > 0 else "空"
            return f"{CN.get(code, code)}{d}"
        return f"{one(p['a'], p['av'])}  /  {one(p['b'], p['bv'])}"

    labels = [lab(p) for p in rows]
    vals = [p["corr"] for p in rows]
    colors = ["#C47B2B" if not p["opposite"] else "#1D4E89" for p in rows]
    fig, ax = plt.subplots(figsize=(7.4, 4.35))
    y = np.arange(len(rows))
    ax.barh(y, vals, color=colors, height=0.62, zorder=2)
    ax.axvline(1.0, color="#9B2C2C", lw=1.0, ls="--", label="完全对冲要求的相关 = 1")
    for yi, v in zip(y, vals):
        if v >= 0.90:
            ax.text(v - 0.02, yi, f"{v:.2f}", va="center", ha="right", fontsize=8.5, color="white")
        else:
            ax.text(min(v + 0.02, 1.08), yi, f"{v:.2f}", va="center", fontsize=8.5, color="#1F2937")
    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    ax.set_xlim(0, 1.12)
    ax.set_xlabel("过去 252 个交易日的收益率相关")
    ax.set_title("能化里最大的几对：相关高，但没有高到 1")
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.42, -0.18))
    style_ax(ax)
    ax.grid(axis="x", color="#EEF2F6")
    ax.grid(axis="y", visible=False)
    fig.tight_layout()
    fig.subplots_adjust(bottom=0.22)
    fig.savefig(path, dpi=160)
    plt.close()


def set_run(run, size=12, bold=False, color=INK, font="微软雅黑", italic=False):
    run.font.name = font
    run.bold = bold
    run.italic = italic
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rFonts.set(qn(attr), font)


def shade_cell(cell, fill: str) -> None:
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)


def set_cell_border(cell, color="D9E2EC") -> None:
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:color"), color)
        tcBorders.append(el)
    tcPr.append(tcBorders)


def cell_text(cell, text, size=10.5, bold=False, color=INK, align="left", fill=None):
    cell.text = ""
    p = cell.paragraphs[0]
    p.alignment = {
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
    }[align]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run(text)
    set_run(run, size=size, bold=bold, color=color)
    if fill:
        shade_cell(cell, fill)
    set_cell_border(cell)
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for edge, val in (("top", "60"), ("bottom", "60"), ("left", "80"), ("right", "80")):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:w"), val)
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tcPr.append(mar)


def add_p(doc, text, size=12, bold=False, color=INK, before=0, after=8, center=False, first_line=0):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER if center else WD_ALIGN_PARAGRAPH.LEFT
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = 1.15
    if first_line:
        pf.first_line_indent = Cm(first_line)
    run = p.add_run(text)
    set_run(run, size=size, bold=bold, color=color)
    return p


def add_h(doc, text):
    p = add_p(doc, text, size=16, bold=True, color=NAVY, before=16, after=8)
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "8")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "D9E2EC")
    pBdr.append(bottom)
    pPr.append(pBdr)
    return p


def add_rich(doc, parts, size=12, before=0, after=8):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = 1.15
    for text, bold in parts:
        run = p.add_run(text)
        set_run(run, size=size, bold=bold)
    return p


def add_formula(doc, lines: list[str]):
    table = doc.add_table(rows=1, cols=1)
    table.autofit = True
    cell = table.cell(0, 0)
    shade_cell(cell, "F4F7FB")
    set_cell_border(cell, "D5E3F0")
    cell.text = ""
    for i, line in enumerate(lines):
        p = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.line_spacing = 1.08
        run = p.add_run(line)
        set_run(run, size=11, color=NAVY)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)


def add_figure(doc, path: Path, caption: str):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run()
    run.add_picture(str(path), width=Cm(15.6))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_before = Pt(0)
    cap.paragraph_format.space_after = Pt(10)
    r = cap.add_run(caption)
    set_run(r, size=9, color=MUTED)


def add_table(doc, headers, rows, col_align=None, emphasize_col=None):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.alignment = WD_ALIGN_PARAGRAPH.CENTER
    table.autofit = True
    for j, h in enumerate(headers):
        cell_text(table.rows[0].cells[j], h, size=10, bold=True, color="FFFFFF",
                  align="center", fill=NAVY)
    for i, row in enumerate(rows):
        fill = "F7F9FB" if i % 2 == 0 else "FFFFFF"
        for j, val in enumerate(row):
            align = "left" if j == 0 else "center"
            if col_align:
                align = col_align[j]
            color = RED if emphasize_col is not None and j == emphasize_col else INK
            bold = j == 0 or (emphasize_col is not None and j == emphasize_col)
            cell_text(table.rows[i + 1].cells[j], val, size=10, bold=bold,
                      color=color, align=align, fill=fill)
    sp = doc.add_paragraph()
    sp.paragraph_format.space_after = Pt(6)


def header_footer(doc):
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)
    section.top_margin = Cm(1.8)
    section.bottom_margin = Cm(1.7)
    section.header_distance = Cm(0.6)
    section.footer_distance = Cm(0.5)
    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = header.add_run("组合风控讨论材料  ·  数据日期 2026年11月18日")
    set_run(r, size=8.5, color=MUTED)
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r1 = footer.add_run("— ")
    set_run(r1, size=9, color=MUTED)
    run = footer.add_run()
    set_run(run, size=9, color=MUTED)
    fld1 = OxmlElement("w:fldChar")
    fld1.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld2 = OxmlElement("w:fldChar")
    fld2.set(qn("w:fldCharType"), "end")
    run._r.append(fld1)
    run._r.append(instr)
    run._r.append(fld2)
    r2 = footer.add_run(" —")
    set_run(r2, size=9, color=MUTED)


def build(stats: dict, charts: dict):
    c, g = stats["能源化工"], stats["股指"]
    rho = round(float(c["corr_h"]), 2)
    left = float(np.sqrt(2 * (1 - rho)))
    doc = Document()
    header_footer(doc)
    normal = doc.styles["Normal"]
    normal.font.name = "微软雅黑"
    normal.font.size = Pt(12)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")

    add_p(doc, "轧差市值小，不等于单边敞口小", size=22, bold=True, color=NAVY, before=6, after=4)
    add_p(doc, "组合风控为什么要看风险贡献占比", size=14, bold=True, color=BLUE, before=0, after=2)
    add_p(doc, "纠正一种普遍的看法：板块内多空轧完，净市值不大，单边敞口就可以不看。",
          size=11, color=MUTED, before=0, after=10)

    box = doc.add_table(rows=1, cols=1)
    cell = box.cell(0, 0)
    shade_cell(cell, "F8F1EA")
    set_cell_border(cell, "E4CDB8")
    cell.text = ""
    lines = [
        "结论先写在前面。",
        f"2026年11月18日，能源化工的板块净额是 {wan(abs(c['net']))} 万元，轧差占比 8.6%，和股指的 {wan(abs(g['net']))} 万元、6.8% 很接近，两个板块的波动率也都在三成上下。盘手据此认为能化是板块内对冲，敞口不大。",
        f"同一天，能化的风险贡献占比是 56.5%，股指是 5.6%。能化对冲对的持仓加权相关是 {rho:.2f}，不是 1。等额反向时，净额可以是 0，盈亏波动仍留下单边的 {left * 100:.0f}%。把能化整本书算完，盈亏波动大约是「品种完全相关、只剩这块净额」时的 {c['multiple']:.1f} 倍，折成一笔单边大约 {wan(c['equiv'])} 万元，不是 {wan(abs(c['net']))} 万元，也不是多空相加的 {wan(c['contract'])} 万元。",
        "组合管理要看的是风险贡献占比。轧差市值只回答方向还剩多少，回答不了这块仓位占了多少风险预算。",
    ]
    for i, line in enumerate(lines):
        p = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.12
        run = p.add_run(line)
        set_run(run, size=11, bold=(i == 0), color=NAVY if i == 0 else INK)
    add_p(doc, "", size=6, after=4)

    add_h(doc, "一、要纠正的那句话")
    add_p(doc, "底层盘手的原话可以收成一句：板块里面做的是多空对冲，轧差市值只有六百多万，单边敞口不大，风险贡献高也不用降仓。")
    add_p(doc, "这句话里有一半是对的。同一品种的多头和空头，用的是同一条价格，在进入相关性计算之前就已经合成一笔净持仓，抵消是完全的。甲醇自己的多单和空单，不会留下价差。")
    add_p(doc, "另一半把两件不同的事当成了一件事。不同品种之间的多空，只能按它们的相关系数抵消。相关不到 1，价差就还在。把不同品种再轧成一个板块净额，等于假设它们是同一个合约。能化不是。")
    add_p(doc, "所以要分开三句话来说。同品种对冲，成立。跨品种对冲，部分成立。用板块轧差市值代替单边敞口，不成立。")

    add_h(doc, "二、同一天，两列数字排出来的顺序相反")
    add_p(doc, "下表是风险报告「板块持仓分析」2026年11月18日的四个板块。总规模 7,674 万元。轧差占比 = 板块净市值的绝对值 ÷ 总规模。风险贡献占比 = 该板块各品种绝对边际方差之和 ÷ 全组合绝对边际方差之和。")
    add_table(
        doc,
        ["板块", "轧差占比", "风险贡献占比", "板块市场波动", "板块持仓波动"],
        [[a, f"{b:.1f}%", f"{c_:.1f}%", f"{d:.1f}%", f"{e:.1f}%"] for a, b, c_, d, e in
         sorted(TABLE, key=lambda r: -r[2])],
        emphasize_col=2,
    )
    add_p(doc, "按轧差占比从大到小，是农产、黑色、能源化工、股指。按风险贡献占比从大到小，是能源化工、农产、股指、黑色。能化轧差只有 8.6%，风险贡献占了一半以上。农产轧差 42.1%，风险贡献 23.4%。两列衡量的不是同一个东西，所以排序会反。")
    add_figure(doc, charts["rank"], "图 1  四个板块的轧差占比与风险贡献占比。能化轧差靠后，风险贡献靠前。")
    add_p(doc, "只拿能化和股指比，更容易把人带进那个误解。两行的轧差占比差 2 个百分点，板块市场波动都在 27% 附近，板块持仓波动都在三成出头。看起来像两个差不多大的净敞口。风险贡献一个 56.5%，一个 5.6%，差了一个数量级。后面的公式就是解释这个数量级。")

    add_h(doc, "三、三列数字，三个问题")
    add_p(doc, "第一列问的是方向还剩多少。", bold=True, after=4)
    add_formula(doc, [
        "轧差市值  =  多头市值  −  空头市值",
        "轧差占比  =  |轧差市值|  ÷  总规模",
    ])
    add_p(doc, f"能化多头 {wan(c['long'])} 万元，空头 {wan(c['short'])} 万元，轧差 {wan(c['net'])} 万元，绝对值 {wan(abs(c['net']))} 万元，除以总规模得到 8.6%。这一步把 23 个品种先加总再相减。甲醇的多和塑料的空，在这一步里互相减掉了。")

    add_p(doc, "第二列问的是这些持仓品种自身的波动有多大。它是一个百分比，不随账面大小放大，也不因多空对冲缩小。", bold=True, after=4)
    add_formula(doc, [
        "先把同一品种的多空合成净市值 MVᵢ，多头为正，空头为负",
        "rₛ,ₜ  =  Σᵢ (|MVᵢ| / Σ|MV|) × rᵢ,ₜ",
        "板块持仓波动  =  StdDev(rₛ) × √252",
    ])
    add_p(doc, "权重用的是市值的绝对值。空头和多头都按正的权重进入这条收益率，对冲不会把波动率百分比压小。能化 35.4%、股指 32.5%，只说明两边拿着的品种波动率接近。它不包含「一边 1 个亿、一边 600 万」这种规模差别，所以不能拿它和轧差占比相乘，去代替风险贡献。")

    add_p(doc, "第三列问的是这块仓位占了组合多少风险预算。", bold=True, after=4)
    add_formula(doc, [
        "σᵢ  =  该品种最近 20 个交易日收益率的标准差",
        "dvᵢ  =  σᵢ × MVᵢ",
        "mvcᵢ  =  dvᵢ × Σⱼ (dvⱼ × ρᵢⱼ)",
        "风险贡献占比ₛ  =  Σᵢ∈ₛ |mvcᵢ|  ÷  Σₖ |mvcₖ|",
    ])
    add_p(doc, "ρᵢⱼ 是两个品种最近 252 个交易日收益率的相关系数。对角线上，品种和自己的相关是 1，所以同品种没有第二行可以再抵消——同品种的多空在 MVᵢ 里已经净完了。不同品种的抵消发生在 ρᵢⱼ 这一项：ρ 越接近 1，一多一空的两笔 dv 乘出来的交叉项越负，方差消得越多。")
    add_p(doc, "最后一步取了绝对值，再按板块相加。因此这列回答的是风险库存落在哪个板块，不是这个板块对组合 VaR 的正负贡献。能化如果和组合其他部分对冲，表上的占比也不会变成负数。56.5% 的意思是：全组合的绝对边际方差里，有一半以上记在能化这些品种上。它不是「净值的 56% 押了单边方向」。")

    add_h(doc, "四、等额反向：净额可以是 0，波动不是 0")
    add_p(doc, "先用一笔最干净的账，把逻辑从持仓里剥出来。两个品种，日盈亏波动都是 100 万元，一手多、一手空，市值轧差为 0。盘手的说法在这里就是：敞口是 0。")
    add_formula(doc, [
        "组合方差  =  dv₁² + dv₂² + 2 ρ dv₁ dv₂",
        "等额反向：dv₂ = −dv₁，净美元波动 = 0",
        "组合波动  =  单边波动 × √[ 2 × (1 − ρ) ]",
    ])
    add_p(doc, "把几个相关系数代进去。ρ = 1 时，根号里是 0，组合波动是 0，净额和真实敞口重合。ρ = 0.80 时，√[2 × 0.20] = 0.63，还留下单边波动的 63%。ρ = 0.66 时，留下 82%。ρ = 0 时，留下 √2，大约 1.41 倍，两腿各走各的。")
    add_p(doc, f"能化实际持仓里，一多一空的那些对子，按市值加权的相关是 {rho:.2f}。套进这条公式，等额反向之后仍留下单边波动的 {left * 100:.0f}%。净敞口在任何相关系数下都是 0，真实波动不是。相关「已经不低」和「可以当成同一个合约」之间，还隔着这一截。")
    add_figure(doc, charts["curve"], "图 2  等额反向时，净敞口恒为 0。曲线是剩下的盈亏波动占单边的比例。能化对冲对落在 0.66 附近。")
    add_p(doc, "这张图就是要纠正的那个认知。横轴走到最右边、相关系数等于 1，曲线才落到 0。在那之前，轧差市值都是 0，单边意义上的盈亏波动都还在。")

    add_h(doc, "五、同品种为什么能消干净，邻品种为什么不能")
    add_p(doc, "同品种多空消得干净，不是因为有人在矩阵里把相关系数填成 1。同一合约的多头和空头是同一条价格的两笔数量，先合并成一个净数量，再去乘波动率。合并之后只剩一行，不存在「自己和自己对冲」的第二行。")
    add_p(doc, f"这一步在能化里已经做完，而且做掉的量很大。合约多头加空头是 {wan(c['contract'])} 万元。按品种各自轧差之后，23 个品种的净市值绝对值加总是 {wan(c['gross_abs'])} 万元。从 {wan(c['contract'])} 万降到 {wan(c['gross_abs'])} 万，靠的是同品种抵消，这一步成立。")
    add_p(doc, f"有争议的是下一步：把这 {wan(c['gross_abs'])} 万再轧成板块净额 {wan(c['net'])} 万元。这一步跨了品种。它成立的条件是这些品种的相关系数等于 1。下面是过去 252 个交易日、持仓日之前的结果。")

    add_table(
        doc,
        ["", "能源化工", "股指"],
        [
            ["持仓品种数", str(c["n"]), str(g["n"])],
            ["品种对，等权平均相关", f"{c['corr_u']:.2f}", f"{g['corr_u']:.2f}"],
            ["按持仓市值加权的相关", f"{c['corr_w']:.2f}", f"{g['corr_w']:.2f}"],
            ["其中，一多一空的对子", f"{c['corr_h']:.2f}", f"{g['corr_h']:.2f}"],
            ["其中，方向相同的对子", f"{c['corr_s']:.2f}", f"{g['corr_s']:.2f}"],
        ],
        emphasize_col=1,
    )
    add_p(doc, f"能化 23 个品种、{c['n_h']} 个一多一空的对子，加权相关 {c['corr_h']:.2f}。这不是「低相关」。0.66 说明大部分同涨同跌已经对上了，完全不相关时的方差，在这组持仓里大约还剩 {c['uncorr_ratio'] * 100:.0f}%。对冲是真实的。它只是没有对成同一个合约。")
    add_p(doc, "股指四个品种的加权相关是 {:.2f}，同向的三只空头之间更高。所以股指再轧一次，从品种净额轧到板块净额，损失不大，实际盈亏波动和「完全相关时的净额」几乎一样，倍数是 {:.2f}。能化这一步损失很大，倍数是 {:.1f}。".format(g["corr_w"], g["multiple"], c["multiple"]))

    add_h(doc, "六、能化账上最大的几对")
    add_p(doc, "品种净市值最大的几笔如下。正数是净多，负数是净空。单位万元。")
    top = c["prods"][:8]
    add_table(
        doc,
        ["品种", "净市值（万元）", "方向"],
        [[f"{CN.get(p, p)}（{p}）", f"{c['mv'][p] / 10000:,.0f}", "净多" if c["mv"][p] > 0 else "净空"]
         for p in top],
    )
    add_p(doc, "甲醇是最大的净多，塑料和聚丙烯是最大的两笔净空。塑料和甲醇、聚丙烯和甲醇，是账上最重的对冲对，相关性都在 0.80 左右。聚丙烯和塑料自己则是同向的两笔空头，相关性更高，接近完全同向，这两笔是叠加，不是对冲。")
    add_figure(doc, charts["pairs"], "图 3  能化持仓里权重最大的对子。蓝色是一多一空，橙色是方向相同。虚线是完全对冲所要求的相关系数 1。")
    add_p(doc, "读这张图时看虚线右边的空白。相关性最高的对冲对停在 0.80，离 1 还差 0.20。按第四节的公式，0.80 的等额反向留下单边波动的 63%。相关只有 0.5 上下的那些对子，留下的更多。方向相同的那一对不留白，它把风险往上加。")

    add_h(doc, "七、657 万净额，对应多大的盈亏波动")
    add_p(doc, "把能化 23 个品种放进它们自己的协方差，不算组合里的其他板块，得到这块持仓自己的盈亏波动。波动率用持仓日之前 20 个交易日，相关用前 252 个交易日。")
    add_table(
        doc,
        ["", "能源化工", "股指"],
        [
            ["合约多空合计", f"{wan(c['contract'])} 万", f"{wan(g['contract'])} 万"],
            ["同品种轧差后的绝对敞口之和", f"{wan(c['gross_abs'])} 万", f"{wan(g['gross_abs'])} 万"],
            ["板块净额", f"{wan(c['net'])} 万", f"{wan(g['net'])} 万"],
            ["若品种完全相关，净额的年化盈亏波动", f"{wan(c['perfect_ann'])} 万", f"{wan(g['perfect_ann'])} 万"],
            ["按实际相关，板块年化盈亏波动", f"{wan(c['std_ann'])} 万", f"{wan(g['std_ann'])} 万"],
            ["实际波动 ÷ 完全相关的净额波动", f"{c['multiple']:.1f} 倍", f"{g['multiple']:.2f} 倍"],
            ["折成一笔单边市值（等效敞口）", f"{wan(c['equiv'])} 万", f"{wan(g['equiv'])} 万"],
            ["等效敞口 ÷ 板块净额", f"{c['equiv'] / abs(c['net']):.1f} 倍", f"{g['equiv'] / abs(g['net']):.2f} 倍"],
        ],
        emphasize_col=1,
    )
    add_p(doc, f"两个倍数都要留着，它们回答的不是同一个问题。{c['multiple']:.1f} 倍的分母，是「这 23 个品种如果真像一个合约那样动，{wan(abs(c['net']))} 万净额还能晃出多少盈亏」，一年大约 {wan(c['perfect_ann'])} 万元。分子是按 {rho:.2f} 的相关算出来的实际盈亏波动，一年大约 {wan(c['std_ann'])} 万元。分母很小，所以倍数大。")
    add_p(doc, f"等效单边把这个实际盈亏波动，除以这些品种自己的市值加权波动率（年化约 {c['avg_sig'] * 100:.0f}%），还原成一笔持仓。能化大约 {wan(c['equiv'])} 万元，是净额的 {c['equiv'] / abs(c['net']):.1f} 倍。股指大约 {wan(g['equiv'])} 万元，和净额 {wan(abs(g['net']))} 万元几乎是同一笔数。")
    add_p(doc, f"多空相加的 {wan(c['contract'])} 万元里，同一品种的多空已经抵消，不能再当成敞口。只剩 {wan(abs(c['net']))} 万元同样对不上。能化这块价差，自己的盈亏波动相当于大约 {wan(c['equiv'])} 万元的单边；相对「完全对冲后的净额」，盈亏波动是 {c['multiple']:.1f} 倍。")
    add_figure(doc, charts["layers"], "图 4  每一层敞口除以板块净额。股指四根柱子都矮，能化在同品种轧完之后仍是净额的数倍，等效单边也高于净额。")

    add_h(doc, "八、为什么风险贡献差了约十倍")
    add_p(doc, f"股指的合约多空合计是 {wan(g['contract'])} 万元，同品种轧完剩下 {wan(g['gross_abs'])} 万元，板块净额 {wan(abs(g['net']))} 万元。三层数字离得不远，因为四个股指高度同向，空头之间的相关在 0.8 到 0.96，再轧一次消掉的大多是真正同向的部分。实际波动相对完全相关净额的倍数是 {g['multiple']:.2f}，可以当成 1。")
    add_p(doc, f"能化的三层是 {wan(c['contract'])} 万、{wan(c['gross_abs'])} 万、{wan(abs(c['net']))} 万。品种净敞口之和是股指的 {c['gross_abs'] / g['gross_abs']:.1f} 倍。风险贡献 56.5% 对 5.6%，是 {56.5 / 5.6:.1f} 倍。数量级对得上的，是品种净敞口这一层，不是板块净额那一层。板块净额能化只是股指的 {abs(c['net']) / abs(g['net']):.1f} 倍，所以用轧差去比，会觉得两个板块差不多。")
    add_p(doc, "风险贡献按品种进入协方差，在品种内部净完，在品种之间只按相关净掉一部分，然后把每个品种的绝对边际方差加起来。能化有 23 行这样的库存。股指只有 4 行，规模小，三笔空头之间又高度同向。两列百分比波动率几乎一样，规模差别就直接进了风险贡献。")
    add_p(doc, f"这里再防一个新的误解。等效单边 {wan(c['equiv'])} 万元，除以总规模大约是 {c['equiv'] / SCALE * 100:.0f}%，不是 56%。56% 的分母是全组合的绝对边际方差，不是总规模。能化品种波动率高，品种个数多，每一行的 |mvc| 都进分子。所以「大约 {wan(c['equiv'])} 万的等效单边」和「占组合风险库存的 56%」可以同时成立。")

    add_h(doc, "九、组合管理看哪一列，和盘手怎么说")
    add_p(doc, "轧差占比适合回答一个窄问题：这个板块现在偏多还是偏空，净方向有多大。颜色跟着净市值的符号走，净多、净空一眼能看出来。它不适合回答「要不要为这块仓位腾出风险预算」。")
    add_p(doc, "板块持仓波动适合回答品种选择：这块板块里拿着的合约，自身波动是三成还是一成。它是百分比。农产持仓波动 9.4%，能化 35.4%，这个对比有用。它不包含头寸规模，也不把对冲残差折成金额。")
    add_p(doc, "风险贡献占比适合回答预算：组合的风险库存有多少落在这个板块。能化 56.5% 就是这句。组合层面讨论减仓、对冲、换结构，看的是这一列。净额小而这一列大，说明风险留在价差上，不是说明计算把对冲忘了。对冲已经在 ρᵢⱼ 里。")
    add_p(doc, "和盘手讲的时候，下面四句够用。", before=4, after=4)
    for text in [
        f"同品种的多空已经完全抵消。能化从合约毛市值 {wan(c['contract'])} 万元，降到品种净敞口 {wan(c['gross_abs'])} 万元，这一步成立。",
        f"跨品种也是对冲，而且相关不低。一多一空的加权相关 {rho:.2f}，甲醇对塑料、甲醇对聚丙烯大约 0.80。大部分共同涨跌已经对掉。",
        f"对掉之后还剩一截。等额反向、相关 {rho:.2f} 时，仍留下单边波动的 {left * 100:.0f}%。整本书算下来，盈亏波动是完全相关净额的 {c['multiple']:.1f} 倍，折合单边大约 {wan(c['equiv'])} 万元，不是 {wan(abs(c['net']))} 万元。",
        "56% 不是说有 56% 的净值押了单边方向。它是说，组合的风险库存有一半以上记在这些能化价差上。要讨论的是这块价差占的预算，不是把净额再解释一遍。",
    ]:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.75)
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.12
        run = p.add_run("·  " + text)
        set_run(run, size=12)

    add_p(doc, "减仓与否是另一件事。风险贡献高，说明预算被这块结构占用了；盘手说结构是价差，说明不该按单边净额去砍。两句话可以同时成立。不能成立的，是用 657 万净额证明这块预算占用不存在。", before=6)

    add_h(doc, "十、口径")
    for text in [
        "持仓是 2026年11月18日 MOM 结算单汇总，与风险报告板块持仓分析同一天、同一套分类。能源化工不含黄金、白银、碳酸锂、工业硅、多晶硅和集运，那些在贵金属、新能源、航运里单列。",
        "总规模 76,739,267 元，即报告抬头的累计资本，四舍五入后写 7,674 万元。轧差占比的分母是它。",
        "品种净市值把同一品种所有合约、所有账户的多头市值和空头市值先相减。合约多空合计不相减。板块净额再把不同品种相减。",
        "收益率用主力连续合约收盘价的日收益率，持仓日当天不计入。单日涨跌绝对值达到 15% 的点去掉，用来避开换月跳空。波动率是此前 20 个收益率的样本标准差。相关是此前 252 个交易日、两两都有行情的日期上的皮尔逊相关。",
        "风险贡献占比沿用持仓 VaR 的定义：边际方差取绝对值后按板块相加。报告里的 56.5%、5.6%、23.4%、5.0% 是当日风险报告表上的数。第七节的盈亏波动是能化、股指各自持仓的协方差结果，还没有和农产、黑色及其他板块再做一次组合对冲。",
        "等效单边 = 板块年化盈亏波动 ÷ 品种波动率的市值加权平均。它是一个换算，方便和净额比大小，不是账上真有这样一笔单边持仓。",
    ]:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.4)
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.08
        run = p.add_run(text)
        set_run(run, size=10.5, color="374151")

    add_p(doc, "数字只对 2026年11月18日这组持仓负责。换一天，净额、相关和风险贡献都会变，公式不变。",
          size=10.5, color=MUTED, before=8)

    doc.save(OUT)
    print("wrote", OUT)


def main():
    setup_font()
    books = load_positions()
    c, g = books["能源化工"], books["股指"]
    print("chem long/short/net", round(c["long"]), round(c["short"]), round(c["long"] - c["short"]))
    print("idx  long/short/net", round(g["long"]), round(g["short"]), round(g["long"] - g["short"]))
    # 与风险报告当日列值核对，差过 1 万元就停，避免报告和表不一致。
    assert abs(c["long"] - 102_448_405) < 10000, c["long"]
    assert abs(c["short"] - 109_017_060) < 10000, c["short"]
    assert abs(g["long"] - 8_023_820) < 10000, g["long"]
    assert abs(g["short"] - 13_208_840) < 10000, g["short"]
    stats = analyze(books, load_returns())
    for name, s in stats.items():
        print(
            name,
            "n", s["n"],
            "gross_abs", round(s["gross_abs"]),
            "corr_h", round(s["corr_h"], 3),
            "corr_w", round(s["corr_w"], 3),
            "mult", round(s["multiple"], 2),
            "equiv", round(s["equiv"]),
            "std_ann", round(s["std_ann"]),
            "perfect", round(s["perfect_ann"]),
            "uncorr", round(s["uncorr_ratio"], 3),
            "avg_sig", round(s["avg_sig"], 3),
        )
    ASSET.mkdir(parents=True, exist_ok=True)
    charts = {
        "rank": ASSET / "fig1_rank.png",
        "curve": ASSET / "fig2_curve.png",
        "layers": ASSET / "fig3_layers.png",
        "pairs": ASSET / "fig4_pairs.png",
    }
    chart_rank(charts["rank"])
    chart_curve(charts["curve"], round(float(stats["能源化工"]["corr_h"]), 2))
    chart_layers(charts["layers"], stats)
    chart_pairs(charts["pairs"], stats["能源化工"])
    build(stats, charts)


if __name__ == "__main__":
    main()
