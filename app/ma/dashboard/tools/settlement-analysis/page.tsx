"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowLeft, BarChart3, ChevronDown, ChevronUp, Database, Download, FileArchive, FileSpreadsheet, Mail, Save, ScanSearch, Trash2, TrendingUp, UploadCloud } from "lucide-react"
import { Input } from "@/components/ui/input"

import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false })

type SettlementAnalysisChartItem = {
  label: string
  value: number
  netValue?: number
  mtmPl?: number
}

type SettlementAnalysisSectorItem = {
  sector: string
  longValue: number
  shortValue: number
  grossValue: number
  netValue: number
  mtmPl: number
}

type SettlementAnalysisPosition = {
  symbol: string
  productCode: string
  productName: string
  instrument: string
  exchange: string
  sector: string
  longLots: number
  shortLots: number
  longMarketValue: number
  shortMarketValue: number
  grossMarketValue: number
  netMarketValue: number
  mtmPl: number
  marginOccupied: number
}

type SettlementAnalysisResponse = {
  sourceFileName: string
  summary: {
    clientId: string
    clientName: string
    tradeDate: string
    dateRangeRaw: string
    clientEquity: number | null
    balanceCf: number | null
    marginOccupied: number | null
    fundAvailable: number | null
    riskDegreeRatio: number | null
    realizedPl: number | null
    mtmPl: number | null
    longMarketValue: number
    shortMarketValue: number
    grossExposure: number
    netExposure: number
    grossLeverage: number | null
    netExposureRatio: number | null
    positionCount: number
    detailRowCount: number
    sectorCount: number
    topPositionName: string | null
    topPositionShare: number | null
    topSectorName: string | null
    topSectorShare: number | null
  }
  charts: {
    holdings: SettlementAnalysisChartItem[]
    sectors: SettlementAnalysisSectorItem[]
    directions: SettlementAnalysisChartItem[]
    exchanges: SettlementAnalysisChartItem[]
  }
  positions: SettlementAnalysisPosition[]
  strategyInference: {
    primaryStrategy: string
    candidateStrategies: string[]
    confidence: "high" | "medium" | "low"
    bias: "long" | "short" | "neutral"
    signals: string[]
    risks: string[]
  }
  warnings: string[]
}

type AxisTooltipParam = {
  seriesName: string
  value: number
  color: string
  dataIndex: number
}

// ---- DB analysis types (mirror lib/server/guoxin-db-analysis.ts) ----

type GuoxinEquityPoint = {
  date: string
  clientEquity: number
  riskDegree: number
  marginOccupied: number
  mtmPl: number
  realizedPl: number
}

type GuoxinEquityStats = {
  startDate: string
  endDate: string
  startEquity: number
  endEquity: number
  returnPct: number
  feeTotal: number
  maxRiskDegree: number
  totalDays: number
}

type GuoxinTurnoverItem = {
  product: string
  turnover: number
  turnoverPct: number
  lots: number
}

type GuoxinNettingRow = {
  settlementDate: string
  product: string
  longLots: number
  shortLots: number
  netLots: number
  mtmPl: number
  margin: number
}

type GuoxinTradeClusterItem = {
  instrument: string
  bs: string
  lots: number
  avgPrice: number
  turnover: number
  fees: number
}

type GuoxinTradeCluster = {
  tradeDate: string
  product: string
  items: GuoxinTradeClusterItem[]
  totalTurnover: number
  totalFees: number
}

type GuoxinCloseClusterItem = {
  instrument: string
  bs: string
  lots: number
  realizedPl: number
}

type GuoxinCloseCluster = {
  settlementDate: string
  product: string
  totalLots: number
  totalRealizedPl: number
  items: GuoxinCloseClusterItem[]
}

type GuoxinOrderTimelinePoint = {
  date: string
  bs: "买" | "卖"
  oc: "开" | "平"
  lots: number
  signedLots: number
  fills?: number
}

type GuoxinSpreadOrderPoint = {
  date: string
  instrument?: string
  bs: "买" | "卖"
  oc: "开" | "平"
  lots: number
  fills?: number
  spreadValue: number | null
  relatedHedges?: Array<{
    instrument: string
    bs: "买" | "卖"
    oc: "开" | "平"
    lots: number
    fills: number
  }>
}

type GuoxinSpreadChart = {
  id: string
  name: string
  legA: string
  legB: string
  dates: string[]
  spread: (number | null)[]
  z20: (number | null)[]
  orderPoints: GuoxinSpreadOrderPoint[]
  legFills?: number
  crossMonthHedgeDays?: number
  pairedLegOpenDays?: number
  entryDate: string | null
  exitDate: string | null
}

type HedgeStructureChart = {
  product: string
  family: string
  instruments: string[]
  dates: string[]
  cumulativeNet: Record<string, number[]>
  openHeat: Array<[number, number, number]>
  closeHeat: Array<[number, number, number]>
  activeDays: Array<{
    date: string
    buyOpen: number
    sellOpen: number
    buyClose: number
    sellClose: number
    structure: "paired" | "cross-month" | "one-leg" | "close-only" | "none"
    hint: string
    legs: Array<{
      instrument: string
      buyOpen: number
      sellOpen: number
      buyClose: number
      sellClose: number
    }>
  }>
  stats: {
    pairedOpenDays: number
    crossMonthOpenDays: number
    oneLegOpenDays: number
    closeDays: number
  }
}

type GuoxinDBAnalysisResponse = {
  dateRange: { start: string; end: string }
  equityStats: GuoxinEquityStats
  equityHistory: GuoxinEquityPoint[]
  turnover: GuoxinTurnoverItem[]
  productNetting: GuoxinNettingRow[]
  tradeClusters: GuoxinTradeCluster[]
  closeClusters: GuoxinCloseCluster[]
  uniqueProducts: string[]
  orderTimeline?: GuoxinOrderTimelinePoint[]
  spreadCharts?: GuoxinSpreadChart[]
  hedgeStructureCharts?: HedgeStructureChart[]
}

type RonghangEquityPoint = {
  date: string
  equity: number
  nav: number
  drawdown: number
  margin: number
  marginRatio: number
  dailyPl: number
  fee: number
  deposit: number
  riskDegree: number
}

type RonghangNamedAmount = {
  key: string
  name: string
  sector?: string
  pnl: number
  lots: number
  weight: number
}

type RonghangZipReport = {
  sourceFileName: string
  fileCount: number
  meta: {
    clientId: string
    clientName: string
    brokerName: string
    startDate: string
    endDate: string
    tradingDays: number
  }
  overview: {
    startBalance: number
    endBalance: number
    startEquity: number
    endEquity: number
    totalDeposit: number
    totalWithdraw: number
    netDeposit: number
    totalFee: number
    netProfit: number
    unitNav: number
    maxNav: number
    periodReturn: number
    annualizedReturn: number
    maxDailyDrawdown: number
    maxPeakDrawdown: number
    continuousDrawdownCalendarDays: number
    longestUnderwaterCalendarDays: number
    annualizedVol: number
    annualizedDownsideVol: number
    totalLots: number
    totalTrades: number
    dailyWinRate: number
    monthlyWinRate: number
    avgMargin: number
    avgMarginRatio: number
    sharpe: number
    sortino: number
    calmar: number
    avgFeeRatio: number
  }
  equityCurve: RonghangEquityPoint[]
  monthlyReturns: Array<{ month: string; returnPct: number; pnl: number }>
  drawdownBuckets: Array<{ label: string; days: number; share: number }>
  sectorPnl: RonghangNamedAmount[]
  productPnl: RonghangNamedAmount[]
  directionAttribution: Array<{
    product: string
    productName: string
    direction: "买" | "卖"
    pnl: number
    weight: number
  }>
  longShortStats: {
    overall: {
      win: { lots: number; pnl: number; avgPnl: number }
      loss: { lots: number; pnl: number; avgPnl: number }
      flat: { lots: number; pnl: number; avgPnl: number }
      totalPnl: number
      totalLots: number
      winRate: number
      profitFactor: number
    }
    longClose: {
      win: { lots: number; pnl: number; avgPnl: number }
      loss: { lots: number; pnl: number; avgPnl: number }
      flat: { lots: number; pnl: number; avgPnl: number }
      totalPnl: number
      totalLots: number
      winRate: number
      profitFactor: number
    }
    shortClose: {
      win: { lots: number; pnl: number; avgPnl: number }
      loss: { lots: number; pnl: number; avgPnl: number }
      flat: { lots: number; pnl: number; avgPnl: number }
      totalPnl: number
      totalLots: number
      winRate: number
      profitFactor: number
    }
  }
  holdingPeriodStats: Array<{
    period: string
    profitAmount: number
    lossAmount: number
    pnl: number
    lots: number
    lotShare: number
    trades: number
    wins: number
    winRate: number
  }>
  narrative: {
    returnSummary: string
    monthlySummary: string
    navSummary: string
    drawdownSummary: string
    topProfitSectors: string[]
    topLossSectors: string[]
    topProfitProducts: string[]
    topLossProducts: string[]
  }
  warnings: string[]
}

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".xlsb"]

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }
  return fallback
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "--"
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value == null) return "--"
  const sign = value > 0 ? "+" : value < 0 ? "-" : ""
  return `${sign}${formatCurrency(Math.abs(value))}`
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return "--"
  return `${(value * 100).toFixed(1)}%`
}

function formatPercentPrecise(value: number | null | undefined, digits = 2) {
  if (value == null) return "--"
  return `${(value * 100).toFixed(digits)}%`
}

function formatRatio(value: number | null | undefined, digits = 4) {
  if (value == null || !Number.isFinite(value)) return "--"
  return value.toFixed(digits)
}

function formatMultiple(value: number | null | undefined) {
  if (value == null) return "--"
  return `${value.toFixed(2)}x`
}

function formatCompact(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)}亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)}万`
  return `${value.toFixed(0)}`
}

function confidenceLabel(value: SettlementAnalysisResponse["strategyInference"]["confidence"]) {
  if (value === "high") return "高"
  if (value === "medium") return "中"
  return "低"
}

function biasLabel(value: SettlementAnalysisResponse["strategyInference"]["bias"]) {
  if (value === "long") return "偏多"
  if (value === "short") return "偏空"
  return "中性"
}

function buildHoldingsOption(items: SettlementAnalysisChartItem[]) {
  const rows = [...items].reverse()
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: AxisTooltipParam[]) => {
        const item = rows[params[0]?.dataIndex ?? 0] ?? null
        const header = item ? `${item.label}<br/>` : ""
        return [
          header,
          ...params.map((entry) => `${entry.color} ${entry.seriesName}: ${formatCurrency(entry.value)}`),
          item?.mtmPl != null ? `盯市盈亏: ${formatSignedCurrency(item.mtmPl)}` : "",
        ].filter(Boolean).join("<br/>")
      },
    },
    legend: { top: 0 },
    grid: { left: 110, right: 24, top: 42, bottom: 18, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatCompact(value) },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
    },
    yAxis: {
      type: "category",
      data: rows.map((item) => item.label),
      axisTick: { show: false },
    },
    series: [
      {
        name: "总敞口",
        type: "bar",
        data: rows.map((item) => item.value),
        itemStyle: { color: "#0f766e", borderRadius: [0, 6, 6, 0] },
      },
      {
        name: "净敞口",
        type: "bar",
        data: rows.map((item) => item.netValue ?? 0),
        itemStyle: {
          color: (params: { value: number }) => (params.value >= 0 ? "#2563eb" : "#dc2626"),
          borderRadius: [0, 6, 6, 0],
        },
      },
    ],
  }
}

function buildSectorOption(items: SettlementAnalysisSectorItem[]) {
  const rows = [...items].reverse()
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: AxisTooltipParam[]) => {
        const label = rows[params[0]?.dataIndex ?? 0]?.sector ?? ""
        const sector = rows[params[0]?.dataIndex ?? 0]
        return [
          `${label}<br/>`,
          ...params.map((entry) => `${entry.color} ${entry.seriesName}: ${formatCurrency(Math.abs(entry.value))}`),
          sector ? `板块盯市盈亏: ${formatSignedCurrency(sector.mtmPl)}` : "",
        ].filter(Boolean).join("<br/>")
      },
    },
    legend: { top: 0 },
    grid: { left: 88, right: 24, top: 42, bottom: 18, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatCompact(value) },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
    },
    yAxis: {
      type: "category",
      data: rows.map((item) => item.sector),
      axisTick: { show: false },
    },
    series: [
      {
        name: "多头敞口",
        type: "bar",
        stack: "exposure",
        data: rows.map((item) => item.longValue),
        itemStyle: { color: "#2563eb", borderRadius: [0, 6, 6, 0] },
      },
      {
        name: "空头敞口",
        type: "bar",
        stack: "exposure",
        data: rows.map((item) => -item.shortValue),
        itemStyle: { color: "#dc2626", borderRadius: [6, 0, 0, 6] },
      },
      {
        name: "净敞口",
        type: "line",
        smooth: true,
        data: rows.map((item) => item.netValue),
        itemStyle: { color: "#0f766e" },
        lineStyle: { width: 2 },
      },
    ],
  }
}

function buildPieOption(items: SettlementAnalysisChartItem[], seriesName: string) {
  return {
    tooltip: {
      trigger: "item",
      formatter: (params: { name: string; value: number; percent: number }) => {
        return `${params.name}<br/>${formatCurrency(params.value)}<br/>占比 ${params.percent.toFixed(1)}%`
      },
    },
    legend: { bottom: 0, left: "center" },
    series: [
      {
        name: seriesName,
        type: "pie",
        radius: ["42%", "70%"],
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        label: { formatter: "{b}\n{d}%" },
        data: items.map((item) => ({ name: item.label, value: item.value })),
      },
    ],
  }
}

// ---- DB analysis chart builders ----

const ORDER_SERIES_META = [
  { key: "买开" as const, bs: "买" as const, oc: "开" as const, color: "#15803d", symbol: "triangle" },
  { key: "卖开" as const, bs: "卖" as const, oc: "开" as const, color: "#b91c1c", symbol: "triangle" },
  { key: "买平" as const, bs: "买" as const, oc: "平" as const, color: "#86efac", symbol: "circle", border: "#15803d" },
  { key: "卖平" as const, bs: "卖" as const, oc: "平" as const, color: "#fecaca", symbol: "circle", border: "#b91c1c" },
]

function orderSymbolSize(lots: number) {
  return Math.max(10, Math.min(34, 8 + Math.sqrt(Math.max(lots, 1)) * 3.2))
}

function buildEquityOption(history: GuoxinEquityPoint[], orderTimeline: GuoxinOrderTimelinePoint[] = []) {
  const dates = history.map((h) => h.date)
  const equities = history.map((h) => h.clientEquity)
  const risks = history.map((h) => +(h.riskDegree * 100).toFixed(2))
  const equityByDate = new Map(history.map((h) => [h.date, h.clientEquity]))
  const offsets: Record<string, number> = { 买开: 0.012, 卖开: -0.012, 买平: 0.004, 卖平: -0.004 }

  const orderSeries = ORDER_SERIES_META.map((meta) => {
    const points = orderTimeline
      .filter((p) => p.bs === meta.bs && p.oc === meta.oc)
      .map((p) => {
        const eq = equityByDate.get(p.date)
        if (eq == null) return null
        return {
          value: [p.date, eq * (1 + (offsets[meta.key] ?? 0))],
          lots: p.lots,
        }
      })
      .filter(Boolean) as { value: [string, number]; lots: number }[]
    return {
      name: meta.key,
      type: "scatter",
      yAxisIndex: 0,
      data: points.map((p) => ({
        value: p.value,
        symbolSize: orderSymbolSize(p.lots),
        lots: p.lots,
      })),
      symbol: meta.symbol,
      symbolRotate: meta.key === "卖开" ? 180 : 0,
      itemStyle: {
        color: meta.color,
        borderColor: meta.border ?? meta.color,
        borderWidth: meta.border ? 1.2 : 0,
      },
      z: 6,
    }
  })

  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (params: Array<{ seriesName: string; value: number | [string, number]; marker: string; data?: { lots?: number } }>) => {
        if (!Array.isArray(params) || params.length === 0) return ""
        const date =
          typeof params[0].value === "object" && Array.isArray(params[0].value)
            ? params[0].value[0]
            : dates[(params[0] as { dataIndex?: number }).dataIndex ?? 0]
        const lines = [`${date}`]
        for (const p of params) {
          const raw = Array.isArray(p.value) ? p.value[1] : p.value
          const lots = p.data?.lots
          lines.push(
            `${p.marker}${p.seriesName}: ${
              typeof raw === "number"
                ? p.seriesName.includes("风险")
                  ? `${raw}%`
                  : formatCompact(raw)
                : raw
            }${lots != null ? `（${lots}手）` : ""}`,
          )
        }
        return lines.join("<br/>")
      },
    },
    legend: { top: 0, type: "scroll" },
    grid: { left: 70, right: 70, top: 48, bottom: 52 },
    xAxis: {
      type: "category",
      data: dates,
      axisLabel: { rotate: 30, formatter: (v: string) => v.slice(5) },
    },
    yAxis: [
      {
        type: "value",
        name: "权益",
        axisLabel: { formatter: (v: number) => formatCompact(v) },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
      },
      {
        type: "value",
        name: "风险度%",
        axisLabel: { formatter: (v: number) => `${v}%` },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "客户权益",
        type: "line",
        smooth: true,
        data: equities,
        yAxisIndex: 0,
        itemStyle: { color: "#2563eb" },
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.06 },
        symbol: "none",
        z: 2,
      },
      {
        name: "风险度",
        type: "line",
        smooth: true,
        data: risks,
        yAxisIndex: 1,
        itemStyle: { color: "#dc2626" },
        lineStyle: { width: 1.5, type: "dashed" },
        symbol: "none",
        z: 2,
      },
      ...orderSeries,
    ],
  }
}

function buildOrderTimelineOption(points: GuoxinOrderTimelinePoint[]) {
  if (!points.length) return null
  const dates = [...new Set(points.map((p) => p.date))].sort()
  const series = ORDER_SERIES_META.map((meta) => {
    const rows = points.filter((p) => p.bs === meta.bs && p.oc === meta.oc)
    return {
      name: meta.key,
      type: "scatter" as const,
      data: rows.map((p) => [p.date, p.signedLots, p.lots, p.fills ?? 1]),
      symbol: meta.symbol,
      symbolRotate: meta.key === "卖开" ? 180 : 0,
      symbolSize: (val: number[]) => orderSymbolSize(val?.[2] ?? Math.abs(val?.[1] ?? 1)),
      itemStyle: {
        color: meta.color,
        borderColor: meta.border ?? meta.color,
        borderWidth: meta.border ? 1.2 : 0,
        opacity: 0.9,
      },
      z: 5,
    }
  }).filter((s) => s.data.length > 0)

  if (!series.length) return null

  return {
    title: {
      text: "订单买卖开平时序（买为正 / 卖为负）",
      left: "center",
      top: 4,
      textStyle: { fontSize: 14, fontWeight: 600, color: "#111827" },
    },
    tooltip: {
      trigger: "item",
      formatter: (p: { seriesName: string; value: number[]; marker: string }) => {
        const date = p.value?.[0]
        const lots = p.value?.[2] ?? Math.abs(p.value?.[1] ?? 0)
        const fills = p.value?.[3] ?? 1
        return `${date}<br/>${p.marker}${p.seriesName}: ${lots} 手 / ${fills} 笔（当日汇总）`
      },
    },
    legend: {
      top: 28,
      right: 12,
      orient: "vertical",
      data: series.map((s) => s.name),
    },
    grid: { left: 70, right: 110, top: 56, bottom: 52 },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: true,
      axisLabel: { rotate: 30, formatter: (v: string) => v.slice(5) },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: "value",
      name: "成交手数",
      nameTextStyle: { padding: [0, 0, 0, 8] },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.22)" } },
      axisLine: { show: true },
    },
    series: [
      ...series,
      {
        name: "_zero",
        type: "line",
        data: dates.map(() => 0),
        symbol: "none",
        lineStyle: { color: "#9ca3af", width: 1.1 },
        silent: true,
        tooltip: { show: false },
        legendHoverLink: false,
      },
    ],
  }
}

/** Fallback when API payload predates orderTimeline field. */
function deriveOrderTimeline(analysis: GuoxinDBAnalysisResponse): GuoxinOrderTimelinePoint[] {
  if (analysis.orderTimeline?.length) return analysis.orderTimeline
  const agg = new Map<string, number>()
  const bump = (date: string, bsRaw: string, oc: "开" | "平", lots: number) => {
    const bs = bsRaw.includes("卖") ? "卖" : bsRaw.includes("买") ? "买" : null
    if (!bs || lots <= 0) return
    const key = `${date.slice(0, 10)}\0${bs}\0${oc}`
    agg.set(key, (agg.get(key) ?? 0) + lots)
  }
  for (const cluster of analysis.tradeClusters) {
    for (const item of cluster.items) bump(cluster.tradeDate, item.bs, "开", item.lots)
  }
  for (const cluster of analysis.closeClusters) {
    for (const item of cluster.items) bump(cluster.settlementDate, item.bs, "平", item.lots)
  }
  return Array.from(agg.entries())
    .map(([key, lots]) => {
      const [date, bs, oc] = key.split("\0") as [string, "买" | "卖", "开" | "平"]
      return { date, bs, oc, lots, signedLots: bs === "买" ? lots : -lots, fills: 1 }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.bs.localeCompare(b.bs) || a.oc.localeCompare(b.oc))
}

function buildSpreadZ20Option(chart: GuoxinSpreadChart) {
  const markLines = []
  if (chart.entryDate) {
    markLines.push({
      xAxis: chart.entryDate,
      lineStyle: { color: "#1d7a52", type: "dashed", width: 1.2 },
      label: { formatter: "开仓", position: "insideEndTop" },
    })
  }
  if (chart.exitDate) {
    markLines.push({
      xAxis: chart.exitDate,
      lineStyle: { color: "#ad2e24", type: "dashed", width: 1.2 },
      label: { formatter: "平仓", position: "insideEndTop" },
    })
  }

  const orderSeries = ORDER_SERIES_META.map((meta) => {
    const rows = chart.orderPoints.filter(
      (p) => p.bs === meta.bs && p.oc === meta.oc && p.spreadValue != null,
    )
    return {
      name: meta.key,
      type: "scatter",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: rows.map((p) => ({
        value: [p.date, p.spreadValue as number],
        symbolSize: orderSymbolSize(p.lots),
        lots: p.lots,
        fills: p.fills ?? 1,
        instrument: p.instrument ?? "",
        relatedHedges: p.relatedHedges ?? [],
      })),
      symbol: meta.symbol,
      symbolRotate: meta.key === "卖开" ? 180 : 0,
      itemStyle: {
        color: meta.color,
        borderColor: meta.border ?? meta.color,
        borderWidth: meta.border ? 1.2 : 0,
      },
      z: 6,
    }
  })

  return {
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip: {
      trigger: "item",
      formatter: (p: {
        seriesName: string
        value: number | [string, number]
        marker: string
        data?: {
          lots?: number
          fills?: number
          instrument?: string
          relatedHedges?: Array<{ instrument: string; bs: string; oc: string; lots: number; fills: number }>
        }
      }) => {
        if (p.seriesName === "价差" || p.seriesName === "Z20" || p.seriesName === "_zero") {
          const raw = Array.isArray(p.value) ? p.value[1] : p.value
          return `${p.marker}${p.seriesName}: ${typeof raw === "number" ? raw.toFixed(2) : raw}`
        }
        const date = Array.isArray(p.value) ? p.value[0] : ""
        const y = Array.isArray(p.value) ? p.value[1] : p.value
        const inst = p.data?.instrument ? ` ${p.data.instrument}` : ""
        const lots = p.data?.lots ?? 0
        const fills = p.data?.fills ?? 1
        const related = p.data?.relatedHedges ?? []
        const relatedText =
          related.length > 0
            ? `<br/>同日其他月份对冲: ${related
                .map((r) => `${r.instrument}${r.bs}${r.oc}${r.lots}手`)
                .join("、")}`
            : `<br/>同日未见其他月份对冲（本价差图内可能确为单腿）`
        return `${date}${inst}<br/>${p.marker}${p.seriesName}: ${lots} 手 / ${fills} 笔<br/>价差位置: ${
          typeof y === "number" ? y.toFixed(2) : y
        }${relatedText}`
      },
    },
    legend: { top: 0, type: "scroll" },
    grid: [
      { left: 70, right: 24, top: 48, height: "38%" },
      { left: 70, right: 24, top: "62%", height: "28%" },
    ],
    xAxis: [
      {
        type: "category",
        data: chart.dates,
        gridIndex: 0,
        axisLabel: { show: false },
      },
      {
        type: "category",
        data: chart.dates,
        gridIndex: 1,
        axisLabel: { rotate: 30, formatter: (v: string) => v.slice(5) },
      },
    ],
    yAxis: [
      {
        type: "value",
        name: "价差",
        gridIndex: 0,
        scale: true,
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
      },
      {
        type: "value",
        name: "Z20",
        gridIndex: 1,
        scale: true,
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
      },
    ],
    series: [
      {
        name: "价差",
        type: "line",
        data: chart.spread,
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        itemStyle: { color: "#0f5c5e" },
        lineStyle: { width: 2 },
        tooltip: { trigger: "axis" },
        markLine:
          markLines.length > 0
            ? { symbol: "none", data: markLines, animation: false }
            : undefined,
      },
      ...orderSeries,
      {
        name: "Z20",
        type: "line",
        data: chart.z20,
        xAxisIndex: 1,
        yAxisIndex: 1,
        showSymbol: false,
        itemStyle: { color: "#c84c09" },
        lineStyle: { width: 1.8 },
        tooltip: { trigger: "axis" },
        markLine: {
          symbol: "none",
          data: [
            { yAxis: -1.5, lineStyle: { color: "#666", type: "dashed", width: 1 } },
            { yAxis: 0, lineStyle: { color: "#666", type: "dotted", width: 1 } },
            ...markLines,
          ],
          animation: false,
        },
      },
    ],
  }
}

function buildTurnoverOption(items: GuoxinTurnoverItem[]) {
  const rows = [...items].reverse()
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: AxisTooltipParam[]) => {
        const row = rows[params[0]?.dataIndex ?? 0]
        return row
          ? `${row.product}<br/>成交额: ${formatCurrency(row.turnover)}<br/>占比: ${formatPercent(row.turnoverPct)}<br/>手数: ${row.lots.toFixed(0)} 手`
          : ""
      },
    },
    grid: { left: 70, right: 60, top: 16, bottom: 18, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => formatCompact(v) },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
    },
    yAxis: {
      type: "category",
      data: rows.map((r) => r.product),
      axisTick: { show: false },
    },
    series: [
      {
        name: "成交额",
        type: "bar",
        data: rows.map((r) => r.turnover),
        itemStyle: { color: "#0f766e", borderRadius: [0, 6, 6, 0] },
        label: {
          show: true,
          position: "right",
          formatter: (params: { dataIndex: number }) => formatPercent(rows[params.dataIndex]?.turnoverPct),
        },
      },
    ],
  }
}

function buildHedgeCumulativeOption(chart: HedgeStructureChart) {
  const palette = ["#0f766e", "#b45309", "#1d4ed8", "#be123c", "#7c3aed", "#0891b2", "#4d7c0f", "#c2410c"]
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0, type: "scroll" },
    grid: { left: 70, right: 24, top: 40, bottom: 52 },
    xAxis: {
      type: "category",
      data: chart.dates,
      axisLabel: { rotate: 30, formatter: (v: string) => v.slice(5) },
    },
    yAxis: {
      type: "value",
      name: "累计净手数",
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
    },
    series: chart.instruments.map((inst, i) => ({
      name: inst,
      type: "line",
      data: chart.cumulativeNet[inst] ?? [],
      showSymbol: false,
      lineStyle: { width: 2 },
      itemStyle: { color: palette[i % palette.length] },
    })),
  }
}

function buildHedgeOpenHeatOption(chart: HedgeStructureChart) {
  const values = chart.openHeat.map((c) => c[2])
  const maxAbs = Math.max(20, ...values.map((v) => Math.abs(v)))
  return {
    tooltip: {
      formatter: (p: { value: [number, number, number] }) => {
        const [di, ii, v] = p.value
        const side = v > 0 ? "净买开" : v < 0 ? "净卖开" : "无"
        return `${chart.dates[di]} ${chart.instruments[ii]}<br/>${side}: ${v} 手`
      },
    },
    grid: { left: 80, right: 40, top: 20, bottom: 52 },
    xAxis: {
      type: "category",
      data: chart.dates,
      axisLabel: { rotate: 30, formatter: (v: string) => v.slice(5) },
    },
    yAxis: {
      type: "category",
      data: chart.instruments,
      axisLabel: { fontSize: 11 },
    },
    visualMap: {
      min: -maxAbs,
      max: maxAbs,
      calculable: true,
      orient: "vertical",
      right: 0,
      top: "middle",
      inRange: { color: ["#b91c1c", "#fee2e2", "#f8fafc", "#dcfce7", "#15803d"] },
      text: ["买开+", "卖开-"],
      textStyle: { fontSize: 10 },
    },
    series: [
      {
        type: "heatmap",
        data: chart.openHeat,
        label: { show: false },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.25)" } },
      },
    ],
  }
}

function buildMarginOption(history: GuoxinEquityPoint[]) {
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 70, right: 24, top: 16, bottom: 52 },
    xAxis: {
      type: "category",
      data: history.map((h) => h.date),
      axisLabel: { rotate: 30, formatter: (v: string) => v.slice(5) },
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => formatCompact(v) },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
    },
    series: [
      {
        name: "保证金占用",
        type: "bar",
        data: history.map((h) => h.marginOccupied),
        itemStyle: { color: "#0f766e", opacity: 0.75 },
      },
    ],
  }
}

function StrategyReportPanels({
  analysis,
  equityChartOption,
  turnoverChartOption,
  marginChartOption,
  orderTimelineOption,
  spreadChartOptions,
  hedgeStructurePanels,
  expandedClusters,
  toggleCluster,
}: {
  analysis: GuoxinDBAnalysisResponse
  equityChartOption: ReturnType<typeof buildEquityOption> | null
  turnoverChartOption: ReturnType<typeof buildTurnoverOption> | null
  marginChartOption: ReturnType<typeof buildMarginOption> | null
  orderTimelineOption: ReturnType<typeof buildOrderTimelineOption>
  spreadChartOptions: Array<{
    id: string
    name: string
    option: ReturnType<typeof buildSpreadZ20Option>
    legFills: number
    markerCount: number
    pairedLegOpenDays: number
    crossMonthHedgeDays: number
  }>
  hedgeStructurePanels: Array<{
    product: string
    cumulativeOption: ReturnType<typeof buildHedgeCumulativeOption>
    heatOption: ReturnType<typeof buildHedgeOpenHeatOption>
    stats: HedgeStructureChart["stats"]
    activeDays: HedgeStructureChart["activeDays"]
  }>
  expandedClusters: Set<string>
  toggleCluster: (key: string) => void
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>期间收益率</CardDescription>
            <CardTitle className={`text-2xl ${analysis.equityStats.returnPct >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {formatPercent(analysis.equityStats.returnPct)}
            </CardTitle>
            <div className="text-sm text-muted-foreground">{analysis.equityStats.startDate} ~ {analysis.equityStats.endDate}</div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>期末权益</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(analysis.equityStats.endEquity)}</CardTitle>
            <div className="text-sm text-muted-foreground">期初 {formatCurrency(analysis.equityStats.startEquity)}</div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>累计手续费</CardDescription>
            <CardTitle className="text-2xl text-red-700">{formatCurrency(analysis.equityStats.feeTotal)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>最高风险度</CardDescription>
            <CardTitle className="text-2xl">{formatPercent(analysis.equityStats.maxRiskDegree)}</CardTitle>
            <div className="text-sm text-muted-foreground">交易天数 {analysis.equityStats.totalDays}</div>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>账户权益与风险度</CardTitle>
            <CardDescription>
              蓝线为客户权益（左轴），红虚线为风险度（右轴）；▲买开 / ▼卖开 / ○买平 / ○卖平。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {equityChartOption ? (
              <ReactECharts option={equityChartOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
            ) : (
              <div className="py-24 text-center text-sm text-muted-foreground">暂无权益数据。</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>品种成交额占比</CardTitle>
            <CardDescription>按成交金额排序，右侧标注占总成交额的百分比。</CardDescription>
          </CardHeader>
          <CardContent>
            {turnoverChartOption ? (
              <ReactECharts option={turnoverChartOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
            ) : (
              <div className="py-24 text-center text-sm text-muted-foreground">暂无成交数据。</div>
            )}
          </CardContent>
        </Card>
      </div>

      {orderTimelineOption ? (
        <Card>
          <CardHeader>
            <CardTitle>订单买卖开平时序</CardTitle>
            <CardDescription>
              与 Word 报告同款：▲买开、▼卖开、○买平、○卖平；买为正、卖为负，点大小按当日汇总手数缩放。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts
              option={orderTimelineOption}
              style={{ height: 420, width: "100%" }}
              notMerge
              lazyUpdate
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>逐日保证金占用</CardTitle>
          <CardDescription>每个交易日的保证金占用金额变化趋势。</CardDescription>
        </CardHeader>
        <CardContent>
          {marginChartOption ? (
            <ReactECharts option={marginChartOption} style={{ height: 260, width: "100%" }} notMerge lazyUpdate />
          ) : (
            <div className="py-16 text-center text-sm text-muted-foreground">暂无保证金数据。</div>
          )}
        </CardContent>
      </Card>

      {hedgeStructurePanels.length > 0 ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">多合约对冲结构</h3>
            <p className="text-sm text-muted-foreground">
              比双腿价差图更适合看曲线/蝶式：上图为各合约累计净手数（买开/买平+，卖开/卖平-），下图为每日开仓热力（绿=净买开，红=净卖开）。
            </p>
          </div>
          {hedgeStructurePanels.map((panel) => (
            <Card key={panel.product}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{panel.product} 对冲结构</CardTitle>
                <CardDescription>
                  日历对开 {panel.stats.pairedOpenDays} 日 · 跨月/曲线 {panel.stats.crossMonthOpenDays} 日 ·
                  单腿开仓 {panel.stats.oneLegOpenDays} 日 · 仅平仓 {panel.stats.closeDays} 日
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ReactECharts option={panel.cumulativeOption} style={{ height: 320, width: "100%" }} notMerge lazyUpdate />
                <ReactECharts option={panel.heatOption} style={{ height: 280, width: "100%" }} notMerge lazyUpdate />
                <div className="max-h-56 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>日期</TableHead>
                        <TableHead>结构</TableHead>
                        <TableHead>说明</TableHead>
                        <TableHead className="text-right">买开</TableHead>
                        <TableHead className="text-right">卖开</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {panel.activeDays
                        .filter((d) => d.structure !== "none")
                        .slice(-40)
                        .map((d) => (
                          <TableRow key={d.date}>
                            <TableCell className="whitespace-nowrap font-mono text-xs">{d.date}</TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {d.structure === "paired"
                                  ? "日历对开"
                                  : d.structure === "cross-month"
                                    ? "跨月/曲线"
                                    : d.structure === "one-leg"
                                      ? "单腿"
                                      : d.structure === "close-only"
                                        ? "仅平仓"
                                        : d.structure}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{d.hint}</TableCell>
                            <TableCell className="text-right tabular-nums">{d.buyOpen}</TableCell>
                            <TableCell className="text-right tabular-nums">{d.sellOpen}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {spreadChartOptions.length > 0 ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">关键价差与订单点</h3>
            <p className="text-sm text-muted-foreground">
              上图仅标注本价差两腿成交。碳酸锂常见「空中间月、多两边月」曲线交易，所以图上单腿点往往在同日有其他月份对冲——悬停可见。
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-1">
            {spreadChartOptions.map((item) => (
              <Card key={item.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{item.name} 价差与订单点</CardTitle>
                  <CardDescription>
                    两腿 {item.legFills} 笔 → {item.markerCount} 个汇总点；严格双腿对开 {item.pairedLegOpenDays} 日，
                    跨月对冲开仓 {item.crossMonthHedgeDays} 日。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ReactECharts option={item.option} style={{ height: 460, width: "100%" }} notMerge lazyUpdate />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>品种成交明细</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>品种</TableHead>
                <TableHead className="text-right">成交额</TableHead>
                <TableHead className="text-right">占比</TableHead>
                <TableHead className="text-right">手数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.turnover.map((row) => (
                <TableRow key={row.product}>
                  <TableCell className="font-medium">{row.product}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.turnover)}</TableCell>
                  <TableCell className="text-right">{formatPercent(row.turnoverPct)}</TableCell>
                  <TableCell className="text-right">{row.lots.toFixed(0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>开仓批次解读</CardTitle>
          <CardDescription>按交易日和品种聚合，点击行展开明细合约。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>交易日</TableHead>
                <TableHead>品种</TableHead>
                <TableHead className="text-right">批次成交额</TableHead>
                <TableHead className="text-right">手续费</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.tradeClusters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">暂无开仓记录。</TableCell>
                </TableRow>
              ) : analysis.tradeClusters.map((cluster) => {
                const key = `open-${cluster.tradeDate}-${cluster.product}`
                const isExpanded = expandedClusters.has(key)
                return (
                  <Fragment key={key}>
                    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleCluster(key)}>
                      <TableCell className="font-medium">{cluster.tradeDate}</TableCell>
                      <TableCell>{cluster.product}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cluster.totalTurnover)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cluster.totalFees)}</TableCell>
                      <TableCell className="text-right">
                        {isExpanded ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                      </TableCell>
                    </TableRow>
                    {isExpanded ? cluster.items.map((item, idx) => (
                      <TableRow key={`${key}-${idx}`} className="bg-muted/20 text-sm">
                        <TableCell></TableCell>
                        <TableCell className="text-muted-foreground">{item.instrument}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{item.bs} {item.lots.toFixed(0)} 手 @ {item.avgPrice.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{formatCurrency(item.turnover)}</TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    )) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>平仓批次解读</CardTitle>
          <CardDescription>按结算日和品种聚合，含已实现盈亏，点击行展开明细。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>结算日</TableHead>
                <TableHead>品种</TableHead>
                <TableHead className="text-right">平仓手数</TableHead>
                <TableHead className="text-right">实现盈亏</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.closeClusters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">暂无平仓记录。</TableCell>
                </TableRow>
              ) : analysis.closeClusters.map((cluster) => {
                const key = `close-${cluster.settlementDate}-${cluster.product}`
                const isExpanded = expandedClusters.has(key)
                return (
                  <Fragment key={key}>
                    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleCluster(key)}>
                      <TableCell className="font-medium">{cluster.settlementDate}</TableCell>
                      <TableCell>{cluster.product}</TableCell>
                      <TableCell className="text-right">{cluster.totalLots.toFixed(0)}</TableCell>
                      <TableCell className={`text-right ${cluster.totalRealizedPl >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {formatSignedCurrency(cluster.totalRealizedPl)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isExpanded ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                      </TableCell>
                    </TableRow>
                    {isExpanded ? cluster.items.map((item, idx) => (
                      <TableRow key={`${key}-${idx}`} className="bg-muted/20 text-sm">
                        <TableCell></TableCell>
                        <TableCell className="text-muted-foreground">{item.instrument}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{item.bs} {item.lots.toFixed(0)} 手</TableCell>
                        <TableCell className={`text-right ${item.realizedPl >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {formatSignedCurrency(item.realizedPl)}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    )) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>附录：逐日品种净敞口汇总</CardTitle>
          <CardDescription>每日各品种多空手数与净手数，最多展示 300 行。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>结算日</TableHead>
                <TableHead>品种</TableHead>
                <TableHead className="text-right">多头</TableHead>
                <TableHead className="text-right">空头</TableHead>
                <TableHead className="text-right">净手数</TableHead>
                <TableHead className="text-right">盯市盈亏</TableHead>
                <TableHead className="text-right">保证金</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.productNetting.slice(0, 300).map((row, idx) => (
                <TableRow key={`netting-${idx}`}>
                  <TableCell>{row.settlementDate}</TableCell>
                  <TableCell>{row.product}</TableCell>
                  <TableCell className="text-right text-blue-700">{row.longLots.toFixed(0)}</TableCell>
                  <TableCell className="text-right text-red-700">{row.shortLots.toFixed(0)}</TableCell>
                  <TableCell className={`text-right font-medium ${row.netLots >= 0 ? "text-blue-700" : "text-red-700"}`}>
                    {row.netLots > 0 ? "+" : ""}{row.netLots.toFixed(0)}
                  </TableCell>
                  <TableCell className={`text-right ${row.mtmPl >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedCurrency(row.mtmPl)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.margin)}</TableCell>
                </TableRow>
              ))}
              {analysis.productNetting.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">暂无持仓记录。</TableCell>
                </TableRow>
              ) : null}
              {analysis.productNetting.length > 300 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-4 text-center text-sm text-muted-foreground">
                    仅显示前 300 条，共 {analysis.productNetting.length} 条。
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}

function RonghangReportPanels({ report }: { report: RonghangZipReport }) {
  const o = report.overview
  const equityOption = useMemo(() => {
    const dates = report.equityCurve.map((p) => p.date)
    return {
      tooltip: { trigger: "axis" },
      legend: { data: ["权益", "净值", "回撤"] },
      grid: { left: 56, right: 56, top: 40, bottom: 40 },
      xAxis: { type: "category", data: dates },
      yAxis: [
        { type: "value", name: "权益", scale: true },
        { type: "value", name: "净值/回撤", scale: true },
      ],
      series: [
        {
          name: "权益",
          type: "line",
          data: report.equityCurve.map((p) => p.equity),
          showSymbol: false,
          itemStyle: { color: "#2563eb" },
        },
        {
          name: "净值",
          type: "line",
          yAxisIndex: 1,
          data: report.equityCurve.map((p) => +p.nav.toFixed(4)),
          showSymbol: false,
          itemStyle: { color: "#059669" },
        },
        {
          name: "回撤",
          type: "line",
          yAxisIndex: 1,
          data: report.equityCurve.map((p) => +(-p.drawdown * 100).toFixed(2)),
          showSymbol: false,
          areaStyle: { color: "rgba(220,38,38,0.12)" },
          itemStyle: { color: "#dc2626" },
        },
      ],
    }
  }, [report.equityCurve])

  const marginOption = useMemo(
    () => ({
      tooltip: { trigger: "axis" },
      grid: { left: 48, right: 24, top: 30, bottom: 40 },
      xAxis: { type: "category", data: report.equityCurve.map((p) => p.date) },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => `${v}%` } },
      series: [
        {
          name: "保证金占比",
          type: "line",
          data: report.equityCurve.map((p) => +(p.marginRatio * 100).toFixed(2)),
          showSymbol: false,
          areaStyle: { color: "rgba(37,99,235,0.08)" },
          itemStyle: { color: "#2563eb" },
        },
      ],
    }),
    [report.equityCurve],
  )

  const monthlyOption = useMemo(
    () => ({
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ name: string; value: number; dataIndex: number }>) => {
          const p = params[0]
          const row = report.monthlyReturns[p.dataIndex]
          return `${p.name}<br/>收益率 ${(p.value).toFixed(2)}%<br/>盈亏 ${formatSignedCurrency(row?.pnl)}`
        },
      },
      grid: { left: 48, right: 24, top: 30, bottom: 40 },
      xAxis: { type: "category", data: report.monthlyReturns.map((m) => m.month) },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => `${v}%` } },
      series: [
        {
          type: "bar",
          data: report.monthlyReturns.map((m) => ({
            value: +(m.returnPct * 100).toFixed(2),
            itemStyle: { color: m.returnPct >= 0 ? "#059669" : "#dc2626" },
          })),
        },
      ],
    }),
    [report.monthlyReturns],
  )

  const sectorOption = useMemo(() => {
    const rows = [...report.sectorPnl].sort((a, b) => a.pnl - b.pnl)
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ name: string; value: number; dataIndex: number }>) => {
          const row = rows[params[0]?.dataIndex]
          if (!row) return ""
          return `${row.name}<br/>盈亏 ${formatSignedCurrency(row.pnl)}<br/>手数 ${row.lots.toFixed(1)}`
        },
      },
      grid: { left: 88, right: 24, top: 20, bottom: 30 },
      xAxis: { type: "value" },
      yAxis: { type: "category", data: rows.map((r) => r.name) },
      series: [
        {
          type: "bar",
          data: rows.map((r) => ({
            value: r.pnl,
            itemStyle: { color: r.pnl >= 0 ? "#059669" : "#dc2626" },
          })),
        },
      ],
    }
  }, [report.sectorPnl])

  const productOption = useMemo(() => {
    const rows = [...report.productPnl].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 12).sort((a, b) => a.pnl - b.pnl)
    return {
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ name: string; value: number; dataIndex: number }>) => {
          const row = rows[params[0]?.dataIndex]
          if (!row) return ""
          return `${row.name}<br/>盈亏 ${formatSignedCurrency(row.pnl)}<br/>手数 ${row.lots.toFixed(1)}`
        },
      },
      grid: { left: 108, right: 24, top: 20, bottom: 30 },
      xAxis: { type: "value" },
      yAxis: { type: "category", data: rows.map((r) => r.name) },
      series: [
        {
          type: "bar",
          data: rows.map((r) => ({
            value: r.pnl,
            itemStyle: { color: r.pnl >= 0 ? "#059669" : "#dc2626" },
          })),
        },
      ],
    }
  }, [report.productPnl])

  const metricCards: Array<{ label: string; value: string; hint?: string; tone?: string }> = [
    { label: "期初资金", value: formatCurrency(o.startBalance) },
    { label: "期末权益", value: formatCurrency(o.endEquity) },
    { label: "净收益", value: formatSignedCurrency(o.netProfit), tone: o.netProfit >= 0 ? "text-emerald-700" : "text-red-700" },
    { label: "周期收益", value: formatPercentPrecise(o.periodReturn), tone: o.periodReturn >= 0 ? "text-emerald-700" : "text-red-700" },
    { label: "年化收益", value: formatPercentPrecise(o.annualizedReturn) },
    { label: "最大回撤", value: formatPercentPrecise(o.maxPeakDrawdown, 4), tone: "text-red-700" },
    { label: "夏普比率", value: formatRatio(o.sharpe) },
    { label: "卡玛比率", value: formatRatio(o.calmar) },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-3">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className={`text-2xl ${card.tone ?? ""}`}>{card.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>第一部分 总览</CardTitle>
          <CardDescription>
            账号 {report.meta.clientId || "--"} · 投顾 {report.meta.clientName || "--"} · {report.meta.startDate} ~ {report.meta.endDate} · {report.meta.tradingDays} 个交易日
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
          {[
            ["总入金", formatCurrency(o.totalDeposit)],
            ["总出金", formatCurrency(o.totalWithdraw)],
            ["净出入金", formatCurrency(o.netDeposit)],
            ["总手续费", formatCurrency(o.totalFee)],
            ["单位净值(峰值)", formatRatio(o.unitNav)],
            ["单日最大回撤", formatPercentPrecise(o.maxDailyDrawdown, 4)],
            ["年化波动率", formatPercentPrecise(o.annualizedVol, 2)],
            ["年化下行波动率", formatPercentPrecise(o.annualizedDownsideVol, 2)],
            ["总交易量", `${o.totalLots.toFixed(1)} 手`],
            ["总交易次数", `${o.totalTrades} 次`],
            ["日胜率", formatPercentPrecise(o.dailyWinRate)],
            ["月胜率", formatPercentPrecise(o.monthlyWinRate)],
            ["日均保证金", formatCurrency(o.avgMargin)],
            ["日均保证金比", formatPercentPrecise(o.avgMarginRatio, 4)],
            ["索提诺比率", formatRatio(o.sortino)],
            ["日均手续费比", formatPercentPrecise(o.avgFeeRatio, 4)],
            ["连续回撤天数", `${o.continuousDrawdownCalendarDays} 天`],
            ["最长未创新高", `${o.longestUnderwaterCalendarDays} 天`],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>2.1 / 2.3 权益、净值与动态回撤</CardTitle>
            <CardDescription>{report.narrative.returnSummary}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={equityOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
            <p className="mt-3 text-sm text-muted-foreground">{report.narrative.drawdownSummary}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>2.5 保证金占用比</CardTitle>
            <CardDescription>{report.narrative.navSummary}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={marginOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>2.2 / 2.7 月收益率与月度盈亏</CardTitle>
            <CardDescription>{report.narrative.monthlySummary}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={monthlyOption} style={{ height: 320, width: "100%" }} notMerge lazyUpdate />
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>月份</TableHead>
                  <TableHead className="text-right">收益率</TableHead>
                  <TableHead className="text-right">盈亏</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.monthlyReturns.map((row) => (
                  <TableRow key={row.month}>
                    <TableCell>{row.month}</TableCell>
                    <TableCell className={`text-right ${row.returnPct >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {formatPercentPrecise(row.returnPct)}
                    </TableCell>
                    <TableCell className={`text-right ${row.pnl >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {formatSignedCurrency(row.pnl)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>2.4 回撤分布</CardTitle>
            <CardDescription>按交易日回撤落入各区间的天数与占比。</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>回撤率</TableHead>
                  <TableHead className="text-right">天数</TableHead>
                  <TableHead className="text-right">占比</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.drawdownBuckets.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right">{row.days}</TableCell>
                    <TableCell className="text-right">{formatPercentPrecise(row.share)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>3.1 板块盈亏分析</CardTitle>
            <CardDescription>
              亏损最多：{report.narrative.topLossSectors[0] ?? "—"}；盈利最多：{report.narrative.topProfitSectors[0] ?? "—"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={sectorOption} style={{ height: 320, width: "100%" }} notMerge lazyUpdate />
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {report.narrative.topLossSectors.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {report.narrative.topProfitSectors.map((line) => (
                <li key={`p-${line}`}>{line}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>3.2 品种盈亏分析</CardTitle>
            <CardDescription>
              亏损最多：{report.narrative.topLossProducts[0] ?? "—"}；盈利最多：{report.narrative.topProfitProducts[0] ?? "—"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={productOption} style={{ height: 320, width: "100%" }} notMerge lazyUpdate />
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {report.narrative.topLossProducts.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {report.narrative.topProfitProducts.map((line) => (
                <li key={`p-${line}`}>{line}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>品种绩效归因</CardTitle>
          <CardDescription>平仓盈亏 + 当日持仓盯市盈亏，按品种与开仓方向汇总。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>品种</TableHead>
                <TableHead>方向</TableHead>
                <TableHead className="text-right">利润</TableHead>
                <TableHead className="text-right">利润比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.directionAttribution.map((row) => (
                <TableRow key={`${row.product}-${row.direction}`}>
                  <TableCell>{row.productName}</TableCell>
                  <TableCell>{row.direction}</TableCell>
                  <TableCell className={`text-right ${row.pnl >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {formatSignedCurrency(row.pnl)}
                  </TableCell>
                  <TableCell className="text-right">{formatPercentPrecise(row.weight)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>品种</TableHead>
                <TableHead>板块</TableHead>
                <TableHead className="text-right">利润</TableHead>
                <TableHead className="text-right">手数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...report.productPnl].sort((a, b) => a.pnl - b.pnl).map((row) => (
                <TableRow key={row.key}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.sector ?? "其他"}</TableCell>
                  <TableCell className={`text-right ${row.pnl >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {formatSignedCurrency(row.pnl)}
                  </TableCell>
                  <TableCell className="text-right">{row.lots.toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>3.3 多空胜率分析</CardTitle>
            <CardDescription>基于平仓明细；注：最后一日持仓盈亏未单独计入胜率统计。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {(
              [
                ["汇总", report.longShortStats.overall],
                ["多头-卖平", report.longShortStats.longClose],
                ["空头-买平", report.longShortStats.shortClose],
              ] as const
            ).map(([title, stats]) => (
              <div key={title} className="rounded-lg border p-3">
                <div className="mb-2 font-medium">{title}</div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div>盈利手数 {stats.win.lots.toFixed(1)}</div>
                  <div>亏损手数 {stats.loss.lots.toFixed(1)}</div>
                  <div>累计盈亏 {formatSignedCurrency(stats.totalPnl)}</div>
                  <div>胜率 {formatPercentPrecise(stats.winRate)} / 盈亏比 {formatRatio(stats.profitFactor, 2)}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>3.4 周期分析</CardTitle>
            <CardDescription>日内=当日开平；短线≤5日；中线≤20日；超过20日为长线。</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>周期</TableHead>
                  <TableHead className="text-right">累计盈亏</TableHead>
                  <TableHead className="text-right">手数</TableHead>
                  <TableHead className="text-right">手数占比</TableHead>
                  <TableHead className="text-right">胜率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.holdingPeriodStats.map((row) => (
                  <TableRow key={row.period}>
                    <TableCell>{row.period}</TableCell>
                    <TableCell className={`text-right ${row.pnl >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {formatSignedCurrency(row.pnl)}
                    </TableCell>
                    <TableCell className="text-right">{row.lots.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{formatPercentPrecise(row.lotShare)}</TableCell>
                    <TableCell className="text-right">{formatPercentPrecise(row.winRate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {report.warnings.length ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>解析提示</AlertTitle>
          <AlertDescription>
            {report.warnings.slice(0, 8).map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

export default function SettlementAnalysisPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()

  const [analysis, setAnalysis] = useState<SettlementAnalysisResponse | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const [ronghangReport, setRonghangReport] = useState<RonghangZipReport | null>(null)
  const [pendingZip, setPendingZip] = useState<File | null>(null)
  const [isAnalyzingZip, setIsAnalyzingZip] = useState(false)
  const [isZipDragOver, setIsZipDragOver] = useState(false)
  const [isDownloadingRonghang, setIsDownloadingRonghang] = useState<"docx" | "pdf" | null>(null)
  const [advisorName, setAdvisorName] = useState("")

  function isAcceptedFile(file: File) {
    const dotIndex = file.name.lastIndexOf(".")
    const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : ""
    return ACCEPTED_EXTENSIONS.includes(extension) || /交易结算单|结算单/i.test(file.name)
  }

  async function handleAnalyze() {
    if (!pendingFile) {
      toast({
        title: "未选择文件",
        description: "请先拖入或点击选择一个结算单文件。",
        variant: "destructive",
      })
      return
    }

    if (!isAcceptedFile(pendingFile)) {
      toast({
        title: "文件格式不支持",
        description: `仅支持 ${ACCEPTED_EXTENSIONS.join(" / ")} 结算单文件。`,
        variant: "destructive",
      })
      return
    }

    setIsAnalyzing(true)
    try {
      const formData = new FormData()
      formData.append("file", pendingFile)

      const response = await fetch("/ma/api/tools/settlement-analysis/analyze", {
        method: "POST",
        body: formData,
      })
      const payload = (await response.json()) as SettlementAnalysisResponse | { error: string }
      if (!response.ok) {
        throw new Error(readErrorMessage(payload, "结算单分析失败。"))
      }

      setAnalysis(payload as SettlementAnalysisResponse)
      toast({
        title: "分析完成",
        description: "已生成持仓、板块、多空结构与策略推断结果。",
      })
    } catch (error) {
      toast({
        title: "分析失败",
        description: error instanceof Error ? error.message : "结算单分析失败。",
        variant: "destructive",
      })
    } finally {
      setIsAnalyzing(false)
    }
  }

  function clearAll() {
    setAnalysis(null)
    setPendingFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  function clearZipAll() {
    setRonghangReport(null)
    setPendingZip(null)
    setIsDownloadingRonghang(null)
    setAdvisorName("")
    if (zipInputRef.current) {
      zipInputRef.current.value = ""
    }
  }

  function isAcceptedZip(file: File) {
    const name = (file.name || "").trim().replace(/\\/g, "/")
    const base = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name
    if (/\.(zip|rar)$/i.test(base)) return true
    // Some browsers / downloaders omit the extension but set archive MIME types
    const mime = (file.type || "").toLowerCase()
    return (
      mime === "application/zip" ||
      mime === "application/x-zip-compressed" ||
      mime === "application/x-zip" ||
      mime === "multipart/x-zip" ||
      mime === "application/vnd.rar" ||
      mime === "application/x-rar-compressed" ||
      mime === "application/x-rar"
    )
  }

  function pickZipFile(fileList: FileList | File[] | null | undefined): File | null {
    const files = fileList ? Array.from(fileList) : []
    return files.find((file) => isAcceptedZip(file)) ?? null
  }

  function pickZipFromDataTransfer(dataTransfer: DataTransfer): File | null {
    const fromFiles = pickZipFile(dataTransfer.files)
    if (fromFiles) return fromFiles
    const items = dataTransfer.items ? Array.from(dataTransfer.items) : []
    for (const item of items) {
      if (item.kind !== "file") continue
      const file = item.getAsFile()
      if (file && isAcceptedZip(file)) return file
    }
    return null
  }

  async function handleDownloadRonghangReport(format: "docx" | "pdf") {
    if (!pendingZip) {
      toast({
        title: "未选择文件",
        description: "请先拖入融航结算单 ZIP/RAR，再下载 Word / PDF 报告。",
        variant: "destructive",
      })
      return
    }
    setIsDownloadingRonghang(format)
    try {
      const formData = new FormData()
      formData.append("file", pendingZip)
      if (advisorName.trim()) {
        formData.append("advisor", advisorName.trim())
      }
      const response = await fetch(`/ma/api/tools/settlement-analysis/ronghang-download-report?format=${format}`, {
        method: "POST",
        body: formData,
      })
      if (!response.ok) {
        let message = `报告下载失败（HTTP ${response.status}）。`
        try {
          const payload = (await response.json()) as { error?: string; detail?: string }
          const detail = (payload.detail || "").trim()
          const shortDetail =
            detail
              .split(/\r?\n/)
              .map((line) => line.trim())
              .find((line) => line && !/^Traceback/i.test(line)) || ""
          message =
            payload.error?.trim() ||
            (shortDetail ? `报告生成失败：${shortDetail.slice(0, 240)}` : message)
        } catch {
          /* ignore non-JSON error bodies */
        }
        throw new Error(message)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = format === "pdf" ? "投资报告分析.pdf" : "投资报告分析.docx"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({
        title: format === "pdf" ? "PDF 已开始下载" : "Word 已开始下载",
        description: "报告结构对齐示例「投资报告分析 / data analysis report」。",
      })
    } catch (error) {
      toast({
        title: "下载失败",
        description: error instanceof Error ? error.message : "报告下载失败。",
        variant: "destructive",
      })
    } finally {
      setIsDownloadingRonghang(null)
    }
  }

  async function handleAnalyzeZip() {
    if (!pendingZip) {
      toast({
        title: "未选择文件",
        description: "请先拖入或点击选择融航结算单 ZIP/RAR（如 data.zip / data.rar）。",
        variant: "destructive",
      })
      return
    }
    if (!isAcceptedZip(pendingZip)) {
      toast({
        title: "文件格式不支持",
        description: `当前文件「${pendingZip.name}」不是 .zip/.rar，请重新选择融航结算单压缩包。`,
        variant: "destructive",
      })
      return
    }

    setIsAnalyzingZip(true)
    try {
      const formData = new FormData()
      formData.append("file", pendingZip)
      const response = await fetch("/ma/api/tools/settlement-analysis/ronghang-zip", {
        method: "POST",
        body: formData,
      })
      const payload = (await response.json()) as RonghangZipReport | { error: string }
      if (!response.ok) {
        throw new Error(readErrorMessage(payload, "融航 ZIP 分析失败。"))
      }
      const report = payload as RonghangZipReport
      setRonghangReport(report)
      if (!advisorName.trim() && report.meta.clientName) {
        setAdvisorName(report.meta.clientName)
      }
      toast({
        title: "分析报告已生成",
        description: `已解析 ${report.fileCount} 个交易日结算单。`,
      })
    } catch (error) {
      toast({
        title: "分析失败",
        description: error instanceof Error ? error.message : "融航 ZIP 分析失败。",
        variant: "destructive",
      })
    } finally {
      setIsAnalyzingZip(false)
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(true)
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    if (!isAcceptedFile(file)) {
      toast({
        title: "文件格式不支持",
        description: `仅支持 ${ACCEPTED_EXTENSIONS.join(" / ")} 结算单文件。`,
        variant: "destructive",
      })
      return
    }
    setPendingFile(file)
  }

  function handleZipDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    try {
      event.dataTransfer.dropEffect = "copy"
    } catch {
      /* ignore */
    }
    setIsZipDragOver(true)
  }

  function handleZipDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsZipDragOver(false)
  }

  function handleZipDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsZipDragOver(false)
    const file = pickZipFromDataTransfer(event.dataTransfer)
    if (file) {
      setPendingZip(file)
      return
    }
    const dropped = event.dataTransfer.files?.[0]
    const droppedName = dropped?.name?.trim()
    toast({
      title: "文件格式不支持",
      description: droppedName
        ? `已收到「${droppedName}」，但不是 .zip/.rar。请拖入压缩包本身（如 data.zip / data.rar），不要拖文件夹或解压后的 .xls。`
        : "未识别到压缩包。请拖入 .zip / .rar（如 融航结算单/data.zip），或点击「选择 ZIP」。",
      variant: "destructive",
    })
  }

  const holdingsOption = useMemo(
    () => (analysis?.charts.holdings.length ? buildHoldingsOption(analysis.charts.holdings) : null),
    [analysis],
  )
  const sectorOption = useMemo(
    () => (analysis?.charts.sectors.length ? buildSectorOption(analysis.charts.sectors) : null),
    [analysis],
  )
  const directionOption = useMemo(
    () => (analysis?.charts.directions.length ? buildPieOption(analysis.charts.directions, "多空结构") : null),
    [analysis],
  )
  const exchangeOption = useMemo(
    () => (analysis?.charts.exchanges.length ? buildPieOption(analysis.charts.exchanges, "交易所分布") : null),
    [analysis],
  )

  const [dbAnalysis, setDbAnalysis] = useState<GuoxinDBAnalysisResponse | null>(null)
  const [isLoadingDb, setIsLoadingDb] = useState(false)
  const [dbError, setDbError] = useState<string | null>(null)
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set())

  const [yinheAnalysis, setYinheAnalysis] = useState<GuoxinDBAnalysisResponse | null>(null)
  const [isLoadingYinhe, setIsLoadingYinhe] = useState(false)
  const [yinheError, setYinheError] = useState<string | null>(null)
  const [yinheExpandedClusters, setYinheExpandedClusters] = useState<Set<string>>(new Set())
  const [yinheCfg, setYinheCfg] = useState({
    email: "ch_c7h8@163.com",
    imapHost: "imap.163.com",
    imapPort: 993,
    sender: "galaxyfutures_data@vip.126.com",
    lookbackDays: 120,
    mailboxReady: false,
    mailboxSource: null as "crawl-email" | "local-config" | null,
    crawlStatus: null as string | null,
    resolveError: null as string | null,
    crawlAccounts: [] as {
      account: string
      emailType: string
      imapHost: string
      imapPort: number
      crawlStatus: string
      remark: string
    }[],
  })
  const [isSavingYinheCfg, setIsSavingYinheCfg] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const resp = await fetch("/ma/api/tools/settlement-analysis/yinhe-config")
        if (!resp.ok) return
        const payload = (await resp.json()) as {
          email?: string
          defaultEmail?: string
          imapHost?: string
          imapPort?: number
          sender?: string
          lookbackDays?: number
          mailboxReady?: boolean
          mailboxSource?: "crawl-email" | "local-config" | null
          crawlStatus?: string | null
          resolveError?: string | null
          crawlAccounts?: {
            account: string
            emailType: string
            imapHost: string
            imapPort: number
            crawlStatus: string
            remark: string
          }[]
        }
        setYinheCfg((c) => ({
          ...c,
          email: payload.email || payload.defaultEmail || c.email,
          imapHost: payload.imapHost ?? c.imapHost,
          imapPort: payload.imapPort ?? c.imapPort,
          sender: payload.sender ?? c.sender,
          lookbackDays: payload.lookbackDays ?? c.lookbackDays,
          mailboxReady: Boolean(payload.mailboxReady),
          mailboxSource: payload.mailboxSource ?? null,
          crawlStatus: payload.crawlStatus ?? null,
          resolveError: payload.resolveError ?? null,
          crawlAccounts: payload.crawlAccounts ?? [],
        }))
      } catch {
        /* ignore */
      }
    })()
  }, [])

  async function handleLoadDbAnalysis() {
    setIsLoadingDb(true)
    setDbError(null)
    try {
      const resp = await fetch("/ma/api/tools/settlement-analysis/db-analyze")
      const payload = (await resp.json()) as GuoxinDBAnalysisResponse | { error: string }
      if (!resp.ok) throw new Error(readErrorMessage(payload, "分析失败"))
      setDbAnalysis(payload as GuoxinDBAnalysisResponse)
    } catch (e) {
      setDbError(e instanceof Error ? e.message : "数据库分析失败")
    } finally {
      setIsLoadingDb(false)
    }
  }

  async function handleSaveYinheConfig() {
    setIsSavingYinheCfg(true)
    try {
      const resp = await fetch("/ma/api/tools/settlement-analysis/yinhe-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: yinheCfg.email,
          sender: yinheCfg.sender,
          lookbackDays: yinheCfg.lookbackDays,
        }),
      })
      const payload = (await resp.json()) as { ok?: boolean; error?: string }
      if (!resp.ok) throw new Error(payload.error || "保存失败")
      // Refresh readiness from crawl-email store
      const refresh = await fetch("/ma/api/tools/settlement-analysis/yinhe-config")
      if (refresh.ok) {
        const next = (await refresh.json()) as {
          mailboxReady?: boolean
          mailboxSource?: "crawl-email" | "local-config" | null
          crawlStatus?: string | null
          resolveError?: string | null
          imapHost?: string
          imapPort?: number
        }
        setYinheCfg((c) => ({
          ...c,
          mailboxReady: Boolean(next.mailboxReady),
          mailboxSource: next.mailboxSource ?? null,
          crawlStatus: next.crawlStatus ?? null,
          resolveError: next.resolveError ?? null,
          imapHost: next.imapHost ?? c.imapHost,
          imapPort: next.imapPort ?? c.imapPort,
        }))
      }
      toast({ title: "银河期货邮箱配置已保存" })
    } catch (e) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : "无法保存邮箱配置",
        variant: "destructive",
      })
    } finally {
      setIsSavingYinheCfg(false)
    }
  }

  async function handleLoadYinheAnalysis(skipFetch = false) {
    setIsLoadingYinhe(true)
    setYinheError(null)
    // Match API maxDuration (300s) with a client abort so the button cannot stay stuck forever.
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 290_000)
    try {
      const params = new URLSearchParams()
      if (skipFetch) params.set("skipFetch", "1")
      params.set("lookbackDays", String(yinheCfg.lookbackDays || 120))
      const qs = params.toString()
      const resp = await fetch(`/ma/api/tools/settlement-analysis/yinhe-analyze?${qs}`, {
        signal: controller.signal,
      })
      const payload = (await resp.json()) as (GuoxinDBAnalysisResponse & { meta?: unknown }) | { error: string }
      if (!resp.ok) throw new Error(readErrorMessage(payload, "分析失败"))
      if ("error" in payload) throw new Error(payload.error)
      const { meta: _meta, ...analysis } = payload as GuoxinDBAnalysisResponse & { meta?: unknown }
      setYinheAnalysis(analysis)
      toast({
        title: "银河期货分析完成",
        description: skipFetch ? "已基于已下载附件生成报告。" : "已拉取邮件并生成策略报告。",
      })
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError"
      setYinheError(
        aborted
          ? "拉取超时（约 5 分钟）。可先点「仅用已下载附件分析」，或缩小回看天数后重试。"
          : e instanceof Error
            ? e.message
            : "银河期货邮件分析失败",
      )
    } finally {
      window.clearTimeout(timeoutId)
      setIsLoadingYinhe(false)
    }
  }

  function toggleCluster(key: string) {
    setExpandedClusters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleYinheCluster(key: string) {
    setYinheExpandedClusters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const equityChartOption = useMemo(
    () =>
      dbAnalysis?.equityHistory.length
        ? buildEquityOption(dbAnalysis.equityHistory, deriveOrderTimeline(dbAnalysis))
        : null,
    [dbAnalysis],
  )

  const turnoverChartOption = useMemo(
    () => (dbAnalysis?.turnover.length ? buildTurnoverOption(dbAnalysis.turnover) : null),
    [dbAnalysis],
  )

  const marginChartOption = useMemo(
    () => (dbAnalysis?.equityHistory.length ? buildMarginOption(dbAnalysis.equityHistory) : null),
    [dbAnalysis],
  )

  const orderTimelineOption = useMemo(
    () => (dbAnalysis ? buildOrderTimelineOption(deriveOrderTimeline(dbAnalysis)) : null),
    [dbAnalysis],
  )

  const spreadChartOptions = useMemo(
    () =>
      (dbAnalysis?.spreadCharts ?? []).map((chart) => ({
        id: chart.id,
        name: chart.name,
        option: buildSpreadZ20Option(chart),
        legFills: chart.legFills ?? chart.orderPoints.reduce((s, p) => s + (p.fills ?? 1), 0),
        markerCount: chart.orderPoints.length,
        pairedLegOpenDays: chart.pairedLegOpenDays ?? 0,
        crossMonthHedgeDays: chart.crossMonthHedgeDays ?? 0,
      })),
    [dbAnalysis],
  )

  const yinheEquityChartOption = useMemo(
    () =>
      yinheAnalysis?.equityHistory.length
        ? buildEquityOption(yinheAnalysis.equityHistory, deriveOrderTimeline(yinheAnalysis))
        : null,
    [yinheAnalysis],
  )

  const yinheTurnoverChartOption = useMemo(
    () => (yinheAnalysis?.turnover.length ? buildTurnoverOption(yinheAnalysis.turnover) : null),
    [yinheAnalysis],
  )

  const yinheMarginChartOption = useMemo(
    () => (yinheAnalysis?.equityHistory.length ? buildMarginOption(yinheAnalysis.equityHistory) : null),
    [yinheAnalysis],
  )

  const yinheOrderTimelineOption = useMemo(
    () => (yinheAnalysis ? buildOrderTimelineOption(deriveOrderTimeline(yinheAnalysis)) : null),
    [yinheAnalysis],
  )

  const yinheSpreadChartOptions = useMemo(
    () =>
      (yinheAnalysis?.spreadCharts ?? []).map((chart) => ({
        id: chart.id,
        name: chart.name,
        option: buildSpreadZ20Option(chart),
        legFills: chart.legFills ?? chart.orderPoints.reduce((s, p) => s + (p.fills ?? 1), 0),
        markerCount: chart.orderPoints.length,
        pairedLegOpenDays: chart.pairedLegOpenDays ?? 0,
        crossMonthHedgeDays: chart.crossMonthHedgeDays ?? 0,
      })),
    [yinheAnalysis],
  )

  const hedgeStructurePanels = useMemo(
    () =>
      (dbAnalysis?.hedgeStructureCharts ?? []).map((chart) => ({
        product: chart.product,
        cumulativeOption: buildHedgeCumulativeOption(chart),
        heatOption: buildHedgeOpenHeatOption(chart),
        stats: chart.stats,
        activeDays: chart.activeDays,
      })),
    [dbAnalysis],
  )

  const yinheHedgeStructurePanels = useMemo(
    () =>
      (yinheAnalysis?.hedgeStructureCharts ?? []).map((chart) => ({
        product: chart.product,
        cumulativeOption: buildHedgeCumulativeOption(chart),
        heatOption: buildHedgeOpenHeatOption(chart),
        stats: chart.stats,
        activeDays: chart.activeDays,
      })),
    [yinheAnalysis],
  )

  return (
    <div className="space-y-6 pt-6">
      <div className="space-y-2">
        <Link href="/ma/dashboard/tools" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          返回小工具
        </Link>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">结算单分析</h1>
          <p className="mt-2 text-muted-foreground">
            拖入国信交易结算单(盯市)，或拖入融航多日结算单 ZIP，分析持仓敞口、业绩指标、板块/品种盈亏并生成报告。
          </p>
        </div>
      </div>

      <Alert>
        <FileSpreadsheet className="h-4 w-4" />
        <AlertTitle>支持格式</AlertTitle>
        <AlertDescription>
          单文件支持 xlsx、xls、xlsm、xlsb；融航批量包支持 zip / rar（内含多日 .xls/.xlsx）。上传文件只在分析请求期间进入内存，不会落盘保存。策略判断为启发式推断，用于快速读表，不替代人工复核。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1. 上传并分析</CardTitle>
          <CardDescription>拖入结算单文件，点击“开始分析”后自动识别持仓汇总、持仓明细与账户摘要。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
              isDragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/60 hover:bg-muted/30"
            } ${isAnalyzing ? "pointer-events-none opacity-60" : ""}`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isAnalyzing && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm,.xlsb"
              className="sr-only"
              disabled={isAnalyzing}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) setPendingFile(file)
              }}
            />
            <UploadCloud className={`h-10 w-10 transition-colors ${isDragOver ? "text-primary" : pendingFile ? "text-green-600" : "text-muted-foreground"}`} />
            <div>
              <p className="text-sm font-medium">
                {isDragOver ? "松开鼠标以上传" : pendingFile ? pendingFile.name : "拖拽结算单到此处，或点击选择文件"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pendingFile ? "文件已就绪，点击下方按钮开始分析" : "示例：交易结算单(盯市)_20260525.xlsx"}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button type="button" variant={pendingFile ? "default" : "outline"} size="sm" disabled={isAnalyzing} onClick={(event) => { event.stopPropagation(); void handleAnalyze() }}>
                <ScanSearch className="h-4 w-4" />
                {isAnalyzing ? "分析中..." : pendingFile ? "开始分析" : "选择文件"}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!pendingFile && !analysis} onClick={(event) => { event.stopPropagation(); clearAll() }}>
                <Trash2 className="h-4 w-4" />
                清空
              </Button>
            </div>
          </div>

          {analysis ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">文件：{analysis.sourceFileName}</Badge>
              <Badge variant="outline">客户：{analysis.summary.clientName || analysis.summary.clientId}</Badge>
              <Badge variant="outline">交易日：{analysis.summary.tradeDate}</Badge>
              <Badge variant="outline">持仓合约：{analysis.summary.positionCount}</Badge>
              <Badge variant="outline">板块数：{analysis.summary.sectorCount}</Badge>
              <Badge variant="outline">策略置信度：{confidenceLabel(analysis.strategyInference.confidence)}</Badge>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            2. 融航结算单 ZIP 分析报告
          </CardTitle>
          <CardDescription>
            拖入融航导出的 data.zip / data.rar（内含多个交易日 Excel，每个文件多 sheet），自动提取账户、成交、平仓与持仓数据，生成与「投资报告分析」同结构的业绩/板块/品种报告。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="ronghang-advisor-name" className="shrink-0 text-sm font-medium">
              投顾名称
            </label>
            <Input
              id="ronghang-advisor-name"
              value={advisorName}
              onChange={(event) => setAdvisorName(event.target.value)}
              placeholder="写入封面「投顾名称」，例如：张三"
              className="max-w-md"
              disabled={isAnalyzingZip || !!isDownloadingRonghang}
            />
            <span className="text-xs text-muted-foreground">用于 Word / PDF 封面；不填则用结算单客户名称</span>
          </div>

          <div
            className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
              isZipDragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/60 hover:bg-muted/30"
            } ${isAnalyzingZip ? "pointer-events-none opacity-60" : ""}`}
            onDragOver={handleZipDragOver}
            onDragEnter={handleZipDragOver}
            onDragLeave={handleZipDragLeave}
            onDrop={handleZipDrop}
            onClick={() => !isAnalyzingZip && zipInputRef.current?.click()}
          >
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,.rar,application/zip,application/x-zip-compressed,application/vnd.rar,application/x-rar-compressed"
              className="sr-only"
              disabled={isAnalyzingZip}
              onChange={(event) => {
                const file = pickZipFile(event.target.files) ?? event.target.files?.[0] ?? null
                if (!file) return
                if (!isAcceptedZip(file)) {
                  toast({
                    title: "文件格式不支持",
                    description: `已选择「${file.name}」，仅支持 .zip / .rar 压缩包。`,
                    variant: "destructive",
                  })
                  event.target.value = ""
                  return
                }
                setPendingZip(file)
              }}
            />
            <UploadCloud className={`h-10 w-10 transition-colors ${isZipDragOver ? "text-primary" : pendingZip ? "text-green-600" : "text-muted-foreground"}`} />
            <div>
              <p className="text-sm font-medium">
                {isZipDragOver
                  ? "松开鼠标以上传"
                  : pendingZip
                    ? pendingZip.name
                    : "拖拽融航结算单 ZIP/RAR 到此处，或点击选择文件"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pendingZip
                  ? "文件已就绪：可直接下载 Word/PDF，或先点「生成分析报告」做网页预览"
                  : "请拖入 .zip / .rar 压缩包本身（不要拖文件夹或里面的 .xls）。示例：data.zip"}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                type="button"
                variant={pendingZip ? "default" : "outline"}
                size="sm"
                disabled={isAnalyzingZip || !!isDownloadingRonghang}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!pendingZip) {
                    zipInputRef.current?.click()
                    return
                  }
                  void handleAnalyzeZip()
                }}
              >
                <ScanSearch className="h-4 w-4" />
                {isAnalyzingZip ? "分析中..." : pendingZip ? "生成分析报告" : "选择 ZIP/RAR"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!pendingZip || !!isDownloadingRonghang || isAnalyzingZip}
                onClick={(event) => {
                  event.stopPropagation()
                  void handleDownloadRonghangReport("docx")
                }}
              >
                <Download className="h-4 w-4" />
                {isDownloadingRonghang === "docx" ? "生成 Word 中…" : "下载 Word 报告"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!pendingZip || !!isDownloadingRonghang || isAnalyzingZip}
                onClick={(event) => {
                  event.stopPropagation()
                  void handleDownloadRonghangReport("pdf")
                }}
              >
                <FileSpreadsheet className="h-4 w-4" />
                {isDownloadingRonghang === "pdf" ? "生成 PDF 中…" : "下载 PDF 报告"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!pendingZip && !ronghangReport}
                onClick={(event) => {
                  event.stopPropagation()
                  clearZipAll()
                }}
              >
                <Trash2 className="h-4 w-4" />
                清空
              </Button>
            </div>
          </div>

          {pendingZip ? (
            <p className="text-xs text-muted-foreground">
              Word / PDF 报告按示例「投资报告分析」结构生成（封面、总览、业绩图表、板块/品种盈亏、多空与周期、持仓分析）。下载前无需先点“生成分析报告”，但网页预览需要先分析。
            </p>
          ) : null}

          {ronghangReport ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">文件：{ronghangReport.sourceFileName}</Badge>
              <Badge variant="outline">客户：{ronghangReport.meta.clientName || ronghangReport.meta.clientId}</Badge>
              <Badge variant="outline">
                区间：{ronghangReport.meta.startDate} ~ {ronghangReport.meta.endDate}
              </Badge>
              <Badge variant="outline">交易日：{ronghangReport.meta.tradingDays}</Badge>
              <Badge variant="outline">解析文件：{ronghangReport.fileCount}</Badge>
              <Badge variant="outline">期货公司：{ronghangReport.meta.brokerName || "--"}</Badge>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {ronghangReport ? <RonghangReportPanels report={ronghangReport} /> : null}

      {analysis ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>客户权益</CardDescription>
                <CardTitle className="text-2xl">{formatCurrency(analysis.summary.clientEquity)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>总敞口 / 杠杆</CardDescription>
                <CardTitle className="text-2xl">{formatCurrency(analysis.summary.grossExposure)}</CardTitle>
                <div className="text-sm text-muted-foreground">杠杆 {formatMultiple(analysis.summary.grossLeverage)}</div>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>净敞口</CardDescription>
                <CardTitle className={`text-2xl ${analysis.summary.netExposure >= 0 ? "text-blue-700" : "text-red-700"}`}>
                  {formatSignedCurrency(analysis.summary.netExposure)}
                </CardTitle>
                <div className="text-sm text-muted-foreground">占权益 {formatPercent(analysis.summary.netExposureRatio)}</div>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>风险度 / 可用资金</CardDescription>
                <CardTitle className="text-2xl">{formatPercent(analysis.summary.riskDegreeRatio)}</CardTitle>
                <div className="text-sm text-muted-foreground">可用 {formatCurrency(analysis.summary.fundAvailable)}</div>
              </CardHeader>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>持仓敞口 Top 12</CardTitle>
                <CardDescription>按合约总敞口排序，同时显示净敞口与盯市盈亏倾向。</CardDescription>
              </CardHeader>
              <CardContent>
                {holdingsOption ? (
                  <ReactECharts option={holdingsOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
                ) : (
                  <div className="py-24 text-center text-sm text-muted-foreground">暂无可展示的持仓数据。</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>板块多空结构</CardTitle>
                <CardDescription>多头和空头敞口以左右展开，辅助判断是否存在板块对冲或主题集中。</CardDescription>
              </CardHeader>
              <CardContent>
                {sectorOption ? (
                  <ReactECharts option={sectorOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
                ) : (
                  <div className="py-24 text-center text-sm text-muted-foreground">暂无可展示的板块数据。</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>多空敞口占比</CardTitle>
                <CardDescription>快速观察组合当前是偏多、偏空还是接近中性。</CardDescription>
              </CardHeader>
              <CardContent>
                {directionOption ? (
                  <ReactECharts option={directionOption} style={{ height: 320, width: "100%" }} notMerge lazyUpdate />
                ) : (
                  <div className="py-20 text-center text-sm text-muted-foreground">暂无多空占比数据。</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>交易所分布</CardTitle>
                <CardDescription>识别仓位更集中在股指、上期、郑商、大商等哪类市场。</CardDescription>
              </CardHeader>
              <CardContent>
                {exchangeOption ? (
                  <ReactECharts option={exchangeOption} style={{ height: 320, width: "100%" }} notMerge lazyUpdate />
                ) : (
                  <div className="py-20 text-center text-sm text-muted-foreground">暂无交易所分布数据。</div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>可能交易策略</CardTitle>
                  <Badge variant="outline">{confidenceLabel(analysis.strategyInference.confidence)}置信度</Badge>
                  <Badge variant="outline">{biasLabel(analysis.strategyInference.bias)}</Badge>
                </div>
                <CardDescription>基于板块权重、多空结构、权益占用与集中度做的启发式判断。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="text-sm text-muted-foreground">主判断</div>
                  <div className="mt-1 text-2xl font-semibold">{analysis.strategyInference.primaryStrategy}</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {analysis.strategyInference.candidateStrategies.map((item) => (
                    <Badge key={item} variant="secondary">{item}</Badge>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">判断依据</div>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {analysis.strategyInference.signals.map((signal) => (
                      <li key={signal} className="rounded-md border bg-background px-3 py-2">{signal}</li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">主要风险提示</div>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {analysis.strategyInference.risks.map((risk) => (
                      <li key={risk} className="rounded-md border bg-background px-3 py-2">{risk}</li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>快照摘要</CardTitle>
                <CardDescription>把最容易忽略的账户级信息聚合到一起，便于快速判断仓位状态。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">结算单区间</span>
                  <span className="font-medium">{analysis.summary.dateRangeRaw || "--"}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">多头市值</span>
                  <span className="font-medium text-blue-700">{formatCurrency(analysis.summary.longMarketValue)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">空头市值</span>
                  <span className="font-medium text-red-700">{formatCurrency(analysis.summary.shortMarketValue)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">盯市盈亏</span>
                  <span className={`font-medium ${analysis.summary.mtmPl != null && analysis.summary.mtmPl >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedCurrency(analysis.summary.mtmPl)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">平仓盈亏</span>
                  <span className={`font-medium ${analysis.summary.realizedPl != null && analysis.summary.realizedPl >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedCurrency(analysis.summary.realizedPl)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">最大合约</span>
                  <span className="font-medium">{analysis.summary.topPositionName || "--"}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">最大板块</span>
                  <span className="font-medium">{analysis.summary.topSectorName || "--"}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">最大板块占比</span>
                  <span className="font-medium">{formatPercent(analysis.summary.topSectorShare)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">保证金占用</span>
                  <span className="font-medium">{formatCurrency(analysis.summary.marginOccupied)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">持仓明细行数</span>
                  <span className="font-medium">{analysis.summary.detailRowCount}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {analysis.warnings.length ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>分析提示</AlertTitle>
              <AlertDescription>
                {analysis.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                <CardTitle>持仓明细表</CardTitle>
              </div>
              <CardDescription>按总敞口排序，可快速查看每个合约的多空手数、净敞口与盯市盈亏。</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>合约</TableHead>
                    <TableHead>品种</TableHead>
                    <TableHead>板块</TableHead>
                    <TableHead>交易所</TableHead>
                    <TableHead className="text-right">多头手数</TableHead>
                    <TableHead className="text-right">空头手数</TableHead>
                    <TableHead className="text-right">总敞口</TableHead>
                    <TableHead className="text-right">净敞口</TableHead>
                    <TableHead className="text-right">盯市盈亏</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.positions.slice(0, 24).map((position, idx) => (
                    <TableRow key={`${idx}-${position.symbol}-${position.exchange}`}>
                      <TableCell className="font-medium">{position.symbol}</TableCell>
                      <TableCell>{position.productName}</TableCell>
                      <TableCell>{position.sector}</TableCell>
                      <TableCell>{position.exchange}</TableCell>
                      <TableCell className="text-right">{position.longLots.toFixed(0)}</TableCell>
                      <TableCell className="text-right">{position.shortLots.toFixed(0)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(position.grossMarketValue)}</TableCell>
                      <TableCell className={`text-right ${position.netMarketValue >= 0 ? "text-blue-700" : "text-red-700"}`}>{formatSignedCurrency(position.netMarketValue)}</TableCell>
                      <TableCell className={`text-right ${position.mtmPl >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedCurrency(position.mtmPl)}</TableCell>
                    </TableRow>
                  ))}
                  {analysis.positions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                        当前结算单未提取到有效持仓。
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* ============================================================ */}
      {/* 国信期货账户策略报告 (数据库) */}
      {/* ============================================================ */}

      <div className="space-y-2 border-t pt-8">
        <h2 className="text-2xl font-semibold tracking-tight">国信期货账户策略报告</h2>
        <p className="text-muted-foreground">从 PostgreSQL 数据库直接读取历史账户与交易数据，生成策略报告，无需上传结算单文件。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            从数据库生成报告
          </CardTitle>
          <CardDescription>读取 guosen_account_summary、guosen_transaction_records、guosen_position_summary、guosen_position_closed 四张表，分析至最新结算日。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Button onClick={() => void handleLoadDbAnalysis()} disabled={isLoadingDb}>
            <TrendingUp className="h-4 w-4" />
            {isLoadingDb ? "加载中…" : dbAnalysis ? "重新生成" : "生成策略报告"}
          </Button>
          <Button
            variant="outline"
            onClick={() => { window.open("/ma/api/tools/settlement-analysis/download-report", "_blank") }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            下载 Word 报告
          </Button>
          {dbAnalysis ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">区间：{dbAnalysis.dateRange.start} ~ {dbAnalysis.dateRange.end}</Badge>
              <Badge variant="outline">交易天数：{dbAnalysis.equityStats.totalDays}</Badge>
              <Badge variant="outline">交易品种：{dbAnalysis.uniqueProducts.length}</Badge>
            </div>
          ) : null}
          {dbError ? <p className="text-sm text-red-600">{dbError}</p> : null}
        </CardContent>
      </Card>

      {dbAnalysis ? (
        <StrategyReportPanels
          analysis={dbAnalysis}
          equityChartOption={equityChartOption}
          turnoverChartOption={turnoverChartOption}
          marginChartOption={marginChartOption}
          orderTimelineOption={orderTimelineOption}
          spreadChartOptions={spreadChartOptions}
          hedgeStructurePanels={hedgeStructurePanels}
          expandedClusters={expandedClusters}
          toggleCluster={toggleCluster}
        />
      ) : null}

      {/* ============================================================ */}
      {/* 银河期货账户策略报告 (邮件) */}
      {/* ============================================================ */}

      <div className="space-y-2 border-t pt-8">
        <h2 className="text-2xl font-semibold tracking-tight">银河期货账户策略报告</h2>
        <p className="text-muted-foreground">
          从邮箱拉取银河期货结算邮件（发件人 galaxyfutures_data@vip.126.com），解析 TXT/XLS 附件后生成策略报告。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            邮箱配置
          </CardTitle>
          <CardDescription>
            复用「运维 → 抓取邮箱设置」中的 IMAP 账号（默认 ch_c7h8@163.com），拉取发件人 galaxyfutures_data@vip.126.com 的结算附件。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {yinheCfg.mailboxReady ? (
              <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                凭据就绪
                {yinheCfg.mailboxSource === "crawl-email" ? " · 来自抓取邮箱设置" : " · 本地配置"}
                {yinheCfg.crawlStatus ? ` · ${yinheCfg.crawlStatus}` : ""}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-red-300 text-red-700">
                凭据未就绪
              </Badge>
            )}
            <span className="text-muted-foreground font-mono text-xs">{yinheCfg.imapHost}:{yinheCfg.imapPort}</span>
          </div>
          {yinheCfg.resolveError ? (
            <p className="text-sm text-red-600">{yinheCfg.resolveError}</p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">收件邮箱（抓取邮箱设置）</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={yinheCfg.email}
                onChange={(e) => {
                  const account = e.target.value
                  const hit = yinheCfg.crawlAccounts.find((a) => a.account === account)
                  setYinheCfg((c) => ({
                    ...c,
                    email: account,
                    imapHost: hit?.imapHost || c.imapHost,
                    imapPort: hit?.imapPort || c.imapPort,
                    crawlStatus: hit?.crawlStatus ?? c.crawlStatus,
                  }))
                }}
              >
                {yinheCfg.crawlAccounts.length === 0 ? (
                  <option value={yinheCfg.email}>{yinheCfg.email || "ch_c7h8@163.com"}</option>
                ) : (
                  yinheCfg.crawlAccounts.map((a) => (
                    <option key={a.account} value={a.account}>
                      {a.account}
                      {a.remark ? `（${a.remark}）` : ""}
                      {a.crawlStatus ? ` · ${a.crawlStatus}` : ""}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">发件人过滤</label>
              <Input
                className="h-9 text-sm font-mono"
                value={yinheCfg.sender}
                onChange={(e) => setYinheCfg((c) => ({ ...c, sender: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">回看天数</label>
              <Input
                className="h-9 text-sm"
                type="number"
                min={7}
                max={730}
                value={yinheCfg.lookbackDays}
                onChange={(e) =>
                  setYinheCfg((c) => ({ ...c, lookbackDays: Number(e.target.value) || 120 }))
                }
              />
            </div>
          </div>
          <Button variant="outline" onClick={() => void handleSaveYinheConfig()} disabled={isSavingYinheCfg}>
            <Save className="h-4 w-4" />
            {isSavingYinheCfg ? "保存中…" : "保存配置"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            从邮件生成报告
          </CardTitle>
          <CardDescription>
            使用抓取邮箱拉取结算附件 → 解析入库（yinhe_* 表）→ 生成与国信同结构的策略分析。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Button
            onClick={() => void handleLoadYinheAnalysis(false)}
            disabled={isLoadingYinhe || !yinheCfg.mailboxReady}
          >
            <TrendingUp className="h-4 w-4" />
            {isLoadingYinhe ? "拉取并分析中…" : yinheAnalysis ? "重新拉取并生成" : "生成策略报告"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleLoadYinheAnalysis(true)}
            disabled={isLoadingYinhe}
          >
            仅用已下载附件分析
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.open("/ma/api/tools/settlement-analysis/yinhe-download-report", "_blank")
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            下载 Word 报告
          </Button>
          {yinheAnalysis ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">区间：{yinheAnalysis.dateRange.start} ~ {yinheAnalysis.dateRange.end}</Badge>
              <Badge variant="outline">交易天数：{yinheAnalysis.equityStats.totalDays}</Badge>
              <Badge variant="outline">交易品种：{yinheAnalysis.uniqueProducts.length}</Badge>
            </div>
          ) : null}
          {yinheError ? <p className="w-full text-sm text-red-600">{yinheError}</p> : null}
        </CardContent>
      </Card>

      {yinheAnalysis ? (
        <StrategyReportPanels
          analysis={yinheAnalysis}
          equityChartOption={yinheEquityChartOption}
          turnoverChartOption={yinheTurnoverChartOption}
          marginChartOption={yinheMarginChartOption}
          orderTimelineOption={yinheOrderTimelineOption}
          spreadChartOptions={yinheSpreadChartOptions}
          hedgeStructurePanels={yinheHedgeStructurePanels}
          expandedClusters={yinheExpandedClusters}
          toggleCluster={toggleYinheCluster}
        />
      ) : null}
    </div>
  )
}