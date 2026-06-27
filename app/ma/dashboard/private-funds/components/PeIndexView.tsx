"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { ChevronDown, ChevronsUpDown, ChevronUp, Download, Menu, X } from "lucide-react"

const MAX_SELECTED = 20

const SERIES_COLORS = [
  "#f97316",
  "#D93025",
  "#1A73E8",
  "#9333ea",
  "#14b8a6",
  "#22c55e",
  "#FBBC04",
  "#EC4899",
  "#78716C",
  "#2563eb",
  "#84cc16",
  "#06b6d4",
  "#a855f7",
  "#ef4444",
  "#64748b",
  "#0ea5e9",
  "#eab308",
  "#dc2626",
  "#4f46e5",
  "#059669",
]

type IndexItem = {
  id: string
  label: string
  category?: string
  benchmarkKey?: string
}

type ProviderConfig = {
  key: string
  label: string
  mode: "tags" | "checkbox"
  categories?: string[]
  items: IndexItem[]
}

const INDEX_PROVIDERS: ProviderConfig[] = [
  {
    key: "yingfeng",
    label: "盈丰指数",
    mode: "tags",
    items: [
      { id: "yf-500-jx", label: "盈丰500精选私募指数" },
      { id: "yf-zz500-zz", label: "盈丰中证500指增精选指数" },
      { id: "yf-300-zz", label: "盈丰300指增精选指数" },
      { id: "yf-1000-jx", label: "盈丰1000精选私募指数" },
      { id: "yf-zgdt", label: "盈丰主观多头精选指数" },
      { id: "yf-lhdt", label: "盈丰量化多头精选指数" },
      { id: "yf-sczx", label: "盈丰股票市场中性精选指数" },
      { id: "yf-cta", label: "盈丰CTA精选指数" },
    ],
  },
  {
    key: "xincaifu",
    label: "新财富指数",
    mode: "checkbox",
    categories: ["指数增强", "量化中性", "股票多空", "量化套利", "主观多头", "债券策略", "多资产策略", "组合基金"],
    items: [
      { id: "xcf-500-zz", label: "新财富500指增私募指数", category: "指数增强" },
      { id: "xcf-1000-zz", label: "新财富1000指增私募指数", category: "指数增强" },
      { id: "xcf-300-zz", label: "新财富300指增私募指数", category: "指数增强" },
      { id: "xcf-a500-zz", label: "新财富A500指增私募指数", category: "指数增强" },
      { id: "xcf-lhxz", label: "新财富量化中性私募指数", category: "量化中性" },
      { id: "xcf-sczx", label: "新财富股票市场中性私募指数", category: "量化中性" },
      { id: "xcf-gpdk", label: "新财富股票多空私募指数", category: "股票多空" },
      { id: "xcf-lhtl", label: "新财富量化套利私募指数", category: "量化套利" },
      { id: "xcf-zgdt", label: "新财富主观多头私募指数", category: "主观多头" },
      { id: "xcf-zq", label: "新财富债券策略私募指数", category: "债券策略" },
      { id: "xcf-dzc", label: "新财富多资产策略私募指数", category: "多资产策略" },
      { id: "xcf-zh", label: "新财富组合基金私募指数", category: "组合基金" },
    ],
  },
  {
    key: "guolian",
    label: "国联期货指数",
    mode: "checkbox",
    categories: ["量化多头", "股票市场中性", "期货及衍生品", "多资产策略", "债券策略", "组合基金"],
    items: [
      { id: "gl-500-zz", label: "国联期货500指增精选指数", category: "量化多头" },
      { id: "gl-1000-zz", label: "国联期货1000指增精选指数", category: "量化多头" },
      { id: "gl-300-zz", label: "国联期货300指增精选指数", category: "量化多头" },
      { id: "gl-lhdt", label: "国联期货量化多头精选指数", category: "量化多头" },
      { id: "gl-sczx", label: "国联期货股票市场中性精选指数", category: "股票市场中性" },
      { id: "gl-cta", label: "国联期货CTA精选指数", category: "期货及衍生品" },
      { id: "gl-dzc", label: "国联期货多资产策略精选指数", category: "多资产策略" },
      { id: "gl-zq", label: "国联期货债券策略精选指数", category: "债券策略" },
      { id: "gl-zh", label: "国联期货组合基金精选指数", category: "组合基金" },
    ],
  },
  {
    key: "zhaoshang",
    label: "招商指数",
    mode: "tags",
    items: [
      { id: "zs-hh", label: "招商混合私募指数" },
      { id: "zs-cta", label: "招商CTA私募指数" },
      { id: "zs-500-zz", label: "招商500指增私募指数" },
      { id: "zs-sczx", label: "招商股票市场中性私募指数" },
      { id: "zs-zgdt", label: "招商主观多头私募指数" },
      { id: "zs-lhdt", label: "招商量化多头私募指数" },
      { id: "zs-dzc", label: "招商多资产策略私募指数" },
    ],
  },
  {
    key: "market",
    label: "市场指数",
    mode: "tags",
    items: [
      { id: "mkt-IH", label: "上证50", benchmarkKey: "IH" },
      { id: "mkt-IF", label: "沪深300", benchmarkKey: "IF" },
      { id: "mkt-IC", label: "中证500", benchmarkKey: "IC" },
      { id: "mkt-IM", label: "中证1000", benchmarkKey: "IM" },
      { id: "mkt-800", label: "中证800" },
      { id: "mkt-cyb", label: "创业板指" },
      { id: "mkt-kc50", label: "科创50" },
    ],
  },
]

const ALL_ITEMS = INDEX_PROVIDERS.flatMap((p) => p.items)
const ITEM_BY_ID = new Map(ALL_ITEMS.map((item) => [item.id, item]))

const DEFAULT_SELECTED = [
  "yf-zz500-zz",
  "yf-500-jx",
  "yf-300-zz",
  "xcf-500-zz",
  "xcf-1000-zz",
  "gl-500-zz",
  "gl-1000-zz",
]

function hashSeed(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

function tradingDates(from: string, to: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cursor <= end) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

function pseudoReturnCurve(indexId: string, dates: string[]): Array<[string, number]> {
  if (!dates.length) return []
  let level = 1
  return dates.map((date) => {
    const seed = hashSeed(`${indexId}:${date}`)
    const drift = ((seed % 1000) / 1000 - 0.48) * divisorForIndex(indexId)
    const wave = Math.sin((seed % 360) * (Math.PI / 180)) * 0.15
    const daily = (drift + wave) / 100
    level *= 1 + daily
    const ret = (level - 1) * 100
    return [date, Math.round(ret * 100) / 100] as [string, number]
  })
}

function divisorForIndex(indexId: string): number {
  if (indexId.startsWith("yf")) return 1.4
  if (indexId.startsWith("xcf")) return 1.1
  if (indexId.startsWith("gl")) return 1.0
  if (indexId.startsWith("zs")) return 0.9
  return 0.6
}

function rebaseToReturn(data: Array<{ date: string; value: number }>): Array<[string, number]> {
  if (!data.length) return []
  const base = data[0].value
  return data.map((pt) => [
    pt.date,
    Math.round(((pt.value / base) - 1) * 10000) / 100,
  ] as [string, number])
}

type SeriesData = {
  id: string
  name: string
  color: string
  points: Array<[string, number]>
}

type CurvePoint = { d: string; v: number }

type IndexMetrics = {
  id: string
  name: string
  periodReturn: number | null
  annReturn: number | null
  annVol: number | null
  sharpe: number | null
  calmar: number | null
  sortino: number | null
  downsideRisk: number | null
  maxDrawdown: number | null
  ddRecoveryDays: number | "未回补" | null
  longestNoNewHighDays: number | null
}

type MetricsSortKey = keyof Omit<IndexMetrics, "id" | "name">

const METRICS_COLUMNS: { key: MetricsSortKey; label: string; pct?: boolean; ratio?: boolean; days?: boolean }[] = [
  { key: "periodReturn", label: "区间收益", pct: true },
  { key: "annReturn", label: "年化收益", pct: true },
  { key: "annVol", label: "年化波动率", pct: true },
  { key: "sharpe", label: "夏普比率", ratio: true },
  { key: "calmar", label: "卡玛比率", ratio: true },
  { key: "sortino", label: "索提诺比率", ratio: true },
  { key: "downsideRisk", label: "下行风险", pct: true },
  { key: "maxDrawdown", label: "最大回撤", pct: true },
  { key: "ddRecoveryDays", label: "最大回撤回补期(天)", days: true },
  { key: "longestNoNewHighDays", label: "连续不创新高天数(天)", days: true },
]

function std(values: number[]): number {
  if (values.length < 2) return 0
  const m = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function periodicReturns(points: CurvePoint[]): number[] {
  const rets: number[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = 1 + points[i - 1].v / 100
    const curr = 1 + points[i].v / 100
    if (prev > 0) rets.push(curr / prev - 1)
  }
  return rets
}

function maxDrawdownStats(points: CurvePoint[]) {
  if (points.length === 0) {
    return { maxDrawdown: null as number | null, recoveryDays: null as number | "未回补" | null, longestNoNewHigh: null as number | null }
  }

  let peak = 1 + points[0].v / 100
  let maxDd = 0
  let longestNoNewHigh = 0
  let currentNoNewHigh = 0
  let underwaterStart: number | null = null
  let recoveryDays: number | "未回补" | null = null

  points.forEach((point, idx) => {
    const level = 1 + point.v / 100
    if (level >= peak) {
      peak = level
      currentNoNewHigh = 0
      if (underwaterStart != null && recoveryDays == null) recoveryDays = idx - underwaterStart
      underwaterStart = null
    } else {
      currentNoNewHigh++
      longestNoNewHigh = Math.max(longestNoNewHigh, currentNoNewHigh)
      if (underwaterStart == null) underwaterStart = idx
      const dd = peak > 0 ? (peak - level) / peak : 0
      maxDd = Math.max(maxDd, dd)
    }
  })

  if (underwaterStart != null && recoveryDays == null) recoveryDays = "未回补"

  return {
    maxDrawdown: maxDd * 100,
    recoveryDays,
    longestNoNewHigh: longestNoNewHigh || null,
  }
}

function computeIndexMetrics(series: SeriesData): IndexMetrics {
  const points: CurvePoint[] = series.points.map(([d, v]) => ({ d, v }))
  if (points.length < 2) {
    return {
      id: series.id,
      name: series.name,
      periodReturn: null,
      annReturn: null,
      annVol: null,
      sharpe: null,
      calmar: null,
      sortino: null,
      downsideRisk: null,
      maxDrawdown: null,
      ddRecoveryDays: null,
      longestNoNewHighDays: null,
    }
  }

  const rets = periodicReturns(points)
  const start = new Date(`${points[0].d}T12:00:00`).getTime()
  const end = new Date(`${points.at(-1)!.d}T12:00:00`).getTime()
  const days = Math.max(1, Math.round((end - start) / 86_400_000))
  const periodReturn = points.at(-1)!.v
  const totalRet = periodReturn / 100
  const annReturn = (Math.pow(1 + totalRet, 365 / days) - 1) * 100
  const annVol = std(rets) * Math.sqrt(252) * 100
  const downside = rets.filter((r) => r < 0)
  const downsideRisk = downside.length > 0 ? std(downside) * Math.sqrt(252) * 100 : 0
  const sharpe = annVol > 0 ? annReturn / annVol : null
  const { maxDrawdown, recoveryDays, longestNoNewHigh } = maxDrawdownStats(points)
  const calmar = maxDrawdown && maxDrawdown > 0 ? annReturn / maxDrawdown : null
  const downsideDev = downside.length > 0 ? std(downside) * Math.sqrt(252) * 100 : null
  const sortino = downsideDev && downsideDev > 0 ? annReturn / downsideDev : null

  return {
    id: series.id,
    name: series.name,
    periodReturn,
    annReturn,
    annVol,
    sharpe,
    calmar,
    sortino,
    downsideRisk,
    maxDrawdown,
    ddRecoveryDays: recoveryDays,
    longestNoNewHighDays: longestNoNewHigh,
  }
}

function fmtPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
}

function pctColorClass(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "text-zinc-400"
  if (value > 0) return "text-red-500"
  if (value < 0) return "text-green-600"
  return "text-zinc-500"
}

function fmtRatio(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toFixed(2)
}

function fmtDays(value: number | "未回补" | null): string {
  if (value == null) return "—"
  if (value === "未回补") return "未回补"
  return String(value)
}

type ReturnGranularity = "week" | "month" | "quarter" | "half" | "year" | "phase"

const RETURN_GRANULARITY_OPTIONS: { key: ReturnGranularity; label: string }[] = [
  { key: "week", label: "周度" },
  { key: "month", label: "月度" },
  { key: "quarter", label: "季度" },
  { key: "half", label: "半年度" },
  { key: "year", label: "年度" },
  { key: "phase", label: "阶段" },
]

const YEAR_OPTIONS = [2026, 2025, 2024, 2023]

function pseudoPeriodReturn(indexId: string, periodKey: string): number {
  const seed = hashSeed(`${indexId}:${periodKey}`)
  const base = ((seed % 1000) / 1000 - 0.45) * 7.5
  const wave = Math.sin(seed % 17) * 1.2
  return Math.round((base + wave) * 100) / 100
}

function weeklyDatesForYear(year: number): string[] {
  const dates: string[] = []
  const cursor = new Date(`${year}-01-01T12:00:00`)
  const day = cursor.getDay()
  const diff = cursor.getDate() - day + (day === 0 ? -6 : 1)
  cursor.setDate(diff)
  while (cursor.getFullYear() <= year) {
    if (cursor.getFullYear() === year) {
      dates.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setDate(cursor.getDate() + 7)
  }
  return dates
}

function monthKeysForYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`)
}

function quarterKeysForYear(year: number): string[] {
  return [`${year}-Q1`, `${year}-Q2`, `${year}-Q3`, `${year}-Q4`]
}

function halfKeysForYear(year: number): string[] {
  return [`${year}-H1`, `${year}-H2`]
}

function periodKeysForYear(year: number, granularity: ReturnGranularity): string[] {
  if (granularity === "week") return weeklyDatesForYear(year)
  if (granularity === "month") return monthKeysForYear(year)
  if (granularity === "quarter") return quarterKeysForYear(year)
  if (granularity === "half") return halfKeysForYear(year)
  if (granularity === "year") return [String(year)]
  return [`${year}-phase`]
}

function formatPeriodLabel(key: string, granularity: ReturnGranularity): string {
  if (granularity === "week" || granularity === "phase") return key
  return key
}

function statsCutoffForPeriods(periodKeys: string[], year: number, granularity: ReturnGranularity): string {
  const last = periodKeys[periodKeys.length - 1]
  if (!last) return `${year}-12-31`
  if (granularity === "week" || granularity === "phase") return last
  if (granularity === "month") return `${last}-28`
  if (granularity === "quarter") {
    const q = Number(last.slice(-1))
    const month = q * 3
    return `${year}-${String(month).padStart(2, "0")}-28`
  }
  if (granularity === "half") return last.endsWith("H1") ? `${year}-06-30` : `${year}-12-31`
  return `${year}-12-31`
}

function formatReturnPct(value: number): string {
  return `${value.toFixed(2)}%`
}

function returnColorClass(value: number): string {
  if (value > 0) return "text-red-500"
  if (value < 0) return "text-green-600"
  return "text-zinc-500"
}

function columnMedian(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100
    : sorted[mid]
}

function columnAverage(values: number[]): number {
  if (!values.length) return 0
  const sum = values.reduce((acc, v) => acc + v, 0)
  return Math.round((sum / values.length) * 100) / 100
}

function computeWinRate(values: number[]): number {
  if (!values.length) return 0
  const wins = values.filter((v) => v > 0).length
  return Math.round((wins / values.length) * 10000) / 100
}

function computeFullYearReturn(values: number[]): number {
  if (!values.length) return 0
  const compounded = values.reduce((acc, v) => acc * (1 + v / 100), 1)
  return Math.round((compounded - 1) * 10000) / 100
}

function SortableHeader({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-0.5">
      {label}
      <span className="inline-flex flex-col leading-none text-zinc-300">
        <svg viewBox="0 0 8 5" className="h-1.5 w-1.5" aria-hidden="true">
          <path d="M4 0 8 5H0Z" fill="currentColor" />
        </svg>
        <svg viewBox="0 0 8 5" className="h-1.5 w-1.5 rotate-180" aria-hidden="true">
          <path d="M4 0 8 5H0Z" fill="currentColor" />
        </svg>
      </span>
    </span>
  )
}

function IndexIntervalReturnsTable({
  chartSeries,
  periodKeys,
  granularity,
  statsCutoff,
}: {
  chartSeries: Array<{ name: string; data: number[] }>
  periodKeys: string[]
  granularity: ReturnGranularity
  statsCutoff: string
}) {
  const tableRows = useMemo(
    () => chartSeries.map((row) => ({
      name: row.name,
      values: row.data,
      winRate: computeWinRate(row.data),
      fullYear: computeFullYearReturn(row.data),
    })),
    [chartSeries],
  )

  const summaryRows = useMemo(() => {
    if (!tableRows.length) {
      return { median: [] as number[], average: [] as number[], winRateMedian: 0, winRateAverage: 0, fullYearMedian: 0, fullYearAverage: 0 }
    }
    const median = periodKeys.map((_, colIndex) =>
      columnMedian(tableRows.map((row) => row.values[colIndex])),
    )
    const average = periodKeys.map((_, colIndex) =>
      columnAverage(tableRows.map((row) => row.values[colIndex])),
    )
    const winRates = tableRows.map((row) => row.winRate)
    const fullYears = tableRows.map((row) => row.fullYear)
    return {
      median,
      average,
      winRateMedian: columnMedian(winRates),
      winRateAverage: columnAverage(winRates),
      fullYearMedian: columnMedian(fullYears),
      fullYearAverage: columnAverage(fullYears),
    }
  }, [periodKeys, tableRows])

  if (!tableRows.length) return null

  return (
    <div className="mt-4 border-t border-zinc-100 pt-4">
      <div className="text-xs text-zinc-400 mb-3">统计截止：{statsCutoff}</div>
      <div className="overflow-x-auto rounded border border-zinc-100">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-50 text-zinc-500">
              <th className="sticky left-0 z-20 bg-zinc-50 px-3 py-2 text-left font-medium border-b border-zinc-100 min-w-[12rem] whitespace-nowrap">
                指数名称
              </th>
              {periodKeys.map((key) => (
                <th
                  key={key}
                  className="px-3 py-2 text-center font-medium border-b border-zinc-100 whitespace-nowrap min-w-[5.5rem]"
                >
                  <SortableHeader label={formatPeriodLabel(key, granularity)} />
                </th>
              ))}
              <th className="sticky right-[4.5rem] z-20 bg-zinc-50 px-3 py-2 text-center font-medium border-b border-l border-zinc-100 whitespace-nowrap min-w-[4.5rem]">
                胜率
              </th>
              <th className="sticky right-0 z-20 bg-zinc-50 px-3 py-2 text-center font-medium border-b border-l border-zinc-100 whitespace-nowrap min-w-[4.5rem]">
                全年
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, rowIndex) => {
              const rowBg = rowIndex % 2 === 1 ? "bg-zinc-50/60" : "bg-white"
              return (
                <tr key={row.name} className={rowBg}>
                  <td className={["sticky left-0 z-10 px-3 py-1.5 text-left text-zinc-700 border-b border-zinc-50 whitespace-nowrap", rowBg].join(" ")}>
                    {row.name}
                  </td>
                  {row.values.map((value, colIndex) => (
                    <td
                      key={`${row.name}-${periodKeys[colIndex]}`}
                      className={[
                        "px-3 py-1.5 text-center tabular-nums border-b border-zinc-50 whitespace-nowrap",
                        returnColorClass(value),
                      ].join(" ")}
                    >
                      {formatReturnPct(value)}
                    </td>
                  ))}
                  <td className={[
                    "sticky right-[4.5rem] z-10 px-3 py-1.5 text-center tabular-nums border-b border-l border-zinc-50 whitespace-nowrap text-zinc-700",
                    rowBg,
                  ].join(" ")}>
                    {row.winRate.toFixed(2)}%
                  </td>
                  <td className={[
                    "sticky right-0 z-10 px-3 py-1.5 text-center tabular-nums border-b border-l border-zinc-50 whitespace-nowrap",
                    returnColorClass(row.fullYear),
                    rowBg,
                  ].join(" ")}>
                    {formatReturnPct(row.fullYear)}
                  </td>
                </tr>
              )
            })}
            <tr className="bg-red-50/35">
              <td className="sticky left-0 z-10 bg-red-50/35 px-3 py-1.5 border-b border-red-100/60 whitespace-nowrap">
                <span className="inline-flex items-center rounded border border-red-200 bg-red-50 px-2 py-0.5 text-red-600 font-medium">
                  中位数
                </span>
              </td>
              {summaryRows.median.map((value, colIndex) => (
                <td
                  key={`median-${periodKeys[colIndex]}`}
                  className={[
                    "px-3 py-1.5 text-center tabular-nums border-b border-red-100/60 whitespace-nowrap",
                    returnColorClass(value),
                  ].join(" ")}
                >
                  {formatReturnPct(value)}
                </td>
              ))}
              <td className="sticky right-[4.5rem] z-10 bg-red-50/35 px-3 py-1.5 text-center tabular-nums border-b border-l border-red-100/60 whitespace-nowrap text-zinc-700">
                {summaryRows.winRateMedian.toFixed(2)}%
              </td>
              <td className={[
                "sticky right-0 z-10 bg-red-50/35 px-3 py-1.5 text-center tabular-nums border-b border-l border-red-100/60 whitespace-nowrap",
                returnColorClass(summaryRows.fullYearMedian),
              ].join(" ")}>
                {formatReturnPct(summaryRows.fullYearMedian)}
              </td>
            </tr>
            <tr className="bg-red-50/35">
              <td className="sticky left-0 z-10 bg-red-50/35 px-3 py-1.5 whitespace-nowrap">
                <span className="inline-flex items-center rounded border border-red-200 bg-red-50 px-2 py-0.5 text-red-600 font-medium">
                  平均值
                </span>
              </td>
              {summaryRows.average.map((value, colIndex) => (
                <td
                  key={`avg-${periodKeys[colIndex]}`}
                  className={[
                    "px-3 py-1.5 text-center tabular-nums whitespace-nowrap",
                    returnColorClass(value),
                  ].join(" ")}
                >
                  {formatReturnPct(value)}
                </td>
              ))}
              <td className="sticky right-[4.5rem] z-10 bg-red-50/35 px-3 py-1.5 text-center tabular-nums border-l border-red-100/60 whitespace-nowrap text-zinc-700">
                {summaryRows.winRateAverage.toFixed(2)}%
              </td>
              <td className={[
                "sticky right-0 z-10 bg-red-50/35 px-3 py-1.5 text-center tabular-nums border-l border-red-100/60 whitespace-nowrap",
                returnColorClass(summaryRows.fullYearAverage),
              ].join(" ")}>
                {formatReturnPct(summaryRows.fullYearAverage)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
  return dir === "asc"
    ? <ChevronUp className="inline h-3 w-3 ml-0.5" />
    : <ChevronDown className="inline h-3 w-3 ml-0.5" />
}

function IndexMetricsTable({
  rows,
  from,
  to,
  onExport,
}: {
  rows: IndexMetrics[]
  from: string
  to: string
  onExport: () => void
}) {
  const [sortKey, setSortKey] = useState<MetricsSortKey>("periodReturn")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === "string" || typeof bv === "string") return 0
      return sortDir === "asc" ? av - bv : bv - av
    })
    return copy
  }, [rows, sortDir, sortKey])

  function toggleSort(key: MetricsSortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  if (!rows.length) return null

  return (
    <div className="mt-4 border-t border-zinc-100 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="text-xs text-zinc-400">统计区间：{from} - {to}</div>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          导出
        </button>
      </div>
      <div className="overflow-x-auto rounded border border-zinc-100">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-50 text-zinc-500">
              <th className="sticky left-0 z-20 bg-zinc-50 px-3 py-2.5 text-left font-medium border-b border-zinc-100 min-w-[12rem] whitespace-nowrap">
                指数名称
              </th>
              {METRICS_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="px-3 py-2.5 text-center font-medium border-b border-zinc-100 whitespace-nowrap cursor-pointer select-none hover:text-zinc-800 min-w-[5.5rem]"
                >
                  {col.label}
                  <SortIcon active={sortKey === col.key} dir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIndex) => {
              const rowBg = rowIndex % 2 === 1 ? "bg-zinc-50/60" : "bg-white"
              return (
                <tr key={row.id} className={rowBg}>
                  <td className={["sticky left-0 z-10 px-3 py-2 text-left text-zinc-700 border-b border-zinc-50 whitespace-nowrap", rowBg].join(" ")}>
                    {row.name}
                  </td>
                  {METRICS_COLUMNS.map((col) => {
                    const value = row[col.key]
                    if (col.pct) {
                      const num = value as number | null
                      return (
                        <td
                          key={col.key}
                          className={["px-3 py-2 text-center tabular-nums border-b border-zinc-50 whitespace-nowrap", pctColorClass(num)].join(" ")}
                        >
                          {fmtPct(num)}
                        </td>
                      )
                    }
                    if (col.ratio) {
                      return (
                        <td key={col.key} className="px-3 py-2 text-center tabular-nums border-b border-zinc-50 whitespace-nowrap text-zinc-700">
                          {fmtRatio(value as number | null)}
                        </td>
                      )
                    }
                    return (
                      <td key={col.key} className="px-3 py-2 text-center tabular-nums border-b border-zinc-50 whitespace-nowrap text-zinc-700">
                        {fmtDays(value as number | "未回补" | null)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function IndexIntervalReturnsSection({
  series,
  defaultYear,
}: {
  series: SeriesData[]
  defaultYear: number
}) {
  const [year, setYear] = useState(defaultYear)
  const [granularity, setGranularity] = useState<ReturnGranularity>("week")
  const [selectAllSeries, setSelectAllSeries] = useState(true)
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  useEffect(() => {
    setYear(defaultYear)
  }, [defaultYear])

  const periodKeys = useMemo(
    () => periodKeysForYear(year, granularity),
    [year, granularity],
  )

  const statsCutoff = useMemo(
    () => statsCutoffForPeriods(periodKeys, year, granularity),
    [periodKeys, year, granularity],
  )

  const chartSeries = useMemo(
    () => series.map((s) => ({
      name: s.name,
      color: s.color,
      data: periodKeys.map((key) => pseudoPeriodReturn(s.id, key)),
    })),
    [series, periodKeys],
  )

  const activeSeries = useMemo(() => {
    if (selectAllSeries) return chartSeries
    return chartSeries.filter((s) => !hiddenSeries.has(s.name))
  }, [chartSeries, hiddenSeries, selectAllSeries])

  const chartOption = useMemo(() => {
    const xLabels = periodKeys.map((key) => formatPeriodLabel(key, granularity))
    const allValues = activeSeries.flatMap((s) => s.data)
    const minVal = allValues.length ? Math.min(...allValues, 0) : -4
    const maxVal = allValues.length ? Math.max(...allValues, 0) : 8
    const yMin = Math.floor(Math.min(minVal, -4) / 3) * 3
    const yMax = Math.ceil(Math.max(maxVal, 8) / 3) * 3

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        formatter: (params: Array<{ seriesName: string; value: number; marker: string; axisValue: string }>) => {
          if (!params?.length) return ""
          const lines = params
            .filter((p) => p.value != null && !Number.isNaN(p.value))
            .sort((a, b) => b.value - a.value)
            .map((p) => {
              const sign = p.value > 0 ? "+" : ""
              return `${p.marker}${p.seriesName}: ${sign}${p.value.toFixed(2)}%`
            })
          return [`<div style="font-weight:600;margin-bottom:4px">${params[0].axisValue}</div>`, ...lines].join("<br/>")
        },
      },
      legend: {
        type: "scroll" as const,
        top: 0,
        left: 0,
        right: 80,
        textStyle: { fontSize: 11, color: "#52525b" },
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 12,
        selected: Object.fromEntries(
          chartSeries.map((s) => [s.name, !hiddenSeries.has(s.name)]),
        ),
      },
      grid: { left: 48, right: 16, top: 52, bottom: 72 },
      dataZoom: [
        { type: "inside" as const, start: 0, end: 100 },
        {
          type: "slider" as const,
          bottom: 18,
          height: 18,
          borderColor: "transparent",
          fillerColor: "rgba(26,115,232,0.12)",
          handleStyle: { color: "#1A73E8" },
          dataBackground: {
            lineStyle: { color: "#94a3b8" },
            areaStyle: { color: "rgba(148,163,184,0.08)" },
          },
        },
      ],
      xAxis: {
        type: "category" as const,
        data: xLabels,
        axisLabel: { fontSize: 11, color: "#a1a1aa", rotate: 0 },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        min: yMin,
        max: yMax,
        interval: 3,
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (v: number) => `${v}%`,
        },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" as const } },
      },
      series: activeSeries.map((s, index) => ({
        name: s.name,
        type: "bar" as const,
        barMaxWidth: 8,
        barGap: "10%",
        itemStyle: { color: s.color },
        data: s.data,
        ...(index === 0
          ? {
              markLine: {
                silent: true,
                symbol: "none" as const,
                lineStyle: { color: "#d4d4d8", width: 1 },
                label: { show: false },
                data: [{ yAxis: 0 }],
              },
            }
          : {}),
      })),
    }
  }, [activeSeries, chartSeries, granularity, hiddenSeries, periodKeys])

  const handleToggleAllSeries = useCallback(() => {
    setSelectAllSeries((prev) => {
      const next = !prev
      setHiddenSeries(next ? new Set() : new Set(series.map((s) => s.name)))
      return next
    })
  }, [series])

  const handleLegendSelectChanged = useCallback((params: { selected?: Record<string, boolean> }) => {
    const selected = params.selected ?? {}
    const hidden = new Set<string>()
    for (const [name, visible] of Object.entries(selected)) {
      if (!visible) hidden.add(name)
    }
    setHiddenSeries(hidden)
    setSelectAllSeries(hidden.size === 0)
  }, [])

  function exportCsv() {
    const headers = ["日期", ...activeSeries.map((s) => s.name)]
    const rows = periodKeys.map((key, i) => {
      const label = formatPeriodLabel(key, granularity)
      return [label, ...activeSeries.map((s) => `${s.data[i].toFixed(2)}%`)]
    })
    const escape = (v: string) => (v.includes(",") ? `"${v}"` : v)
    const blob = new Blob(
      ["\uFEFF" + [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8;" },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `私募指数_区间收益_${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!series.length) return null

  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
            区间收益
          </div>
          <div className="text-xs text-zinc-400 mt-1">统计截止：{statsCutoff}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          <button
            type="button"
            onClick={handleToggleAllSeries}
            className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors"
          >
            <span
              className={[
                "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
                selectAllSeries ? "border-red-500 bg-red-500" : "border-zinc-300 bg-white",
              ].join(" ")}
            >
              {selectAllSeries && (
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              )}
            </span>
            全选
          </button>
          <div className="inline-flex items-center gap-1.5">
            <span className="text-zinc-500">年度：</span>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="inline-flex rounded border border-zinc-200 overflow-hidden">
            {RETURN_GRANULARITY_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setGranularity(opt.key)}
                className={[
                  "px-2.5 py-1 text-xs transition-colors border-r border-zinc-200 last:border-r-0",
                  granularity === opt.key
                    ? "bg-red-500 text-white font-medium"
                    : "bg-white text-zinc-600 hover:bg-zinc-50",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center h-7 w-7 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition-colors"
            title="图表设置"
          >
            <Menu className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ReactECharts
        option={chartOption}
        style={{ height: 420, width: "100%" }}
        notMerge
        lazyUpdate
        onEvents={{ legendselectchanged: handleLegendSelectChanged }}
      />

      <IndexIntervalReturnsTable
        chartSeries={chartSeries}
        periodKeys={periodKeys}
        granularity={granularity}
        statsCutoff={statsCutoff}
      />

      <div className="text-xs text-zinc-400 mt-2">统计截止：{statsCutoff}</div>
    </div>
  )
}

function returnsFromCurve(points: Array<[string, number]>): number[] {
  const rets: number[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = 1 + points[i - 1][1] / 100
    const curr = 1 + points[i][1] / 100
    if (prev > 0) rets.push(curr / prev - 1)
  }
  return rets
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const sliceA = a.slice(-n)
  const sliceB = b.slice(-n)
  const meanA = sliceA.reduce((s, v) => s + v, 0) / n
  const meanB = sliceB.reduce((s, v) => s + v, 0) / n
  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const da = sliceA[i] - meanA
    const db = sliceB[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  const den = Math.sqrt(varA * varB)
  return den > 0 ? cov / den : 0
}

function pseudoCorrelation(idA: string, idB: string): number {
  if (idA === idB) return 1
  const seed = hashSeed([idA, idB].sort().join(":"))
  const base = 0.25 + ((seed % 1000) / 1000) * 0.72
  const wave = Math.sin(seed % 13) * 0.08
  return Math.max(-0.2, Math.min(0.9999, Math.round((base + wave) * 10000) / 10000))
}

function IndexCorrelationSection({
  series,
  from,
  to,
}: {
  series: SeriesData[]
  from: string
  to: string
}) {
  const names = useMemo(() => series.map((s) => s.name), [series])

  const matrix = useMemo(() => {
    const retsList = series.map((s) => {
      const rets = returnsFromCurve(s.points)
      return rets.length >= 2 ? rets : null
    })

    const n = series.length
    const mat: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          mat[i][j] = 1
        } else if (retsList[i] && retsList[j]) {
          const r = pearsonCorrelation(retsList[i]!, retsList[j]!)
          mat[i][j] = Number.isFinite(r) ? Math.round(r * 10000) / 10000 : pseudoCorrelation(series[i].id, series[j].id)
        } else {
          mat[i][j] = pseudoCorrelation(series[i].id, series[j].id)
        }
      }
    }
    return mat
  }, [series])

  const chartOption = useMemo(() => {
    const n = names.length
    const heatData: [number, number, number][] = []
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        heatData.push([j, n - 1 - i, matrix[i][j]])
      }
    }

    const cellSize = Math.min(56, Math.floor(480 / Math.max(n, 1)))
    const chartH = cellSize * n + 140

    return {
      option: {
        backgroundColor: "transparent",
        animation: false,
        grid: { top: 16, right: 72, bottom: 96, left: 160 },
        tooltip: {
          position: "top" as const,
          formatter: (params: { data: [number, number, number] }) => {
            const xi = params.data[0]
            const yi = n - 1 - params.data[1]
            const val = params.data[2]
            return `${names[yi]} × ${names[xi]}<br/><b>${val.toFixed(4)}</b>`
          },
        },
        xAxis: {
          type: "category" as const,
          data: names,
          position: "bottom" as const,
          axisLabel: {
            color: "#71717a",
            fontSize: 10,
            interval: 0,
            rotate: 35,
            formatter: (value: string) => (value.length > 10 ? `${value.slice(0, 10)}…` : value),
          },
          axisLine: { show: false },
          axisTick: { show: false },
          splitArea: { show: false },
        },
        yAxis: {
          type: "category" as const,
          data: [...names].reverse(),
          axisLabel: {
            color: "#71717a",
            fontSize: 10,
            interval: 0,
            width: 140,
            overflow: "truncate" as const,
          },
          axisLine: { show: false },
          axisTick: { show: false },
          splitArea: { show: false },
        },
        visualMap: {
          min: 0,
          max: 1,
          calculable: false,
          orient: "vertical" as const,
          right: 8,
          top: "center" as const,
          itemWidth: 10,
          itemHeight: 80,
          inRange: {
            color: ["#fff1f2", "#fecdd3", "#fb7185", "#e11d48", "#9f1239", "#881337"],
          },
          textStyle: { color: "#71717a", fontSize: 10 },
        },
        series: [
          {
            type: "heatmap" as const,
            data: heatData,
            label: {
              show: true,
              fontSize: 10,
              color: "#3f3f46",
              formatter: (params: { data: [number, number, number] }) => params.data[2].toFixed(4),
            },
            emphasis: {
              itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.15)" },
            },
          },
        ],
      },
      height: Math.max(320, chartH),
    }
  }, [matrix, names])

  function exportCsv() {
    const headers = ["", ...names]
    const rows = names.map((name, i) => [
      name,
      ...matrix[i].map((v) => v.toFixed(4)),
    ])
    const escape = (v: string) => (v.includes(",") ? `"${v}"` : v)
    const blob = new Blob(
      ["\uFEFF" + [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8;" },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `私募指数_相关系数_${from}_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!series.length) return null

  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
            相关系数
          </div>
          <div className="text-xs text-zinc-400 mt-1">统计区间：{from} - {to}</div>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1 hover:text-zinc-800 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center h-7 w-7 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition-colors"
            title="图表设置"
          >
            <Menu className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ReactECharts
        option={chartOption.option}
        style={{ height: chartOption.height, width: "100%" }}
        notMerge
        lazyUpdate
      />
    </div>
  )
}

const PE_INDEX_DESCRIPTION_ITEMS = [
  "本指数覆盖主观、量化、股票市场中性等多类策略，可作为净值分析、资产配置的参照基准。指数每周更新，一般为每周三更新。",
  "由证券时报社负责该指数的编制、维护和发布。指数定位及多层次指数体系详见相关说明文件。",
  "国联金融提供研究和数据支持，包括管理人规模分析及净值数据等。",
  "招商托管私募指数为各品类私募（综合、多头、中性、CTA、FOF等）提供业绩比较基准。",
]

function PeIndexDescriptionSection() {
  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-3">
        <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
        私募指数说明
      </div>
      <ul className="space-y-2.5 text-xs text-zinc-600 leading-relaxed list-none pl-0">
        {PE_INDEX_DESCRIPTION_ITEMS.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-zinc-400 shrink-0">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <a
        href="#"
        className="inline-block mt-4 text-xs text-blue-600 hover:text-blue-700 hover:underline"
        onClick={(e) => e.preventDefault()}
      >
        查看更多私募指数规则与成分
      </a>
    </div>
  )
}

function TagButton({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors border",
        selected
          ? "border-red-400 bg-red-50 text-red-600"
          : "border-zinc-200 bg-white text-zinc-600 hover:border-red-200 hover:text-red-500",
      ].join(" ")}
    >
      {label}
      {selected && <X className="h-3 w-3 opacity-70" />}
    </button>
  )
}

function IndexCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs text-zinc-700">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "inline-flex h-3.5 w-3.5 items-center justify-center rounded border transition-colors shrink-0",
          checked ? "border-red-500 bg-red-500" : "border-zinc-300 bg-white hover:border-red-300",
        ].join(" ")}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </button>
      <span className="leading-snug">{label}</span>
    </label>
  )
}

export function PeIndexView() {
  const [draftFrom, setDraftFrom] = useState("2024-03-27")
  const [draftTo, setDraftTo] = useState("2024-06-18")
  const [appliedFrom, setAppliedFrom] = useState("2024-03-27")
  const [appliedTo, setAppliedTo] = useState("2024-06-18")

  const [draftSelected, setDraftSelected] = useState<Set<string>>(() => new Set(DEFAULT_SELECTED))
  const [appliedSelected, setAppliedSelected] = useState<Set<string>>(() => new Set(DEFAULT_SELECTED))

  const [providerCategories, setProviderCategories] = useState<Record<string, string>>(() => ({
    xincaifu: "指数增强",
    guolian: "量化多头",
  }))

  const [seriesData, setSeriesData] = useState<SeriesData[]>([])
  const [loading, setLoading] = useState(false)
  const [selectAllSeries, setSelectAllSeries] = useState(true)
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  const toggleSelection = useCallback((id: string) => {
    setDraftSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else if (next.size < MAX_SELECTED) {
        next.add(id)
      }
      return next
    })
  }, [])

  const loadChartData = useCallback(async (from: string, to: string, selectedIds: string[]) => {
    setLoading(true)
    try {
      const dates = tradingDates(from, to)
      const items = selectedIds.map((id) => ITEM_BY_ID.get(id)).filter(Boolean) as IndexItem[]

      const results = await Promise.all(
        items.map(async (item, index) => {
          let points: Array<[string, number]>
          if (item.benchmarkKey) {
            try {
              const params = new URLSearchParams({ key: item.benchmarkKey, from, to })
              const res = await fetch(`/ma/api/private-funds/benchmark?${params}`)
              const json = await res.json()
              if (res.ok && json.ok && json.data?.length) {
                points = rebaseToReturn(json.data)
              } else {
                points = pseudoReturnCurve(item.id, dates)
              }
            } catch {
              points = pseudoReturnCurve(item.id, dates)
            }
          } else {
            points = pseudoReturnCurve(item.id, dates)
          }

          return {
            id: item.id,
            name: item.label,
            color: SERIES_COLORS[index % SERIES_COLORS.length],
            points,
          }
        }),
      )

      setSeriesData(results)
      setHiddenSeries(new Set())
      setSelectAllSeries(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadChartData(appliedFrom, appliedTo, [...appliedSelected])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleQuery = useCallback(() => {
    setAppliedFrom(draftFrom)
    setAppliedTo(draftTo)
    setAppliedSelected(new Set(draftSelected))
    loadChartData(draftFrom, draftTo, [...draftSelected])
  }, [draftFrom, draftTo, draftSelected, loadChartData])

  const appliedItems = useMemo(
    () => [...appliedSelected].map((id) => ITEM_BY_ID.get(id)).filter(Boolean) as IndexItem[],
    [appliedSelected],
  )

  const activeSeries = useMemo(() => {
    if (selectAllSeries) return seriesData
    return seriesData.filter((s) => !hiddenSeries.has(s.name))
  }, [seriesData, hiddenSeries, selectAllSeries])

  const metricsRows = useMemo(
    () => seriesData.map((s) => computeIndexMetrics(s)),
    [seriesData],
  )

  const chartOption = useMemo(() => {
    const allDates = seriesData[0]?.points.map((p) => p[0]) ?? []
    const allValues = activeSeries.flatMap((s) => s.points.map((p) => p[1]))
    const minVal = allValues.length ? Math.min(...allValues, -5) : -5
    const maxVal = allValues.length ? Math.max(...allValues, 5) : 30
    const yMin = Math.floor(minVal / 5) * 5
    const yMax = Math.ceil(maxVal / 5) * 5

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: Array<{ seriesName: string; value: number | [string, number]; marker: string; axisValue: string }>) => {
          if (!params?.length) return ""
          const lines = params
            .map((p) => {
              const val = Array.isArray(p.value) ? p.value[1] : p.value
              if (val == null || Number.isNaN(val)) return null
              const sign = val > 0 ? "+" : ""
              return `${p.marker}${p.seriesName}: ${sign}${val.toFixed(2)}%`
            })
            .filter(Boolean)
            .sort((a, b) => {
              const va = parseFloat(a!.split(": ")[1])
              const vb = parseFloat(b!.split(": ")[1])
              return vb - va
            })
          return [`<div style="font-weight:600;margin-bottom:4px">${params[0].axisValue}</div>`, ...lines].join("<br/>")
        },
      },
      legend: {
        type: "scroll" as const,
        top: 0,
        left: 0,
        right: 80,
        textStyle: { fontSize: 11, color: "#52525b" },
        itemWidth: 14,
        itemHeight: 2,
        itemGap: 14,
        icon: "rect" as const,
        selected: Object.fromEntries(
          seriesData.map((s) => [s.name, !hiddenSeries.has(s.name)]),
        ),
      },
      grid: { left: 52, right: 16, top: 52, bottom: 56 },
      xAxis: {
        type: "category" as const,
        data: allDates,
        boundaryGap: false,
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (value: string) => {
            const d = new Date(`${value}T12:00:00`)
            const m = d.getMonth() + 1
            const day = d.getDate()
            if (day === 1 || day === 15) return `${m}月${day}日`
            return ""
          },
        },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "收益率(%)",
        nameTextStyle: { fontSize: 11, color: "#a1a1aa", padding: [0, 0, 0, -8] },
        min: yMin,
        max: yMax,
        interval: 5,
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (v: number) => `${v}%`,
        },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" as const } },
      },
      series: activeSeries.map((s) => ({
        name: s.name,
        type: "line" as const,
        symbol: "none" as const,
        smooth: false,
        lineStyle: { color: s.color, width: 1.5 },
        itemStyle: { color: s.color },
        data: s.points.map((p) => p[1]),
      })),
    }
  }, [activeSeries, hiddenSeries, seriesData])

  const handleToggleAllSeries = useCallback(() => {
    setSelectAllSeries((prev) => {
      const next = !prev
      setHiddenSeries(next ? new Set() : new Set(seriesData.map((s) => s.name)))
      return next
    })
  }, [seriesData])

  const handleLegendSelectChanged = useCallback((params: { selected?: Record<string, boolean> }) => {
    const selected = params.selected ?? {}
    const hidden = new Set<string>()
    for (const [name, visible] of Object.entries(selected)) {
      if (!visible) hidden.add(name)
    }
    setHiddenSeries(hidden)
    setSelectAllSeries(hidden.size === 0)
  }, [])

  function exportCsv() {
    const dates = seriesData[0]?.points.map((p) => p[0]) ?? []
    const headers = ["日期", ...activeSeries.map((s) => s.name)]
    const rows = dates.map((date, i) => [
      date,
      ...activeSeries.map((s) => `${(s.points[i]?.[1] ?? 0).toFixed(2)}%`),
    ])
    const escape = (v: string) => (v.includes(",") ? `"${v}"` : v)
    const blob = new Blob(
      ["\uFEFF" + [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8;" },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `私募指数_收益曲线_${appliedFrom}_${appliedTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportMetricsCsv() {
    const headers = ["指数名称", ...METRICS_COLUMNS.map((c) => c.label)]
    const rows = metricsRows.map((row) => [
      row.name,
      fmtPct(row.periodReturn),
      fmtPct(row.annReturn),
      fmtPct(row.annVol),
      fmtRatio(row.sharpe),
      fmtRatio(row.calmar),
      fmtRatio(row.sortino),
      fmtPct(row.downsideRisk),
      fmtPct(row.maxDrawdown),
      fmtDays(row.ddRecoveryDays),
      fmtDays(row.longestNoNewHighDays),
    ])
    const escape = (v: string) => (v.includes(",") ? `"${v}"` : v)
    const blob = new Blob(
      ["\uFEFF" + [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8;" },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `私募指数_指标统计_${appliedFrom}_${appliedTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4 -m-1">
      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-zinc-600 shrink-0">请选择时间范围</span>
          <input
            type="date"
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            className="h-8 rounded border border-zinc-200 px-2 text-sm text-zinc-700"
          />
          <span className="text-zinc-400">—</span>
          <input
            type="date"
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            className="h-8 rounded border border-zinc-200 px-2 text-sm text-zinc-700"
          />
          <button
            type="button"
            onClick={handleQuery}
            className="h-8 px-4 rounded border border-blue-500 text-blue-600 text-sm font-medium hover:bg-blue-50 transition-colors"
          >
            查询
          </button>
        </div>

        {INDEX_PROVIDERS.map((provider) => (
          <div key={provider.key} className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <span className="text-sm text-zinc-500 shrink-0 w-[5.5rem] pt-0.5">{provider.label}</span>
            {provider.mode === "tags" ? (
              <div className="flex flex-wrap gap-1.5 flex-1">
                {provider.items.map((item) => (
                  <TagButton
                    key={item.id}
                    label={item.label}
                    selected={draftSelected.has(item.id)}
                    onClick={() => toggleSelection(item.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {(provider.categories ?? []).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setProviderCategories((prev) => ({ ...prev, [provider.key]: cat }))}
                      className={[
                        "px-2.5 py-0.5 text-xs rounded transition-colors",
                        providerCategories[provider.key] === cat
                          ? "bg-red-500 text-white"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
                      ].join(" ")}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
                  {provider.items
                    .filter((item) => item.category === providerCategories[provider.key])
                    .map((item) => (
                      <IndexCheckbox
                        key={item.id}
                        label={item.label}
                        checked={draftSelected.has(item.id)}
                        onChange={() => toggleSelection(item.id)}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="flex flex-wrap items-start gap-2 pt-1 border-t border-zinc-50">
          <span className="text-sm text-zinc-500 shrink-0">
            已选参数 ({draftSelected.size}/{MAX_SELECTED})：
          </span>
          <div className="flex flex-wrap gap-1.5 flex-1">
            {[...draftSelected].map((id) => {
              const item = ITEM_BY_ID.get(id)
              if (!item) return null
              return (
                <TagButton
                  key={id}
                  label={item.label}
                  selected
                  onClick={() => toggleSelection(id)}
                />
              )
            })}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
              <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
              收益曲线
            </div>
            <div className="text-xs text-zinc-400 mt-1">
              统计区间：{appliedFrom} - {appliedTo}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
            <button
              type="button"
              onClick={handleToggleAllSeries}
              className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors"
            >
              <span
                className={[
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
                  selectAllSeries ? "border-red-500 bg-red-500" : "border-zinc-300 bg-white",
                ].join(" ")}
              >
                {selectAllSeries && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              全选
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              导出
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center h-7 w-7 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition-colors"
              title="图表设置"
            >
              <Menu className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-80 text-sm text-zinc-400">加载中…</div>
        ) : appliedItems.length === 0 ? (
          <div className="flex items-center justify-center h-80 text-sm text-zinc-400">
            请至少选择一个指数后点击查询
          </div>
        ) : (
          <>
            <ReactECharts
              option={chartOption}
              style={{ height: 420, width: "100%" }}
              notMerge
              lazyUpdate
              onEvents={{ legendselectchanged: handleLegendSelectChanged }}
            />
            <IndexMetricsTable
              rows={metricsRows}
              from={appliedFrom}
              to={appliedTo}
              onExport={exportMetricsCsv}
            />
          </>
        )}
      </div>

      {!loading && seriesData.length > 0 && (
        <>
          <IndexIntervalReturnsSection
            series={seriesData}
            defaultYear={Number(appliedTo.slice(0, 4)) || 2026}
          />
          <IndexCorrelationSection
            series={seriesData}
            from={appliedFrom}
            to={appliedTo}
          />
          <PeIndexDescriptionSection />
        </>
      )}
    </div>
  )
}
