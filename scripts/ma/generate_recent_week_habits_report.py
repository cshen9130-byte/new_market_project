# -*- coding: utf-8 -*-
"""Chinese Word report: last-week traffic + per-user habits."""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_cn_traffic_report as g

RAW = ROOT / "reports" / "_week_traffic_raw_20260911"
g.RAW = RAW
g.CHART_DIR = ROOT / "reports" / "_week_traffic_charts_20260918"
OUT = ROOT / "reports"

SELFTEST = g.SELFTEST


def bucket(path: str) -> str:
    p = path or ""
    if p.startswith("/api/presence") or p.startswith("/api/auth/me"):
        return "心跳 / 会话检查"
    if "fund-data/mcp" in p:
        return "MCP 数据接口"
    if "ctp-market" in p or "realtime-quotes" in p:
        return "行情轮询"
    if "tracking-funds" in p:
        return "跟踪基金"
    if "investment-notes" in p:
        return "投资笔记"
    if "private-funds" in p or p.startswith("/ma/dashboard/private-funds"):
        return "私募产品"
    if "mom-analysis" in p or "account-risk" in p:
        return "MOM / 风控"
    if p.startswith("/ma/dashboard"):
        return "其它看板页面"
    if p.startswith("/api/admin"):
        return "管理接口"
    return "其它"


ID_NAME = {
    "vziwpcge8": "benc",
    "hfiu8e17k": "caojie",
    "a2w79rr87": "chenpeifeng",
    "6dukk8tl2": "chy",
    "4mf2j0hlu": "cshen",
    "gvlumrdtx": "G.Wave",
    "ib0i0t9s3": "hcx",
    "9t3k6l9y8": "liuyamin",
    "pplws3suc": "luoshuang",
    "oqaww1g01": "musheng",
    "9nd6gyy46": "sunjie",
    "qm2x4fhmt": "sunzhou",
    "eazl0y278": "yuki",
    "8a5btv1q5": "zhougang",
    "1o1s7ybpk": "zzh",
}


def homepage_frequent_paths() -> list[tuple[str, list[tuple[str, int, str]]]]:
    """Same store the homepage quick-access uses: recent-pages/{userId}.json."""
    import math
    from datetime import timedelta, timezone

    root = ROOT / "reports" / "_recent_pages"
    if not root.is_dir():
        return []
    tz = timezone(timedelta(hours=8))
    start = datetime(2026, 9, 11, tzinfo=tz).timestamp() * 1000
    end = datetime(2026, 9, 25, tzinfo=tz).timestamp() * 1000
    now = datetime(2026, 9, 24, 21, 8, tzinfo=tz).timestamp() * 1000
    ranked = []
    for path in sorted(root.glob("*.json")):
        if path.name.endswith(".bak") or path.name.startswith("_"):
            continue
        try:
            pages = json.loads(path.read_text(encoding="utf-8")).get("pages") or []
        except Exception:
            continue
        hits = []
        for hit in pages:
            ts = hit.get("lastVisitedAt")
            count = hit.get("visitCount")
            if not isinstance(ts, (int, float)) or not isinstance(count, (int, float)):
                continue
            if not (start <= ts < end):
                continue
            age_days = max(0, (now - ts) / 86_400_000)
            score = count * math.exp(-age_days / 14)
            title = str(hit.get("title") or hit.get("href") or "")
            hits.append((score, title, int(count), datetime.fromtimestamp(ts / 1000, tz).strftime("%m-%d %H:%M")))
        hits.sort(reverse=True)
        if not hits:
            continue
        name = ID_NAME.get(path.stem, path.stem)
        ranked.append((name, [(t, c, when) for _, t, c, when in hits[:6]]))
    ranked.sort(key=lambda item: item[1][0][1] if item[1] else 0, reverse=True)
    return ranked


def top_buckets(ip_paths: pd.DataFrame, ip: str, n: int = 4) -> str:
    sub = ip_paths.loc[ip_paths["ip"] == ip]
    if sub.empty:
        return "该 IP 在本期产品路径里几乎没有记录"
    hits = {}
    for _, r in sub.iterrows():
        hits[bucket(str(r["path"]))] = hits.get(bucket(str(r["path"])), 0) + int(r["hits"])
    ranked = sorted(hits.items(), key=lambda kv: kv[1], reverse=True)[:n]
    return "、".join(f"{name} {g.fmt_int(v)}" for name, v in ranked)


def main() -> None:
    g.configure_matplotlib()
    d = g.load()
    d["ip_paths"] = pd.read_csv(RAW / "ip_paths.csv")
    charts = g.make_charts(d)

    s = d["summary"]
    daily = d["daily"]
    hourly = d["hourly"]
    login = d["login"]
    users = d["users"]
    ips = d["ips"]
    status = d["status"]
    pages = d["pages"]
    paths = d["paths"]
    ip_paths = d["ip_paths"]

    n = int(s["hits_in_week"])
    n_prod = int(s["product_hits"])
    gb = s["bytes_in_week"] / (1024 ** 3)
    kind = s["kind"]
    first_ts = datetime.fromisoformat(s["first_ts"])
    last_ts = datetime.fromisoformat(s["last_ts"])
    window_cn = (
        f"{first_ts.strftime('%Y年%m月%d日 %H:%M')} – {last_ts.strftime('%Y年%m月%d日 %H:%M')}（北京时间）"
    )

    login = login.loc[~login["who_norm"].eq(SELFTEST.lower())].copy()
    in_win = login.loc[login["date"].isin(set(daily["date"]))].copy()
    login_ok = int(in_win["success"].sum())
    login_fail = int((~in_win["success"]).sum())
    people = sorted(in_win["who"].unique())
    inactive = [name for name in users["name"] if name not in set(people)]

    weekday = daily[daily["weekday"] < 5]
    weekend = daily[daily["weekday"] >= 5]
    busiest = daily.loc[daily["all"].idxmax()]
    quietest = daily.loc[daily["all"].idxmin()]
    hour_sum = hourly.groupby("hour")["product"].sum()
    top_hours = hour_sum.sort_values(ascending=False).head(3)
    peak = hourly.loc[hourly["product"].idxmax()]
    feats = g.feature_rows(paths)

    office_ip = "116.237.193.158"
    evening_ip = "116.234.199.216"
    luo_ip = "116.234.86.252"
    caojie_ips = ["223.167.205.51", "220.196.194.165", "58.246.155.122"]

    def ip_hits(ip: str) -> int:
        return int(ips.loc[ips["ip"] == ip, "hits"].sum())

    office_hits = ip_hits(office_ip)
    named_ips = [office_ip, evening_ip, luo_ip, *caojie_ips]
    named_hits = int(ips.loc[ips["ip"].isin(named_ips), "hits"].sum())

    prefetch = [
        "/ma/dashboard/all-weather", "/ma/dashboard/futures-market", "/ma/dashboard/options-market",
        "/ma/dashboard/macro-market", "/ma/dashboard/ai-knowledge", "/ma/dashboard/ai-researcher",
        "/ma/dashboard/realtime-quotes", "/ma/dashboard/stock-market", "/ma/dashboard/tools",
    ]
    prefetch_hits = int(pages.loc[pages["path"].isin(prefetch), "hits"].sum())
    private_page = int(pages.loc[pages["path"].str.startswith("/ma/dashboard/private-funds"), "hits"].sum())
    mom_page = int(pages.loc[pages["path"].str.startswith("/ma/dashboard/mom-analysis"), "hits"].sum())

    ok_2xx = int(status.loc[status["status"].between(200, 299), "hits"].sum())
    n_404 = g.status_hits(status, 404)
    n_499 = g.status_hits(status, 499)
    n_502 = g.status_hits(status, 502)
    n_500 = g.status_hits(status, 500)
    vercel_404 = int(paths.loc[paths["path"].astype(str).str.startswith("/_vercel/insights"), "hits"].sum())

    doc = g.Document()
    for sec in doc.sections:
        sec.top_margin = g.Cm(1.8)
        sec.bottom_margin = g.Cm(1.8)
        sec.left_margin = g.Cm(2.0)
        sec.right_margin = g.Cm(2.0)

    g.para(doc, "投研看板  ·  内部运营报告", size=10, color=g.GOLD, space_after=2)
    g.para(doc, "近两周网站流量与用户使用习惯", size=22, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        f"数据来源：nginx access.log、public.auth_login_history，以及首页快速访问用的 recent-pages  ·  "
        f"时区：Asia/Shanghai  ·  窗口：{window_cn}  ·  "
        f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}",
        size=9, color=g.MUTED, space_after=14,
    )

    g.heading(doc, "一、执行摘要", 1)
    g.para(
        doc,
        f"近 14 个自然日（9 月 11 日周五至 9 月 24 日周四，周四只统计到 {last_ts.strftime('%H:%M')}）"
        f"共 {g.fmt_int(n)} 次 HTTP 请求，传输 {gb:.2f} GB，来自 {g.fmt_int(s['unique_ips'])} 个 IP。"
        f"产品请求（页面、业务 API、管理、登录）{g.fmt_int(n_prod)} 次，占 {g.fmt_pct(n_prod, n)}。"
        f"工作日日均全部请求约 {g.fmt_int(weekday['all'].mean())}，周末日均约 {g.fmt_int(weekend['all'].mean())}。"
        f"最忙的一天是 {g.date_label(str(busiest['date']))}（{g.fmt_int(busiest['all'])}），"
        f"最安静的是 {g.date_label(str(quietest['date']))}（{g.fmt_int(quietest['all'])}）。",
    )
    g.para(
        doc,
        f"登录历史本期 {len(in_win)} 次，成功 {login_ok}、失败 {login_fail}，重新输入密码的只有 "
        f"{'、'.join(people)}。浏览器里勾了保持登录的人不会再打登录接口，所以只看这张表会漏人。"
        f"站点把每个人的最近页面存在服务器上（请求头里的用户 id），按最后访问时间落在这两周来认人。"
        f"没有新登录、但最近页面有更新的是 benc、chenpeifeng、G.Wave、hcx。"
        f"这两周没有页面痕迹的是 chy、liuyamin、musheng、yuki、zhougang、zzh。",
    )
    top_h_txt = "、".join(f"{int(h):02d} 时（{g.fmt_int(v)}）" for h, v in top_hours.items())
    g.para(
        doc,
        f"使用上，真正有意图的页面是私募产品（{g.fmt_int(private_page)} 次）和 MOM 分析（{g.fmt_int(mom_page)} 次）。"
        f"侧栏约 9 个行情/AI/工具路由合计 {g.fmt_int(prefetch_hits)} 次、条数接近，是 Next.js 预取，不是九个同样受欢迎的功能。"
        f"请求量最大的是轮询：心跳、跟踪基金池、CTP live、实时行情，以及办公室上的 MCP 数据接口。"
        f"最密的三个小时是 {top_h_txt}。2xx 占 {g.fmt_pct(ok_2xx, n)}。",
        space_after=12,
    )

    g.heading(doc, "二、数据口径", 1)
    g.add_table(
        doc,
        ["项目", "取值"],
        [
            ["HTTP 来源", "服务器 /var/log/nginx/access.log 及轮转文件"],
            ["登录来源", "public.auth_login_history（每次登录写入，含账号、IP、浏览器、成败）"],
            ["窗口", f"{first_ts.strftime('%Y-%m-%d %H:%M')} 至 {last_ts.strftime('%Y-%m-%d %H:%M')}（末日不完整）"],
            ["全部 / 产品请求", f"{g.fmt_int(n)} / {g.fmt_int(n_prod)}"],
            ["页面 / API / 心跳 / 静态 / 扫描",
             f"{g.fmt_int(kind['page'])} / {g.fmt_int(kind['api'])} / {g.fmt_int(kind['heartbeat'])} / "
             f"{g.fmt_int(kind['static'])} / {g.fmt_int(kind['probe'])}"],
            ["登录（成功 / 失败）", f"{len(in_win)}（{login_ok} / {login_fail}）"],
            ["注册账号 / 本期登录", f"{len(users)} / {len(people)}"],
        ],
        col_widths=[5.5, 11.5],
    )
    g.para(doc, "", space_after=6)
    g.para(
        doc,
        "一次 HTTP 请求不是一个人，也不是一次会话。心跳、行情 live、跟踪基金池、路由预取都会把次数抬高。"
        "登录表只在重新输入密码时写一行。保持登录之后，前端仍会带上用户 id，最近页面按人存在 "
        "服务器 recent-pages 目录。这份记录每个页面只留最后一次访问（最多 80 条），"
        "能确认谁在用、最后看什么，不能还原这两周的每次点击。nginx 日志本身没有用户名。",
        size=10, color=g.MUTED, space_after=12,
    )

    g.heading(doc, "三、流量什么时候发生", 1)
    g.para(
        doc,
        f"两个周六都几乎空窗：{g.date_label('2026-09-12')} {g.fmt_int(int(daily.loc[daily['date']=='2026-09-12','all'].iloc[0]))} 次，"
        f"{g.date_label('2026-09-19')} {g.fmt_int(int(daily.loc[daily['date']=='2026-09-19','all'].iloc[0]))} 次。"
        f"9 月 13 日周日同样很轻；9 月 20 日周日晚上 cshen 仍在用，产品请求回到 "
        f"{g.fmt_int(int(daily.loc[daily['date']=='2026-09-20','product'].iloc[0]))}。"
        f"工作日里最重的是 {g.date_label(str(busiest['date']))}，{g.fmt_int(busiest['all'])} 次、传输 "
        f"{float(daily.loc[daily['date']==busiest['date'],'gb'].iloc[0]):.2f} GB；当天页面次数并没有同步最高，"
        f"API 有 {g.fmt_int(int(busiest['api']))} 次，更像行情或数据接口被长时间挂着。"
        f"周四统计到 {last_ts.strftime('%H:%M')} 已有 {g.fmt_int(int(daily.loc[daily['date']=='2026-09-24','all'].iloc[0]))} 次，和完整工作日同一量级。",
    )
    g.add_table(
        doc,
        ["日期", "全部", "产品", "页面", "API", "心跳", "扫描", "IP"],
        [
            [
                g.date_label(row["date"]),
                g.fmt_int(row["all"]),
                g.fmt_int(row["product"]),
                g.fmt_int(row["page"]),
                g.fmt_int(row["api"]),
                g.fmt_int(row["heartbeat"]),
                g.fmt_int(row["probe"]),
                g.fmt_int(row["unique_ips"]),
            ]
            for _, row in daily.iterrows()
        ],
        col_widths=[2.6, 2.0, 2.0, 1.8, 1.8, 1.8, 1.8, 1.6],
    )
    g.para(doc, "", space_after=6)
    g.add_picture(doc, charts["daily_kind"], 6.4)
    g.caption(doc, f"图 1. 按日请求量，按类型堆叠。9 月 24 日只统计到 {last_ts.strftime('%H:%M')}。")
    g.para(
        doc,
        f"按钟点，产品请求最高的一小时是 {g.date_label(str(peak['date']))} {int(peak['hour']):02d} 时"
        f"（{g.fmt_int(peak['product'])} 次）。全周合计最密的是 {top_h_txt}。"
        f"12 时回落到 {g.fmt_int(hour_sum.get(12, 0))}。0–6 时合计只有 {g.fmt_int(hour_sum.loc[0:6].sum())}，没有真人办公。"
        f"21–22 时仍有第二波（{g.fmt_int(hour_sum.get(21, 0))} 与 {g.fmt_int(hour_sum.get(22, 0))}），对应晚间继续开着看板和行情页。",
    )
    g.add_picture(doc, charts["hourly_product"], 6.4)
    g.caption(doc, "图 2. 产品请求按钟点合计。红色为该小时 ≥ 15,000。")
    g.add_picture(doc, charts["heatmap"], 6.4)
    g.caption(doc, "图 3. 产品请求热力图。周六基本空白；周日晚上和每个工作日 9–11 点、13–16 点是深色。")

    g.heading(doc, "四、站点在被用来做什么", 1)
    g.para(
        doc,
        "路径要分层看。轮询（心跳、CTP live、实时行情、跟踪基金池、auth/me）会占掉大部分次数。"
        "办公室还有一条 MCP 数据接口，一周一万次出头，是程序在拉数据，不是有人在点页面。"
        "扣掉这些之后，私募产品是主工作面，MOM / 单账户风控是第二工作面，投资笔记在少数 IP 上很集中。",
    )
    g.add_picture(doc, charts["features"], 6.4)
    g.caption(doc, "图 4. 高频路径分组。金色偏轮询，紫色是侧栏预取，深蓝是页面。")
    g.add_table(
        doc,
        ["路径分组", "命中", "类型"],
        [
            [
                name,
                g.fmt_int(hits),
                {"polling": "轮询", "api": "API", "page": "页面", "prefetch": "预取",
                 "admin": "管理", "noise": "噪声", "static": "静态", "other": "其他"}.get(k, k),
            ]
            for name, hits, k in feats[:16]
        ],
        col_widths=[7.2, 3.2, 6.6],
    )
    g.para(doc, "", space_after=10)

    g.heading(doc, "五、各用户使用习惯", 1)
    g.para(
        doc,
        "人名以两处为准：登录表说明谁重新输入了密码；最近页面说明谁在保持登录的状态下真正打开过功能。"
        "下面按人写的使用面来自最近页面，不再把办公室 NAT 上的请求硬拆给某一个人。",
    )
    g.add_picture(doc, charts["logins"], 6.4)
    g.caption(doc, "图 5. 按人统计的登录次数。cshen 几乎每天都有，含晚间和本机；其余三人只在工作日出现。")

    by_who = (
        in_win.groupby("who")
        .agg(events=("ts", "size"), ok=("success", "sum"), first=("ts", "min"), last=("ts", "max"), days=("date", "nunique"))
        .sort_values("events", ascending=False)
    )
    who_rows = []
    for name, r in by_who.iterrows():
        grp = in_win.loc[in_win["who"] == name]
        devices = "、".join(sorted(set(grp["device"])))
        nets = "、".join(sorted(set(grp["network"])))
        who_rows.append([
            name, int(r.events), int(r.days), devices, nets,
            r["first"].strftime("%m-%d %H:%M"), r["last"].strftime("%m-%d %H:%M"),
        ])
    g.add_table(
        doc,
        ["账号", "登录", "天数", "终端", "网络", "首次", "末次"],
        who_rows,
        col_widths=[2.4, 1.4, 1.4, 3.2, 3.6, 2.5, 2.5],
    )
    g.para(doc, "", space_after=8)

    days = list(daily["date"])
    g.para(doc, "", space_after=6)
    g.para(doc, "重新登录出现在哪些天：", size=11, bold=True, color=g.NAVY, space_after=4)
    login_day_rows = []
    for name in by_who.index:
        grp = in_win.loc[in_win["who"] == name]
        days_txt = "、".join(g.date_label(d0) for d0 in days if d0 in set(grp["date"]))
        login_day_rows.append([name, days_txt])
    g.add_table(doc, ["账号", "重新登录的日期"], login_day_rows, col_widths=[2.8, 14.2])
    g.para(doc, "", space_after=8)

    g.para(doc, "这两周确有使用（含保持登录）", size=12, bold=True, color=g.NAVY, space_after=4)
    g.add_table(
        doc,
        ["账号", "重新登录", "最近页面落在", "主要在用"],
        [
            ["cshen", "除 9/12 外每天", "9/22–9/24（更早的被后来的访问盖掉）", "尽调表、跟踪产品、私募、策略标签、MOM"],
            ["benc", "无", "9/23–9/24", "跟踪产品、FOF 底层、在管产品、尽调表、MOM"],
            ["chenpeifeng", "无", "9/17–9/18、9/20–9/24", "在管产品、FOF 底层、跟踪、尽调、估值表"],
            ["caojie", "9/16–9/17、9/21–9/22", "9/18、9/21–9/24", "尽调表、投资笔记、策略标签、新建组合"],
            ["sunjie", "11 个工作日", "9/16–9/17、9/21、9/23–9/24", "MOM、尽调表、策略标签、私募、投资笔记"],
            ["sunzhou", "仅 9/17", "9/20、9/22、9/24", "MOM 每日风控、盘手复盘、单账户风控"],
            ["luoshuang", "9/15–9/16、9/21、9/23", "9/23", "期货、宏观、股票、MOM 风控"],
            ["G.Wave", "无", "9/15、9/17、9/18", "尽调表、投资笔记、私募、MOM 每日风控"],
            ["hcx", "无", "9/11、9/24", "私募、宏观、日历、AI 知识库，次数很少"],
        ],
        col_widths=[2.6, 3.8, 5.0, 5.6],
    )
    g.para(doc, "", space_after=8)

    frequent = homepage_frequent_paths()
    g.para(doc, "首页快速访问：各账户高频路径", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "首页「快速访问」读的是服务器 /root/market_dashboard_storage/recent-pages/{用户id}.json。"
        "排序和首页一样：次数 × 时间衰减（半衰期 14 天），只保留最后访问落在这两周的路径，每人列前 6 条。"
        "次数是累计打开次数，不是这 14 天的精确点击。",
        size=10, color=g.MUTED, space_after=6,
    )
    if frequent:
        freq_rows = []
        for name, hits in frequent:
            text = "；".join(f"{title} {count} 次（{when}）" for title, count, when in hits)
            freq_rows.append([name, text])
        g.add_table(doc, ["账号", "高频路径（首页同一套排序）"], freq_rows, col_widths=[2.6, 14.4])
        g.para(doc, "", space_after=8)

    g.para(doc, "cshen（管理员）", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "除 9 月 12 日周六外，每天都重新登录，终端是 Windows Edge。白天办公室，傍晚转到晚间网络，并多次在服务器本机登录。"
        "最近页面里跟踪产品、尽调表、投资笔记的累计打开次数都在一百次以上，周四晚上还在看具体产品（贞元虎踞一号等）。"
        "办公室上的 MCP 数据接口一周一万次出头，和他在线时段重合，更像他自己的拉数程序。",
    )
    g.para(doc, "benc（管理员，本期没有重新登录）", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "登录表里这两周是空的，但最近页面在 9 月 23–24 日持续更新到 24 日 18:16。"
        "他在看跟踪产品（累计 173 次）、尽调表、投资笔记，同时 MOM 分析和单账户每日风控也在当天反复打开，"
        "并点进多只私募详情。这是保持登录后的正常使用，不是偶发打开首页。",
    )
    g.para(doc, "chenpeifeng（本期没有重新登录）", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "最近页面从 9 月 17 日到 24 日都有最后访问（周六除外），说明会话一直留着。"
        "工作面很集中：FOF 底层、在管产品、跟踪产品、尽调表，以及金舆基石、金舆锡泰等产品的估值表。"
        "9 月 23 日下午还在看交睿、众量、澜熙、昭明、铨景等产品详情。",
    )
    g.para(doc, "sunjie", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "重新登录 11 次，分布在 9 月 11、14–18、21–24 日，都是工作日、办公室、夸克浏览器。周末没有登录。"
        "他主要在 MOM 每日风控、MOM 分析、数据导入，以及运维侧的跟踪产品、策略标签、要素提取、FOF 底层。"
        "也会打开投资笔记和尽调表，但次数低于 cshen / benc / caojie。",
    )
    g.para(doc, "sunzhou", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "9 月 17 日登录过一次。之后没有再输入密码，最近页面显示 9 月 20 日 23:07 看过业绩报酬测算，"
        "22 日 18:03 看盘手历史交易复盘和单账户风控，24 日 17:26 仍在 MOM 每日风控和 MOM 分析。"
        "使用面几乎全在 MOM，不进私募投研页。",
    )
    g.para(doc, "caojie（9 月 16 日新开）", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "重新登录在 9 月 16、17、21、22 日。17 日 18:27 有一次密码错误，随后仍用 Edge 登录成功。终端还换过 HeyTap 桌面和 Android 手机。"
        "最近页面从 18 日到 24 日都有，24 日晚上仍在尽调表、投资笔记、策略标签和新建组合，"
        "并连续打开管理人页和基金详情。投资笔记是他的主工作面。",
    )
    g.para(doc, "luoshuang", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "15、16、21、23 日重新登录，Chrome。最近页面只留在 23 日 12:41–12:44 这一小段："
        "期货、宏观、股票、期权、实时行情、MOM 风控各看了几眼，没有停在某一个产品上。属于午后短时浏览。",
    )
    g.para(doc, "G.Wave 与 hcx", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "两人都没有这两周的登录记录。G.Wave 的最近页面落在 9 月 15、17、18 日，主路径是尽调表、投资笔记、私募列表和 MOM 每日风控，15 日还打开过 AI 知识库。"
        "hcx 只在 9 月 11 日看过基金经理、9 月 24 日 16:47 看了私募、宏观、事件日历和 AI 知识库，次数都很少。",
    )
    g.para(doc, "这两周没有使用痕迹的账号", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "chy、liuyamin、musheng、yuki、zhougang、zzh 这两周既没有新登录，最近页面的最后访问也都早于 9 月 11 日。",
        space_after=8,
    )

    g.heading(doc, "六、对不上人名的流量", 1)
    mystery = [
        ("124.79.17.112", "本期请求量第二，登录表从未出现这个 IP。路径几乎全是 CTP、实时行情、跟踪基金，外加投资笔记和私募页。像一个一直开着的会话，IP 在登录之后变过，或登录早于我们能对上的记录。"),
        ("39.144.244.30 / 39.144.40.193", "没有本期登录。cshen 在 8 月底到 9 月 7 日从 39.144 网段登录过，本期这两条仍是行情轮询。有可能是他手机上的旧会话，运营商地址变了。这只是线索，不是确认。"),
        ("117.136.8.136", "同样是行情轮询为主。cshen 9 月 16 日从 117.136.119.240 登录过，网段接近但不是同一地址，不能直接算成他。"),
        ("61.170.144.214", "与 chenpeifeng 在 8 月 25 日的登录 IP 完全相同。本期约三千次，页面分布像在浏览看板（首页、私募、工具、MOM），不是纯轮询。若这条家庭宽带地址没变，更像会话没过期后的继续使用。"),
    ]
    for title, text in mystery:
        g.para(doc, title, size=11, bold=True, color=g.NAVY, space_after=2)
        g.para(doc, text, space_after=6)
    g.para(
        doc,
        f"115.175.161.* 一段有多台地址、页面和 API 都很少，更像扫描或空探测，不计入用户习惯。"
        f"扫描类请求全周 {g.fmt_int(kind['probe'])} 次，相对产品流量不大。",
        space_after=12,
    )

    g.heading(doc, "七、可用性", 1)
    g.para(
        doc,
        f"2xx 占 {g.fmt_pct(ok_2xx, n)}。404 共 {g.fmt_int(n_404)}，其中 /_vercel/insights/script.js {g.fmt_int(vercel_404)} 次，"
        f"是自建站仍在请求 Vercel 统计脚本。499（客户端断开）{g.fmt_int(n_499)}，502 {g.fmt_int(n_502)}，500 {g.fmt_int(n_500)}。"
        f"这三项相对 {g.fmt_int(n)} 次请求不高，但 502 说明 nginx 到 Next 有过短暂上游失败。",
    )
    g.add_picture(doc, charts["status"], 6.3)
    g.caption(doc, "图 6. HTTP 状态码。绿色为 2xx/3xx，金色为 4xx，红色为 5xx。")
    g.add_picture(doc, charts["networks"], 6.3)
    g.caption(doc, "图 7. 网段。办公室出口 A 是共享 NAT；「其他」里混着手机运营商和个人宽带。")
    g.add_picture(doc, charts["devices"], 6.3)
    g.caption(doc, "图 8. 终端。手机流量占比高，主要来自行情轮询，不都是新的登录。")

    g.heading(doc, "八、结论", 1)
    g.para(doc, "1）站点是工作日工具。两个周六和 9 月 13 日周日基本无人；9 月 20 日周日只有晚间少量使用。忙时在 9–11 点、13–16 点，21–22 点还有一波晚间会话。", space_after=3)
    g.para(doc, "2）重新登录的有 cshen、sunjie、luoshuang、caojie、sunzhou。保持登录、没有新密码记录但仍在用的是 benc、chenpeifeng、G.Wave、hcx。chy、liuyamin、musheng、yuki、zhougang、zzh 没有痕迹。", space_after=3)
    g.para(doc, "3）请求次数不能直接当成人气。预取、心跳、行情 live、跟踪基金池和办公室 MCP 把数字放大了。看功能应看私募产品、MOM/风控和投资笔记。", space_after=3)
    g.para(doc, "4）个人习惯以最近页面为准，登录表只说明谁重新输入了密码。最近页面每个功能只留最后一次，早几天的重复访问会被盖掉。", space_after=3)
    g.para(
        doc,
        "密级：内部。日志含客户端 IP 与浏览器信息，请勿转发到团队以外。",
        size=8, color=g.MUTED, space_after=4,
    )

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "网站流量与使用习惯_20260911-20260924.docx"
    doc.save(str(path))
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
