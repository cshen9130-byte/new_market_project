# -*- coding: utf-8 -*-
"""Operational MOM risk addendum: pre-trade freeze + RX000 hedges.

Does not ask advisors to flatten. Overlays sit on the official MOM product NAV
(日收益 = 当日盈亏 / 上日累计净资本).
"""
from __future__ import annotations

import importlib.util
import os
import pickle
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import psycopg2
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "scripts" / "ma" / "generate_mcr_risk_rules_report.py"
spec = importlib.util.spec_from_file_location("mcr", SRC)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

OUT_DIR = ROOT / "reports"
CHART_DIR = OUT_DIR / "_mcr_ops_overlay_charts"
REPORT_PATH = OUT_DIR / "MOM组合可执行风控方案_RX000对冲与开仓前限额.docx"
REPORT_PATH_ASCII = OUT_DIR / "MOM_ops_RX000_hedge_pretrade_report.docx"

PRECIOUS = {"AU", "AG", "PT", "PD"}
BASEMETAL = {"CU", "BC", "AL", "AO", "AD", "ZN", "PB", "NI", "SN"}
MACRO = {"AU", "AG", "CU", "SC", "IM", "IF", "IC", "IH", "TL", "T", "TF", "TS"}
HEDGE_UNIVERSE = PRECIOUS | BASEMETAL | MACRO | {"LC"}

SECTOR_HEDGE_INSTR = {"贵金属": "AU", "有色": "CU", "股指": "IM", "能源化工": "SC"}


def load_book_mv():
    conn = psycopg2.connect(m.DB_URL)
    cur = conn.cursor()
    cur.execute(
        f"""
        SELECT "交易日期"::text, UPPER(TRIM("账户")), UPPER(TRIM("合约")),
               SUM(CASE WHEN {m.num_expr("买持仓")} > 0
                        THEN {m.num_expr("持仓市値")}
                        ELSE -{m.num_expr("持仓市値")} END)::text
        FROM mom_position_details
        WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
          AND {m.ACCT_FILTER}
          AND UPPER(TRIM("合约")) !~ '[0-9][CP][0-9]'
          AND TRIM("合约") NOT LIKE '%-%-%'
        GROUP BY 1, 2, 3
        """
    )
    book = defaultdict(lambda: defaultdict(float))  # date -> prod -> mv
    rx = defaultdict(lambda: defaultdict(float))
    dates = set()
    for d, acct, contract, mv in cur.fetchall():
        prod = m.get_prefix(contract)
        v = m.to_num(mv)
        if not d or not prod:
            continue
        dates.add(d)
        book[d][prod] += v
        if str(acct).upper() == "RX000":
            rx[d][prod] += v
    conn.close()
    return book, rx, sorted(dates)


def next_ret(pct_map, mkt_dates, prod, date):
    return m.next_return(pct_map, mkt_dates, prod, date)


def overlay_nav(official, hedge_pnl_by_date: dict[str, float]):
    extra = np.array([hedge_pnl_by_date.get(d, 0.0) for d in official["dates"]], dtype=float)
    cf_pnl = official["pnl"] + extra
    rebuilt = m.rebuild_mom_nav(official["dates"], cf_pnl, official["flow"])
    st = m.mom_nav_stats(rebuilt["nav"], rebuilt["ret"])
    return rebuilt, st, extra


def product_pnl_on_next(book, date, nxt_fn) -> dict[str, float]:
    out = {}
    for prod, mv in book.get(date, {}).items():
        out[prod] = mv * nxt_fn(prod, date)
    return out


def find_mdd_window(nav, dates):
    peak = nav[0]
    peak_i = 0
    best = 0.0
    best_pair = (0, 0)
    for i, v in enumerate(nav):
        if v > peak:
            peak, peak_i = v, i
        dd = (peak - v) / peak if peak > 0 else 0
        if dd > best:
            best = dd
            best_pair = (peak_i, i)
    i0, i1 = best_pair
    return dates[i0], dates[i1], best, i0, i1


def strategy_product_cap_hedge(book, dates, official, nxt_fn, products, cap_frac, name, short):
    """RX000 shorts/longs the same product to cap |net MV| / capital."""
    cap_map = dict(zip(official["dates"], official["prev_capital"]))
    hedge_pnl = {}
    events = 0
    notional = 0.0
    for i, d in enumerate(dates[:-1]):
        capital = cap_map.get(d, 0.0)
        if capital <= 0:
            continue
        day_h = 0.0
        for prod in products:
            mv = book[d].get(prod, 0.0)
            cap = cap_frac * capital
            if abs(mv) <= cap:
                continue
            excess = abs(mv) - cap
            hedge_mv = -np.sign(mv) * excess
            day_h += hedge_mv * nxt_fn(prod, d)
            events += 1
            notional += abs(hedge_mv)
        nxt = dates[i + 1]
        hedge_pnl[nxt] = hedge_pnl.get(nxt, 0.0) + day_h
    rebuilt, st, extra = overlay_nav(official, hedge_pnl)
    return {
        "name": name,
        "short": short,
        "kind": "rx000_product_cap",
        "rebuilt": rebuilt,
        "st": st,
        "extra": extra,
        "n": events,
        "avg_notional": notional / max(events, 1),
        "net": float(extra.sum()),
    }


def strategy_sector_proxy_hedge(book, dates, official, nxt_fn, groups, cap_frac, name, short):
    """Cap sector net MV; hedge residual with a liquid proxy (AU/CU/IM/SC)."""
    cap_map = dict(zip(official["dates"], official["prev_capital"]))
    hedge_pnl = {}
    events = 0
    notional = 0.0
    for i, d in enumerate(dates[:-1]):
        capital = cap_map.get(d, 0.0)
        if capital <= 0:
            continue
        day_h = 0.0
        for sector, prods in groups.items():
            instr = SECTOR_HEDGE_INSTR.get(sector)
            if not instr:
                continue
            net = sum(book[d].get(p, 0.0) for p in prods)
            cap = cap_frac * capital
            if abs(net) <= cap:
                continue
            excess = abs(net) - cap
            hedge_mv = -np.sign(net) * excess
            day_h += hedge_mv * nxt_fn(instr, d)
            events += 1
            notional += abs(hedge_mv)
        nxt = dates[i + 1]
        hedge_pnl[nxt] = hedge_pnl.get(nxt, 0.0) + day_h
    rebuilt, st, extra = overlay_nav(official, hedge_pnl)
    return {
        "name": name,
        "short": short,
        "kind": "rx000_sector_proxy",
        "rebuilt": rebuilt,
        "st": st,
        "extra": extra,
        "n": events,
        "avg_notional": notional / max(events, 1),
        "net": float(extra.sum()),
    }


def strategy_pretrade_offset(days, book, dates, official, nxt_fn, cap, name, short):
    """If product MCR already over cap, RX000 offsets any SAME-DIRECTION add next day."""
    mcr_by_date = {d["date"]: d["prod_mcr"] for d in days}
    date_set = set(dates)
    hedge_pnl = {}
    events = 0
    notional = 0.0
    for i, d in enumerate(dates[:-1]):
        mcr = mcr_by_date.get(d, {})
        hot = {p for p, sh in mcr.items() if sh >= cap}
        if not hot:
            continue
        nxt = dates[i + 1]
        day_h = 0.0
        for prod in hot:
            mv0 = book[d].get(prod, 0.0)
            mv1 = book[nxt].get(prod, 0.0)
            increment = mv1 - mv0
            if increment * mv0 <= 0:
                continue
            hedge_mv = -increment
            day_h += hedge_mv * nxt_fn(prod, nxt)
            events += 1
            notional += abs(hedge_mv)
        if i + 2 < len(dates):
            hedge_pnl[dates[i + 2]] = hedge_pnl.get(dates[i + 2], 0.0) + day_h
        else:
            hedge_pnl[nxt] = hedge_pnl.get(nxt, 0.0) + day_h
    rebuilt, st, extra = overlay_nav(official, hedge_pnl)
    return {
        "name": name,
        "short": short,
        "kind": "pretrade_offset",
        "rebuilt": rebuilt,
        "st": st,
        "extra": extra,
        "n": events,
        "avg_notional": notional / max(events, 1),
        "net": float(extra.sum()),
    }


def strategy_vol_target(days, official, nxt_fn, target_ann, universe, name, short):
    """When predicted vol > target, RX000 hedges MACRO names pro-rata toward the target."""
    cap_map = dict(zip(official["dates"], official["prev_capital"]))
    day_map = {d["date"]: d for d in days}
    hedge_pnl = {}
    events = 0
    notional = 0.0
    for i, day in enumerate(days[:-1]):
        d = day["date"]
        capital = cap_map.get(d, 0.0)
        if capital <= 0 or day["port_sigma"] <= 0:
            continue
        pred = day["port_sigma"] / capital * (252 ** 0.5)
        if pred <= target_ann:
            continue
        scale = 1.0 - target_ann / pred
        scale = min(max(scale, 0.0), 0.6)
        day_h = 0.0
        for j, prod in enumerate(day["prods"]):
            if prod not in universe:
                continue
            hedge_mv = -scale * float(day["mvs"][j])
            day_h += hedge_mv * nxt_fn(prod, d)
            notional += abs(hedge_mv)
        events += 1
        hedge_pnl[days[i + 1]["date"]] = hedge_pnl.get(days[i + 1]["date"], 0.0) + day_h
    rebuilt, st, extra = overlay_nav(official, hedge_pnl)
    return {
        "name": name,
        "short": short,
        "kind": "vol_target",
        "rebuilt": rebuilt,
        "st": st,
        "extra": extra,
        "n": events,
        "avg_notional": notional / max(events, 1),
        "net": float(extra.sum()),
    }


def strategy_standing_haircut(book, dates, official, nxt_fn, products, haircut, name, short):
    """Always hedge a fixed fraction of net MV in the listed products (standing overlay)."""
    hedge_pnl = {}
    events = 0
    notional = 0.0
    for i, d in enumerate(dates[:-1]):
        day_h = 0.0
        for prod in products:
            mv = book[d].get(prod, 0.0)
            if abs(mv) < 1000:
                continue
            hedge_mv = -haircut * mv
            day_h += hedge_mv * nxt_fn(prod, d)
            notional += abs(hedge_mv)
            events += 1
        hedge_pnl[dates[i + 1]] = hedge_pnl.get(dates[i + 1], 0.0) + day_h
    rebuilt, st, extra = overlay_nav(official, hedge_pnl)
    return {
        "name": name,
        "short": short,
        "kind": "standing",
        "rebuilt": rebuilt,
        "st": st,
        "extra": extra,
        "n": events,
        "avg_notional": notional / max(events, 1),
        "net": float(extra.sum()),
    }


def attribution(book, dates, official, nxt_fn):
    ret_map = dict(zip(official["dates"], official["ret"]))
    groups = {
        "贵金属": PRECIOUS,
        "有色": BASEMETAL,
        "股指": {"IH", "IF", "IC", "IM"},
        "能源化工": {p for p, s in m.PROD_SECTOR.items() if s == "能源化工"},
        "其他商品": None,
    }
    other = set(m.AKSHARE_CODE) - PRECIOUS - BASEMETAL - {"IH", "IF", "IC", "IM"} - groups["能源化工"]
    groups["其他商品"] = other
    daily = {g: [] for g in groups}
    aligned_port = []
    use_dates = []
    for i, d in enumerate(dates[:-1]):
        nxt = dates[i + 1]
        if nxt not in ret_map:
            continue
        use_dates.append(nxt)
        aligned_port.append(ret_map[nxt])
        pnl = product_pnl_on_next(book, d, nxt_fn)
        for g, prods in groups.items():
            daily[g].append(sum(pnl.get(p, 0.0) for p in prods))
    port = np.array(aligned_port)
    rows = []
    for g, xs in daily.items():
        arr = np.array(xs, dtype=float)
        if arr.std() < 1e-9 or port.std() < 1e-9:
            beta = 0.0
        else:
            beta = float(np.cov(arr, port, ddof=0)[0, 1] / np.var(port))
        # variance share of reconstructed group pnl vs official ret * capital is messy;
        # report corr and cumulative pnl instead
        corr = float(np.corrcoef(arr, port)[0, 1]) if len(arr) > 3 else 0.0
        rows.append(
            {
                "g": g,
                "pnl": float(arr.sum()),
                "corr": corr,
                "abs_share": float(np.abs(arr).sum()),
            }
        )
    tot_abs = sum(r["abs_share"] for r in rows) or 1.0
    for r in rows:
        r["abs_pct"] = r["abs_share"] / tot_abs
    return rows, use_dates, daily, port


def configure_and_helpers():
    m.configure_matplotlib()
    CHART_DIR.mkdir(parents=True, exist_ok=True)


def savefig(name):
    path = CHART_DIR / name
    plt.tight_layout()
    plt.savefig(path, dpi=160, bbox_inches="tight")
    plt.close()
    return path


def chart_attr_bar(rows):
    fig, ax = plt.subplots(figsize=(8.6, 3.6))
    labels = [r["g"] for r in rows]
    vals = [r["pnl"] / 1e4 for r in rows]
    cols = [m.cn_pnl_color(v) for v in vals]
    ax.bar(labels, vals, color=cols)
    ax.axhline(0, color="#A0AEC0", lw=0.8)
    ax.set_ylabel("累计估算盈亏（万元）", **m.fp())
    ax.set_title("各板块对 MOM 持仓估算盈亏的贡献（市值×次日涨跌）", **m.fp())
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    plt.xticks(**m.fp())
    return savefig("ops_01_sector_pnl.png")


def chart_navs(official, strats, title, fname):
    fig, ax = plt.subplots(figsize=(10.2, 3.9))
    x = pd.to_datetime(official["dates"])
    ax.plot(x, official["nav"], color=m.C_GRAY, lw=1.6, label="MOM实际净值")
    colors = [m.C_TEAL, m.C_NAVY, m.C_ORANGE, m.C_GREEN, m.C_PURPLE, m.C_PINK]
    for i, s in enumerate(strats):
        ax.plot(pd.to_datetime(s["rebuilt"]["dates"]), s["rebuilt"]["nav"], color=colors[i % len(colors)], lw=1.3, label=s["short"])
    ax.set_ylabel("MOM产品累计净值", **m.fp())
    ax.set_title(title, **m.fp())
    ax.legend(prop=m._CN_FONT, fontsize=8, frameon=False, ncol=2)
    ax.grid(True, axis="y", color="#EDF2F7")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    return savefig(fname)


def chart_risk_bars(base_st, strats, fname):
    rows = [{"label": "MOM实际", **base_st}] + [{"label": s["short"], **s["st"]} for s in strats]
    labels = [r["label"] for r in rows]
    xx = np.arange(len(labels))
    fig, axes = plt.subplots(1, 3, figsize=(10.4, 3.7))
    keys = [("ann_vol", "年化波动 (%)", lambda v: v * 100, m.C_TEAL), ("mdd", "最大回撤 (%)", lambda v: v * 100, m.C_ORANGE), ("sharpe", "夏普", lambda v: v, m.C_NAVY)]
    for ax, (key, title, xf, color) in zip(axes, keys):
        vals = [xf(r[key]) for r in rows]
        cols = [m.C_GRAY if i == 0 else color for i in range(len(vals))]
        ax.bar(xx, vals, color=cols, width=0.72)
        ax.set_title(title, **m.fp())
        ax.set_xticks(xx)
        ax.set_xticklabels(labels, rotation=30, ha="right")
        for tick in ax.get_xticklabels():
            tick.set_fontproperties(m._CN_FONT)
            tick.set_fontsize(7)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        for i, v in enumerate(vals):
            ax.text(i, v, f"{v:.2f}", ha="center", va="bottom", fontsize=6.5)
    fig.suptitle("可执行方案 vs MOM 实际：波动 / 回撤 / 夏普", **m.fp(), y=1.02)
    return savefig(fname)


def write_doc(official, base_st, attr_rows, mdd_info, strats, charts, rec):
    doc = Document()
    m.set_narrow_margins(doc)
    style = doc.styles["Normal"]
    style.font.name = "微软雅黑"
    style._element.rPr.rFonts.set(m.qn("w:eastAsia"), "微软雅黑")
    style.font.size = Pt(11)
    m.para(doc, "MOM 每日风控  ·  可执行方案备忘（不要求投顾砍仓）", size=11, color=m.GOLD, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    t = m.para(doc, "开仓前限额、RX000 对冲与贵金属/有色/宏观集中管理", size=18, bold=True, color=m.NAVY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=6)
    t.runs[0].font.size = Pt(18)
    m.para(
        doc,
        f"基准为风险日报 MOM 产品净值（{official['dates'][0]} 至 {official['dates'][-1]}，"
        f"累计 {m.pct(base_st['total_ret'])}，年化波动 {m.pct(base_st['ann_vol'])}，"
        f"最大回撤 {m.pct(base_st['mdd'])}，夏普 {base_st['sharpe']:.2f}）。"
        f"报告日 {datetime.now().strftime('%Y-%m-%d')}",
        size=10,
        color=m.MUTED,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        space_after=12,
    )

    m.heading(doc, "一、目标与约束", 1)
    m.para(
        doc,
        "目标：压低 MOM 产品波动与回撤，尽量保住夏普，规则要简单。"
        "约束：投顾已经开仓后再要求他们砍仓，现实中很难执行；"
        "相对容易的是（1）开仓前把额度写死，（2）在我方直接控制的 RX000（自营）账户里"
        "管理贵金属、有色和宏观品种，（3）用 RX000 开对冲，而不是去改投顾持仓。"
        "上一份回测里「超限且近5日亏损才砍」在数字上仍然成立，本备忘把它留作制度备选，"
        "主推不依赖投顾配合的方案。",
    )

    m.heading(doc, "二、风险从哪来：贵金属 / 有色 / 宏观够不够格当主杠杆", 1)
    m.para(
        doc,
        f"用持仓市值×次日涨跌估算各板块对组合的盈亏贡献。"
        f"样本内最大回撤发生在 {mdd_info[0]} 到 {mdd_info[1]}，幅度 {m.pct(mdd_info[2])}，"
        f"与净值曲线上 2026 年 5 月见顶后的那段一致。",
    )
    m.add_picture(doc, charts["attr"])
    m.caption(doc, "图1  各板块累计估算盈亏。若贵金属/有色是回撤主力，RX000 对冲这两块就是对症的。")
    m.add_table(
        doc,
        ["板块", "累计估算盈亏(万)", "与MOM日收益相关", "|盈亏|占比"],
        [[r["g"], m.signed_wan(r["pnl"]), f"{r['corr']:.2f}", m.pct(r["abs_pct"])] for r in attr_rows],
    )
    m.caption(doc, "表1  板块贡献。相关高且 |盈亏| 占比大的板块，最值得放进 RX000 对冲名单。")
    m.para(
        doc,
        "RX000 本身已是自营账户，最新约 1000 万权益，近期净持仓以沪铜、黄金为主，"
        "历史上还做过国债、碳酸锂、白银、股指。把对冲放在这个账户，不改变投顾账面，结算路径也现成。",
    )

    m.heading(doc, "三、三种不砍投顾仓的做法", 1)
    m.heading(doc, "3.1 开仓前冻结加仓（RX000 对冲「新开」）", 2)
    m.para(
        doc,
        "投顾旧仓一律不动。某品种当日 MCR 已经超过限额后，若他们次日还往同方向加仓，"
        "RX000 按加仓名义等额反向开仓。这等价于「超限后禁止加仓」，但执行人是我们，不是投顾。"
        "投顾可以继续交易，组合净敞口不再升高。",
    )
    m.heading(doc, "3.2 RX000 品种/板块净敞口硬顶", 2)
    m.para(
        doc,
        "对贵金属、有色、股指、原油等流动性好的品种，按「净市值 / 上日累计净资本」设顶。"
        "超顶部分由 RX000 用同一品种（或板块代理：黄金对贵金属、沪铜对有色、IM 对股指、SC 对能源）反向对冲。"
        "投顾仓保持原样。这是最简单、最好值班的规则：只看一张净敞口表。",
    )
    m.heading(doc, "3.3 预测波动超标时，只对冲宏观篮子", 2)
    m.para(
        doc,
        "当 VaR 沙盒给出的组合预测年化波动高于目标（例如 18%），"
        "RX000 按超标比例对冲黄金/铜/原油/股指篮子，其它农产品、化工细项不动。"
        "这比按品种砍仓简单，也比全年固定对冲更省「平时的利润」。",
    )

    m.heading(doc, "四、回测：这些容易做的规则，能不能降波、保住夏普", 1)
    m.para(
        doc,
        "所有方案都叠在官方 MOM 净值上：只加减对冲盈亏，申购赎回不变，指标口径与净值曲线页一致。"
        "「25/45 只砍亏」仍列在表里作为对照，提醒那是效果好但难执行的上界。",
    )
    show = strats
    m.add_picture(doc, charts["nav"])
    m.caption(doc, "图2  MOM 实际净值 vs 若干可执行叠加。")
    m.add_picture(doc, charts["bars"])
    m.caption(doc, "图3  年化波动、最大回撤、夏普。灰柱为实盘。目标是左两柱下降、夏普不塌。")

    arows = [[
        "MOM实际",
        "—",
        m.pct(base_st["total_ret"]),
        m.pct(base_st["ann_vol"]),
        m.pct(base_st["mdd"]),
        f"{base_st['sharpe']:.2f}",
        "0.0",
        "—",
    ]]
    for s in show:
        arows.append(
            [
                s["short"],
                str(s["n"]),
                m.pct(s["st"]["total_ret"]),
                f"{m.pct(s['st']['ann_vol'])}（{(s['st']['ann_vol']/base_st['ann_vol']-1)*100:+.1f}%）",
                f"{m.pct(s['st']['mdd'])}（{(s['st']['mdd']/base_st['mdd']-1)*100:+.1f}%）",
                f"{s['st']['sharpe']:.2f}（{s['st']['sharpe']-base_st['sharpe']:+.2f}）",
                m.signed_wan(s["net"]),
                m.wan(s["avg_notional"]),
            ]
        )
    m.add_table(
        doc,
        ["方案", "干预次数", "累计收益", "年化波动", "最大回撤", "夏普", "对冲净盈亏(万)", "次均对冲名义(万)"],
        arows,
    )
    m.caption(doc, "表2  可执行方案对照。波动/回撤括号为相对 MOM 实际。对冲净盈亏是 RX000 叠加本身的累计盈亏。")

    m.heading(doc, "五、建议怎么落地（保留原建议，加上容易做的）", 1)
    m.para(
        doc,
        f"综合降波、夏普与可执行性，优先落地：{rec['name']}。"
        f"样本内年化波动 {m.pct(base_st['ann_vol'])} → {m.pct(rec['st']['ann_vol'])}，"
        f"最大回撤 {m.pct(base_st['mdd'])} → {m.pct(rec['st']['mdd'])}，"
        f"夏普 {base_st['sharpe']:.2f} → {rec['st']['sharpe']:.2f}。"
        f"执行只发生在 RX000，不改投顾指令。",
    )
    m.para(
        doc,
        "建议写成三层，由易到难：",
    )
    m.para(
        doc,
        "第一层（本周就能做）：RX000 对贵金属、有色设净敞口顶。"
        "操作手册一句话：全产品黄金+白银净市值不得超过上日累计净资本的约定比例，超了由 RX000 用 AU 对冲超额；"
        "沪铜等有色同理，代理品种用 CU。值班只看两张数。",
    )
    m.para(
        doc,
        "第二层（开仓前规则，写进投顾额度）：品种 MCR 已≥25% 或板块 MCR 已≥45% 时，"
        "该方向停止新开、只许减仓。若投顾仍开出来，RX000 自动对冲这笔增量。"
        "这比「已经亏了再逼他们砍」容易沟通：规则在开仓前，不涉及认赔。",
    )
    m.para(
        doc,
        "第三层（对照，不作为日常强制）：上一份报告的「25%/45% 且近5日亏损才压仓」。"
        "数字更好，但要投顾在亏损后减仓，只适合作为季度考核或双方书面同意的例外条款，不要当日常指令。",
    )
    m.para(
        doc,
        "不要单独做的：只限板块 50%、只按市值 20/40、以及要求投顾盘中平掉已有仓。"
        "全年无条件按固定比例对冲贵金属/有色（站岗式 haircut）会稳定降波，但平常会吃掉趋势利润，"
        "只适合当作「目标波动封顶」的备用，而不是默认档。",
    )
    m.para(
        doc,
        "复现：scripts/ma/generate_mcr_ops_overlay_report.py；只读 MOM 表，不改 ETL。",
        size=9,
        color=m.MUTED,
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc.save(REPORT_PATH)
    try:
        doc.save(REPORT_PATH_ASCII)
    except Exception:
        pass
    print("wrote", REPORT_PATH)


def pick_rec(base_st, strats):
    scored = []
    for s in strats:
        if s["kind"] == "cut_advisors":
            continue
        vol_ok = s["st"]["ann_vol"] < base_st["ann_vol"] * 0.98
        sharpe_ok = s["st"]["sharpe"] >= base_st["sharpe"] - 0.05
        ease = {"pretrade_offset": 3, "rx000_sector_proxy": 4, "rx000_product_cap": 4, "vol_target": 2, "standing": 3}.get(s["kind"], 1)
        if vol_ok and sharpe_ok:
            scored.append((s["st"]["ann_vol"], -s["st"]["sharpe"], -ease, s))
    if scored:
        scored.sort()
        return scored[0][-1]
    return min(strats, key=lambda s: (s["st"]["ann_vol"], -s["st"]["sharpe"]))


def main():
    configure_and_helpers()
    with (OUT_DIR / "_mcr_risk_rules_cache.pkl").open("rb") as f:
        blob = pickle.load(f)
    days = blob["days"]
    pct_map, mkt_dates = blob["pct_map"], blob["mkt_dates"]
    conn = psycopg2.connect(m.DB_URL)
    try:
        official = m.load_official_mom_nav(conn)
    finally:
        conn.close()
    base_st = m.mom_nav_stats(official["nav"], official["ret"])
    print("base", {k: round(base_st[k], 4) if isinstance(base_st[k], float) else base_st[k] for k in ("total_ret", "ann_vol", "mdd", "sharpe")})

    book, rx, pos_dates = load_book_mv()
    print("book days", len(pos_dates), "rx days", len(rx))

    def nxt_fn(prod, date):
        return next_ret(pct_map, mkt_dates, prod, date)

    attr_rows, _, _, _ = attribution(book, pos_dates, official, nxt_fn)
    mdd_info = find_mdd_window(official["nav"], official["dates"])
    print("mdd window", mdd_info[0], mdd_info[1], f"{mdd_info[2]*100:.2f}%")

    groups = {"贵金属": PRECIOUS, "有色": BASEMETAL, "股指": {"IH", "IF", "IC", "IM"}, "能源化工": {"SC", "FU", "LU", "BU", "PG"}}
    hedge_prods = sorted(PRECIOUS | BASEMETAL | {"SC", "IM", "IF", "IC"})

    strats = []
    print("strategies")
    strats.append(strategy_pretrade_offset(days, book, pos_dates, official, nxt_fn, 0.25, "品种MCR≥25%后，RX000对冲同向加仓", "开仓前25%对冲增量"))
    strats.append(strategy_pretrade_offset(days, book, pos_dates, official, nxt_fn, 0.30, "品种MCR≥30%后，RX000对冲同向加仓", "开仓前30%对冲增量"))
    strats.append(strategy_product_cap_hedge(book, pos_dates, official, nxt_fn, hedge_prods, 0.12, "宏观品种净市值<12%资本，RX000同品种对冲超额", "宏观单品种12%顶"))
    strats.append(strategy_product_cap_hedge(book, pos_dates, official, nxt_fn, sorted(PRECIOUS | BASEMETAL), 0.15, "贵金属+有色单品种净市值<15%资本", "贵金有色15%顶"))
    strats.append(strategy_sector_proxy_hedge(book, pos_dates, official, nxt_fn, groups, 0.18, "板块净市值<18%资本，AU/CU/IM/SC代理对冲", "板块18%代理对冲"))
    strats.append(strategy_sector_proxy_hedge(book, pos_dates, official, nxt_fn, {"贵金属": PRECIOUS, "有色": BASEMETAL}, 0.15, "仅贵金属/有色板块净市值<15%，AU/CU对冲", "贵金有色板块15%"))
    strats.append(strategy_vol_target(days, official, nxt_fn, 0.18, HEDGE_UNIVERSE, "预测波动>18%时对冲宏观篮子至18%", "波动封顶18%"))
    strats.append(strategy_standing_haircut(book, pos_dates, official, nxt_fn, sorted(PRECIOUS | BASEMETAL), 0.30, "贵金属+有色净敞口常年对冲30%", "贵金有色常年30%"))

    # keep previous advice as benchmark
    cut = m.apply_rule(
        days,
        official,
        pct_map,
        mkt_dates,
        m.spec("MCR 25/45，只砍近5日亏损品种", "25/45 只砍亏", 0.25, 0.45, loser_only=True, extra=True),
    )
    strats.append(
        {
            "name": "对照：超限且近5日亏损才压投顾仓（难执行）",
            "short": "25/45只砍亏(难)",
            "kind": "cut_advisors",
            "rebuilt": {"dates": cut["dates"], "nav": cut["nav_c"], "ret": cut["cf_ret"]},
            "st": cut["c_st"],
            "extra": cut["cf"] - cut["actual"],
            "n": cut["n_signal"],
            "avg_notional": 0.0,
            "net": cut["net"],
        }
    )

    for s in strats:
        print(
            f"  {s['short']:<22} vol={s['st']['ann_vol']*100:5.2f} mdd={s['st']['mdd']*100:5.2f} "
            f"sharpe={s['st']['sharpe']:4.2f} ret={s['st']['total_ret']*100:5.1f} n={s['n']}"
        )

    rec = pick_rec(base_st, strats)
    print("recommend", rec["short"])

    easy = [s for s in strats if s["kind"] != "cut_advisors"]
    # pick a few for the nav overlay to keep it readable
    nav_show = []
    for key in ("贵金有色板块15%", "开仓前25%对冲增量", "波动封顶18%", "宏观单品种12%顶"):
        hit = next((s for s in strats if s["short"] == key), None)
        if hit:
            nav_show.append(hit)
    charts = {
        "attr": chart_attr_bar(attr_rows),
        "nav": chart_navs(official, nav_show, "MOM产品净值：实际 vs RX000/开仓前方案", "ops_02_nav.png"),
        "bars": chart_risk_bars(base_st, easy, "ops_03_risk_bars.png"),
    }
    write_doc(official, base_st, attr_rows, mdd_info, strats, charts, rec)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
