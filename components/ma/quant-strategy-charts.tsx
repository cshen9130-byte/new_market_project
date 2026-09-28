"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import ReactECharts from "echarts-for-react"
import { ArrowLeftRight, Columns2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { QUANT_ACCOUNT_IDS } from "@/lib/ma/quant-accounts"
import { QUANT_STRATEGY_RANGES, quantStrategyBounds, type QuantStrategyRangeLabel } from "@/lib/ma/quant-strategy-ranges"
import { buildCompareInsights, type CompareInsights } from "@/lib/ma/quant-strategy-compare"
import type { FactorFamily, HeatCell, RegimeFactors } from "@/lib/ma/quant-regime-factors"
import type { StrategyInference } from "@/lib/ma/quant-strategy-infer"
import type { FactorDmlReport } from "@/lib/ma/quant-factor-dml"
import { CHART_HELP, helpForFactor, QuantChartHelp, type ChartHelpSpec } from "@/components/ma/quant-strategy-help"
import { InferPanel } from "@/components/ma/quant-strategy-infer-panel"
import { FactorDmlPanel } from "@/components/ma/quant-factor-dml-panel"
import { readFactorSupport } from "@/lib/ma/quant-factor-reading"
import type { LinearKind, LinearScatterChart, LinearScatterReport } from "@/lib/ma/quant-linear-scatters"
import type { BookStyle, BookStyleKind } from "@/lib/ma/quant-book-style"
import type { AlphaBeta, BookRisk, BookRiskSector, FreqSector, SectorVolSeries, TradeFrequency } from "@/lib/ma/quant-feature-stability"
import { QuantTraderExposureCharts } from "@/components/ma/quant-trader-exposure-charts"

const UP = "#ef4444"
const DOWN = "#10b981"
const BLUE = "#3b82f6"
const AMBER = "#f59e0b"

const RANGES = QUANT_STRATEGY_RANGES
type RangeLabel = QuantStrategyRangeLabel

function boundsFor(label: RangeLabel): { from: string; to: string } {
  return quantStrategyBounds(label)
}

function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return Math.round(n).toLocaleString("zh-CN")
}

function fmtMoney(n: number | null | undefined, signed = false): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const body = Math.abs(Math.round(n)).toLocaleString("zh-CN")
  if (n < 0) return `-${body}`
  if (signed && n > 0) return `+${body}`
  return body
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

function signedFixed(n: number, digits: number): string {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(digits)}`
}

function signedPctPoints(n: number, digits = 0): string {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(digits)}%`
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
    payoff?: number | null
    profitFactor: number | null
    expectancy?: number
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
  portrait: { strategyLabel: string; summary: string; items: PortraitItem[]; bookStyle?: BookStyle }
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
      pnl?: number
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
      pnl?: number
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
  sectors: {
    sector: string; pnl: number; lots: number; closePnl?: number; mtmPnl?: number
    n?: number; winRate?: number | null; payoff?: number | null; profitFactor?: number | null
  }[]
  bookRisk?: BookRisk | null
  tradeFrequency?: TradeFrequency | null
  sectorVol?: { window: number; sectors: SectorVolSeries[] } | null
  alphaBeta?: AlphaBeta | null
  products: {
    code: string; name: string; sector: string; pnl: number; lots: number
    closePnl?: number; mtmPnl?: number
    winRate: number | null; payoff?: number | null; profitFactor: number | null; avgHoldWin: number | null; avgHoldLoss: number | null; n: number
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
  rrShape?: {
    clip: number
    binCount: number
    bins: number[]
    layers: {
      key: string
      label: string
      n: number
      winRate: number | null
      avgWin: number | null
      avgLoss: number | null
      payoff: number | null
      profitFactor: number | null
      expectancy: number | null
    }[]
  }
  inference?: StrategyInference
  linearScatters?: LinearScatterReport
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
  return label.replace(/ · [高中低]波$/, "").replace(/ · (日内|短周期|中周期|长周期)$/, "")
}

type HoldClass = "日内" | "短周期" | "中周期" | "长周期"

function holdClassOf(label: string | null | undefined): HoldClass | null {
  if (!label) return null
  const bare = label.replace(/ · [高中低]波$/, "")
  if (bare.endsWith(" · 日内")) return "日内"
  if (bare.endsWith(" · 短周期")) return "短周期"
  if (bare.endsWith(" · 中周期")) return "中周期"
  if (bare.endsWith(" · 长周期")) return "长周期"
  return null
}

const HOLD_DOT: Record<HoldClass, string> = {
  日内: "bg-violet-500",
  短周期: "bg-teal-500",
  中周期: "bg-blue-500",
  长周期: "bg-stone-500",
}

const VOL_DOT: Record<VolClass, string> = {
  高波: "bg-red-500",
  中波: "bg-amber-500",
  低波: "bg-sky-500",
}

const BOOK_KINDS: BookStyleKind[] = ["择时", "选票", "指数增强", "多空", "截面"]

function BookStyleMarks({ style, compact = false }: { style: BookStyle | null | undefined; compact?: boolean }) {
  if (!style?.primary) return null
  const kinds = compact
    ? BOOK_KINDS.filter((kind) => kind === style.primary || kind === style.secondary)
    : BOOK_KINDS
  return (
    <div className={`flex flex-wrap items-center gap-1 ${compact ? "" : "w-full"}`}>
      {kinds.map((kind) => {
        const on = style.primary === kind
        const sec = style.secondary === kind
        return (
          <span
            key={kind}
            className={`inline-flex items-center rounded-full border font-medium ${
              compact ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]"
            } ${
              on
                ? "border-foreground bg-foreground text-background"
                : sec
                  ? "border-foreground/40 text-foreground"
                  : "border-border text-muted-foreground/70"
            }`}
          >
            {kind}
          </span>
        )
      })}
    </div>
  )
}

function VolBadge({ label }: { label: string | null | undefined }) {
  const vol = volClassOf(label)
  if (!vol) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shrink-0">
      <span className={`h-1.5 w-1.5 rounded-full ${VOL_DOT[vol]}`} aria-hidden />
      {vol}
    </span>
  )
}

function HoldBadge({ label }: { label: string | null | undefined }) {
  const hold = holdClassOf(label)
  if (!hold) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shrink-0">
      <span className={`h-1.5 w-1.5 rounded-full ${HOLD_DOT[hold]}`} aria-hidden />
      {hold}
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

function fmtKind(kind: LinearKind, v: number): string {
  if (!Number.isFinite(v)) return "—"
  if (kind === "pct") return `${v.toFixed(1)}%`
  if (kind === "pct0") return `${v.toFixed(0)}%`
  if (kind === "x") return `${v.toFixed(2)}x`
  if (kind === "rsi") return v.toFixed(0)
  if (kind === "z") return v.toFixed(1)
  return v.toFixed(2)
}

const LINEAR_HELP: ChartHelpSpec = {
  heading: "策略里的直线关系 · 方法说明",
  blocks: [
    {
      title: "在做什么",
      paragraphs: [
        "把这个盘手的仓位、方向、杠杆，和一组长得出来的量配成散点，逐对做 Pearson。只留下统计上显著、而且散点云本身就是一条斜线的。所以有的账户一两张，有的三四张，有的这一段一张都没有。",
      ],
    },
    {
      title: "试了哪些",
      bullets: [
        "账户日：南华波动对对冲度、品种数、集中度、开仓密度；南华 5/20 日涨跌对净敞口；趋势强度对方向仓；回撤对杠杆；账户自身波动对杠杆；昨日盈亏对今日杠杆、风险度和开仓。",
        "品种日：5/20/60 日涨跌、相对 MA20、RSI 对净市值权重；趋势强度对权重；5 日涨跌和均线对买开还是卖开；次主力升贴水、主力持仓量变化对净市值；成交量对开仓手数。",
        "横轴除了「总杠杆对品种数」是同一天的结构，其余都用前一交易日收盘就能算的值，不用当天收盘解释当天持仓。",
        "市场波动对总敞口、品种波动对权重，上面两张固定图已经在画，这里不重复。",
      ],
    },
    {
      title: "什么叫过关",
      paragraphs: [
        "先把两侧各 2% 的极端值夹住再算相关，避免几个离群点画出一条假直线。样本短的时候要求更陡。交易日够多时，|ρ| 大约要到 0.40（账户日）或 0.42（品种日）才留。p≤0.01，并且在全部检验里做 BH 校正后 q≤0.10。",
      ],
      formula: "ρ = Pearson(X, Y)\nt = ρ √((n−2) / (1−ρ²))\n五档均值要顺着同一方向走，不能一头跳变，也不能是 U 型",
    },
    {
      title: "读法",
      bullets: [
        "红线是夹住极端值之后的最小二乘直线。黄点是按横轴分成五档后的均值，用来看这五档是不是顺着同一条斜线走。散点是落在中间 96% 里的样本。",
        "同一类里只留最陡的一条。5 日和 20 日动量如果都过关，只画更明显的那张。",
        "最多四张。没过关的不画，避免每个账户看起来都一样。",
        "品种层面还要在品种内部去掉各自的均值之后仍然同向，避免「只做了几个一直在涨的品种」被看成一条规则。",
      ],
    },
  ],
}

function linearScatterOption(ch: LinearScatterChart) {
  if (!ch.points.length) return {}
  const fmtX = (v: number) => fmtKind(ch.xKind, v)
  const fmtY = (v: number) => fmtKind(ch.yKind, v)
  return {
    tooltip: {
      formatter: (p: { seriesType?: string; data?: { value?: number[]; label?: string } | number[] }) => {
        const raw = p.data
        const value = Array.isArray(raw) ? raw : raw?.value
        if (!value) return ""
        const [x, y] = value
        if (p.seriesType === "line") return `直线<br/>${ch.xName} ${fmtX(x)}<br/>${ch.yName} ${fmtY(y)}`
        const label = !Array.isArray(raw) && raw?.label ? `${raw.label}<br/>` : ""
        return `${label}${ch.xName} ${fmtX(x)}<br/>${ch.yName} ${fmtY(y)}`
      },
    },
    grid: { left: 52, right: 16, top: 28, bottom: 40 },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    xAxis: {
      type: "value" as const,
      name: ch.xName,
      nameLocation: "middle" as const,
      nameGap: 28,
      axisLabel: { fontSize: 10, formatter: fmtX },
      splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
    },
    yAxis: {
      type: "value" as const,
      name: ch.yName,
      axisLabel: { fontSize: 10, formatter: fmtY },
      splitLine: { lineStyle: { type: "dashed", opacity: 0.25 } },
    },
    series: [
      {
        name: "样本",
        type: "scatter" as const,
        symbolSize: 7,
        itemStyle: { color: BLUE, opacity: 0.45 },
        data: ch.points.map((pt) => ({ value: [pt.x, pt.y], label: pt.label })),
      },
      {
        name: "直线",
        type: "line" as const,
        showSymbol: false,
        data: [[ch.line.x0, ch.line.y0], [ch.line.x1, ch.line.y1]],
        lineStyle: { width: 2, color: UP },
        itemStyle: { color: UP },
      },
      {
        name: "五档均值",
        type: "scatter" as const,
        symbolSize: 11,
        z: 3,
        itemStyle: { color: AMBER, borderColor: "#fff", borderWidth: 1 },
        data: (ch.bins ?? []).map((b) => ({ value: [b.x, b.y] })),
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

const SECTOR_COLOR: Record<string, string> = {
  农产: "#84cc16",
  生鲜: "#22c55e",
  贵金属: "#eab308",
  有色: "#f97316",
  新能源: "#06b6d4",
  黑色: "#475569",
  能源化工: "#8b5cf6",
  航运: "#0ea5e9",
  股指: "#ef4444",
  国债: "#3b82f6",
  其他: "#a1a1aa",
}

function sectorColor(name: string): string {
  return SECTOR_COLOR[name] ?? "#94a3b8"
}

function shadeHex(hex: string, t: number): string {
  const n = hex.replace("#", "")
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * t)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

function foldProducts(products: BookRiskSector["products"], max = 8) {
  const rows = products.map((p) => ({ name: p.name, withinShare: p.withinShare, riskShare: p.riskShare }))
  if (rows.length <= max) return rows
  const head = rows.slice(0, max - 1)
  const rest = rows.slice(max - 1)
  return [
    ...head,
    {
      name: `其余 ${rest.length} 个`,
      withinShare: rest.reduce((s, p) => s + p.withinShare, 0),
      riskShare: rest.reduce((s, p) => s + p.riskShare, 0),
    },
  ]
}

function bookSectorOption(book: BookRisk) {
  const rows = [...book.sectors].sort((a, b) => a.riskShare - b.riskShare)
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { name?: string }[]) => {
        const s = book.sectors.find((x) => x.sector === ps[0]?.name)
        if (!s) return ""
        return [
          s.sector,
          `风险贡献 ${s.riskShare.toFixed(1)}%`,
          `等权 ${book.equalShare.toFixed(1)}%`,
          `${s.productCount} 个品种 · ${s.stance}`,
        ].join("<br/>")
      },
    },
    grid: { left: 72, right: 48, top: 12, bottom: 24 },
    xAxis: {
      type: "value" as const,
      axisLabel: { fontSize: 10, formatter: (v: number) => `${v}%` },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    yAxis: { type: "category" as const, data: rows.map((r) => r.sector), axisLabel: { fontSize: 11 } },
    series: [{
      type: "bar" as const,
      barMaxWidth: 16,
      data: rows.map((r) => ({
        value: r.riskShare,
        itemStyle: { color: sectorColor(r.sector), borderRadius: 2 },
      })),
      markLine: {
        symbol: "none",
        label: { formatter: `等权 ${book.equalShare.toFixed(0)}%`, fontSize: 10, color: "#64748b" },
        lineStyle: { type: "dashed" as const, color: "#64748b" },
        data: [{ xAxis: book.equalShare }],
      },
    }],
  }
}

function bookTreeOption(book: BookRisk) {
  return {
    tooltip: {
      formatter: (p: { name?: string; value?: number; data?: { within?: number }; treePathInfo?: { name: string }[] }) => {
        const path = (p.treePathInfo ?? []).map((x) => x.name).filter(Boolean)
        const within = p.data?.within
        const extra = within != null ? `<br/>占该板块 ${within.toFixed(0)}%` : ""
        return `${path.join(" / ") || p.name || ""}<br/>组合风险贡献 ${Number(p.value ?? 0).toFixed(1)}%${extra}`
      },
    },
    series: [{
      type: "treemap" as const,
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      width: "100%",
      height: "94%",
      top: 4,
      label: {
        fontSize: 11,
        color: "#1f2937",
        formatter: (p: { name: string; value: number }) => (p.value >= 3.5 ? `${p.name}\n${p.value.toFixed(0)}%` : p.name),
      },
      upperLabel: { show: true, height: 18, fontSize: 11, color: "#fff" },
      itemStyle: { borderColor: "#fff", borderWidth: 1, gapWidth: 2 },
      levels: [
        { itemStyle: { borderWidth: 3, gapWidth: 4, borderColor: "#fff" }, upperLabel: { show: true } },
        { itemStyle: { borderWidth: 1, gapWidth: 1, borderColor: "rgba(255,255,255,0.75)" } },
      ],
      data: book.sectors.map((s) => {
        const base = sectorColor(s.sector)
        const shown = s.products.filter((p) => p.riskShare > 0)
        const kids = shown.length
          ? shown
          : [{ name: s.topProduct || s.sector, riskShare: s.riskShare, withinShare: 100 }]
        return {
          name: s.sector,
          itemStyle: { color: base },
          children: kids.map((p, i) => ({
            name: p.name,
            value: p.riskShare,
            within: p.withinShare,
            itemStyle: {
              color: shadeHex(base, kids.length <= 1 ? 0.45 : 0.4 + (i / Math.max(kids.length - 1, 1)) * 0.45),
            },
          })),
        }
      }),
    }],
  }
}

function withinSectorOption(sector: BookRiskSector) {
  const shown = foldProducts(sector.products).sort((a, b) => a.withinShare - b.withinShare)
  const equal = sector.productCount > 0 ? 100 / sector.productCount : 0
  const focus = sector.stance === "有所偏好" || sector.stance === "明显偏好"
  const base = sectorColor(sector.sector)
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { name?: string }[]) => {
        const row = shown.find((x) => x.name === ps[0]?.name)
        if (!row) return ""
        return `${row.name}<br/>占该板块 ${row.withinShare.toFixed(1)}%<br/>占组合 ${row.riskShare.toFixed(1)}%<br/>等权 ${equal.toFixed(1)}%`
      },
    },
    grid: { left: 92, right: 36, top: 8, bottom: 24 },
    xAxis: {
      type: "value" as const,
      axisLabel: { fontSize: 10, formatter: (v: number) => `${v}%` },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    yAxis: { type: "category" as const, data: shown.map((r) => r.name), axisLabel: { fontSize: 10 } },
    series: [{
      type: "bar" as const,
      barMaxWidth: 14,
      data: shown.map((r) => ({
        value: r.withinShare,
        itemStyle: {
          color: !focus || r.name === sector.topProduct ? base : "#cbd5e1",
          borderRadius: 2,
        },
      })),
      markLine: {
        symbol: "none",
        label: { formatter: `等权 ${equal.toFixed(0)}%`, fontSize: 10, color: "#64748b" },
        lineStyle: { type: "dashed" as const, color: "#64748b" },
        data: [{ xAxis: equal }],
      },
    }],
  }
}

function compareBookOption(rows: ApiData[]) {
  const books = rows.filter((r) => (r.bookRisk?.sectors.length ?? 0) > 0)
  const names = new Set<string>()
  for (const r of books) for (const s of r.bookRisk!.sectors) names.add(s.sector)
  const order = ["农产", "生鲜", "黑色", "有色", "贵金属", "能源化工", "新能源", "航运", "股指", "国债", "其他"]
  const sectors = [...names].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  if (!sectors.length) return null
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { seriesName?: string; name?: string; value?: number }[]) => {
        const head = ps[0]?.name ?? ""
        const lines = ps.map((p) => `${p.seriesName} ${p.value == null ? "—" : `${Number(p.value).toFixed(1)}%`}`)
        return [`${head} 风险贡献`, ...lines].join("<br/>")
      },
    },
    legend: { top: 0, type: "scroll" as const, textStyle: { fontSize: 11 } },
    grid: { left: 44, right: 12, top: 32, bottom: 28 },
    xAxis: { type: "category" as const, data: sectors, axisLabel: { fontSize: 11 } },
    yAxis: {
      type: "value" as const,
      name: "%",
      axisLabel: { fontSize: 10 },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    series: books.map((r, i) => ({
      name: accLabel(r),
      type: "bar" as const,
      barMaxWidth: 14,
      itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: 2 },
      data: sectors.map((name) => r.bookRisk!.sectors.find((s) => s.sector === name)?.riskShare ?? 0),
    })),
  }
}

function fmtFreqP(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—"
  if (p < 0.001) return "<0.001"
  return p.toFixed(3)
}

function foldFreq(products: FreqSector["products"], max = 8) {
  const rows = products.map((p) => ({
    name: p.name,
    withinShare: p.withinShare,
    days: p.days,
    openLots: p.openLots,
    closeLots: p.closeLots,
  }))
  if (rows.length <= max) return rows
  const head = rows.slice(0, max - 1)
  const rest = rows.slice(max - 1)
  return [
    ...head,
    {
      name: `其余 ${rest.length} 个`,
      withinShare: rest.reduce((s, p) => s + p.withinShare, 0),
      days: rest.reduce((s, p) => s + p.days, 0),
      openLots: rest.reduce((s, p) => s + p.openLots, 0),
      closeLots: rest.reduce((s, p) => s + p.closeLots, 0),
    },
  ]
}

function freqSectorOption(book: TradeFrequency) {
  const rows = [...book.sectors].sort((a, b) => a.days - b.days)
  const mean = rows.reduce((s, r) => s + r.days, 0) / rows.length
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { name?: string }[]) => {
        const s = book.sectors.find((x) => x.sector === ps[0]?.name)
        if (!s) return ""
        return [
          s.sector,
          `有成交 ${s.days} 天`,
          `占各板块天数 ${s.share.toFixed(1)}%`,
          `等权 ${mean.toFixed(0)} 天`,
          `${s.productCount} 个品种 · ${s.stance}`,
        ].join("<br/>")
      },
    },
    grid: { left: 72, right: 56, top: 12, bottom: 24 },
    xAxis: {
      type: "value" as const,
      name: "天",
      axisLabel: { fontSize: 10 },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    yAxis: { type: "category" as const, data: rows.map((r) => r.sector), axisLabel: { fontSize: 11 } },
    series: [{
      type: "bar" as const,
      barMaxWidth: 16,
      data: rows.map((r) => ({
        value: r.days,
        itemStyle: { color: sectorColor(r.sector), borderRadius: 2 },
      })),
      markLine: {
        symbol: "none",
        label: { formatter: `等权 ${mean.toFixed(0)}天`, fontSize: 10, color: "#64748b" },
        lineStyle: { type: "dashed" as const, color: "#64748b" },
        data: [{ xAxis: mean }],
      },
    }],
  }
}

function freqWithinOption(sector: FreqSector) {
  const shown = foldFreq(sector.products).sort((a, b) => a.days - b.days)
  const mean = sector.productCount > 0
    ? sector.products.reduce((s, p) => s + p.days, 0) / sector.productCount
    : 0
  const focus = sector.stance === "显著不同"
  const base = sectorColor(sector.sector)
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { name?: string }[]) => {
        const row = shown.find((x) => x.name === ps[0]?.name)
        if (!row) return ""
        return `${row.name}<br/>有成交 ${row.days} 天<br/>占该板块 ${row.withinShare.toFixed(1)}%<br/>等权 ${mean.toFixed(0)} 天<br/>开仓 ${row.openLots.toFixed(0)} 手 · 平仓 ${row.closeLots.toFixed(0)} 手`
      },
    },
    grid: { left: 92, right: 48, top: 8, bottom: 24 },
    xAxis: {
      type: "value" as const,
      name: "天",
      axisLabel: { fontSize: 10 },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    yAxis: { type: "category" as const, data: shown.map((r) => r.name), axisLabel: { fontSize: 10 } },
    series: [{
      type: "bar" as const,
      barMaxWidth: 14,
      data: shown.map((r) => ({
        value: r.days,
        itemStyle: {
          color: !focus || r.name === sector.topProduct ? base : "#cbd5e1",
          borderRadius: 2,
        },
      })),
      markLine: {
        symbol: "none",
        label: { formatter: `等权 ${mean.toFixed(0)}天`, fontSize: 10, color: "#64748b" },
        lineStyle: { type: "dashed" as const, color: "#64748b" },
        data: [{ xAxis: mean }],
      },
    }],
  }
}

function alphaBetaOption(ab: AlphaBeta) {
  const rows = ab.points
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { dataIndex?: number }[]) => {
        const row = rows[ps[0]?.dataIndex ?? 0]
        if (!row) return ""
        return [
          row.date,
          `alpha 当日 ${fmtWan(row.alpha)} · 累计 ${fmtWan(row.cumAlpha)}`,
          `beta 当日 ${fmtWan(row.beta)} · 累计 ${fmtWan(row.cumBeta)}`,
        ].join("<br/>")
      },
    },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 16, top: 32, bottom: 48 },
    dataZoom: [
      { type: "inside" as const },
      { type: "slider" as const, height: 14, bottom: 4, textStyle: { fontSize: 9 } },
    ],
    xAxis: { type: "category" as const, data: rows.map((r) => r.date.slice(5)), axisLabel: { fontSize: 10 } },
    yAxis: {
      type: "value" as const,
      name: "累计盈亏",
      axisLabel: { fontSize: 10, formatter: axisPnl },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    series: [
      {
        name: "累计 alpha",
        type: "line" as const,
        showSymbol: false,
        data: rows.map((r) => r.cumAlpha),
        lineStyle: { width: 2, color: "#8b5cf6" },
        itemStyle: { color: "#8b5cf6" },
      },
      {
        name: "累计 beta",
        type: "line" as const,
        showSymbol: false,
        data: rows.map((r) => r.cumBeta),
        lineStyle: { width: 2, color: BLUE },
        itemStyle: { color: BLUE },
      },
    ],
  }
}

function alphaNavOption(ab: AlphaBeta) {
  const rows = ab.nav ?? []
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { dataIndex?: number }[]) => {
        const row = rows[ps[0]?.dataIndex ?? 0]
        if (!row) return ""
        return [
          row.date,
          `账户净值 ${row.trader.toFixed(2)}`,
          `南华商品指数 ${row.nhci.toFixed(2)}`,
        ].join("<br/>")
      },
    },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    grid: { left: 48, right: 16, top: 32, bottom: 48 },
    dataZoom: [
      { type: "inside" as const },
      { type: "slider" as const, height: 14, bottom: 4, textStyle: { fontSize: 9 } },
    ],
    xAxis: { type: "category" as const, data: rows.map((r) => r.date.slice(5)), axisLabel: { fontSize: 10 } },
    yAxis: {
      type: "value" as const,
      name: "指数",
      scale: true,
      axisLabel: { fontSize: 10 },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    series: [
      {
        name: "账户净值",
        type: "line" as const,
        showSymbol: false,
        data: rows.map((r) => r.trader),
        lineStyle: { width: 2, color: "#8b5cf6" },
        itemStyle: { color: "#8b5cf6" },
      },
      {
        name: "南华商品指数",
        type: "line" as const,
        showSymbol: false,
        data: rows.map((r) => r.nhci),
        lineStyle: { width: 2, color: AMBER },
        itemStyle: { color: AMBER },
      },
    ],
  }
}

function sectorAlphaOption(ab: AlphaBeta) {
  const rows = [...(ab.sectors ?? [])].sort((a, b) => b.alphaPnl - a.alphaPnl)
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { dataIndex?: number }[]) => {
        const row = rows[ps[0]?.dataIndex ?? 0]
        if (!row) return ""
        return [
          row.sector,
          `alpha ${fmtWan(row.alphaPnl)} · beta ${fmtWan(row.betaPnl)}`,
          `alpha t=${row.t == null ? "—" : row.t.toFixed(2)} · ${row.stance}`,
        ].join("<br/>")
      },
    },
    grid: { left: 72, right: 16, top: 12, bottom: 28 },
    xAxis: {
      type: "value" as const,
      axisLabel: { fontSize: 10, formatter: axisPnl },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    yAxis: {
      type: "category" as const,
      data: rows.map((r) => r.sector),
      inverse: true,
      axisLabel: { fontSize: 11 },
    },
    series: [{
      type: "bar" as const,
      barMaxWidth: 16,
      data: rows.map((r) => ({
        value: r.alphaPnl,
        itemStyle: { color: r.alphaPnl >= 0 ? UP : DOWN, borderRadius: 2 },
      })),
    }],
  }
}

function compareAlphaBetaOption(rows: ApiData[]) {
  const books = rows.filter((r) => (r.alphaBeta?.points.length ?? 0) > 0)
  if (!books.length) return null
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { seriesName?: string; name?: string; value?: number }[]) => {
        const head = ps[0]?.name ?? ""
        const lines = ps.map((p) => `${p.seriesName} ${p.value == null ? "—" : fmtWan(Number(p.value))}`)
        return [head, ...lines].join("<br/>")
      },
    },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 12, top: 32, bottom: 28 },
    xAxis: { type: "category" as const, data: books.map((r) => accLabel(r)), axisLabel: { fontSize: 11 } },
    yAxis: {
      type: "value" as const,
      name: "盈亏",
      axisLabel: { fontSize: 10, formatter: axisPnl },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    series: [
      {
        name: "alpha",
        type: "bar" as const,
        barMaxWidth: 18,
        itemStyle: { color: "#8b5cf6", borderRadius: 2 },
        data: books.map((r) => r.alphaBeta!.alphaPnl),
      },
      {
        name: "beta",
        type: "bar" as const,
        barMaxWidth: 18,
        itemStyle: { color: BLUE, borderRadius: 2 },
        data: books.map((r) => r.alphaBeta!.betaPnl),
      },
    ],
  }
}

function breakevenPayoff(winRatePct: number): number {
  const p = winRatePct / 100
  if (!(p > 0.005)) return 20
  if (p >= 1) return 0
  return (1 - p) / p
}

function expectancyCurve(x0: number, x1: number): [number, number][] {
  const lo = Math.max(x0, 1)
  const hi = Math.min(x1, 99)
  if (!(hi > lo)) return []
  const n = 48
  const data: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n
    data.push([Number(x.toFixed(2)), Number(breakevenPayoff(x).toFixed(3))])
  }
  return data
}

function payoffAxes(xs: number[], ys: number[], xPad: number) {
  const xSpan = Math.max(8, Math.max(...xs) - Math.min(...xs))
  const xMin = Math.max(0, Math.min(...xs, 50) - xSpan * xPad)
  const xMax = Math.min(100, Math.max(...xs, 50) + xSpan * xPad)
  const curve = expectancyCurve(xMin, xMax)
  const pointHi = Math.max(...ys, 0.2)
  const curveCap = Math.max(pointHi * 2.2, 1.6)
  const shown = curve.map((p) => p[1]).filter((y) => y <= curveCap)
  const yLo = Math.min(...ys, ...(shown.length ? shown : [0]))
  const yHi = Math.max(...ys, ...(shown.length ? shown : [0]))
  const ySpan = Math.max(0.35, yHi - yLo)
  return {
    xMin,
    xMax,
    yMin: Math.max(0, yLo - ySpan * 0.18),
    yMax: yHi + ySpan * 0.22,
    curve,
  }
}

function compareWinPayoffOption(rows: ApiData[]) {
  const points = rows.flatMap((r, i) => {
    const x = r.kpis?.tradeWinRate
    const y = r.kpis?.payoff
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return []
    return [{
      name: accLabel(r),
      accountId: r.accountId ? String(r.accountId) : undefined,
      value: [x, y] as [number, number],
      pnl: r.kpis?.totalPnl ?? null,
      expectancy: r.kpis?.expectancy ?? null,
      label: r.portrait?.strategyLabel ?? "",
      itemStyle: { color: PALETTE[i % PALETTE.length], borderColor: "#fff", borderWidth: 1 },
    }]
  })
  if (!points.length) return null
  const xs = points.map((p) => p.value[0])
  const ys = points.map((p) => p.value[1])
  const axes = payoffAxes(xs, ys, 0.28)
  return {
    tooltip: {
      formatter: (p: { data?: { name?: string; value?: [number, number]; pnl?: number | null; expectancy?: number | null; label?: string } }) => {
        const d = p.data
        if (!d || Array.isArray(d) || !d.value) return ""
        const [x, y] = d.value
        const lines = [
          d.name ?? "",
          d.label ? d.label : "",
          `胜率 ${x.toFixed(1)}%（平仓 + 持仓）`,
          `盈亏比 ${y.toFixed(2)}（平均盈利 / |平均亏损|）`,
          `打平需要 ${breakevenPayoff(x).toFixed(2)}`,
          `期望 ${y > breakevenPayoff(x) ? "正" : y < breakevenPayoff(x) ? "负" : "打平"}`,
        ]
        if (d.expectancy != null && Number.isFinite(d.expectancy)) lines.push(`期望合计 ${fmtWan(d.expectancy)}`)
        if (d.pnl != null && Number.isFinite(d.pnl)) lines.push(`日报净盈亏 ${fmtWan(d.pnl)}`)
        return lines.filter(Boolean).join("<br/>")
      },
    },
    grid: { left: 52, right: 36, top: 16, bottom: 40 },
    xAxis: {
      type: "value" as const,
      name: "胜率",
      nameLocation: "middle" as const,
      nameGap: 26,
      min: axes.xMin,
      max: axes.xMax,
      axisLabel: { fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    yAxis: {
      type: "value" as const,
      name: "盈亏比",
      min: axes.yMin,
      max: axes.yMax,
      axisLabel: { fontSize: 10, formatter: (v: number) => v.toFixed(2) },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    series: [{
      name: "期望 0",
      type: "line" as const,
      showSymbol: false,
      silent: true,
      data: axes.curve,
      lineStyle: { type: "dashed" as const, width: 1, color: "#94a3b8" },
      itemStyle: { color: "#94a3b8" },
      endLabel: { show: true, formatter: "期望 0", fontSize: 10, color: "#64748b" },
      z: 1,
    }, {
      type: "scatter" as const,
      cursor: "pointer",
      symbolSize: 16,
      label: {
        show: true,
        formatter: (p: { name?: string }) => p.name ?? "",
        position: "top" as const,
        fontSize: 11,
        color: "#475569",
        distance: 8,
      },
      labelLayout: { hideOverlap: true },
      data: points,
    }],
  }
}

function dailyReturnPct(d: ApiData): number[] {
  const out: number[] = []
  for (const e of d.equity ?? []) {
    const prev = e.equity - e.pnl
    if (prev > 0 && Number.isFinite(e.pnl)) out.push((e.pnl / prev) * 100)
  }
  return out
}

function kdeBandwidth(xs: number[]): number {
  const n = xs.length
  if (n < 2) return 0.2
  const sorted = [...xs].sort((a, b) => a - b)
  const mean = xs.reduce((s, v) => s + v, 0) / n
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
  const q = (p: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))]!
  const iqr = q(0.75) - q(0.25)
  const sigma = Math.min(sd || iqr / 1.34, iqr > 0 ? iqr / 1.34 : sd) || 0.15
  return Math.max(0.05, 1.06 * sigma * n ** -0.2)
}

function gaussianKde(xs: number[], grid: number[], h: number): number[] {
  const n = xs.length
  const inv = 1 / (n * h * Math.sqrt(2 * Math.PI))
  const h2 = 2 * h * h
  return grid.map((x) => {
    let s = 0
    for (const v of xs) {
      const d = x - v
      s += Math.exp(-(d * d) / h2)
    }
    return s * inv
  })
}

function compareReturnPdfOption(rows: ApiData[]) {
  const books = rows.flatMap((r, i) => {
    const rets = dailyReturnPct(r)
    if (rets.length < 8) return []
    return [{ name: accLabel(r), color: PALETTE[i % PALETTE.length]!, rets }]
  })
  if (!books.length) return null
  const pooled = books.flatMap((b) => b.rets).sort((a, b) => a - b)
  const q = (p: number) => pooled[Math.min(pooled.length - 1, Math.max(0, Math.round(p * (pooled.length - 1))))]!
  const lo = q(0.01)
  const hi = q(0.99)
  const pad = Math.max(0.2, (hi - lo) * 0.2)
  const x0 = lo - pad
  const x1 = hi + pad
  const grid = Array.from({ length: 81 }, (_, i) => x0 + ((x1 - x0) * i) / 80)
  return {
    tooltip: { trigger: "axis" as const },
    legend: { top: 0, type: "scroll" as const, textStyle: { fontSize: 11 } },
    grid: { left: 48, right: 16, top: 32, bottom: 40 },
    xAxis: {
      type: "value" as const,
      name: "日收益",
      nameLocation: "middle" as const,
      nameGap: 26,
      min: x0,
      max: x1,
      axisLabel: { fontSize: 10, formatter: (v: number) => `${v.toFixed(1)}%` },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    yAxis: {
      type: "value" as const,
      name: "密度",
      axisLabel: { fontSize: 10, formatter: (v: number) => v.toFixed(2) },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    series: books.map((b, i) => {
      const density = gaussianKde(b.rets, grid, kdeBandwidth(b.rets))
      return {
        name: b.name,
        type: "line" as const,
        showSymbol: false,
        smooth: true,
        data: grid.map((x, k) => [x, density[k]]),
        lineStyle: { width: 2, color: b.color },
        itemStyle: { color: b.color },
        markLine: i === 0
          ? {
              silent: true,
              symbol: "none",
              label: { formatter: "0", fontSize: 10, color: "#64748b" },
              lineStyle: { type: "dashed" as const, color: "#94a3b8" },
              data: [{ xAxis: 0 }],
            }
          : undefined,
      }
    }),
  }
}

function edgeScatterOption(
  rows: { name: string; winRate: number | null; payoff: number | null; pnl: number; trades: number }[],
) {
  const usable = rows.filter((r) => r.winRate != null && Number.isFinite(r.winRate))
  if (!usable.length) return null
  const finiteY = usable.map((r) => r.payoff).filter((y): y is number => y != null && Number.isFinite(y))
  const maxFinite = finiteY.length ? Math.max(...finiteY) : 1
  const cap = Math.max(maxFinite * 1.25, 1.5)
  const points = usable.map((r) => {
    const capped = r.payoff == null && r.pnl > 0
    const y = capped ? cap : (r.payoff ?? 0)
    return {
      name: r.name,
      value: [r.winRate as number, y] as [number, number],
      pnl: r.pnl,
      capped,
      payoff: r.payoff,
      trades: r.trades,
    }
  })
  const paint = (pnl: number) => (pnl > 0 ? UP : pnl < 0 ? DOWN : "#94a3b8")
  const seriesOf = (name: string, pick: (pnl: number) => boolean) => {
    const data = points.filter((p) => pick(p.pnl)).map((p) => ({
      name: p.name,
      value: p.value,
      pnl: p.pnl,
      capped: p.capped,
      payoff: p.payoff,
      trades: p.trades,
      itemStyle: { color: paint(p.pnl), borderColor: "#fff", borderWidth: 1 },
    }))
    return {
      name,
      type: "scatter" as const,
      symbolSize: points.length > 24 ? 11 : 15,
      label: {
        show: true,
        formatter: (p: { name?: string }) => p.name ?? "",
        position: "top" as const,
        fontSize: 10,
        color: "#475569",
        distance: 6,
      },
      labelLayout: { hideOverlap: true },
      data,
    }
  }
  const xs = points.map((p) => p.value[0])
  const ys = points.map((p) => p.value[1])
  const axes = payoffAxes(xs, ys, 0.2)
  const series = [
    {
      name: "期望 0",
      type: "line" as const,
      showSymbol: false,
      silent: true,
      data: axes.curve,
      lineStyle: { type: "dashed" as const, width: 1, color: "#94a3b8" },
      itemStyle: { color: "#94a3b8" },
      endLabel: { show: true, formatter: "期望 0", fontSize: 10, color: "#64748b" },
      z: 1,
    },
    ...[
      seriesOf("盈利", (pnl) => pnl > 0),
      seriesOf("亏损", (pnl) => pnl < 0),
      seriesOf("持平", (pnl) => pnl === 0),
    ].filter((s) => s.data.length),
  ]
  return {
    tooltip: {
      formatter: (p: { data?: { name?: string; value?: [number, number]; pnl?: number; capped?: boolean; payoff?: number | null; trades?: number } }) => {
        const d = p.data
        if (!d || Array.isArray(d) || !d.value) return ""
        if (d.name === "期望 0" || d.value.length < 2) return ""
        const need = breakevenPayoff(d.value[0])
        const payoff = d.capped ? "无亏损，图上放在顶部" : (d.payoff == null ? "0" : d.payoff.toFixed(2))
        const y = d.capped ? cap : d.value[1]
        return [
          d.name ?? "",
          `交易笔数 ${(d.trades ?? 0).toLocaleString("zh-CN")}`,
          `胜率 ${d.value[0].toFixed(1)}%`,
          `盈亏比 ${payoff}（平均盈利 / |平均亏损|）`,
          `打平需要 ${need.toFixed(2)}`,
          `期望 ${y > need ? "正" : y < need ? "负" : "打平"}`,
          `合计 ${fmtWan(d.pnl ?? 0)}`,
        ].join("<br/>")
      },
    },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    grid: { left: 52, right: 28, top: 32, bottom: 40 },
    xAxis: {
      type: "value" as const,
      name: "胜率",
      nameLocation: "middle" as const,
      nameGap: 26,
      min: axes.xMin,
      max: axes.xMax,
      axisLabel: { fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    yAxis: {
      type: "value" as const,
      name: "盈亏比",
      min: axes.yMin,
      max: axes.yMax,
      axisLabel: { fontSize: 10, formatter: (v: number) => v.toFixed(2) },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    series,
  }
}

function compareFreqOption(rows: ApiData[]) {
  const books = rows.filter((r) => (r.tradeFrequency?.sectors.length ?? 0) > 0)
  const names = new Set<string>()
  for (const r of books) for (const s of r.tradeFrequency!.sectors) names.add(s.sector)
  const order = ["农产", "生鲜", "黑色", "有色", "贵金属", "能源化工", "新能源", "航运", "股指", "国债", "其他"]
  const sectors = [...names].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  if (!sectors.length) return null
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { seriesName?: string; name?: string; value?: number }[]) => {
        const head = ps[0]?.name ?? ""
        const lines = ps.map((p) => `${p.seriesName} ${p.value == null ? "—" : `${Number(p.value).toFixed(1)}%`}`)
        return [`${head} 成交天数占比`, ...lines].join("<br/>")
      },
    },
    legend: { top: 0, type: "scroll" as const, textStyle: { fontSize: 11 } },
    grid: { left: 44, right: 12, top: 32, bottom: 28 },
    xAxis: { type: "category" as const, data: sectors, axisLabel: { fontSize: 11 } },
    yAxis: {
      type: "value" as const,
      name: "%",
      axisLabel: { fontSize: 10 },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    series: books.map((r, i) => ({
      name: accLabel(r),
      type: "bar" as const,
      barMaxWidth: 14,
      itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: 2 },
      data: sectors.map((name) => r.tradeFrequency!.sectors.find((s) => s.sector === name)?.share ?? 0),
    })),
  }
}

function sectorVolOption(series: SectorVolSeries, window: number) {
  const rows = series.points
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (ps: { axisValue?: string; seriesName?: string; value?: number | null }[]) => {
        const date = ps[0]?.axisValue ?? ""
        const lines = ps.map((p) => {
          if (p.value == null || Number.isNaN(p.value)) return `${p.seriesName} —`
          return `${p.seriesName} ${Number(p.value).toFixed(1)}%`
        })
        return [date, ...lines].join("<br/>")
      },
    },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    grid: { left: 48, right: 48, top: 32, bottom: 28 },
    dataZoom: [{ type: "inside" as const }],
    xAxis: { type: "category" as const, data: rows.map((r) => r.date.slice(5)), axisLabel: { fontSize: 10 } },
    yAxis: [
      { type: "value" as const, name: "波动%", axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } } },
      { type: "value" as const, name: "风险%", axisLabel: { fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [
      {
        name: `${window}日市场波动`,
        type: "line" as const,
        showSymbol: false,
        yAxisIndex: 0,
        data: rows.map((r) => r.vol),
        lineStyle: { width: 1.5, color: AMBER },
        itemStyle: { color: AMBER },
      },
      {
        name: "风险贡献",
        type: "line" as const,
        showSymbol: false,
        yAxisIndex: 1,
        data: rows.map((r) => r.risk),
        lineStyle: { width: 2, color: sectorColor(series.sector) },
        itemStyle: { color: sectorColor(series.sector) },
      },
    ],
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
  const [pairPick, setPairPick] = useState(false)
  const [pairIds, setPairIds] = useState<string[]>([])
  const [pairSlot, setPairSlot] = useState<0 | 1>(0)
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
    const coreParams = new URLSearchParams({ account: nextAccount, from: nextFrom, to: nextTo, scope: "core" })
    const fullParams = new URLSearchParams({ account: nextAccount, from: nextFrom, to: nextTo })
    const coreP = fetch(`/ma/api/mom-analysis/quant-strategy?${coreParams}`, { cache: "no-store" })
      .then(async (res) => ({ res, json: await res.json() as ApiData }))
    const fullP = fetch(`/ma/api/mom-analysis/quant-strategy?${fullParams}`, { cache: "no-store" })
      .then(async (res) => ({ res, json: await res.json() as ApiData }))
    try {
      const { res, json } = await coreP
      if (reqId !== loadSeq.current) return
      if (!res.ok || !json.ok) throw new Error(json.error || "请求失败")
      shownRef.current = json
      setData(json)
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
      const { res, json } = await fullP
      if (reqId !== loadSeq.current) return
      if (!res.ok || !json.ok) return
      shownRef.current = json
      setData(json)
    } catch {
      if (reqId !== loadSeq.current) return
    } finally {
      if (reqId === loadSeq.current) setFactorPending(false)
    }
  }, [])

  const loadCompare = useCallback(async (
    nextFrom = from,
    nextTo = to,
    accountIds: readonly (string | number)[] = QUANT_ACCOUNT_IDS,
  ) => {
    const reqId = ++compareSeq.current
    setCompareLoading(true)
    setCompareError(null)
    const ids = accountIds.map(String)
    const fetchOne = async (id: string): Promise<ApiData> => {
      const params = new URLSearchParams({ account: id, from: nextFrom, to: nextTo, scope: "core" })
      let last: unknown = new Error(`rx${id} 请求失败`)
      for (let attempt = 0; attempt < 3; attempt++) {
        if (reqId !== compareSeq.current) throw new Error("stale")
        try {
          const res = await fetch(`/ma/api/mom-analysis/quant-strategy?${params}`, { cache: "no-store" })
          const json = await res.json() as ApiData
          if (!res.ok || !json.ok) throw new Error(json.error || `rx${id} 请求失败`)
          return json
        } catch (e) {
          last = e
          if (attempt < 2 && reqId === compareSeq.current) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
          }
        }
      }
      throw last instanceof Error ? last : new Error(`rx${id} 请求失败`)
    }
    try {
      const settled = await Promise.allSettled(ids.map((id) => fetchOne(id)))
      if (reqId !== compareSeq.current) return
      const ok: ApiData[] = []
      const missing: string[] = []
      const broken: string[] = []
      settled.forEach((s, i) => {
        const name = `rx${ids[i]}`
        if (s.status === "fulfilled" && !s.value.notYetRun) ok.push(s.value)
        else if (s.status === "fulfilled") missing.push(name)
        else if (s.reason instanceof Error && s.reason.message === "stale") return
        else broken.push(name)
      })
      setCompareRows(ok)
      setCompareBounds({ from: nextFrom, to: nextTo })
      const notes = [
        missing.length ? `${missing.join("、")} 暂无数据` : "",
        broken.length ? `${broken.join("、")} 加载失败` : "",
      ].filter(Boolean)
      if (!ok.length) setCompareError(notes.join("，") || "没有可对比的账户")
      else setCompareError(notes.length ? `${notes.join("，")}，已对照其余账户` : null)
    } catch (e) {
      if (reqId !== compareSeq.current) return
      setCompareError(e instanceof Error ? e.message : "对比加载失败")
    } finally {
      if (reqId === compareSeq.current) setCompareLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    if (compareMode) return
    void load(accountId, from, to)
  }, [accountId, from, to, load, compareMode])

  useEffect(() => {
    if (!compareMode || !pairPick) return
    if (pairIds.length !== 2) {
      compareSeq.current += 1
      setCompareLoading(false)
      setCompareError(null)
      return
    }
    void loadCompare(from, to, pairIds)
  }, [compareMode, pairPick, pairIds, from, to, loadCompare])

  const selectAccount = (id: string) => {
    setCompareMode(false)
    setPairPick(false)
    setAccountId(id)
  }

  const pickPairAccount = (id: string) => {
    const left = pairIds[0] ?? ""
    const right = pairIds[1] ?? ""
    if (id === left) {
      setPairSlot(0)
      return
    }
    if (id === right) {
      setPairSlot(1)
      return
    }
    if (pairSlot === 0) {
      if (right) setCompareLoading(true)
      setPairIds(right ? [id, right] : [id])
      if (!right) setPairSlot(1)
      return
    }
    if (!left) {
      setPairIds([id])
      setPairSlot(1)
      return
    }
    setCompareLoading(true)
    setPairIds([left, id])
  }

  const selectRange = (label: RangeLabel) => {
    const next = boundsFor(label)
    setRange(label)
    setBounds(next)
    if (compareMode && !pairPick) void loadCompare(next.from, next.to)
  }

  const toggleCompare = () => {
    if (compareMode && !pairPick) {
      setCompareMode(false)
      return
    }
    setPairPick(false)
    setCompareMode(true)
    if (pairPick || !compareBounds || compareBounds.from !== from || compareBounds.to !== to || !compareRows.length) {
      void loadCompare(from, to)
    }
  }

  const togglePairMode = () => {
    if (compareMode && pairPick) {
      setCompareMode(false)
      setPairPick(false)
      return
    }
    const nextIds = pairIds.length ? pairIds : [accountId]
    if (nextIds.length === 2) setCompareLoading(true)
    setPairIds(nextIds)
    setPairSlot(nextIds[1] ? 0 : 1)
    setCompareRows([])
    setCompareError(null)
    setPairPick(true)
    setCompareMode(true)
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

  const rrShape = data?.rrShape
  const rrHistOption = useMemo(() => {
    const bins = rrShape?.bins ?? []
    if (!bins.some((n) => n > 0)) return {}
    const clip = rrShape?.clip ?? 20000
    const nBins = bins.length
    const step = (clip * 2) / nBins
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (ps: { dataIndex?: number; value?: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0
          const lo = -clip + i * step
          const hi = lo + step
          const count = bins[i] ?? 0
          return `${fmtInt(lo)} ~ ${fmtInt(hi)} 元<br/>${fmtInt(count)} 笔`
        },
      },
      grid: { left: 52, right: 16, top: 16, bottom: 52 },
      xAxis: [
        {
          type: "category",
          data: bins.map((_, i) => String(i)),
          axisLabel: { show: false },
          axisTick: { show: false },
          axisLine: { show: false },
        },
        {
          type: "value",
          min: -clip,
          max: clip,
          name: "单笔逐笔平仓盈亏（元，已截尾）",
          nameLocation: "middle",
          nameGap: 28,
          nameTextStyle: { fontSize: 11, color: "#4A5568" },
          axisLabel: { fontSize: 10, color: "#4A5568", formatter: (v: number) => fmtInt(v) },
          splitLine: { show: false },
          axisLine: { lineStyle: { color: "#A0AEC0" } },
        },
      ],
      yAxis: {
        type: "value",
        name: "笔数",
        nameTextStyle: { fontSize: 11, color: "#4A5568" },
        axisLabel: { fontSize: 10, color: "#4A5568" },
        splitLine: { lineStyle: { color: "#E2E8F0" } },
      },
      series: [
        {
          type: "bar",
          xAxisIndex: 0,
          data: bins,
          barCategoryGap: "12%",
          itemStyle: { color: "rgba(26,54,93,0.85)" },
        },
        {
          type: "line",
          xAxisIndex: 1,
          data: [[0, 0]],
          symbol: "none",
          silent: true,
          lineStyle: { opacity: 0 },
          tooltip: { show: false },
          markLine: {
            symbol: "none",
            silent: true,
            animation: false,
            lineStyle: { color: "#C9A227", width: 1.2 },
            label: { show: false },
            data: [{ xAxis: 0 }],
          },
        },
      ],
    }
  }, [rrShape])

  const factorFamilies = data?.regimeFactors?.families ?? []
  const heatmapCells = data?.regimeFactors?.heatmap ?? []
  const heatmapOption = useMemo(() => heatmapChartOption(heatmapCells), [heatmapCells])

  const linearOptions = useMemo(
    () => (data?.linearScatters?.charts ?? []).map((ch) => ({ ch, option: linearScatterOption(ch) })),
    [data?.linearScatters],
  )

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

  const sectorEdgeChart = useMemo(() => {
    const trades = new Map<string, number>()
    for (const p of data?.products ?? []) trades.set(p.sector, (trades.get(p.sector) ?? 0) + p.n)
    return edgeScatterOption((data?.sectors ?? []).map((s) => ({
      name: s.sector,
      winRate: s.winRate ?? null,
      payoff: s.payoff ?? null,
      pnl: s.pnl,
      trades: trades.get(s.sector) ?? 0,
    })))
  }, [data?.sectors, data?.products])
  const productEdgeChart = useMemo(
    () => edgeScatterOption((data?.products ?? []).map((p) => ({
      name: p.name,
      winRate: p.winRate,
      payoff: p.payoff ?? null,
      pnl: p.pnl,
      trades: p.n,
    }))),
    [data?.products],
  )

  const bookRisk = data?.bookRisk
  const bookSectorChart = useMemo(() => (bookRisk?.sectors.length ? bookSectorOption(bookRisk) : null), [bookRisk])
  const bookTreeChart = useMemo(() => (bookRisk?.sectors.length ? bookTreeOption(bookRisk) : null), [bookRisk])
  const tradeFrequency = data?.tradeFrequency
  const freqSectorChart = useMemo(() => (tradeFrequency?.sectors.length ? freqSectorOption(tradeFrequency) : null), [tradeFrequency])
  const alphaBeta = data?.alphaBeta
  const alphaBetaChart = useMemo(() => (alphaBeta?.points.length ? alphaBetaOption(alphaBeta) : null), [alphaBeta])
  const alphaNavChart = useMemo(() => ((alphaBeta?.nav?.length ?? 0) > 1 ? alphaNavOption(alphaBeta!) : null), [alphaBeta])
  const sectorAlphaChart = useMemo(
    () => ((alphaBeta?.sectors?.length ?? 0) > 0 ? sectorAlphaOption(alphaBeta!) : null),
    [alphaBeta],
  )
  const sectorVol = data?.sectorVol
  const sectorVolCharts = useMemo(
    () => (sectorVol?.sectors ?? []).filter((s) => s.points.length > 0).map((s) => ({ sector: s.sector, option: sectorVolOption(s, sectorVol?.window ?? 20) })),
    [sectorVol],
  )

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
      tooltip: {
        trigger: "axis" as const,
        formatter: (ps: { dataIndex?: number }[]) => {
          const row = rows[ps[0]?.dataIndex ?? 0]
          if (!row) return ""
          const need = row.winRate != null && row.winRate > 0 ? (100 - row.winRate) / row.winRate : null
          return [
            row.date,
            `胜率 ${row.winRate == null ? "—" : row.winRate.toFixed(1)}%`,
            `盈亏比 ${row.payoff == null ? "—" : row.payoff.toFixed(2)}（平均盈利 / |平均亏损|）`,
            need == null ? "" : `打平需要 ${need.toFixed(2)}`,
            `窗口盈亏 ${fmtWan(row.pnl)}`,
          ].filter(Boolean).join("<br/>")
        },
      },
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
      tooltip: {
        trigger: "axis" as const,
        formatter: (ps: { dataIndex?: number }[]) => {
          const row = rows[ps[0]?.dataIndex ?? 0]
          if (!row) return ""
          const need = row.winRate != null && row.winRate > 0 ? (100 - row.winRate) / row.winRate : null
          const pnl = row.pnl ?? 0
          return [
            `${row.label} ${row.days}天`,
            `胜率 ${row.winRate == null ? "—" : row.winRate.toFixed(1)}%`,
            `盈亏比 ${row.payoff == null ? "—" : row.payoff.toFixed(2)}（平均盈利 / |平均亏损|）`,
            need == null ? "" : `打平需要 ${need.toFixed(2)}`,
            `期望 ${pnl > 0 ? "正" : pnl < 0 ? "负" : "平"} · 这段盈亏 ${fmtWan(row.pnl)}`,
          ].filter(Boolean).join("<br/>")
        },
      },
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
            {pairPick
              ? "先点「左」或「右」选定要换的一侧，再点账户。两侧都可以换。"
              : compareMode
                ? "同一区间下横向对照各量化账户的策略画像、绩效与权益曲线。点击账户进入单账户详情。"
                : "选择量化账户，用成交、平仓与日核算倒推策略画像：适合什么市、怎么管风险、盈亏偏好、是否对冲、日盘还是夜盘、盈亏单持仓多久。"}
          </p>
          {!compareMode && data?.account && (
            <p className="text-xs text-muted-foreground mt-1">
              {data.account} · {data.from} 至 {data.to} · {k?.tradingDays ?? 0} 个交易日 · {k?.nCloses ?? 0} 笔平仓
            </p>
          )}
          {compareMode && !pairPick && (compareRows[0]?.from || from) && (
            <p className="text-xs text-muted-foreground mt-1">
              {compareRows[0]?.from ?? from} 至 {compareRows[0]?.to ?? to} · {compareRows.length} 个量化账户
            </p>
          )}
          {pairPick && (
            <p className="text-xs text-muted-foreground mt-1">
              {pairIds.length === 2
                ? `${compareRows[0]?.from ?? from} 至 ${compareRows[0]?.to ?? to} · rx${pairIds[0]} 与 rx${pairIds[1]} · 正在选${pairSlot === 0 ? "左侧" : "右侧"}`
                : pairSlot === 0
                  ? `正在选左侧${pairIds[0] ? `，当前 rx${pairIds[0]}` : ""}`
                  : pairIds[0]
                    ? `正在选右侧，左侧是 rx${pairIds[0]}`
                    : "先点一个账户作为左侧"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={compareMode && !pairPick ? "default" : "outline"} onClick={toggleCompare} disabled={compareLoading}>
            <Columns2 className="h-3.5 w-3.5 mr-1.5" />
            {compareMode && !pairPick ? "退出对比" : "横向对比"}
          </Button>
          <Button size="sm" variant={pairPick ? "default" : "outline"} onClick={togglePairMode} disabled={compareLoading}>
            <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" />
            {pairPick ? "退出双账户" : "双账户对比"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (pairPick) {
                if (pairIds.length === 2) void loadCompare(from, to, pairIds)
                return
              }
              void (compareMode ? loadCompare() : load(accountId, from, to))
            }}
            disabled={pairPick ? pairIds.length !== 2 || compareLoading : compareMode ? compareLoading : loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${(compareMode ? compareLoading : loading) ? "animate-spin" : ""}`} />
            {(pairPick ? compareLoading && pairIds.length === 2 : compareMode ? compareLoading : loading) ? "加载中" : "刷新"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">账户</span>
        {ids.map((id) => {
          const pairIndex = pairIds.indexOf(String(id))
          const active = pairPick ? pairIndex >= 0 : !compareMode && String(id) === accountId
          return (
            <button
              key={id}
              onClick={() => (pairPick ? pickPairAccount(String(id)) : selectAccount(String(id)))}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              rx{id}
              {pairPick && pairIndex >= 0 ? (pairIndex === 0 ? " 左" : " 右") : ""}
            </button>
          )
        })}
      </div>
      {pairPick && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setPairSlot(0)}
            className={`rounded-md border px-2.5 py-1 font-medium ${
              pairSlot === 0
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background text-foreground hover:bg-muted"
            }`}
          >
            左 {pairIds[0] ? `rx${pairIds[0]}` : "点选账户"}
          </button>
          <span className="text-xs text-muted-foreground">对比</span>
          <button
            type="button"
            onClick={() => setPairSlot(1)}
            className={`rounded-md border px-2.5 py-1 font-medium ${
              pairSlot === 1
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background text-foreground hover:bg-muted"
            }`}
          >
            右 {pairIds[1] ? `rx${pairIds[1]}` : "点选账户"}
          </button>
          <span className="text-xs text-muted-foreground">点亮的一侧会被下一个账户替换</span>
        </div>
      )}
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
      {compareMode && pairPick && pairIds.length < 2 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {pairSlot === 0
            ? `正在选左侧${pairIds[0] ? `，当前 rx${pairIds[0]}` : ""}。点一个账户。`
            : pairIds[0]
              ? `正在选右侧。左侧是 rx${pairIds[0]}，点一个账户。`
              : "先点「左」，再点一个账户。"}
        </p>
      ) : compareMode ? (
        <CompareView rows={compareRows} loading={compareLoading} onOpenAccount={selectAccount} />
      ) : (
      <div key={viewKey} className={`space-y-5 ${loading ? "opacity-60 pointer-events-none" : ""}`}>
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{data?.portrait.strategyLabel ? labelWithoutVol(data.portrait.strategyLabel) : (loading ? "分析中…" : "—")}</h2>
          <HoldBadge label={data?.portrait.strategyLabel} />
          <VolBadge label={data?.portrait.strategyLabel} />
          <PeriodBadge />
          {k?.corrNhci != null && (
            <span className="text-xs text-muted-foreground">南华相关 {k.corrNhci}</span>
          )}
        </div>
        <BookStyleMarks style={data?.portrait.bookStyle} />
        <p className="text-sm text-muted-foreground leading-relaxed">{data?.portrait.summary}</p>
        {data?.factorDml && data.portrait?.strategyLabel && (
          <p className="text-sm leading-relaxed">{readFactorSupport(data.factorDml, data.portrait.strategyLabel, { hedged: (data.kpis?.hedgeRatioAvg ?? 0) >= 50 })?.portrait}</p>
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

      {(sectorEdgeChart || productEdgeChart) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sectorEdgeChart && (
            <ChartCard
              title="板块：胜率 × 盈亏比"
              caption="每个点是一个板块。盈亏比是平均盈利 / |平均亏损|。虚线是期望为 0：胜率越高，打平所需的盈亏比越低。点在线上方，这段合计为正。"
              help={CHART_HELP.edgeScatter}
            >
              <ReactECharts key={`${viewKey}-edge-sec`} option={sectorEdgeChart} style={{ height: 340, width: "100%" }} notMerge />
            </ChartCard>
          )}
          {productEdgeChart && (
            <ChartCard
              title="品种：胜率 × 盈亏比"
              caption="每个点是一个品种。盈亏比是平均盈利 / |平均亏损|。90% 胜率、盈亏比 0.8 仍在期望 0 线上方。没有亏损的品种点放在顶部。"
              help={CHART_HELP.edgeScatter}
            >
              <ReactECharts key={`${viewKey}-edge-prod`} option={productEdgeChart} style={{ height: 340, width: "100%" }} notMerge />
            </ChartCard>
          )}
        </div>
      )}

      {alphaBeta && alphaBetaChart && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-medium">盈亏来自 alpha 还是 beta</h2>
              <QuantChartHelp spec={CHART_HELP.alphaBeta} />
            </div>
            <PeriodBadge />
          </div>
          <p className="text-sm leading-relaxed">{alphaBeta.headline}</p>
          {alphaBeta.sectorHeadline && (
            <p className="text-sm leading-relaxed text-muted-foreground">{alphaBeta.sectorHeadline}</p>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Kpi title="alpha 合计" value={fmtWan(alphaBeta.alphaPnl)} accent={pnlColor(alphaBeta.alphaPnl)} hint="不跟着南华的部分" />
            <Kpi title="beta 合计" value={fmtWan(alphaBeta.betaPnl)} accent={pnlColor(alphaBeta.betaPnl)} hint="跟着南华涨跌的部分" />
            <Kpi title="每 1% 南华" value={fmtWan(alphaBeta.betaPerPct)} hint="回归斜率，元" />
            <Kpi
              title="alpha 的 t"
              value={alphaBeta.alphaT == null ? "—" : alphaBeta.alphaT.toFixed(2)}
              hint={alphaBeta.alphaStance || "截距是否显著"}
            />
            <Kpi
              title="beta 的 t / R²"
              value={`${alphaBeta.t == null ? "—" : alphaBeta.t.toFixed(2)} / ${alphaBeta.r2 == null ? "—" : alphaBeta.r2.toFixed(2)}`}
              hint={`${alphaBeta.n} 个有南华行情的交易日`}
            />
            <Kpi title="稳定性" value={alphaBeta.alphaStance || "—"} hint="前后半段 alpha 是否同号" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {alphaNavChart && (
              <ChartCard
                title="账户净值与南华商品指数"
                caption="两条线都从 100 起算，只用同一批有南华行情的交易日。账户净值按当日盈亏 / 上日权益连乘，不含出入金。"
                help={CHART_HELP.alphaBeta}
              >
                <ReactECharts key={`${viewKey}-alpha-nav`} option={alphaNavChart} style={{ height: 320, width: "100%" }} notMerge />
              </ChartCard>
            )}
            <ChartCard
              title="累计 alpha 与累计 beta"
              caption="日盈亏（元）对南华日涨跌（%）回归。beta 盈亏 = 斜率 × 当天涨跌；alpha = 当天盈亏 − beta。只含有南华行情的交易日。"
              help={CHART_HELP.alphaBeta}
            >
              <ReactECharts key={`${viewKey}-alpha-beta`} option={alphaBetaChart} style={{ height: 320, width: "100%" }} notMerge />
            </ChartCard>
          </div>
          {sectorAlphaChart && (
            <ChartCard
              title="各板块的 alpha"
              caption="每个板块用自己的日盈亏对南华回归。红柱是这段多出来的盈利，绿柱是多出来的亏损。悬停看 t 和稳定性。各板块 alpha 加总不必等于账户 alpha。"
              help={CHART_HELP.alphaBeta}
            >
              <ReactECharts
                key={`${viewKey}-sector-alpha`}
                option={sectorAlphaChart}
                style={{ height: Math.max(220, (alphaBeta.sectors?.length ?? 1) * 28 + 48), width: "100%" }}
                notMerge
              />
            </ChartCard>
          )}
        </div>
      )}

      <QuantTraderExposureCharts accountId={accountId} from={from} to={to} />

      {bookRisk && bookRisk.sectors.length > 0 && bookSectorChart && bookTreeChart && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-medium">交易范围</h2>
              <QuantChartHelp spec={CHART_HELP.bookRisk} />
            </div>
            <PeriodBadge />
          </div>
          <p className="text-sm leading-relaxed">{bookRisk.headline}</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi title="交易板块" value={String(bookRisk.sectorCount)} hint={bookRisk.stance} />
            <Kpi title="交易品种" value={String(bookRisk.productCount)} hint={`${bookRisk.days} 个有风险贡献的交易日`} />
            <Kpi
              title="板块有效个数"
              value={`${bookRisk.effective.toFixed(1)} / ${bookRisk.sectorCount}`}
              hint="等权时有效个数接近板块数"
            />
            <Kpi
              title="风险最大板块"
              value={bookRisk.topSector ? `${bookRisk.topSector} ${bookRisk.topShare?.toFixed(0) ?? ""}%` : "—"}
              hint={`等权 ${bookRisk.equalShare.toFixed(0)}%`}
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard
              title="板块风险贡献"
              caption={`柱子是该板块占组合方差的比例。虚线是 ${bookRisk.sectorCount} 个板块等权（${bookRisk.equalShare.toFixed(0)}%）。明显高于虚线就是偏好该板块。`}
              help={CHART_HELP.bookRisk}
            >
              <ReactECharts key={`${viewKey}-book-sec`} option={bookSectorChart} style={{ height: Math.max(220, bookRisk.sectors.length * 32 + 40), width: "100%" }} notMerge />
            </ChartCard>
            <ChartCard
              title="品种占组合风险"
              caption="面积是品种风险贡献，不是持仓市值。同一颜色是一个板块。块越大，风险越集中在这个名字上。"
              help={CHART_HELP.bookRisk}
            >
              <ReactECharts key={`${viewKey}-book-tree`} option={bookTreeChart} style={{ height: 340, width: "100%" }} notMerge />
            </ChartCard>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {bookRisk.sectors.map((sector) => (
              <ChartCard
                key={sector.sector}
                title={`${sector.sector} · 风险贡献 ${sector.riskShare.toFixed(1)}% · ${sector.productCount} 个品种`}
                caption={
                  sector.stance === "单一"
                    ? `只做${sector.topProduct ?? "一个品种"}。柱子是该品种占这个板块风险的比例。`
                    : `${sector.stance}。虚线是板块内等权 ${sector.productCount > 0 ? (100 / sector.productCount).toFixed(0) : "—"}%。柱子是占该板块风险的比例，不是市值。`
                }
              >
                <ReactECharts
                  key={`${viewKey}-book-${sector.sector}`}
                  option={withinSectorOption(sector)}
                  style={{ height: Math.max(160, Math.min(sector.products.length, 8) * 28 + 36), width: "100%" }}
                  notMerge
                />
              </ChartCard>
            ))}
          </div>
        </div>
      )}

      {tradeFrequency && tradeFrequency.sectors.length > 0 && freqSectorChart && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-medium">交易频率</h2>
              <QuantChartHelp spec={CHART_HELP.tradeFreq} />
            </div>
            <PeriodBadge />
          </div>
          <p className="text-sm leading-relaxed">{tradeFrequency.headline}</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi title="板块之间" value={tradeFrequency.stance} hint={`卡方 p ${fmtFreqP(tradeFrequency.p)}`} />
            <Kpi title="成交最多的板块" value={tradeFrequency.topSector ? `${tradeFrequency.topSector} ${tradeFrequency.topShare?.toFixed(0) ?? ""}%` : "—"} hint={`等权 ${tradeFrequency.equalShare.toFixed(0)}%`} />
            <Kpi title="板块数" value={String(tradeFrequency.sectorCount)} hint="有开仓或平仓才计入" />
            <Kpi title="品种数" value={String(tradeFrequency.productCount)} hint="按有成交的品种" />
          </div>
          <ChartCard
            title="板块成交天数"
            caption={`柱子是有成交的天数。虚线是 ${tradeFrequency.sectorCount} 个板块天数相同。同一天做了两个板块，两边都计一天。卡方 p ${fmtFreqP(tradeFrequency.p)}。`}
            help={CHART_HELP.tradeFreq}
          >
            <ReactECharts key={`${viewKey}-freq-sec`} option={freqSectorChart} style={{ height: Math.max(220, tradeFrequency.sectors.length * 32 + 40), width: "100%" }} notMerge />
          </ChartCard>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {tradeFrequency.sectors.map((sector) => (
              <ChartCard
                key={sector.sector}
                title={`${sector.sector} · 频率占 ${sector.share.toFixed(1)}% · ${sector.stance} · ${sector.productCount} 个品种`}
                caption={
                  sector.stance === "单一"
                    ? `只在${sector.topProduct ?? "一个品种"}有成交。这个板块有成交 ${sector.days} 天。`
                    : `板块内卡方 p ${fmtFreqP(sector.p)}。虚线是这 ${sector.productCount} 个品种天数相同。柱子是有成交的天数。这个板块有成交 ${sector.days} 天，占各板块天数 ${sector.share.toFixed(1)}%。`
                }
              >
                <ReactECharts
                  key={`${viewKey}-freq-${sector.sector}`}
                  option={freqWithinOption(sector)}
                  style={{ height: Math.max(160, Math.min(sector.products.length, 8) * 28 + 36), width: "100%" }}
                  notMerge
                />
              </ChartCard>
            ))}
          </div>
        </div>
      )}

      {sectorVolCharts.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-medium">板块波动与敞口</h2>
              <QuantChartHelp spec={CHART_HELP.sectorVol} />
            </div>
            <PeriodBadge />
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            每张图一个板块。琥珀色是该板块主力合约等权收益的 {sectorVol?.window ?? 20} 日年化波动。彩色线是账户当天的风险贡献，占组合方差的比例。
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sectorVolCharts.map((chart) => (
              <ChartCard
                key={chart.sector}
                title={`${chart.sector} · 市场波动与风险贡献`}
                caption="左轴是市场波动，右轴是风险贡献。市场波动用全市场主力合约，不是这个账户的持仓波动。"
                help={CHART_HELP.sectorVol}
              >
                <ReactECharts key={`${viewKey}-vol-${chart.sector}`} option={chart.option} style={{ height: 280, width: "100%" }} notMerge />
              </ChartCard>
            ))}
          </div>
        </div>
      )}

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
            <ChartCard title="胜率与盈亏比" caption={`每 ${stability.window} 个交易日滚一次。胜率和盈亏比含平仓和持仓，盈亏比是平均盈利 / |平均亏损|。窗口盈亏等于这些日子的日报净盈亏。`}>
              <ReactECharts key={`${viewKey}-stab-wp`} option={stabilityOption} style={{ height: 280, width: "100%" }} notMerge />
            </ChartCard>
            <ChartCard title="不同市况下的胜率与盈亏比" caption="趋势/震荡按南华 5、20、60 日是否同向。胜率和盈亏比含平仓和持仓。盈亏比可以低于 1 而期望仍为正。悬停里的这段盈亏等于这些日子的日报净盈亏。">
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
            ? readFactorSupport(data.factorDml, data.portrait.strategyLabel, { hedged: (data.kpis?.hedgeRatioAvg ?? 0) >= 50 })?.inference
            : undefined}
        />
      )}

      {data?.linearScatters && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-medium">策略里的直线关系</h2>
              <QuantChartHelp spec={LINEAR_HELP} />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>检验 {data.linearScatters.tested} 组 · 展示 {data.linearScatters.shown} 张</span>
              <PeriodBadge />
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.linearScatters.headline}</p>
          {linearOptions.length > 0 && (
            <div className={`grid grid-cols-1 gap-4 ${linearOptions.length > 1 ? "lg:grid-cols-2" : ""}`}>
              {linearOptions.map(({ ch, option }) => (
                <ChartCard key={`${viewKey}-lin-${ch.id}`} title={ch.title} caption={ch.detail}>
                  <ReactECharts key={`${viewKey}-lin-${ch.id}`} option={option} style={{ height: 280, width: "100%" }} notMerge />
                </ChartCard>
              ))}
            </div>
          )}
        </div>
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
        <Kpi title="日胜率 / 胜率（含持仓）" value={`${fmtPct(k?.dayWinRate, 0)} / ${fmtPct(k?.tradeWinRate, 0)}`} hint={`盈亏比 ${k?.payoff?.toFixed(2) ?? "—"} · 期望合计 ${fmtWan(k?.expectancy)}`} />
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

      <ChartCard
        title="单笔盈亏分布：胜率与盈亏比的微观形状"
        caption="高峰贴着零、左右大致对称，是广度策略；右尾极长、左尾被砍，才是趋势跟踪。横轴截到 ±2 万元。"
        help={CHART_HELP.rrShape}
      >
        {(rrShape?.bins.some((n) => n > 0)) && (
          <ReactECharts key={`${viewKey}-rr`} option={rrHistOption} style={{ height: 320, width: "100%" }} notMerge />
        )}
        <p className="text-xs text-muted-foreground mt-2 mb-2">
          盈亏比 = 平均赢 / 平均亏；利润因子 = 总盈利 / 总亏损。逐笔用平仓明细「逐笔平仓盈亏」。日盈亏用核算日报「当日盈亏」。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left font-medium py-2 pr-3">层级</th>
                <th className="text-right font-medium py-2 px-2">样本</th>
                <th className="text-right font-medium py-2 px-2">胜率</th>
                <th className="text-right font-medium py-2 px-2">平均赢</th>
                <th className="text-right font-medium py-2 px-2">平均亏</th>
                <th className="text-right font-medium py-2 px-2">盈亏比</th>
                <th className="text-right font-medium py-2 px-2">利润因子</th>
                <th className="text-right font-medium py-2 pl-2">期望</th>
              </tr>
            </thead>
            <tbody>
              {(rrShape?.layers ?? []).map((row) => (
                <tr key={row.key} className="border-b border-border/60">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{row.label}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtInt(row.n)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtPct(row.winRate, 1)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtMoney(row.avgWin)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtMoney(row.avgLoss)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{row.payoff == null ? "—" : row.payoff.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{row.profitFactor == null ? "—" : row.profitFactor.toFixed(2)}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums" style={{ color: row.expectancy == null ? undefined : pnlColor(row.expectancy) }}>{fmtMoney(row.expectancy, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

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
          <p className="text-xs text-muted-foreground mt-0.5">按合计盈亏（平仓 + 盯市）排序。胜率和盈亏比含当天持仓盈亏。持仓天数仍按平仓。</p>
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
                  <td className="py-1.5 px-2 text-right tabular-nums">{row.payoff?.toFixed(2) ?? "—"}</td>
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
    const pf = rows.map((r) => r.kpis?.payoff)
    const sharpe = rows.map((r) => r.kpis?.sharpe)
    const dd = rows.map((r) => r.kpis?.maxDdPct)
    const left = rows[0]
    const right = rows[1]
    const pair = rows.length === 2 && left != null && right != null
    const deltaOf = (
      pick: (r: ApiData) => number | null | undefined,
      fmt: (n: number) => string,
      colorize = false,
    ): string | { text: string; color?: string } | undefined => {
      if (!pair || !left || !right) return undefined
      const a = pick(left)
      const b = pick(right)
      if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return "—"
      const n = a - b
      const text = fmt(n)
      return colorize ? { text, color: pnlColor(n) } : text
    }
    return [
      { label: "策略画像", values: rows.map((r) => r.portrait?.strategyLabel ?? "—"), delta: undefined },
      {
        label: "结构",
        values: rows.map((r) => {
          const b = r.portrait?.bookStyle
          if (!b?.primary) return "—"
          return b.secondary ? `${b.primary} / ${b.secondary}` : b.primary
        }),
        delta: undefined,
      },
      {
        label: "区间净盈亏",
        values: rows.map((r) => ({ text: fmtWan(r.kpis?.totalPnl), color: pnlColor(r.kpis?.totalPnl ?? 0) })),
        best: bestSet(pnls, "max"),
        delta: deltaOf((r) => r.kpis?.totalPnl, fmtWan, true),
      },
      { label: "日胜率", values: rows.map((r) => fmtPct(r.kpis?.dayWinRate, 0)), best: bestSet(dayWr, "max"), delta: deltaOf((r) => r.kpis?.dayWinRate, (n) => signedPctPoints(n, 0)) },
      { label: "胜率（含持仓）", values: rows.map((r) => fmtPct(r.kpis?.tradeWinRate, 0)), best: bestSet(tradeWr, "max"), delta: deltaOf((r) => r.kpis?.tradeWinRate, (n) => signedPctPoints(n, 0)) },
      { label: "盈亏比", values: rows.map((r) => r.kpis?.payoff?.toFixed(2) ?? "—"), best: bestSet(pf, "max"), delta: deltaOf((r) => r.kpis?.payoff, (n) => signedFixed(n, 2), true) },
      { label: "夏普", values: rows.map((r) => r.kpis?.sharpe?.toFixed(2) ?? "—"), best: bestSet(sharpe, "max"), delta: deltaOf((r) => r.kpis?.sharpe, (n) => signedFixed(n, 2), true) },
      { label: "最大回撤", values: rows.map((r) => fmtPct(r.kpis?.maxDdPct)), best: bestSet(dd, "max"), delta: deltaOf((r) => r.kpis?.maxDdPct, (n) => signedPctPoints(n, 1)) },
      {
        label: "盈/亏持仓天数",
        values: rows.map((r) => `${r.kpis?.avgHoldWin?.toFixed(1) ?? "—"} / ${r.kpis?.avgHoldLoss?.toFixed(1) ?? "—"}`),
        delta: undefined,
      },
      { label: "平均对冲度", values: rows.map((r) => fmtPct(r.kpis?.hedgeRatioAvg, 0)), delta: deltaOf((r) => r.kpis?.hedgeRatioAvg, (n) => signedPctPoints(n, 0)) },
      { label: "夜盘手数占比", values: rows.map((r) => fmtPct(nightLotsShare(r), 0)), delta: deltaOf((r) => nightLotsShare(r), (n) => signedPctPoints(n, 0)) },
      { label: "南华相关", values: rows.map((r) => (r.kpis?.corrNhci == null ? "—" : String(r.kpis.corrNhci))), delta: deltaOf((r) => r.kpis?.corrNhci, (n) => signedFixed(n, 2)) },
      {
        label: "涨/跌捕获",
        values: rows.map((r) => {
          const up = r.kpis?.upCapture
          const dn = r.kpis?.downCapture
          if (up == null && dn == null) return "—"
          return `${up == null ? "—" : up.toFixed(2)} / ${dn == null ? "—" : dn.toFixed(2)}`
        }),
        delta: undefined,
      },
      { label: "交易日 / 平仓", values: rows.map((r) => `${r.kpis?.tradingDays ?? 0} / ${r.kpis?.nCloses ?? 0}`), delta: undefined },
    ]
  }, [rows])

  const winPayoffChart = useMemo(() => compareWinPayoffOption(rows), [rows])
  const returnPdfChart = useMemo(() => compareReturnPdfOption(rows), [rows])
  const alphaBetaCompareChart = useMemo(() => compareAlphaBetaOption(rows), [rows])
  const bookCompareChart = useMemo(() => compareBookOption(rows), [rows])
  const freqCompareChart = useMemo(() => compareFreqOption(rows), [rows])

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
              <HoldBadge label={r.portrait?.strategyLabel} />
              <VolBadge label={r.portrait?.strategyLabel} />
            </div>
            <div className="mb-1"><BookStyleMarks style={r.portrait?.bookStyle} compact /></div>
            <div className="text-xs font-medium mb-1">{r.portrait?.strategyLabel ? labelWithoutVol(r.portrait.strategyLabel) : "—"}</div>
            <div className="text-lg font-semibold tabular-nums" style={{ color: pnlColor(r.kpis?.totalPnl ?? 0) }}>
              {fmtWan(r.kpis?.totalPnl)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              日胜率 {fmtPct(r.kpis?.dayWinRate, 0)} · 夏普 {r.kpis?.sharpe?.toFixed(2) ?? "—"} · 回撤 {fmtPct(r.kpis?.maxDdPct)}
            </p>
            {r.alphaBeta && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                alpha {fmtWan(r.alphaBeta.alphaPnl)} · beta {fmtWan(r.alphaBeta.betaPnl)}
                {r.alphaBeta.alphaStance ? ` · alpha ${r.alphaBeta.alphaStance}` : ""}
                {r.alphaBeta.t != null && Math.abs(r.alphaBeta.t) >= 2 ? " · beta 显著" : " · beta 不显著"}
              </p>
            )}
            {r.bookRisk && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                {r.bookRisk.sectorCount} 个板块 · {r.bookRisk.stance} · {r.bookRisk.productCount} 个品种
              </p>
            )}
            {r.tradeFrequency && (
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                频率 {r.tradeFrequency.stance}
                {r.tradeFrequency.topSector ? ` · 最多${r.tradeFrequency.topSector} ${r.tradeFrequency.topShare?.toFixed(0) ?? ""}%` : ""}
              </p>
            )}
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

      {(winPayoffChart || returnPdfChart) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {winPayoffChart && (
            <ChartCard
              title="胜率与盈亏比"
              caption="每个点是一个账户。纵轴是平均盈利 / |平均亏损|，不是盈利总额 / 亏损总额。虚线是期望为 0，随胜率下降：胜率 90% 时盈亏比 0.8 已经是正期望。"
              help={CHART_HELP.winPayoff}
            >
              <ReactECharts
                option={winPayoffChart}
                style={{ height: 360, width: "100%" }}
                notMerge
                onEvents={{
                  click: (params: { data?: { accountId?: string } }) => {
                    const id = params.data?.accountId
                    if (id) onOpenAccount(id)
                  },
                }}
              />
            </ChartCard>
          )}
          {returnPdfChart && (
            <ChartCard
              title="日收益分布"
              caption="每条线是该账户日收益率的密度曲线。横轴是当日盈亏 / 上日权益。线越宽，日收益越散。颜色和左边圆点是同一个账户。"
              help={CHART_HELP.returnPdf}
            >
              <ReactECharts option={returnPdfChart} style={{ height: 360, width: "100%" }} notMerge />
            </ChartCard>
          )}
        </div>
      )}

      {alphaBetaCompareChart && (
        <ChartCard
          title="各账户盈亏来自 alpha 还是 beta"
          caption="柱子是这段里拆出来的 alpha 合计和 beta 合计，单位元。beta 是跟着南华商品指数涨跌的部分。|t| 不到 2 时，不要把盈亏说成指数 beta。"
          help={CHART_HELP.alphaBeta}
        >
          <ReactECharts option={alphaBetaCompareChart} style={{ height: 320, width: "100%" }} notMerge />
        </ChartCard>
      )}

      {bookCompareChart && (
        <div className="space-y-4">
          <ChartCard
            title="各账户板块风险贡献"
            caption="柱高是该板块占这个账户组合方差的比例，不是持仓市值。同一板块里谁的柱子更高，谁把更多风险放在这里。"
            help={CHART_HELP.bookRisk}
          >
            <ReactECharts option={bookCompareChart} style={{ height: 320, width: "100%" }} notMerge />
          </ChartCard>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">板块内品种</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">每个板块写品种个数，以及风险是接近均等还是偏好某一个品种。占比是该品种占本板块风险贡献。</p>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left font-medium py-2 pr-3 sticky left-0 bg-background">账户</th>
                    <th className="text-left font-medium py-2 pr-3">板块</th>
                    <th className="text-left font-medium py-2">板块内</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.filter((r) => r.bookRisk).map((r, i) => (
                    <tr key={r.accountId ?? i} className="border-b border-border/60 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap sticky left-0 bg-background">{accLabel(r)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{r.bookRisk!.sectorCount} 个 · {r.bookRisk!.stance}</td>
                      <td className="py-2 text-muted-foreground leading-relaxed">
                        {r.bookRisk!.sectors.map((s) => (
                          s.stance === "单一"
                            ? `${s.sector}只做${s.topProduct ?? "一个品种"}`
                            : s.stance === "接近均等"
                              ? `${s.sector} ${s.productCount} 个、均等`
                              : `${s.sector} ${s.productCount} 个、${s.stance}${s.topProduct ?? ""} ${s.topWithin?.toFixed(0) ?? ""}%`
                        )).join("；")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {freqCompareChart && (
        <div className="space-y-4">
          <ChartCard
            title="各账户板块交易频率"
            caption="柱高是该板块有成交的天数占这个账户各板块天数合计。不是持仓市值。卡方用来判断板块之间是不是一样勤。"
            help={CHART_HELP.tradeFreq}
          >
            <ReactECharts option={freqCompareChart} style={{ height: 320, width: "100%" }} notMerge />
          </ChartCard>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">板块内交易频率</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">每个板块写品种个数，以及成交天数是没有显著差别还是显著不同。占比是该品种占本板块成交天数。</p>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left font-medium py-2 pr-3 sticky left-0 bg-background">账户</th>
                    <th className="text-left font-medium py-2 pr-3">板块之间</th>
                    <th className="text-left font-medium py-2">板块内</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.filter((r) => r.tradeFrequency).map((r, i) => (
                    <tr key={r.accountId ?? i} className="border-b border-border/60 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap sticky left-0 bg-background">{accLabel(r)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{r.tradeFrequency!.stance} · p {fmtFreqP(r.tradeFrequency!.p)}</td>
                      <td className="py-2 text-muted-foreground leading-relaxed">
                        {r.tradeFrequency!.sectors.map((s) => (
                          s.stance === "单一"
                            ? `${s.sector}只在${s.topProduct ?? "一个品种"}`
                            : `${s.sector} ${s.productCount} 个、${s.stance}${s.stance === "显著不同" && s.topProduct ? s.topProduct : ""}`
                        )).join("；")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

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
            {rows.length === 2 ? " 差值是左列减右列。" : ""}
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
