# -*- coding: utf-8 -*-
"""Render JY tracking-pool weekly alpha/beta attribution Word report from JSON payload."""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties, fontManager
import numpy as np
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor

NAVY = RGBColor(0x1F, 0x4E, 0x79)
TEXT = RGBColor(0x2D, 0x37, 0x48)
MUTED = RGBColor(0x64, 0x74, 0x8B)
RED = RGBColor(0xC0, 0x00, 0x00)
GREEN = RGBColor(0x00, 0x66, 0x00)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
GOLD = RGBColor(0xB8, 0x86, 0x0B)

C_NAVY = "#1F4E79"
C_RED = "#C53030"
C_GREEN = "#2F855A"
C_TEAL = "#2B6CB0"
C_GOLD = "#C9A227"
C_ORANGE = "#DD6B20"
C_GRAY = "#718096"

_CN_FONT: FontProperties | None = None
_XML_UNSAFE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\ud800-\udfff\ufffe\uffff]")


def xml_safe(value) -> str:
    """python-docx/lxml reject NULL and most C0/C1 control chars."""
    if value is None:
        return ""
    text = str(value).replace("\x00", "")
    text = text.replace("\u2028", "\n").replace("\u2029", "\n").replace("\ufeff", "")
    text = _XML_UNSAFE.sub("", text)
    return text.replace("\r\n", "\n").replace("\r", "\n")


def sanitize_payload(value):
    if isinstance(value, str):
        return xml_safe(value)
    if isinstance(value, list):
        return [sanitize_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_payload(item) for key, item in value.items()}
    return value


def configure_matplotlib() -> None:
    global _CN_FONT
    plt.rcParams["axes.unicode_minus"] = False
    candidates = [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.otf",
        str(Path(__file__).resolve().parents[2] / "haitai_week_report" / "fonts" / "NotoSansSC-Regular.otf"),
    ]
    env_font = os.environ.get("FOF_REPORT_FONT_PATH", "").strip()
    if env_font:
        candidates.insert(0, env_font)
    for path in candidates:
        if path and os.path.isfile(path):
            try:
                fontManager.addfont(path)
                _CN_FONT = FontProperties(fname=path)
                plt.rcParams["font.family"] = "sans-serif"
                plt.rcParams["font.sans-serif"] = [_CN_FONT.get_name(), "Microsoft YaHei", "SimHei", "Noto Sans CJK SC"]
                return
            except Exception:
                continue
    _CN_FONT = FontProperties(family="Microsoft YaHei")


def fp() -> dict:
    return {"fontproperties": _CN_FONT} if _CN_FONT is not None else {}


def set_run_font(run, *, size=11, bold=False, color=None, name="微软雅黑"):
    run.font.name = name
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    rFonts.set(qn("w:ascii"), name)
    rFonts.set(qn("w:hAnsi"), name)
    rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def add_text(p, text, *, size=11, bold=False, color=None):
    safe = xml_safe(text)
    try:
        run = p.add_run(safe)
    except ValueError:
        safe = "".join(ch for ch in safe if ch in "\t\n\r" or ord(ch) >= 32)
        run = p.add_run(safe)
    set_run_font(run, size=size, bold=bold, color=color)
    return run


def para(doc, text="", *, size=11, bold=False, color=None, align=None, space_after=8, space_before=0):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.line_spacing = 1.25
    if align:
        p.alignment = align
    if text:
        add_text(p, text, size=size, bold=bold, color=color)
    return p


def heading(doc, text, level=1):
    safe = xml_safe(text)
    try:
        p = doc.add_heading(safe, level=level)
    except ValueError:
        safe = "".join(ch for ch in safe if ch in "\t\n\r" or ord(ch) >= 32)
        p = doc.add_heading(safe, level=level)
    for run in p.runs:
        if run.text:
            run.text = xml_safe(run.text)
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
    if align == "center":
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    elif align == "right":
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    else:
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    add_text(p, xml_safe("" if text is None else text), size=size, bold=bold, color=color)
    set_cell_border(cell)


def signed_color(text: str):
    s = str(text or "")
    if s.startswith("+") or (s.endswith("%") and not s.startswith("-") and s not in ("0.00%", "—", "")):
        if s.startswith("-"):
            return GREEN
        if s.startswith("+"):
            return RED
    if s.startswith("-"):
        return GREEN
    return TEXT


def add_table(doc, headers, rows, col_widths=None):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    for i, h in enumerate(headers):
        cell_text(table.rows[0].cells[i], h, size=8, bold=True, color=WHITE)
        shade(table.rows[0].cells[i], "1F4E79")
    for r_i, row in enumerate(rows):
        fill = "F7FAFC" if r_i % 2 == 0 else "FFFFFF"
        for c_i, val in enumerate(row):
            text = "" if val is None else str(val)
            color = signed_color(text) if c_i else TEXT
            cell_text(
                table.rows[r_i + 1].cells[c_i],
                text,
                size=8,
                color=color,
                align="center" if c_i else "left",
            )
            shade(table.rows[r_i + 1].cells[c_i], fill)
    if col_widths:
        for row in table.rows:
            for i, w in enumerate(col_widths):
                if i < len(row.cells):
                    row.cells[i].width = Cm(w)
    return table


def fmt_pct(v, digits=2, signed=True):
    if v is None:
        return "—"
    x = float(v)
    if abs(x) > 2:
        x = x / 100.0 if abs(x) > 5 else x
    x *= 100
    sign = "+" if signed and x > 0 else ""
    return f"{sign}{x:.{digits}f}%"


def fmt_num(v, digits=2):
    if v is None:
        return "—"
    return f"{float(v):.{digits}f}"


def driver_fill(driver: str) -> str:
    if driver == "alpha":
        return "C6F6D5"
    if driver == "beta":
        return "FED7D7"
    return "FEFCBF"


def savefig(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(path, dpi=160, bbox_inches="tight", facecolor="white")
    plt.close()


def add_image(doc, path: Path, width=6.4):
    if not path.is_file():
        return
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(path), width=Inches(width))
    p.paragraph_format.space_after = Pt(8)


def chart_market(payload: dict, charts: Path) -> Path | None:
    broad = payload.get("market", {}).get("broad") or []
    names = [x.get("name") for x in broad if x.get("name")]
    vals = [((x.get("ret") or 0) * 100) for x in broad]
    if not names:
        return None
    fig, ax = plt.subplots(figsize=(8.2, 3.4))
    colors = [C_RED if v >= 0 else C_GREEN for v in vals]
    ax.bar(range(len(names)), vals, color=colors)
    ax.set_xticks(range(len(names)))
    ax.set_xticklabels(names, rotation=35, ha="right", **fp())
    ax.axhline(0, color="#CBD5E0", lw=0.8)
    ax.set_ylabel("本周涨跌幅(%)", **fp())
    ax.set_title("宽基指数本周表现", **fp())
    ax.grid(axis="y", alpha=0.25)
    out = charts / "market_broad.png"
    savefig(out)
    return out


def chart_winners(payload: dict, charts: Path) -> Path | None:
    recs = payload.get("recommendations") or []
    if not recs:
        recs = [w for g in payload.get("groups") or [] for w in (g.get("winners") or []) if w.get("driver") != "beta"]
    recs = recs[:10]
    if not recs:
        return None
    names = [x.get("name") or "" for x in recs]
    alpha = [((x.get("week_alpha") or 0) * 100) for x in recs]
    beta = [((x.get("week_beta") or 0) * 100) for x in recs]
    y = np.arange(len(names))
    fig, ax = plt.subplots(figsize=(8.4, max(3.2, 0.42 * len(names) + 1.4)))
    ax.barh(y, beta, color=C_TEAL, label="本周β贡献")
    ax.barh(y, alpha, left=beta, color=C_GOLD, label="本周α/残差")
    ax.set_yticks(y)
    ax.set_yticklabels(names, **fp())
    ax.axvline(0, color="#CBD5E0", lw=0.8)
    ax.set_xlabel("本周收益拆解(%)", **fp())
    ax.set_title("建议关注产品：本周 beta vs alpha", **fp())
    ax.legend(prop=_CN_FONT)
    ax.invert_yaxis()
    ax.grid(axis="x", alpha=0.25)
    out = charts / "recommend_stack.png"
    savefig(out)
    return out


def chart_series(fund: dict, charts: Path) -> Path | None:
    series = fund.get("series") or {}
    dates = series.get("dates") or []
    if len(dates) < 4:
        return None
    fig, ax = plt.subplots(figsize=(8.2, 3.2))
    ax.plot(dates, series.get("fund_cum") or [], color=C_NAVY, lw=1.6, label="产品累计")
    ax.plot(dates, series.get("factor_cum") or [], color=C_TEAL, lw=1.2, label="因子解释累计")
    ax.plot(dates, series.get("alpha_cum") or [], color=C_GOLD, lw=1.4, label="特质/α累计")
    step = max(1, len(dates) // 6)
    ax.set_xticks(dates[::step])
    ax.set_xticklabels(dates[::step], rotation=25, ha="right", **fp())
    ax.set_title(f"{fund.get('name')} 累计收益拆解", **fp())
    ax.legend(prop=_CN_FONT, loc="upper left")
    ax.grid(alpha=0.25)
    ax.axhline(0, color="#CBD5E0", lw=0.8)
    out = charts / f"series_{fund.get('beian_hao')}.png"
    savefig(out)
    return out


def chart_factor_betas(fund: dict, charts: Path) -> Path | None:
    factors = fund.get("factors") or []
    if not factors:
        return None
    names = [x.get("name") for x in factors]
    betas = [x.get("beta") or 0 for x in factors]
    fig, ax = plt.subplots(figsize=(7.6, 2.8))
    colors = [C_TEAL if v >= 0 else C_ORANGE for v in betas]
    ax.bar(range(len(names)), betas, color=colors)
    ax.set_xticks(range(len(names)))
    ax.set_xticklabels(names, rotation=20, ha="right", **fp())
    ax.axhline(0, color="#CBD5E0", lw=0.8)
    ax.set_ylabel("回归系数 β", **fp())
    ax.set_title("样本期因子暴露", **fp())
    ax.grid(axis="y", alpha=0.25)
    out = charts / f"beta_{fund.get('beian_hao')}.png"
    savefig(out)
    return out


def build(payload: dict, output: Path, charts: Path) -> None:
    payload = sanitize_payload(payload)
    configure_matplotlib()
    doc = Document()
    section = doc.sections[0]
    section.top_margin = Cm(1.8)
    section.bottom_margin = Cm(1.8)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)

    range_label = payload.get("range_label") or f"{payload.get('week_start')} ~ {payload.get('week_end')}"
    para(doc, "JY跟踪池 · 周度归因分析", size=22, bold=True, color=NAVY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    para(doc, f"统计区间 {range_label}", size=12, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    para(
        doc,
        f"覆盖 {payload.get('fund_count', 0)} 只股票策略产品 · 分组赢家 {payload.get('winner_count', 0)} 只 · 建议关注 {payload.get('recommend_count', 0)} 只",
        size=11,
        color=TEXT,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        space_after=12,
    )

    heading(doc, "一、研究目的与方法", 1)
    para(
        doc,
        "本报告在周报 Excel 同一套分组与净值口径上，找出各策略本周表现靠前的产品，再用多因子 OLS 把当周收益拆成「市场/风格贝塔」与「基金特质阿尔法」。我们希望筛出超额主要来自选股、交易或对冲能力、且近几周特质收益尚未耗尽的产品，作为本周潜在加仓候选；明显吃指数或风格贝塔的赢家只作对照，不进入买入建议。",
        size=11,
    )
    for line in payload.get("methodology") or []:
        para(doc, "• " + str(line), size=10, color=TEXT, space_after=4)

    heading(doc, "二、本周市场背景", 1)
    img = chart_market(payload, charts)
    if img:
        add_image(doc, img)
    market = payload.get("market") or {}
    broad_rows = [[x.get("name"), x.get("code") or "—", fmt_pct(x.get("ret"))] for x in (market.get("broad") or [])]
    if broad_rows:
        add_table(doc, ["宽基指数", "代码", "本周涨跌幅"], broad_rows)
    style_rows = [[x.get("name"), fmt_pct(x.get("ret"))] for x in (market.get("style") or [])[:8]]
    sector_rows = [[x.get("name"), fmt_pct(x.get("ret"))] for x in (market.get("sector") or [])]
    if style_rows or sector_rows:
        para(doc, "风格与行业：用于判断本周赢家是否踩中大盘成长/微盘等拥挤方向。", size=10, color=MUTED, space_before=8)
        n = max(len(style_rows), len(sector_rows))
        merged = []
        for i in range(n):
            s = style_rows[i] if i < len(style_rows) else ["", ""]
            se = sector_rows[i] if i < len(sector_rows) else ["", ""]
            merged.append([s[0], s[1], se[0], se[1]])
        add_table(doc, ["风格", "涨跌幅", "行业", "涨跌幅"], merged)

    heading(doc, "三、本周建议关注（α 候选）", 1)
    recs = payload.get("recommendations") or []
    if not recs:
        para(doc, "本周各分组赢家的超额更多由市场或风格贝塔解释，未形成足够置信的可延续 alpha 名单。下方仍列出分组赢家供对照。", size=11, color=MUTED)
    else:
        para(
            doc,
            "以下产品同时满足：本周正收益、残差/超额贡献不弱于市场解释、近四周或样本期截距方向支持延续。排序按综合评分。",
            size=11,
        )
        rec_table = []
        for x in recs:
            rec_table.append([
                x.get("name"),
                x.get("bucket"),
                x.get("driver_label"),
                fmt_pct(x.get("week_ret")),
                fmt_pct(x.get("week_alpha")),
                fmt_pct(x.get("week_beta")),
                fmt_num(x.get("r_squared")),
                str(x.get("buy_score")),
            ])
        add_table(doc, ["产品", "策略分组", "驱动", "本周收益", "本周α", "本周β", "R²", "评分"], rec_table)
        img2 = chart_winners(payload, charts)
        if img2:
            add_image(doc, img2)

        for i, fund in enumerate(recs, 1):
            heading(doc, f"3.{i} {fund.get('name')}（{fund.get('bucket')}）", 2)
            para(
                doc,
                f"{fund.get('driver_label')} · 管理人 {fund.get('manager') or '—'} · 备案 {fund.get('beian_hao')} · 样本 {fund.get('n_obs')} 期",
                size=10,
                color=MUTED,
                space_after=6,
            )
            add_table(
                doc,
                ["本周收益", "本周α", "本周β", "α占比", "近1月", "近3月", "近4周特质", "α t值"],
                [[
                    fmt_pct(fund.get("week_ret")),
                    fmt_pct(fund.get("week_alpha")),
                    fmt_pct(fund.get("week_beta")),
                    fmt_pct(fund.get("alpha_share"), signed=False),
                    fmt_pct(fund.get("ret_1m")),
                    fmt_pct(fund.get("ret_3m")),
                    fmt_pct(fund.get("persist_4w")),
                    fmt_num(fund.get("alpha_tstat")),
                ]],
            )
            s_img = chart_series(fund, charts)
            if s_img:
                add_image(doc, s_img, width=6.3)
            b_img = chart_factor_betas(fund, charts)
            if b_img:
                add_image(doc, b_img, width=6.0)
            if fund.get("factors"):
                frows = [[
                    f.get("name"),
                    fmt_num(f.get("beta")),
                    fmt_num(f.get("tStat")),
                    fmt_pct(f.get("weekReturn")),
                    fmt_pct(f.get("weekContribution")),
                ] for f in fund["factors"]]
                add_table(doc, ["因子", "β", "t", "本周因子收益", "本周贡献"], frows)

            para(doc, "买入逻辑", size=11, bold=True, color=NAVY, space_before=8, space_after=2)
            para(doc, fund.get("thesis") or "—", size=11)
            para(doc, "为何可能延续", size=11, bold=True, color=NAVY, space_before=4, space_after=2)
            para(doc, fund.get("continuation") or "—", size=11)
            para(doc, "失效条件", size=11, bold=True, color=NAVY, space_before=4, space_after=2)
            para(doc, fund.get("risks") or "—", size=11)

            if fund.get("roadshows"):
                para(doc, "对应路演 / 尽调结论", size=11, bold=True, color=NAVY, space_before=6, space_after=2)
                for rs in fund["roadshows"]:
                    para(
                        doc,
                        f"{rs.get('date') or ''} {rs.get('company') or ''} {rs.get('manager') or ''} {rs.get('method') or ''} {rs.get('product') or ''}".strip(),
                        size=10,
                        bold=True,
                        space_after=2,
                    )
                    if rs.get("conclusion"):
                        para(doc, rs["conclusion"], size=10, color=TEXT, space_after=6)
            if fund.get("notes"):
                para(doc, "投资笔记摘录", size=11, bold=True, color=NAVY, space_before=4, space_after=2)
                for note in fund["notes"]:
                    para(doc, f"{note.get('date') or ''} {note.get('title') or ''}".strip(), size=10, bold=True, space_after=2)
                    if note.get("excerpt"):
                        para(doc, note["excerpt"], size=10, color=TEXT, space_after=6)
            if fund.get("kb"):
                para(doc, "知识库切片", size=11, bold=True, color=NAVY, space_before=4, space_after=2)
                for kb in fund["kb"]:
                    para(doc, kb.get("source") or "", size=9, color=MUTED, space_after=1)
                    para(doc, kb.get("excerpt") or "", size=10, space_after=6)

    heading(doc, "四、各策略分组本周赢家对照", 1)
    para(doc, "下表覆盖与 Excel 周报相同的策略分组。绿色倾向 α，黄色为混合，红色倾向吃市场/风格。", size=10, color=MUTED)
    for g in payload.get("groups") or []:
        heading(doc, f"{g.get('bucket')}（{g.get('count')} 只）", 2)
        mode = "超额" if g.get("mode") == "excess" else "绝对收益"
        para(doc, f"口径：{mode}。本周取分组内表现靠前且收益为正的产品。", size=10, color=MUTED, space_after=4)
        rows = []
        for x in g.get("winners") or []:
            rows.append([
                x.get("name"),
                x.get("driver_label"),
                fmt_pct(x.get("week_ret")),
                fmt_pct(x.get("week_alpha")),
                fmt_pct(x.get("week_beta")),
                fmt_num(x.get("r_squared")),
                fmt_pct(x.get("persist_4w")),
                "是" if x.get("recommend") else "",
            ])
        if rows:
            add_table(doc, ["产品", "驱动", "本周", "本周α", "本周β", "R²", "近4周特质", "建议关注"], rows)

    heading(doc, "五、使用说明", 1)
    para(
        doc,
        "回归使用产品净值相邻点收益对同期指数收益，因此周频净值产品的「本周」对应最近一个净值区间，不一定等于自然周一至周五。α 判定是研究过滤而非承诺。买入建议需结合容量、申赎开放日、合规与组合约束。",
        size=10,
        color=MUTED,
    )
    para(doc, f"生成时间 {payload.get('generated_at') or ''}", size=9, color=MUTED, space_before=8)

    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(output))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--charts-dir", required=True)
    args = parser.parse_args()
    payload = json.loads(Path(args.input).read_text(encoding="utf-8-sig"))
    build(payload, Path(args.output), Path(args.charts_dir))


if __name__ == "__main__":
    main()
