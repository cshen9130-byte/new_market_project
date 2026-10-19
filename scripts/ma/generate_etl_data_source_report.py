# -*- coding: utf-8 -*-
"""Chinese Word report: PostgreSQL ETL data sources and Choice API shutdown impact.

Numbers are a snapshot of the production market_data database taken on 2026-10-12.
"""
from __future__ import annotations

import os
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor
from matplotlib.font_manager import FontProperties, fontManager

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "reports"
CHART_DIR = OUT_DIR / "_etl_source_charts"
REPORT_PATH = OUT_DIR / "数据源与Choice停用影响分析.docx"

NAVY = RGBColor(0x1A, 0x36, 0x5D)
TEXT = RGBColor(0x2D, 0x37, 0x48)
MUTED = RGBColor(0x64, 0x74, 0x8B)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
RED = RGBColor(0xC5, 0x30, 0x30)
GREEN = RGBColor(0x2F, 0x85, 0x5A)
ORANGE = RGBColor(0xC0, 0x56, 0x21)

C_NAVY = "#1A365D"
C_TEAL = "#2B6CB0"
C_GOLD = "#C9A227"
C_GREEN = "#2F855A"
C_RED = "#C53030"
C_ORANGE = "#DD6B20"
C_GRAY = "#718096"
C_PURPLE = "#6B46C1"

_CN_FONT: FontProperties | None = None


def configure_matplotlib() -> None:
    global _CN_FONT
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["figure.facecolor"] = "white"
    plt.rcParams["axes.facecolor"] = "white"
    plt.rcParams["axes.edgecolor"] = "#CBD5E0"
    plt.rcParams["axes.grid"] = False
    for path in [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
    ]:
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
    p.paragraph_format.line_spacing = 1.15
    if align:
        p.alignment = align
    if text:
        add_text(p, text, size=size, bold=bold, color=color)
    return p


def heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        set_run_font(run, size=16 if level == 1 else 13, bold=True, color=NAVY)
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
    borders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "CBD5E0")
        borders.append(el)
    tcPr.append(borders)


def cell_text(cell, text, *, size=8, bold=False, color=None, align="center"):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    if align == "center":
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    elif align == "right":
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    else:
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    add_text(p, "" if text is None else str(text), size=size, bold=bold, color=color or TEXT)
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
            align = "left" if c_i == 0 else "center"
            cell_text(table.rows[r_i + 1].cells[c_i], val, size=8, color=TEXT, align=align)
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
    run = p.add_run()
    run.add_picture(str(path), width=Inches(width_in))
    return p


def caption(doc, text: str):
    para(doc, text, size=8, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)


def _barh(path: Path, labels, values, colors, title, xlabel):
    fig_h = max(3.2, 0.42 * len(labels) + 1.2)
    fig, ax = plt.subplots(figsize=(7.4, fig_h))
    y = list(range(len(labels)))[::-1]
    ax.barh(y, values, color=colors, height=0.62)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, **fp(), fontsize=10)
    ax.set_xlabel(xlabel, **fp(), fontsize=10)
    ax.set_title(title, **fp(), fontsize=13, color="#1A365D", pad=10)
    xmax = max(values) if values else 1
    for yi, v in zip(y, values):
        ax.text(v + xmax * 0.015, yi, f"{v:,}", va="center", fontsize=9, color="#2D3748", **fp())
    ax.set_xlim(0, xmax * 1.18)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def build_charts() -> dict[str, Path]:
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    charts = {}

    p = CHART_DIR / "steps_by_source.png"
    labels = [
        "AkShare 及免费行情",
        "内部加工 / 邮件 / 协会 / 文件",
        "Choice / EmQuant 直接拉取",
        "依赖 Choice 的派生计算",
        "混合源",
        "Tushare",
    ]
    values = [19, 17, 12, 8, 2, 1]
    colors = [C_GRAY, C_TEAL, C_RED, C_ORANGE, C_GOLD, C_PURPLE]
    _barh(p, labels, values, colors, "夜间 ETL 59 个步骤的上游归属", "步骤数")
    charts["steps"] = p

    p = CHART_DIR / "rows_all.png"
    labels = ["Choice / EmQuant", "AkShare 及交易所公开", "指数免费源", "Tushare"]
    values = [2_122_657, 467_182, 32_408, 12_973]
    colors = [C_RED, C_TEAL, C_GREEN, C_PURPLE]
    _barh(p, labels, values, colors, "行情相关表已入库行数（含 A 股历史）", "行数")
    charts["rows_all"] = p

    p = CHART_DIR / "rows_ex_ashare.png"
    labels = ["Choice / EmQuant", "AkShare 及交易所公开", "指数免费源", "Tushare"]
    values = [355_976, 145_845, 32_408, 12_973]
    _barh(p, labels, values, colors, "去掉 A 股日行情后的行数", "行数")
    charts["rows_ex"] = p

    p = CHART_DIR / "impact.png"
    labels = ["会停止更新", "字段变薄，部分仍更新", "继续按原节奏更新"]
    values = [8, 2, 5]
    colors = [C_RED, C_ORANGE, C_GREEN]
    _barh(p, labels, values, colors, "停用 Choice 后，业务功能分组", "功能组数量")
    charts["impact"] = p

    # freshness: days since 2026-10-09 as the reference session
    p = CHART_DIR / "freshness.png"
    labels = [
        "A股日行情（AkShare）",
        "南华商品指数 NHCI",
        "6只ETF",
        "股指现货",
        "商品成交额",
        "期权希腊字母",
        "社融 AFRE（月）",
        "货币信用周期（月）",
        "股指连续（Tushare）",
    ]
    # use a simple categorical bar of "latest label encoded as offset from a baseline"
    # Show latest date as text via bar length = recency score: 10 = current session, lower = older
    scores = [10, 10, 10, 10, 10, 10, 4, 4, 1]
    fig, ax = plt.subplots(figsize=(7.4, 4.6))
    y = list(range(len(labels)))[::-1]
    bar_colors = [C_TEAL, C_RED, C_RED, C_RED, C_RED, C_RED, C_ORANGE, C_ORANGE, C_PURPLE]
    ax.barh(y, scores, color=bar_colors, height=0.62)
    notes = [
        "2026-10-09",
        "2026-10-09",
        "2026-10-09",
        "2026-10-09",
        "2026-10-09",
        "2026-10-12",
        "2026-08",
        "2026-08",
        "2026-06-05",
    ]
    ax.set_yticks(y)
    ax.set_yticklabels(labels, **fp(), fontsize=10)
    ax.set_xlabel("越长表示越接近最近交易日（示意）", **fp(), fontsize=10)
    ax.set_title("关键序列最新日期", **fp(), fontsize=13, color="#1A365D", pad=10)
    for yi, note in zip(y, notes):
        ax.text(0.25, yi, note, va="center", fontsize=9, color="white", **fp())
    ax.set_xlim(0, 12)
    ax.set_xticks([])
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["bottom"].set_visible(False)
    fig.tight_layout()
    fig.savefig(p, dpi=140)
    plt.close(fig)
    charts["fresh"] = p
    return charts


def build_doc(charts: dict[str, Path]) -> None:
    doc = Document()
    section = doc.sections[0]
    section.top_margin = Cm(1.8)
    section.bottom_margin = Cm(1.8)
    section.left_margin = Cm(1.8)
    section.right_margin = Cm(1.8)
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)

    para(doc, "内部分析报告", size=11, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    para(
        doc,
        "PostgreSQL 数据来源盘点\n以及停用 Choice API 的影响",
        size=22,
        bold=True,
        color=NAVY,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        space_after=6,
    )
    para(
        doc,
        "统计时点：2026-10-12　　库：market_data　　范围：服务器 PostgreSQL 与夜间 ETL",
        size=10,
        color=MUTED,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        space_after=14,
    )

    heading(doc, "1. 结论", 1)
    para(
        doc,
        "停掉 Choice（东财 EmQuant）不会让整套系统停摆。私募净值、邮件估值、在管产品、协会备案、MOM 成交持仓文件、监控中心结算单、A 股行情和期权隐含波动率都会继续更新。已经入库的历史行情也不会消失。",
    )
    para(
        doc,
        "会停在最后一根 K 线上的，是仍然只靠 Choice 续上的那几块：宏观 PCA 聚类、南华指数家族、商品成交额热力图、期权逐合约希腊字母，以及以后新公布的社融存量同比。股指现货在代码里写了 Tushare 备用，但库里目前 6,592 行全部是 EmQuant，备用源并没有写出数据。",
    )
    para(
        doc,
        "A 股已经切走。raw_ashare_daily 里 176.7 万行历史标记为 choice，最新日期停在 2026-07-13；自那以后的增量是 akshare_sina_daily，最新到 2026-10-09。环境变量 ASHARE_DATA_SOURCE 未设置时，夜间任务默认走 AkShare。",
        space_after=10,
    )

    heading(doc, "2. 库有多大，数据从哪来", 1)
    para(
        doc,
        "2026-10-12 连上服务器库后，public 有 172 张表，约 7.7 GB；account_risk 有 19 张表，约 18 MB。单账户风控只写 account_risk 与 cfmmc_*，不走 Choice。",
    )
    para(doc, "体积最大的几张表都不是 Choice 行情：", space_after=4)
    add_table(
        doc,
        ["表", "约占用", "估计行数", "实际来源"],
        [
            ["private_fund_nav", "1.76 GB", "约 372 万", "火富牛 fof99 与历史净值"],
            ["basicinfo_bfl_track", "565 MB", "约 25 万", "内部产品跟踪"],
            ["raw_ashare_daily", "433 MB", "208.8 万（精确）", "历史 Choice，增量 AkShare"],
            ["kb_chunks", "426 MB", "约 2.1 万", "内部知识库"],
            ["mom_position_details", "399 MB", "约 93 万", "MOM 投顾 xlsx"],
            ["ops_email_valuation_holdings", "370 MB", "约 26 万", "托管邮件估值表"],
            ["cfmmc_positions", "364 MB", "约 115 万", "监控中心结算文件"],
            ["amac_private_funds", "336 MB", "约 25 万", "基金业协会网站"],
            ["ops_email_nav_records", "192 MB", "约 20 万", "托管净值邮件"],
        ],
    )
    caption(doc, "图外说明：除 raw_ashare_daily 外，行数为规划器估计，用于看量级。行情表下文使用精确计数。")

    para(
        doc,
        "写入 PostgreSQL 的任务不止一条夜间脚本。北京时间大致是：01:00 全量 nightly_etl；02:30 宏观组；03:00 股票组；03:15 期货期权组；04:45 协会名单；19:30 MOM xlsx。应用进程里还有：每 5 分钟扫净值邮件，工作日 17:00 拉监控中心、18:30 跑单账户 ETL，周五 16:00 拉火富牛。",
    )

    heading(doc, "3. 夜间 ETL 的 59 个步骤", 1)
    para(
        doc,
        "编排器是 scripts/ma/nightly_etl.py 的 ORDERED_STEPS，共 59 步。按代码里的真实上游归类：Choice 直接拉取 12 步，依赖这些输入的派生计算 8 步，AkShare 及免费行情 19 步（含涨跌家数、拥挤度，以及两步期货修复），Tushare 目前只单独承担 1 步（股指期货最新快照），混合源 2 步，其余 17 步是邮件、协会、文件和内部加工。股指连续合约的补缺会先试 Tushare，库里 2026-06-05 之后实际写出的是 AkShare，因此这一步计在免费行情里。",
    )
    add_picture(doc, charts["steps"])
    caption(doc, "图 1  夜间 59 步按上游分组。内部加工含协会、邮件、估值表、合同抽取和缓存预热。")

    add_table(
        doc,
        ["分组", "步骤", "写入或刷新"],
        [
            ["Choice 直接拉取", "nhci / nheci", "raw_nhci_daily、raw_nheci_daily"],
            ["Choice 直接拉取", "nanhua_indices / commodity", "17 个板块指数、80 个单商品指数"],
            ["Choice 直接拉取", "futures_contracts_ohlcv", "MOM 成交过的合约日行情"],
            ["Choice 直接拉取", "options_contracts_ohlcv", "期权 OHLCV 与希腊字母"],
            ["Choice 直接拉取", "spot_closes", "股指现货收盘"],
            ["Choice 直接拉取", "commodity_amounts", "商品成交额热力图"],
            ["Choice 直接拉取", "etf_prices / backfill", "6 只 PCA 用 ETF"],
            ["Choice 直接拉取", "afre", "社融存量同比 CSV，再进月频表"],
            ["AkShare", "ashare_*", "A 股日行情、指数、板块、资金流"],
            ["AkShare", "akshare_futures_daily", "87 个连续主力，供 VaR"],
            ["AkShare", "option_iv / commodity_option_iv", "金融期权 IV、QVIX、商品期权 IV"],
            ["AkShare", "exchange daily / 换月 / 中金所月份", "量仓、换月日、合约年化基差"],
            ["Tushare + AkShare", "futures_latest / gapfill", "股指连续合约；Tushare 已停在 6 月"],
            ["协会 / 邮件 / 文件", "amac_*、email、mom、cfmmc", "备案、净值、成交、结算单"],
        ],
    )
    caption(doc, "表 1  步骤与落表。派生步骤（基差、PCA、体制相似性、货币信用）不单独拉外部数据。")

    heading(doc, "4. 行情表里各来源占多少行", 1)
    para(
        doc,
        "把带 source 字段、且已精确计数的行情表加总：Choice / EmQuant 2,122,657 行，AkShare 及交易所公开接口 467,182 行，中证、申万、QQ、东财等指数源 32,408 行，Tushare 12,973 行。Choice 行数大，主要因为 A 股历史仍标着 choice。",
    )
    add_picture(doc, charts["rows_all"])
    caption(doc, "图 2  含 A 股历史的行数。Choice 柱里有 1,766,681 行 A 股日行情。")
    para(
        doc,
        "去掉 raw_ashare_daily 之后，Choice / EmQuant 仍有 355,976 行，AkShare 及交易所 145,845 行。这 36 万行才是现在每天还在向 Choice 续的主体：南华、ETF、期权希腊字母、合约行情、现货和成交额。",
    )
    add_picture(doc, charts["rows_ex"])
    caption(doc, "图 3  不含 A 股日行情。用来看“还在依赖 Choice 的存量”。")

    add_table(
        doc,
        ["表", "行数", "来源构成", "最新日期"],
        [
            ["raw_ashare_daily", "2,088,018", "choice 176.7 万；sina 26.1 万；hist 6.1 万", "增量至 2026-10-09"],
            ["raw_futures_contracts_daily", "257,861", "emquant 14.8 万；交易所公告约 10.6 万", "2026-10-09"],
            ["raw_options_contracts_daily", "109,959", "全部 emquant", "2026-10-12"],
            ["raw_nanhua_commodity_indices_daily", "34,160", "全部 emquant", "2026-10-12"],
            ["raw_akshare_futures_daily", "33,494", "全部 akshare", "2026-10-09"],
            ["raw_ashare_index_daily", "32,008", "中证 / QQ / 申万 / 东财等", "2026-10-09"],
            ["raw_nanhua_indices_daily", "19,585", "全部 emquant", "2026-10-09"],
            ["raw_etf_daily", "19,859", "emquant 19,459；eastmoney 400", "EmQuant 至 10-09"],
            ["raw_futures_daily", "14,524", "tushare 12,973；akshare 1,551", "AkShare 至 10-09"],
            ["raw_commodity_amount_daily", "12,201", "全部 choice", "2026-10-09"],
            ["raw_spot_daily", "6,592", "全部 emquant", "2026-10-09"],
            ["raw_nhci_daily", "5,433", "全部 emquant", "2004 年起，至 10-09"],
            ["raw_nheci_daily", "426", "全部 emquant", "2026-10-09"],
        ],
    )
    caption(doc, "表 2  行情表精确行数。多数最新完整交易日是 2026-10-09（周五）。期权与南华单商品指数的最大日期是 10 月 12 日。")

    add_picture(doc, charts["fresh"])
    caption(doc, "图 4  关键序列最新日期。红色仍由 Choice 续上；青色已由 AkShare 续上；紫色的 Tushare 连续合约停在 2026-06-05。")

    heading(doc, "5. 停用 Choice 之后会怎样", 1)
    para(
        doc,
        "历史行留在库里，页面仍能打开，只是日期不再往前走。下面按业务功能而不是按表来判断。",
    )
    add_picture(doc, charts["impact"])
    caption(doc, "图 5  功能组：8 组会停更，2 组变薄，5 组继续更新。")

    heading(doc, "5.1 会停止更新", 2)
    add_table(
        doc,
        ["功能", "依赖", "停用后的表现"],
        [
            ["宏观 PCA、经济象限、预测时序、资产收益", "6 只 ETF 的 ORIGINALUNIT + 南华商品指数", "预测要求当天 6 只 ETF 和 NHCI 全部有数。Choice 停后，current_market_prediction 停在 2026-10-09"],
            ["南华商品指数、能化指数", "raw_nhci_daily、raw_nheci_daily", "期货页、MOM 蜡烛、波动相关散点不再有新收盘"],
            ["南华 17 个板块指数", "raw_nanhua_indices_daily", "板块图、量化策略对照、周报期货部分停在 10-09"],
            ["南华 80 个单商品指数", "raw_nanhua_commodity_indices_daily", "含黄金交易对照。没有第二数据源"],
            ["商品成交额热力图", "raw_commodity_amount_daily", "12,201 行全部是 choice，接口只读这张表的最新交易日"],
            ["期权逐合约行情与希腊字母", "raw_options_contracts_daily", "109,959 行全部是 EmQuant，含 Delta、Gamma、Vega、Theta、隐含波动率"],
            ["股指现货与优先用它的基差", "raw_spot_daily，基差计算优先 emquant", "代码会再试 Tushare，但库中 Tushare 行数为 0。现货不更新，年化基差的现货腿一起停"],
            ["社融驱动的体制相似性、货币信用", "Choice EDB 代码 EMM00191807", "社融最新月份是 2026-08。AkShare 备用在脚本里注明当前不可用"],
        ],
    )
    caption(doc, "表 3  停用后会冻结的功能。已有曲线仍可查询。")

    para(
        doc,
        "社融需要单独看。货币信用表 money_credit_cycle 的最新月份已经是 2026-08-31。M1 和 CPI（AkShare）也停在 2026-08，PMI 到 2026-09，国债收益率和体制模型里的南华指数到 2026-10。体制相似性取“七个指标都有数”的最新月份，所以图表现在就卡在 8 月，并不只是 Choice 的问题。停用 Choice 的实际损失是：官方以后公布 9 月、10 月社融时，系统接不进来，这两张宏观图无法再往前走。",
    )

    heading(doc, "5.2 还能更新，但字段变薄", 2)
    para(
        doc,
        "MOM 交易过的期货合约日行情写在 raw_futures_contracts_daily，与交易所公告共用一张表。EmQuant 有 148,161 行，冲突时保留已有的非空字段。AkShare 交易所日报还能继续写入成交量和持仓量（上期所、郑商所、大商所、广期所、中金所，合计 109,700 行）。Choice 停掉之后，新交易日主要只剩量仓，结算价、涨跌、更全的行情字段不再增加。流动性扫描和量化策略里读取结算价的部分会变薄。",
    )
    para(
        doc,
        "量化策略缓存同时读南华指数和 AkShare 连续合约。南华对照停止，基于 raw_akshare_futures_daily 的 VaR 仍可按日更新。这张表 33,494 行，最新 2026-10-09，与 Choice 无关。",
    )

    heading(doc, "5.3 继续按原节奏更新", 2)
    add_table(
        doc,
        ["业务", "来源", "库内现状"],
        [
            ["A 股日行情、名称、涨跌家数、拥挤度", "AkShare，默认源", "增量源 akshare_sina_daily，最新 2026-10-09"],
            ["A 股指数、热门板块、板块资金流", "中证、申万、QQ、东财、AkShare", "指数表 32,008 行，无 Choice 标记"],
            ["股指期货连续、换月、金融/商品期权 IV", "AkShare；Tushare 仅历史", "连续合约 Tushare 停在 2026-06-05，AkShare 补到 10-09。QVIX 至 10-09"],
            ["私募净值、在管产品、跟踪池、FOF 底层", "火富牛、托管邮件、估值表", "private_fund_nav 约 1.7 GB，是全库最大表"],
            ["协会备案、MOM 文件、监控中心、单账户", "协会网站、xlsx、结算单", "近 21 天协会步骤成功；account_risk 约 18 MB"],
        ],
    )
    caption(doc, "表 4  与 Choice 账号解绑后仍会跑的部分。")

    para(
        doc,
        "事件日历来自华尔街见闻。合同要素抽取走大模型。这两项也不经过 Choice。知识库三张表（kb_chunks 等）是内部文档，不受影响。",
    )

    heading(doc, "6. 若决定停用，建议先补的缺口", 1)
    para(doc, "可以按下面的顺序决定保留还是替换。没有替代脚本的功能，停用当天就会停更。", space_after=4)
    add_table(
        doc,
        ["优先级", "缺口", "现状", "可行做法"],
        [
            ["先决策", "成交额热力图、80 与 17 南华指数、期权希腊字母", "没有第二条拉取脚本", "接受冻结，或另找数据源后新写 ETL。不要改 MOM 的 xlsx 导入去凑这三块"],
            ["停用前验证", "股指现货", "Tushare 分支存在，库内 0 行", "先单独跑现货脚本，确认 raw_spot_daily 出现 tushare 行，再停 Choice。否则基差一起停"],
            ["可改接", "南华商品指数 NHCI", "体制模型已用 AkShare spot_hist_nhci_em，失败时才读 Choice 表", "可以把这条免费序列写入 raw_nhci_daily。它不能替代 17 个和 80 个指数"],
            ["不能直接顶上", "6 只 ETF", "eastmoney 只有 400 行，停在 2026-08-25", "要换源就得重拉 ORIGINALUNIT 历史，并重跑日、周、月 PCA"],
            ["官方数据节奏", "社融存量同比", "Choice EDB；AkShare 备用已注明不可用", "停用后 8 月之后的社融进不来。M1、CPI 本身也还在 8 月"],
            ["不必为它留账号", "A 股", "2026-07-13 之后已是 AkShare", "保持默认源即可。Choice 历史行继续留在表里"],
        ],
    )
    caption(doc, "表 5  停用前的替换顺序。")

    heading(doc, "7. 口径", 1)
    para(
        doc,
        "行数、最新日期和 source 分布来自 2026-10-12 对服务器 market_data 的只读查询。最大表的行数来自 PostgreSQL 规划器估计，行情表为 COUNT(*)。步骤归属来自 nightly_etl.py 与各拉取脚本，并与库内 source 核对。近 21 天 pipeline_runs 里，Choice 相关步骤均为成功；email_nav_parse、investment_pool_metrics、private_fund_indicators 在全量夜间任务中失败，这与 Choice 无关，邮件另有每 5 分钟的轮询。",
    )
    para(
        doc,
        "Choice 在代码和库里的标记有两个名字：EmQuant（指数、ETF、现货、合约、期权）和 choice（成交额、A 股历史、社融）。二者是同一套东财接口。",
        space_after=4,
    )

    doc.save(REPORT_PATH)
    print(REPORT_PATH)


def main() -> None:
    configure_matplotlib()
    charts = build_charts()
    build_doc(charts)


if __name__ == "__main__":
    main()
