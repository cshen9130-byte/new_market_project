# -*- coding: utf-8 -*-
"""Add the new 2000指增 comparison into the existing Word report and charts."""
import shutil
import zipfile
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt

ROOT = Path(r"d:\coding\market_website")
DOCS = ROOT / "docs"
CHART = DOCS / "strategy-observation-compare-charts"
DOC = next(p for p in DOCS.glob("*.docx") if "\u7b56\u7565\u89c2\u5bdf" in p.name)

font_manager.fontManager.addfont(r"C:\Windows\Fonts\msyh.ttc")
plt.rcParams["font.family"] = "Microsoft YaHei"
plt.rcParams["axes.unicode_minus"] = False

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
OURS = {
    "股票市场中性": (230, 4.85, 14.60, 10.03, 4.54, -0.53, -3.94, 70.87),
    "1000指增": (198, 15.94, 31.44, 18.42, 13.13, 7.96, 1.81, 91.41),
    "500指增": (169, 20.67, 57.71, 24.76, 14.11, 8.70, 1.85, 91.12),
    "300指增": (64, 12.52, 19.23, 14.86, 12.90, 6.56, -0.74, 87.50),
    "A500指增": (58, 10.05, 18.86, 16.72, 10.12, 3.84, 0.43, 93.10),
    "2000指增": (79, 15.73, 28.52, 21.62, 14.83, 6.84, 3.55, 97.47),
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
    "股票市场中性", "1000指增", "500指增", "300指增", "A500指增", "2000指增",
    "量化选股", "主观多头", "量化期货", "主观期货", "期货策略",
    "股票对冲", "套利策略", "期权策略", "多资产策略", "债券策略",
    "组合策略", "可转债多头",
]
GRADE = {n: "好" for n in ["股票市场中性", "1000指增", "500指增", "股票对冲", "套利策略", "期权策略", "多资产策略"]}
GRADE.update({n: "较好" for n in ["300指增", "A500指增", "主观多头", "主观期货", "债券策略"]})
GRADE.update({n: "一般" for n in ["量化期货", "期货策略", "组合策略", "2000指增"]})
GRADE.update({n: "较差" for n in ["量化选股", "可转债多头"]})
COLOR = {"好": "#2e7d32", "较好": "#7cb342", "一般": "#f9a825", "较差": "#c62828"}


def build_charts():
    names = list(reversed(ORDER))
    y = range(len(names))

    def hbars(path, left, right, xlabel, title, legend_loc):
        fig, ax = plt.subplots(figsize=(10.2, 7.8), dpi=140)
        h = 0.38
        ax.barh([i + h / 2 for i in y], left, height=h, color="#c62828", label="火富牛（截止 2026-09-24）")
        ax.barh([i - h / 2 for i in y], right, height=h, color="#1565c0", label="本系统（截止 2026-10-08）")
        ax.set_yticks(list(y))
        ax.set_yticklabels(names, fontsize=10)
        ax.set_xlabel(xlabel, fontsize=10)
        ax.set_title(title, fontsize=13, pad=10, loc="left")
        ax.axvline(0, color="#9e9e9e", lw=0.6)
        ax.legend(frameon=False, fontsize=9, loc=legend_loc)
        ax.grid(axis="x", color="#eeeeee")
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        fig.tight_layout()
        fig.savefig(path, bbox_inches="tight", facecolor="white")
        plt.close()

    hbars(
        CHART / "median.png",
        [FOF[n][4] for n in names],
        [OURS[n][4] for n in names],
        "近一年收益 50% 分位（%）",
        "近一年收益中位数：2000指增整段偏低，其余多数中心仍对齐",
        "lower right",
    )
    hbars(
        CHART / "mean.png",
        [FOF[n][1] for n in names],
        [OURS[n][1] for n in names],
        "近一年收益平均值（%）",
        "近一年收益平均值：500指增、量化选股、主观多头被尾部拉开",
        "lower right",
    )

    fig, ax = plt.subplots(figsize=(10.2, 7.8), dpi=140)
    h = 0.38
    ax.barh([i + h / 2 for i in y], [FOF[n][0] for n in names], height=h, color="#c62828", label="火富牛")
    ax.barh([i - h / 2 for i in y], [OURS[n][0] for n in names], height=h, color="#1565c0", label="本系统")
    ax.set_yticks(list(y))
    ax.set_yticklabels(names, fontsize=10)
    ax.set_xlabel("指标分布样本量（只）", fontsize=10)
    ax.set_title("样本量：2000指增约为火富牛的四成", fontsize=13, pad=10, loc="left")
    ax.legend(frameon=False, fontsize=9)
    ax.grid(axis="x", color="#eeeeee")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    fig.savefig(CHART / "sample.png", bbox_inches="tight", facecolor="white")
    plt.close()

    fig, ax = plt.subplots(figsize=(7.6, 6.8), dpi=140)
    xs = [FOF[n][4] for n in ORDER]
    ys = [OURS[n][4] for n in ORDER]
    offsets = {
        "股票市场中性": (8, -12),
        "1000指增": (6, -2),
        "500指增": (-8, 8),
        "300指增": (-46, 8),
        "A500指增": (-58, -4),
        "2000指增": (8, -14),
        "量化选股": (8, -12),
        "主观多头": (8, -2),
        "量化期货": (8, -10),
        "主观期货": (-20, 10),
        "期货策略": (8, 2),
        "股票对冲": (8, 8),
        "套利策略": (8, 4),
        "期权策略": (-52, 10),
        "多资产策略": (8, -10),
        "债券策略": (-46, -12),
        "组合策略": (-50, 8),
        "可转债多头": (8, 6),
    }
    for n, x, yv in zip(ORDER, xs, ys):
        ax.scatter(x, yv, s=46, color=COLOR[GRADE[n]], zorder=3)
        dx, dy = offsets[n]
        kw = {}
        if abs(dx) + abs(dy) > 24:
            kw["arrowprops"] = dict(arrowstyle="-", color="#bdbdbd", lw=0.6, shrinkA=0, shrinkB=3)
        ax.annotate(n, (x, yv), textcoords="offset points", xytext=(dx, dy), fontsize=8, color="#424242", **kw)
    lo = min(xs + ys) - 1.5
    hi = max(xs + ys) + 2.2
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
    fig.savefig(CHART / "scatter.png", bbox_inches="tight", facecolor="white")
    plt.close()


def replace_once(doc, old, new):
    hits = []
    for p in doc.paragraphs:
        if old in p.text:
            hits.append(p)
    if len(hits) != 1:
        raise SystemExit("expected 1 hit, got %s for: %s" % (len(hits), old[:48]))
    p = hits[0]
    full = p.text.replace(old, new, 1)
    if not p.runs:
        p.add_run(full)
        return
    p.runs[0].text = full
    for run in p.runs[1:]:
        run.text = ""


def shade_cell(cell, hex_color):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for child in list(tcPr):
        if child.tag == qn("w:shd"):
            tcPr.remove(child)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), hex_color)
    shd.set(qn("w:val"), "clear")
    tcPr.append(shd)


def set_cell(cell, text, fill, bold=False):
    p = cell.paragraphs[0]
    if p.runs:
        p.runs[0].text = text
        for run in p.runs[1:]:
            run.text = ""
        run = p.runs[0]
    else:
        run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(8)
    run.font.name = "微软雅黑"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    for extra in cell.paragraphs[1:]:
        extra.text = ""
    shade_cell(cell, fill)
    p.alignment = 1


def update_doc():
    doc = Document(str(DOC))
    replace_once(
        doc,
        "按这个标准，17 个两边都有的类别里，7 个为好，5 个为较好，3 个为一般，2 个为较差。",
        "按这个标准，18 个两边都有的类别里，7 个为好，5 个为较好，4 个为一般，2 个为较差。2000指增已从缺失改为纳入对照。",
    )
    replace_once(
        doc,
        "一般：量化期货、期货策略、组合策略。方向对，中位数低 1.8 到 3.1 个百分点，正收益比例低约 7 个百分点。期货策略和组合策略的样本大约只有火富牛的一半和五分之一。",
        "一般：量化期货、期货策略、组合策略、2000指增。前三类方向对，中位数低 1.8 到 3.1 个百分点，正收益比例低约 7 个百分点。期货策略和组合策略的样本大约只有火富牛的一半和五分之一。2000指增正收益比例几乎相同（97.47% 对 96.07%），平均值 15.73% 对 18.48%，中位数 14.83% 对 18.44%，是整条分布下移大约 3 到 3.6 个百分点。样本 79 只，约为火富牛 178 只的四成。",
    )
    replace_once(
        doc,
        "另外有三类不能直接比。火富牛有 2000指增，本系统没有这一行。本系统的「股票多头」是一级大类汇总，火富牛不单列。",
        "另外有两类不能直接比。本系统的「股票多头」是一级大类汇总，火富牛不单列。",
    )
    replace_once(
        doc,
        "量化选股明显偏左，主观多头略偏右，期货策略和量化期货偏低。",
        "量化选股明显偏左，主观多头略偏右，期货策略和量化期货偏低。2000指增落在火富牛下方约 3.6 个百分点。",
    )
    replace_once(
        doc,
        "量化选股离开虚线最远，可转债次之。其余类别沿虚线排开。",
        "量化选股离开虚线最远，可转债次之。2000指增落在虚线下方，中位数差 3.61 个百分点。其余类别沿虚线排开。",
    )
    replace_once(
        doc,
        "指增样本大约是火富牛的两到四成，多资产约六成，等权之后的中心已经稳定。",
        "1000、500、300、A500 的样本大约是火富牛的两到四成，多资产约六成，等权之后的中心已经稳定。2000指增用同一套规则，关键词换成 2000，并且不含「2000指增T0」。它原先不在策略观察的分类列表里；团队策略三级标签里已经有「2000指增」，产品一直在，只是这一行没有被算进去。补上之后，近一年中位数 14.83% 对 18.44%（低 3.61 个百分点），平均值 15.73% 对 18.48%，10% 分位 28.52% 对 30.40%，90% 分位 3.55% 对 5.91%，正收益比例 97.47% 对 96.07%。两边平均值都贴着中位数，下移不是右尾或左尾造成的。指标样本 79 只、周样本 115 只，火富牛指标样本 178 只。1000指增样本只有对方三成时中位数仍能对齐，所以 2000 的差距更像池子还没盖住对方收益更高的那一半。这一页没有中证2000行情，超额等于绝对收益；本表比的是绝对收益，基准不影响这一行的分位。周收益全年等权 7.83%，周胜率 52.63%。火富牛全年列为空，这一列仍然无法对照，本次也没有把 2000 的周路径逐周对上。",
    )
    replace_once(
        doc,
        "6. 重复行、缺失行、以及超额基准",
        "6. 重复行，以及超额基准",
    )
    replace_once(
        doc,
        "火富牛的指标表没有对应行，不能拿去对某一条火富牛策略。2000指增火富牛有 178 只，近一年平均值 18.48%、中位数 18.44%，本系统分类列表里没有这一项。",
        "火富牛的指标表没有对应行，不能拿去对某一条火富牛策略。2000指增不再是缺失行，对照见第一节。",
    )
    replace_once(
        doc,
        "市场中性、套利、股票对冲、期权没有配基准，超额等于绝对收益。",
        "市场中性、套利、股票对冲、期权没有配基准，超额等于绝对收益。2000指增同样不减基准，因为这页的行情只有 IF / IC / IM，没有中证2000。",
    )
    replace_once(
        doc,
        "量化选股、可转债、组合策略、2000指增还不能算对齐。",
        "2000指增这一行已经有了，正收益比例对齐，中位数仍低 3.61 个百分点，先记为一般。量化选股、可转债、组合策略还不能算对齐。",
    )
    replace_once(
        doc,
        "2. 补 2000指增，规则与 1000、500 相同，避免和 A500、1000 抢同一只产品。",
        "2. 2000指增已按与 1000、500 相同的标签补上，不含「2000指增T0」，也不会被 1000 或 500 的规则吸走。剩下要查的是为什么 79 只的中位数比火富牛 178 只低 3.61 个百分点，以及周样本 115 只里没有近一年收益的那一部分。",
    )
    replace_once(
        doc,
        "本系统：策略观察接口，基金 12,263 只（近 6 个月有净值），收益分位与周收益截止 2026-10-08。",
        "本系统：策略观察接口，基金 12,264 只（近 6 个月有净值），收益分位与周收益截止 2026-10-08。2000指增数字是补进分类列表之后的同一次刷新，与页面截图一致：样本 79，中位数 14.83%，正收益比例 97.47%。",
    )

    row = None
    for table in doc.tables:
        for tr in table.rows:
            if tr.cells[0].text.strip() == "2000指增":
                row = tr
                break
    if row is None:
        raise SystemExit("2000 row not found")
    o, f = OURS["2000指增"], FOF["2000指增"]
    vals = [
        "2000指增",
        "一般",
        "%.0f%%" % (o[0] / f[0] * 100),
        "%+.2f" % (o[4] - f[4]),
        "%+.2f" % (o[1] - f[1]),
        "%+.2f" % (o[7] - f[7]),
        "%.2f%%" % o[4],
        "%.2f%%" % f[4],
    ]
    for i, val in enumerate(vals):
        set_cell(row.cells[i], val, "FFF8E1", bold=(i == 1))
        if i == 0:
            row.cells[i].paragraphs[0].alignment = 0

    doc.save(str(DOC))


def swap_images():
    old = {
        75068: CHART / "median.png",
        81065: CHART / "scatter.png",
        80304: CHART / "mean.png",
        73931: CHART / "sample.png",
    }
    tmp = DOC.with_suffix(".tmp.docx")
    replaced = {}
    with zipfile.ZipFile(DOC, "r") as zin, zipfile.ZipFile(tmp, "w") as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("word/media/") and len(data) in old:
                data = old[len(data)].read_bytes()
                replaced[item.filename] = len(data)
            zout.writestr(item, data)
    if len(replaced) != 4:
        tmp.unlink(missing_ok=True)
        raise SystemExit("image swap matched %s" % replaced)
    shutil.move(str(tmp), str(DOC))
    print("images", replaced)


if __name__ == "__main__":
    build_charts()
    update_doc()
    swap_images()
    print("ok", DOC.stat().st_size)
