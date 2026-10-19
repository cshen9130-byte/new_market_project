# -*- coding: utf-8 -*-
"""Build the FOF99 vs local strategy-observation comparison report."""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor, Emu

ROOT = Path(r"d:\coding\market_website")
OUT_DIR = ROOT / "docs"
CHART_DIR = OUT_DIR / "strategy-observation-compare-charts"
DOC_PATH = OUT_DIR / "策略观察与火富牛对照分析.docx"

font_path = r"C:\Windows\Fonts\msyh.ttc"
font_manager.fontManager.addfont(font_path)
plt.rcParams["font.family"] = "Microsoft YaHei"
plt.rcParams["axes.unicode_minus"] = False

# category, fof n, mean, p10, p25, p50, p75, p90, pos
# Screenshot: 火富牛 近一年，统计截止 2026-05-22. Two reads of the same table agreed.
FOF = {
    "股票市场中性": (603, 4.70, 12.70, 9.27, 4.91, 0.71, -1.11, 71.61),
    "1000指增": (665, 13.82, 25.27, 21.13, 14.02, 7.14, 1.68, 92.78),
    "500指增": (791, 14.25, 25.05, 21.01, 13.57, 8.10, 2.65, 93.54),
    "300指增": (182, 12.14, 19.85, 17.28, 12.57, 7.57, 2.67, 94.51),
    "A500指增": (193, 12.20, 21.79, 17.80, 11.52, 7.50, 3.03, 96.40),
    "2000指增": (178, 18.48, 30.40, 25.44, 18.44, 11.55, 5.91, 96.07),
    "量化选股": (673, 13.02, 26.12, 20.08, 12.47, 2.46, -6.80, 80.09),
    "主观多头": (1854, 1.67, 26.29, 13.37, 1.17, -13.80, -20.51, 53.73),
    "量化期货": (185, 14.56, 34.32, 25.49, 12.47, 3.45, -1.44, 88.41),
    "主观期货": (305, 16.24, 42.41, 26.81, 12.10, 4.50, -1.45, 88.85),
    "期货策略": (1156, 14.20, 35.40, 24.34, 13.41, 1.75, -1.91, 88.70),
    "股票对冲": (959, 5.16, 14.28, 9.78, 5.38, 0.28, -2.88, 76.98),
    "套利策略": (551, 6.67, 14.61, 8.67, 6.12, 3.17, -0.41, 88.20),
    "期权策略": (284, 5.08, 15.52, 8.08, 4.81, 1.81, -0.89, 81.80),
    "多资产策略": (993, 7.49, 22.09, 15.01, 7.30, 0.00, -4.92, 74.55),
    "债券策略": (498, 3.09, 6.80, 4.97, 3.01, 1.44, -0.74, 87.55),
    "组合策略": (1110, 4.70, 13.14, 7.77, 3.82, 1.27, -1.88, 84.59),
    "可转债多头": (161, 2.58, 8.17, 5.09, 2.85, 1.05, -0.01, 90.40),
}

# Local API, cutoff 2026-10-08. Same page as the 2026-10-03 screenshot.
OURS = {
    "股票市场中性": (230, 4.85, 14.60, 10.03, 4.54, -0.53, -3.94, 70.87),
    "1000指增": (198, 15.94, 31.44, 18.42, 13.13, 7.96, 1.81, 91.41),
    "500指增": (169, 20.67, 57.71, 24.76, 14.11, 8.70, 1.85, 91.12),
    "300指增": (64, 12.52, 19.23, 14.86, 12.90, 6.56, -0.74, 87.50),
    "A500指增": (58, 10.05, 18.86, 16.72, 10.12, 3.84, 0.43, 93.10),
    "量化选股": (72, 6.28, 24.12, 14.74, 9.61, -0.15, -22.96, 72.22),
    "主观多头": (891, 7.25, 43.03, 14.77, 2.12, -11.25, -18.78, 54.66),
    "量化期货": (329, 12.41, 31.29, 19.75, 10.70, 2.96, -3.41, 81.16),
    "主观期货": (159, 16.55, 37.97, 22.48, 10.71, 2.89, -3.19, 83.65),
    "期货策略": (556, 12.84, 32.14, 19.75, 10.27, 2.89, -3.77, 81.47),
    "股票对冲": (426, 6.61, 17.46, 11.73, 5.36, 0.10, -3.82, 75.82),
    "套利策略": (225, 7.25, 15.73, 10.23, 6.49, 2.67, -0.02, 89.78),
    "期权策略": (128, 7.23, 16.68, 9.73, 5.36, 1.50, -2.58, 82.03),
    "多资产策略": (612, 7.18, 20.64, 13.80, 6.29, 0.42, -7.30, 76.31),
    "债券策略": (109, 2.88, 7.86, 5.23, 3.44, 0.63, -3.24, 80.73),
    "组合策略": (209, 5.15, 14.44, 12.01, 4.65, 0.40, -4.86, 77.51),
    "可转债多头": (88, 5.00, 14.55, 9.68, 4.03, -0.57, -4.86, 71.59),
}

ORDER = [
    "股票市场中性", "1000指增", "500指增", "300指增", "A500指增",
    "量化选股", "主观多头", "量化期货", "主观期货", "期货策略",
    "股票对冲", "套利策略", "期权策略", "多资产策略", "债券策略",
    "组合策略", "可转债多头",
]

# Six aligned weeks. FOF labels are Fridays; ours are the Monday of the same week.
WEEKS = ["1/9", "1/16", "1/23", "1/30", "2/6", "2/13"]
WEEKLY = {
    "1000指增": {
        "fof": [6.25, 1.51, 3.86, -2.52, -1.11, 1.83],
        "ours": [6.23, 1.60, 3.95, -2.47, -1.12, 1.62],
    },
    "A500指增": {
        "fof": [4.07, 0.39, 1.71, -0.66, -1.03, 0.91],
        "ours": [3.84, 0.55, 1.60, -0.74, -1.22, 0.80],
    },
    "多资产策略": {
        "fof": [3.00, 1.11, 2.05, 0.16, -2.27, 0.78],
        "ours": [3.61, 1.21, 2.20, 0.44, -2.65, 0.82],
    },
    "股票市场中性": {
        "fof": [-0.48, -0.18, 0.23, -0.15, 0.75, 0.75],
        "ours": [0.35, 0.17, 0.82, -0.39, 0.49, 0.29],
    },
    "500指增": {
        "fof": [5.95, 1.34, 3.73, -2.15, -1.24, 1.53],
        "ours": [6.07, 1.58, 3.87, -2.16, -1.42, 1.50],
        "note": "1月30日火富牛单元格截图呈红色，读数可能是 +2.15。同周 1000指增为 -2.52，且与我们的 -2.16 只差 0.01，本图按同号 -2.15 绘制。",
    },
    "量化选股": {
        "fof": [4.60, 1.24, 3.59, -1.98, -0.33, 0.96],
        "ours": [5.26, 0.95, 3.77, -2.06, -0.39, 0.93],
        "note": "1月9日火富牛单元格的负号不够清楚。按正收益 4.60 才与当周指增大涨一致，后五周则不依赖这个假设。",
    },
}


def grade(name: str) -> str:
    if name not in OURS:
        return "缺失"
    med = abs(OURS[name][4] - FOF[name][4])
    pos = abs(OURS[name][7] - FOF[name][7])
    if med <= 1.0 and pos <= 4:
        return "好"
    if med <= 2.0 and pos <= 8:
        return "较好"
    if med <= 3.2:
        return "一般"
    return "较差"


GRADE_COLOR = {
    "好": "#2e7d32",
    "较好": "#7cb342",
    "一般": "#f9a825",
    "较差": "#c62828",
    "缺失": "#757575",
}


def mae(a, b):
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def set_run_font(run, name="微软雅黑", size=11, bold=False, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = RGBColor(*color)


def shade_cell(cell, hex_color):
    tc = cell._tePr if hasattr(cell, "_tePr") else cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), hex_color)
    shd.set(qn("w:val"), "clear")
    tcPr.append(shd)


def set_cell_border(cell):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:color"), "D0D0D0")
        tcBorders.append(el)
    tcPr.append(tcBorders)


def write_cell(cell, text, bold=False, size=9, align="center", fill=None, color=None):
    cell.text = ""
    p = cell.paragraphs[0]
    p.alignment = {
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
    }[align]
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after = Pt(1)
    run = p.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color)
    if fill:
        shade_cell(cell, fill)
    set_cell_border(cell)


def add_para(doc, text, size=11, bold=False, space_after=8, space_before=0, color=None, align="left"):
    p = doc.add_paragraph()
    p.alignment = {
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
    }[align]
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.line_spacing = 1.15
    run = p.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color)
    return p


def add_heading_cn(doc, text, level=1):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14 if level == 1 else 10)
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(text)
    if level == 1:
        set_run_font(run, size=16, bold=True, color=(183, 28, 28))
    else:
        set_run_font(run, size=13, bold=True, color=(33, 33, 33))
    return p


def add_picture(doc, path, width_cm=16.2):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run()
    run.add_picture(str(path), width=Cm(width_cm))


def caption(doc, text):
    add_para(doc, text, size=9, color=(100, 100, 100), space_after=10, align="center")


def build_charts():
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    names = list(reversed(ORDER))
    fof_med = [FOF[n][4] for n in names]
    our_med = [OURS[n][4] for n in names]
    fof_mean = [FOF[n][1] for n in names]
    our_mean = [OURS[n][1] for n in names]
    fof_n = [FOF[n][0] for n in names]
    our_n = [OURS[n][0] for n in names]
    y = range(len(names))

    def hbars(path, left, right, xlabel, title):
        fig, ax = plt.subplots(figsize=(10.2, 7.2), dpi=140)
        h = 0.38
        ax.barh([i + h / 2 for i in y], left, height=h, color="#c62828", label="火富牛（截止 2026-05-22）")
        ax.barh([i - h / 2 for i in y], right, height=h, color="#1565c0", label="本系统（截止 2026-10-08）")
        ax.set_yticks(list(y))
        ax.set_yticklabels(names, fontsize=10)
        ax.set_xlabel(xlabel, fontsize=10)
        ax.set_title(title, fontsize=13, pad=10, loc="left")
        ax.axvline(0, color="#9e9e9e", lw=0.6)
        ax.legend(frameon=False, fontsize=9, loc="lower right")
        ax.grid(axis="x", color="#eeeeee")
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        fig.tight_layout()
        fig.savefig(path, bbox_inches="tight", facecolor="white")
        plt.close()

    hbars(CHART_DIR / "median.png", fof_med, our_med, "近一年收益 50% 分位（%）", "近一年收益中位数：多数类别中心是对齐的")
    hbars(CHART_DIR / "mean.png", fof_mean, our_mean, "近一年收益平均值（%）", "近一年收益平均值：500指增、量化选股、主观多头被尾部拉开")

    fig, ax = plt.subplots(figsize=(10.2, 7.2), dpi=140)
    h = 0.38
    ax.barh([i + h / 2 for i in y], fof_n, height=h, color="#c62828", label="火富牛")
    ax.barh([i - h / 2 for i in y], our_n, height=h, color="#1565c0", label="本系统")
    ax.set_yticks(list(y))
    ax.set_yticklabels(names, fontsize=10)
    ax.set_xlabel("指标分布样本量（只）", fontsize=10)
    ax.set_title("样本量：本系统多数类别只有火富牛的两到四成", fontsize=13, pad=10, loc="left")
    ax.legend(frameon=False, fontsize=9)
    ax.grid(axis="x", color="#eeeeee")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    fig.savefig(CHART_DIR / "sample.png", bbox_inches="tight", facecolor="white")
    plt.close()

    fig, ax = plt.subplots(figsize=(7.6, 6.6), dpi=140)
    xs = [FOF[n][4] for n in ORDER]
    ys = [OURS[n][4] for n in ORDER]
    for n, x, yv in zip(ORDER, xs, ys):
        g = grade(n)
        ax.scatter(x, yv, s=46, color=GRADE_COLOR[g], zorder=3)
        ax.annotate(n, (x, yv), textcoords="offset points", xytext=(4, 3), fontsize=8, color="#424242")
    lo = min(xs + ys) - 1.5
    hi = max(xs + ys) + 1.5
    ax.plot([lo, hi], [lo, hi], color="#bdbdbd", lw=1, ls="--")
    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    ax.set_xlabel("火富牛 50% 分位（%）", fontsize=10)
    ax.set_ylabel("本系统 50% 分位（%）", fontsize=10)
    ax.set_title("中位数越靠近虚线，类别越对齐", fontsize=13, pad=10, loc="left")
    ax.grid(color="#f5f5f5")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    fig.savefig(CHART_DIR / "scatter.png", bbox_inches="tight", facecolor="white")
    plt.close()

    fig, axes = plt.subplots(2, 2, figsize=(10.2, 6.6), dpi=140, sharex=True)
    picks = ["1000指增", "A500指增", "多资产策略", "股票市场中性"]
    for ax, name in zip(axes.ravel(), picks):
        ax.plot(WEEKS, WEEKLY[name]["fof"], color="#c62828", marker="o", ms=4.5, lw=1.6, label="火富牛（周五标签）")
        ax.plot(WEEKS, WEEKLY[name]["ours"], color="#1565c0", marker="s", ms=4, lw=1.6, label="本系统（同周周一）")
        err = mae(WEEKLY[name]["fof"], WEEKLY[name]["ours"])
        ax.set_title(f"{name}   六周平均绝对差 {err:.2f} 个百分点", fontsize=10, loc="left")
        ax.axhline(0, color="#e0e0e0", lw=0.8)
        ax.grid(color="#f5f5f5")
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.tick_params(labelsize=8)
    axes[0, 0].legend(frameon=False, fontsize=8, loc="upper right")
    fig.suptitle("2026 年 1–2 月同周收益：指增和多资产贴得很紧，市场中性单周对不齐", fontsize=12, x=0.02, ha="left")
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    fig.savefig(CHART_DIR / "weekly.png", bbox_inches="tight", facecolor="white")
    plt.close()


def build_doc():
    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.left_margin = Cm(1.7)
    section.right_margin = Cm(1.7)
    section.top_margin = Cm(1.6)
    section.bottom_margin = Cm(1.6)
    style = doc.styles["Normal"]
    style.font.name = "微软雅黑"
    style.font.size = Pt(11)
    style._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")

    add_para(doc, "策略观察与火富牛对照", size=22, bold=True, color=(183, 28, 28), space_after=2, align="left")
    add_para(doc, "指标分布（收益分位）与分类周收益", size=14, color=(80, 80, 80), space_after=2)
    add_para(doc, "对照日期 2026-10-09    火富牛页面 mp.fof99.com/macro/strategy    本系统策略观察", size=9, color=(120, 120, 120), space_after=8)

    add_heading_cn(doc, "一、结论", 1)
    add_para(
        doc,
        "本系统已经能复现火富牛策略观察的主体形状。判断标准以近一年收益的 50% 分位和正收益比例为主，平均值单独看会被少数极端产品拉开。按这个标准，17 个两边都有的类别里，8 个为好，5 个为较好，2 个为一般，2 个为较差。",
        align="justify",
    )
    add_para(
        doc,
        "好：股票市场中性、1000指增、500指增（看中位数）、股票对冲、套利策略、期权策略、多资产策略。这几类的中位数差在 1 个百分点以内，正收益比例差在 3 个百分点以内。1000指增在 2026 年 1 月到 2 月的六周等权收益，和火富牛平均只差 0.08 个百分点。",
        align="justify",
    )
    add_para(
        doc,
        "较好：300指增、A500指增、主观多头、主观期货、债券策略。中心还在，但正收益比例、左尾或周度幅度有可见偏差。A500指增的周收益和火富牛一样贴，近一年中位数低约 1.4 个百分点。",
        align="justify",
    )
    add_para(
        doc,
        "一般：量化期货、期货策略、组合策略。方向对，中位数低 1.8 到 3.1 个百分点，正收益比例低约 7 个百分点。期货策略和组合策略的样本大约只有火富牛的一半和五分之一。",
        align="justify",
    )
    add_para(
        doc,
        "较差：量化选股、可转债多头。量化选股近一年平均值 6.28%，火富牛 13.02%，90% 分位到了 -22.96%（火富牛 -6.80%），指标样本只有 72 只，约为对方的一成。可转债多头正收益比例 71.59%，火富牛 90.40%，右尾明显更肥。",
        align="justify",
    )
    add_para(
        doc,
        "另外有三类不能直接比。火富牛有 2000指增，本系统没有这一行。本系统的「股票多头」是一级大类汇总，火富牛不单列。本系统的「量化精选」与量化选股完全同数，「主观精选」与主观多头完全同数，是别名重复行，会把表底的中位数和平均值带偏。",
        align="justify",
    )

    add_heading_cn(doc, "二、对照口径", 1)
    add_para(
        doc,
        "火富牛数字来自本次提供的页面截图。收益分位表的统计截止日是 2026-05-22，同一张表读了两遍，18 行数字一致。本系统数字来自与截图同一页面的接口，统计截止 2026-10-08；截图上写的是 2026-10-03。1000指增平均值 15.94%、正收益比例 91.41% 与截图相同。股票市场中性样本量截图约为 250，刷新后为 230，属于这几日净值覆盖变化，不改变下面的判断。",
        align="justify",
    )
    add_para(
        doc,
        "两边的「10% 分位」都是从高到低排的较优一侧，90% 分位是较差一侧。收益分位表比的是绝对收益，不是超额。两边都是分类内等权，不按规模加权。",
        align="justify",
    )
    add_para(
        doc,
        "有两个口径差必须先说清楚，否则会把「对得上」误读成「对不上」。第一，近一年窗口不一致：火富牛截到 2026-05-22，本系统截到 2026-10-08，相差约四个半月。中位数差在 1 到 2 个百分点以内，有一部分可以来自窗口移动，不必当成分类错误。第二，周收益的列标签相差四天：火富牛标周五（2026-01-09），本系统用周一（2026-01-05），是同一周。火富牛截图里「全年」一列是空的，本系统有全年年初至今等权收益，这一列本次无法对照。本系统周表右侧的「胜率」是等权周收益为正的周数占比，多数类别落在 47%–60%，和近一年「正收益比例」不是同一个数。",
        align="justify",
    )

    add_heading_cn(doc, "三、近一年收益分布", 1)
    add_para(
        doc,
        "下图横轴是 50% 分位。红色是火富牛，蓝色是本系统。股票市场中性、300指增、500指增、股票对冲、套利、期权几乎重合。量化选股明显偏左，主观多头略偏右，期货策略和量化期货偏低。",
        align="justify",
    )
    add_picture(doc, CHART_DIR / "median.png")
    caption(doc, "图 1  近一年收益 50% 分位对照")

    add_para(
        doc,
        "散点图把同一个结论收成一张图。点落在虚线上表示中位数相同。量化选股离开虚线最远，可转债次之。其余类别沿虚线排开。",
        align="justify",
    )
    add_picture(doc, CHART_DIR / "scatter.png", width_cm=12.6)
    caption(doc, "图 2  50% 分位散点。绿为好或较好，黄为一般，红为较差")

    add_para(
        doc,
        "平均值没有中位数稳。500指增中位数只差 0.54 个百分点（14.11% 对 13.57%），平均值却差 6.42 个百分点（20.67% 对 14.25%）。原因是本系统 10% 分位到了 57.71%，而截图当天这一格更接近 37.7%，中位数两次都是 14.11%。右尾会随几天的样本进出跳动，不适合单独用来验收。主观多头也是同一类现象：中位数 2.12% 对 1.17%，正收益比例 54.66% 对 53.73%，平均值却是 7.25% 对 1.67%，因为 10% 分位有 43.03%，火富牛是 26.29%。",
        align="justify",
    )
    add_picture(doc, CHART_DIR / "mean.png")
    caption(doc, "图 3  近一年收益平均值对照。500指增、主观多头、量化选股是主要缺口")

    add_picture(doc, CHART_DIR / "sample.png")
    caption(doc, "图 4  指标分布样本量。量化期货是少数本系统样本更多的类别")

    add_heading_cn(doc, "四、分类判断", 1)
    add_para(doc, "下表「差」= 本系统 − 火富牛，单位为个百分点。样本比 = 本系统样本量 / 火富牛样本量。", size=10, space_after=4)

    headers = ["分类", "判断", "样本比", "中位数差", "平均值差", "正收益差", "本系统中位数", "火富牛中位数"]
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    for i, h in enumerate(headers):
        write_cell(table.rows[0].cells[i], h, bold=True, size=8, fill="FDECEC")
    fill_for = {"好": "E8F5E9", "较好": "F1F8E9", "一般": "FFF8E1", "较差": "FFEBEE"}
    for name in ORDER:
        f, o = FOF[name], OURS[name]
        g = grade(name)
        vals = [
            name,
            g,
            f"{o[0] / f[0] * 100:.0f}%",
            f"{o[4] - f[4]:+.2f}",
            f"{o[1] - f[1]:+.2f}",
            f"{o[7] - f[7]:+.2f}",
            f"{o[4]:.2f}%",
            f"{f[4]:.2f}%",
        ]
        row = table.add_row()
        for i, val in enumerate(vals):
            write_cell(row.cells[i], val, size=8, fill=fill_for[g], align="center" if i else "left", bold=(i == 1))
    miss = table.add_row()
    write_cell(miss.cells[0], "2000指增", size=8, fill="F5F5F5", align="left")
    write_cell(miss.cells[1], "缺失", size=8, fill="F5F5F5", bold=True)
    for i in range(2, 8):
        write_cell(miss.cells[i], "—" if i > 2 else "火富牛 178 只，本系统无此行", size=8, fill="F5F5F5")
    # merge the long note across remaining cells is awkward; leave as is with text only in col 2
    miss.cells[2].text = ""
    write_cell(miss.cells[2], "0%", size=8, fill="F5F5F5")

    add_para(doc, "", size=6, space_after=4)
    add_para(doc, "表 1  可比类别的近一年中心对照。判断规则：好 = 中位数差不超过 1 个百分点且正收益比例差不超过 4 个百分点；较好 = 中位数差不超过 2 且正收益比例差不超过 8；一般 = 中位数差不超过 3.2；其余为较差。", size=9, color=(100, 100, 100))

    add_heading_cn(doc, "五、为什么有的类别对齐、有的不对齐", 2)
    add_para(doc, "1. 指增和多资产：标签清楚，所以中心和周收益都贴", size=12, bold=True, space_after=4)
    add_para(
        doc,
        "1000、500、300、A500 的标签规则是二级策略名或产品名里的「指增 / 指数增强」。这类名字歧义小。1000指增六周平均绝对差 0.08 个百分点，A500指增 0.15 个百分点。500指增除 1 月 30 日那一格的符号在截图上不够清楚外，其余五周也在 0.2 个百分点以内。多资产策略六周平均绝对差 0.26 个百分点，近一年中位数差 1.01 个百分点。样本虽然只有火富牛的两到四成，等权之后的中心已经稳定。",
        align="justify",
    )
    add_para(
        doc,
        "500指增平均值偏高，是清洗之后仍留下一批一年收益很高的产品。指标清洗先丢掉绝对值超过 250% 的点，样本不少于 20 只时再去掉上下各 1%。10% 分位仍能到 50% 以上，说明极端值没有被去掉。火富牛的可投资样本和更紧的尾部处理，会把平均值压回中位数附近。验收这一类时看中位数和正收益比例，不看平均值。",
        align="justify",
    )
    add_para(doc, "2. 市场中性、对冲、套利、期权：一年分布对齐，单周会被小样本放大", size=12, bold=True, space_before=8, space_after=4)
    add_para(
        doc,
        "股票市场中性近一年平均值 4.85% 对 4.70%，中位数 4.54% 对 4.91%，正收益比例 70.87% 对 71.61%，是全表最稳的一类。周收益对不齐：前六周平均绝对差约 0.46 个百分点，而这一类一周往往只有零点几个点，第一周甚至符号相反（本系统 +0.35%，火富牛 -0.48%）。指标样本 230 对 603，周收益样本 471 对对方更大的池子。等权平均在低波动策略上对个别净值跳变很敏感。股票对冲的中位数几乎相同（5.36% 对 5.38%），周序列同样更抖。",
        align="justify",
    )
    add_para(
        doc,
        "套利策略的近一年中位数 6.49% 对 6.12%，正收益比例 89.78% 对 88.20%。周序列则明显更抖，火富牛前六周多在 +0.2% 到 +0.3% 且几乎没有负周，所以对方周胜率能到九成左右，本系统周胜率约 60%。本系统把一级为「套利」或二级名称含「套利」的产品都放进来，容易混入带股票敞口的套利；火富牛这一行更像清理过的套利池。分布中心对，周路径还不能当作业已对齐。",
        align="justify",
    )
    add_para(doc, "3. 量化选股和可转债：规则太窄，而且会吸进别的产品", size=12, bold=True, space_before=8, space_after=4)
    add_para(
        doc,
        "量化选股要求二级是「量化选股 / 量化多头 / 量化精选」，或产品名命中这些词，同时排除指数增强、主观多头、可转债多头。火富牛有 673 只，本系统指标样本 72 只、周样本 185 只。留下的池子左尾很重，90% 分位 -22.96%，火富牛是 -6.80%，正收益比例 72.22% 对 80.09%。周收益后五周仍然接近，说明等权周序列被 185 只产品稀释后还能跟着市场走，一年期截面则被少数异常净值主导。这一类要补的是分类覆盖和一年收益的异常值，不是周收益公式。",
        align="justify",
    )
    add_para(
        doc,
        "可转债多头要求二级就是「可转债多头」，或者产品名含转债、一级是股票多头、且名称里没有套利和指增。后一条会把名字里带「转债」的股票产品放进来。结果是中位数 4.03% 对 2.85%，10% 分位 14.55% 对 8.17%，正收益比例 71.59% 对 90.40%。右尾更像股票，不像转债。",
        align="justify",
    )
    add_para(doc, "4. 期货和组合：覆盖不完整，量化期货则是另一头", size=12, bold=True, space_before=8, space_after=4)
    add_para(
        doc,
        "主观期货平均值 16.55% 对 16.24%，算较好；中位数仍低 1.39 个百分点，周收益同向但幅度更大（2 月初那周 -4.34% 对 -1.17%）。量化期货样本 329 只，反而多于火富牛的 185 只，因为规则包含「量化CTA、程序化期货」。中位数低 1.77 个百分点，正收益比例低 7.25 个百分点，多出来的产品把分布拉宽了。期货策略按一级「期货策略 / 管理期货 / CTA」归桶，556 只对 1156 只，中位数低 3.14 个百分点。组合策略只收一级「组合策略」或二级 FOF、MOM，209 只对 1110 只，正收益比例 77.51% 对 84.59%。这三类是池子边界问题，不是计算公式问题。",
        align="justify",
    )
    add_para(doc, "5. 债券：产品在，一年指标不在", size=12, bold=True, space_before=8, space_after=4)
    add_para(
        doc,
        "债券策略周收益样本有 585 只，和火富牛指标样本 498 只接近；一进收益分位表就只剩 109 只。收益分位用的是产品页上已经算好的近一年收益，没有这个字段的产品不会进入表。中位数仍然接近（3.44% 对 3.01%），正收益比例低 6.82 个百分点，90% 分位 -3.24% 对 -0.74%。有一年收益的债券产品是一个更波动的子集。",
        align="justify",
    )
    add_para(doc, "6. 重复行、缺失行、以及超额基准", size=12, bold=True, space_before=8, space_after=4)
    add_para(
        doc,
        "量化精选与量化选股、主观精选与主观多头、量化多头与量化选股，三组数字完全相同。它们来自同一套别名规则，在表上占了额外的行，表底「中位数、平均值」又把这些行再算进去，等于同一批产品算了两次。股票多头按一级「股票多头 / 股票策略」归桶，指标样本 2386 只，和指增、量化选股、主观多头重叠，火富牛的指标表没有对应行，不能拿去对某一条火富牛策略。2000指增火富牛有 178 只，近一年平均值 18.48%、中位数 18.44%，本系统分类列表里没有这一项。",
        align="justify",
    )
    add_para(
        doc,
        "本次截图是绝对收益。若打开超额，A500指增、量化选股、主观多头、股票多头、多资产、组合、可转债目前都减去沪深 300 股指（IF），A500 并没有用中证 A500。1000 用 IM，500 用 IC，300 用 IF，期货用南华商品，债券用国债 ETF。绝对收益对得上的类别，超额仍可能因为基准选错而分开。市场中性、套利、股票对冲、期权没有配基准，超额等于绝对收益。",
        align="justify",
    )

    add_heading_cn(doc, "六、周收益抽查", 1)
    add_para(
        doc,
        "下面六周是两边截图都能读清的第一段。横轴用火富牛的周五日期，蓝线是本系统同一周（周一标签）。1000指增和 A500指增可以当作「公式和净值归周是对的」的证据。市场中性说明：一年分布对齐，并不自动得到每一周都对齐。",
        align="justify",
    )
    add_picture(doc, CHART_DIR / "weekly.png")
    caption(doc, "图 5  2026-01-09 至 2026-02-13 同周等权收益")

    add_para(doc, "1000指增六周对照（单位 %）", size=11, bold=True, space_after=4)
    wt = doc.add_table(rows=3, cols=7)
    wt.alignment = WD_TABLE_ALIGNMENT.CENTER
    write_cell(wt.rows[0].cells[0], "", size=8, fill="F5F5F5")
    for i, w in enumerate(WEEKS):
        write_cell(wt.rows[0].cells[i + 1], w, bold=True, size=8, fill="F5F5F5")
    write_cell(wt.rows[1].cells[0], "火富牛", size=8, fill="FDECEC", align="left")
    write_cell(wt.rows[2].cells[0], "本系统", size=8, fill="E3F2FD", align="left")
    for i, (a, b) in enumerate(zip(WEEKLY["1000指增"]["fof"], WEEKLY["1000指增"]["ours"])):
        write_cell(wt.rows[1].cells[i + 1], f"{a:.2f}", size=8, fill="FDECEC")
        write_cell(wt.rows[2].cells[i + 1], f"{b:.2f}", size=8, fill="E3F2FD")
    add_para(doc, "表 2  1000指增。最大单周差 0.21 个百分点（2 月 13 日当周）。", size=9, color=(100, 100, 100), space_before=4)

    add_para(
        doc,
        "同一段里，主观多头、量化期货、主观期货、期货策略的涨跌方向和火富牛一致，本系统的幅度更大。300指增方向一致，六周平均绝对差约 0.6 个百分点，和它只有 64 只一年样本、105 只周样本是相符的。股票对冲第一周符号相反。套利每一周都比火富牛更跳。",
        align="justify",
    )

    add_heading_cn(doc, "七、建议的验收顺序", 1)
    add_para(
        doc,
        "若目标是「总体上像火富牛」，现在可以认为指增、市场中性、股票对冲、期权、多资产、套利的一年分布已经可用，1000指增和 A500指增的周收益也可以用。不要用 500指增或主观多头的平均值做验收。量化选股、可转债、组合策略、2000指增还不能算对齐。",
        align="justify",
    )
    items = [
        "去掉重复行。量化精选、主观精选不要和量化选股、主观多头同时出现在指标表和表底汇总里。",
        "补 2000指增，规则与 1000、500 相同，避免和 A500、1000 抢同一只产品。",
        "收紧量化选股和可转债。量化选股先查那 72 只一年收益里 90% 分位以下的产品是不是净值异常或误分类；可转债不要仅凭产品名里的「转债」二字从股票多头里吸入。",
        "期货策略和组合策略补覆盖，同时收窄量化期货，避免「程序化」一类宽词把非 CTA 产品放进来。",
        "债券先补齐近一年收益字段。周样本已经有 585 只，指标表只有 109 只，缺的是指标而不是产品。",
        "平均值继续保留，验收时以中位数、25%–75% 分位和正收益比例为准。500指增的 10% 分位几天内就能从约 38% 跳到 58%，说明右尾还不稳定。",
        "超额视图另算。A500 不应继续减 IF。本次绝对收益对照不能证明超额也对齐。",
        "市场中性、套利、股票对冲的周序列若也要对齐，需要单独看归周和异常周，不能用一年分布合格来代替。",
    ]
    for i, text in enumerate(items, 1):
        add_para(doc, f"{i}. {text}", size=11, space_after=4, align="justify")

    add_heading_cn(doc, "附：数据来源与局限", 1)
    add_para(
        doc,
        "火富牛：页面截图，收益分位截止 2026-05-22，周收益表覆盖 2026 年 1 月至 9 月，全年列为空。本系统：策略观察接口，基金 12,263 只（近 6 个月有净值），收益分位与周收益截止 2026-10-08。周收益抽查只使用两边都能读清的 1 月 9 日至 2 月 13 日，没有把整张周表逐格做相关。500指增 1 月 30 日、量化选股 1 月 9 日两个单元格的符号在截图上有歧义，文中已单独注明，不拿来做「对不上」的证据。",
        align="justify",
    )
    add_para(
        doc,
        "火富牛页脚说明其指标基于可投资净值、分类等权，并按自己的策略目录归类。本系统指标基于近 6 个月有净值的私募，收益取产品页预计算的近一年指标，分位从高到低，收益率为等权。两边目录本身不是同一套名单，所以样本数量小于对方是预期结果；本报告把「中心是否一致」和「名单是否一样全」分开看。",
        align="justify",
    )

    doc.save(DOC_PATH)
    print("wrote", DOC_PATH)


if __name__ == "__main__":
    build_charts()
    build_doc()
    print("grades")
    for name in ORDER:
        f, o = FOF[name], OURS[name]
        print(name, grade(name), f"med {o[4]-f[4]:+.2f}", f"mean {o[1]-f[1]:+.2f}", f"pos {o[7]-f[7]:+.2f}", f"n {o[0]}/{f[0]}")
    for name, row in WEEKLY.items():
        print("mae", name, round(mae(row["fof"], row["ours"]), 3))
