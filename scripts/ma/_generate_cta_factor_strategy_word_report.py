# -*- coding: utf-8 -*-
"""Chinese Word report: CTA factor-screen strategy deduction vs 团队策略标签."""
from __future__ import annotations

import csv
import statistics
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties, fontManager
import os

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "reports" / "cta-factor-vs-team-strategy.csv"
OUT_PATH = ROOT / "reports" / "CTA因子回归与团队策略差异说明_20261009.docx"
CHART_DIR = ROOT / "reports" / "cta-factor-strategy-charts"

NAVY = RGBColor(0x1A, 0x36, 0x5D)
TEXT = RGBColor(0x2D, 0x37, 0x48)
MUTED = RGBColor(0x64, 0x74, 0x8B)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

C_NAVY = "#1A365D"
C_TEAL = "#2B6CB0"
C_GREEN = "#2F855A"
C_GOLD = "#C9A227"
C_ORANGE = "#DD6B20"
C_RED = "#C53030"
C_PURPLE = "#805AD5"
C_GRAY = "#718096"

CLUSTER_COLOR = {
    "趋势型": C_NAVY,
    "基本面+量价型": C_GREEN,
    "趋势+期限结构型": C_GOLD,
    "波动率+反转型": C_RED,
}
L3_COLOR = {
    "时序": C_NAVY,
    "混合": C_TEAL,
    "基本面": C_GREEN,
    "量价": C_ORANGE,
    "中高频": C_PURPLE,
}
L3_ORDER = ["时序", "混合", "基本面", "量价", "中高频"]
UNSEEN = ["股指", "截面", "机器学习", "大厂", "高频", "交易型", "商品"]

_CN: FontProperties | None = None


def configure_matplotlib() -> None:
    global _CN
    plt.rcParams["axes.unicode_minus"] = False
    for path in (
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
    ):
        if os.path.isfile(path):
            fontManager.addfont(path)
            _CN = FontProperties(fname=path)
            plt.rcParams["font.family"] = "sans-serif"
            plt.rcParams["font.sans-serif"] = [_CN.get_name(), "Microsoft YaHei", "SimHei"]
            return
    _CN = FontProperties(family="Microsoft YaHei")


def fp() -> dict:
    return {"fontproperties": _CN} if _CN is not None else {}


def savefig(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(path, dpi=160, bbox_inches="tight", facecolor="white")
    plt.close()


def style_ax(ax) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color="#E2E8F0", lw=0.8)
    ax.set_axisbelow(True)


def num(value: str | None) -> float | None:
    text = (value or "").strip().replace("%", "").replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def tags_of(value: str) -> list[str]:
    return [p.strip() for p in __import__("re").split(r"[，,、/]", value or "") if p.strip()]


def load_rows() -> list[dict]:
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def share_of(row: dict) -> float | None:
    return num(row.get("长期侧占比"))


def rev_ratio(row: dict) -> float | None:
    mom = num(row.get("长期规则动量β"))
    rev = num(row.get("反转β"))
    if mom is None or rev is None:
        return None
    den = abs(mom) + abs(rev)
    if den < 1e-9:
        return None
    return abs(rev) / den


def severity(row: dict) -> str:
    kind = row.get("差异类型") or ""
    note = row.get("差异说明") or ""
    if kind == "一致":
        return "一致"
    if kind == "回归信息不足":
        return "回归信息不足"
    if "二级不一致" in kind or "一级不一致" in kind:
        return "一级或二级不一致"
    if "团队三级为空" in kind or "团队二级为空" in kind or "团队一级为空" in kind:
        return "团队策略为空"
    if "多标" in kind and "三级不一致" not in kind:
        return "主标签一致，另有回归看不到的标签"
    if "只覆盖了回归的一部分" in note:
        return "团队只覆盖了一部分"
    if "三级不一致" in kind:
        return "主标签对不上"
    return kind or "其他"


def median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def bar_labels(ax, bars, fmt="{:.0f}") -> None:
    for bar in bars:
        height = bar.get_height()
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            height,
            fmt.format(height),
            ha="center",
            va="bottom",
            fontsize=8,
            color="#2D3748",
            fontproperties=_CN,
        )


def chart_clusters(rows: list[dict], folder: Path) -> Path:
    clusters = Counter((r["风格簇"] or "回归字段为空") for r in rows)
    factors = Counter((r["主导因子"] or "回归字段为空") for r in rows)
    factor_color = {
        "中期动量": C_NAVY,
        "长期动量": C_TEAL,
        "库存": C_GREEN,
        "波动": C_RED,
        "回归字段为空": C_GRAY,
    }
    fig, axes = plt.subplots(1, 2, figsize=(10.4, 4.3))
    for ax, counter, title, palette in (
        (axes[0], clusters, "风格簇", CLUSTER_COLOR),
        (axes[1], factors, "主导因子", factor_color),
    ):
        labels = [k for k, _ in counter.most_common()]
        vals = [counter[k] for k in labels]
        colors = [palette.get(k, C_GRAY) for k in labels]
        bars = ax.bar(range(len(labels)), vals, color=colors, width=0.72)
        ax.set_xticks(range(len(labels)))
        ax.set_xticklabels(labels, rotation=18, ha="right", **fp())
        ax.set_ylabel("产品数", **fp())
        ax.set_title(title, **fp())
        style_ax(ax)
        ax.set_ylim(0, max(vals) * 1.18)
        bar_labels(ax, bars)
    fig.tight_layout()
    out = folder / "fig1_clusters.png"
    savefig(out)
    return out


def chart_horizon(rows: list[dict], folder: Path) -> Path:
    groups = defaultdict(list)
    for row in rows:
        value = share_of(row)
        horizon = (row.get("持仓周期") or "").strip()
        if value is None or not horizon:
            continue
        groups[horizon].append(value)
    order = [k for k in ("短周期", "混合", "中长周期") if groups.get(k)]
    fig, ax = plt.subplots(figsize=(7.4, 4.2))
    data = [groups[k] for k in order]
    box = ax.boxplot(data, tick_labels=order, patch_artist=True, widths=0.55, showfliers=False)
    colors = [C_PURPLE, C_TEAL, C_NAVY]
    for patch, color in zip(box["boxes"], colors):
        patch.set_facecolor(color)
        patch.set_alpha(0.85)
    for i, key in enumerate(order, start=1):
        ys = groups[key]
        ax.scatter([i] * len(ys), ys, s=12, color="#1A202C", alpha=0.35, zorder=3)
        med = median(ys)
        if med is not None:
            ax.text(i, max(ys) + 3, f"中位 {med:.0f}%", ha="center", va="bottom", fontsize=8, fontproperties=_CN, color="#1A202C")
    ax.set_ylim(0, 118)
    ax.set_ylabel("长期侧占比（%）", **fp())
    ax.set_title("持仓周期与长期侧占比", **fp())
    style_ax(ax)
    fig.tight_layout()
    out = folder / "fig2_horizon.png"
    savefig(out)
    return out


def chart_scatter(rows: list[dict], folder: Path) -> Path:
    fig, ax = plt.subplots(figsize=(7.6, 4.8))
    for name, color in CLUSTER_COLOR.items():
        xs, ys = [], []
        for row in rows:
            if row.get("风格簇") != name:
                continue
            x = share_of(row)
            y = rev_ratio(row)
            if x is None or y is None:
                continue
            xs.append(x)
            ys.append(y * 100)
        ax.scatter(xs, ys, s=28, color=color, alpha=0.85, label=name)
    ax.set_xlabel("长期侧占比（%）", **fp())
    ax.set_ylabel("反转系数占动量与反转绝对值之和（%）", **fp())
    ax.set_title("长期侧越集中，反转相对越弱", **fp())
    style_ax(ax)
    leg = ax.legend(frameon=False, prop=_CN, loc="upper right")
    for text in leg.get_texts():
        text.set_fontsize(8)
    fig.tight_layout()
    out = folder / "fig3_scatter.png"
    savefig(out)
    return out


def chart_deduced(rows: list[dict], folder: Path) -> Path:
    counter = Counter((r["推断三级策略"] or "无法判断") for r in rows)
    labels = [k for k in L3_ORDER if counter.get(k)] + (["无法判断"] if counter.get("无法判断") else [])
    vals = [counter[k] for k in labels]
    fig, ax = plt.subplots(figsize=(7.4, 4.0))
    colors = [L3_COLOR.get(k, C_GRAY) for k in labels]
    bars = ax.bar(range(len(labels)), vals, color=colors, width=0.66)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, **fp())
    ax.set_ylabel("产品数", **fp())
    ax.set_title("推断三级策略", **fp())
    style_ax(ax)
    ax.set_ylim(0, max(vals) * 1.18)
    bar_labels(ax, bars)
    fig.tight_layout()
    out = folder / "fig4_deduced.png"
    savefig(out)
    return out


def chart_gap(rows: list[dict], folder: Path) -> Path:
    sev_order = [
        "一致",
        "主标签一致，另有回归看不到的标签",
        "团队只覆盖了一部分",
        "主标签对不上",
        "团队策略为空",
        "一级或二级不一致",
        "回归信息不足",
    ]
    sev = Counter(severity(r) for r in rows)
    fig, axes = plt.subplots(1, 2, figsize=(10.6, 4.6))
    labels = [k for k in sev_order if sev.get(k)]
    vals = [sev[k] for k in labels]
    colors = [C_GREEN, C_GOLD, C_TEAL, C_RED, C_ORANGE, C_PURPLE, C_GRAY]
    axes[0].barh(range(len(labels))[::-1], vals, color=colors[: len(labels)])
    axes[0].set_yticks(range(len(labels))[::-1])
    axes[0].set_yticklabels(labels, **fp())
    axes[0].set_xlabel("产品数", **fp())
    axes[0].set_title("差异怎么分", **fp())
    style_ax(axes[0])
    axes[0].set_xlim(0, max(vals) * 1.18)
    for i, value in zip(range(len(labels))[::-1], vals):
        axes[0].text(value + 0.6, i, str(value), va="center", fontsize=8, fontproperties=_CN)

    contain_labels = []
    hit, miss, empty = [], [], []
    for label in L3_ORDER:
        subset = [r for r in rows if r.get("推断三级策略") == label]
        if not subset:
            continue
        contain_labels.append(label)
        hit.append(sum(1 for r in subset if label in tags_of(r.get("团队三级策略") or "")))
        empty.append(sum(1 for r in subset if not tags_of(r.get("团队三级策略") or "")))
        miss.append(len(subset) - hit[-1] - empty[-1])
    x = range(len(contain_labels))
    axes[1].bar(x, hit, color=C_GREEN, label="团队三级含推断标签")
    axes[1].bar(x, miss, bottom=hit, color=C_RED, label="不含推断标签")
    bottom2 = [a + b for a, b in zip(hit, miss)]
    axes[1].bar(x, empty, bottom=bottom2, color=C_GRAY, label="团队三级为空")
    axes[1].set_xticks(list(x))
    axes[1].set_xticklabels(contain_labels, **fp())
    axes[1].set_ylabel("产品数", **fp())
    axes[1].set_title("团队三级有没有写上推断结果", **fp())
    style_ax(axes[1])
    leg = axes[1].legend(frameon=False, prop=_CN, loc="upper center", bbox_to_anchor=(0.5, -0.22), ncol=1)
    for text in leg.get_texts():
        text.set_fontsize(8)
    fig.tight_layout()
    fig.subplots_adjust(bottom=0.28, wspace=0.45)
    out = folder / "fig5_gap.png"
    savefig(out)
    return out


def chart_unseen(rows: list[dict], folder: Path) -> Path:
    counter = Counter()
    for row in rows:
        for tag in tags_of(row.get("团队三级策略") or ""):
            if tag in UNSEEN:
                counter[tag] += 1
    labels = [k for k, _ in counter.most_common()]
    vals = [counter[k] for k in labels]
    fig, ax = plt.subplots(figsize=(7.4, 3.8))
    if labels:
        bars = ax.bar(range(len(labels)), vals, color=C_ORANGE, width=0.66)
        ax.set_xticks(range(len(labels)))
        ax.set_xticklabels(labels, **fp())
        ax.set_ylim(0, max(vals) * 1.2)
        bar_labels(ax, bars)
    ax.set_ylabel("出现该标签的产品数", **fp())
    ax.set_title("团队三级里、这份回归没有对应因子的标签", **fp())
    style_ax(ax)
    fig.tight_layout()
    out = folder / "fig6_unseen.png"
    savefig(out)
    return out


def set_run_font(run, *, size=11, bold=False, color=None, name="微软雅黑"):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def add_text(paragraph, text, *, size=11, bold=False, color=None):
    run = paragraph.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color)
    return run


def para(doc, text="", *, size=11, bold=False, color=None, align=None, space_after=8, space_before=0):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.line_spacing = 1.28
    if align:
        p.alignment = align
    if text:
        add_text(p, text, size=size, bold=bold, color=color or TEXT)
    return p


def heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        set_run_font(run, size=16 if level == 1 else 13, bold=True, color=NAVY)
    return p


def shade(cell, hex_color: str) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tc_pr.append(shd)


def set_cell_border(cell) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "CBD5E0")
        borders.append(el)
    tc_pr.append(borders)


def cell_text(cell, text, *, size=8, bold=False, color=None, align="center"):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.alignment = {
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
    }[align]
    add_text(p, "" if text is None else str(text), size=size, bold=bold, color=color or TEXT)
    set_cell_border(cell)


def add_table(doc, headers, rows, left_cols=None):
    left_cols = set(left_cols or [])
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    for i, header in enumerate(headers):
        cell_text(table.rows[0].cells[i], header, size=8, bold=True, color=WHITE)
        shade(table.rows[0].cells[i], "1A365D")
    for r_i, row in enumerate(rows):
        fill = "F7FAFC" if r_i % 2 == 0 else "FFFFFF"
        for c_i, val in enumerate(row):
            cell_text(
                table.rows[r_i + 1].cells[c_i],
                val,
                size=8,
                align="left" if c_i in left_cols else "center",
            )
            shade(table.rows[r_i + 1].cells[c_i], fill)
    para(doc, "", space_after=4)
    return table


def add_image(doc, path: Path, width=6.35):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(2)
    p.add_run().add_picture(str(path), width=Inches(width))


def caption(doc, text: str) -> None:
    para(doc, text, size=9, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)


def add_footer(section) -> None:
    footer = section.footer
    footer.is_linked_to_previous = False
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_text(p, "CTA 因子回归推断与团队策略标签  ·  ", size=8, color=MUTED)
    run = p.add_run()
    set_run_font(run, size=8, color=MUTED)
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(end)


def fmt_pct(value: float | None) -> str:
    return "—" if value is None else f"{value:.1f}%"


def group_stats(rows: list[dict]) -> list[list[str]]:
    buckets = defaultdict(lambda: {"n": 0, "share": [], "ratio": []})
    for row in rows:
        key = (
            row.get("风格簇") or "—",
            row.get("持仓周期") or "—",
            row.get("主导因子") or "—",
        )
        if key == ("—", "—", "—"):
            continue
        buckets[key]["n"] += 1
        share = share_of(row)
        ratio = rev_ratio(row)
        if share is not None:
            buckets[key]["share"].append(share)
        if ratio is not None:
            buckets[key]["ratio"].append(ratio * 100)
    out = []
    for key, payload in sorted(buckets.items(), key=lambda kv: -kv[1]["n"]):
        out.append([
            str(payload["n"]),
            key[0],
            key[1],
            key[2],
            fmt_pct(median(payload["share"])),
            fmt_pct(median(payload["ratio"])),
        ])
    return out


def build() -> None:
    configure_matplotlib()
    rows = load_rows()
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    fig1 = chart_clusters(rows, CHART_DIR)
    fig2 = chart_horizon(rows, CHART_DIR)
    fig3 = chart_scatter(rows, CHART_DIR)
    fig4 = chart_deduced(rows, CHART_DIR)
    fig5 = chart_gap(rows, CHART_DIR)
    fig6 = chart_unseen(rows, CHART_DIR)

    n = len(rows)
    sev = Counter(severity(r) for r in rows)
    deduced = Counter((r["推断三级策略"] or "无法判断") for r in rows)
    blank = [r for r in rows if not (r.get("推断三级策略") or "").strip()]
    comparable = [r for r in rows if (r.get("推断三级策略") or "").strip()]
    same_beta = 0
    beta_n = 0
    for row in rows:
        left = num(row.get("长期侧β")) if "长期侧β" in row else None
        # source comparison file stores 长期规则动量β and 反转β; 长期侧β was an input column
        # The comparison CSV kept 长期规则动量β. Count equality only when both exist.
        mom = num(row.get("长期规则动量β"))
        if mom is not None:
            beta_n += 1
    # Re-read source screen for 长期侧β vs 规则动量β if present on the comparison file.
    side_equal = 0
    side_n = 0
    src = Path(r"C:\Users\Administrator\Desktop\CTA观察池_产品筛选_3y.csv")
    if src.is_file():
        with src.open(encoding="utf-8-sig", newline="") as handle:
            for raw in csv.DictReader(handle):
                a = num(raw.get("长期侧β"))
                b = num(raw.get("长期规则动量β"))
                if a is None or b is None:
                    continue
                side_n += 1
                if abs(a - b) < 1e-6:
                    side_equal += 1

    horizon_med = {}
    for key in ("短周期", "混合", "中长周期"):
        vals = [share_of(r) for r in rows if r.get("持仓周期") == key and share_of(r) is not None]
        horizon_med[key] = median([v for v in vals if v is not None])

    contain = {}
    for label in L3_ORDER:
        subset = [r for r in comparable if r.get("推断三级策略") == label]
        contain[label] = sum(1 for r in subset if label in tags_of(r.get("团队三级策略") or ""))

    pair = Counter()
    for row in rows:
        if severity(row) not in ("主标签对不上", "团队只覆盖了一部分", "团队策略为空"):
            continue
        team = row.get("团队三级策略") or "（空）"
        pair[(row.get("推断三级策略") or "—", team, row.get("风格簇") or "—")] += 1
    top_pairs = pair.most_common(12)

    unseen = Counter()
    for row in rows:
        for tag in tags_of(row.get("团队三级策略") or ""):
            if tag in UNSEEN:
                unseen[tag] += 1

    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.7)
    section.bottom_margin = Cm(1.7)
    section.left_margin = Cm(1.8)
    section.right_margin = Cm(1.8)
    add_footer(section)

    para(doc, "CTA 观察池因子回归与团队策略标签", size=20, bold=True, color=NAVY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    para(doc, "推断规则、图表与差异分析", size=14, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    para(doc, "样本 120 只  ·  因子文件《CTA观察池_产品筛选_3y》  ·  2026-10-09", size=10, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)

    heading(doc, "一、这份报告在做什么", 1)
    para(
        doc,
        f"观察池里有 {n} 只 CTA 产品做过因子回归。文件已经给出风格簇、持仓周期、主导因子，以及长期侧、规则动量和反转的系数。本报告把这些结果翻译成团队正在使用的三级策略标签，再和库里的团队策略逐只对照。",
    )
    para(
        doc,
        "翻译做的是归类，没有重新跑回归。风格簇、持仓周期、主导因子以文件为准。系数用来核对这三列是否讲得通，并写进每只产品的推断理由。明细在 reports/cta-factor-vs-team-strategy.csv，本报告解释规则和差异的结构。",
    )
    para(
        doc,
        f"可以对照的产品 {len(comparable)} 只。完全一致 {sev['一致']} 只，有差异 {n - sev['一致'] - sev['回归信息不足']} 只，回归字段为空、无法归类 {sev['回归信息不足']} 只。",
    )

    heading(doc, "二、文件里的因子在说什么", 1)
    para(doc, "用到的列和它们在归类里的角色如下。", space_after=4)
    add_table(
        doc,
        ["字段", "在本样本里的含义", "归类时怎么用"],
        [
            ["风格簇", "趋势型、基本面+量价型、趋势+期限结构型、波动率+反转型", "决定经济机制落在哪一族"],
            ["持仓周期", "短周期、混合、中长周期", "决定这本书是单一长趋势，还是风格混在一起，还是偏短"],
            ["主导因子", "中期动量、长期动量、库存、波动", "在风格簇内部指定主驱动"],
            ["长期侧占比", "长期一侧在风格分解里的比重", "核对持仓周期：中长周期高，短周期低"],
            ["长期规则动量β", "规则动量的回归系数", "和反转系数一起看哪一侧更大"],
            ["反转β", "反转暴露", "绝对值相对动量越大，越难记成单一时序"],
        ],
        left_cols={0, 1, 2},
    )
    if side_n:
        para(
            doc,
            f"在原始筛选文件的 {side_n} 只有系数的产品里，长期侧β与长期规则动量β完全相同的有 {side_equal} 只（{side_equal / side_n:.0%}）。长期侧就是规则动量这一腿，长期侧占比是这一腿的权重。反转β是对面的那一腿。",
        )
    para(
        doc,
        "主导因子和系数绝对值有时并不一致。笃诚量化CTA一号A类的主导因子写成中期动量，反转系数绝对值 0.99，规则动量绝对值只有 0.14。归类仍跟文件的主导因子和持仓周期走，系数写进理由，不用更大的反转系数把主导因子改掉。",
    )
    para(
        doc,
        f"持仓周期和长期侧占比是对齐的。短周期中位数 {fmt_pct(horizon_med.get('短周期'))}，混合 {fmt_pct(horizon_med.get('混合'))}，中长周期 {fmt_pct(horizon_med.get('中长周期'))}。所以持仓周期可以直接当成「长期侧集中程度」来用，不必再另画一条 70% 的阈值。",
    )

    add_image(doc, fig1)
    caption(doc, "图 1  风格簇与主导因子。趋势与动量是大头，库存和波动各成一簇。")
    add_image(doc, fig2)
    caption(doc, "图 2  三个持仓周期的长期侧占比。箱体是四分位，点是单只产品，标注为中位数。")
    add_image(doc, fig3)
    caption(doc, "图 3  横轴越高，长期侧越集中；纵轴越高，反转相对动量越强。右下是中长周期的单一风格，左上是短周期。")

    para(doc, "各组合的中位数如下。反转相对强弱 = |反转β| / (|规则动量β| + |反转β|)。", space_before=4)
    add_table(
        doc,
        ["只数", "风格簇", "持仓周期", "主导因子", "长期侧占比中位", "反转相对强弱中位"],
        group_stats(rows),
    )

    heading(doc, "三、怎样从这些因子得到策略", 1)
    para(
        doc,
        "一级固定为期货策略，二级固定为量化期货。这份文件是收益对系统化因子的回归，对应的是量化期货，不是主观交易。三级只从团队已有的词里选一个主标签：时序、混合、基本面、量价、中高频。期限结构没有单独的三级，两套机制同时在的书记为混合。",
    )
    para(doc, "主标签按下面的顺序读取，命中一条即停止。", space_after=4)
    add_table(
        doc,
        ["读取顺序", "看到的因子", "推断三级", "理由"],
        [
            ["1", "风格簇、持仓周期、主导因子都空", "不归类", "没有可翻译的回归结果"],
            ["2", "短周期，且主导因子是库存", "基本面", "经济暴露是库存；短周期只说明做得更勤，频率上同时接近中高频"],
            ["3", "短周期，且主导因子是波动", "量价", "波动和反转是价格因子；频率上同时接近中高频"],
            ["4", "其余短周期", "中高频", "长期侧占比掉下来，反转相对变大，不再是中长周期时序"],
            ["5", "趋势型 + 中长周期 + 动量", "时序", "单一趋势，长期侧占比高，反转相对弱"],
            ["6", "趋势型 + 混合持仓 + 动量", "混合", "动量仍是主导因子，但长期侧只占一半附近，写时序会把书写纯"],
            ["7", "基本面+量价 + 库存 + 中长周期", "基本面", "库存主导，反转系数很小，簇名里的量价没有被反转证实"],
            ["8", "基本面+量价 + 库存 + 混合持仓", "混合", "库存、量价和一半左右的长期侧同时在，主标签用混合"],
            ["9", "趋势+期限结构", "混合", "动量往往很集中，但簇本身不是纯趋势；时序只解释趋势那一侧"],
            ["10", "波动率+反转，中长周期", "量价", "主导因子是波动，不是动量"],
            ["11", "波动率+反转，混合持仓", "量价", "主标签仍是量价；混合持仓记成可以并存的读法，不升成主标签"],
        ],
        left_cols={1, 3},
    )
    para(
        doc,
        "「可以并存的读法」用来判断团队多写的标签算不算回归支持，不用来把主标签放宽。例如短周期的波动产品，主标签是量价，中高频算并存。团队只写中高频，记为「只覆盖了一部分」：频率写到了，价格机制没写到。趋势加期限结构的主标签是混合，时序算并存。团队只写时序，同样记为只覆盖了趋势那一侧。",
    )
    para(
        doc,
        "股指、截面、机器学习、大厂、高频、交易型、商品，这七个词在这份回归里没有对应列。它们出现在团队三级里时，记为回归看不到，不把它读成「标签一定错了」。机器学习说的是做法，大厂说的是管理人，收益回归两者都看不见。",
    )

    heading(doc, "四、120 只产品被推到哪里", 1)
    add_image(doc, fig4, width=5.8)
    caption(doc, "图 4  推断三级。混合最多，其次是时序、基本面和量价。中高频只出现在短周期上，所以只数少。")
    bits = "、".join(f"{k} {deduced[k]} 只" for k in list(L3_ORDER) + ["无法判断"] if deduced.get(k))
    para(doc, f"分布是：{bits}。混合多，是因为趋势加期限结构整簇都记成混合，趋势型里持仓为混合的书也记成混合，基本面加量价里持仓为混合的书同样记成混合。")
    hit_bits = "、".join(f"{k} {contain[k]} 只" for k in L3_ORDER if deduced.get(k))
    para(doc, f"团队三级里已经包含该推断标签的只数：{hit_bits}。这是「写上了主标签」，还没扣除多标的股指、机器学习等词。完全一致还要求一级、二级对齐，并且没有回归看不到的额外三级。")

    heading(doc, "五、和当前标签差在哪里", 1)
    para(doc, "差异分成六档，方便分开处理，而不是把 100 多只都当成同一类错标。", space_after=4)
    add_table(
        doc,
        ["档", "只数", "含义"],
        [
            ["一致", str(sev["一致"]), "一级期货策略、二级量化期货，三级含推断主标签，且没有回归看不到的其他三级"],
            ["主标签一致，另有回归看不到的标签", str(sev["主标签一致，另有回归看不到的标签"]), "时序、混合、基本面或量价已经写上，同时还有股指、机器学习、大厂等"],
            ["团队只覆盖了一部分", str(sev["团队只覆盖了一部分"]), "团队写到了并存读法，没有写上主标签"],
            ["主标签对不上", str(sev["主标签对不上"]), "团队三级里既没有主标签，也没有并存读法"],
            ["团队策略为空", str(sev["团队策略为空"]), "回归能归类，团队三级或二级是空的"],
            ["一级或二级不一致", str(sev["一级或二级不一致"]), "团队不是量化期货"],
            ["回归信息不足", str(sev["回归信息不足"]), "风格簇、持仓周期、主导因子都空"],
        ],
        left_cols={0, 2},
    )
    add_image(doc, fig5, width=6.5)
    caption(doc, "图 5  左：差异分档。右：每个推断三级里，团队有没有把这个词写进三级。")

    para(doc, "只数至少为 2 的差异组合如下。同一风格簇、同一推断、同一团队三级算一组。", space_before=6)
    add_table(
        doc,
        ["只数", "风格簇", "推断三级", "团队三级"],
        [[str(v), k[2], k[0], k[1]] for k, v in top_pairs],
        left_cols={1, 3},
    )

    heading(doc, "六、五组值得分开看的差异", 1)
    heading(doc, "6.1 纯趋势被写成混合", 2)
    para(
        doc,
        "趋势型、中长周期、动量主导的书，长期侧占比中位数在八成以上，反转相对动量弱，主标签是时序。其中一批团队三级写成混合。混合在团队词表里比时序宽：它允许好几套机制并存。回归这一侧给出的是集中的趋势暴露。这类差异是粒度，优先核对的是「这本中长周期趋势书是否还另有团队知道、回归没分开的子策略」。若没有，三级收成时序更贴这列因子。",
    )
    heading(doc, "6.2 库存被写成时序或截面", 2)
    para(
        doc,
        "基本面+量价、中长周期、主导因子为库存的书，反转系数中位数很小，主标签是基本面。团队写成时序，等于用动量标签去对库存因子。写成截面或股指，用的是这份回归里没有的维度。中长周期这一档不把量价算成并存读法，因为反转没有起来，簇名里的「量价」还停在名字上。",
    )
    heading(doc, "6.3 趋势加期限结构被写成股指或中高频", 2)
    para(
        doc,
        "这一簇的主导因子仍是中期动量，长期侧占比同样很高，所以它不是短线，也不是股指。主标签用混合，是因为风格簇明确写成趋势加期限结构，而三级词表没有「期限结构」。团队若只写时序，趋势那一侧是对的，期限结构没被写上，所以落在「只覆盖了一部分」，不落在完全一致。团队若写股指或中高频，则和持仓周期、主导因子两边都不贴。",
    )
    heading(doc, "6.4 波动和反转被写成时序、股指或截面", 2)
    para(
        doc,
        "波动率+反转型的主导因子是波动。中长周期记量价，混合持仓也记量价。时序要求动量主导，股指和截面在这张表里没有列。短周期的波动产品主标签仍是量价，中高频只作为频率上的并存读法。团队只写中高频时，频率对上了，波动这一个因子没有写上。",
    )
    heading(doc, "6.5 二级从量化期货写成主观期货", 2)
    para(
        doc,
        "晨翰桑榆1号是样本里唯一的二级差异。风格簇是趋势+期限结构，持仓中长周期，主导因子是中期动量，推断为期货策略 / 量化期货 / 混合。团队标签是主观期货 / 交易型。因子文件描述的是系统化暴露。若这本产品的交易确实由主观下单完成，标签可以维持主观，但应和这列回归分开存放，避免用主观交易型去解释一段趋势加期限结构的收益回归。",
    )

    heading(doc, "七、回归看不到的团队标签", 1)
    add_image(doc, fig6, width=5.8)
    unseen_bits = "、".join(f"{k} {v} 只" for k, v in unseen.most_common()) or "无"
    caption(doc, "图 6  这些词在团队三级里出现的产品数。一份产品可以同时带多个词，所以柱子相加会大于产品数。")
    para(doc, f"出现次数：{unseen_bits}。")
    para(
        doc,
        "这张图适合做「标签里哪些话，这份回归没有资格改」。大厂和机器学习是管理人和方法，收益对动量、库存、波动的回归不会出现这两列。股指和截面有可能是真的策略特征，只是本次因子集合没覆盖，不能凭本表删掉。高频比文件里的短周期更短，短周期产品也没有被推成高频。",
    )

    heading(doc, "八、八只产品怎么读", 1)
    para(doc, "下面每只产品用同一套规则走一遍。数字来自对照表，读法说明这一档差异该怎么用。")
    notes = [
        ("子辰稳富1号", "两边对齐的参照。趋势簇、中长周期、中期动量，团队三级就是时序。"),
        ("华澄二号", "和子辰同一类趋势暴露，团队写成混合。长期侧占比超过九成，混合把这本中长周期趋势书写宽了。"),
        ("中舍钱江一号CTA", "库存主导，长期侧占比很高，反转系数很小，推断基本面。团队三级是混合，库存这一个因子没有写出来。"),
        ("辰元进取5号", "主导因子是库存，持仓为混合，推断混合，基本面和量价可以并存。团队三级是时序，对的是动量，对不上库存。"),
        ("均成CTA1号", "推断基本面。团队三级是大厂、股指、截面。三词都不在本次因子集合里，基本面也没写上。"),
        ("SAP智龙明斯基一号", "波动主导、混合持仓，推断量价。团队是截面和机器学习。"),
        ("七禾科技传奇智丽81号", "短周期、波动主导，主标签量价，中高频是频率上的并存读法。团队只写了中高频。"),
        ("晨翰桑榆1号", "唯一的二级差异：回归是量化期货 / 混合，团队是主观期货 / 交易型。"),
    ]
    by_name = {r["产品名称"]: r for r in rows}
    for index, (name, comment) in enumerate(notes, start=1):
        row = by_name.get(name)
        if not row:
            continue
        team = "/".join(
            x for x in (row.get("团队一级策略"), row.get("团队二级策略"), row.get("团队三级策略")) if x
        ) or "—"
        heading(doc, f"8.{index} {name}", 2)
        para(
            doc,
            "风格簇 {cluster}，持仓 {horizon}，主导因子 {factor}，长期侧占比 {share}，规则动量β {mom}，反转β {rev}。推断 {l1} / {l2} / {l3}。团队标签 {team}。差异档：{kind}。".format(
                cluster=row.get("风格簇") or "—",
                horizon=row.get("持仓周期") or "—",
                factor=row.get("主导因子") or "—",
                share=row.get("长期侧占比") or "—",
                mom=row.get("长期规则动量β") or "—",
                rev=row.get("反转β") or "—",
                l1=row.get("推断一级策略") or "—",
                l2=row.get("推断二级策略") or "—",
                l3=row.get("推断三级策略") or "—",
                team=team,
                kind=row.get("差异类型") or "—",
            ),
            size=10,
        )
        para(doc, comment)

    heading(doc, "九、回归字段为空的产品", 1)
    para(doc, f"{len(blank)} 只产品的风格簇、持仓周期、主导因子都是空的，本报告不给三级，也不把现有团队标签判对或判错。", space_after=4)
    if blank:
        add_table(
            doc,
            ["产品", "备案号", "现有团队策略"],
            [
                [
                    r["产品名称"],
                    r.get("备案号") or "—",
                    "/".join(x for x in (r.get("团队一级策略"), r.get("团队二级策略"), r.get("团队三级策略")) if x) or "—",
                ]
                for r in blank
            ],
            left_cols={0, 2},
        )

    heading(doc, "十、使用这份对照时的边界", 1)
    para(doc, "归类跟的是文件已经算好的三列，不是一套新的回归模型。主导因子和更大的系数冲突时，以文件的主导因子为准，冲突写在推断理由里。")
    para(doc, "原始筛选文件的 R² 和可靠性两列是空的，本报告不能按拟合好坏给产品加权，也不能说某一只的β「显著」。")
    para(doc, "团队三级经常是多个词。本报告只要求主标签出现在其中，并存读法用来识别「写到了一部分」。完全一致还排除了股指、机器学习、大厂这类回归看不见的词。因此「有差异」包含两种工作：改主标签，以及决定额外词留不留。")
    para(doc, "期限结构被收成混合，是词表里没有对应三级，不是回归证明这些产品的交易指令是「混合策略」。核对时若团队内部有更细的期限结构口径，应加在混合旁边，而不是改回纯时序。")
    para(doc, "产品按名称匹配团队跟踪记录，并用家族码核对备案号。同名多条时取家族码能对上、且更新时间最新的一条。")
    para(
        doc,
        "建议的核对顺序：先看一级或二级不一致和「主标签对不上」里库存对时序、波动对股指这两格；再看纯趋势被写成混合；最后再处理多出来的大厂和机器学习。回归字段为空的 7 只先补因子结果，再参加对照。",
        space_after=4,
    )

    para(doc, "附：数据", size=12, bold=True, color=NAVY, space_before=8)
    para(doc, "因子来源：桌面《CTA观察池_产品筛选_3y.csv》。团队策略：跟踪记录中的公司策略一级、二级、三级。对照明细：reports/cta-factor-vs-team-strategy.csv。", size=9, color=MUTED)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT_PATH)
    print(f"wrote {OUT_PATH}")
    print(f"rows {n} match {sev['一致']} blank {sev['回归信息不足']}")


if __name__ == "__main__":
    build()
