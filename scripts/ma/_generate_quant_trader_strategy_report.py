# -*- coding: utf-8 -*-
"""One Word report: deep trading-strategy profile of each MOM quant sleeve."""
from __future__ import annotations

import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _generate_rx319_profile_word_report as g
from docx.enum.text import WD_ALIGN_PARAGRAPH

ACCOUNTS = ["rx319", "rx324", "rx334", "rx339", "rx346", "rx350", "rx356"]

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "MOM量化盘手策略深挖_20260928.docx"
WORK = Path(__file__).resolve().parent / "_quant_trader_strategy_output"


def cover(doc, profiles: list[dict]) -> None:
    g.heading.offset = 0
    g.para(doc, "内部资料 · 量化盘手策略深挖 · 请勿外传", size=9, color=g.GOLD, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=16)
    g.para(doc, "MOM 量化盘手交易策略深挖", size=26, bold=True, color=g.NAVY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=6)
    g.para(
        doc,
        "对象是量化袖子 rx319、rx324、rx334、rx339、rx346、rx350、rx356。每人一章，结论来自成交、平仓、持仓和日报，投顾表只提供姓名和团队。",
        size=11,
        color=g.TEXT,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        space_after=8,
    )
    g.para(
        doc,
        "策略鉴定看四件事：同时持有多少品种、平今占比、多空对冲度、持仓方向是否跟着近 5 日动量。开盘 5 分钟成交占比用来区分系统批量单和盘中点价。",
        size=10,
        color=g.MUTED,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        space_after=14,
    )

    g.heading(doc, "横向对照", 1)
    g.para(
        doc,
        "下表把七个袖子放在同一套尺子上。后面每一章再展开这个人的狩猎场、亏钱之后的仓位、多空哪一侧发工资、日盘还是夜盘、赢单和亏单拿多久。",
    )
    headers = ["账户", "投顾", "策略鉴定", "天数", "累计收益", "夏普", "回撤", "平仓胜率", "盈亏比", "对冲", "日均品种", "平今", "5日动量"]
    rows = []
    for p in profiles:
        name, _method = g.playbook_of(p)
        cst = p["close_stats"]
        rows.append([
            p["account"].upper(),
            p["advisor_name"] or "未登记",
            name,
            str(p["n_days"]),
            g.fmt_pct(p["period_ret"], 1, True),
            f"{p['sharpe']:.2f}",
            g.fmt_pct(p["mdd"], 1),
            g.fmt_pct(cst["win_rate"], 0),
            f"{cst['payoff']:.2f}",
            g.fmt_pct(p["avg_hedge"], 0),
            f"{p['avg_pos_prod']:.0f}",
            g.fmt_pct(p["pingjin_ratio"], 1),
            g.fmt_pct(p["mom5_hit"], 0),
        ])
    g.add_table(doc, headers, rows)
    g.caption(doc, "表0  同一口径对照。收益按当日盈亏/上日结存复利，单日 ±25% 跳动已剔除。对冲度 = 1 − |净保证金| / 毛保证金。")

    named = [p for p in profiles if p.get("advisor_name")]
    missing = [p["account"].upper() for p in profiles if not p.get("advisor_name")]
    if named:
        bits = []
        for p in named:
            name, method = g.playbook_of(p)
            firm = p["company"] or "团队未登记"
            bits.append(f"{p['account'].upper()} {p['advisor_name']}（{firm}）鉴定为{name}，执行上{method}，样本夏普 {p['sharpe']:.2f}、回撤 {g.fmt_pct(p['mdd'], 1)}。")
        g.para(doc, "".join(bits))
    if missing:
        g.para(doc, "投顾表没有姓名的账户：" + "、".join(missing) + "。这几章只根据交易痕迹写策略，不推测管理人。")


def run_one(account: str) -> tuple[dict, dict]:
    work = WORK / account
    g.OUT_DIR = work
    g.CHART_DIR = work / "charts"
    g.CHART_DIR.mkdir(parents=True, exist_ok=True)
    g.ACCOUNT = account
    conn = g.get_conn()
    try:
        raw = g.load_raw(conn, account, None, None)
    finally:
        conn.close()
    profile, _daily, _trades, _closes, _pos, prod_sum, sec_sum, _hedge, nh, after_df = g.analyze(raw, account)
    charts: dict[str, Path] = {}
    for key, fn in [
        ("equity", lambda: g.chart_equity(profile, nh)),
        ("dd", lambda: g.chart_dd(profile)),
        ("margin", lambda: g.chart_margin(profile)),
        ("monthly", lambda: g.chart_monthly(profile)),
        ("sector", lambda: g.chart_sector(sec_sum)),
        ("product", lambda: g.chart_product(prod_sum)),
        ("hold", lambda: g.chart_hold(profile)),
        ("hour", lambda: g.chart_hour(profile)),
        ("session", lambda: g.chart_session(profile)),
        ("after", lambda: g.chart_after(after_df)),
        ("hedge", lambda: g.chart_hedge(profile)),
        ("rr", lambda: g.chart_rr_hist(profile)),
        ("ls", lambda: g.chart_ls(profile)),
    ]:
        try:
            charts[key] = fn()
        except Exception as exc:
            print(f"  chart {account} {key} failed: {exc}")
    return profile, charts


def main() -> None:
    g.configure_matplotlib()
    WORK.mkdir(parents=True, exist_ok=True)
    done: list[tuple[dict, dict]] = []
    failed: list[tuple[str, str]] = []
    for account in ACCOUNTS:
        print("===", account, flush=True)
        try:
            done.append(run_one(account))
            p = done[-1][0]
            print(
                f"  days={p['n_days']} sharpe={p['sharpe']:.2f} "
                f"playbook={g.playbook_of(p)[0]} name={p['advisor_name'] or '-'}",
                flush=True,
            )
        except Exception:
            err = traceback.format_exc()
            print(err, flush=True)
            failed.append((account, err.splitlines()[-1]))

    doc = g.Document()
    section = doc.sections[0]
    section.page_width = g.Cm(21.0)
    section.page_height = g.Cm(29.7)
    section.left_margin = g.Cm(1.6)
    section.right_margin = g.Cm(1.6)
    section.top_margin = g.Cm(1.6)
    section.bottom_margin = g.Cm(1.6)
    cover(doc, [p for p, _c in done])
    for profile, charts in done:
        g.write_report(profile, charts, output_path=None, doc=doc, chapter=True)
    if failed:
        doc.add_page_break()
        g.heading.offset = 0
        g.heading(doc, "未能成章的账户", 1)
        for account, err in failed:
            g.para(doc, f"{account.upper()}：{err}")
    g.para(
        doc,
        f"生成日期 {g.date.today().isoformat()}。数据表 mom_daily_reports、mom_futures_trade_details、mom_close_details、mom_position_details、mom_advisor_info。本报告是行为推断，不构成调仓指令。",
        size=9,
        color=g.MUTED,
        space_before=12,
    )
    doc.save(str(OUT))
    print("report", OUT, flush=True)


if __name__ == "__main__":
    main()
