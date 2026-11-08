# -*- coding: utf-8 -*-
"""Chinese Word report: site traffic for October 2026.

HTTP coverage is 1–12 Oct (prior extract) and 20–31 Oct (nginx still on disk).
13–19 Oct access logs have rotated off. Login history covers the full month.
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_cn_traffic_report as g

EARLY_RAW = ROOT / "reports" / "_week_traffic_raw_20260929"
LATE_RAW = ROOT / "reports" / "_october_traffic_raw"
g.CHART_DIR = ROOT / "reports" / "_october_traffic_charts"
OUT = ROOT / "reports"

MONTH_START = "2026-10-01"
MONTH_END = "2026-10-31"
GAP_START = "2026-10-13"
GAP_END = "2026-10-19"
HOLIDAY_END = "2026-10-07"  # observed quiet stretch, inclusive


def read_tsv(path: Path, columns: list[str]) -> pd.DataFrame:
    df = pd.read_csv(path, sep="\t", header=None, names=columns, dtype=str, keep_default_na=False)
    return df.loc[df[columns[0]].str.strip().ne("")].copy()


def load_parts() -> dict:
    early_daily = pd.read_csv(EARLY_RAW / "daily.csv")
    early_hourly = pd.read_csv(EARLY_RAW / "hourly.csv")
    early_daily["date"] = early_daily["date"].astype(str)
    early_hourly["date"] = early_hourly["date"].astype(str)
    early_daily = early_daily.loc[early_daily["date"].between(MONTH_START, "2026-10-12")].copy()
    early_hourly = early_hourly.loc[early_hourly["date"].between(MONTH_START, "2026-10-12")].copy()

    late_daily = pd.read_csv(LATE_RAW / "daily.csv")
    late_hourly = pd.read_csv(LATE_RAW / "hourly.csv")
    late_daily["date"] = late_daily["date"].astype(str)
    late_hourly["date"] = late_hourly["date"].astype(str)

    daily = pd.concat([early_daily, late_daily], ignore_index=True)
    daily["gb"] = daily["bytes"] / (1024 ** 3)
    daily["weekday"] = pd.to_datetime(daily["date"]).dt.weekday
    daily["covered"] = True
    hourly = pd.concat([early_hourly, late_hourly], ignore_index=True)

    calendar = pd.DataFrame({"date": pd.date_range(MONTH_START, MONTH_END).strftime("%Y-%m-%d")})
    calendar["weekday"] = pd.to_datetime(calendar["date"]).dt.weekday
    full = calendar.merge(daily, on=["date", "weekday"], how="left")
    full["covered"] = full["covered"].eq(True)
    full["gap"] = full["date"].between(GAP_START, GAP_END)

    paths = pd.read_csv(LATE_RAW / "top_paths.csv")
    pages = pd.read_csv(LATE_RAW / "top_pages.csv")
    status = pd.read_csv(LATE_RAW / "status.csv")
    devices = pd.read_csv(LATE_RAW / "devices.csv")
    networks = pd.read_csv(LATE_RAW / "networks.csv")
    ips = pd.read_csv(LATE_RAW / "ips.csv")
    mcp = pd.read_csv(LATE_RAW / "mcp_by_day.csv")
    status_day = pd.read_csv(LATE_RAW / "status_by_day.csv")
    summary = g.json.loads((LATE_RAW / "summary.json").read_text(encoding="utf-8"))

    login = read_tsv(
        LATE_RAW / "login_month.tsv",
        ["who", "ts", "success", "fail_reason", "user_agent", "ip"],
    )
    users = read_tsv(LATE_RAW / "users_month.tsv", ["name", "role", "created"])
    login["ts"] = pd.to_datetime(login["ts"])
    login["success"] = login["success"].str.lower().isin(["t", "true", "1"])
    login["who"] = login["who"].str.strip()
    login["who_norm"] = login["who"].str.lower()
    login["date"] = login["ts"].dt.strftime("%Y-%m-%d")
    login["device"] = login["user_agent"].map(g.classify_login_device)
    login["network"] = login["ip"].map(g.classify_login_net)
    login = login.loc[~login["who_norm"].eq(g.SELFTEST.lower())].copy()
    login = login.loc[login["date"].between(MONTH_START, MONTH_END)].copy()

    return {
        "full": full,
        "daily": daily,
        "hourly": hourly,
        "paths": paths,
        "pages": pages,
        "status": status,
        "devices": devices,
        "networks": networks,
        "ips": ips,
        "mcp": mcp,
        "status_day": status_day,
        "summary": summary,
        "login": login,
        "users": users,
    }


def october_features(paths: pd.DataFrame) -> list[tuple[str, int, str]]:
    """Same groups as the weekly report, with MCP and the research APK pulled out of「其它」."""
    extra = [
        ("基金数据 MCP", "/ma/api/fund-data/mcp", "api"),
        ("MOM 数据 MCP", "/ma/api/mom-data/mcp", "api"),
        ("研究 App 安装包", "/app/fof-research.apk", "static"),
    ]
    rows = g.feature_rows(paths)
    pull = []
    pulled = 0
    for name, prefix, kind in extra:
        hits = int(paths.loc[paths["path"].astype(str).str.startswith(prefix), "hits"].sum())
        if hits:
            pull.append((name, hits, kind))
            pulled += hits
    out = []
    for name, hits, kind in rows:
        if str(name).startswith("其它"):
            hits -= pulled
        if hits > 0:
            out.append((name, hits, kind))
    out.extend(pull)
    return out


def make_charts(d: dict) -> dict[str, Path]:
    g.CHART_DIR.mkdir(parents=True, exist_ok=True)
    charts: dict[str, Path] = {}
    full = d["full"]
    hourly = d["hourly"]
    login = d["login"]
    labels = [g.date_label(x).replace("(一)", "").replace("(二)", "").replace("(三)", "").replace("(四)", "").replace("(五)", "").replace("(六)", "").replace("(日)", "") for x in full["date"]]
    # Keep weekday character: 10/1(四) is long for 31 bars. Use 1–31.
    labels = [str(pd.to_datetime(x).day) for x in full["date"]]
    x = np.arange(len(full))
    covered = full["covered"].to_numpy()

    kinds = ["page", "api", "heartbeat", "static", "probe", "admin", "login", "other"]
    colors = {
        "page": g.C_NAVY, "api": g.C_TEAL, "heartbeat": g.C_GOLD, "static": g.C_GRAY,
        "probe": g.C_RED, "admin": g.C_PURPLE, "login": g.C_GREEN, "other": g.C_ORANGE,
    }
    fig, ax = plt_bar_gap(full, labels)
    bottom = np.zeros(len(full))
    for k in kinds:
        vals = full[k].fillna(0).to_numpy(dtype=float)
        vals = np.where(covered, vals, np.nan)
        ax.bar(x, np.nan_to_num(vals), bottom=np.nan_to_num(bottom), color=colors[k], width=0.78, label=g.KIND_CN[k])
        bottom = np.nan_to_num(bottom) + np.nan_to_num(vals)
    shade_gap(ax, full)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, **g.fp(), fontsize=7)
    ax.legend(prop=g._CN_FONT, fontsize=7, frameon=False, ncol=4, loc="upper left")
    g.style_ax(ax, "2026 年 10 月按日请求量（灰带 = 日志已轮转）", "日（北京时间）", "请求数")
    charts["daily_kind"] = g.save_fig(fig, "cn_daily_kind.png")

    hours = np.arange(24)
    prod_h = hourly.groupby("hour")["product"].sum().reindex(hours, fill_value=0)
    fig, ax = g.plt.subplots(figsize=(8.4, 3.5))
    hi = float(prod_h.quantile(0.85))
    mid = float(prod_h.median())
    bar_colors = [g.C_RED if v >= hi else (g.C_GOLD if v >= mid else g.C_TEAL) for v in prod_h]
    ax.bar(hours, prod_h.to_numpy(), color=bar_colors, width=0.72)
    ax.set_xticks(hours)
    g.style_ax(ax, "产品请求按钟点合计（仅有日志的 24 天）", "小时（北京时间）", "产品请求数")
    charts["hourly_product"] = g.save_fig(fig, "cn_hourly_product.png")

    day_order = list(full["date"])
    mat = (
        hourly.pivot_table(index="date", columns="hour", values="product", aggfunc="sum")
        .reindex(index=day_order, columns=hours)
    )
    fig, ax = g.plt.subplots(figsize=(8.6, 6.4))
    data = np.ma.masked_invalid(mat.to_numpy(dtype=float))
    cmap = g.plt.cm.Blues.copy()
    cmap.set_bad("#EDF2F7")
    im = ax.imshow(data, aspect="auto", cmap=cmap)
    ax.set_xticks(hours[::2])
    ax.set_yticks(range(len(day_order)))
    ylabels = []
    for day, gap in zip(full["date"], full["gap"]):
        text = g.date_label(day)
        ylabels.append(text + " 缺" if gap else text)
    ax.set_yticklabels(ylabels, **g.fp(), fontsize=7)
    ax.set_xlabel("小时（北京时间）", **g.fp(), fontsize=9, color="#4A5568")
    ax.set_title("产品请求热力图（灰行 = 10 月 13–19 日无 access.log）", **g.fp(), fontsize=12, color=g.C_NAVY, pad=10)
    ax.tick_params(colors="#4A5568", labelsize=8)
    cbar = fig.colorbar(im, ax=ax, fraction=0.03, pad=0.02)
    cbar.ax.tick_params(labelsize=7)
    cbar.set_label("请求数", **g.fp(), fontsize=8)
    fig.tight_layout()
    charts["heatmap"] = g.save_fig(fig, "cn_heatmap.png")

    feats = october_features(d["paths"])
    top = sorted(feats, key=lambda r: r[1], reverse=True)[:14]
    fig, ax = g.plt.subplots(figsize=(8.4, 4.8))
    names = [r[0] for r in top][::-1]
    vals = [r[1] for r in top][::-1]
    kinds_l = [r[2] for r in top][::-1]
    kind_color = {
        "polling": g.C_GOLD, "api": g.C_TEAL, "page": g.C_NAVY, "prefetch": g.C_PURPLE,
        "admin": g.C_ORANGE, "noise": g.C_RED, "static": g.C_GRAY, "other": g.C_ORANGE,
    }
    y = np.arange(len(names))
    ax.barh(y, vals, color=[kind_color.get(k, g.C_GRAY) for k in kinds_l], height=0.62)
    ax.set_yticks(y)
    ax.set_yticklabels(names, **g.fp())
    g.style_ax(ax, "10 月 20–31 日高频路径分组", "", "命中次数")
    charts["features"] = g.save_fig(fig, "cn_features.png")

    st = d["status"].sort_values("hits", ascending=False)
    fig, ax = g.plt.subplots(figsize=(8.4, 3.4))
    sc = [g.C_GREEN if s < 400 else (g.C_GOLD if s < 500 else g.C_RED) for s in st["status"]]
    ax.bar([str(s) for s in st["status"]], st["hits"], color=sc, width=0.7)
    g.style_ax(ax, "10 月 20–31 日 HTTP 状态码", "状态码", "命中次数")
    charts["status"] = g.save_fig(fig, "cn_status.png")

    fig, ax = g.plt.subplots(figsize=(8.4, 3.6))
    net = d["networks"].copy()
    net["label"] = net["network"].map(lambda v: g.NET_CN.get(v, v))
    net = net.sort_values("hits", ascending=True)
    y = np.arange(len(net))
    ax.barh(y, net["hits"], color=g.C_NAVY, height=0.55)
    ax.set_yticks(y)
    ax.set_yticklabels(list(net["label"]), **g.fp())
    g.style_ax(ax, "10 月 20–31 日按网段的请求量", "", "命中次数")
    charts["networks"] = g.save_fig(fig, "cn_networks.png")

    fig, ax = g.plt.subplots(figsize=(8.4, 3.5))
    dev = d["devices"].copy()
    dev["label"] = dev["device"].map(lambda v: g.DEV_CN.get(v, v))
    ax.bar(dev["label"], dev["hits"], color=g.PALETTE[: len(dev)], width=0.62)
    g.style_ax(ax, "10 月 20–31 日按终端的请求量", "", "命中次数")
    charts["devices"] = g.save_fig(fig, "cn_devices.png")

    by_day = (
        login.groupby(["date", "who"]).size().unstack(fill_value=0).reindex(full["date"], fill_value=0)
    )
    fig, ax = g.plt.subplots(figsize=(8.8, 3.9))
    x2 = np.arange(len(by_day))
    bottom = np.zeros(len(by_day))
    order = by_day.sum().sort_values(ascending=False).index.tolist()
    for i, name in enumerate(order):
        vals = by_day[name].to_numpy(dtype=float)
        ax.bar(x2, vals, bottom=bottom, color=g.PALETTE[i % len(g.PALETTE)], width=0.72, label=name)
        bottom += vals
    shade_gap(ax, full)
    ax.set_xticks(x2)
    ax.set_xticklabels(labels, **g.fp(), fontsize=7)
    ax.legend(prop=g._CN_FONT, fontsize=7, frameon=False, ncol=5, loc="upper left")
    g.style_ax(ax, "10 月全月重新登录次数（灰带那周没有 HTTP 日志，登录仍在）", "日", "登录次数")
    charts["logins"] = g.save_fig(fig, "cn_logins.png")
    return charts


def plt_bar_gap(full: pd.DataFrame, labels: list[str]):
    fig, ax = g.plt.subplots(figsize=(8.8, 4.0))
    return fig, ax


def shade_gap(ax, full: pd.DataFrame) -> None:
    gap_idx = np.flatnonzero(full["gap"].to_numpy())
    if len(gap_idx) == 0:
        return
    ax.axvspan(gap_idx.min() - 0.5, gap_idx.max() + 0.5, color="#E2E8F0", zorder=0)


def join_names(names: list[str]) -> str:
    if not names:
        return "无"
    if len(names) == 1:
        return names[0]
    return "、".join(names[:-1]) + "、" + names[-1]


def build_doc(d: dict, charts: dict[str, Path]) -> Path:
    full = d["full"]
    daily = d["daily"]
    hourly = d["hourly"]
    login = d["login"]
    users = d["users"]
    paths = d["paths"]
    pages = d["pages"]
    status = d["status"]
    ips = d["ips"]
    summary = d["summary"]
    mcp = d["mcp"]
    status_day = d["status_day"]
    feats = october_features(paths)

    early = daily.loc[daily["date"] <= "2026-10-12"]
    late = daily.loc[daily["date"] >= "2026-10-20"]
    holiday = daily.loc[daily["date"] <= HOLIDAY_END]
    early_work = early.loc[early["date"] >= "2026-10-08"]
    late_work = late.loc[late["weekday"] < 5]
    late_weekend = late.loc[late["weekday"] >= 5]

    n_early = int(early["all"].sum())
    n_late = int(late["all"].sum())
    prod_early = int(early["product"].sum())
    prod_late = int(late["product"].sum())
    page_early = int(early["page"].sum())
    page_late = int(late["page"].sum())
    gb_early = float(early["gb"].sum())
    gb_late = float(late["gb"].sum())
    n_late_ip = int(summary["unique_ips"])

    busiest = daily.loc[daily["all"].idxmax()]
    quiet_late = late.loc[late["all"].idxmin()]
    page_peak = daily.loc[daily["page"].idxmax()]

    hour_sum = hourly.groupby("hour")["product"].sum()
    top_hours = hour_sum.sort_values(ascending=False).head(3)
    top_h_txt = "、".join(f"{int(h):02d} 时（{g.fmt_int(v)}）" for h, v in top_hours.items())
    peak = hourly.loc[hourly["product"].idxmax()]

    n_late_all = int(summary["hits_in_week"])
    ok_2xx = int(status.loc[status["status"].between(200, 299), "hits"].sum())
    n_404 = g.status_hits(status, 404)
    n_499 = g.status_hits(status, 499)
    n_500 = g.status_hits(status, 500)
    n_502 = g.status_hits(status, 502)
    n_304 = g.status_hits(status, 304)
    n_206 = g.status_hits(status, 206)
    vercel_404 = int(paths.loc[paths["path"].astype(str).str.startswith("/_vercel/insights"), "hits"].sum())
    apk_hits = int(paths.loc[paths["path"].astype(str).str.startswith("/app/fof-research.apk"), "hits"].sum())
    mcp_total = int(paths.loc[paths["path"].astype(str).eq("/ma/api/fund-data/mcp"), "hits"].sum())
    mcp_block = int(mcp["mcp_undici_or_115"].sum())
    prefetch_pages = [
        "/ma/dashboard/all-weather", "/ma/dashboard/futures-market", "/ma/dashboard/options-market",
        "/ma/dashboard/macro-market", "/ma/dashboard/ai-knowledge", "/ma/dashboard/ai-researcher",
        "/ma/dashboard/realtime-quotes", "/ma/dashboard/stock-market", "/ma/dashboard/tools",
        "/ma/dashboard/event-calendar",
    ]
    prefetch_hits = int(pages.loc[pages["path"].isin(prefetch_pages), "hits"].sum())
    private_page = int(pages.loc[pages["path"].astype(str).str.startswith("/ma/dashboard/private-funds"), "hits"].sum())
    mom_page = int(pages.loc[pages["path"].astype(str).str.startswith("/ma/dashboard/mom-analysis"), "hits"].sum())
    account_api = int(paths.loc[paths["path"].astype(str).str.startswith("/ma/api/account-risk"), "hits"].sum())
    mom_api = int(paths.loc[paths["path"].astype(str).str.startswith("/ma/api/mom-analysis"), "hits"].sum())

    office_hits = int(ips.loc[ips["ip"].eq("116.237.193.158"), "hits"].sum())
    office_share = office_hits / n_late_all if n_late_all else 0

    login_ok = int(login["success"].sum())
    login_fail = int((~login["success"]).sum())
    people = list(login.loc[login["success"]].groupby("who").size().sort_values(ascending=False).index)
    fail_only = [
        name for name in login.loc[~login["success"], "who"].unique()
        if name not in set(people)
    ]
    named = set(users["name"].str.lower())
    inactive = [n for n in users["name"] if n.lower() not in set(login["who_norm"])]
    new_users = users.loc[
        users["created"].between(f"{MONTH_START} 00:00:00", f"{MONTH_END} 23:59:59"),
        "name",
    ].tolist()
    gap_login = login.loc[login["date"].between(GAP_START, GAP_END)]
    gap_people = sorted(gap_login["who"].unique())
    holiday_login = login.loc[login["date"] <= HOLIDAY_END]

    by_who = (
        login.groupby("who")
        .agg(events=("ts", "size"), ok=("success", "sum"), days=("date", "nunique"),
             first=("ts", "min"), last=("ts", "max"))
        .sort_values("events", ascending=False)
    )
    err502 = (
        status_day.loc[status_day["status"].eq(502)]
        .sort_values("hits", ascending=False)
    )
    err502_txt = "、".join(
        f"{g.date_label(r.date)} {g.fmt_int(r.hits)} 次" for r in err502.head(4).itertuples()
    )

    s502_share_top3 = int(err502.head(3)["hits"].sum()) if len(err502) else 0

    doc = g.Document()
    for sec in doc.sections:
        sec.top_margin = g.Cm(1.8)
        sec.bottom_margin = g.Cm(1.8)
        sec.left_margin = g.Cm(1.7)
        sec.right_margin = g.Cm(1.7)
        sec.page_width = g.Cm(21.0)
        sec.page_height = g.Cm(29.7)

    g.para(doc, "投研看板  ·  内部运营报告", size=10, color=g.GOLD, space_after=2)
    g.para(doc, "2026 年 10 月网站流量分析", size=22, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "数据来源：nginx access.log（含轮转文件）与 public.auth_login_history  ·  "
        "时区：Asia/Shanghai  ·  日历月：2026-10-01 至 2026-10-31  ·  "
        f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}",
        size=9, color=g.MUTED, space_after=14,
    )

    g.heading(doc, "一、执行摘要", 1)
    g.para(
        doc,
        f"10 月 HTTP 日志能复原 24 天：1–12 日来自 10 月 13 日之前已经汇总的访问记录，"
        f"20–31 日来自服务器上仍在的 access.log 及轮转文件。"
        f"13–19 日的 access.log 已按约 14 份轮转丢掉，这 7 天的请求次数、页面和接口无法补回。"
        f"登录表覆盖整个 10 月，那一周谁重新输入过密码仍然知道。",
    )
    g.para(
        doc,
        f"有日志的前 12 天共 {g.fmt_int(n_early)} 次请求、产品请求 {g.fmt_int(prod_early)}、"
        f"页面 {g.fmt_int(page_early)}、传输 {gb_early:.2f} GB。"
        f"后 12 天共 {g.fmt_int(n_late)} 次请求、产品请求 {g.fmt_int(prod_late)}、"
        f"页面 {g.fmt_int(page_late)}、传输 {gb_late:.2f} GB，来自 {g.fmt_int(n_late_ip)} 个 IP。"
        f"两段日历天数相同，后段约为前段请求量的 {n_late / n_early:.1f} 倍，主要因为前段含国庆近空窗。"
        f"全月有日志的单日最高是 {g.date_label(str(busiest['date']))}，{g.fmt_int(busiest['all'])} 次，"
        f"其中页面 {g.fmt_int(busiest['page'])}。",
    )
    g.para(
        doc,
        f"10 月 1–6 日每天只有几百到一千多次请求，和扫描、残留心跳一个量级。"
        f"10 月 7 日回到 {g.fmt_int(int(daily.loc[daily['date'].eq('2026-10-07'), 'all'].iloc[0]))} 次，"
        f"登录表里这一周只有 {join_names(sorted(holiday_login['who'].unique())) or '无人'} "
        f"在 {g.date_label('2026-10-07')} 有记录。"
        f"10 月 8 日起恢复上班。后段工作日（20–23 日、26–30 日）日均 {g.fmt_int(late_work['all'].mean())} 次，"
        f"周末（24、25、31 日）日均 {g.fmt_int(late_weekend['all'].mean())} 次。"
        f"后段最安静的是 {g.date_label(str(quiet_late['date']))}（{g.fmt_int(quiet_late['all'])} 次）。",
    )
    g.para(
        doc,
        f"全月重新登录 {len(login)} 次，成功 {login_ok}、失败 {login_fail}。"
        f"成功登进去的是 {len(people)} 个账号：{join_names(list(people))}。"
        + (f"另有 {join_names(fail_only)} 只出现在失败记录里，不在用户表中，不算使用账号。" if fail_only else "")
        + (f"本月新开账号：{join_names(new_users)}。" if new_users else "")
        + (f"注册在册、本月没有重新登录的是 {join_names(inactive)}。" if inactive else "")
        + f"13–19 日虽然没有 HTTP 日志，登录仍有 {len(gap_login)} 次，账号为 {join_names(gap_people)}。",
    )
    g.para(
        doc,
        f"后段请求里，办公室出口 116.237.193.158 占 {office_share:.0%}，同一 NAT 后面是多人，独立 IP 不能当用户数。"
        f"/ma/api/fund-data/mcp 在 20–31 日有 {g.fmt_int(mcp_total)} 次，占该段全部请求的 {g.fmt_pct(mcp_total, n_late_all)}。"
        f"其中 User-Agent 为 undici 或来自 115.175.161.* 的有 {g.fmt_int(mcp_block)} 次，其余是办公室和其他客户端，"
        f"不能再把 MCP 全部算成那一个 Node 网段。"
        f"有意图的页面仍是私募（{g.fmt_int(private_page)} 次）和 MOM 分析（{g.fmt_int(mom_page)} 次）。"
        f"侧栏预取合计 {g.fmt_int(prefetch_hits)} 次。2xx 占后段的 {g.fmt_pct(ok_2xx, n_late_all)}。"
        f"502 共 {g.fmt_int(n_502)} 次，集中在 {err502_txt}。",
        space_after=12,
    )

    g.heading(doc, "二、数据口径", 1)
    g.add_table(
        doc,
        ["项目", "取值"],
        [
            ["日历月", "2026-10-01 至 2026-10-31（北京时间，31 个自然日）"],
            ["HTTP：10/1–10/12", "2026-10-13 前已落盘的日汇总（reports 内上一窗口按日拆出，不含 9 月 29–30 日）"],
            ["HTTP：10/20–10/31", "服务器 /var/log/nginx/access.log 及 access.log.1–.14.gz，采集于 2026-11-03"],
            ["HTTP 缺口", "10/13–10/19。轮转只保留约 14 份，这 7 天的原始行已不在磁盘上"],
            ["登录", "public.auth_login_history，10 月 1 日 0 时至 11 月 1 日 0 时，全月"],
            ["前 12 日 全部 / 产品 / 页面", f"{g.fmt_int(n_early)} / {g.fmt_int(prod_early)} / {g.fmt_int(page_early)}"],
            ["后 12 日 全部 / 产品 / 页面", f"{g.fmt_int(n_late)} / {g.fmt_int(prod_late)} / {g.fmt_int(page_late)}"],
            ["后 12 日 页面 / API / 心跳 / 静态 / 扫描",
             f"{g.fmt_int(summary['kind']['page'])} / {g.fmt_int(summary['kind']['api'])} / "
             f"{g.fmt_int(summary['kind']['heartbeat'])} / {g.fmt_int(summary['kind']['static'])} / "
             f"{g.fmt_int(summary['kind']['probe'])}"],
            ["后 12 日传输 / 独立 IP", f"{gb_late:.2f} GB / {g.fmt_int(n_late_ip)}"],
            ["全月登录（成功 / 失败）", f"{len(login)}（{login_ok} / {login_fail}）"],
            ["在册账号 / 本月重新登录", f"{len(users)} / {len(people)}"],
        ],
        col_widths=[5.4, 11.6],
    )
    g.para(doc, "", space_after=6)
    g.para(
        doc,
        "一次 HTTP 请求不是一个人，也不是一次会话。心跳、行情 live、跟踪基金池、路由预取和 MCP 都会把次数抬高。"
        "登录表只在重新输入密码时写一行。保持登录的人不会出现在登录次数里，nginx 日志本身也没有用户名。"
        "10 月 1–12 日的路径合计混在上一窗口的 9 月 29–30 日里，本报告不把那段路径表当成 10 月上旬。"
        "路径、状态码、网段、终端只描述 10 月 20–31 日。按日次数两段都可以用。",
        size=10, color=g.MUTED, space_after=12,
    )

    g.heading(doc, "三、流量什么时候发生", 1)
    g.para(
        doc,
        f"国庆把上旬切开。10 月 1–7 日合计 {g.fmt_int(holiday['all'].sum())} 次，"
        f"其中 1–6 日每天 {g.fmt_int(int(holiday.loc[holiday['date'] < '2026-10-07', 'all'].min()))}–"
        f"{g.fmt_int(int(holiday.loc[holiday['date'] < '2026-10-07', 'all'].max()))} 次。"
        f"10 月 8 日 {g.fmt_int(int(daily.loc[daily['date'].eq('2026-10-08'), 'all'].iloc[0]))} 次，"
        f"10 月 9 日 {g.fmt_int(int(daily.loc[daily['date'].eq('2026-10-09'), 'all'].iloc[0]))} 次，"
        f"10 月 12 日周一 {g.fmt_int(int(daily.loc[daily['date'].eq('2026-10-12'), 'all'].iloc[0]))} 次，"
        f"是全月有记录的最高日，页面也最高（{g.fmt_int(page_peak['page'])}）。"
        f"这三天日均 {g.fmt_int(early_work.loc[early_work['date'].isin(['2026-10-08', '2026-10-09', '2026-10-12']), 'all'].mean())} 次。"
        f"10 月 10–11 日是周末，请求还在（{g.fmt_int(int(daily.loc[daily['date'].eq('2026-10-10'), 'all'].iloc[0]))} 和 "
        f"{g.fmt_int(int(daily.loc[daily['date'].eq('2026-10-11'), 'all'].iloc[0]))}），"
        f"页面只有 {g.fmt_int(int(daily.loc[daily['date'].eq('2026-10-10'), 'page'].iloc[0]))} 和 "
        f"{g.fmt_int(int(daily.loc[daily['date'].eq('2026-10-11'), 'page'].iloc[0]))}，以接口为主。",
    )
    g.para(
        doc,
        f"13–19 日是空白，不是零流量。登录显示这 7 天仍有人进站。"
        f"20 日周二回到 {g.fmt_int(int(late.loc[late['date'].eq('2026-10-20'), 'all'].iloc[0]))} 次，"
        f"21 日 {g.fmt_int(int(late.loc[late['date'].eq('2026-10-21'), 'all'].iloc[0]))}、"
        f"22 日 {g.fmt_int(int(late.loc[late['date'].eq('2026-10-22'), 'all'].iloc[0]))}、"
        f"29 日 {g.fmt_int(int(late.loc[late['date'].eq('2026-10-29'), 'all'].iloc[0]))}，"
        f"都是后段的重日，仍低于 12 日。"
        f"后段工作日日均全部请求 {g.fmt_int(late_work['all'].mean())}、页面 {g.fmt_int(late_work['page'].mean())}。"
        f"10 月 25 日是周日，仍有 {g.fmt_int(int(late.loc[late['date'].eq('2026-10-25'), 'all'].iloc[0]))} 次、"
        f"页面 {g.fmt_int(int(late.loc[late['date'].eq('2026-10-25'), 'page'].iloc[0]))}，不是纯扫描。"
        f"31 日周六页面只剩 {g.fmt_int(int(late.loc[late['date'].eq('2026-10-31'), 'page'].iloc[0]))}，"
        f"API 还有 {g.fmt_int(int(late.loc[late['date'].eq('2026-10-31'), 'api'].iloc[0]))}。",
    )

    day_rows = []
    for _, row in full.iterrows():
        label = g.date_label(row["date"])
        if not row["covered"]:
            day_rows.append([label, "日志已轮转", "—", "—", "—", "—", "—", "—"])
            continue
        day_rows.append([
            label,
            g.fmt_int(row["all"]),
            g.fmt_int(row["product"]),
            g.fmt_int(row["page"]),
            g.fmt_int(row["api"]),
            g.fmt_int(row["heartbeat"]),
            g.fmt_int(row["probe"]),
            g.fmt_int(row["unique_ips"]),
        ])
    g.add_table(
        doc,
        ["日期", "全部", "产品", "页面", "API", "心跳", "扫描", "IP"],
        day_rows,
        col_widths=[2.4, 2.2, 2.0, 1.8, 1.8, 1.7, 1.6, 1.5],
    )
    g.para(doc, "", space_after=6)
    g.add_picture(doc, charts["daily_kind"], 6.5)
    g.caption(doc, "图 1. 按日请求量。灰色竖带是 10 月 13–19 日，不是零流量，是 access.log 已不在。")
    g.para(
        doc,
        f"有日志的 24 天里，产品请求最高的三个钟点是 {top_h_txt}。"
        f"12 时合计 {g.fmt_int(hour_sum.get(12, 0))}，相对上午有午间回落。"
        f"0–6 时合计 {g.fmt_int(hour_sum.loc[0:6].sum())}。"
        f"单小时最高在 {g.date_label(str(peak['date']))} {int(peak['hour']):02d} 时："
        f"产品请求 {g.fmt_int(peak['product'])}，页面 {g.fmt_int(peak['page'])}，API {g.fmt_int(peak['api'])}。"
        f"热力图里 10 月 1–6 日整行很浅，12 日、21–22 日、27 日和 29 日的白天到晚间最深。",
    )
    g.add_picture(doc, charts["hourly_product"], 6.4)
    g.caption(doc, "图 2. 产品请求按钟点合计，只加总有日志的 24 天。红色为该小时位于前 15%。")
    g.add_picture(doc, charts["heatmap"], 6.4)
    g.caption(doc, "图 3. 产品请求热力图。标「缺」的 7 行没有 HTTP 记录。")

    g.heading(doc, "四、后半月在被用来做什么", 1)
    g.para(
        doc,
        f"这一节只看 10 月 20–31 日。MCP（{g.fmt_int(mcp_total)}）仍是单条路径的最大头，"
        f"其后是跟踪基金池、CTP live、心跳和几条实时行情接口。"
        f"私募产品页 {g.fmt_int(private_page)} 次，MOM 分析页 {g.fmt_int(mom_page)} 次。"
        f"MOM API 合计 {g.fmt_int(mom_api)} 次，单账户风控 API（/ma/api/account-risk）{g.fmt_int(account_api)} 次。"
        f"侧栏行情、AI、工具、日历挤在同一档，合计 {g.fmt_int(prefetch_hits)} 次，是进站预取。"
        f"安装包 /app/fof-research.apk 被请求 {g.fmt_int(apk_hits)} 次；"
        f"后段另有 206 分段响应 {g.fmt_int(n_206)} 次。后 12 天传了 {gb_late:.2f} GB，"
        f"前 12 天只有 {gb_early:.2f} GB，体积上来自更密的上班日，也来自安装包和大响应。",
    )
    g.add_picture(doc, charts["features"], 6.4)
    g.caption(doc, "图 4. 10 月 20–31 日高频路径。金色偏轮询，紫色是侧栏预取，深蓝是页面，青色是业务 API。")
    kind_cn = {
        "polling": "轮询", "api": "API", "page": "页面", "prefetch": "预取",
        "admin": "管理", "noise": "噪声", "static": "静态", "other": "其他",
    }
    g.add_table(
        doc,
        ["路径分组", "命中", "类型"],
        [[name, g.fmt_int(hits), kind_cn.get(k, k)] for name, hits, k in feats[:14]],
        col_widths=[8.0, 3.2, 5.8],
    )
    g.para(doc, "", space_after=8)
    g.para(
        doc,
        "MCP 按日（仅 20–31 日）。「undici 或 115.175.161.*」是上一期已经识别的 Node 拉数客户端，其余次数来自其他地址。",
        size=10, color=g.MUTED, space_after=4,
    )
    g.add_table(
        doc,
        ["日期", "MCP", "其中 undici 或 115.175.161.*"],
        [
            [g.date_label(r.date), g.fmt_int(r.mcp), g.fmt_int(r.mcp_undici_or_115)]
            for r in mcp.sort_values("date").itertuples()
        ],
        col_widths=[4.2, 4.2, 8.6],
    )
    g.para(doc, "", space_after=8)
    g.para(
        doc,
        f"22 日 MCP {g.fmt_int(int(mcp.loc[mcp['date'].eq('2026-10-22'), 'mcp'].iloc[0]))} 次，"
        f"该网段只占 {g.fmt_int(int(mcp.loc[mcp['date'].eq('2026-10-22'), 'mcp_undici_or_115'].iloc[0]))}。"
        f"27 日反过来，{g.fmt_int(int(mcp.loc[mcp['date'].eq('2026-10-27'), 'mcp'].iloc[0]))} 次里有 "
        f"{g.fmt_int(int(mcp.loc[mcp['date'].eq('2026-10-27'), 'mcp_undici_or_115'].iloc[0]))} 次来自该网段。"
        f"31 日周六 MCP {g.fmt_int(int(mcp.loc[mcp['date'].eq('2026-10-31'), 'mcp'].iloc[0]))} 次，该网段只有 "
        f"{g.fmt_int(int(mcp.loc[mcp['date'].eq('2026-10-31'), 'mcp_undici_or_115'].iloc[0]))} 次，"
        f"当天页面已经很少，这批接口不是手机在翻页面。",
        space_after=12,
    )

    g.heading(doc, "五、谁在登录", 1)
    g.para(
        doc,
        "人名只来自登录表：谁重新输入了密码、从哪类网络、用什么终端。"
        "办公室出口是共享 NAT，下表里的「办公室出口 A」不能拆成某一个人的请求量。"
        "没有重新登录的账号，可能仍保持着会话，这份报告不把他们写成「没用过」。",
    )
    g.add_picture(doc, charts["logins"], 6.5)
    g.caption(doc, "图 5. 全月重新登录。灰色竖带是没有 HTTP 日志的一周，登录次数仍画在上面。")

    who_rows = []
    for name, r in by_who.iterrows():
        grp = login.loc[login["who"].eq(name)]
        devices = "、".join(sorted(set(grp["device"])))
        nets = "、".join(sorted(set(grp["network"])))
        who_rows.append([
            name, int(r.events), int(r.ok), int(r.days), devices, nets,
            r["first"].strftime("%m-%d %H:%M"), r["last"].strftime("%m-%d %H:%M"),
        ])
    g.add_table(
        doc,
        ["账号", "登录", "成功", "天数", "终端", "网络", "首次", "末次"],
        who_rows,
        col_widths=[2.6, 1.3, 1.3, 1.3, 2.6, 3.2, 2.4, 2.3],
    )
    g.para(doc, "", space_after=8)

    g.para(doc, "重新登录出现在哪些天：", size=11, bold=True, color=g.NAVY, space_after=4)
    login_day_rows = []
    for name in by_who.index:
        days = sorted(set(login.loc[login["who"].eq(name), "date"]))
        # Compress consecutive dates into a readable list of calendar days.
        login_day_rows.append([name, "、".join(g.date_label(day) for day in days)])
    g.add_table(doc, ["账号", "重新登录的日期"], login_day_rows, col_widths=[2.8, 14.2])
    g.para(doc, "", space_after=8)

    if new_users:
        created = users.loc[users["name"].isin(new_users), ["name", "role", "created"]]
        g.para(
            doc,
            "本月新开：" + "；".join(
                f"{r['name']}（{r.role}，{r.created}）" for _, r in created.iterrows()
            ) + "。",
        )
    if inactive:
        g.para(
            doc,
            f"在册但 10 月没有重新登录记录的账号：{join_names(inactive)}。"
            "其中有人可能从 9 月一直保持登录。",
            space_after=8,
        )
    if login_fail:
        reasons = (
            login.loc[~login["success"]]
            .groupby(["who", "fail_reason"]).size()
            .reset_index(name="n")
            .sort_values("n", ascending=False)
        )
        g.para(doc, "失败登录：", size=11, bold=True, color=g.NAVY, space_after=4)
        g.add_table(
            doc,
            ["账号", "原因", "次数"],
            [[r.who, r.fail_reason or "—", int(r.n)] for r in reasons.itertuples()],
            col_widths=[4.0, 8.0, 3.0],
        )
        g.para(doc, "", space_after=8)

    g.heading(doc, "六、大地址和登录表", 1)
    g.para(
        doc,
        "下表是 10 月 20–31 日请求量靠前的地址，右侧是全月登录表里出现过的姓名。"
        "对得上只说明有人用这个地址重新输入过密码，不能把该地址上的每一次请求都算成这次登录。",
    )
    ip_rows = []
    for _, row in ips.head(12).iterrows():
        ip = str(row["ip"])
        success_owners = sorted(set(login.loc[login["ip"].astype(str).eq(ip) & login["success"], "who"]))
        fail_names = sorted(set(login.loc[login["ip"].astype(str).eq(ip) & ~login["success"], "who"]))
        if ip == "116.237.193.158":
            who = "办公室多人：" + join_names(success_owners)
        elif success_owners:
            who = join_names(success_owners)
            if fail_names:
                who += "（另有失败：" + join_names(fail_names) + "）"
        elif fail_names:
            who = "只有失败：" + join_names(fail_names)
        else:
            who = "登录表没有这个地址"
        ip_rows.append([
            ip,
            g.NET_CN.get(str(row["network"]), str(row["network"])),
            g.fmt_int(row["hits"]),
            g.fmt_int(row["page"]),
            g.fmt_int(row["api"]),
            who,
        ])
    g.add_table(
        doc,
        ["IP", "网段", "请求", "页面", "API", "登录表"],
        ip_rows,
        col_widths=[3.3, 2.8, 1.7, 1.5, 1.5, 6.2],
    )
    g.para(doc, "", space_after=6)
    g.para(
        doc,
        "124.79.17.112 有 43,274 次请求、7,370 次页面。10 月 26 日 12:22 有人用用户名 ben 在这个地址失败一次，"
        "12:23 benc 失败一次后立即成功。上一期这份地址对不上任何人；这一期只能确认 benc 从这里进来过一次，"
        "解释不了整段请求，其余更像更早保持着的会话。",
    )
    g.para(
        doc,
        "218.82.7.52 页面 9,991 次。登录表里 jiang 有一次从这个地址成功登录，其他账号没有。"
        "61.170.144.214 的成功登录都是 chenpeifeng，和上一期对他家庭宽带的对应一致。"
        "116.237.222.111 的成功登录都是 cshen。",
    )
    g.para(
        doc,
        "115.175.161.* 多个地址页面很少、API 很多，对应上面的 MCP 拉数，登录表没有这些地址，不应当成新的上班用户。"
        f"扫描类请求后段 {g.fmt_int(summary['kind']['probe'])} 次。"
        "方法里出现 PRI、CONNECT、FOX、BATMAN 等，是探测，不是产品流量。",
        space_after=12,
    )

    g.heading(doc, "七、可用性与终端", 1)
    g.para(
        doc,
        f"后 12 日 2xx 共 {g.fmt_int(ok_2xx)}，占 {g.fmt_pct(ok_2xx, n_late_all)}。"
        f"304 缓存 {g.fmt_int(n_304)} 次，206 分段 {g.fmt_int(n_206)} 次。"
        f"404 共 {g.fmt_int(n_404)}，其中 /_vercel/insights/script.js {g.fmt_int(vercel_404)} 次，"
        f"其余 404 多于扫描分类（{g.fmt_int(summary['kind']['probe'])}），不全是外部探测打到不存在的路径。"
        f"499（客户端断开）{g.fmt_int(n_499)}，500 {g.fmt_int(n_500)}，502 {g.fmt_int(n_502)}。",
    )
    g.para(
        doc,
        f"502 不是均匀的。最多的四天是 {err502_txt}。"
        f"前三天合计 {g.fmt_int(s502_share_top3)} 次，占后段 502 的 {g.fmt_pct(s502_share_top3, n_502)}。"
        f"21 日、29 日也是请求最多的两天之一；30 日请求已经降到 {g.fmt_int(int(late.loc[late['date'].eq('2026-10-30'), 'all'].iloc[0]))}，"
        f"502 仍有 {g.fmt_int(int(err502.loc[err502['date'].eq('2026-10-30'), 'hits'].iloc[0]))} 次，更像上游在这一天不稳定，不单是忙。"
        f"31 日 502 降到 {g.fmt_int(int(err502.loc[err502['date'].eq('2026-10-31'), 'hits'].sum()))} 次。",
    )
    g.add_picture(doc, charts["status"], 6.3)
    g.caption(doc, "图 6. 10 月 20–31 日 HTTP 状态码。绿色为 2xx/3xx，金色为 4xx，红色为 5xx。")
    g.add_picture(doc, charts["networks"], 6.3)
    g.caption(doc, "图 7. 网段。办公室出口 A 仍是最大头；「其他」里含家庭宽带、MCP 客户端和扫描。")
    g.add_picture(doc, charts["devices"], 6.3)
    g.caption(doc, "图 8. 终端。Edge 最多。undici 落在「其他」，所以这一档含 Node 拉数，不全是未知浏览器。")

    g.heading(doc, "八、结论", 1)
    g.para(
        doc,
        f"1）10 月的形状是：1–6 日近空窗，7 日只有零星登录，8 日起恢复，12 日是有日志日子里最重的一天"
        f"（{g.fmt_int(busiest['all'])} 次）。13–19 日 HTTP 不可复原，但登录没有停。"
        f"20 日之后工作日维持在日均约 {g.fmt_int(late_work['all'].mean())} 次，25 日周日仍有人在看页面。",
        space_after=3,
    )
    g.para(
        doc,
        f"2）后段 {g.fmt_int(mcp_total)} 次 MCP 里，115.175.161.* / undici 约占 {g.fmt_pct(mcp_block, mcp_total)}，"
        f"其余来自办公室和其他地址。周末和 31 日的请求量不能直接当成有人在上班，要看页面次数。",
        space_after=3,
    )
    g.para(
        doc,
        f"3）成功登录的 {len(people)} 个账号里，次数最多的是 {people[0]}。"
        + (f"新账号是 {join_names(new_users)}。" if new_users else "")
        + (f"只出现在失败记录、且不在用户表里的是 {join_names(fail_only)}。" if fail_only else "")
        + (f"本月没有重新登录记录的是 {join_names(inactive)}。" if inactive else ""),
        space_after=3,
    )
    g.para(
        doc,
        "4）看工作面应看私募和 MOM / 单账户风控。预取、心跳、行情 live、跟踪基金池和 MCP 放大了次数。",
        space_after=3,
    )
    g.para(
        doc,
        f"5）可用性上，后段 502 有 {g.fmt_int(n_502)} 次，21、29、30 日三天占了 {g.fmt_pct(s502_share_top3, n_502)}。"
        f"2xx 仍占 {g.fmt_pct(ok_2xx, n_late_all)}。登录失败 {login_fail} 次。",
        space_after=3,
    )
    g.para(
        doc,
        "6）nginx 只留约 14 个轮转文件，跨过两周就补不回中间那一周。若下月还要出整月报告，需要把 access.log 留到至少 40 天，或在轮转前拷走。",
        space_after=10,
    )
    g.para(
        doc,
        "密级：内部。日志含客户端 IP 与浏览器信息，请勿转发到团队以外。",
        size=8, color=g.MUTED,
    )

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "网站流量分析报告_2026年10月.docx"
    doc.save(str(path))
    return path


def main() -> None:
    g.configure_matplotlib()
    d = load_parts()
    charts = make_charts(d)
    path = build_doc(d, charts)
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
