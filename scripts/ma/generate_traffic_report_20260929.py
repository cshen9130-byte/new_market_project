# -*- coding: utf-8 -*-
"""Chinese Word report: site traffic 2026-09-29 through 2026-10-12."""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_cn_traffic_report as g

RAW = ROOT / "reports" / "_week_traffic_raw_20260929"
PREV = ROOT / "reports" / "_week_traffic_raw_20260911" / "daily.csv"
RECENT = ROOT / "reports" / "_recent_pages_20261012"
g.RAW = RAW
g.CHART_DIR = ROOT / "reports" / "_week_traffic_charts_20260929"
OUT = ROOT / "reports"

TZ = timezone(timedelta(hours=8))
WIN_START = datetime(2026, 9, 29, tzinfo=TZ)
WIN_END = datetime(2026, 10, 13, tzinfo=TZ)

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
    "de62s4gkh": "jiang",
    "u2meqkdwj": "developer",
}

# Daily MCP counts from the nginx files for this window (fund-data/mcp).
MCP_BY_DAY = {
    "2026-09-29": (6004, 0),
    "2026-09-30": (5987, 0),
    "2026-10-01": (0, 0),
    "2026-10-02": (120, 0),
    "2026-10-03": (101, 0),
    "2026-10-04": (57, 0),
    "2026-10-05": (0, 0),
    "2026-10-06": (0, 0),
    "2026-10-07": (81, 0),
    "2026-10-08": (3338, 3197),
    "2026-10-09": (336, 336),
    "2026-10-10": (9121, 9121),
    "2026-10-11": (11330, 11330),
    "2026-10-12": (23219, 22311),
}
ERR_502 = {
    "2026-09-30": 286,
    "2026-10-08": 52,
    "2026-10-12": 88,
}
ERR_499 = {
    "2026-10-07": 420,
    "2026-10-08": 191,
    "2026-10-12": 211,
}


def day_hits(daily: pd.DataFrame, day: str, col: str = "all") -> int:
    hit = daily.loc[daily["date"] == day, col]
    return int(hit.iloc[0]) if len(hit) else 0


def homepage_frequent_paths() -> list[tuple[str, list[tuple[str, int, str]]]]:
    if not RECENT.is_dir():
        return []
    start = WIN_START.timestamp() * 1000
    end = WIN_END.timestamp() * 1000
    now = datetime(2026, 10, 13, 0, 4, tzinfo=TZ).timestamp() * 1000
    ranked = []
    for path in sorted(RECENT.glob("*.json")):
        if path.name.endswith(".bak"):
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
            when = datetime.fromtimestamp(ts / 1000, TZ).strftime("%m-%d %H:%M")
            hits.append((score, title, int(count), when))
        hits.sort(reverse=True)
        if not hits:
            continue
        name = ID_NAME.get(path.stem, path.stem)
        ranked.append((name, [(t, c, w) for _, t, c, w in hits[:6]]))
    ranked.sort(key=lambda item: item[1][0][1] if item[1] else 0, reverse=True)
    return ranked


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
    status = d["status"]
    paths = d["paths"]
    pages = d["pages"]

    n = int(s["hits_in_week"])
    n_prod = int(s["product_hits"])
    gb = s["bytes_in_week"] / (1024 ** 3)
    kind = s["kind"]
    first_ts = datetime.fromisoformat(s["first_ts"])
    last_ts = datetime.fromisoformat(s["last_ts"])
    window_cn = (
        f"{first_ts.strftime('%Y年%m月%d日 %H:%M')} – {last_ts.strftime('%Y年%m月%d日 %H:%M')}（北京时间）"
    )

    prev = pd.read_csv(PREV)
    prev_n = int(prev["all"].sum())
    prev_prod = int(prev["product"].sum())
    prev_pages = int(prev["page"].sum())
    prev_peak = prev.loc[prev["all"].idxmax()]
    prev_page_peak = prev.loc[prev["page"].idxmax()]

    login = login.loc[~login["who_norm"].eq(g.SELFTEST.lower())].copy()
    in_win = login.loc[login["date"].isin(set(daily["date"]))].copy()
    login_ok = int(in_win["success"].sum())
    login_fail = int((~in_win["success"]).sum())
    people = sorted(in_win["who"].unique())

    holiday = [f"2026-10-0{i}" for i in range(1, 8)]
    office_days = ["2026-09-29", "2026-09-30", "2026-10-08", "2026-10-09", "2026-10-12"]
    hol = daily.loc[daily["date"].isin(holiday)]
    office = daily.loc[daily["date"].isin(office_days)]
    busiest = daily.loc[daily["all"].idxmax()]
    quietest = daily.loc[daily["all"].idxmin()]
    hour_sum = hourly.groupby("hour")["product"].sum()
    top_hours = hour_sum.sort_values(ascending=False).head(3)
    peak = hourly.loc[hourly["product"].idxmax()]
    feats = g.feature_rows(paths)

    mcp_total = int(paths.loc[paths["path"].astype(str).str.startswith("/ma/api/fund-data/mcp"), "hits"].sum())
    mcp_115 = sum(v[1] for v in MCP_BY_DAY.values())
    prefetch = [
        "/ma/dashboard/all-weather", "/ma/dashboard/futures-market", "/ma/dashboard/options-market",
        "/ma/dashboard/macro-market", "/ma/dashboard/ai-knowledge", "/ma/dashboard/ai-researcher",
        "/ma/dashboard/realtime-quotes", "/ma/dashboard/stock-market", "/ma/dashboard/tools",
        "/ma/dashboard/event-calendar",
    ]
    prefetch_hits = int(pages.loc[pages["path"].isin(prefetch), "hits"].sum())
    private_page = int(pages.loc[pages["path"].astype(str).str.startswith("/ma/dashboard/private-funds"), "hits"].sum())
    mom_page = int(pages.loc[pages["path"].astype(str).str.startswith("/ma/dashboard/mom-analysis"), "hits"].sum())

    ok_2xx = int(status.loc[status["status"].between(200, 299), "hits"].sum())
    n_404 = g.status_hits(status, 404)
    n_499 = g.status_hits(status, 499)
    n_502 = g.status_hits(status, 502)
    n_500 = g.status_hits(status, 500)
    n_304 = g.status_hits(status, 304)
    vercel_404 = int(paths.loc[paths["path"].astype(str).str.startswith("/_vercel/insights"), "hits"].sum())

    top_h_txt = "、".join(f"{int(h):02d} 时（{g.fmt_int(v)}）" for h, v in top_hours.items())
    sep29_gb = float(daily.loc[daily["date"] == "2026-09-29", "gb"].iloc[0])
    sep30_gb = float(daily.loc[daily["date"] == "2026-09-30", "gb"].iloc[0])
    oct12_gb = float(daily.loc[daily["date"] == "2026-10-12", "gb"].iloc[0])

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
        f"9 月 29 日（周二）至 10 月 12 日（周一）共 14 个完整自然日，"
        f"HTTP 请求 {g.fmt_int(n)} 次，传输 {gb:.2f} GB，来自 {g.fmt_int(s['unique_ips'])} 个 IP。"
        f"产品请求（页面、业务 API、管理、登录）{g.fmt_int(n_prod)} 次，占 {g.fmt_pct(n_prod, n)}。"
        f"上一期同样 14 天（9 月 11–24 日）是 {g.fmt_int(prev_n)} 次请求、产品请求 {g.fmt_int(prev_prod)}。"
        f"这一期总次数更低，因为国庆把 10 月 1–6 日几乎清空；真正上班的几天更重，"
        f"10 月 12 日一天就有 {g.fmt_int(busiest['all'])} 次，高于上一期最忙的 "
        f"{g.date_label(str(prev_peak['date']))}（{g.fmt_int(prev_peak['all'])}）。",
    )
    g.para(
        doc,
        f"请求量要拆开看。假期前两天（9 月 29–30 日）办公室还在正常用，这两天传输了 "
        f"{sep29_gb:.2f} GB 和 {sep30_gb:.2f} GB，占本期 {gb:.2f} GB 的一半以上。"
        f"10 月 8 日起，115.175.161.* 上出现一批 Node.js 客户端（User-Agent 为 undici），"
        f"只打 /ma/api/fund-data/mcp，几乎没有打开页面。这条接口本期 {g.fmt_int(mcp_total)} 次，"
        f"其中 {g.fmt_int(mcp_115)} 次来自该网段，集中在 10 月 8 日之后。"
        f"10 月 10–11 日周末看起来还有一万多次请求，页面分别只有 "
        f"{g.fmt_int(day_hits(daily, '2026-10-10', 'page'))} 和 {g.fmt_int(day_hits(daily, '2026-10-11', 'page'))} 次，"
        f"是这批程序在拉数据。",
    )
    g.para(
        doc,
        f"登录历史本期 {len(in_win)} 次，成功 {login_ok}、失败 {login_fail}。"
        f"重新输入密码的是 {'、'.join(people)}。"
        f"保持登录、没有新密码记录但仍在打开页面的是 benc、caojie、chy、hcx、sunzhou。"
        f"本期新开账号两个：jiang（9 月 29 日，之后持续在看私募）和 developer（同一天在办公室打开过两只产品的估值表，之后没有再出现）。"
        f"G.Wave、musheng、yuki、liuyamin、zhougang、zzh 这两周没有登录，也没有落在窗口内的最近页面。",
    )
    g.para(
        doc,
        f"有意图的页面仍是私募产品（{g.fmt_int(private_page)} 次）和 MOM 分析（{g.fmt_int(mom_page)} 次）。"
        f"侧栏行情、AI、工具、日历合计 {g.fmt_int(prefetch_hits)} 次，各路由条数接近，是 Next.js 预取。"
        f"钟点上最密的是 {top_h_txt}。单小时最高是 {g.date_label(str(peak['date']))} {int(peak['hour']):02d} 时，"
        f"产品请求 {g.fmt_int(peak['product'])}，其中页面 {g.fmt_int(peak['page'])}，是人在浏览，不单是接口。"
        f"2xx 占 {g.fmt_pct(ok_2xx, n)}。502 共 {g.fmt_int(n_502)}，9 月 30 日占 {ERR_502['2026-09-30']} 次。",
        space_after=12,
    )

    g.heading(doc, "二、数据口径", 1)
    g.add_table(
        doc,
        ["项目", "取值"],
        [
            ["HTTP 来源", "服务器 /var/log/nginx/access.log 及轮转文件（access.log.1 至 .14.gz）"],
            ["登录来源", "public.auth_login_history（每次重新输入密码写一行）"],
            ["最近页面", "服务器 recent-pages/{用户id}.json，10 月 13 日 00:05 前的快照"],
            ["窗口", f"{first_ts.strftime('%Y-%m-%d %H:%M')} 至 {last_ts.strftime('%Y-%m-%d %H:%M')}（14 个完整日）"],
            ["全部 / 产品请求", f"{g.fmt_int(n)} / {g.fmt_int(n_prod)}"],
            ["页面 / API / 心跳 / 静态 / 扫描",
             f"{g.fmt_int(kind['page'])} / {g.fmt_int(kind['api'])} / {g.fmt_int(kind['heartbeat'])} / "
             f"{g.fmt_int(kind['static'])} / {g.fmt_int(kind['probe'])}"],
            ["登录（成功 / 失败）", f"{len(in_win)}（{login_ok} / {login_fail}）"],
            ["注册账号 / 本期重新登录", f"{len(users)} / {len(people)}"],
            ["对照期", f"9 月 11–24 日，{g.fmt_int(prev_n)} 次请求，页面 {g.fmt_int(prev_pages)}"],
        ],
        col_widths=[5.2, 11.8],
    )
    g.para(doc, "", space_after=6)
    g.para(
        doc,
        "一次 HTTP 请求不是一个人，也不是一次会话。心跳、行情 live、跟踪基金池、路由预取，以及 MCP 数据接口，都会把次数抬高。"
        "登录表只在重新输入密码时写一行。保持登录之后，前端仍会带上用户 id，最近页面按人存在服务器上。"
        "这份记录每个页面只留最后一次访问（最多 80 条），累计次数不是这 14 天的精确点击。"
        "nginx 日志本身没有用户名。115.175.161.* 的客户端 User-Agent 是 undici（Node.js fetch），"
        "分类器把它记在「其他」终端里，不会进浏览器统计。",
        size=10, color=g.MUTED, space_after=12,
    )

    g.heading(doc, "三、流量什么时候发生", 1)
    g.para(
        doc,
        f"本期日历被国庆切开。9 月 29 日 {g.fmt_int(day_hits(daily, '2026-09-29'))} 次、"
        f"9 月 30 日 {g.fmt_int(day_hits(daily, '2026-09-30'))} 次，是假期前的两个工作日。"
        f"10 月 1–6 日每天 {g.fmt_int(int(hol.loc[hol['date'] < '2026-10-07', 'all'].min()))}–"
        f"{g.fmt_int(int(hol.loc[hol['date'] < '2026-10-07', 'all'].max()))} 次，和扫描、残留心跳一个量级。"
        f"10 月 7 日回到 {g.fmt_int(day_hits(daily, '2026-10-07'))} 次，页面 {g.fmt_int(day_hits(daily, '2026-10-07', 'page'))}，"
        f"当天登录记录只有 cshen 13:07 从华为手机进来一次。"
        f"10 月 8 日恢复到 {g.fmt_int(day_hits(daily, '2026-10-08'))} 次，10 月 9 日 {g.fmt_int(day_hits(daily, '2026-10-09'))} 次。"
        f"10 月 12 日周一是本期也是近一个月最重的一天：{g.fmt_int(busiest['all'])} 次，页面 {g.fmt_int(busiest['page'])}，"
        f"传输 {oct12_gb:.2f} GB。上一期页面最多的一天是 {g.date_label(str(prev_page_peak['date']))}，"
        f"页面 {g.fmt_int(prev_page_peak['page'])}。五个有人上班的日子（9/29、9/30、10/8、10/9、10/12）"
        f"日均全部请求约 {g.fmt_int(office['all'].mean())}。最安静的是 {g.date_label(str(quietest['date']))}"
        f"（{g.fmt_int(quietest['all'])}）。",
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
    g.caption(doc, "图 1. 按日请求量，按类型堆叠。10 月 1–6 日接近空窗；10 月 12 日是整段最高。")
    g.para(
        doc,
        f"按钟点，全期产品请求最高的三个小时是 {top_h_txt}。"
        f"12 时回落到 {g.fmt_int(hour_sum.get(12, 0))}。0–6 时合计 {g.fmt_int(hour_sum.loc[0:6].sum())}，相对白天仍然轻。"
        f"20 时合计 {g.fmt_int(hour_sum.get(20, 0))}，和上午 10 时接近，晚间会话是常态。"
        f"单小时峰值在 {g.date_label(str(peak['date']))} {int(peak['hour']):02d} 时："
        f"产品请求 {g.fmt_int(peak['product'])}，页面 {g.fmt_int(peak['page'])}，API {g.fmt_int(peak['api'])}。"
        f"这一小时页面多于 API，对应周一晚上有人在连续打开页面。",
    )
    g.add_picture(doc, charts["hourly_product"], 6.4)
    g.caption(doc, "图 2. 产品请求按钟点合计（14 天加总）。红色为该小时合计 ≥ 15,000。")
    g.add_picture(doc, charts["heatmap"], 6.4)
    g.caption(doc, "图 3. 产品请求热力图。10 月 1–6 日整行很浅；深色在 9 月 29–30 日和 10 月 8、9、12 日的白天到晚间。")

    g.heading(doc, "四、MCP 数据接口拉高了后半段", 1)
    g.para(
        doc,
        f"/ma/api/fund-data/mcp 本期 {g.fmt_int(mcp_total)} 次，是单条路径的最大头，超过跟踪基金池（22,946）和心跳（19,693）。"
        f"假期前它主要来自办公室出口 116.237.193.158 和 124.79.17.112："
        f"9 月 29 日 6,004 次（124.79.17.112 占 3,430，办公室占 2,353），9 月 30 日 5,987 次（办公室占 5,688）。"
        f"10 月 1–7 日合计只有几百次。"
        f"10 月 8 日开始，115.175.161.* 大约十个地址用 Node.js undici 调用同一接口，返回几乎全是 200。"
        f"这些地址的页面次数是 0。10 月 10 日、11 日的 MCP 全部来自该网段（9,121 和 11,330）。"
        f"10 月 12 日 MCP 23,219 次，其中 22,311 次仍是该网段，其余约九百次才是别人。"
        f"所以 10 月 12 日 API 有 {g.fmt_int(busiest['api'])} 次，扣掉 MCP 之后，其余 API 和 9 月 29 日是同一量级；"
        f"当天真正上去的是页面（{g.fmt_int(busiest['page'])}）。",
    )
    g.add_table(
        doc,
        ["日期", "MCP 次数", "其中 115.175.161.*"],
        [
            [g.date_label(day), g.fmt_int(mcp), g.fmt_int(block)]
            for day, (mcp, block) in MCP_BY_DAY.items()
        ],
        col_widths=[4.0, 4.0, 6.0],
    )
    g.para(doc, "", space_after=8)
    g.para(
        doc,
        "115.175.161.* 在上一期报告里更像空探测。这一期它们只打 MCP，而且成功返回，应当看成一个新的数据拉取客户端，"
        "不要把它的周末请求算成有人在上班。办公室 NAT 上的 MCP 在 9 月 30 日最密，和 cshen 在线时段重合，仍像站内拉数程序。",
        space_after=12,
    )

    g.heading(doc, "五、站点在被用来做什么", 1)
    g.para(
        doc,
        "路径要分层看。轮询（心跳、CTP live、实时行情、跟踪基金池、auth/me）和 MCP 占掉大部分次数。"
        "扣掉这些之后，私募产品是主工作面，MOM / 单账户风控是第二工作面。"
        "侧栏约十个行情、AI、工具、日历路由的命中挤在 5,500–6,100 这一档，是进站时的预取，不是十个同样受欢迎的功能。",
    )
    g.add_picture(doc, charts["features"], 6.4)
    g.caption(doc, "图 4. 高频路径分组。金色偏轮询，紫色是侧栏预取，深蓝是页面，青色是业务 API。")
    kind_cn = {
        "polling": "轮询", "api": "API", "page": "页面", "prefetch": "预取",
        "admin": "管理", "noise": "噪声", "static": "静态", "other": "其他",
    }
    g.add_table(
        doc,
        ["路径分组", "命中", "类型"],
        [[name, g.fmt_int(hits), kind_cn.get(k, k)] for name, hits, k in feats[:16]],
        col_widths=[7.2, 3.2, 6.6],
    )
    g.para(doc, "", space_after=10)

    g.heading(doc, "六、各用户使用习惯", 1)
    g.para(
        doc,
        "人名以两处为准：登录表说明谁重新输入了密码；最近页面说明谁在保持登录的状态下打开过功能。"
        "办公室出口是共享 NAT，不能把 116.237.193.158 上的请求拆给某一个人。下面按人写的使用面来自最近页面，"
        "IP 只在登录地址能够对上时才写。",
    )
    g.add_picture(doc, charts["logins"], 6.4)
    g.caption(doc, "图 5. 按人统计的重新登录次数。cshen 占 31 次；假期 10 月 1–6 日没有任何人登录。")

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

    g.para(doc, "重新登录出现在哪些天：", size=11, bold=True, color=g.NAVY, space_after=4)
    days = list(daily["date"])
    login_day_rows = []
    for name in by_who.index:
        grp = in_win.loc[in_win["who"] == name]
        days_txt = "、".join(g.date_label(d0) for d0 in days if d0 in set(grp["date"]))
        login_day_rows.append([name, days_txt or "—"])
    g.add_table(doc, ["账号", "重新登录的日期"], login_day_rows, col_widths=[2.8, 14.2])
    g.para(doc, "", space_after=8)

    g.para(doc, "这两周确有使用（含保持登录）", size=12, bold=True, color=g.NAVY, space_after=4)
    g.add_table(
        doc,
        ["账号", "重新登录", "最近页面落在", "主要在用"],
        [
            ["cshen", "6 天，共 31 次", "10/12 全天至 23:28", "尽调表、跟踪产品、策略标签、团队数据、在管产品"],
            ["benc", "无", "10/12 23:50–23:59", "FOF 底层、在管产品、单只基金详情"],
            ["chenpeifeng", "仅 10/8 21:45", "10/12 11:26–13:04", "在管、跟踪、估值表（金舆程安、稳健增长二号）"],
            ["caojie", "无", "10/12 20:42–20:47", "尽调表，以及一串基金详情"],
            ["jiang", "9/29、10/11", "10/12 13:50–14:32", "跟踪产品、跟踪管理人、基金搜索、尽调表"],
            ["sunjie", "9/29、9/30、10/8、10/9、10/12", "10/8–10/9、10/12", "MOM、数据导入、策略标签、要素提取"],
            ["chy", "无", "10/12 11:51–12:31", "在管产品、尽调表、我的报告，时间很短"],
            ["sunzhou", "无", "10/9 23:09–23:11", "MOM 每日风控、MOM 分析、单账户风控"],
            ["luoshuang", "仅 10/12 09:36", "10/12 09:36–09:41", "期货、MOM 分析、MOM 每日风控"],
            ["hcx", "无", "10/12 09:16–09:18", "私募列表、管理人、基金搜索，几分钟"],
            ["developer", "仅 9/29 16:23", "9/29 16:23–16:26", "两只产品的估值表，之后没有再出现"],
        ],
        col_widths=[2.6, 3.8, 4.6, 6.0],
    )
    g.para(doc, "", space_after=8)

    frequent = homepage_frequent_paths()
    g.para(doc, "首页快速访问：各账户高频路径", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "排序和首页一样：次数 × 时间衰减（半衰期 14 天），只保留最后访问落在 9 月 29 日至 10 月 12 日的路径，每人列前 6 条。"
        "次数是这条路径的累计打开次数，早于本期的历史次数也算在里面。",
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
        "31 次重新登录，分布在 9 月 29–30 日和 10 月 7–9、11–12 日。终端主要是 Windows Edge。"
        "白天在办公室出口，多次经服务器本机登录，10 月 8 日 20:05 起和 10 月 11–12 日晚转到晚间网络 B。"
        "10 月 7 日 13:07 有一次华为手机登录，是假期尾声唯一的登录。"
        "最近页面 80 条全部落在本期：尽调表格累计 217 次、跟踪产品 190 次、私募基金 159 次、策略标签 129 次、"
        "团队数据 108 次、在管产品 93 次。10 月 12 日 23:25 仍在看特夫郁金香全量化，23:28 还停在设置页。"
        "办公室上的 MCP 在 9 月 30 日有 5,688 次，和他在线时段重合。",
    )
    g.para(doc, "benc（管理员，本期没有重新登录）", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "登录表是空的，最近页面在 10 月 12 日 23:50–23:59 仍在更新。"
        "高频路径是 FOF 底层（累计 172 次）、在管产品（160 次）和金舆稳健增长 1 号 FOF（45 次）。"
        "当天深夜连续打开正源信毅月月开贰号、藤创 1 号、笃熙禀泰渊流、锡和鑫安商品套利等单只产品。"
        "这是保持登录后的连续使用。nginx 里对不上单独的姓名，因为他和办公室其他人共用出口地址。",
    )
    g.para(doc, "chenpeifeng", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "10 月 8 日 21:45 从 61.170.144.214 用 Edge 登录过一次，这是上一期就已经对上他的家庭宽带地址。"
        "该地址本期 8,795 次请求，路径是看板各页和私募，不是纯轮询。"
        "最近页面在 10 月 12 日中午集中在在管产品（累计 108 次）、跟踪产品（90 次），"
        "以及金舆程安一号、金舆稳健增长二号的估值表，并点过睿富 2 号、汇艾稳健 6 号、辰元、藤创藤达等详情。",
    )
    g.para(doc, "jiang（9 月 29 日新开）", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "账号 9 月 29 日 12:57 创建，13:48 从 218.82.15.181 用 Edge 登录。该地址本期 11,405 次，"
        "跟踪基金池 1,480 次，同时有私募页和侧栏预取，是一个开着的工作会话。"
        "10 月 11 日 15:19 又从鸿蒙手机（61.171.228.120）登录，该地址只有 602 次，像短时查看。"
        "最近页面在 10 月 12 日下午很满：跟踪产品累计 42 次、跟踪管理人 22 次、尽调表格 20 次、基金搜索 11 次，"
        "并连续打开广联宏、荣熙、笃熙、大风、合绎、芬德等产品和对应管理人。工作面在私募投研，不在 MOM。",
    )
    g.para(doc, "sunjie", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "重新登录 5 次：9 月 29 日、9 月 30 日、10 月 8 日、10 月 9 日、10 月 12 日。四次在办公室用夸克，"
        "9 月 30 日 17:38 改从 223.167.169.1 用 Edge，该地址只有 239 次。"
        "最近页面的主路径是 MOM 分析（累计 49 次）、数据导入（26 次）、策略标签（28 次）、私募基金（31 次）和要素提取（15 次）。"
        "10 月 8 日下午还看过投资笔记、尽调表，以及金舆文曲星、金舆稳健增长二号。10 月 9 日停在 MOM 每日风控。",
    )
    g.para(doc, "caojie（本期没有重新登录）", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "没有新的密码记录。最近页面 80 条全部落在本期，10 月 12 日 20:42–20:47 仍在更新。"
        "尽调表格累计 70 次，当晚连续点开千衍六贞、在赢套利、汇艾稳健、银瓴运通、盛冠达、永泉奇点、杉阳云杉等详情，每只多为 1 次。"
        "223.167.205.51 本期 14,852 次，投资笔记 API 2,517 次，是上一期对到 caojie 的地址；"
        "这一期登录表没有再次出现该 IP，所以笔记流量仍只是沿用上次的对应关系。",
    )
    g.para(doc, "chy、luoshuang、sunzhou、hcx", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "chy 这一期没有重新登录。上一期他没有页面痕迹，这一期 10 月 12 日 11:51–12:31 有一段短会话："
        "在管产品、尽调表、金舆追风 1 号、荣熙共赢、我的报告、新建组合，次数都是个位数。"
        "luoshuang 只在 10 月 12 日 09:36 用 Chrome 从 116.234.86.252 登录，最近页面停在期货市场、MOM 分析和 MOM 每日风控，该地址总共 391 次。"
        "sunzhou 没有新登录，10 月 9 日 23:09–23:11 的最近页面是 MOM 每日风控（累计 27 次）、MOM 分析（22 次）和单账户每日风控（4 次），仍不进私募投研页。"
        "hcx 没有新登录，10 月 12 日 09:16–09:18 看了私募列表、管理人、基金搜索、金舆追风 1 号和上海龙全，几分钟就结束。",
    )
    g.para(doc, "developer，以及这两周没有使用痕迹的账号", size=12, bold=True, color=g.NAVY, space_after=4)
    g.para(
        doc,
        "developer 于 9 月 29 日 16:22 在办公室出口创建并登录，16:23–16:26 打开简文盛京四号斗金和黑翼策略精选 6 号的估值表，之后最近页面没有再更新。"
        "G.Wave 的最近页面停在 9 月 18 日，musheng 停在 9 月 10 日。yuki、liuyamin、zhougang、zzh 没有本期登录，服务器上也没有他们的最近页面文件。",
        space_after=8,
    )

    g.heading(doc, "七、对不上人名的流量", 1)
    g.para(
        doc,
        "124.79.17.112 本期 23,214 次，登录表从未出现这个地址。9 月 29 日它打了 3,430 次 MCP，"
        "全期路径还有跟踪基金池 3,573 次、投资笔记 555 次，以及看板和私募页。"
        "像一个假期前就保持着的会话，加上一段拉数。上一期同样对不上姓名，这一期仍然不能确认是谁。",
    )
    g.para(
        doc,
        "180.157.194.110 有 7,261 次，头几项是跟踪基金图表预览（1,295）、团队数据净值列表（834）和跟踪基金池（398），"
        "同时有私募和期货页。没有本期登录记录，不归到 sunjie 或其他运维账号上。",
    )
    g.para(
        doc,
        "218.82.7.52 有 3,673 次，跟踪基金池、投资笔记和私募详情都有。它和 jiang 的登录地址 218.82.15.181 同属 218.82 段，但不是同一地址，不能并成一个人。",
    )
    g.para(
        doc,
        f"223.104.210.52（2,837 次）几乎全是 CTP live 和实时行情，外加少量 MCP，像一台挂着行情页的终端。"
        f"39.144.244.116 只有 688 次，其中 MCP 293 次，仍是上一期见过的运营商地址，本期没有登录。"
        f"扫描类请求全期 {g.fmt_int(kind['probe'])} 次。安静的假期几天里，独立 IP 仍有七八十个，那是探测，不是用户。",
        space_after=12,
    )

    g.heading(doc, "八、可用性", 1)
    g.para(
        doc,
        f"2xx 共 {g.fmt_int(ok_2xx)}，占 {g.fmt_pct(ok_2xx, n)}。另有 304 缓存 {g.fmt_int(n_304)} 次。"
        f"404 共 {g.fmt_int(n_404)}，其中 /_vercel/insights/script.js {g.fmt_int(vercel_404)} 次，是自建站仍在请求 Vercel 统计脚本。"
        f"499（客户端断开）{g.fmt_int(n_499)}，502 {g.fmt_int(n_502)}，500 {g.fmt_int(n_500)}。",
    )
    g.para(
        doc,
        f"502 不是均匀撒开的。9 月 30 日有 {ERR_502['2026-09-30']} 次，占全期 {g.fmt_int(n_502)} 次里的大部分，"
        f"当天办公室 MCP 也最密（5,688 次），上游在拉数时断开过一轮。"
        f"10 月 8 日复工有 {ERR_502['2026-10-08']} 次 502、{ERR_499['2026-10-08']} 次 499。"
        f"10 月 12 日有 {ERR_502['2026-10-12']} 次 502 和 {ERR_499['2026-10-12']} 次 499，落在全期最忙的一天。"
        f"10 月 7 日请求不多，499 却有 {ERR_499['2026-10-07']} 次，更像手机或残留连接被掐断，而不是整站故障。",
    )
    g.add_picture(doc, charts["status"], 6.3)
    g.caption(doc, "图 6. HTTP 状态码。绿色为 2xx/3xx，金色为 4xx，红色为 5xx。")
    g.add_picture(doc, charts["networks"], 6.3)
    g.caption(doc, "图 7. 网段。办公室出口 A 与「其他」几乎各半；「其他」里含 115.175.161.* 的 MCP 客户端、家庭宽带和扫描。")
    g.add_picture(doc, charts["devices"], 6.3)
    g.caption(doc, "图 8. 终端。undici 被计在「其他」里，所以这一档主要是 Node 拉数，不是未知浏览器。手机流量里混着行情轮询。")

    g.heading(doc, "九、结论", 1)
    g.para(
        doc,
        "1）这 14 天的形状是：两个假期前工作日，六天接近空窗，10 月 7 日只有一次手机登录，10 月 8 日起恢复，10 月 12 日周一最重。"
        "用总请求除以 14 会把假期和 MCP 拉数混进日均，不能当成人均使用。",
        space_after=3,
    )
    g.para(
        doc,
        "2）10 月 8 日之后多出来的请求，主体是 115.175.161.* 上的 Node.js 客户端在调 /ma/api/fund-data/mcp，周末尤其如此。"
        "页面次数才反映有人在看。10 月 12 日页面 33,921 次，高于上一期任何一天。",
        space_after=3,
    )
    g.para(
        doc,
        "3）重新登录的是 cshen、sunjie、jiang、chenpeifeng、luoshuang、developer。保持登录仍在用的是 benc、caojie、chy、hcx、sunzhou。"
        "jiang 是这期新增的私募投研用户。chy 在 10 月 12 日中午重新出现。G.Wave、musheng、yuki、liuyamin、zhougang、zzh 没有痕迹。",
        space_after=3,
    )
    g.para(
        doc,
        "4）功能上，预取、心跳、行情 live、跟踪基金池和 MCP 放大了次数。看工作面应看私募（尽调、跟踪、FOF、估值表）和 MOM / 单账户风控。",
        space_after=3,
    )
    g.para(
        doc,
        "5）可用性上，9 月 30 日的 286 次 502 是本期主要的上游失败，10 月 12 日忙时又有 88 次。2xx 仍占九成以上。登录失败次数为 0。",
        space_after=8,
    )
    g.para(
        doc,
        "密级：内部。日志含客户端 IP 与浏览器信息，请勿转发到团队以外。",
        size=8, color=g.MUTED, space_after=4,
    )

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "网站流量与使用习惯_20260929-20261012.docx"
    doc.save(str(path))
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
