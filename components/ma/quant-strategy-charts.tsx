"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import ReactECharts from "echarts-for-react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { QUANT_ACCOUNT_IDS } from "@/lib/ma/quant-accounts"

const UP = "#ef4444"
const DOWN = "#10b981"
const BLUE = "#3b82f6"
const AMBER = "#f59e0b"

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}
function isoMonthOffset(m: number) {
  const d = new Date()
  d.setMonth(d.getMonth() + m)
  return d.toISOString().slice(0, 10)
}

const RANGES = [
  { label: "近一月", from: () => isoMonthOffset(-1), to: () => isoToday() },
  { label: "近三月", from: () => isoMonthOffset(-3), to: () => isoToday() },
  { label: "近六月", from: () => isoMonthOffset(-6), to: () => isoToday() },
  { label: "近一年", from: () => isoMonthOffset(-12), to: () => isoToday() },
  { label: "全部", from: () => "2025-01-01", to: () => isoToday() },
]

function fmtWan(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  const sign = n > 0 ? "+" : n < 0 ? "-" : ""
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}万`
  return `${sign}${Math.round(abs).toLocaleString("zh-CN")}`
}

function fmtPct(n: number | null | undefined, d = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(d)}%`
}

function pnlColor(n: number): string {
  if (n > 0) return UP
  if (n < 0) return DOWN
  return "inherit"
}

type Tone = "good" | "bad" | "neutral"
interface PortraitItem { title: string; detail: string; tone: Tone }
interface ApiData {
  ok: boolean
  error?: string
  notYetRun?: boolean
  account: string | null
  accountId?: string
  quantIds?: number[]
  from?: string
  to?: string
  kpis: {
    tradingDays: number
    totalPnl: number
    dayWinRate: number
    tradeWinRate: number
    profitFactor: number | null
    dayProfitFactor: number | null
    sharpe: number | null
    maxDdPct: number
    avgHoldWin: number | null
    avgHoldLoss: number | null
    medianHold: number | null
    hedgeRatioAvg: number
    lockShareAvg?: number
    nCloses: number
    corrNhci: number | null
  }
  portrait: { strategyLabel: string; summary: string; items: PortraitItem[] }
  equity: { date: string; pnl: number; cumPnl: number; equity: number; margin: number; riskPct: number; ddPct: number }[]
  regime: { key: string; label: string; pnl: number; days: number; winRate: number }[]
  sectors: { sector: string; pnl: number; lots: number }[]
  products: {
    code: string; name: string; sector: string; pnl: number; lots: number
    winRate: number; profitFactor: number | null; avgHoldWin: number | null; avgHoldLoss: number | null; n: number
  }[]
  payoff: {
    winRate: number; avgWin: number; avgLoss: number; profitFactor: number | null
    winLots: number; lossLots: number; winDays: number; lossDays: number
  }
  hold: {
    buckets: { bucket: string; label: string; winLots: number; lossLots: number; winPnl: number; lossPnl: number }[]
    avgWin: number | null
    avgLoss: number | null
  }
  session: { day: { pnl: number; lots: number; fee: number }; night: { pnl: number; lots: number; fee: number } }
  afterMove: {
    afterWin: { dRisk: number | null; dMarginPct: number | null; nextOpenShare: number | null; n: number }
    afterLoss: { dRisk: number | null; dMarginPct: number | null; nextOpenShare: number | null; n: number }
  }
  hedge: { date: string; ratio: number; longMv: number; shortMv: number; lockShare: number }[]
  longShort: { longPnl: number; shortPnl: number; longLots: number; shortLots: number; longWinRate: number; shortWinRate: number }
}

const TONE: Record<Tone, string> = {
  good: "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20",
  bad: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20",
  neutral: "border-border bg-muted/30",
}

function axisPnl(v: number) {
  const abs = Math.abs(v)
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}万`
  return String(Math.round(v))
}

export default function QuantStrategyCharts() {
  const [accountId, setAccountId] = useState("319")
  const [range, setRange] = useState("近六月")
  const [from, setFrom] = useState(() => isoMonthOffset(-6))
  const [to, setTo] = useState(() => isoToday())
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ account: accountId, from, to })
      const res = await fetch(`/ma/api/mom-analysis/quant-strategy?${params}`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || "请求失败")
      setData(json as ApiData)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [accountId, from, to])

  useEffect(() => { load() }, [load])

  const ids = data?.quantIds?.length ? data.quantIds : [...QUANT_ACCOUNT_IDS]
  const k = data?.kpis
  const p = data?.payoff
  const eq = data?.equity ?? []

  const equityOption = useMemo(() => {
    if (!eq.length) return {}
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 }, data: ["累计盈亏", "回撤"] },
      grid: { left: 52, right: 48, top: 28, bottom: 28 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 4, textStyle: { fontSize: 9 } }],
      xAxis: { type: "category", data: eq.map((r) => r.date.slice(5)), axisLabel: { fontSize: 10 } },
      yAxis: [
        { type: "value", name: "盈亏", axisLabel: { fontSize: 10, formatter: axisPnl }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
        { type: "value", name: "回撤 %", axisLabel: { fontSize: 10, formatter: (v: number) => `${v}%` }, splitLine: { show: false } },
      ],
      series: [
        {
          name: "累计盈亏", type: "line", showSymbol: false, data: eq.map((r) => r.cumPnl),
          lineStyle: { width: 2, color: BLUE }, itemStyle: { color: BLUE },
        },
        {
          name: "回撤", type: "line", yAxisIndex: 1, showSymbol: false, data: eq.map((r) => r.ddPct),
          lineStyle: { width: 1, color: AMBER }, areaStyle: { color: "rgba(245,158,11,0.15)" }, itemStyle: { color: AMBER },
        },
      ],
    }
  }, [eq])

  const histOption = useMemo(() => {
    if (!eq.length) return {}
    const pnls = eq.map((r) => r.pnl)
    const bound = Math.max(...pnls.map(Math.abs), 1)
    const N = 12
    const step = (2 * bound) / N
    const bins = Array.from({ length: N }, (_, i) => {
      const lo = -bound + i * step
      const hi = lo + step
      const count = pnls.filter((v) => (i === N - 1 ? v >= lo && v <= hi : v >= lo && v < hi)).length
      return { lo, hi, count, profit: (lo + hi) / 2 >= 0 }
    })
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 40, right: 12, top: 16, bottom: 48 },
      xAxis: {
        type: "category",
        data: bins.map((b) => `${axisPnl(b.lo)}`),
        axisLabel: { fontSize: 9, rotate: 40 },
      },
      yAxis: { type: "value", name: "天数", axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
      series: [{
        type: "bar",
        data: bins.map((b) => ({ value: b.count, itemStyle: { color: b.profit ? UP : DOWN, borderRadius: [2, 2, 0, 0] } })),
        barMaxWidth: 18,
      }],
    }
  }, [eq])

  const regimeOption = useMemo(() => {
    const rows = data?.regime ?? []
    if (!rows.length) return {}
    return {
      tooltip: {
        trigger: "axis",
        formatter: (ps: { name: string; value: number; dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0
          const r = rows[i]
          return `${r.label}<br/>盈亏 ${fmtWan(r.pnl)}<br/>天数 ${r.days} · 日胜率 ${fmtPct(r.winRate)}`
        },
      },
      grid: { left: 56, right: 12, top: 8, bottom: 28 },
      xAxis: { type: "category", data: rows.map((r) => r.label), axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", axisLabel: { fontSize: 10, formatter: axisPnl }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
      series: [{
        type: "bar",
        data: rows.map((r) => ({ value: r.pnl, itemStyle: { color: r.pnl >= 0 ? UP : DOWN, borderRadius: [2, 2, 0, 0] } })),
        barMaxWidth: 28,
      }],
    }
  }, [data?.regime])

  const sectorOption = useMemo(() => {
    const rows = [...(data?.sectors ?? [])].sort((a, b) => a.pnl - b.pnl)
    if (!rows.length) return {}
    return {
      tooltip: { trigger: "axis", formatter: (ps: { name: string; value: number }[]) => `${ps[0].name} ${fmtWan(ps[0].value)}` },
      grid: { left: 64, right: 24, top: 8, bottom: 24 },
      xAxis: { type: "value", axisLabel: { fontSize: 10, formatter: axisPnl }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
      yAxis: { type: "category", data: rows.map((r) => r.sector), axisLabel: { fontSize: 11 } },
      series: [{
        type: "bar",
        data: rows.map((r) => ({ value: r.pnl, itemStyle: { color: r.pnl >= 0 ? UP : DOWN, borderRadius: 2 } })),
        barMaxWidth: 14,
      }],
    }
  }, [data?.sectors])

  const afterOption = useMemo(() => {
    const a = data?.afterMove
    if (!a) return {}
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 12, top: 28, bottom: 28 },
      xAxis: { type: "category", data: ["次日风险度变化 (百分点)", "次日保证金变化 %", "次日开仓手数占比 %"], axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
      series: [
        { name: "盈利之后", type: "bar", barMaxWidth: 18, itemStyle: { color: UP, borderRadius: 2 }, data: [a.afterWin.dRisk, a.afterWin.dMarginPct, a.afterWin.nextOpenShare] },
        { name: "亏损之后", type: "bar", barMaxWidth: 18, itemStyle: { color: DOWN, borderRadius: 2 }, data: [a.afterLoss.dRisk, a.afterLoss.dMarginPct, a.afterLoss.nextOpenShare] },
      ],
    }
  }, [data?.afterMove])

  const payoffOption = useMemo(() => {
    if (!p) return {}
    return {
      tooltip: { trigger: "axis", formatter: (ps: { seriesName: string; value: number }[]) => ps.map((x) => `${x.seriesName} ${fmtWan(x.value)}`).join("<br/>") },
      grid: { left: 56, right: 16, top: 16, bottom: 28 },
      xAxis: { type: "category", data: ["平均每手盈利", "平均每手亏损"], axisLabel: { fontSize: 11 } },
      yAxis: { type: "value", axisLabel: { fontSize: 10, formatter: axisPnl }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
      series: [{
        type: "bar",
        barMaxWidth: 48,
        data: [
          { value: p.avgWin, itemStyle: { color: UP, borderRadius: 2 } },
          { value: p.avgLoss, itemStyle: { color: DOWN, borderRadius: 2 } },
        ],
      }],
    }
  }, [p])

  const holdOption = useMemo(() => {
    const rows = data?.hold?.buckets ?? []
    if (!rows.length) return {}
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 12, top: 28, bottom: 28 },
      xAxis: { type: "category", data: rows.map((r) => r.label), axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", name: "手数", axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
      series: [
        { name: "盈利平仓", type: "bar", stack: "h", barMaxWidth: 28, itemStyle: { color: UP }, data: rows.map((r) => r.winLots) },
        { name: "亏损平仓", type: "bar", stack: "h", barMaxWidth: 28, itemStyle: { color: DOWN }, data: rows.map((r) => r.lossLots) },
      ],
    }
  }, [data?.hold])

  const sessionOption = useMemo(() => {
    const s = data?.session
    if (!s) return {}
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 52, right: 12, top: 28, bottom: 28 },
      xAxis: { type: "category", data: ["日盘 (08:00–21:00)", "夜盘 (21:00–08:00)"], axisLabel: { fontSize: 11 } },
      yAxis: { type: "value", axisLabel: { fontSize: 10, formatter: axisPnl }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
      series: [
        {
          name: "平仓盈亏", type: "bar", barMaxWidth: 28, itemStyle: { borderRadius: 2 },
          data: [
            { value: s.day.pnl, itemStyle: { color: s.day.pnl >= 0 ? UP : DOWN } },
            { value: s.night.pnl, itemStyle: { color: s.night.pnl >= 0 ? UP : DOWN } },
          ],
        },
      ],
    }
  }, [data?.session])

  const hedgeOption = useMemo(() => {
    const rows = data?.hedge ?? []
    if (!rows.length) return {}
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 12, top: 28, bottom: 28 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 4, textStyle: { fontSize: 9 } }],
      xAxis: { type: "category", data: rows.map((r) => r.date.slice(5)), axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", name: "%", axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
      series: [
        { name: "多空对冲度", type: "line", showSymbol: false, data: rows.map((r) => r.ratio), lineStyle: { width: 2, color: BLUE }, itemStyle: { color: BLUE } },
        { name: "同一合约双开", type: "line", showSymbol: false, data: rows.map((r) => r.lockShare), lineStyle: { width: 1.5, color: AMBER }, itemStyle: { color: AMBER } },
      ],
    }
  }, [data?.hedge])

  const lsOption = useMemo(() => {
    const ls = data?.longShort
    if (!ls) return {}
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 56, right: 16, top: 16, bottom: 28 },
      xAxis: { type: "category", data: ["多头（卖平）", "空头（买平）"], axisLabel: { fontSize: 11 } },
      yAxis: { type: "value", axisLabel: { fontSize: 10, formatter: axisPnl }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
      series: [{
        type: "bar", barMaxWidth: 48,
        data: [
          { value: ls.longPnl, itemStyle: { color: ls.longPnl >= 0 ? UP : DOWN, borderRadius: 2 } },
          { value: ls.shortPnl, itemStyle: { color: ls.shortPnl >= 0 ? UP : DOWN, borderRadius: 2 } },
        ],
      }],
    }
  }, [data?.longShort])

  const riskOption = useMemo(() => {
    if (!eq.length) return {}
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 16, bottom: 28 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 4, textStyle: { fontSize: 9 } }],
      xAxis: { type: "category", data: eq.map((r) => r.date.slice(5)), axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", name: "风险度 %", axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
      series: [{
        name: "风险度", type: "line", showSymbol: false, data: eq.map((r) => r.riskPct),
        lineStyle: { width: 2, color: BLUE }, areaStyle: { color: "rgba(59,130,246,0.08)" }, itemStyle: { color: BLUE },
      }],
    }
  }, [eq])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            选择量化账户，用成交、平仓与日核算倒推策略画像：适合什么市、怎么管风险、盈亏偏好、是否对冲、日盘还是夜盘、盈亏单持仓多久。
          </p>
          {data?.account && (
            <p className="text-xs text-muted-foreground mt-1">
              {data.account} · {data.from} 至 {data.to} · {k?.tradingDays ?? 0} 个交易日 · {k?.nCloses ?? 0} 笔平仓
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">账户</span>
        {ids.map((id) => {
          const active = String(id) === accountId
          return (
            <button
              key={id}
              onClick={() => setAccountId(String(id))}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              rx{id}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">区间</span>
        {RANGES.map((r) => {
          const active = range === r.label
          return (
            <button
              key={r.label}
              onClick={() => {
                setRange(r.label)
                setFrom(r.from())
                setTo(r.to())
              }}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          )
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.notYetRun && <p className="text-sm text-muted-foreground">核算表尚未导入。</p>}

      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{data?.portrait.strategyLabel ?? (loading ? "分析中…" : "—")}</h2>
          {k?.corrNhci != null && (
            <span className="text-xs text-muted-foreground">南华相关 {k.corrNhci}</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{data?.portrait.summary}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {(data?.portrait.items ?? []).map((item) => (
            <div key={item.title} className={`rounded-md border px-3 py-2.5 ${TONE[item.tone]}`}>
              <div className="text-xs font-medium mb-1">{item.title}</div>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Kpi title="区间净盈亏" value={fmtWan(k?.totalPnl)} hint={`${k?.tradingDays ?? 0} 个交易日`} accent={k ? pnlColor(k.totalPnl) : undefined} />
        <Kpi title="日胜率 / 平仓胜率" value={`${fmtPct(k?.dayWinRate, 0)} / ${fmtPct(k?.tradeWinRate, 0)}`} hint={`盈亏比 ${k?.profitFactor?.toFixed(2) ?? "—"}`} />
        <Kpi title="夏普 / 最大回撤" value={`${k?.sharpe?.toFixed(2) ?? "—"} / ${fmtPct(k?.maxDdPct)}`} hint="回撤相对权益峰值" />
        <Kpi title="盈/亏持仓天数" value={`${k?.avgHoldWin?.toFixed(1) ?? "—"} / ${k?.avgHoldLoss?.toFixed(1) ?? "—"}`} hint={`中位数 ${k?.medianHold?.toFixed(1) ?? "—"} 天`} />
        <Kpi title="平均对冲度" value={fmtPct(k?.hedgeRatioAvg, 0)} hint={`同一合约双开 ${fmtPct(k?.lockShareAvg, 0)}`} />
        <Kpi
          title="夜盘手数占比"
          value={fmtPct(
            data?.session
              ? (data.session.night.lots / Math.max(data.session.night.lots + data.session.day.lots, 1)) * 100
              : null,
            0,
          )}
          hint={`日盘 ${fmtWan(data?.session?.day.pnl ?? 0)} / 夜盘 ${fmtWan(data?.session?.night.pnl ?? 0)}（平仓）`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="累计盈亏与回撤" caption="权益曲线形态：趋势跟踪通常回撤深、恢复慢；短线更碎。">
          {eq.length > 0 && <ReactECharts option={equityOption} style={{ height: 280, width: "100%" }} notMerge />}
        </ChartCard>
        <ChartCard title="日盈亏分布" caption="柱子偏左=经常小亏；右尾长=偶尔大赢。和胜率/盈亏比对照看。">
          {eq.length > 0 && <ReactECharts option={histOption} style={{ height: 280, width: "100%" }} notMerge />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="哪种市场赚得多" caption="按南华商品指数日涨跌、20 日趋势强度、波动水平切分账户日盈亏。">
          {(data?.regime?.length ?? 0) > 0 && <ReactECharts option={regimeOption} style={{ height: 280, width: "100%" }} notMerge />}
        </ChartCard>
        <ChartCard title="板块盈亏" caption="正贡献=擅长，负贡献=不擅长。结合上面的市场环境一起看。">
          {(data?.sectors?.length ?? 0) > 0 && <ReactECharts option={sectorOption} style={{ height: 280, width: "100%" }} notMerge />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="风险度" caption="杠杆用到什么水平、是否突然抬升。">
          {eq.length > 0 && <ReactECharts option={riskOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
        <ChartCard
          title="赚了 / 亏了之后第二天"
          caption={`盈利日 n=${data?.afterMove.afterWin.n ?? 0}，亏损日 n=${data?.afterMove.afterLoss.n ?? 0}。风险度下降=收手；开仓占比高=还在加。`}
        >
          {data?.afterMove && <ReactECharts option={afterOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="盈亏偏好"
          caption={`平仓胜率 ${fmtPct(p?.winRate, 0)}，盈亏比 ${p?.profitFactor?.toFixed(2) ?? "—"}。高胜率低柱差=刮头皮；低胜率但盈利柱远高于亏损柱=趋势。`}
        >
          {p && <ReactECharts option={payoffOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
        <ChartCard
          title="持仓多久才走"
          caption={`盈利单 ${data?.hold.avgWin?.toFixed(1) ?? "—"} 天，亏损单 ${data?.hold.avgLoss?.toFixed(1) ?? "—"} 天。亏的比赚的拿得久 = 扛单。`}
        >
          {(data?.hold.buckets.length ?? 0) > 0 && <ReactECharts option={holdOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="日盘 vs 夜盘" caption="按成交时间：21:00–08:00 计夜盘。看平仓盈亏发生在哪一盘。">
          {data?.session && <ReactECharts option={sessionOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
        <ChartCard title="多头 vs 空头" caption="卖平=平多头，买平=平空头。谁贡献利润一目了然。">
          {data?.longShort && <ReactECharts option={lsOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
      </div>

      <ChartCard title="持仓是否对冲" caption="对冲度 = 2×min(多市值,空市值)/(多+空)。接近 100% 几乎锁住；双开是同一合约既买又卖。">
        {(data?.hedge.length ?? 0) > 0 && <ReactECharts option={hedgeOption} style={{ height: 260, width: "100%" }} notMerge />}
      </ChartCard>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">品种明细</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">按平仓盈亏排序。胜率与持仓天数按手数加权。</p>
        </CardHeader>
        <CardContent className="pt-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left font-medium py-2 pr-3">品种</th>
                <th className="text-left font-medium py-2 pr-3">板块</th>
                <th className="text-right font-medium py-2 px-2">盈亏</th>
                <th className="text-right font-medium py-2 px-2">手数</th>
                <th className="text-right font-medium py-2 px-2">胜率</th>
                <th className="text-right font-medium py-2 px-2">盈亏比</th>
                <th className="text-right font-medium py-2 px-2">盈持仓</th>
                <th className="text-right font-medium py-2 pl-2">亏持仓</th>
              </tr>
            </thead>
            <tbody>
              {(data?.products ?? []).map((row) => (
                <tr key={row.code} className="border-b border-border/60">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{row.name}<span className="text-muted-foreground ml-1">{row.code}</span></td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{row.sector}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: pnlColor(row.pnl) }}>{fmtWan(row.pnl)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{row.lots.toFixed(0)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtPct(row.winRate, 0)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{row.profitFactor?.toFixed(2) ?? "—"}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{row.avgHoldWin?.toFixed(1) ?? "—"}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">{row.avgHoldLoss?.toFixed(1) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.products.length && !loading && (
            <p className="text-sm text-muted-foreground py-6 text-center">该区间没有平仓记录。</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Kpi({ title, value, hint, accent }: { title: string; value: string; hint?: string; accent?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>{value}</div>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function ChartCard({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">{caption}</p>
      </CardHeader>
      <CardContent className="pt-0">
        {children || <div className="h-[260px] flex items-center justify-center text-xs text-muted-foreground">暂无数据</div>}
      </CardContent>
    </Card>
  )
}
