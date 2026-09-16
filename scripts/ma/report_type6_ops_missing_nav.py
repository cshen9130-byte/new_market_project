#!/usr/bin/env python3
"""Funds in outside_data/type6_运维团队数据_全量.csv with no NAV series in our DB,
plus 火富牛 tracking status. Writes CSV + Word report.
"""
from __future__ import annotations

import ast
import csv
import os
import re
import socket
import subprocess
import sys
import time
from collections import Counter
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties, fontManager
import psycopg2
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "outside_data" / "type6_运维团队数据_全量.csv"
FOF99_LIST = ROOT / "scripts" / "ma" / "fof99_advancedlist_latest_nav.csv"
OUT_DIR = ROOT / "reports"
CHART_DIR = OUT_DIR / "_type6_ops_missing_nav_charts"
CSV_OUT = OUT_DIR / "type6_ops_no_db_nav.csv"
FULL_CSV_CN = OUT_DIR / "运维团队数据全量_库内净值与火富牛跟踪状态.csv"
REPORT_PATH = OUT_DIR / "运维团队数据全量库内无净值与火富牛跟踪状态报告.docx"

YESNO = {"yes": "是", "no": "否"}
POLICY_LABEL = {
    "weekly": "weekly（每周五付费拉取）",
    "weekly_plus": "weekly_plus（邮件优先，落后才拉）",
    "skip": "skip（已确认火富牛无序列，永不重试）",
    "update_slow": "update_slow（火富牛最新净值偏旧，不周更）",
    "": "未纳入跟踪宇宙",
}
NAV_SOURCE_CN = {
    "private_fund_nav": "主净值表",
    "type6": "type6净值表",
    "type6_by_name": "type6净值表(按名称)",
    "group": "分组净值表",
    "hy": "好买净值表",
    "email": "邮件净值",
    "manual": "手工净值",
}
FETCH_STATUS_CN = {
    "ok": "成功",
    "no_data": "无数据",
    "error": "失败",
}
PROBE_CN = {
    "ok": "成功",
    "no_data": "无数据",
    "error": "失败",
}

CN_FIELDS = [
    "备案号",
    "产品简称",
    "产品名称",
    "平台一级策略",
    "平台二级策略",
    "平台三级策略",
    "是否份额类",
    "库内是否有净值",
    "净值行数",
    "净值来源",
    "库内最早净值日",
    "库内最新净值日",
    "产品表最新净值日",
    "产品表最新净值",
    "库内综合最新净值日",
    "命中净值备案号",
    "是否在产品表",
    "是否纳入火富牛跟踪宇宙",
    "火富牛跟踪策略",
    "火富牛跟踪原因",
    "火富牛列表最新净值日",
    "火富牛列表最新净值",
    "最近抓取净值日",
    "最近抓取状态",
    "最近成功抓取净值日",
    "空日期探测结果",
]


def yn(v: str) -> str:
    return YESNO.get(v, v or "")


def sources_cn(raw: str) -> str:
    parts = [p for p in (raw or "").split(",") if p]
    return "、".join(NAV_SOURCE_CN.get(p, p) for p in parts)


def to_cn_row(r: dict) -> dict:
    dates = [d for d in (r.get("nav_max_date") or "", r.get("info_latest_nav_date") or "") if d]
    combined = max(dates) if dates else ""
    return {
        "备案号": r.get("register_number") or "",
        "产品简称": r.get("fund_short_name") or "",
        "产品名称": r.get("fund_name") or "",
        "平台一级策略": r.get("strategy_one") or "",
        "平台二级策略": r.get("strategy_two") or "",
        "平台三级策略": r.get("strategy_three") or "",
        "是否份额类": yn(r.get("is_share_class") or ""),
        "库内是否有净值": yn(r.get("has_db_nav") or ""),
        "净值行数": r.get("nav_rows") if r.get("nav_rows") is not None else "",
        "净值来源": sources_cn(r.get("nav_sources") or ""),
        "库内最早净值日": r.get("nav_min_date") or "",
        "库内最新净值日": r.get("nav_max_date") or "",
        "产品表最新净值日": r.get("info_latest_nav_date") or "",
        "产品表最新净值": r.get("info_latest_nav") or "",
        "库内综合最新净值日": combined,
        "命中净值备案号": r.get("matched_nav_code") or "",
        "是否在产品表": yn(r.get("in_private_fund_info") or ""),
        "是否纳入火富牛跟踪宇宙": yn(r.get("in_fof99_universe") or ""),
        "火富牛跟踪策略": POLICY_LABEL.get(r.get("fof99_policy") or "", r.get("fof99_policy") or "未纳入跟踪宇宙"),
        "火富牛跟踪原因": r.get("fof99_reason") or "",
        "火富牛列表最新净值日": r.get("fof99_list_date") or "",
        "火富牛列表最新净值": r.get("fof99_list_nav") or "",
        "最近抓取净值日": r.get("last_fetch_date") or "",
        "最近抓取状态": FETCH_STATUS_CN.get(r.get("last_fetch_status") or "", r.get("last_fetch_status") or ""),
        "最近成功抓取净值日": r.get("last_ok_date") or "",
        "空日期探测结果": PROBE_CN.get(r.get("empty_date_probe") or "", r.get("empty_date_probe") or ""),
    }
TODAY = date(2026, 9, 15)

NAVY = RGBColor(0x1A, 0x36, 0x5D)
GOLD = RGBColor(0xB8, 0x86, 0x0B)
TEXT = RGBColor(0x2D, 0x37, 0x48)
MUTED = RGBColor(0x64, 0x74, 0x8B)
RED = RGBColor(0xC5, 0x30, 0x30)
GREEN = RGBColor(0x2F, 0x85, 0x5A)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

C_NAVY = "#1A365D"
C_TEAL = "#2B6CB0"
C_GOLD = "#C9A227"
C_GREEN = "#2F855A"
C_RED = "#C53030"
C_ORANGE = "#DD6B20"
C_GRAY = "#718096"
C_PURPLE = "#6B46C1"

POLICY_CN = {
    "weekly": "weekly（每周五付费拉取）",
    "weekly_plus": "weekly_plus（邮件优先，落后才拉）",
    "skip": "skip（已确认火富牛无序列，永不重试）",
    "update_slow": "update_slow（火富牛最新净值偏旧，不周更）",
    "": "未纳入跟踪宇宙",
}

_CN_FONT: FontProperties | None = None


def load_env() -> None:
    for p in (ROOT / ".env.local", ROOT / ".env"):
        if p.exists():
            load_dotenv(p, override=False)


def iso(raw: object) -> str:
    if raw is None:
        return ""
    if hasattr(raw, "isoformat"):
        return str(raw)[:10]
    s = str(raw).strip()[:10]
    return s if len(s) == 10 and s[0].isdigit() else ""


def port_open(port: int = 5433) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1.5):
            return True
    except OSError:
        return False


def ensure_db() -> None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        os.environ["DATABASE_URL"] = (
            "postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
        )
    if port_open(5433):
        return
    key = Path.home() / ".ssh" / "id_ed25519_server"
    if not key.exists():
        raise SystemExit("DATABASE_URL host not reachable and SSH key missing")
    subprocess.Popen(
        [
            "ssh",
            "-i",
            str(key),
            "-L",
            "5433:127.0.0.1:5432",
            "-N",
            "-o",
            "ExitOnForwardFailure=yes",
            "root@8.154.33.143",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(40):
        time.sleep(0.4)
        if port_open(5433):
            return
    raise SystemExit("SSH tunnel to 5433 failed")


def configure_matplotlib() -> None:
    global _CN_FONT
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["figure.facecolor"] = "white"
    plt.rcParams["axes.facecolor"] = "white"
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


def set_run_font(run, *, size=11, bold=False, color=None, name="微软雅黑", italic=False):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    if color is not None:
        run.font.color.rgb = color


def add_text(p, text, *, size=11, bold=False, color=None, italic=False):
    run = p.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color, italic=italic)
    return run


def para(doc, text="", *, size=11, bold=False, color=None, align=None, space_after=8, first_line=True):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.line_spacing = 1.28
    if first_line and align is None:
        p.paragraph_format.first_line_indent = Cm(0.74)
    if align:
        p.alignment = align
    if text:
        add_text(p, text, size=size, bold=bold, color=color or TEXT)
    return p


def heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    size = {1: 16, 2: 13, 3: 12}.get(level, 11)
    for run in p.runs:
        set_run_font(run, size=size, bold=True, color=NAVY)
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
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(3)
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
        cell_text(table.rows[0].cells[i], h, size=9, bold=True, color=WHITE)
        shade(table.rows[0].cells[i], "1A365D")
    for r_i, row in enumerate(rows):
        bg = "F7FAFC" if r_i % 2 == 0 else "FFFFFF"
        for c_i, val in enumerate(row):
            cell_text(table.rows[r_i + 1].cells[c_i], val, size=9, align="center" if c_i else "left")
            shade(table.rows[r_i + 1].cells[c_i], bg)
    if col_widths:
        for row in table.rows:
            for i, w in enumerate(col_widths):
                row.cells[i].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(6)
    return table


def parse_strategy(raw: str) -> tuple[str, str, str]:
    s = (raw or "").strip()
    if not s:
        return "", "", ""
    try:
        obj = ast.literal_eval(s)
    except Exception:
        return "", "", ""
    plat = (obj or {}).get("platform") or {}
    return (
        str(plat.get("strategy_one") or "").strip(),
        str(plat.get("strategy_two") or "").strip(),
        str(plat.get("strategy_three") or "").strip(),
    )


def is_share_class(name: str, code: str) -> bool:
    n = name or ""
    if any(x in n for x in ("类份额", "A类", "B类", "C类", "D类", "E类")):
        return True
    return bool(code) and code[-1] in "ABCDE" and any(ch.isdigit() for ch in code[:-1])


def code_aliases(code: str) -> list[str]:
    u = (code or "").strip().upper()
    if not u:
        return []
    out: set[str] = {u}
    if u.startswith("S") and len(u) > 5:
        out.add(u[1:])
    if not u.startswith("S"):
        out.add("S" + u)
    elif not u.startswith("SS"):
        out.add("S" + u)
    m = re.match(r"^(.+)([ABC])$", u)
    if m:
        base, letter = m.group(1), m.group(2)
        if base.startswith("S") and re.match(r"^[A-Z][A-Z0-9]{4,7}$", base[1:]):
            out.add(base[1:] + letter)
            out.add("S" + base[1:] + letter)
        else:
            out.add(base + letter)
            if not base.startswith("S"):
                out.add("S" + base + letter)
    return [c for c in out if c]


def load_fof99_list() -> dict[str, dict]:
    if not FOF99_LIST.exists():
        return {}
    rows = list(csv.DictReader(FOF99_LIST.open(encoding="utf-8-sig", newline="")))
    out: dict[str, dict] = {}
    for r in rows:
        code = (r.get("register_number") or "").strip().upper()
        if code:
            out[code] = r
    return out


def nav_lookup(cur, aliases: list[str], names: list[str]) -> dict[str, dict]:
    """Map each alias code -> {source, rows, min, max} from several NAV tables."""
    by_code: dict[str, dict] = {}

    def put(code: str, source: str, n: int, dmin, dmax) -> None:
        code = (code or "").strip().upper()
        if not code:
            return
        prev = by_code.get(code)
        if prev is None or n > int(prev.get("rows") or 0):
            by_code[code] = {
                "source": source if prev is None else f"{prev['source']},{source}",
                "rows": (int(prev.get("rows") or 0) if prev else 0) + int(n or 0)
                if prev and prev.get("source") != source
                else int(n or 0),
                "min": iso(dmin) if not prev or (iso(dmin) and iso(dmin) < (prev.get("min") or "9999")) else prev.get("min"),
                "max": iso(dmax) if not prev or iso(dmax) > (prev.get("max") or "") else prev.get("max"),
            }
            if prev:
                # keep union of sources, max span
                srcs = sorted(set((prev["source"] + "," + source).split(",")))
                by_code[code]["source"] = ",".join(s for s in srcs if s)
                by_code[code]["rows"] = int(prev.get("rows") or 0) + int(n or 0)
                mins = [x for x in (prev.get("min"), iso(dmin)) if x]
                maxs = [x for x in (prev.get("max"), iso(dmax)) if x]
                by_code[code]["min"] = min(mins) if mins else ""
                by_code[code]["max"] = max(maxs) if maxs else ""

    queries = [
        (
            "private_fund_nav",
            """
            SELECT UPPER(BTRIM(beian_hao)), COUNT(*)::int, MIN(price_date), MAX(price_date)
            FROM private_fund_nav
            WHERE UPPER(BTRIM(beian_hao)) = ANY(%s) AND nav IS NOT NULL
            GROUP BY 1
            """,
            aliases,
        ),
        (
            "type6",
            """
            SELECT UPPER(BTRIM(beian_hao)), COUNT(*)::int, MIN(price_date), MAX(price_date)
            FROM private_fund_nav_group_type6
            WHERE UPPER(BTRIM(beian_hao)) = ANY(%s) AND nav IS NOT NULL
            GROUP BY 1
            """,
            aliases,
        ),
        (
            "group",
            """
            SELECT UPPER(BTRIM(beian_hao)), COUNT(*)::int, MIN(price_date), MAX(price_date)
            FROM private_fund_nav_group
            WHERE UPPER(BTRIM(beian_hao)) = ANY(%s) AND nav IS NOT NULL
            GROUP BY 1
            """,
            aliases,
        ),
        (
            "hy",
            """
            SELECT UPPER(BTRIM(beian_hao)), COUNT(*)::int, MIN(price_date), MAX(price_date)
            FROM private_fund_nav_group_hy
            WHERE UPPER(BTRIM(beian_hao)) = ANY(%s) AND nav IS NOT NULL
            GROUP BY 1
            """,
            aliases,
        ),
        (
            "email",
            """
            SELECT UPPER(BTRIM(product_code)), COUNT(*)::int, MIN(nav_date), MAX(nav_date)
            FROM ops_email_nav_records
            WHERE UPPER(BTRIM(product_code)) = ANY(%s) AND nav IS NOT NULL AND nav_date IS NOT NULL
            GROUP BY 1
            """,
            aliases,
        ),
    ]
    for source, sql, params in queries:
        try:
            cur.execute(sql, (params,))
            for r in cur.fetchall():
                put(r[0], source, r[1], r[2], r[3])
        except Exception:
            cur.connection.rollback()

    try:
        cur.execute(
            """
            SELECT UPPER(BTRIM(beian_hao)), COUNT(*)::int, MIN(nav_date), MAX(nav_date)
            FROM ops_team_nav_manual
            WHERE UPPER(BTRIM(beian_hao)) = ANY(%s) AND unit_nav IS NOT NULL
            GROUP BY 1
            """,
            (aliases,),
        )
        for r in cur.fetchall():
            put(r[0], "manual", r[1], r[2], r[3])
    except Exception:
        cur.connection.rollback()

    # type6 also matches by product name (tracking list does this)
    name_hits: dict[str, dict] = {}
    clean_names = [n for n in names if n]
    if clean_names:
        try:
            cur.execute(
                """
                SELECT product_name, COUNT(*)::int, MIN(price_date), MAX(price_date)
                FROM private_fund_nav_group_type6
                WHERE product_name = ANY(%s) AND nav IS NOT NULL
                GROUP BY 1
                """,
                (clean_names,),
            )
            for r in cur.fetchall():
                name_hits[str(r[0])] = {
                    "source": "type6_by_name",
                    "rows": int(r[1] or 0),
                    "min": iso(r[2]),
                    "max": iso(r[3]),
                }
        except Exception:
            cur.connection.rollback()
    return {"by_code": by_code, "by_name": name_hits}


def fetch_meta(cur, aliases: list[str]) -> dict:
    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), COALESCE(product_name, ''),
               latest_nav_date, latest_nav, COALESCE(manager, '')
        FROM private_fund_info
        WHERE UPPER(BTRIM(beian_hao)) = ANY(%s)
        """,
        (aliases,),
    )
    info = {
        r[0]: {
            "in_info": True,
            "info_name": r[1],
            "list_nav_date": iso(r[2]),
            "list_nav": "" if r[3] is None else str(r[3]),
            "manager": r[4] or "",
        }
        for r in cur.fetchall()
    }

    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code)), policy, COALESCE(reason, ''), listed_at
        FROM fof99_nav_universe
        WHERE UPPER(BTRIM(reg_code)) = ANY(%s)
        """,
        (aliases,),
    )
    uni = {
        r[0]: {
            "in_universe": True,
            "policy": r[1] or "",
            "reason": r[2] or "",
            "listed_at": iso(r[3]),
        }
        for r in cur.fetchall()
    }

    cur.execute(
        """
        SELECT DISTINCT ON (UPPER(BTRIM(reg_code)))
               UPPER(BTRIM(reg_code)), price_date, status, nav
        FROM fof99_nav_fetch_log
        WHERE UPPER(BTRIM(reg_code)) = ANY(%s)
          AND price_date > DATE '1970-01-01'
        ORDER BY UPPER(BTRIM(reg_code)), fetched_at DESC NULLS LAST, price_date DESC
        """,
        (aliases,),
    )
    last_fetch = {
        r[0]: {
            "last_fetch_date": iso(r[1]),
            "last_fetch_status": r[2] or "",
            "last_fetch_nav": "" if r[3] is None else str(r[3]),
        }
        for r in cur.fetchall()
    }

    cur.execute(
        """
        SELECT DISTINCT ON (UPPER(BTRIM(reg_code)))
               UPPER(BTRIM(reg_code)), price_date, status
        FROM fof99_nav_fetch_log
        WHERE UPPER(BTRIM(reg_code)) = ANY(%s)
          AND status = 'ok'
          AND price_date > DATE '1970-01-01'
        ORDER BY UPPER(BTRIM(reg_code)), price_date DESC
        """,
        (aliases,),
    )
    last_ok = {r[0]: {"last_ok_date": iso(r[1])} for r in cur.fetchall()}

    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code)), status
        FROM fof99_nav_fetch_log
        WHERE price_date = DATE '1970-01-01'
          AND UPPER(BTRIM(reg_code)) = ANY(%s)
        """,
        (aliases,),
    )
    probe = {r[0]: r[1] or "" for r in cur.fetchall()}

    return {
        "info": info,
        "uni": uni,
        "last_fetch": last_fetch,
        "last_ok": last_ok,
        "probe": probe,
    }


def pick_from_aliases(mapping: dict, aliases: list[str]) -> dict:
    for a in aliases:
        if a in mapping:
            return mapping[a]
    return {}


def merge_nav_for_fund(aliases: list[str], name: str, nav: dict) -> dict:
    by_code = nav["by_code"]
    by_name = nav["by_name"]
    sources: set[str] = set()
    rows = 0
    mins: list[str] = []
    maxs: list[str] = []
    matched = ""
    for a in aliases:
        hit = by_code.get(a)
        if not hit:
            continue
        sources.update((hit.get("source") or "").split(","))
        rows += int(hit.get("rows") or 0)
        if hit.get("min"):
            mins.append(hit["min"])
        if hit.get("max"):
            maxs.append(hit["max"])
        if not matched:
            matched = a
    nh = by_name.get(name) or by_name.get((name or "").replace("私募证券投资基金", "").strip())
    if nh:
        sources.add(nh.get("source") or "type6_by_name")
        rows += int(nh.get("rows") or 0)
        if nh.get("min"):
            mins.append(nh["min"])
        if nh.get("max"):
            maxs.append(nh["max"])
    sources.discard("")
    return {
        "has_db_nav": "yes" if rows > 0 else "no",
        "nav_rows": rows,
        "nav_sources": ",".join(sorted(sources)),
        "nav_min_date": min(mins) if mins else "",
        "nav_max_date": max(maxs) if maxs else "",
        "matched_nav_code": matched,
    }


def make_charts(all_rows: list[dict], missing: list[dict]) -> dict[str, Path]:
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    n_src = len(all_rows)
    n_miss = len(missing)
    n_has = n_src - n_miss

    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    labels = ["源文件产品数", "库内已有净值", "库内无净值"]
    vals = [n_src, n_has, n_miss]
    bars = ax.bar(labels, vals, color=[C_NAVY, C_GREEN, C_RED], width=0.55)
    ax.set_title("运维团队数据全量 vs 库内净值覆盖", **fp())
    ax.set_ylabel("产品数", **fp())
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, **fp())
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + max(vals) * 0.02, f"{v:,}", ha="center", **fp())
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    p = CHART_DIR / "01_coverage.png"
    fig.savefig(p, dpi=160)
    plt.close(fig)
    paths["coverage"] = p

    pol = Counter(r["fof99_policy"] or "未纳入宇宙" for r in missing)
    order = [k for k, _ in pol.most_common()]
    fig, ax = plt.subplots(figsize=(7.6, 4.4))
    vals = [pol[k] for k in order]
    bars = ax.bar(order, vals, color=[C_ORANGE, C_TEAL, C_GOLD, C_PURPLE, C_GRAY][: len(order)], width=0.55)
    ax.set_title("无净值产品的火富牛跟踪策略", **fp())
    ax.set_ylabel("产品数", **fp())
    ax.set_xticks(range(len(order)))
    ax.set_xticklabels(order, **fp())
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + max(vals) * 0.02, f"{v:,}", ha="center", **fp())
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    p = CHART_DIR / "02_policy.png"
    fig.savefig(p, dpi=160)
    plt.close(fig)
    paths["policy"] = p

    strat = Counter(r["strategy_one"] or "(空白)" for r in missing)
    top = strat.most_common(8)[::-1]
    fig, ax = plt.subplots(figsize=(7.6, 4.4))
    labels = [k for k, _ in top]
    vals = [v for _, v in top]
    ax.barh(labels, vals, color=C_TEAL)
    ax.set_xlabel("产品数", **fp())
    ax.set_title("无净值产品 · 平台一级策略（前8）", **fp())
    ax.set_yticks(range(len(labels)))
    ax.set_yticklabels(labels, **fp())
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    p = CHART_DIR / "03_strategy.png"
    fig.savefig(p, dpi=160)
    plt.close(fig)
    paths["strategy"] = p

    share_n = sum(1 for r in missing if r["is_share_class"] == "yes")
    main_n = len(missing) - share_n
    fig, ax = plt.subplots(figsize=(6.4, 4.0))
    labels = ["主份额 / 非份额类", "A/B/C 等份额类"]
    vals = [main_n, share_n]
    bars = ax.bar(labels, vals, color=[C_NAVY, C_GOLD], width=0.5)
    ax.set_ylabel("产品数", **fp())
    ax.set_title("无净值产品 · 是否份额类", **fp())
    ax.set_xticks([0, 1])
    ax.set_xticklabels(labels, **fp())
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + max(vals) * 0.02, str(v), ha="center", **fp())
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    p = CHART_DIR / "04_share.png"
    fig.savefig(p, dpi=160)
    plt.close(fig)
    paths["share"] = p

    fof_on = Counter("火富牛列表有净值日" if r["fof99_list_date"] else "火富牛列表无日期/不在列表" for r in missing)
    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    keys = list(fof_on.keys())
    vals = [fof_on[k] for k in keys]
    bars = ax.bar(keys, vals, color=[C_GREEN, C_RED][: len(keys)], width=0.5)
    ax.set_title("无净值产品在火富牛 advancedlist 上是否已有净值日", **fp())
    ax.set_ylabel("产品数", **fp())
    ax.set_xticks(range(len(keys)))
    ax.set_xticklabels(keys, **fp())
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + max(vals) * 0.02, f"{v:,}", ha="center", **fp())
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    p = CHART_DIR / "05_fof99_list.png"
    fig.savefig(p, dpi=160)
    plt.close(fig)
    paths["fof99_list"] = p
    return paths


def write_report(all_rows: list[dict], missing: list[dict], charts: dict[str, Path]) -> None:
    n_src = len(all_rows)
    n_miss = len(missing)
    n_has = n_src - n_miss
    pol = Counter(r["fof99_policy"] or "未纳入宇宙" for r in missing)
    in_uni = sum(1 for r in missing if r["in_fof99_universe"] == "yes")
    share_n = sum(1 for r in missing if r["is_share_class"] == "yes")
    in_info = sum(1 for r in missing if r["in_private_fund_info"] == "yes")
    fof_dated = sum(1 for r in missing if r["fof99_list_date"])
    strat = Counter(r["strategy_one"] or "(空白)" for r in missing)

    doc = Document()
    sec = doc.sections[0]
    sec.top_margin = Cm(2.0)
    sec.bottom_margin = Cm(2.0)
    sec.left_margin = Cm(2.2)
    sec.right_margin = Cm(2.2)
    style = doc.styles["Normal"]
    style.font.name = "微软雅黑"
    style.font.size = Pt(11)
    style.font.color.rgb = TEXT
    style._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")

    p = para(doc, "内部数据核对", size=10, color=GOLD, align=WD_ALIGN_PARAGRAPH.CENTER, first_line=False)
    p.paragraph_format.first_line_indent = Cm(0)
    t = para(
        doc,
        "运维团队数据（type6 全量）：库内无净值与火富牛跟踪状态",
        size=18,
        bold=True,
        color=NAVY,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        first_line=False,
    )
    t.paragraph_format.first_line_indent = Cm(0)
    s = para(
        doc,
        f"核对日 {TODAY.isoformat()}  ·  源文件 {SRC.name}  ·  备案号 S 前缀/份额类别名一并匹配",
        size=9,
        color=MUTED,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        first_line=False,
    )
    s.paragraph_format.first_line_indent = Cm(0)

    heading(doc, "一、结论", 1)
    para(
        doc,
        f"源文件 {SRC.name} 去重后 {n_src:,} 只产品（register_number）。"
        "「库内有净值」指在 private_fund_nav、private_fund_nav_group_type6、private_fund_nav_group、"
        "private_fund_nav_group_hy、ops_email_nav_records、ops_team_nav_manual 任一表，"
        "按备案号或其 S 前缀/份额类别名（或 type6 表产品名）能找到至少一行有效净值。"
        f"按此口径，{n_has:,} 只已有净值，{n_miss:,} 只完全没有净值，占源文件 {n_miss / n_src:.1%}。",
    )
    para(
        doc,
        f"这 {n_miss:,} 只无净值产品中，{in_uni:,} 只已在火富牛跟踪宇宙 fof99_nav_universe（SAVH67，policy=skip），"
        f"{n_miss - in_uni:,} 只未纳入。"
        f"火富牛 advancedlist 上已有净值日的 {fof_dated:,} 只（火富牛有数、我方库内仍空）。"
        f"份额类 {share_n:,} 只，非份额类 {n_miss - share_n:,} 只。"
        f"在 private_fund_info 中的 {in_info:,} 只，不在产品表的 {n_miss - in_info:,} 只。"
        "其中 SAVH67 倍致灵泰省心享1号产品表仍有 2026-05-29 净值尖，但各净值序列表均为空，且火富牛宇宙标记为 skip（空日期探测 no_data）。",
    )
    add_table(
        doc,
        ["口径", "数量", "占源文件"],
        [
            ["源文件去重产品数", f"{n_src:,}", "100%"],
            ["库内已有净值", f"{n_has:,}", f"{n_has / n_src:.1%}"],
            ["库内无净值（本报告对象）", f"{n_miss:,}", f"{n_miss / n_src:.1%}"],
            ["无净值且已纳入火富牛宇宙", f"{in_uni:,}", f"{in_uni / n_src:.1%}"],
            ["无净值且未纳入火富牛宇宙", f"{n_miss - in_uni:,}", f"{(n_miss - in_uni) / n_src:.1%}"],
            ["无净值但火富牛列表已有净值日", f"{fof_dated:,}", f"{fof_dated / n_src:.1%}"],
        ],
    )
    doc.add_picture(str(charts["coverage"]), width=Inches(6.1))
    cap = para(doc, "图1  源文件覆盖：有净值 vs 无净值", size=9, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, first_line=False)
    cap.paragraph_format.first_line_indent = Cm(0)

    heading(doc, "二、核对口径", 1)
    para(
        doc,
        "源文件是 type6 运维团队数据全量名单，字段为简称、全称、register_number、price_type、tag、strategy。"
        "运维/跟踪产品页查净值时不只看 master 表 private_fund_nav，还会看 type6 分组表、邮件净值、手工净值，"
        "并且备案号常有 S 前缀与 A/B/C 份额写法（例如 SBTH74B 与 BTH74B）。因此本报告按别名并集判定「有没有净值」，"
        "避免把「代码写法不同」误判成「没有数据」。",
    )
    para(
        doc,
        "火富牛跟踪状态取自 fof99_nav_universe.policy：weekly 每周五付费拉取；weekly_plus 邮件优先；"
        "skip 已确认无序列；update_slow 最新净值偏旧不周更。无行记为未纳入宇宙。"
        "另用本地 advancedlist CSV 标注火富牛是否已有最新净值日，并附 fof99_nav_fetch_log 最近一次抓取。",
    )

    heading(doc, "三、无净值产品的火富牛跟踪状态", 1)
    pol_rows = []
    for k, v in pol.most_common():
        label = "未纳入跟踪宇宙" if k == "未纳入宇宙" else POLICY_CN.get(k, k)
        pol_rows.append([label, f"{v:,}", f"{v / n_miss:.1%}" if n_miss else "—"])
    add_table(doc, ["跟踪策略", "无净值产品数", "占无净值"], pol_rows)
    doc.add_picture(str(charts["policy"]), width=Inches(6.1))
    cap = para(doc, "图2  无净值产品按火富牛跟踪策略", size=9, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, first_line=False)
    cap.paragraph_format.first_line_indent = Cm(0)

    weekly_n = pol.get("weekly", 0) + pol.get("weekly_plus", 0)
    para(
        doc,
        f"weekly + weekly_plus 共 {weekly_n:,} 只：周五任务理论上会覆盖，但库内各净值表仍空，"
        "应核对这些代码的抓取日志（ok / no_data / 尚未进批次）。"
        f"skip {pol.get('skip', 0):,} 只已判定火富牛无序列，一般不再付费重试。"
        f"update_slow {pol.get('update_slow', 0):,} 只不在周更预算内。"
        f"未纳入宇宙 {pol.get('未纳入宇宙', 0):,} 只当前不会被周五任务拉取。",
    )
    doc.add_picture(str(charts["fof99_list"]), width=Inches(6.1))
    cap = para(doc, "图3  无净值产品在火富牛列表上是否已有净值日", size=9, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, first_line=False)
    cap.paragraph_format.first_line_indent = Cm(0)
    para(
        doc,
        f"火富牛列表已有净值日、但我方库内仍空的 {fof_dated:,} 只，是最值得优先补数的集合："
        "数据在对端存在，缺的是写入我方净值表（或尚未 admit 进宇宙）。下表为这 15 只。",
    )
    fof_dated_rows = [r for r in missing if r["fof99_list_date"]]
    fof_dated_rows.sort(key=lambda r: r["fof99_list_date"], reverse=True)
    add_table(
        doc,
        ["备案号", "产品简称", "火富牛净值日", "火富牛净值", "份额类", "产品表"],
        [
            [
                r["register_number"],
                (r["fund_short_name"] or "")[:14],
                r["fof99_list_date"],
                r["fof99_list_nav"],
                r["is_share_class"],
                r["in_private_fund_info"],
            ]
            for r in fof_dated_rows
        ],
    )

    heading(doc, "四、产品结构", 1)
    para(
        doc,
        f"无净值产品中份额类 {share_n:,} 只（{share_n / n_miss:.1%}），主份额/非份额类 {n_miss - share_n:,} 只。"
        f"不在 private_fund_info 的 {n_miss - in_info:,} 只通常也进不了私募基金列表筛选。",
    )
    doc.add_picture(str(charts["share"]), width=Inches(5.4))
    cap = para(doc, "图4  无净值产品是否份额类", size=9, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, first_line=False)
    cap.paragraph_format.first_line_indent = Cm(0)
    doc.add_picture(str(charts["strategy"]), width=Inches(6.1))
    cap = para(doc, "图5  无净值产品平台一级策略（前8）", size=9, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, first_line=False)
    cap.paragraph_format.first_line_indent = Cm(0)
    add_table(
        doc,
        ["平台一级策略", "无净值产品数", "占无净值"],
        [[k, f"{v:,}", f"{v / n_miss:.1%}"] for k, v in strat.most_common(10)],
    )

    heading(doc, "五、明细抽样", 1)
    para(
        doc,
        f"完整 {n_miss:,} 行见 {CSV_OUT.name}。下表按跟踪策略各抽若干只。",
    )
    sample: list[dict] = []
    used: set[str] = set()
    for key in ("weekly", "weekly_plus", "skip", "update_slow", ""):
        cand = [r for r in missing if (r["fof99_policy"] or "") == key]
        # prefer those with fof99 list date
        cand.sort(key=lambda r: (0 if r["fof99_list_date"] else 1, r["register_number"]))
        for r in cand[:4]:
            if r["register_number"] in used:
                continue
            used.add(r["register_number"])
            sample.append(r)
    add_table(
        doc,
        ["备案号", "产品简称", "跟踪策略", "火富牛净值日", "是否份额类"],
        [
            [
                r["register_number"],
                (r["fund_short_name"] or r["fund_name"] or "")[:16],
                r["fof99_policy"] or "未纳入",
                r["fof99_list_date"] or "—",
                r["is_share_class"],
            ]
            for r in sample
        ],
    )

    heading(doc, "六、建议", 1)
    para(
        doc,
        "1. 优先处理「火富牛列表已有净值日 + 未纳入宇宙」的主份额：admit 进 weekly 后用 FundPrice 回填，再进周五 FundMultiPrice。"
        "不要对 skip 产品付费盲拉。",
    )
    para(
        doc,
        "2. 已在 weekly / weekly_plus 但各净值表仍空的，查 fof99_nav_fetch_log："
        "无记录=尚未进批次；连续 no_data=与列表日期冲突，核对接备案号/份额类；error=写入失败。",
    )
    para(
        doc,
        "3. A/B/C 类份额若协会主表没有独立行，master 净值表也不会自然出现。"
        "运维团队数据本身按份额登记，补数时要用源文件里的 register_number（含 B/A 后缀），不要只写主份额代码。",
    )
    para(
        doc,
        "4. 本报告「无净值」已合并 type6 / 邮件 / 手工表。若产品页仍显示净值，多半来自估值表市价回退，并不等于净值序列已入库。",
    )

    heading(doc, "附录  CSV 字段", 1)
    add_table(
        doc,
        ["字段", "含义"],
        [
            ["register_number", "源文件备案号"],
            ["has_db_nav", "本 CSV 均为 no"],
            ["nav_sources", "命中的净值表（无净值时为空）"],
            ["in_fof99_universe / fof99_policy", "跟踪宇宙与策略"],
            ["fof99_list_date / fof99_list_nav", "火富牛 advancedlist 最新净值"],
            ["last_fetch_status / last_ok_date", "抓取日志"],
            ["in_private_fund_info", "是否在协会产品表"],
        ],
    )
    foot = para(
        doc,
        f"生成时间 {datetime.now().strftime('%Y-%m-%d %H:%M')}  ·  只读库与 CSV，不调用火富牛付费接口。",
        size=9,
        color=MUTED,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        first_line=False,
    )
    foot.paragraph_format.first_line_indent = Cm(0)
    doc.save(REPORT_PATH)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    load_env()
    ensure_db()
    configure_matplotlib()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    src_rows = list(csv.DictReader(SRC.open(encoding="utf-8-sig", newline="")))
    by_code: dict[str, dict] = {}
    for r in src_rows:
        code = (r.get("register_number") or "").strip().upper()
        if not code:
            continue
        if code not in by_code:
            by_code[code] = r
    codes = list(by_code)
    print("source rows", len(src_rows), "unique register_number", len(codes))

    alias_map = {c: code_aliases(c) for c in codes}
    all_aliases = sorted({a for als in alias_map.values() for a in als})
    names = []
    for r in by_code.values():
        names.extend(
            [
                (r.get("fund_name") or "").strip(),
                (r.get("fund_short_name") or "").strip(),
            ]
        )
    names = [n for n in dict.fromkeys(names) if n]
    print("aliases", len(all_aliases), "names", len(names))

    fof_list = load_fof99_list()
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    nav = nav_lookup(cur, all_aliases, names)
    meta = fetch_meta(cur, all_aliases)
    cur.close()
    conn.close()

    fields = [
        "register_number",
        "fund_short_name",
        "fund_name",
        "strategy_one",
        "strategy_two",
        "strategy_three",
        "is_share_class",
        "has_db_nav",
        "nav_rows",
        "nav_sources",
        "nav_min_date",
        "nav_max_date",
        "matched_nav_code",
        "in_private_fund_info",
        "info_latest_nav_date",
        "info_latest_nav",
        "in_fof99_universe",
        "fof99_policy",
        "fof99_reason",
        "fof99_list_date",
        "fof99_list_nav",
        "last_fetch_date",
        "last_fetch_status",
        "last_ok_date",
        "empty_date_probe",
    ]
    all_rows: list[dict] = []
    for code in codes:
        src = by_code[code]
        als = alias_map[code]
        name = src.get("fund_name") or ""
        short = src.get("fund_short_name") or ""
        s1, s2, s3 = parse_strategy(src.get("strategy") or "")
        nav_hit = merge_nav_for_fund(als, name, nav)
        info = pick_from_aliases(meta["info"], als)
        uni = pick_from_aliases(meta["uni"], als)
        lf = pick_from_aliases(meta["last_fetch"], als)
        lo = pick_from_aliases(meta["last_ok"], als)
        probe = ""
        for a in als:
            if a in meta["probe"]:
                probe = meta["probe"][a]
                break
        fof = {}
        for a in als:
            if a in fof_list:
                fof = fof_list[a]
                break
        row = {
            "register_number": code,
            "fund_short_name": short,
            "fund_name": name,
            "strategy_one": s1,
            "strategy_two": s2,
            "strategy_three": s3,
            "is_share_class": "yes" if is_share_class(name + short, code) else "no",
            **nav_hit,
            "in_private_fund_info": "yes" if info.get("in_info") else "no",
            "info_latest_nav_date": info.get("list_nav_date") or "",
            "info_latest_nav": info.get("list_nav") or "",
            "in_fof99_universe": "yes" if uni.get("in_universe") else "no",
            "fof99_policy": uni.get("policy") or "",
            "fof99_reason": uni.get("reason") or "",
            "fof99_list_date": iso(fof.get("price_date")),
            "fof99_list_nav": (fof.get("price_nav") or "") if fof else "",
            "last_fetch_date": lf.get("last_fetch_date") or "",
            "last_fetch_status": lf.get("last_fetch_status") or "",
            "last_ok_date": lo.get("last_ok_date") or "",
            "empty_date_probe": probe,
        }
        all_rows.append(row)

    missing = [r for r in all_rows if r["has_db_nav"] == "no"]
    missing.sort(
        key=lambda r: (
            r["fof99_policy"] or "zzz",
            0 if r["fof99_list_date"] else 1,
            r["register_number"],
        )
    )

    cn_rows = [to_cn_row(r) for r in all_rows]
    with FULL_CSV_CN.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CN_FIELDS)
        w.writeheader()
        w.writerows(cn_rows)
    print("wrote full cn csv", FULL_CSV_CN, "rows", len(cn_rows))

    with CSV_OUT.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(missing)

    print("wrote csv", CSV_OUT, "rows", len(missing))
    print("source", len(all_rows), "has_nav", len(all_rows) - len(missing), "no_nav", len(missing))
    print("policy", dict(Counter(r["fof99_policy"] or "(none)" for r in missing)))
    print("share", dict(Counter(r["is_share_class"] for r in missing)))
    print("in_universe", dict(Counter(r["in_fof99_universe"] for r in missing)))
    print("in_info", dict(Counter(r["in_private_fund_info"] for r in missing)))
    print("fof99_list_dated", sum(1 for r in missing if r["fof99_list_date"]))
    print(
        "has_nav sources",
        Counter(r["nav_sources"] or "(none)" for r in all_rows if r["has_db_nav"] == "yes").most_common(12),
    )

    charts = make_charts(all_rows, missing)
    write_report(all_rows, missing, charts)
    print("wrote report", REPORT_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
