"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Download, Menu } from "lucide-react"
import { StrategyFittedDistributionSection } from "./StrategyFittedDistributionSection"
import { StrategyIndicatorDistributionSection } from "./StrategyIndicatorDistributionSection"

const STRATEGY_CATEGORIES = [
  "股票市场中性",
  "1000指增",
  "500指增",
  "300指增",
  "A500指增",
  "量化选股",
  "主观多头",
  "量化期货",
  "主观期货",
  "套利策略",
  "股票对冲",
  "股票多头",
  "期权策略",
  "多资产策略",
  "债券策略",
  "组合策略",
  "可转债多头",
] as const

const TABLE_STRATEGIES = [
  "股票市场中性",
  "1000指增",
  "500指增",
  "300指增",
  "A500指增",
  "量化选股",
  "主观多头",
  "量化精选",
  "主观精选",
  "期货策略",
  "股票对冲",
  "股票多头",
  "套利策略",
  "期权策略",
  "多资产策略",
  "债券策略",
  "组合策略",
  "可转债多头",
] as const

type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number]

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

const SERIES_COLORS = [
  "#D93025",
  "#1A73E8",
  "#FBBC04",
  "#9333ea",
  "#22c55e",
  "#14b8a6",
  "#EC4899",
  "#78716C",
  "#2563eb",
  "#f97316",
  "#84cc16",
  "#06b6d4",
  "#a855f7",
  "#ef4444",
  "#64748b",
  "#0ea5e9",
  "#eab308",
]

function hashSeed(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

function pseudoReturn(strategy: string, periodKey: string, excess: boolean): number {
  const seed = hashSeed(`${strategy}:${periodKey}:${excess ? "ex" : "abs"}`)
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

function StrategyPerformanceTable({
  periodKeys,
  granularity,
  showExcess,
  visibleStrategies,
}: {
  periodKeys: string[]
  granularity: ReturnGranularity
  showExcess: boolean
  visibleStrategies: readonly string[]
}) {
  const tableRows = useMemo(() => {
    if (!visibleStrategies.length) return []
    return TABLE_STRATEGIES.map((label) => {
      const values = periodKeys.map((key) => pseudoReturn(label, key, showExcess))
      return {
        label,
        values,
        winRate: computeWinRate(values),
      }
    })
  }, [periodKeys, showExcess, visibleStrategies.length])

  const summaryRows = useMemo(() => {
    if (!tableRows.length) {
      return { median: [] as number[], average: [] as number[], winRateMedian: 0, winRateAverage: 0 }
    }
    const median = periodKeys.map((_, colIndex) =>
      columnMedian(tableRows.map((row) => row.values[colIndex])),
    )
    const average = periodKeys.map((_, colIndex) =>
      columnAverage(tableRows.map((row) => row.values[colIndex])),
    )
    const winRates = tableRows.map((row) => row.winRate)
    return {
      median,
      average,
      winRateMedian: columnMedian(winRates),
      winRateAverage: columnAverage(winRates),
    }
  }, [periodKeys, tableRows])

  if (!tableRows.length) return null

  return (
    <div className="mt-4 border-t border-zinc-100 pt-4">
      <div className="overflow-x-auto rounded border border-zinc-100">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-50 text-zinc-500">
              <th className="sticky left-0 z-20 bg-zinc-50 px-3 py-2 text-left font-medium border-b border-zinc-100 min-w-[7.5rem]">
                分类
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
              <tr
                key={row.label}
                className={rowBg}
              >
                <td className={["sticky left-0 z-10 px-3 py-1.5 text-left text-zinc-700 border-b border-zinc-50 whitespace-nowrap", rowBg].join(" ")}>
                  {row.label}
                </td>
                {row.values.map((value, colIndex) => (
                  <td
                    key={`${row.label}-${periodKeys[colIndex]}`}
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
                  "sticky right-0 z-10 px-3 py-1.5 text-center tabular-nums border-b border-l border-zinc-50 whitespace-nowrap text-zinc-400",
                  rowBg,
                ].join(" ")}>
                  —
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
              <td className="sticky right-0 z-10 bg-red-50/35 px-3 py-1.5 text-center tabular-nums border-b border-l border-red-100/60 whitespace-nowrap text-zinc-400">
                —
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
              <td className="sticky right-0 z-10 bg-red-50/35 px-3 py-1.5 text-center tabular-nums border-l border-red-100/60 whitespace-nowrap text-zinc-400">
                —
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StrategyCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-sm text-zinc-700">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "inline-flex h-4 w-4 items-center justify-center rounded border transition-colors",
          checked ? "border-red-500 bg-red-500" : "border-zinc-300 bg-white hover:border-red-300",
        ].join(" ")}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </button>
      {label}
    </label>
  )
}

export function StrategyObservationView() {
  const [draftCategories, setDraftCategories] = useState<Set<StrategyCategory>>(
    () => new Set(STRATEGY_CATEGORIES),
  )
  const [appliedCategories, setAppliedCategories] = useState<Set<StrategyCategory>>(
    () => new Set(STRATEGY_CATEGORIES),
  )
  const [showExcess, setShowExcess] = useState(false)
  const [selectAllSeries, setSelectAllSeries] = useState(true)
  const [year, setYear] = useState(2026)
  const [granularity, setGranularity] = useState<ReturnGranularity>("week")
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  const periodKeys = useMemo(
    () => periodKeysForYear(year, granularity),
    [year, granularity],
  )

  const visibleStrategies = useMemo(
    () => STRATEGY_CATEGORIES.filter((s) => appliedCategories.has(s)),
    [appliedCategories],
  )

  const statsCutoff = useMemo(() => {
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
  }, [periodKeys, year, granularity])

  const chartSeries = useMemo(() => {
    return visibleStrategies.map((strategy, index) => ({
      name: strategy,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      data: periodKeys.map((key) => pseudoReturn(strategy, key, showExcess)),
    }))
  }, [visibleStrategies, periodKeys, showExcess])

  const activeSeries = useMemo(() => {
    if (selectAllSeries) return chartSeries
    return chartSeries.filter((s) => !hiddenSeries.has(s.name))
  }, [chartSeries, hiddenSeries, selectAllSeries])

  const chartOption = useMemo(() => {
    const xLabels = periodKeys.map((key) => formatPeriodLabel(key, granularity))
    const allValues = activeSeries.flatMap((s) => s.data)
    const minVal = allValues.length ? Math.min(...allValues, 0) : -4
    const maxVal = allValues.length ? Math.max(...allValues, 0) : 8
    const yMin = Math.floor(Math.min(minVal, -4) / 2) * 2
    const yMax = Math.ceil(Math.max(maxVal, 8) / 2) * 2

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
          chartSeries.map((s) => [s.name, selectAllSeries ? !hiddenSeries.has(s.name) : !hiddenSeries.has(s.name)]),
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
        interval: 2,
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
  }, [activeSeries, chartSeries, granularity, hiddenSeries, periodKeys, selectAllSeries])

  const handleQuery = useCallback(() => {
    setAppliedCategories(new Set(draftCategories))
    setHiddenSeries(new Set())
    setSelectAllSeries(true)
  }, [draftCategories])

  const handleClear = useCallback(() => {
    setDraftCategories(new Set())
  }, [])

  const handleToggleAllSeries = useCallback(() => {
    setSelectAllSeries((prev) => {
      const next = !prev
      setHiddenSeries(next ? new Set() : new Set(visibleStrategies))
      return next
    })
  }, [visibleStrategies])

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
    a.download = `策略观察_收益表现_${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4 -m-1">
      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-3">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <span className="text-sm text-zinc-600 shrink-0 pt-0.5">选择分类：</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-2 flex-1">
            {STRATEGY_CATEGORIES.map((category) => (
              <StrategyCheckbox
                key={category}
                label={category}
                checked={draftCategories.has(category)}
                onChange={(checked) => {
                  setDraftCategories((prev) => {
                    const next = new Set(prev)
                    if (checked) next.add(category)
                    else next.delete(category)
                    return next
                  })
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleQuery}
              className="h-8 px-4 rounded border border-blue-500 text-blue-600 text-sm font-medium hover:bg-blue-50 transition-colors"
            >
              查询
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="h-8 px-3 text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              清空
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
              <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
              收益表现
            </div>
            <div className="text-xs text-zinc-400 mt-1">统计截止：{statsCutoff}</div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
            <button
              type="button"
              onClick={() => setShowExcess((v) => !v)}
              className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors"
            >
              <span
                className={[
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
                  showExcess ? "border-red-500 bg-red-500" : "border-zinc-300 bg-white",
                ].join(" ")}
              >
                {showExcess && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              超额
            </button>
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

        {visibleStrategies.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-sm text-zinc-400">
            请选择至少一个分类后点击查询
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
            <StrategyPerformanceTable
              periodKeys={periodKeys}
              granularity={granularity}
              showExcess={showExcess}
              visibleStrategies={visibleStrategies}
            />
          </>
        )}
      </div>

      {visibleStrategies.length > 0 && (
        <>
          <StrategyFittedDistributionSection periodKeys={periodKeys} />
          <StrategyIndicatorDistributionSection statsCutoff={statsCutoff} />
        </>
      )}
    </div>
  )
}
