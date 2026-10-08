# -*- coding: utf-8 -*-
"""Word report: SXL292 复途神舟一号 累计/复权 column swap vs 火富牛."""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports" / "复途神舟一号_净值列对调说明_20261008.docx"
CHART_DIR = ROOT / "reports" / "_sxl292_charts"

DATES = ["08-07", "08-14", "08-21", "08-28", "09-04", "09-11", "09-18", "09-24", "09-29"]
TRUE_CUM = [1.3796, 1.3807, 1.3814, 1.3820, 1.3828, 1.3837, 1.3864, 1.3879, 1.3880]
TRUE_ADJ = [1.427873, 1.429388, 1.430353, 1.431179, 1.432281, 1.433521, 1.437241, 1.439307, 1.439445]
SHOWN_ADJ = [1.427873, 1.429388, 1.430353, 1.431179, 1.483249, 1.484533, 1.488385, 1.439307, 1.492761]
SHOWN_CUM = [1.3796, 1.3807, 1.3814, 1.3820, 1.432281, 1.433521, 1.437241, 1.3879, 1.439445]


def set_run_font(run, size=11, bold=False, name="微软雅黑"):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)


def add_heading(doc: Document, text: str, level: int = 1):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        set_run_font(run, size=16 if level == 1 else 13, bold=True)
    return p


def add_para(doc: Document, text: str, *, size=11, bold=False, indent=True):
    p = doc.add_paragraph()
    if indent:
        p.paragraph_format.first_line_indent = Pt(22)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.15
    run = p.add_run(text)
    set_run_font(run, size=size, bold=bold)
    return p


def add_bullet(doc: Document, text: str):
    p = doc.add_paragraph(style="List Bullet")
    p.clear()
    p.paragraph_format.space_after = Pt(3)
    run = p.add_run(text)
    set_run_font(run, size=10.5)
    return p


def add_table(doc: Document, headers: list[str], rows: list[list[str]]):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Table Grid"
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(h)
        set_run_font(run, size=9, bold=True)
    for r_idx, row in enumerate(rows):
        for c_idx, val in enumerate(row):
            cell = table.rows[r_idx + 1].cells[c_idx]
            cell.text = ""
            run = cell.paragraphs[0].add_run(val)
            set_run_font(run, size=8.5)
    doc.add_paragraph()
    return table


def _use_chinese_font() -> None:
    font_path = Path(r"C:\Windows\Fonts\msyh.ttc")
    if font_path.is_file():
        font_manager.fontManager.addfont(str(font_path))
        plt.rcParams["font.sans-serif"] = ["Microsoft YaHei"]
    plt.rcParams["axes.unicode_minus"] = False


def write_charts() -> tuple[Path, Path]:
    _use_chinese_font()
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    x = list(range(len(DATES)))

    fig, ax = plt.subplots(figsize=(10.2, 4.6), dpi=140)
    ax.plot(x, TRUE_CUM, color="#1f4e79", marker="o", linewidth=1.8, label="火富牛累计净值")
    ax.plot(x, TRUE_ADJ, color="#2e7d32", marker="o", linewidth=1.8, label="火富牛复权净值")
    ax.plot(x, SHOWN_ADJ, color="#c62828", marker="s", linewidth=1.6, linestyle="--", label="本系统算出的复权净值")
    ax.axvspan(3.5, 6.5, color="#fff3e0", zorder=0)
    ax.axvspan(7.5, 8.5, color="#ffebee", zorder=0)
    ax.annotate("列表入库，列写反\n修复又把复权抬高", xy=(4, 1.483249), xytext=(4.15, 1.505),
                fontsize=8, color="#e65100",
                arrowprops=dict(arrowstyle="->", color="#e65100"))
    ax.annotate("1.4928\n火富牛没有这个数", xy=(8, 1.492761), xytext=(6.15, 1.47),
                fontsize=8, color="#c62828",
                arrowprops=dict(arrowstyle="->", color="#c62828"))
    ax.set_xticks(x)
    ax.set_xticklabels([f"2026-{d}" for d in DATES], rotation=30, ha="right")
    ax.set_ylabel("净值")
    ax.set_ylim(1.36, 1.52)
    ax.set_title("复途神舟一号：火富牛原序列与本系统复权净值")
    ax.grid(True, axis="y", linestyle=":", alpha=0.6)
    ax.legend(loc="upper left", frameon=False)
    fig.tight_layout()
    series_path = CHART_DIR / "sxl292_series.png"
    fig.savefig(series_path)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(10.2, 4.2), dpi=140)
    width = 0.36
    ax.bar([i - width / 2 for i in x], TRUE_ADJ, width=width, color="#2e7d32", label="火富牛复权净值")
    ax.bar([i + width / 2 for i in x], SHOWN_ADJ, width=width, color="#c62828", label="本系统复权净值")
    ax.set_xticks(x)
    ax.set_xticklabels([f"2026-{d}" for d in DATES], rotation=30, ha="right")
    ax.set_ylim(1.40, 1.52)
    ax.set_ylabel("复权净值")
    ax.set_title("只有列表接口写入的日期被抬高；9月24日走多基金净值，两边重合")
    ax.grid(True, axis="y", linestyle=":", alpha=0.6)
    ax.legend(loc="upper left", frameon=False)
    fig.tight_layout()
    bar_path = CHART_DIR / "sxl292_adj_bars.png"
    fig.savefig(bar_path)
    plt.close(fig)
    return series_path, bar_path


def write_rule_charts() -> dict[str, Path]:
    _use_chinese_font()
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}

    fig, ax = plt.subplots(figsize=(8.6, 3.8), dpi=140)
    labels = ["单位净值", "累计净值"]
    wrong = [1.6983, 1.6983]
    right = [1.3398, 1.6983]
    x = [0, 1]
    ax.bar([i - 0.18 for i in x], wrong, width=0.36, color="#c62828", label="旧解析：两个都写成 1.6983")
    ax.bar([i + 0.18 for i in x], right, width=0.36, color="#2e7d32", label="改后：单位 1.3398，累计 1.6983")
    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.set_ylim(0, 2.1)
    ax.set_title("中信【基金净值】GM266C：表头“累计单位净值”被当成单位净值")
    ax.legend(frameon=False, fontsize=8)
    ax.grid(True, axis="y", linestyle=":", alpha=0.6)
    fig.tight_layout()
    out["citics"] = CHART_DIR / "rule_citics.png"
    fig.savefig(out["citics"])
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8.6, 3.8), dpi=140)
    labels = ["累计净值", "复权净值"]
    wrong = [2.7925, 2.2526]
    right = [2.2526, 2.7925]
    x = [0, 1]
    ax.bar([i - 0.18 for i in x], wrong, width=0.36, color="#c62828", label="库里写反后的页面")
    ax.bar([i + 0.18 for i in x], right, width=0.36, color="#2e7d32", label="15% 规则换列之后")
    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.set_ylim(0, 3.4)
    ax.set_title("SQX078 2026-05-18：两列对调约 0.54，占单位净值 1.0889 的 50%")
    ax.legend(frameon=False, fontsize=8)
    ax.grid(True, axis="y", linestyle=":", alpha=0.6)
    fig.tight_layout()
    out["sqx"] = CHART_DIR / "rule_sqx078.png"
    fig.savefig(out["sqx"])
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8.8, 4.0), dpi=140)
    days = ["分红前", "除息日", "其后单位下跌"]
    unit = [1.30, 1.09, 1.00]
    cum = [1.30, 1.28, 1.19]
    wrong_adj = [1.30, 1.28, 1.174]
    right_adj = [1.30, 1.30, 1.209]
    xs = list(range(3))
    ax.plot(xs, unit, marker="o", color="#1565c0", label="单位净值")
    ax.plot(xs, cum, marker="o", color="#1f4e79", label="累计净值")
    ax.plot(xs, wrong_adj, marker="s", linestyle="--", color="#c62828", label="错误：除息后改按单位涨跌接复权")
    ax.plot(xs, right_adj, marker="o", color="#2e7d32", label="分红公式：复权按累计涨跌接，不低于累计")
    ax.set_xticks(xs)
    ax.set_xticklabels(days)
    ax.set_ylim(0.9, 1.45)
    ax.set_title("分红公式示意图（缺口约 0.21，与荣熙恒盈2号 SBAH99 同量级）")
    ax.legend(frameon=False, fontsize=8)
    ax.grid(True, axis="y", linestyle=":", alpha=0.6)
    fig.tight_layout()
    out["div"] = CHART_DIR / "rule_dividend.png"
    fig.savefig(out["div"])
    plt.close(fig)
    return out


def add_picture(doc: Document, path: Path, width_cm: float = 16.2):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(8)
    run = p.add_run()
    run.add_picture(str(path), width=Cm(width_cm))


def build() -> None:
    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.8)
    section.bottom_margin = Cm(1.8)
    section.left_margin = Cm(1.8)
    section.right_margin = Cm(1.8)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = title.add_run("复途神舟一号（SXL292）累计净值与复权净值对调说明")
    set_run_font(r, size=18, bold=True)

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = sub.add_run("对照火富牛产品页　2026-10-08　内部技术说明")
    set_run_font(r, size=10)

    add_heading(doc, "一、结论", 1)
    add_para(
        doc,
        "火富牛产品页上的序列是对的，中间没有跳变。2026-09-29 的正确数字是单位净值 1.0449、累计净值 1.3880、复权净值 1.4394，当日涨跌幅约 +0.02%，成立以来收益 43.94%。43.94% 就是 1.4394 相对成立日复权净值 1.0000 的涨幅。",
    )
    add_para(
        doc,
        "本系统详情页把同一天显示成累计净值 1.4394、复权净值 1.4928、涨跌幅 +3.71%、成立以来收益 +49.28%。1.4928 和 +3.71%、+49.28% 都不是火富牛发布过的数。它们是详情页在列被写反之后，又用“复权低于累计就按比例重接”这条规则算出来的。",
    )
    add_para(
        doc,
        "对调分两层。第一层在入库：周五下午的基金列表接口把“累计净值”写进了复权列、把“复权净值”写进了累计列。火富牛返回的两个数本身是对的，写错的是列。第二层在读出：修复函数没有把两列换回来，而是把已经正确的复权净值当成累计净值，再乘上一次复权/累计比例，多加了一层分红复权溢价，得到 1.4928。后一层才是页面上的错误。",
    )

    add_heading(doc, "二、火富牛页面上的正确数据", 1)
    add_para(
        doc,
        "对照页是火富牛“复途神舟一号”，备案号 SXL292，净值来源为平台净值，净值类型为复权净值，统计区间 2022-09-30 至 2026-09-29。页头与表头一致：单位净值 1.0449（2026-09-29），累计净值 1.3880，复权净值 1.4394。成立以来收益 43.94%，今年以来 5.57%，成立以来年化 9.53%，最大回撤 1.50%，夏普 3.7426。",
    )
    add_para(doc, "表中近几日（四位小数）如下。累计净值始终等于单位净值加 0.3431，这是 2026-03-20 分红之后一直保持的分红缺口。复权净值在累计净值之上约 0.05，并随单位净值同比例变化。", indent=True)
    add_table(
        doc,
        ["日期", "单位净值", "累计净值", "复权净值", "涨跌幅", "累计−单位"],
        [
            ["2026-09-29", "1.0449", "1.3880", "1.4394", "+0.02%", "0.3431"],
            ["2026-09-28", "1.0447", "1.3878", "1.4392", "−0.01%", "0.3431"],
            ["2026-09-24", "1.0448", "1.3879", "1.4393", "−0.01%", "0.3431"],
            ["2026-09-23", "1.0449", "1.3880", "1.4394", "+0.04%", "0.3431"],
            ["2026-09-22", "1.0445", "1.3876", "1.4389", "+0.04%", "0.3431"],
            ["2026-09-21", "1.0441", "1.3872", "1.4383", "+0.08%", "0.3431"],
        ],
    )
    add_para(
        doc,
        "2026-09-29 相对 2026-09-24：单位净值 1.0449 / 1.0448 − 1 = +0.0096%，复权净值 1.4394 / 1.4393 − 1 也在 +0.01% 附近。页面上的 +0.02% 是更近一个净值日的复权涨跌，不是相对 09-24 的周涨跌。这条曲线在 9 月 4 日前后没有台阶。",
    )

    add_heading(doc, "三、本系统页面实际显示的数字", 1)
    add_para(
        doc,
        "详情缓存 ops_private_fund_detail_nav_cache（SXL292，2026-10-08 21:02 刷新，738 条）在 2026-09-29 的结果是：单位净值 1.044900，累计净值列 1.439445，复权净值列 1.492761。页头成立以来收益按复权净值 1.492761 / 1.0000 − 1 = +49.28%。表上 +3.71% 是 1.492761 / 上一条复权 1.439307 − 1。",
    )
    add_table(
        doc,
        ["日期", "火富牛累计", "火富牛复权", "本系统累计", "本系统复权"],
        [
            ["2026-08-28", "1.3820", "1.4312", "1.3820", "1.4312"],
            ["2026-09-04", "1.3828", "1.4323", "1.4323", "1.4832"],
            ["2026-09-11", "1.3837", "1.4335", "1.4335", "1.4845"],
            ["2026-09-18", "1.3864", "1.4372", "1.4372", "1.4884"],
            ["2026-09-24", "1.3879", "1.4393", "1.3879", "1.4393"],
            ["2026-09-29", "1.3880", "1.4394", "1.4394", "1.4928"],
        ],
    )
    add_para(
        doc,
        "8 月 28 日和 9 月 24 日与火富牛一致。从 9 月 4 日起，本系统把火富牛的复权净值显示成了累计净值，又在上面另造了一条更高的复权净值。9 月 24 日短暂回到正确，9 月 29 日再次错开。",
    )

    add_heading(doc, "四、库里的两个数并没有算错，写错的是列", 1)
    add_para(
        doc,
        "private_fund_nav 里 SXL292 每个净值日只有一行，团队手工净值没有。本系统约定：cum_nav_withdrawal 表示累计净值，cumulative_nav 表示复权净值。火富牛两个接口的字段名不同，含义在接口文档里写得很明确。邮箱里另有广发虚拟净值邮件，不进入这张表，见第十三节。",
    )
    add_bullet(doc, "多基金净值 FundMultiPrice：cumulative_nav_withdrawal = 累计净值，cumulative_nav = 复权净值。")
    add_bullet(doc, "基金列表 FundAdvancedList：price_cnw = 累计净值，price_cw_nav = 复权净值。")
    add_para(
        doc,
        "周频补数脚本按 FundMultiPrice 的名字入库，方向和上面的库约定一致。周五下午列表脚本 persist_list_page 写成了 cum = price_cnw、withdraw = price_cw_nav，也就是把累计净值写入 cumulative_nav，把复权净值写入 cum_nav_withdrawal。两个数都还是火富牛的数，列对调了。插入使用 ON CONFLICT DO NOTHING，先写入的批次会留下。",
    )
    add_table(
        doc,
        ["净值日", "写入批次", "接口", "库中 cumulative_nav", "库中 cum_nav_withdrawal", "与火富牛"],
        [
            ["2026-08-28", "2026-08-28-0044", "多基金净值", "1.431179 复权", "1.382000 累计", "列正确"],
            ["2026-09-04", "fri-pm-2026-09-04-p0006", "列表第 6 页", "1.382800 实为累计", "1.432281 实为复权", "列对调"],
            ["2026-09-11", "fri-pm-2026-09-11-p0006", "列表", "1.383700 实为累计", "1.433521 实为复权", "列对调"],
            ["2026-09-18", "fri-pm-2026-09-18-p0006", "列表", "1.386400 实为累计", "1.437241 实为复权", "列对调"],
            ["2026-09-24", "fri-pm-2026-09-24-m0040", "多基金净值", "1.439307 复权", "1.387900 累计", "列正确"],
            ["2026-09-29", "fri-pm-2026-09-30-p0003", "列表第 3 页", "1.388000 实为累计", "1.439445 实为复权", "列对调"],
        ],
    )
    add_para(
        doc,
        "2026-09-04 能用前一周直接验算，说明列表返回的数是连续的，只是进了相反的列。8 月 28 日单位净值 1.0389、累计净值 1.3820、复权净值 1.431179。9 月 4 日单位净值 1.0397。正确累计净值 = 1.0397 + (1.3820 − 1.0389) = 1.3828。正确复权净值 = 1.431179 × (1.0397 / 1.0389) = 1.432281。库里正好是这两个数，cumulative_nav 放了 1.382800，cum_nav_withdrawal 放了 1.432281。",
    )
    add_para(
        doc,
        "2026-09-29 同样可以验算。9 月 24 日火富牛复权净值 1.439307。1.439307 × (1.0449 / 1.0448) = 1.439445，这是库里 cum_nav_withdrawal 的值，也就是火富牛页面上的复权净值 1.4394。1.0449 + 0.3431 = 1.3880，这是库里 cumulative_nav 的值，也就是火富牛页面上的累计净值。",
    )
    add_para(
        doc,
        "因此“9 月 4 日火富牛把序列对调了”这个说法不成立。火富牛页面从 9 月 21 日到 9 月 29 日每天都是累计净值 = 单位净值 + 0.3431，复权净值平滑上移。对调只出现在本系统用列表接口写入的那些周五（以及 9 月 29 日）。全库在 8 月 28 日列方向正确、9 月 4 日变成累计列高于复权列的产品有 2071 只，都是列表页先写入的那一批，不是这只基金单独分红造成的。",
    )

    add_heading(doc, "五、为什么随后算出的复权净值是错的", 1)
    add_para(
        doc,
        "详情页不直接展示上面两列。finalizeNavSeries 里的 repairAdjBelowCumRows 认为：cum_nav_withdrawal 一定是累计净值，cumulative_nav 一定是复权净值；一旦复权低于累计，就用上一行的复权/累计比例把复权拉高：新复权 = 上期复权 × 本期累计列 / 上期累计列。",
    )
    add_para(
        doc,
        "9 月 4 日这一行，函数读到的“累计”其实是 1.432281（火富牛的复权），读到的“复权”是 1.382800（火富牛的累计）。因为 1.382800 < 1.432281，它认为复权跌破了累计，于是计算 1.431179 × 1.432281 / 1.382000 = 1.483249。页面就显示累计净值 1.4323、复权净值 1.4832。1.4832 在火富牛上不存在。它等于把已经复权过的 1.432281 又乘了一次 1.431179 / 1.382000（约 1.0356，也就是原有的复权相对累计的溢价）。",
    )
    add_para(
        doc,
        "9 月 11 日、9 月 18 日沿着这条被抬高的复权继续：1.483249 × 1.433521 / 1.432281 = 1.484533，再 1.484533 × 1.437241 / 1.433521 = 1.488385。每一天的“累计”列里装的都是火富牛的复权，所以比例接近 1，复权只是贴着这条错误的高位慢慢走。",
    )
    add_para(
        doc,
        "9 月 24 日是多基金净值写入的，两列方向正确：累计 1.387900，复权 1.439307。这一行复权高于累计，修复函数不动它。它和火富牛一致，但和前一条被抬高的 1.488385 接不上，图上会先掉下来。",
    )
    add_para(
        doc,
        "9 月 29 日又是列表写入，列再次对调。修复函数把 1.439445 当成累计、把 1.388000 当成过低的复权，用 9 月 24 日那条正确的比例去乘：1.439307 × 1.439445 / 1.387900 = 1.492761。页面四舍五入为复权净值 1.4928，累计净值显示 1.4394。涨跌幅 +3.71% = 1.492761 / 1.439307 − 1。单位净值当天只从 1.0448 变到 1.0449，涨幅 +0.01%。火富牛的复权净值停在 1.4394，成立以来是 43.94%，不是 49.28%。",
    )
    add_para(
        doc,
        "这条修复错在前提。它处理的是“复权列里留下了一个过期的小数”。9 月 29 日 cumulative_nav 里的 1.3880 不是过期复权，它是当天的累计净值，只是被列表脚本放进了复权列。真正的复权净值 1.439445 已经在另一列里，和火富牛页面一致。正确做法是把两列换回原位，得到累计净值 1.3880、复权净值 1.4394。按比例重接会把复权溢价再乘一遍，所以结果系统性偏高，而且会在列表批次和多基金净值批次交替的日期上打出 +3.71% 这种假日涨跌。",
    )
    add_para(
        doc,
        "大缺口对调修复（两列相对差超过单位净值的 15% 才整列互换）也没有接住这一行。1.439445 与 1.388000 的差只占单位净值的约 4.9%，低于 15%，于是落到上面的比例重接。后来为连续多日对调加的识别，要求至少连续两天才换列；9 月 29 日夹在一条方向正确的 9 月 24 日后面，只有单独一天，仍然会走进比例重接，页面上的 1.4928 还在。",
    )

    add_heading(doc, "六、和此前说明不一致的地方", 1)
    add_para(
        doc,
        "此前把 9 月 4 日描述成火富牛从这一周开始对调返回值。对照产品页之后，这个说法应改掉。火富牛的累计净值和复权净值在 9 月一直连续，累计净值减单位净值保持 0.3431，复权净值约 1.43 而不是 1.49。对调发生在本系统周五列表入库的字段对应上。页面上的 1.4928、+3.71% 和 +49.28% 是修复函数在错误列含义上又算了一次，不是把两列换回火富牛原义。",
    )

    add_heading(doc, "七、若要与火富牛对齐", 1)
    add_bullet(doc, "列表入库改为：累计净值 price_cnw 写入 cum_nav_withdrawal，复权净值 price_cw_nav 写入 cumulative_nav。与 FundMultiPrice 的 cumulative_nav_withdrawal、cumulative_nav 同一方向。")
    add_bullet(doc, "已经由 fri-pm-…-p 批次写入、且两列对调的历史行，把两列换回，不要用上期复权/累计比例重算复权。换回之后 2026-09-29 应为累计净值 1.3880、复权净值 1.4394。")
    add_bullet(doc, "repairAdjBelowCumRows 只应用于复权列确实缺数或低于累计的情况。当较大的那个数已经等于上期复权乘以单位净值涨跌时，它就是复权净值，不应再乘一次溢价。")
    add_para(
        doc,
        "火富牛页面还有 9 月 21 日至 23 日、9 月 28 日等日频点。本系统 private_fund_nav 目前只留下了周频抓取写进的日期，所以即使列换回，详情表也不会自动出现这些中间日。那是抓取频率的差别，不是这次列对调的原因。",
        indent=True,
    )

    series_path, bar_path = write_charts()

    add_heading(doc, "八、为什么先前会写成“火富牛从 9 月 4 日开始对调返回值”", 1)
    add_para(
        doc,
        "这句是对照库表时做的推断，不是火富牛改过接口。当时只看了 private_fund_nav 里 SXL292 相邻两周：8 月 28 日 cumulative_nav 高于 cum_nav_withdrawal，9 月 4 日两列反过来。同一天的两个数仍然能用单位净值涨跌从上一周算出来，于是把“列的方向变了”说成了“供应商从这一周开始把两个字段对调返回”。",
    )
    add_para(
        doc,
        "这个推断漏了写入来源。抓取日志里，8 月 7 日至 8 月 28 日是 2026-09-04 下午用多基金净值接口补的，批次名是日期加序号（例如 2026-08-28-0044），列方向和接口文档一致。9 月 4 日这个净值日本身是一周后、2026-09-11 16:31，由周五列表任务 fri-pm-2026-09-04-p0006 写入的。数字没变味，换了一个从第一天就把字段写反的程序。把程序写反说成数据源在 9 月 4 日改了返回值，是错的。",
    )

    add_heading(doc, "九、数据源是对的，错数究竟是哪一行代码写进去的", 1)
    add_para(
        doc,
        "火富牛两份接口说明里，字段含义是稳定的，这次没有改过。多基金净值：cumulative_nav_withdrawal 是累计净值，cumulative_nav 是复权净值。基金列表：price_cnw 是累计净值，price_cw_nav 是复权净值。本系统库约定与多基金净值相同：cum_nav_withdrawal 存累计净值，cumulative_nav 存复权净值。",
    )
    add_para(
        doc,
        "周五列表的写入在 scripts/ma/fof99_friday_afternoon_fetch.py 的 persist_list_page。它从 2026-09-07 的提交 117c0098 起就是下面这样，之后没有改过这三行：",
    )
    add_para(doc, "cum = price_cnw          # 接口文档：累计净值", indent=False)
    add_para(doc, "withdraw = price_cw_nav   # 接口文档：复权净值", indent=False)
    add_para(doc, "INSERT 列顺序是 (cumulative_nav, cum_nav_withdrawal) = (cum, withdraw)", indent=False)
    add_para(
        doc,
        "参数名叫 cum，插入的列却叫 cumulative_nav。在这套代码里 cumulative_nav 表示复权净值，不表示累计净值。写这段的时候是按英文字面把 cumulative / cnw（cumulative net worth，累计净值）对上了名叫 cumulative_nav 的列，又把 price_cw_nav（复权净值）塞进了名叫 withdraw 的参数。列表文档里的两个中文名和这两个参数是反的。多基金净值那条路径用的是 cumulative_nav 对复权、cumulative_nav_withdrawal 对累计，所以 8 月 28 日和 9 月 24 日是对的。",
    )
    add_para(
        doc,
        "插入语句是 ON CONFLICT DO NOTHING。9 月 4 日这一天先被列表页写入，后来的多基金净值即使再拉到正确方向，也不会覆盖。所以库里留下的是写反的那一版，不是抓到了一份假净值。",
    )
    add_picture(doc, series_path)
    add_para(
        doc,
        "上图橙色区间是列表写入的 9 月 4 日、11 日、18 日，红色区间是同样写反的 9 月 29 日。绿线是把两列换回之后的复权净值，和火富牛页面一致，从 1.4279 平滑到 1.4394。红虚线是详情页实际采用的复权净值：9 月 4 日起被抬到 1.48 附近，9 月 24 日因为当天列是正的而掉回 1.4393，9 月 29 日再被抬到 1.4928。",
        indent=True,
    )
    add_picture(doc, bar_path)
    add_para(
        doc,
        "柱状图把“火富牛复权净值”和“本系统复权净值”并排。两边重合的日期都是多基金净值写入的。分开的日期都是 fri-pm-日期-p页码 这种列表批次。9 月 24 日的批次是 fri-pm-2026-09-24-m0040，m 表示多基金净值，所以这一根柱子重合。",
        indent=True,
    )

    add_heading(doc, "十、不是以前那条“对调规则”把数写反的", 1)
    add_para(
        doc,
        "读出时确实有几条处理“累计列高于复权列”的规则，但它们都不是 9 月 4 日库里那两列对调的原因。对调在写入时已经发生。这些规则只决定详情页接着怎么改。",
    )
    add_bullet(doc, "repairAdjBelowCumRows：分红修复时就有。它看见复权列低于累计列，不交换两列，而是用“上期复权 × 本期累计列 / 上期累计列”把复权抬高。SXL292 页面上的 1.4832 和 1.4928 是它算出来的。它没有往 private_fund_nav 里写过对调。")
    add_bullet(doc, "repairSwappedCumAdjRows：2026-07-03 为特夫郁金香全量化 SQX078 加上。只有 (累计列 − 复权列) / 单位净值 ≥ 15% 才整列互换。SXL292 两列相差约 0.051，只占单位净值的 4.9%，这条规则直接跳过，既没造成对调，也没把对调换回来。")
    add_bullet(doc, "isContinuationColumnSwap：2026-10-08 提交 6f838175 才加上，在错误数据已经入库之后。它认出“连续多日、较小的一列等于上期累计加缺口、较大的一列等于上期复权乘单位涨跌”，并且至少连续两天才换列。这是事后补救，不是写入原因。SXL292 的 9 月 29 日夹在方向正确的 9 月 24 日后面，只有单独一天，凑不满两天，仍然掉进比例重接，所以 1.4928 还在。")
    add_para(
        doc,
        "2026-09-07 提交 117c0098 的说明里有一句“解析中信【基金净值】公告时不要把单位净值和累计净值对调”。那是邮件解析里单位净值与累计净值这一对，改的是 email-nav-extract 和中信修复脚本。同一提交里顺带加了周五火富牛列表抓取。列表字段写反不是把中信那条规则搬过来，两对字段也不一样：中信修的是单位净值对累计净值，这里写反的是累计净值对复权净值。",
    )
    add_para(
        doc,
        "用 9 月 29 日把比例重接再算一遍。上一行 9 月 24 日列是正的：累计净值 1.387900，复权净值 1.439307。当天列表写入后，函数把 1.439445 读成累计、把 1.388000 读成过低的复权。1.439307 × 1.439445 / 1.387900 = 1.492761。火富牛的复权净值 1.439445 已经在被当成累计的那一列里。再乘 1.439307 / 1.387900（约 1.037）等于把原有的复权溢价又乘了一次。",
    )

    add_heading(doc, "十一、修这里会不会碰到别的产品", 1)
    add_para(
        doc,
        "只改列表写入的字段对应，不会碰到别的计算。改成 price_cnw 写入 cum_nav_withdrawal、price_cw_nav 写入 cumulative_nav，就和多基金净值、接口文档同一方向。邮件净值、中信单位/累计修复、SQX078 那条 15% 大缺口互换、分红日的复权公式都不会走到这段代码。新写入的列表日期会和 9 月 24 日一样，两列直接就是火富牛的累计净值和复权净值。",
    )
    add_para(
        doc,
        "只改写入，清不掉已经入库的行。ON CONFLICT DO NOTHING 不会用新方向覆盖旧行。9 月 4 日、11 日、18 日如果读出端那条“连续两天”的换列还在，详情页有机会在读的时候换回来；9 月 29 日只有一天，比例重接仍会得到 1.4928。所以页面要和火富牛一致，还得把已经由 fri-pm-日期-p页码 写入的行两列对调过来。只动这种批次：它们是唯一用反了的写入器。批次名带 m、以及 2026-08-28-0044 这种周频多基金净值，列本来就是对的，不能再对调一次。",
    )
    add_para(
        doc,
        "对调之后，cum_nav_withdrawal 低于 cumulative_nav，15% 互换和连续换列都因为“累计列并没有高于复权列”而不会再动手，比例重接同样因为复权已经不低于累计而跳过。SXL292 的 9 月 29 日变成累计净值 1.3880、复权净值 1.4394，不会被修成第三个数。",
    )
    add_para(
        doc,
        "不能用放宽读出规则来代替改写入。如果把 15% 降到能罩住 4.9%，或者允许单独一天也按连续换列来交换，会撞上京盈智投博远 STE102 那条回归。测试里 2026-09-10 的存法是：单位净值 3.206，cumulative_nav 3.306，cum_nav_withdrawal 3.471837。用和 SXL292 相同的验算，3.306 正好等于单位净值加上上期累计缺口，3.471837 正好等于上期复权乘单位涨跌，误差在 0.0005 以内。测试要求这一天不要交换，累计净值留在 3.471837，复权净值按比例重接成 3.642336。全局改成“单独一天也对调”，这一条会失败，累计净值会被换成 3.306。那是另一只产品、另一种存法，不该靠放宽 SXL292 的门槛一起改掉。",
    )
    add_para(
        doc,
        "因此安全的修法是两处，而且只这两处：列表写入改对字段；历史行只交换批次名匹配 fri-pm-*-p* 的那两列。不要改 SQX078 的 15% 门槛，也不要把 STE102 那种单独一天的比例重接改成一律对调。",
    )

    rules = write_rule_charts()

    add_heading(doc, "十二、先前几条规则各自在修什么", 1)
    add_para(
        doc,
        "这几条规则修的不是同一对字段，也不是同一种错误。SXL292 的列表入库写反，是累计净值列和复权净值列。下面三条都碰不到这个写入。",
    )

    add_heading(doc, "12.1 中信【基金净值】：单位净值和累计净值被读成同一个数", 2)
    add_para(
        doc,
        "中信自动披露的表格表头是“单位净值”和“累计单位净值”。旧解析用“单位净值”四个字去对表头，累计单位净值也含这四个字，于是两个格子都读成累计单位净值。GM266C 的例子：单位净值应为 1.3398，累计单位净值应为 1.6983，旧结果是单位净值也写成 1.6983。产品看起来没有分红缺口，涨跌幅按累计的水平在跳。",
    )
    add_para(
        doc,
        "2026-09-07 的修改在邮件解析里排除“累计单位净值”这个表头，只让真正的“单位净值”列进单位净值。这是读邮件附件时的表头规则，写的是 ops_email_nav_records 的 nav 和 cumulative_nav。它不读火富牛列表的 price_cnw、price_cw_nav，也不写 private_fund_nav。SXL292 的 9 月 4 日行不是这封中信邮件产生的。",
    )
    add_picture(doc, rules["citics"])

    add_heading(doc, "12.2 SQX078 的 15% 换列：累计和复权整列放反，缺口很大", 2)
    add_para(
        doc,
        "特夫郁金香全量化 SQX078 在 2026-05-18 的页面是单位净值 1.0889、累计净值 2.7925、复权净值 2.2526。复权低于累计，违反复权 ≥ 累计 ≥ 单位。对照前后日期，正确的是把两列对调：累计净值 2.2526，复权净值 2.7925。两列相差 0.5399，除以单位净值 1.0889 约等于 49.6%，远高于 15%。",
    )
    add_para(
        doc,
        "repairAdjBelowCumRows 修不了这种行。它不换列，只把较小的复权按上期比例抬高，抬完仍然用错的那一列当累计，序列还是歪的。所以 2026-07-03 加了 repairSwappedCumAdjRows：只有差幅达到单位净值的 15% 才交换两列。SXL292 两列只差约 0.051，占单位净值 4.9%，这条 15% 规则不会动它。把门槛降到 4.9% 会让 SQX078 这种大缺口和 SXL292 这种小缺口走同一条路，也会让 STE102 那种不该换列的日子被换掉。",
    )
    add_picture(doc, rules["sqx"])

    add_heading(doc, "12.3 分红公式：单位净值下跌，累计净值不跟着跌", 2)
    add_para(
        doc,
        "荣熙恒盈2号 SBAH99 在 2026 年劳动节后（约 5 月 6 日）每单位分红约 0.21。除息日单位净值跳下去，累计净值停在原水平附近，因为累计净值等于单位净值加上历史上已分的红利。复权净值要把这笔红利当成再投资，所以应当留在累计净值之上，不能跟着单位净值掉下去。",
    )
    add_para(
        doc,
        "旧公式在除息日用上期复权 × 本期累计 / 上期累计。累计几乎没变，复权就被收成和累计一样。后面的日子若再按单位净值涨跌去接复权，单位净值低于除息日时，复权会掉到累计下面。示意图里的数是按这个机制算的，不是 SBAH99 当天的原表：分红前三者都是 1.30；除息日单位净值 1.09、累计净值 1.28（红利约 0.21，累计略降）。错误路径把复权收成 1.28，其后单位净值 1.00、累计净值 1.19 时按单位涨跌得到 1.28 × 1.00 / 1.09 = 1.174，低于累计净值 1.19。正确路径在除息日用单位跌幅把红利再投资，复权仍为 1.30，其后按累计涨跌得到 1.30 × 1.19 / 1.28 = 1.209，仍高于累计净值。",
    )
    add_para(
        doc,
        "这套公式假定 cum_nav_withdrawal 真的是累计净值、cumulative_nav 真的是复权净值。SXL292 列表行把这两个含义写反之后，同一条公式会把火富牛的复权净值 1.439445 当成累计，再乘上期复权/累计，得到 1.4928。分红公式本身没有把 9 月 4 日写进库里。它只在读出时，在列已经反了的前提下，多算了一次。",
    )
    add_picture(doc, rules["div"])

    add_heading(doc, "十三、复途神舟一号的邮件和火富牛各占哪一段", 1)
    add_para(
        doc,
        "详情页上 2026-09-29 的单位净值 1.0449，以及被写反、又被修成 1.4928 的那两列，全部来自 private_fund_nav，也就是火富牛。抓取日志里这些日期的批次是周频多基金净值或周五列表，没有邮件批次。2026-10-08 查询 ops_email_nav_records，product_code 或 fund_name 含“神舟一号”、或代码为 SXL292 的记录是 0 行。团队手工净值同样是 0 行。详情合并时，来源标记为 fof99 的行只接受托管净值邮件（净值表、业绩报酬试算）覆盖；虚拟净值邮件不算托管净值邮件，有火富牛行的日期会跳过它。",
    )
    add_para(
        doc,
        "邮箱里确实有这只产品的名字。本地解析记录 data/ops_email_parse_records.json 里有 6 封，发件人 gfwbfa@gf.com.cn（广发证券），邮箱 data@jinyuasset.com，主题都是“复途神舟一号私募证券投资基金-金舆程安一号私募证券投资基金-虚拟净值-日期”，日期为 2026-09-22、09-23、09-24、09-28、09-29、09-30。解析状态是净值表成功。按广发、中泰、中信建投同类主题的约定，第一个基金名是底层产品，第二个是持有它的 FOF（金舆程安一号）。这是该持有人份额上的虚拟净值，用来反映业绩报酬计提后的份额价值，不是火富牛页面上的单位净值、累计净值、复权净值三列。",
    )
    add_table(
        doc,
        ["来源", "SXL292 有没有", "会不会成为详情页这三列"],
        [
            ["火富牛多基金净值 / 周五列表", "有，2022-09-30 起周频，219 行在 private_fund_nav", "会。页面上的数就是这些行，再经过读出修复"],
            ["广发虚拟净值邮件（6 封）", "解析记录里有，主题含复途神舟一号", "不会覆盖已有火富牛日期。虚拟净值不是托管净值表"],
            ["托管净值表 / 团队手工净值", "按备案号和基金名未查到入库行", "没有可覆盖的行"],
        ],
    )
    add_para(
        doc,
        "所以不是“一部分日期用火富牛、一部分日期用邮件拼成现在这条复权曲线”。1.4928 只出现在火富牛列表行被读出公式重算之后。虚拟净值邮件即使解析成功，也不解释 9 月 4 日两列为什么对调。",
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT)
    print(OUT)


if __name__ == "__main__":
    build()
