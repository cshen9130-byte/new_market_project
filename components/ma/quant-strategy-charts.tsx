"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import ReactECharts from "echarts-for-react"
import { Columns2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { QUANT_ACCOUNT_IDS } from "@/lib/ma/quant-accounts"
import { buildCompareInsights, type CompareInsights } from "@/lib/ma/quant-strategy-compare"
import type { FactorFamily, HeatCell, RegimeFactors } from "@/lib/ma/quant-regime-factors"
import type { StrategyInference } from "@/lib/ma/quant-strategy-infer"
import type { FactorDmlReport } from "@/lib/ma/quant-factor-dml"
import { CHART_HELP, helpForFactor, QuantChartHelp, type ChartHelpSpec } from "@/components/ma/quant-strategy-help"
import { InferPanel } from "@/components/ma/quant-strategy-infer-panel"
import { FactorDmlPanel } from "@/components/ma/quant-factor-dml-panel"
import { readFactorSupport } from "@/lib/ma/quant-factor-reading"

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

const ALL_FROM = "2025-01-01"

const RANGES = [
  { label: "近一月", from: () => isoMonthOffset(-1), to: () => isoToday() },
  { label: "近三月", from: () => isoMonthOffset(-3), to: () => isoToday() },
  { label: "近六月", from: () => isoMonthOffset(-6), to: () => isoToday() },
  { label: "近一年", from: () => isoMonthOffset(-12), to: () => isoToday() },
  { label: "全部", from: () => ALL_FROM, to: () => isoToday() },
] as const

type RangeLabel = (typeof RANGES)[number]["label"]

function boundsFor(label: RangeLabel): { from: string; to: string } {
  const r = RANGES.find((x) => x.label === label) ?? RANGES[RANGES.length - 1]
  return { from: r.from(), to: r.to() }
}

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

const PALETTE = ["#3b82f6", "#ef4444", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#10b981"]

function accLabel(d: ApiData): string {
  const id = d.accountId || d.account || ""
  const digits = String(id).replace(/\D/g, "")
  return digits ? `rx${digits}` : "—"
}

function nightLotsShare(d: ApiData): number | null {
  const day = d.session?.day.lots ?? 0
  const night = d.session?.night.lots ?? 0
  if (day + night <= 0) return null
  return (night / (day + night)) * 100
}

function portraitDetail(d: ApiData, title: string): string {
  return d.portrait?.items.find((x) => x.title === title)?.detail ?? "—"
}

function bestSet(values: (number | null | undefined)[], mode: "max" | "min"): Set<number> {
  const finite = values
    .map((v, i) => ({ i, v }))
    .filter((x): x is { i: number; v: number } => x.v != null && Number.isFinite(x.v))
  if (finite.length < 2) return new Set()
  const nums = finite.map((x) => x.v)
  if (new Set(nums).size === 1) return new Set()
  const target = mode === "max" ? Math.max(...nums) : Math.min(...nums)
  return new Set(finite.filter((x) => x.v === target).map((x) => x.i))
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
    upCapture?: number | null
    downCapture?: number | null
  }
  portrait: { strategyLabel: string; summary: string; items: PortraitItem[] }
  equity: { date: string; pnl: number; cumPnl: number; equity: number; margin: number; riskPct: number; ddPct: number }[]
  regime: { key: string; label: string; pnl: number; days: number; winRate: number }[]
  regimeFactors?: RegimeFactors
  featureStability?: {
    window: number
    headline: string
    notes: string[]
    track: {
      date: string
      winRate: number | null
      payoff: number | null
      trades: number | null
      hold: number | null
      hedge: number | null
      corr: number | null
      sectorShare: number | null
    }[]
    regimes: {
      family: string
      familyLabel: string
      key: string
      label: string
      days: number
      winRate: number | null
      payoff: number | null
      trades: number | null
      hold: number | null
      hedge: number | null
      corr: number | null
      sectorShare: number | null
      topSector: string | null
    }[]
    conditions?: {
      key: string
      label: string
      days: number
      largestRisk: { sector: string | null; share: number | null }
      lowestRisk: { sector: string | null; share: number | null }
      profitSector: { sector: string | null; pnl: number | null }
      lossSector: { sector: string | null; pnl: number | null }
    }[]
    scatter?: {
      volSplit: number | null
      trendSplit?: number
      chopSplit?: number
      points: { dir: number; vol: number; trend?: number; chop?: number; pnl: number }[]
    }
  }
  sectors: { sector: string; pnl: number; lots: number; closePnl?: number; mtmPnl?: number }[]
  products: {
    code: string; name: string; sector: string; pnl: number; lots: number
    closePnl?: number; mtmPnl?: number
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
  longShort: {
    longPnl: number; shortPnl: number; longLots: number; shortLots: number
    longWinRate: number; shortWinRate: number
    longClosePnl?: number; shortClosePnl?: number; longMtm?: number; shortMtm?: number
  }
  inference?: StrategyInference
  factorDml?: FactorDmlReport
}

const TONE: Record<Tone, string> = {
  good: "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20",
  bad: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20",
  neutral: "border-border bg-muted/30",
}

const PeriodCtx = createContext("")

type VolClass = "高波" | "中波" | "低波"

function volClassOf(label: string | null | undefined): VolClass | null {
  if (!label) return null
  if (label.endsWith(" · 高波")) return "高波"
  if (label.endsWith(" · 中波")) return "中波"
  if (label.endsWith(" · 低波")) return "低波"
  return null
}

function labelWithoutVol(label: string): string {
  return label.replace(/ · [高中低]波$/, "")
}

const VOL_BADGE: Record<VolClass, string> = {
  高波: "bg-red-600 text-white",
  中波: "bg-amber-400 text-amber-950",
  低波: "bg-sky-700 text-white",
}

function VolBadge({ label, large = false }: { label: string | null | undefined; large?: boolean }) {
  const vol = volClassOf(label)
  if (!vol) return null
  return (
    <span className={`inline-flex items-center rounded-md font-semibold tracking-tight ${VOL_BADGE[vol]} ${large ? "px-3 py-1 text-2xl" : "px-1.5 py-0.5 text-xs"}`}>
      {vol}
    </span>
  )
}

function PeriodBadge({ className = "" }: { className?: string }) {
  const period = useContext(PeriodCtx)
  if (!period) return null
  return (
    <span className={`rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums shrink-0 ${className}`}>
      {period}
    </span>
  )
}

function axisPnl(v: number) {
  const abs = Math.abs(v)
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}万`
  return String(Math.round(v))
}

function familyBarOption(fam: FactorFamily) {
  const rows = fam.buckets.filter((b) => b.days > 0)
  if (!rows.length) return {}
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { name: string; value: number; dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0
        const r = rows[i]
        if (!r) return ""
        const t = r.tStat == null ? "—" : r.tStat.toFixed(2)
        return `${r.label}<br/>日均 ${fmtWan(r.avgPnl)}<br/>合计 ${fmtWan(r.pnl)}<br/>天数 ${r.days} · 日胜率 ${fmtPct(r.winRate)}<br/>t 统计 ${t}`
      },
    },
    grid: { left: 56, right: 12, top: 8, bottom: 36 },
    xAxis: { type: "category" as const, data: rows.map((r) => r.label), axisLabel: { fontSize: 10, rotate: rows.length > 4 ? 28 : 0 } },
    yAxis: { type: "value" as const, name: "日均", axisLabel: { fontSize: 10, formatter: axisPnl }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
    series: [{
      type: "bar" as const,
      data: rows.map((r) => ({ value: r.avgPnl, itemStyle: { color: r.avgPnl >= 0 ? UP : DOWN, borderRadius: [2, 2, 0, 0] } })),
      barMaxWidth: 28,
    }],
  }
}

function scatterFitOption(
  points: { x: number; y: number; label: string }[],
  buckets: { meanX: number; meanY: number; label: string; n: number }[],
  opts: {
    xName: string
    yName: string
    xFmt: (v: number) => string
    yFmt: (v: number) => string
    scatterName: string
  },
) {
  if (!points.length) return {}
  const line = [...buckets].sort((a, b) => a.meanX - b.meanX)
  return {
    tooltip: {
      formatter: (p: { seriesType?: string; data?: { value: number[]; label?: string; n?: number } }) => {
        const raw = p.data
        if (!raw?.value) return ""
        const [x, y] = raw.value
        if (p.seriesType === "line") {
          return `${raw.label ?? "分档"}<br/>${opts.xName} ${opts.xFmt(x)}<br/>均值 ${opts.yFmt(y)}<br/>n=${raw.n ?? "—"}`
        }
        return `${raw.label ?? ""}<br/>${opts.xName} ${opts.xFmt(x)}<br/>${opts.yName} ${opts.yFmt(y)}`
      },
    },
    grid: { left: 52, right: 16, top: 28, bottom: 40 },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    xAxis: {
      type: "value" as const,
      name: opts.xName,
      nameLocation: "middle" as const,
      nameGap: 28,
      axisLabel: { fontSize: 10, formatter: opts.xFmt },
      splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
    },
    yAxis: {
      type: "value" as const,
      name: opts.yName,
      axisLabel: { fontSize: 10, formatter: opts.yFmt },
      splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
    },
    series: [
      {
        name: opts.scatterName,
        type: "scatter" as const,
        symbolSize: 7,
        itemStyle: { color: BLUE, opacity: 0.45 },
        data: points.map((pt) => ({ value: [pt.x, pt.y], label: pt.label })),
      },
      {
        name: "分档均值",
        type: "line" as const,
        showSymbol: true,
        symbolSize: 9,
        lineStyle: { width: 2, color: UP },
        itemStyle: { color: UP },
        data: line.map((b) => ({ value: [b.meanX, b.meanY], label: b.label, n: b.n })),
      },
    ],
  }
}

function heatmapChartOption(cells: HeatCell[]) {
  const xLabels = [...new Set(cells.map((c) => c.carryLabel))]
  const yLabels = [...new Set(cells.map((c) => c.trendLabel))]
  const data = cells.map((c) => [xLabels.indexOf(c.carryLabel), yLabels.indexOf(c.trendLabel), c.avgPnl, c])
  const absMax = Math.max(1, ...cells.map((c) => Math.abs(c.avgPnl)))
  return {
    tooltip: {
      formatter: (p: { data?: { raw?: HeatCell } }) => {
        const c = p.data?.raw
        if (!c) return ""
        const t = c.tStat == null ? "—" : c.tStat.toFixed(2)
        return `${c.carryLabel} × ${c.trendLabel}<br/>日均 ${fmtWan(c.avgPnl)}<br/>合计 ${fmtWan(c.pnl)}<br/>天数 ${c.days} · 日胜率 ${fmtPct(c.winRate)}<br/>t 统计 ${t}`
      },
    },
    grid: { left: 88, right: 28, top: 8, bottom: 36 },
    xAxis: { type: "category" as const, data: xLabels, axisLabel: { fontSize: 10 } },
    yAxis: { type: "category" as const, data: yLabels, axisLabel: { fontSize: 10 } },
    visualMap: {
      min: -absMax,
      max: absMax,
      calculable: false,
      orient: "vertical" as const,
      right: 0,
      top: "middle",
      itemHeight: 80,
      text: ["赚", "亏"],
      inRange: { color: ["#10b981", "#f4f4f5", "#ef4444"] },
      textStyle: { fontSize: 10 },
    },
    series: [{
      type: "heatmap" as const,
      data: data.map(([x, y, v, c]) => ({
        value: [x, y, v],
        raw: c,
      })),
      label: {
        show: true,
        fontSize: 10,
        formatter: (p: { data: { raw: HeatCell } }) => {
          const c = p.data.raw
          if (!c || c.days < 1) return ""
          return `${fmtWan(c.avgPnl)}\n${c.days}日`
        },
      },
    }],
  }
}

export default function QuantStrategyCharts() {
  const [accountId, setAccountId] = useState("319")
  const [range, setRange] = useState<RangeLabel>("全部")
  const [{ from, to }, setBounds] = useState(() => boundsFor("全部"))
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(false)
  const [factorPending, setFactorPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compareMode, setCompareMode] = useState(false)
  const [compareRows, setCompareRows] = useState<ApiData[]>([])
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareBounds, setCompareBounds] = useState<{ from: string; to: string } | null>(null)
  const loadSeq = useRef(0)
  const compareSeq = useRef(0)
  const shownRef = useRef<ApiData | null>(null)

  const load = useCallback(async (nextAccount: string, nextFrom: string, nextTo: string) => {
    const reqId = ++loadSeq.current
    setLoading(true)
    setFactorPending(false)
    setError(null)
    const shown = shownRef.current
    if (shown?.from !== nextFrom || shown?.to !== nextTo || String(shown?.accountId ?? "") !== String(nextAccount)) {
      shownRef.current = null
      setData(null)
    }
    try {
      const core = new URLSearchParams({ account: nextAccount, from: nextFrom, to: nextTo, scope: "core" })
      const res = await fetch(`/ma/api/mom-analysis/quant-strategy?${core}`, { cache: "no-store" })
      const json = await res.json()
      if (reqId !== loadSeq.current) return
      if (!res.ok || !json.ok) throw new Error(json.error || "请求失败")
      const next = json as ApiData
      shownRef.current = next
      setData(next)
    } catch (e) {
      if (reqId !== loadSeq.current) return
      setError(e instanceof Error ? e.message : "加载失败")
      setLoading(false)
      return
    }
    if (reqId !== loadSeq.current) return
    setLoading(false)
    setFactorPending(true)
    try {
      const full = new URLSearchParams({ account: nextAccount, from: nextFrom, to: nextTo })
      const res = await fetch(`/ma/api/mom-analysis/quant-strategy?${full}`, { cache: "no-store" })
      const json = await res.json()
      if (reqId !== loadSeq.current) return
      if (!res.ok || !json.ok) return
      const next = json as ApiData
      shownRef.current = next
      setData(next)
    } catch {
      if (reqId !== loadSeq.current) return
    } finally {
      if (reqId === loadSeq.current) setFactorPending(false)
    }
  }, [])

  useEffect(() => {
    if (compareMode) return
    void load(accountId, from, to)
  }, [accountId, from, to, load, compareMode])

  const loadCompare = useCallback(async (nextFrom = from, nextTo = to) => {
    const reqId = ++compareSeq.current
    setCompareLoading(true)
    setCompareError(null)
    try {
      const settled = await Promise.allSettled(
        QUANT_ACCOUNT_IDS.map(async (id) => {
          const params = new URLSearchParams({ account: String(id), from: nextFrom, to: nextTo, scope: "core" })
          const res = await fetch(`/ma/api/mom-analysis/quant-strategy?${params}`, { cache: "no-store" })
          const json = await res.json()
          if (!res.ok || !json.ok) throw new Error(json.error || `rx${id} 请求失败`)
          return json as ApiData
        }),
      )
      if (reqId !== compareSeq.current) return
      const ok: ApiData[] = []
      const failed: string[] = []
      settled.forEach((s, i) => {
        if (s.status === "fulfilled" && !s.value.notYetRun) ok.push(s.value)
        else failed.push(`rx${QUANT_ACCOUNT_IDS[i]}`)
      })
      setCompareRows(ok)
      setCompareBounds({ from: nextFrom, to: nextTo })
      if (!ok.length) setCompareError(failed.length ? `${failed.join("、")} 加载失败` : "没有可对比的账户")
      else setCompareError(failed.length ? `${failed.join("、")} 暂无数据，已对照其余账户` : null)
    } catch (e) {
      if (reqId !== compareSeq.current) return
      setCompareError(e instanceof Error ? e.message : "对比加载失败")
    } finally {
      if (reqId === compareSeq.current) setCompareLoading(false)
    }
  }, [from, to])

  const selectAccount = (id: string) => {
    setCompareMode(false)
    setAccountId(id)
  }

  const selectRange = (label: RangeLabel) => {
    const next = boundsFor(label)
    setRange(label)
    setBounds(next)
    if (compareMode) void loadCompare(next.from, next.to)
  }

  const toggleCompare = () => {
    if (compareMode) {
      setCompareMode(false)
      return
    }
    setCompareMode(true)
    if (!compareBounds || compareBounds.from !== from || compareBounds.to !== to || !compareRows.length) {
      void loadCompare(from, to)
    }
  }

  const viewKey = `${accountId}|${from}|${to}|${data?.from ?? ""}|${data?.to ?? ""}`
  const periodFrom = compareMode
    ? (compareRows[0]?.from ?? compareBounds?.from ?? from)
    : (data?.from ?? from)
  const periodTo = compareMode
    ? (compareRows[0]?.to ?? compareBounds?.to ?? to)
    : (data?.to ?? to)
  const periodText = `${range} · ${periodFrom} 至 ${periodTo}`

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

  const factorFamilies = data?.regimeFactors?.families ?? []
  const heatmapCells = data?.regimeFactors?.heatmap ?? []
  const heatmapOption = useMemo(() => heatmapChartOption(heatmapCells), [heatmapCells])

  const bookVolOption = useMemo(() => {
    const ch = data?.inference?.charts?.bookVol
    if (!ch?.points.length) return {}
    return scatterFitOption(
      ch.points.map((p) => ({ x: p.mktVol, y: p.leverage, label: p.date })),
      ch.buckets,
      {
        scatterName: "交易日",
        xName: "市场波动 %",
        yName: "总敞口",
        xFmt: (v) => `${v.toFixed(0)}%`,
        yFmt: (v) => `${v.toFixed(2)}x`,
      },
    )
  }, [data?.inference?.charts?.bookVol])

  const crossVolOption = useMemo(() => {
    const ch = data?.inference?.charts?.crossVol
    if (!ch?.points.length) return {}
    return scatterFitOption(
      ch.points.map((p) => ({ x: p.vol, y: p.weight, label: p.product })),
      ch.buckets,
      {
        scatterName: "品种日",
        xName: "品种波动 %",
        yName: "市值权重 %",
        xFmt: (v) => `${v.toFixed(0)}%`,
        yFmt: (v) => `${v.toFixed(1)}%`,
      },
    )
  }, [data?.inference?.charts?.crossVol])

  const sectorOption = useMemo(() => {
    const rows = [...(data?.sectors ?? [])].sort((a, b) => a.pnl - b.pnl)
    if (!rows.length) return {}
    return {
      tooltip: {
        trigger: "axis",
        formatter: (ps: { name: string; value: number }[]) => {
          const r = rows.find((x) => x.sector === ps[0]?.name)
          if (!r) return `${ps[0]?.name ?? ""} ${fmtWan(ps[0]?.value)}`
          const close = r.closePnl ?? 0
          const mtm = r.mtmPnl ?? 0
          return `${r.sector}<br/>合计 ${fmtWan(r.pnl)}<br/>平仓 ${fmtWan(close)}<br/>盯市 ${fmtWan(mtm)}`
        },
      },
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

  const stability = data?.featureStability
  const stabilityDates = stability?.track.map((p) => p.date.slice(5)) ?? []
  const stabilityOption = useMemo(() => {
    const rows = stability?.track ?? []
    if (!rows.length) return {}
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 44, top: 32, bottom: 28 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 4, textStyle: { fontSize: 9 } }],
      xAxis: { type: "category", data: stabilityDates, axisLabel: { fontSize: 10 } },
      yAxis: [
        { type: "value", name: "胜率%", min: 0, max: 100, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
        { type: "value", name: "盈亏比", axisLabel: { fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        { name: "胜率", type: "line", showSymbol: false, yAxisIndex: 0, data: rows.map((r) => r.winRate), lineStyle: { width: 2, color: UP }, itemStyle: { color: UP } },
        { name: "盈亏比", type: "line", showSymbol: false, yAxisIndex: 1, data: rows.map((r) => r.payoff), lineStyle: { width: 2, color: BLUE }, itemStyle: { color: BLUE } },
      ],
    }
  }, [stability, stabilityDates])
  const postureOption = useMemo(() => {
    const rows = stability?.track ?? []
    if (!rows.length) return {}
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 44, top: 32, bottom: 28 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 4, textStyle: { fontSize: 9 } }],
      xAxis: { type: "category", data: stabilityDates, axisLabel: { fontSize: 10 } },
      yAxis: [
        { type: "value", name: "%", axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
        { type: "value", name: "相关", min: -1, max: 1, axisLabel: { fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        { name: "对冲度", type: "line", showSymbol: false, data: rows.map((r) => r.hedge), lineStyle: { width: 2, color: BLUE }, itemStyle: { color: BLUE } },
        { name: "风险贡献占比", type: "line", showSymbol: false, data: rows.map((r) => r.sectorShare), lineStyle: { width: 1.5, color: AMBER }, itemStyle: { color: AMBER } },
        { name: "南华相关", type: "line", showSymbol: false, yAxisIndex: 1, data: rows.map((r) => r.corr), lineStyle: { width: 1.5, color: DOWN }, itemStyle: { color: DOWN } },
      ],
    }
  }, [stability, stabilityDates])
  const activityOption = useMemo(() => {
    const rows = stability?.track ?? []
    if (!rows.length) return {}
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 44, top: 32, bottom: 28 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 4, textStyle: { fontSize: 9 } }],
      xAxis: { type: "category", data: stabilityDates, axisLabel: { fontSize: 10 } },
      yAxis: [
        { type: "value", name: "天", axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
        { type: "value", name: "手/日", axisLabel: { fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        { name: "持有天数", type: "line", showSymbol: false, data: rows.map((r) => r.hold), lineStyle: { width: 2, color: UP }, itemStyle: { color: UP } },
        { name: "日均开平手数", type: "line", showSymbol: false, yAxisIndex: 1, data: rows.map((r) => r.trades), lineStyle: { width: 1.5, color: BLUE }, itemStyle: { color: BLUE } },
      ],
    }
  }, [stability, stabilityDates])
  const regimeFeatureOption = useMemo(() => {
    const rows = stability?.regimes ?? []
    if (!rows.length) return {}
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 44, top: 32, bottom: 48 },
      xAxis: { type: "category", data: rows.map((r) => `${r.label}\n${r.days}天`), axisLabel: { fontSize: 10, interval: 0 } },
      yAxis: [
        { type: "value", name: "胜率%", min: 0, max: 100, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } } },
        { type: "value", name: "盈亏比", axisLabel: { fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        { name: "胜率", type: "bar", barMaxWidth: 22, data: rows.map((r) => r.winRate), itemStyle: { color: UP } },
        { name: "盈亏比", type: "line", yAxisIndex: 1, data: rows.map((r) => r.payoff), lineStyle: { width: 2, color: BLUE }, itemStyle: { color: BLUE } },
      ],
    }
  }, [stability])
  const marketScatters = useMemo(() => {
    const pts = stability?.scatter?.points ?? []
    const spec = [
      { key: "vol", yName: "市场低波动 → 市场高波动", yOf: (p: { vol: number }) => p.vol, split: stability?.scatter?.volSplit ?? null, splitLabel: "以上为市场高波动", yTip: "年化波动" },
      { key: "trend", yName: "弱趋势 → 市场趋势", yOf: (p: { trend?: number }) => p.trend ?? null, split: stability?.scatter?.trendSplit ?? null, splitLabel: "以上为市场趋势", yTip: "趋势效率" },
      { key: "chop", yName: "弱震荡 → 市场震荡", yOf: (p: { chop?: number }) => p.chop ?? null, split: stability?.scatter?.chopSplit ?? null, splitLabel: "以上为市场震荡", yTip: "来回程度" },
    ] as const
    return spec.map((item) => {
      const win = pts.filter((p) => p.pnl > 0 && item.yOf(p) != null).map((p) => [p.dir, item.yOf(p)])
      const loss = pts.filter((p) => p.pnl < 0 && item.yOf(p) != null).map((p) => [p.dir, item.yOf(p)])
      if (!win.length && !loss.length) return { key: item.key, option: null }
      return {
        key: item.key,
        option: {
          tooltip: {
            trigger: "item" as const,
            formatter: (p: { seriesName?: string; value?: number[] }) => {
              const v = p.value ?? []
              return `${p.seriesName ?? ""}<br/>南华20日 ${v[0]?.toFixed(1) ?? "—"}%<br/>${item.yTip} ${v[1]?.toFixed(1) ?? "—"}%`
            },
          },
          legend: { top: 0, right: 0, textStyle: { fontSize: 11 } },
          grid: { left: 64, right: 16, top: 28, bottom: 40 },
          xAxis: {
            type: "value" as const,
            name: "市场下跌  ←    市场上涨",
            nameLocation: "middle" as const,
            nameGap: 26,
            nameTextStyle: { fontSize: 11 },
            axisLabel: { fontSize: 10, formatter: (v: number) => `${v}%` },
            splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
          },
          yAxis: {
            type: "value" as const,
            name: item.yName,
            nameLocation: "middle" as const,
            nameGap: 42,
            nameRotate: 90,
            nameTextStyle: { fontSize: 11 },
            axisLabel: { fontSize: 10, formatter: (v: number) => `${v}%` },
            splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
          },
          series: [
            {
              name: "盈利",
              type: "scatter" as const,
              data: win,
              symbolSize: 8,
              itemStyle: { color: UP },
              markLine: item.split == null ? undefined : {
                silent: true,
                symbol: "none",
                lineStyle: { type: "dashed" as const, color: "#94a3b8" },
                data: [{ yAxis: item.split, label: { formatter: item.splitLabel, fontSize: 10, position: "insideStartTop" } }],
              },
            },
            { name: "亏损", type: "scatter" as const, data: loss, symbolSize: 8, itemStyle: { color: DOWN } },
          ],
        },
      }
    })
  }, [stability])

  const lsOption = useMemo(() => {
    const ls = data?.longShort
    if (!ls) return {}
    return {
      tooltip: {
        trigger: "axis",
        formatter: () => {
          const closeL = ls.longClosePnl ?? 0
          const closeS = ls.shortClosePnl ?? 0
          const mtmL = ls.longMtm ?? 0
          const mtmS = ls.shortMtm ?? 0
          return [
            `多头合计 ${fmtWan(ls.longPnl)}（平仓 ${fmtWan(closeL)} / 盯市 ${fmtWan(mtmL)}）`,
            `空头合计 ${fmtWan(ls.shortPnl)}（平仓 ${fmtWan(closeS)} / 盯市 ${fmtWan(mtmS)}）`,
          ].join("<br/>")
        },
      },
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
            {compareMode
              ? "同一区间下横向对照各量化账户的策略画像、绩效与权益曲线。点击账户进入单账户详情。"
              : "选择量化账户，用成交、平仓与日核算倒推策略画像：适合什么市、怎么管风险、盈亏偏好、是否对冲、日盘还是夜盘、盈亏单持仓多久。"}
          </p>
          {!compareMode && data?.account && (
            <p className="text-xs text-muted-foreground mt-1">
              {data.account} · {data.from} 至 {data.to} · {k?.tradingDays ?? 0} 个交易日 · {k?.nCloses ?? 0} 笔平仓
            </p>
          )}
          {compareMode && (compareRows[0]?.from || from) && (
            <p className="text-xs text-muted-foreground mt-1">
              {compareRows[0]?.from ?? from} 至 {compareRows[0]?.to ?? to} · {compareRows.length} 个量化账户
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={compareMode ? "default" : "outline"} onClick={toggleCompare} disabled={compareLoading}>
            <Columns2 className="h-3.5 w-3.5 mr-1.5" />
            {compareMode ? "退出对比" : "横向对比"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void (compareMode ? loadCompare() : load(accountId, from, to))}
            disabled={compareMode ? compareLoading : loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${(compareMode ? compareLoading : loading) ? "animate-spin" : ""}`} />
            {(compareMode ? compareLoading : loading) ? "加载中" : "刷新"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">账户</span>
        {ids.map((id) => {
          const active = !compareMode && String(id) === accountId
          return (
            <button
              key={id}
              onClick={() => selectAccount(String(id))}
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
              onClick={() => selectRange(r.label)}
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

      {error && !compareMode && <p className="text-sm text-destructive">{error}</p>}
      {compareError && compareMode && (
        <p className={`text-sm ${compareRows.length ? "text-muted-foreground" : "text-destructive"}`}>{compareError}</p>
      )}
      {data?.notYetRun && !compareMode && <p className="text-sm text-muted-foreground">核算表尚未导入。</p>}

      <PeriodCtx.Provider value={periodText}>
      {compareMode ? (
        <CompareView rows={compareRows} loading={compareLoading} onOpenAccount={selectAccount} />
      ) : (
      <div key={viewKey} className={`space-y-5 ${loading ? "opacity-60 pointer-events-none" : ""}`}>
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <VolBadge label={data?.portrait.strategyLabel} large />
          <h2 className="text-lg font-semibold tracking-tight">{data?.portrait.strategyLabel ? labelWithoutVol(data.portrait.strategyLabel) : (loading ? "分析中…" : "—")}</h2>
          <PeriodBadge />
          {k?.corrNhci != null && (
            <span className="text-xs text-muted-foreground">南华相关 {k.corrNhci}</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{data?.portrait.summary}</p>
        {data?.factorDml && data.portrait?.strategyLabel && (
          <p className="text-sm leading-relaxed">{readFactorSupport(data.factorDml, data.portrait.strategyLabel)?.portrait}</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {(data?.portrait.items ?? []).map((item) => (
            <div key={`${viewKey}-${item.title}`} className={`rounded-md border px-3 py-2.5 ${TONE[item.tone]}`}>
              <div className="text-xs font-medium mb-1">{item.title}</div>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.detail}</p>
            </div>
          ))}
          {!(data?.portrait.items ?? []).length && (
            <p className="text-xs text-muted-foreground py-2">
              {loading ? "正在按所选区间重算擅长、板块盈亏和图表…" : "该区间没有画像。"}
            </p>
          )}
        </div>
      </div>

      {stability && stability.track.length > 0 && (
        <div className="space-y-4">
          {(stability.conditions?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-border p-4 space-y-2">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium"> </th>
                      {stability.conditions!.map((col) => (
                        <th key={col.key} className="py-1.5 pr-3 font-medium">{col.label}<span className="block font-normal">{col.days} 天</span></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      ["风险贡献最大板块", (col: NonNullable<typeof stability.conditions>[number]) => col.largestRisk.sector ? `${col.largestRisk.sector} ${col.largestRisk.share?.toFixed(0) ?? ""}%` : "—"],
                      ["风险贡献最小板块", (col: NonNullable<typeof stability.conditions>[number]) => col.lowestRisk.sector ? `${col.lowestRisk.sector} ${col.lowestRisk.share?.toFixed(0) ?? ""}%` : "—"],
                      ["盈利板块", (col: NonNullable<typeof stability.conditions>[number]) => col.profitSector.sector ? `${col.profitSector.sector} ${fmtWan(col.profitSector.pnl)}` : "—"],
                      ["亏损板块", (col: NonNullable<typeof stability.conditions>[number]) => col.lossSector.sector ? `${col.lossSector.sector} ${fmtWan(col.lossSector.pnl)}` : "—"],
                    ] as const).map(([label, cell]) => (
                      <tr key={label} className="border-b border-border/60">
                        <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{label}</td>
                        {stability.conditions!.map((col) => (
                          <td key={col.key} className="py-1.5 pr-3">{cell(col)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">市场高波动、市场低波动按南华 20 日波动相对这段样本的中位数。市场上涨、市场下跌按南华 20 日收益方向。这是市场状态，不是账户自己的高波、中波、低波。风险贡献是该板块占组合方差的比例。盈亏是这些日子里平仓盈亏加持仓盯市。</p>
              </div>
              <div>
                <p className="text-xs font-medium mb-1">当日盈亏在市场状态里的位置</p>
                <p className="text-[11px] text-muted-foreground mb-1">横轴都是南华 20 日涨跌。红点是当天盈利，绿点是当天亏损。上面纵轴是波动，下面两张分别是趋势效率和来回程度。趋势效率 = 20 日净位移 / 路径长度，35% 以上算市场趋势；来回程度是它的补数，65% 以上算市场震荡。</p>
                {marketScatters.filter((chart) => chart.key === "vol" && chart.option).map((chart) => (
                  <ReactECharts key={`${viewKey}-mkt-${chart.key}`} option={chart.option} style={{ height: 280, width: "100%" }} notMerge />
                ))}
              </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {marketScatters.filter((chart) => chart.key !== "vol" && chart.option).map((chart) => (
                  <ReactECharts key={`${viewKey}-mkt-${chart.key}`} option={chart.option} style={{ height: 280, width: "100%" }} notMerge />
                ))}
              </div>
          </div>
          )}
          <div className="rounded-lg border border-border p-4 space-y-2">
            <h3 className="text-sm font-medium">特征是否稳</h3>
            <p className="text-sm leading-relaxed">{stability.headline}</p>
            {stability.notes.map((note) => (
              <p key={note.slice(0, 24)} className="text-sm text-muted-foreground leading-relaxed">{note}</p>
            ))}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard title="胜率与盈亏比" caption={`每 ${stability.window} 个交易日滚一次。两条线反向走，就是全样本平均看不出来的风格切换。`}>
              <ReactECharts key={`${viewKey}-stab-wp`} option={stabilityOption} style={{ height: 280, width: "100%" }} notMerge />
            </ChartCard>
            <ChartCard title="不同市况下的胜率与盈亏比" caption="趋势/震荡按南华 5、20、60 日是否同向。南华上行按 20 日收益符号。波动按 20 日波动相对这段样本的中位数。">
              <ReactECharts key={`${viewKey}-stab-rg`} option={regimeFeatureOption} style={{ height: 280, width: "100%" }} notMerge />
            </ChartCard>
            <ChartCard title="对冲、风险贡献和南华相关" caption="板块线是风险贡献最大的板块占组合方差的比例，不是持仓市值。国债市值可以很大，波动低，贡献就小。南华相关是这 20 天里日盈亏和南华日收益的相关。">
              <ReactECharts key={`${viewKey}-stab-hd`} option={postureOption} style={{ height: 280, width: "100%" }} notMerge />
            </ChartCard>
            <ChartCard title="持有天数和交易频率" caption="持有天数按平仓手数加权。频率是这段窗口里每天的开仓手数加平仓手数。">
              <ReactECharts key={`${viewKey}-stab-ac`} option={activityOption} style={{ height: 280, width: "100%" }} notMerge />
            </ChartCard>
          </div>
        </div>
      )}

      {data?.inference && (
        <InferPanel
          inference={data.inference}
          period={periodText}
          factorNote={data.factorDml && data.portrait?.strategyLabel
            ? readFactorSupport(data.factorDml, data.portrait.strategyLabel)?.inference
            : undefined}
        />
      )}

      {(data?.inference?.charts?.bookVol || data?.inference?.charts?.crossVol) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title="组合层：市场波动 vs 总敞口"
            caption={`${data.inference.charts.bookVol?.mktName ?? "市场波动"}。ρ=${data.inference.charts.bookVol?.rho == null ? "—" : data.inference.charts.bookVol.rho.toFixed(2)}（n=${data.inference.charts.bookVol?.n ?? 0}）。点往右下=市场更吵时减仓；往右上=扛仓/加仓。`}
            help={CHART_HELP.bookVol}
          >
            {(data.inference.charts.bookVol?.points.length ?? 0) > 0 && (
              <ReactECharts key={`${viewKey}-bookvol`} option={bookVolOption} style={{ height: 280, width: "100%" }} notMerge />
            )}
          </ChartCard>
          <ChartCard
            title="截面：品种波动 vs 市值权重"
            caption={`同一天里高波动品种是否少配。ρ(权重, 1/σ)=${data.inference.charts.crossVol?.rho == null ? "—" : data.inference.charts.crossVol.rho.toFixed(2)}（n=${data.inference.charts.crossVol?.n ?? 0} 个品种日）。折线往右下=品种层风险平价。`}
            help={CHART_HELP.crossVol}
          >
            {(data.inference.charts.crossVol?.points.length ?? 0) > 0 && (
              <ReactECharts key={`${viewKey}-crossvol`} option={crossVolOption} style={{ height: 280, width: "100%" }} notMerge />
            )}
          </ChartCard>
        </div>
      )}

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
        <Kpi
          title="南华涨 / 跌捕获"
          value={`${k?.upCapture == null ? "—" : k.upCapture.toFixed(2)} / ${k?.downCapture == null ? "—" : k.downCapture.toFixed(2)}`}
          hint="账户日收益 / 南华日收益，涨日与跌日分开"
          help={CHART_HELP.capture}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="累计盈亏与回撤" caption="权益曲线形态：趋势跟踪通常回撤深、恢复慢；短线更碎。" help={CHART_HELP.equity}>
          {eq.length > 0 && <ReactECharts key={`${viewKey}-eq`} option={equityOption} style={{ height: 280, width: "100%" }} notMerge />}
        </ChartCard>
        <ChartCard title="日盈亏分布" caption="柱子偏左=经常小亏；右尾长=偶尔大赢。和胜率/盈亏比对照看。" help={CHART_HELP.hist}>
          {eq.length > 0 && <ReactECharts key={`${viewKey}-hist`} option={histOption} style={{ height: 280, width: "100%" }} notMerge />}
        </ChartCard>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-medium">哪种市场赚得多</h2>
            <QuantChartHelp spec={CHART_HELP.overview} />
          </div>
          <PeriodBadge />
        </div>
        <p className="text-xs text-muted-foreground">
          柱高是日均盈亏，不是区间合计。Tooltip 里有天数、合计、日胜率和 t 统计。旧的「趋势 / 波动」两刀切已换成 carry、多周期趋势、价仓和宏观簇。
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {factorFamilies.map((fam) => (
            <ChartCard key={`${viewKey}-${fam.key}`} title={fam.title} caption={fam.caption} help={helpForFactor(fam.key, fam.title)}>
              <ReactECharts key={`${viewKey}-${fam.key}`} option={familyBarOption(fam)} style={{ height: 260, width: "100%" }} notMerge />
            </ChartCard>
          ))}
          <ChartCard title="板块盈亏" caption="盈亏 = 平仓盈亏 + 持仓盯市（未扣手续费）。只看平仓会把「拿着赚、换仓亏」画成全板块亏损；区间净盈亏来自日报，会再扣手续费。" help={CHART_HELP.sector}>
            {(data?.sectors?.length ?? 0) > 0 && <ReactECharts key={`${viewKey}-sector`} option={sectorOption} style={{ height: 260, width: "100%" }} notMerge />}
          </ChartCard>
        </div>
        {heatmapCells.some((c) => c.days > 0) && (
          <ChartCard title="Carry × 趋势一致性" caption="贴水/升水与 5/20/60 日趋势是否同向。只在「贴水 × 同向多」赚钱是展期+多头；两边趋势都赚才是双边跟踪。" help={CHART_HELP.heatmap}>
            <ReactECharts key={`${viewKey}-heat`} option={heatmapOption} style={{ height: 320, width: "100%" }} notMerge />
          </ChartCard>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="风险度" caption="杠杆用到什么水平、是否突然抬升。" help={CHART_HELP.risk}>
          {eq.length > 0 && <ReactECharts key={`${viewKey}-risk`} option={riskOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
        <ChartCard
          title="赚了 / 亏了之后第二天"
          caption={`盈利日 n=${data?.afterMove?.afterWin.n ?? 0}，亏损日 n=${data?.afterMove?.afterLoss.n ?? 0}。风险度下降=收手；开仓占比高=还在加。`}
          help={CHART_HELP.after}
        >
          {data?.afterMove && <ReactECharts key={`${viewKey}-after`} option={afterOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="盈亏偏好"
          caption={`平仓胜率 ${fmtPct(p?.winRate, 0)}，盈亏比 ${p?.profitFactor?.toFixed(2) ?? "—"}。高胜率低柱差=刮头皮；低胜率但盈利柱远高于亏损柱=趋势。`}
          help={CHART_HELP.payoff}
        >
          {p && <ReactECharts key={`${viewKey}-payoff`} option={payoffOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
        <ChartCard
          title="持仓多久才走"
          caption={`盈利单 ${data?.hold?.avgWin?.toFixed(1) ?? "—"} 天，亏损单 ${data?.hold?.avgLoss?.toFixed(1) ?? "—"} 天。亏的比赚的拿得久 = 扛单。`}
          help={CHART_HELP.hold}
        >
          {(data?.hold?.buckets.length ?? 0) > 0 && <ReactECharts key={`${viewKey}-hold`} option={holdOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="日盘 vs 夜盘" caption="按成交时间：21:00–08:00 计夜盘。看平仓盈亏发生在哪一盘。" help={CHART_HELP.session}>
          {data?.session && <ReactECharts key={`${viewKey}-session`} option={sessionOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
        <ChartCard title="多头 vs 空头" caption="卖平=平多头，买平=平空头；再加持仓盯市。钱经常是拿着赚的，平仓只是换仓成本。" help={CHART_HELP.ls}>
          {data?.longShort && <ReactECharts key={`${viewKey}-ls`} option={lsOption} style={{ height: 260, width: "100%" }} notMerge />}
        </ChartCard>
      </div>

      <ChartCard title="持仓是否对冲" caption="对冲度 = 2×min(多市值,空市值)/(多+空)。接近 100% 几乎锁住；双开是同一合约既买又卖。" help={CHART_HELP.hedge}>
        {(data?.hedge?.length ?? 0) > 0 && <ReactECharts key={`${viewKey}-hedge`} option={hedgeOption} style={{ height: 260, width: "100%" }} notMerge />}
      </ChartCard>

      {factorPending && !data?.factorDml && (
        <p className="text-sm text-muted-foreground">因子推断计算中，上面的结论先出来。</p>
      )}
      {data?.factorDml && <FactorDmlPanel report={data.factorDml} period={periodText} />}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-sm font-medium">品种明细</CardTitle>
              <QuantChartHelp spec={CHART_HELP.products} />
            </div>
            <PeriodBadge />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">按合计盈亏（平仓 + 盯市）排序。胜率与持仓天数仍按平仓手数加权。</p>
        </CardHeader>
        <CardContent className="pt-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left font-medium py-2 pr-3">品种</th>
                <th className="text-left font-medium py-2 pr-3">板块</th>
                <th className="text-right font-medium py-2 px-2">合计</th>
                <th className="text-right font-medium py-2 px-2">平仓</th>
                <th className="text-right font-medium py-2 px-2">盯市</th>
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
                  <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: pnlColor(row.closePnl ?? 0) }}>{fmtWan(row.closePnl ?? 0)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: pnlColor(row.mtmPnl ?? 0) }}>{fmtWan(row.mtmPnl ?? 0)}</td>
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
      )}
      </PeriodCtx.Provider>
    </div>
  )
}

function Kpi({
  title,
  value,
  hint,
  accent,
  help,
}: {
  title: string
  value: string
  hint?: string
  accent?: string
  help?: ChartHelpSpec
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center gap-1">
          <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
          {help && <QuantChartHelp spec={help} />}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>{value}</div>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function ChartCard({
  title,
  caption,
  help,
  children,
}: {
  title: string
  caption: string
  help?: ChartHelpSpec
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            {help && <QuantChartHelp spec={help} />}
          </div>
          <PeriodBadge />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{caption}</p>
      </CardHeader>
      <CardContent className="pt-0">
        {children || <div className="h-[260px] flex items-center justify-center text-xs text-muted-foreground">暂无数据</div>}
      </CardContent>
    </Card>
  )
}

const PORTRAIT_COMPARE_TITLES = [
  "适合的市场",
  "不适合的市场",
  "亏损之后",
  "盈利之后",
  "盈亏偏好",
  "对冲程度",
  "持仓习惯",
  "多空",
  "擅长",
  "不擅长",
] as const

const MARKET_COLS = [
  { key: "volHigh", label: "市场高波动" },
  { key: "volLow", label: "市场低波动" },
  { key: "nhUp", label: "市场上涨" },
  { key: "nhDown", label: "市场下跌" },
] as const

type MarketCell = { sector: string | null; metric: number | null }

function marketHeatmap(
  rows: ApiData[],
  pick: (c: NonNullable<NonNullable<ApiData["featureStability"]>["conditions"]>[number]) => MarketCell,
  mode: "pnl" | "share",
) {
  const accounts = rows.map((r) => accLabel(r))
  const data: { value: [number, number, number]; sector: string }[] = []
  let lo = 0
  let hi = 0
  rows.forEach((r, yi) => {
    for (let xi = 0; xi < MARKET_COLS.length; xi++) {
      const col = MARKET_COLS[xi]!
      const cell = r.featureStability?.conditions?.find((c) => c.key === col.key)
      if (!cell) continue
      const picked = pick(cell)
      if (picked.metric == null || !picked.sector) continue
      data.push({ value: [xi, yi, picked.metric], sector: picked.sector })
      lo = Math.min(lo, picked.metric)
      hi = Math.max(hi, picked.metric)
    }
  })
  if (!data.length) return null
  const bound = mode === "pnl" ? Math.max(Math.abs(lo), Math.abs(hi), 1) : 100
  return {
    tooltip: {
      formatter: (p: { data?: { sector?: string; value?: number[] } }) => {
        const sector = p.data?.sector ?? "—"
        const v = p.data?.value?.[2]
        const metric = mode === "pnl" ? fmtWan(v) : v == null ? "—" : `${v.toFixed(0)}%`
        return `${sector}<br/>${metric}`
      },
    },
    grid: { left: 56, right: 16, top: 8, bottom: 52 },
    xAxis: { type: "category" as const, data: MARKET_COLS.map((c) => c.label), axisLabel: { fontSize: 11 }, splitArea: { show: true } },
    yAxis: { type: "category" as const, data: accounts, axisLabel: { fontSize: 11 }, splitArea: { show: true } },
    visualMap: {
      min: mode === "pnl" ? -bound : 0,
      max: bound,
      calculable: false,
      orient: "horizontal" as const,
      left: "center",
      bottom: 0,
      itemWidth: 12,
      itemHeight: 80,
      text: mode === "pnl" ? ["盈", "亏"] : ["占比高", "占比低"],
      textStyle: { fontSize: 10 },
      inRange: { color: mode === "pnl" ? [DOWN, "#f5f5f4", UP] : ["#e0f2fe", "#0369a1"] },
    },
    series: [{
      type: "heatmap" as const,
      data,
      label: {
        show: true,
        fontSize: 10,
        color: "#111827",
        formatter: (p: { data?: { sector?: string; value?: number[] } }) => {
          const sector = p.data?.sector ?? "—"
          const v = p.data?.value?.[2]
          const metric = mode === "pnl" ? fmtWan(v) : v == null ? "" : `${v.toFixed(0)}%`
          return `${sector}\n${metric}`
        },
      },
      emphasis: { itemStyle: { shadowBlur: 6 } },
    }],
  }
}

function CompareView({
  rows,
  loading,
  onOpenAccount,
}: {
  rows: ApiData[]
  loading: boolean
  onOpenAccount: (id: string) => void
}) {
  const overlayOption = useMemo(() => {
    const dateSet = new Set<string>()
    for (const r of rows) for (const e of r.equity ?? []) dateSet.add(e.date)
    const dates = [...dateSet].sort()
    if (!dates.length) return {}
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, type: "scroll", textStyle: { fontSize: 11 } },
      grid: { left: 56, right: 16, top: 28, bottom: 28 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 4, textStyle: { fontSize: 9 } }],
      xAxis: { type: "category", data: dates.map((d) => d.slice(5)), axisLabel: { fontSize: 10 } },
      yAxis: {
        type: "value",
        name: "累计盈亏",
        axisLabel: { fontSize: 10, formatter: axisPnl },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
      },
      series: rows.map((r, i) => {
        const map = new Map((r.equity ?? []).map((e) => [e.date, e.cumPnl]))
        return {
          name: `${accLabel(r)} ${r.portrait?.strategyLabel ?? ""}`.trim(),
          type: "line",
          showSymbol: false,
          data: dates.map((d) => map.get(d) ?? null),
          connectNulls: true,
          lineStyle: { width: 2, color: PALETTE[i % PALETTE.length] },
          itemStyle: { color: PALETTE[i % PALETTE.length] },
        }
      }),
    }
  }, [rows])

  const compareFamilies = useMemo(() => {
    const keys = ["carry", "trend", "oi", "cluster", "volLvl"]
    return keys
      .map((key) => {
        const title = rows.map((r) => r.regimeFactors?.families.find((f) => f.key === key)).find((f) => f)?.title ?? key
        const labels = Array.from(new Set(rows.flatMap((r) => (r.regimeFactors?.families.find((f) => f.key === key)?.buckets ?? []).map((b) => b.label))))
        return { key, title, labels }
      })
      .filter((f) => f.labels.length > 0)
  }, [rows])

  const compareFamilyOptions = useMemo(() => {
    return compareFamilies.map((fam) => ({
      key: fam.key,
      title: fam.title,
      option: {
        tooltip: { trigger: "axis" as const },
        legend: { top: 0, type: "scroll" as const, textStyle: { fontSize: 11 } },
        grid: { left: 56, right: 16, top: 28, bottom: 36 },
        xAxis: { type: "category" as const, data: fam.labels, axisLabel: { fontSize: 10, rotate: fam.labels.length > 4 ? 28 : 0 } },
        yAxis: {
          type: "value" as const,
          name: "日均",
          axisLabel: { fontSize: 10, formatter: axisPnl },
          splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
        },
        series: rows.map((r, i) => ({
          name: accLabel(r),
          type: "bar" as const,
          barMaxWidth: 12,
          itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: 2 },
          data: fam.labels.map((lab) => r.regimeFactors?.families.find((f) => f.key === fam.key)?.buckets.find((b) => b.label === lab)?.avgPnl ?? 0),
        })),
      },
    }))
  }, [rows, compareFamilies])

  const insights = useMemo(() => buildCompareInsights(rows), [rows])
  const marketCharts = useMemo(() => {
    const height = Math.max(280, 52 + rows.length * 46)
    const specs: { key: string; title: string; caption: string; option: ReturnType<typeof marketHeatmap> }[] = [
      {
        key: "risk-hi",
        title: "市况对照 · 风险贡献最大板块",
        caption: "格子是该账户在这种市场状态下，占组合方差最多的板块。颜色是占比。",
        option: marketHeatmap(rows, (c) => ({ sector: c.largestRisk.sector, metric: c.largestRisk.share }), "share"),
      },
      {
        key: "risk-lo",
        title: "市况对照 · 风险贡献最小板块",
        caption: "格子是占组合方差最少、且这段市况里经常在仓的板块。颜色是占比。",
        option: marketHeatmap(rows, (c) => ({ sector: c.lowestRisk.sector, metric: c.lowestRisk.share }), "share"),
      },
      {
        key: "profit",
        title: "市况对照 · 盈利板块",
        caption: "格子是这种市场状态下平仓加盯市赚得最多的板块。红色更赚，绿色更亏。",
        option: marketHeatmap(rows, (c) => ({ sector: c.profitSector.sector, metric: c.profitSector.pnl }), "pnl"),
      },
      {
        key: "loss",
        title: "市况对照 · 亏损板块",
        caption: "格子是这种市场状态下亏得最多的板块。红色更赚，绿色更亏。",
        option: marketHeatmap(rows, (c) => ({ sector: c.lossSector.sector, metric: c.lossSector.pnl }), "pnl"),
      },
    ]
    return { height, specs: specs.filter((s) => s.option) }
  }, [rows])

  const kpiRows = useMemo(() => {
    const pnls = rows.map((r) => r.kpis?.totalPnl)
    const dayWr = rows.map((r) => r.kpis?.dayWinRate)
    const tradeWr = rows.map((r) => r.kpis?.tradeWinRate)
    const pf = rows.map((r) => r.kpis?.profitFactor)
    const sharpe = rows.map((r) => r.kpis?.sharpe)
    const dd = rows.map((r) => r.kpis?.maxDdPct)
    return [
      { label: "策略画像", values: rows.map((r) => r.portrait?.strategyLabel ?? "—") },
      {
        label: "区间净盈亏",
        values: rows.map((r) => ({ text: fmtWan(r.kpis?.totalPnl), color: pnlColor(r.kpis?.totalPnl ?? 0) })),
        best: bestSet(pnls, "max"),
      },
      { label: "日胜率", values: rows.map((r) => fmtPct(r.kpis?.dayWinRate, 0)), best: bestSet(dayWr, "max") },
      { label: "平仓胜率", values: rows.map((r) => fmtPct(r.kpis?.tradeWinRate, 0)), best: bestSet(tradeWr, "max") },
      { label: "盈亏比", values: rows.map((r) => r.kpis?.profitFactor?.toFixed(2) ?? "—"), best: bestSet(pf, "max") },
      { label: "夏普", values: rows.map((r) => r.kpis?.sharpe?.toFixed(2) ?? "—"), best: bestSet(sharpe, "max") },
      { label: "最大回撤", values: rows.map((r) => fmtPct(r.kpis?.maxDdPct)), best: bestSet(dd, "max") },
      {
        label: "盈/亏持仓天数",
        values: rows.map((r) => `${r.kpis?.avgHoldWin?.toFixed(1) ?? "—"} / ${r.kpis?.avgHoldLoss?.toFixed(1) ?? "—"}`),
      },
      { label: "平均对冲度", values: rows.map((r) => fmtPct(r.kpis?.hedgeRatioAvg, 0)) },
      { label: "夜盘手数占比", values: rows.map((r) => fmtPct(nightLotsShare(r), 0)) },
      { label: "南华相关", values: rows.map((r) => (r.kpis?.corrNhci == null ? "—" : String(r.kpis.corrNhci))) },
      {
        label: "涨/跌捕获",
        values: rows.map((r) => {
          const up = r.kpis?.upCapture
          const dn = r.kpis?.downCapture
          if (up == null && dn == null) return "—"
          return `${up == null ? "—" : up.toFixed(2)} / ${dn == null ? "—" : dn.toFixed(2)}`
        }),
      },
      { label: "交易日 / 平仓", values: rows.map((r) => `${r.kpis?.tradingDays ?? 0} / ${r.kpis?.nCloses ?? 0}`) },
    ]
  }, [rows])

  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground py-10 text-center">
        {loading ? "正在拉取各量化账户…" : "没有可对比的账户数据。"}
      </p>
    )
  }

  return (
    <div className={`space-y-5 ${loading ? "opacity-60 pointer-events-none" : ""}`}>
      {insights && <CompareInsightsPanel insights={insights} />}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2.5">
        {rows.map((r, i) => (
          <button
            key={r.accountId ?? i}
            type="button"
            onClick={() => r.accountId && onOpenAccount(String(r.accountId))}
            className="text-left rounded-lg border border-border p-3 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="text-sm font-semibold">{accLabel(r)}</span>
              <VolBadge label={r.portrait?.strategyLabel} />
            </div>
            <div className="text-xs font-medium mb-1">{r.portrait?.strategyLabel ? labelWithoutVol(r.portrait.strategyLabel) : "—"}</div>
            <div className="text-lg font-semibold tabular-nums" style={{ color: pnlColor(r.kpis?.totalPnl ?? 0) }}>
              {fmtWan(r.kpis?.totalPnl)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              日胜率 {fmtPct(r.kpis?.dayWinRate, 0)} · 夏普 {r.kpis?.sharpe?.toFixed(2) ?? "—"} · 回撤 {fmtPct(r.kpis?.maxDdPct)}
            </p>
            {r.featureStability?.headline && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{r.featureStability.headline}</p>
            )}
            {r.inference?.headline && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{r.inference.headline}</p>
            )}
            {r.factorDml?.headline && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{r.factorDml.headline}</p>
            )}
            {r.factorDml?.causal?.headline && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{r.factorDml.causal.headline}</p>
            )}
            {r.factorDml?.irl?.headline && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{r.factorDml.irl.headline}</p>
            )}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-sm font-medium">绩效对照</CardTitle>
              <QuantChartHelp spec={CHART_HELP.compareKpi} />
            </div>
            <PeriodBadge />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            同一区间下各量化账户的核心指标。高亮为该行最优值；点击列头进入单账户详情。
          </p>
        </CardHeader>
        <CardContent className="pt-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left font-medium py-2 pr-3 sticky left-0 bg-background min-w-[7rem]">指标</th>
                {rows.map((r, i) => (
                  <th key={r.accountId ?? i} className="text-right font-medium py-2 px-2 min-w-[7.5rem]">
                    <button type="button" onClick={() => r.accountId && onOpenAccount(String(r.accountId))} className="hover:underline">
                      {accLabel(r)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kpiRows.map((row) => (
                <tr key={row.label} className="border-b border-border/60">
                  <td className="py-1.5 pr-3 text-muted-foreground sticky left-0 bg-background">{row.label}</td>
                  {row.values.map((v, i) => {
                    const text = typeof v === "string" ? v : v.text
                    const color = typeof v === "string" ? undefined : v.color
                    const best = row.best?.has(i)
                    return (
                      <td
                        key={i}
                        className={`py-1.5 px-2 text-right tabular-nums ${best ? "font-semibold bg-red-50/70 dark:bg-red-950/20" : ""}`}
                        style={color ? { color } : undefined}
                      >
                        {text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <ChartCard title="累计盈亏对照" caption="同一时间轴上的累计盈亏。点击上方卡片可进入单账户详情。" help={CHART_HELP.overlay}>
        {rows.some((r) => (r.equity?.length ?? 0) > 0) && (
          <ReactECharts option={overlayOption} style={{ height: 320, width: "100%" }} notMerge />
        )}
      </ChartCard>

      {marketCharts.specs.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {marketCharts.specs.map((spec) => (
            <ChartCard key={spec.key} title={spec.title} caption={spec.caption}>
              <ReactECharts option={spec.option} style={{ height: marketCharts.height, width: "100%" }} notMerge />
            </ChartCard>
          ))}
        </div>
      )}

      {compareFamilyOptions.map((fam) => (
        <ChartCard key={fam.key} title={`${fam.title}对照`} caption="同一因子分档下各账户的日均盈亏。" help={helpForFactor(fam.key, fam.title)}>
          <ReactECharts option={fam.option} style={{ height: 300, width: "100%" }} notMerge />
        </ChartCard>
      ))}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-sm font-medium">画像对照</CardTitle>
              <QuantChartHelp spec={CHART_HELP.comparePortrait} />
            </div>
            <PeriodBadge />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">由成交、平仓与日核算倒推的策略习惯，便于横向看差异。</p>
        </CardHeader>
        <CardContent className="pt-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left font-medium py-2 pr-3 sticky left-0 bg-background min-w-[6rem]">维度</th>
                {rows.map((r, i) => (
                  <th key={r.accountId ?? i} className="text-left font-medium py-2 px-2 min-w-[12rem]">{accLabel(r)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PORTRAIT_COMPARE_TITLES.map((title) => (
                <tr key={title} className="border-b border-border/60 align-top">
                  <td className="py-2 pr-3 text-muted-foreground sticky left-0 bg-background whitespace-nowrap">{title}</td>
                  {rows.map((r, i) => (
                    <td key={r.accountId ?? i} className="py-2 px-2 text-muted-foreground leading-relaxed">
                      {portraitDetail(r, title)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function corrCellClass(c: number | null): string {
  if (c == null) return ""
  if (c >= 0.55) return "bg-red-100 font-semibold dark:bg-red-950/40"
  if (c >= 0.35) return "bg-red-50 dark:bg-red-950/20"
  if (c <= 0.12) return "bg-emerald-50 dark:bg-emerald-950/20"
  return ""
}

function CompareInsightsPanel({ insights }: { insights: CompareInsights }) {
  const { corrMatrix, sectorConsensus } = insights
  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">结论</h2>
        <PeriodBadge />
      </div>
      <p className="text-sm leading-relaxed">{insights.headline}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Kpi title="组合净盈亏" value={fmtWan(insights.bookPnl)} hint={`${insights.winners} 赚 / ${insights.losers} 亏`} accent={pnlColor(insights.bookPnl)} />
        <Kpi
          title="日盈亏平均相关"
          value={insights.avgCorr == null ? "—" : insights.avgCorr.toFixed(2)}
          hint={insights.avgCorr != null && insights.avgCorr >= 0.35 ? "同步偏高，分散弱" : "重叠天数上的 Pearson"}
        />
        <Kpi
          title="主导画像"
          value={insights.styleGroups[0]?.label ?? "—"}
          hint={insights.styleGroups[0] ? `${insights.styleGroups[0].accounts.length} / ${corrMatrix.labels.length} 个账户` : undefined}
        />
        <Kpi
          title="结论条数"
          value={String(insights.findings.length)}
          hint="由对照数据倒推，不是投顾自述"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {insights.findings.map((item) => (
          <div key={item.title} className={`rounded-md border px-3 py-2.5 ${TONE[item.tone]}`}>
            <div className="text-xs font-medium mb-1">{item.title}</div>
            <p className="text-xs text-muted-foreground leading-relaxed">{item.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-medium mb-1">日盈亏相关</div>
          <p className="text-xs text-muted-foreground mb-2">重叠交易日的 Pearson。红=走在一起，绿=更互补。对角为 1。</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left font-medium py-1.5 pr-2"> </th>
                  {corrMatrix.labels.map((lab) => (
                    <th key={lab} className="text-right font-medium py-1.5 px-1.5">{lab}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corrMatrix.labels.map((rowLab, i) => (
                  <tr key={rowLab} className="border-b border-border/60">
                    <td className="py-1 pr-2 text-muted-foreground whitespace-nowrap">{rowLab}</td>
                    {corrMatrix.values[i].map((c, j) => (
                      <td key={j} className={`py-1 px-1.5 text-right tabular-nums ${corrCellClass(c)}`}>
                        {c == null ? "—" : c.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {sectorConsensus.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-1">板块共识</div>
            <p className="text-xs text-muted-foreground mb-2">多少账户在该板块赚钱 / 亏损，以及合计盈亏（平仓+盯市）。</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left font-medium py-1.5 pr-2">板块</th>
                    <th className="text-right font-medium py-1.5 px-2">赚钱</th>
                    <th className="text-right font-medium py-1.5 px-2">亏损</th>
                    <th className="text-right font-medium py-1.5 pl-2">合计</th>
                  </tr>
                </thead>
                <tbody>
                  {sectorConsensus.map((s) => (
                    <tr key={s.sector} className="border-b border-border/60">
                      <td className="py-1 pr-2">{s.sector}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{s.pos}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{s.neg}</td>
                      <td className="py-1 pl-2 text-right tabular-nums" style={{ color: pnlColor(s.pnl) }}>{fmtWan(s.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
