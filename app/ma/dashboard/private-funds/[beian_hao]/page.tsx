"use client"

import { useEffect, useState, useMemo } from "react"
import type React from "react"
import { useParams } from "next/navigation"
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { ArrowLeft } from "lucide-react"
import { useRouter } from "next/navigation"

const menuItems = [
  { key: "funds",      label: "基金" },
  { key: "portfolio",  label: "组合" },
  { key: "investment", label: "投资" },
  { key: "operations", label: "运维" },
]

const fundsSidebarItems = [
  { key: "private-funds",      label: "私募基金",  href: "/ma/dashboard/private-funds" },
  { key: "fund-managers-org",  label: "私募管理人", href: "/ma/dashboard/private-funds" },
  { key: "fund-managers",      label: "基金经理",  href: "/ma/dashboard/private-funds" },
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface FundInfo {
  beian_hao:      string
  product_name:   string
  strategy_l1:    string | null
  strategy_l2:    string | null
  manager:        string
  inception_date: string | null
  benchmark:      string | null
  ret_1w:         string | null
  ret_1m:         string | null
  ret_3m:         string | null
  ret_6m:         string | null
  ret_1y:         string | null
  sharpe_1y:      string | null
  calmar_1y:      string | null
}

interface NavRow {
  price_date:         string
  nav:                string
  cumulative_nav:     string
  cum_nav_withdrawal: string
  price_change:       string
}

interface Metrics {
  latest_nav:                string | null
  latest_nav_date:           string | null
  latest_cum_nav:            string | null
  latest_cum_nav_reinvested: string | null
  ret_since_inception:       string | null
  ann_ret:                   string | null
  ytd_ret:                   string | null
  max_drawdown:              string | null
  sharpe_since_inception:    string | null
}

interface DetailData {
  info:       FundInfo
  nav_series: NavRow[]
  metrics:    Metrics
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: string | null, decimals = 4): string {
  if (v === null || v === undefined) return "—"
  const n = parseFloat(v)
  if (isNaN(n)) return "—"
  return n.toFixed(decimals)
}

function fmtPct(v: string | null): { text: string; sign: 1 | -1 | 0 } {
  if (v === null || v === undefined) return { text: "—", sign: 0 }
  const n = parseFloat(v)
  if (isNaN(n)) return { text: "—", sign: 0 }
  const sign = n > 0 ? 1 : n < 0 ? -1 : 0
  return { text: (n > 0 ? "+" : "") + n.toFixed(2) + "%", sign }
}

const RED   = "rgb(239,68,68)"
const GREEN = "rgb(34,197,94)"

function PctSpan({ value, large = false }: { value: string | null; large?: boolean }) {
  const { text, sign } = fmtPct(value)
  const cls = large ? "text-2xl font-bold tabular-nums" : "text-sm font-semibold tabular-nums"
  const color =
    sign === 1 ? RED :
    sign === -1 ? GREEN :
    "text-zinc-500"
  return (
    <span className={cls} style={typeof color === "string" && color.startsWith("rgb") ? { color } : undefined}>
      {text}
    </span>
  )
}

// Downsample chart data: keep at most ~500 points for perf
function downsample(rows: NavRow[], maxPoints = 500): NavRow[] {
  if (rows.length <= maxPoints) return rows
  const step = Math.ceil(rows.length / maxPoints)
  const out: NavRow[] = []
  for (let i = 0; i < rows.length; i += step) out.push(rows[i])
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1])
  return out
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 px-4 rounded-lg bg-zinc-50 border border-zinc-100 min-w-0">
      <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide leading-none">{label}</span>
      <div className="mt-1 text-[22px] font-bold tabular-nums leading-tight text-zinc-900">{value}</div>
      {sub && <span className="text-[11px] text-zinc-400 mt-0.5">{sub}</span>}
    </div>
  )
}

// ─── NAV Table (paginated) ──────────────────────────────────────────────────

const NAV_PAGE = 20

function NavTable({ rows }: { rows: NavRow[] }) {
  const [page, setPage] = useState(1)
  // Show newest first
  const reversed = useMemo(() => [...rows].reverse(), [rows])
  const totalPages = Math.ceil(reversed.length / NAV_PAGE)
  const slice = reversed.slice((page - 1) * NAV_PAGE, page * NAV_PAGE)

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-zinc-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-100">
              <th className="px-4 py-2.5 text-left font-medium text-zinc-500 text-xs">日期</th>
              <th className="px-4 py-2.5 text-right font-medium text-zinc-500 text-xs">单位净值</th>
              <th className="px-4 py-2.5 text-right font-medium text-zinc-500 text-xs">累计净值</th>
              <th className="px-4 py-2.5 text-right font-medium text-zinc-500 text-xs">复权净值</th>
              <th className="px-4 py-2.5 text-right font-medium text-zinc-500 text-xs">涨跌幅</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              const chg = parseFloat(r.price_change)
              const chgPct = isNaN(chg) ? null : (chg * 100).toFixed(2)
              const chgColor = isNaN(chg) ? "text-zinc-500" : chg > 0 ? "" : chg < 0 ? "" : "text-zinc-500"
              const chgStyle = isNaN(chg) ? {} : chg > 0 ? { color: RED } : chg < 0 ? { color: GREEN } : {}
              return (
                <tr key={r.price_date} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/60">
                  <td className="px-4 py-2.5 text-zinc-700">{r.price_date}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-900 font-medium">{fmt(r.nav, 4)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">{fmt(r.cum_nav_withdrawal, 4)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">{fmt(r.cumulative_nav, 4)}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${chgColor}`} style={chgStyle}>
                    {chgPct !== null ? (parseFloat(chgPct) > 0 ? "+" : "") + chgPct + "%" : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-xs rounded border border-zinc-200 disabled:opacity-40 hover:bg-zinc-50"
          >
            上一页
          </button>
          <span className="px-3 text-xs text-zinc-500">
            第 {page} / {totalPages} 页（共 {rows.length} 条）
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-xs rounded border border-zinc-200 disabled:opacity-40 hover:bg-zinc-50"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, mode }: { active?: boolean; payload?: { value: number }[]; label?: string; mode?: "nav" | "return" }) {
  if (!active || !payload?.length) return null
  const v = payload[0]?.value
  const display = mode === "return"
    ? (v >= 0 ? "+" : "") + v?.toFixed(2) + "%"
    : v?.toFixed(4)
  const fieldLabel = mode === "return" ? "收益率" : "复权净值"
  return (
    <div className="bg-white border border-zinc-100 shadow-md rounded-lg px-3 py-2 text-xs">
      <div className="text-zinc-500 mb-1">{label}</div>
      <div className="font-semibold text-zinc-900">{fieldLabel}: {display}</div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PrivateFundDetailPage() {
  const params = useParams()
  const router = useRouter()
  const beian_hao = typeof params.beian_hao === "string" ? params.beian_hao : ""

  const [data, setData]       = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!beian_hao) return
    setLoading(true)
    setError(null)
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<DetailData>
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [beian_hao])

  const [chartMode, setChartMode] = useState<"nav" | "return">("nav")

  // ─── Filter state ────────────────────────────────────────────────────────
  const inceptionDate = data?.info.inception_date?.slice(0, 10) ?? ""
  const todayStr = new Date().toISOString().slice(0, 10)

  const [filterPeriod,   setFilterPeriod]   = useState<string>("成立以来")
  const [filterFrom,     setFilterFrom]     = useState<string>("")
  const [filterTo,       setFilterTo]       = useState<string>("")
  const [filterNavType,  setFilterNavType]  = useState<string>("复权净值")
  const [filterFreq,     setFilterFreq]     = useState<string>("全部")
  const [filterBench,    setFilterBench]    = useState<string>("")
  // Applied values (only updated on 开始分析)
  const [appliedFrom,    setAppliedFrom]    = useState<string>("")
  const [appliedTo,      setAppliedTo]      = useState<string>("")

  // When data loads, seed benchmark and dates
  useEffect(() => {
    if (!data) return
    const inc = data.info.inception_date?.slice(0, 10) ?? ""
    const last = data.nav_series.length ? data.nav_series[data.nav_series.length - 1].price_date : todayStr
    setFilterFrom(inc)
    setFilterTo(last)
    setFilterBench(data.info.benchmark ?? "")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const PERIOD_OPTIONS = ["成立以来", "近1年", "近3年", "近5年", "今年以来", "自定义"]
  function applyPeriod(p: string) {
    setFilterPeriod(p)
    if (!data) return
    const last = data.nav_series.length ? data.nav_series[data.nav_series.length - 1].price_date : todayStr
    const inc  = data.info.inception_date?.slice(0, 10) ?? last
    let from = inc
    if (p === "近1年")  from = sub(last, 1, "year")
    else if (p === "近3年")  from = sub(last, 3, "year")
    else if (p === "近5年")  from = sub(last, 5, "year")
    else if (p === "今年以来") from = last.slice(0, 4) + "-01-01"
    setFilterFrom(from)
    setFilterTo(last)
  }
  function sub(dateStr: string, n: number, unit: "year"): string {
    const d = new Date(dateStr)
    d.setFullYear(d.getFullYear() - n)
    return d.toISOString().slice(0, 10)
  }
  function handleApply() {
    setAppliedFrom(filterFrom)
    setAppliedTo(filterTo)
  }
  function handleReset() {
    const inc  = inceptionDate
    const last = data?.nav_series.length ? data.nav_series[data.nav_series.length - 1].price_date : todayStr
    setFilterPeriod("成立以来")
    setFilterFrom(inc)
    setFilterTo(last)
    setFilterNavType("复权净值")
    setFilterFreq("全部")
    setFilterBench(data?.info.benchmark ?? "")
    setAppliedFrom("")
    setAppliedTo("")
  }

  // Active date range for chart/table
  const activeFrom = appliedFrom || filterFrom
  const activeTo   = appliedTo   || filterTo

  const chartData = useMemo(() => {
    if (!data) return []
    const rows = data.nav_series.filter(r => (!activeFrom || r.price_date >= activeFrom) && (!activeTo || r.price_date <= activeTo))
    return downsample(rows).map((r) => ({
      date: r.price_date,
      value: parseFloat(r.cumulative_nav),
    }))
  }, [data, activeFrom, activeTo])

  const returnChartData = useMemo(() => {
    if (!data || !data.nav_series.length) return []
    const rows = data.nav_series.filter(r => (!activeFrom || r.price_date >= activeFrom) && (!activeTo || r.price_date <= activeTo))
    if (!rows.length) return []
    const firstNav = parseFloat(rows[0].cumulative_nav)
    return downsample(rows).map((r) => ({
      date: r.price_date,
      value: firstNav > 0 ? +((parseFloat(r.cumulative_nav) / firstNav - 1) * 100).toFixed(4) : 0,
    }))
  }, [data, activeFrom, activeTo])

  const activeChartData = chartMode === "nav" ? chartData : returnChartData

  const yDomain = useMemo(() => {
    if (!activeChartData.length) return ["auto", "auto"] as [string, string]
    const vals = activeChartData.map((d) => d.value)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.05
    return [+(min - pad).toFixed(4), +(max + pad).toFixed(4)] as [number, number]
  }, [activeChartData])

  function PageShell({ children }: { children: React.ReactNode }) {
    return (
      <div className="flex flex-col">
        {/* Top menu bar */}
        <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <nav className="flex items-center gap-1 px-6 h-12">
            {menuItems.map((item) => (
              <button
                key={item.key}
                onClick={() => item.key !== "funds" && router.push("/ma/dashboard/private-funds")}
                className={[
                  "relative px-4 h-full text-sm font-medium transition-colors focus:outline-none",
                  item.key === "funds"
                    ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-zinc-900 after:rounded-full dark:after:bg-zinc-100"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        {/* Body: sidebar + content */}
        <div className="flex">
          <aside className="w-44 border-r bg-background flex-shrink-0">
            <nav className="flex flex-col gap-0.5 p-3 pt-4">
              {fundsSidebarItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => item.key !== "private-funds" ? router.push(item.href) : undefined}
                  className={[
                    "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none",
                    item.key === "private-funds"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-semibold"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>
          <div className="flex-1 p-5 min-w-0">{children}</div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-40 text-zinc-400 text-sm">加载中…</div>
      </PageShell>
    )
  }

  if (error || !data) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-40 text-red-500 text-sm">
          加载失败：{error ?? "未知错误"}
        </div>
      </PageShell>
    )
  }

  const { info, metrics, nav_series } = data
  const pct1w = fmtPct(info.ret_1w ? (parseFloat(info.ret_1w) * 100).toFixed(2) : null)
  const pct1m = fmtPct(info.ret_1m ? (parseFloat(info.ret_1m) * 100).toFixed(2) : null)
  const pct3m = fmtPct(info.ret_3m ? (parseFloat(info.ret_3m) * 100).toFixed(2) : null)
  const pct6m = fmtPct(info.ret_6m ? (parseFloat(info.ret_6m) * 100).toFixed(2) : null)
  const pct1y = fmtPct(info.ret_1y ? (parseFloat(info.ret_1y) * 100).toFixed(2) : null)

  function RetPill({ label, pct }: { label: string; pct: { text: string; sign: 1 | -1 | 0 } }) {
    const color = pct.sign === 1 ? RED : pct.sign === -1 ? GREEN : "#a1a1aa"
    return (
      <div className="flex flex-col items-center gap-0.5 px-3 py-2 rounded bg-zinc-50 border border-zinc-100">
        <span className="text-[10px] text-zinc-400 font-medium">{label}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color }}>{pct.text}</span>
      </div>
    )
  }

  // X-axis tick formatter: only show year changes
  let lastYear = ""
  function xTick(val: string): string {
    const yr = val.slice(0, 4)
    if (yr !== lastYear) { lastYear = yr; return yr }
    return ""
  }

  return (
    <PageShell>
    <div>
      {/* Back link */}
      <a
        href="/ma/dashboard/private-funds"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        返回基金列表
      </a>

      {/* ── Header: fund name + strategy tags ────────────── */}
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-zinc-900 leading-tight">{info.product_name}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          {info.strategy_l1 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 font-medium">
              {info.strategy_l1}
            </span>
          )}
          {info.strategy_l2 && info.strategy_l2 !== "-" && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
              {info.strategy_l2}
            </span>
          )}
        </div>
      </div>

      {/* ── Key info band ── */}
      <div className="flex items-start gap-8 py-4 mb-4 border-y border-zinc-100">

        {/* LEFT: all metric cells – flex-1 + justify-between to fill the row */}
        <div className="flex flex-wrap items-start gap-x-16 gap-y-3">

        {/* 单位净值 – hero number */}
        <div className="min-w-[120px]">
          <div className="text-[2rem] font-bold tabular-nums leading-none" style={{ color: RED }}>
            {fmt(metrics.latest_nav, 4)}
          </div>
          <div className="text-xs text-zinc-500 mt-1">单位净值（{metrics.latest_nav_date ?? ""}）</div>
        </div>

        {/* 累计净值 + 复权净值 */}
        <div className="flex flex-col gap-1 justify-center">
          <div className="text-xs text-zinc-500">
            累计净值：<span className="font-semibold text-zinc-800 tabular-nums">{fmt(metrics.latest_cum_nav, 4)}</span>
          </div>
          <div className="text-xs text-zinc-500">
            复权净值：<span className="font-semibold text-zinc-800 tabular-nums">{fmt(metrics.latest_cum_nav_reinvested, 4)}</span>
          </div>
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px self-stretch bg-zinc-100" />

        {/* 成立以来收益 */}
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[1.4rem] font-bold tabular-nums" style={{ color: RED }}>
            {metrics.ret_since_inception !== null ? "+" + metrics.ret_since_inception + "%" : "—"}
          </span>
          <span className="text-xs text-zinc-500">成立以来收益</span>
        </div>

        {/* 今年以来收益 */}
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[1.4rem] font-bold tabular-nums" style={{ color: RED }}>
            {metrics.ytd_ret !== null
              ? (parseFloat(metrics.ytd_ret) > 0 ? "+" : "") + metrics.ytd_ret + "%"
              : "—"}
          </span>
          <span className="text-xs text-zinc-500">今年以来收益</span>
        </div>

        {/* 成立以来年化 */}
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[1.4rem] font-bold tabular-nums" style={{ color: RED }}>
            {metrics.ann_ret !== null ? "+" + metrics.ann_ret + "%" : "—"}
          </span>
          <span className="text-xs text-zinc-500">成立以来年化</span>
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px self-stretch bg-zinc-100" />

        {/* 最大回撤 */}
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[1.4rem] font-bold tabular-nums" style={{ color: GREEN }}>
            {metrics.max_drawdown !== null ? "-" + metrics.max_drawdown + "%" : "—"}
          </span>
          <span className="text-xs text-zinc-500">成立以来最大回撤</span>
        </div>

        {/* 夏普比率 – computed since inception */}
        {metrics.sharpe_since_inception && (
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-[1.4rem] font-bold tabular-nums text-zinc-800">
              {metrics.sharpe_since_inception}
            </span>
            <span className="text-xs text-zinc-500">成立以来夏普比率</span>
          </div>
        )}

        </div>{/* end LEFT */}

        {/* RIGHT: 备案 / 管理人 info block */}
        <div className="shrink-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-zinc-500 self-center">
          <span>备案编号：</span>
          <span className="font-medium text-zinc-800">{info.beian_hao}</span>
          <span>产品成立时间：</span>
          <span className="font-medium text-zinc-800">{info.inception_date?.slice(0, 10) ?? "—"}</span>
          <span>私募管理人：</span>
          <span className="font-medium text-zinc-800">{info.manager}</span>
          {info.benchmark && (
            <>
              <span>业绩基准：</span>
              <span className="font-medium text-zinc-800">{info.benchmark}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 mb-4 rounded-lg border border-zinc-100 bg-zinc-50 text-xs">

        {/* 统计区间 */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 whitespace-nowrap">统计区间：</span>
          <select
            value={filterPeriod}
            onChange={e => applyPeriod(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
          >
            {PERIOD_OPTIONS.map(o => <option key={o}>{o}</option>)}
          </select>
        </div>

        {/* Date from */}
        <input
          type="date"
          value={filterFrom}
          onChange={e => { setFilterFrom(e.target.value); setFilterPeriod("自定义") }}
          className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
        />
        <span className="text-zinc-400">～</span>
        {/* Date to */}
        <input
          type="date"
          value={filterTo}
          onChange={e => { setFilterTo(e.target.value); setFilterPeriod("自定义") }}
          className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
        />

        {/* 净值类型 */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 whitespace-nowrap">净值类型：</span>
          <select
            value={filterNavType}
            onChange={e => setFilterNavType(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
          >
            {["复权净值", "单位净值", "累计净值"].map(o => <option key={o}>{o}</option>)}
          </select>
        </div>

        {/* 净值频率 */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 whitespace-nowrap">净值频率：</span>
          <select
            value={filterFreq}
            onChange={e => setFilterFreq(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
          >
            {["全部", "日频", "周频", "月频"].map(o => <option key={o}>{o}</option>)}
          </select>
        </div>

        {/* 业绩基准 */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 whitespace-nowrap">业绩基准：</span>
          <input
            type="text"
            value={filterBench}
            onChange={e => setFilterBench(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none w-32"
          />
        </div>

        {/* Buttons */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded border border-red-500 text-red-500 hover:bg-red-50 font-medium transition-colors"
          >
            重置
          </button>
          <button
            onClick={handleApply}
            className="px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600 font-medium transition-colors"
          >
            开始分析
          </button>
        </div>
      </div>

      {/* ── Chart + Table side by side ─────────────────── */}
      <div className="flex flex-col xl:flex-row gap-4">
      {activeChartData.length > 1 && (
        <div className="flex-1 min-w-0 rounded-xl border border-zinc-100 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-zinc-700">
              {chartMode === "nav" ? "净值走势（复权净值）" : "收益曲线（成立以来收益率）"}
            </div>
            <div className="flex rounded-lg border border-zinc-200 overflow-hidden text-xs">
              <button
                onClick={() => setChartMode("return")}
                className={`px-3 py-1.5 transition-colors ${
                  chartMode === "return"
                    ? "bg-zinc-900 text-white font-semibold"
                    : "bg-white text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                收益曲线
              </button>
              <button
                onClick={() => setChartMode("nav")}
                className={`px-3 py-1.5 transition-colors border-l border-zinc-200 ${
                  chartMode === "nav"
                    ? "bg-zinc-900 text-white font-semibold"
                    : "bg-white text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                净值曲线
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <AreaChart data={activeChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#a1a1aa" }}
                tickFormatter={xTick}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontSize: 11, fill: "#a1a1aa" }}
                width={60}
                tickFormatter={(v: number) => chartMode === "return" ? v.toFixed(0) + "%" : v.toFixed(2)}
              />
              <Tooltip content={(props) => (
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                <ChartTooltip {...(props as any)} mode={chartMode} />
              )} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#ef4444"
                strokeWidth={1.5}
                fill="url(#navGrad)"
                dot={false}
                activeDot={{ r: 4, fill: "#ef4444" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── NAV Table ─────────────────────────────────────── */}
      <div className="xl:w-[480px] flex-shrink-0 rounded-xl border border-zinc-100 bg-white p-5">
        <div className="text-sm font-semibold text-zinc-700 mb-3">净值数据</div>
        <NavTable rows={nav_series.filter(r => (!activeFrom || r.price_date >= activeFrom) && (!activeTo || r.price_date <= activeTo))} />
      </div>
      </div>{/* end flex chart+table */}
    </div>
    </PageShell>
  )
}
