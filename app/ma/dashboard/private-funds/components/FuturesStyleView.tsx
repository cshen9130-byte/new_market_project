"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Menu } from "lucide-react"

const SECTOR_TABS = [
  { key: "all", label: "全部" },
  { key: "commodity", label: "商品" },
  { key: "black", label: "黑色" },
  { key: "nonferrous", label: "有色" },
  { key: "energy", label: "能化" },
  { key: "agri", label: "农产" },
] as const

type SectorKey = (typeof SECTOR_TABS)[number]["key"]

const FUTURES_STYLE_FACTORS: {
  name: string
  value: number
  sector: SectorKey | "all"
}[] = [
  { name: "时间序列动量(短)", value: -0.8, sector: "all" },
  { name: "时间序列动量(中)", value: -0.79, sector: "all" },
  { name: "时间序列动量(长)", value: -0.32, sector: "all" },
  { name: "截面动量(短)", value: -0.06, sector: "all" },
  { name: "截面动量", value: 0.2, sector: "all" },
  { name: "期限结构动量", value: -0.35, sector: "all" },
  { name: "基差动量", value: -0.36, sector: "black" },
  { name: "库存因子", value: -0.51, sector: "black" },
  { name: "波动因子(短)", value: 0.46, sector: "all" },
  { name: "波动因子", value: 0.72, sector: "all" },
  { name: "流动性因子", value: -0.2, sector: "all" },
  { name: "均价偏离因子", value: -0.58, sector: "all" },
  { name: "偏度因子", value: 0.43, sector: "all" },
  { name: "基差因子", value: 0.82, sector: "energy" },
  { name: "博弈意愿因子", value: 0.15, sector: "all" },
  { name: "持仓变化因子", value: 0.12, sector: "all" },
]

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
]

function hashSeed(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

function pseudoReturn(factorName: string, date: string, sector: SectorKey): number {
  const seed = hashSeed(`${factorName}:${date}:${sector}`)
  const base = ((seed % 200) - 100) / 100
  const wave = Math.sin(seed % 17) * 0.35
  return Math.round((base + wave) * 100) / 100
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) {
    return []
  }
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

function tradingDatesBetween(from: string, to: string): string[] {
  return datesBetween(from, to).filter((d) => {
    const day = new Date(`${d}T12:00:00`).getDay()
    return day !== 0 && day !== 6
  })
}

function returnColorClass(value: number): string {
  if (value > 0) return "text-red-500"
  if (value < 0) return "text-green-600"
  return "text-zinc-500"
}

function cardBgClass(value: number): string {
  if (value > 0) return "bg-red-50/70 border-red-100"
  if (value < 0) return "bg-green-50/70 border-green-100"
  return "bg-zinc-50/50 border-zinc-100"
}

function formatReturnPct(value: number): string {
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
}

function sectorOffset(sector: SectorKey): number {
  const offsets: Record<SectorKey, number> = {
    all: 0,
    commodity: 0.03,
    black: 0.08,
    nonferrous: -0.05,
    energy: 0.12,
    agri: -0.1,
  }
  return offsets[sector]
}

const INTERVAL_PERIOD_COLUMNS = [
  "近一周收益",
  "近一月收益",
  "近三月收益",
  "近六月收益",
  "近一年收益",
  "今年以来收益",
] as const

const INTERVAL_TABLE_FACTORS: {
  name: string
  sector: SectorKey | "all"
  returns: number[]
}[] = [
  { name: "短周期时间序列动量", sector: "all", returns: [-4.44, -6.28, -5.54, -1.8, 5.96, 5.78] },
  { name: "时间序列动量", sector: "all", returns: [-5.9, -10.03, -3.18, -16.14, 22.74, 26.72] },
  { name: "长周期时间序列动量", sector: "all", returns: [-3.99, -7.54, 1.22, -22.46, 26.1, 26.27] },
  { name: "期限幅度动量", sector: "all", returns: [-2.15, -4.82, 0.65, -8.33, 12.45, 9.18] },
  { name: "截面动量", sector: "all", returns: [-1.76, -3.41, 2.08, -5.67, 8.92, 7.35] },
  { name: "期限基差动量", sector: "energy", returns: [-3.28, -5.15, -1.42, -9.86, 15.23, 11.64] },
  { name: "基差动量", sector: "black", returns: [-4.05, -6.72, -2.88, -12.4, 18.56, 14.82] },
  { name: "期限结构因子", sector: "all", returns: [-2.64, -4.19, 0.93, -7.21, 10.38, 8.47] },
  { name: "短期波动因子", sector: "all", returns: [1.85, 3.42, 4.16, 2.73, -3.28, -1.95] },
  { name: "波动因子", sector: "all", returns: [2.34, 4.08, 5.22, 3.15, -4.62, -2.48] },
  { name: "流动性因子", sector: "all", returns: [-1.42, -2.86, -0.75, -4.53, 6.18, 4.92] },
  { name: "均价突破因子", sector: "all", returns: [-3.56, -5.94, -1.68, -11.25, 16.84, 13.26] },
  { name: "偏度因子", sector: "all", returns: [0.92, 1.65, 2.38, 1.12, -2.15, -0.86] },
  { name: "基差因子", sector: "energy", returns: [3.18, 5.42, 6.75, 4.28, -5.93, -3.64] },
  { name: "持仓变化因子", sector: "all", returns: [-2.27, -1.04, -3.62, -5.24, 0.49, -6.03] },
]

const CUMULATIVE_LINE_FACTORS: {
  name: string
  color: string
  sector: SectorKey | "all"
}[] = [
  { name: "短期时间序列动量", color: "#D93025", sector: "all" },
  { name: "时间序列动量", color: "#1A73E8", sector: "all" },
  { name: "长期时间序列动量", color: "#FBBC04", sector: "all" },
  { name: "短期截面动量", color: "#22c55e", sector: "all" },
  { name: "截面动量", color: "#eab308", sector: "all" },
  { name: "短期基差动量", color: "#9333ea", sector: "energy" },
  { name: "基差动量", color: "#06b6d4", sector: "black" },
  { name: "期限结构因子", color: "#84cc16", sector: "all" },
  { name: "低波动因子", color: "#78716C", sector: "all" },
  { name: "波动因子", color: "#14b8a6", sector: "all" },
  { name: "流动性因子", color: "#64748b", sector: "all" },
  { name: "价值收益因子", color: "#b91c1c", sector: "all" },
  { name: "偏度因子", color: "#EC4899", sector: "all" },
  { name: "峰度因子", color: "#2563eb", sector: "all" },
  { name: "持仓变化因子", color: "#0ea5e9", sector: "all" },
]

function buildCumulativeReturns(factorName: string, dates: string[], sector: SectorKey): number[] {
  const drift = ((hashSeed(factorName) % 200) - 100) / 400
  let cum = 0
  return dates.map((date, index) => {
    if (index === 0) return 0
    const daily =
      pseudoReturn(factorName, date, sector) * 0.32 + drift + sectorOffset(sector) * 0.15
    cum += daily
    cum = Math.round(cum * 100) / 100
    return Math.max(-20, Math.min(15, cum))
  })
}

function formatCumulativeAxisLabel(value: string, index: number, allDates: string[]): string {
  const d = new Date(`${value}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ""
  const day = d.getDate()
  const month = d.getMonth() + 1
  const prev = index > 0 ? new Date(`${allDates[index - 1]}T12:00:00`) : null
  if (!prev || prev.getMonth() !== d.getMonth()) {
    if (day <= 3) return `${month}月`
  }
  if ([8, 15, 22, 29].includes(day)) return String(day)
  return ""
}

function intervalReturnColorClass(value: number): string {
  if (value < 0) return "text-red-500"
  if (value > 0) return "text-green-600"
  return "text-zinc-500"
}

function formatIntervalReturnPct(value: number): string {
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
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

export function FuturesStyleView() {
  const [draftFrom, setDraftFrom] = useState("2026-03-27")
  const [draftTo, setDraftTo] = useState("2026-06-29")
  const [appliedFrom, setAppliedFrom] = useState("2026-03-27")
  const [appliedTo, setAppliedTo] = useState("2026-06-29")
  const [activeSector, setActiveSector] = useState<SectorKey>("all")
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())
  const [selectAllSeries, setSelectAllSeries] = useState(true)
  const [hiddenCumulativeSeries, setHiddenCumulativeSeries] = useState<Set<string>>(new Set())
  const [selectAllCumulativeSeries, setSelectAllCumulativeSeries] = useState(true)

  const handleQuery = useCallback(() => {
    setAppliedFrom(draftFrom)
    setAppliedTo(draftTo)
    setHiddenSeries(new Set())
    setSelectAllSeries(true)
    setHiddenCumulativeSeries(new Set())
    setSelectAllCumulativeSeries(true)
  }, [draftFrom, draftTo])

  const visibleFactors = useMemo(() => {
    if (activeSector === "all" || activeSector === "commodity") return FUTURES_STYLE_FACTORS
    return FUTURES_STYLE_FACTORS.filter(
      (f) => f.sector === "all" || f.sector === activeSector,
    )
  }, [activeSector])

  const chartDates = useMemo(
    () => tradingDatesBetween(appliedFrom, appliedTo),
    [appliedFrom, appliedTo],
  )

  const latestDate = chartDates[chartDates.length - 1] ?? appliedTo

  const chartSeries = useMemo(
    () =>
      FUTURES_STYLE_FACTORS.map((factor, index) => ({
        name: factor.name,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        data: chartDates.map((date) => {
          const raw = pseudoReturn(factor.name, date, activeSector)
          const adjusted = Math.round((raw + sectorOffset(activeSector)) * 100) / 100
          return Math.max(-3.8, Math.min(3.8, adjusted))
        }),
      })),
    [activeSector, chartDates],
  )

  const chartOption = useMemo(() => {
    const zoomWindow = chartDates.length > 8 ? Math.round((8 / chartDates.length) * 100) : 100
    const zoomStart = 100 - zoomWindow

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
        type: "plain" as const,
        top: 4,
        left: 0,
        right: 72,
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 12,
        textStyle: { fontSize: 11, color: "#666666" },
        selected: Object.fromEntries(
          chartSeries.map((s) => [s.name, !hiddenSeries.has(s.name)]),
        ),
      },
      grid: { left: 52, right: 16, top: 92, bottom: 48 },
      dataZoom: [
        { type: "inside" as const, start: zoomStart, end: 100 },
        {
          type: "slider" as const,
          start: zoomStart,
          end: 100,
          bottom: 8,
          height: 22,
          borderColor: "#e4e4e7",
          backgroundColor: "#fafafa",
          fillerColor: "rgba(26,115,232,0.15)",
          handleStyle: { color: "#1A73E8", borderColor: "#1A73E8" },
          moveHandleStyle: { color: "#1A73E8" },
          dataBackground: {
            lineStyle: { color: "#cbd5e1", width: 1 },
            areaStyle: { color: "rgba(148,163,184,0.12)" },
          },
          selectedDataBackground: {
            lineStyle: { color: "#94a3b8", width: 1 },
            areaStyle: { color: "rgba(148,163,184,0.2)" },
          },
        },
      ],
      xAxis: {
        type: "category" as const,
        data: chartDates,
        axisLabel: { fontSize: 11, color: "#999999", rotate: 0, margin: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "收益率(%)",
        nameLocation: "end" as const,
        nameGap: 8,
        nameTextStyle: { fontSize: 11, color: "#999999", align: "left" as const },
        min: -4,
        max: 4,
        interval: 1,
        axisLabel: {
          fontSize: 11,
          color: "#999999",
          formatter: (v: number) => `${v}%`,
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#eeeeee", type: "solid" as const } },
      },
      series: chartSeries.map((s, index) => ({
        name: s.name,
        type: "bar" as const,
        barMaxWidth: 5,
        barGap: "15%",
        barCategoryGap: "35%",
        itemStyle: { color: s.color },
        data: s.data,
        ...(index === 0
          ? {
              markLine: {
                silent: true,
                symbol: "none" as const,
                lineStyle: { color: "#cccccc", width: 1 },
                label: { show: false },
                data: [{ yAxis: 0 }],
              },
            }
          : {}),
      })),
    }
  }, [chartDates, chartSeries, hiddenSeries])

  const cardValues = useMemo(() => {
    const offset = sectorOffset(activeSector)
    return visibleFactors.map((factor) => {
      const latest = chartDates.length
        ? pseudoReturn(factor.name, latestDate, activeSector) + offset
        : factor.value + offset
      return {
        ...factor,
        value: Math.round(latest * 100) / 100,
      }
    })
  }, [activeSector, chartDates, latestDate, visibleFactors])

  const intervalTableRows = useMemo(() => {
    const offset = sectorOffset(activeSector)
    const factors =
      activeSector === "all" || activeSector === "commodity"
        ? INTERVAL_TABLE_FACTORS
        : INTERVAL_TABLE_FACTORS.filter(
            (f) => f.sector === "all" || f.sector === activeSector,
          )

    return factors.map((factor, index) => ({
      index: index + 1,
      name: factor.name,
      returns: factor.returns.map((v) => Math.round((v + offset * 10) * 100) / 100),
    }))
  }, [activeSector])

  const statsCutoff = latestDate

  const visibleCumulativeFactors = useMemo(() => {
    if (activeSector === "all" || activeSector === "commodity") return CUMULATIVE_LINE_FACTORS
    return CUMULATIVE_LINE_FACTORS.filter(
      (f) => f.sector === "all" || f.sector === activeSector,
    )
  }, [activeSector])

  const cumulativeSeries = useMemo(
    () =>
      visibleCumulativeFactors.map((factor) => ({
        name: factor.name,
        color: factor.color,
        data: buildCumulativeReturns(factor.name, chartDates, activeSector),
      })),
    [activeSector, chartDates, visibleCumulativeFactors],
  )

  const cumulativeChartOption = useMemo(
    () => ({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
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
        type: "plain" as const,
        top: 4,
        left: 0,
        right: 72,
        itemWidth: 14,
        itemHeight: 2,
        itemGap: 12,
        icon: "rect" as const,
        textStyle: { fontSize: 11, color: "#666666" },
        selected: Object.fromEntries(
          cumulativeSeries.map((s) => [s.name, !hiddenCumulativeSeries.has(s.name)]),
        ),
      },
      grid: { left: 52, right: 16, top: 92, bottom: 48 },
      xAxis: {
        type: "category" as const,
        data: chartDates,
        boundaryGap: false,
        axisLabel: {
          fontSize: 11,
          color: "#999999",
          formatter: (value: string, index: number) =>
            formatCumulativeAxisLabel(value, index, chartDates),
        },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "收益率(%)",
        nameLocation: "end" as const,
        nameGap: 8,
        nameTextStyle: { fontSize: 11, color: "#999999", align: "left" as const },
        min: -20,
        max: 15,
        interval: 5,
        axisLabel: {
          fontSize: 11,
          color: "#999999",
          formatter: (v: number) => `${v}%`,
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#eeeeee", type: "solid" as const } },
      },
      series: cumulativeSeries.map((s, index) => ({
        name: s.name,
        type: "line" as const,
        symbol: "none" as const,
        smooth: false,
        lineStyle: { color: s.color, width: 1.5 },
        itemStyle: { color: s.color },
        data: s.data,
        ...(index === 0
          ? {
              markLine: {
                silent: true,
                symbol: "none" as const,
                lineStyle: { color: "#cccccc", width: 1 },
                label: { show: false },
                data: [{ yAxis: 0 }],
              },
            }
          : {}),
      })),
    }),
    [chartDates, cumulativeSeries, hiddenCumulativeSeries],
  )

  const handleToggleAllSeries = useCallback(() => {
    setSelectAllSeries((prev) => {
      const next = !prev
      setHiddenSeries(next ? new Set() : new Set(FUTURES_STYLE_FACTORS.map((f) => f.name)))
      return next
    })
  }, [])

  const handleLegendSelectChanged = useCallback((params: { selected?: Record<string, boolean> }) => {
    const selected = params.selected ?? {}
    const hidden = new Set<string>()
    for (const [name, visible] of Object.entries(selected)) {
      if (!visible) hidden.add(name)
    }
    setHiddenSeries(hidden)
    setSelectAllSeries(hidden.size === 0)
  }, [])

  const handleToggleAllCumulativeSeries = useCallback(() => {
    setSelectAllCumulativeSeries((prev) => {
      const next = !prev
      setHiddenCumulativeSeries(
        next ? new Set() : new Set(visibleCumulativeFactors.map((f) => f.name)),
      )
      return next
    })
  }, [visibleCumulativeFactors])

  const handleCumulativeLegendSelectChanged = useCallback(
    (params: { selected?: Record<string, boolean> }) => {
      const selected = params.selected ?? {}
      const hidden = new Set<string>()
      for (const [name, visible] of Object.entries(selected)) {
        if (!visible) hidden.add(name)
      }
      setHiddenCumulativeSeries(hidden)
      setSelectAllCumulativeSeries(hidden.size === 0)
    },
    [],
  )

  return (
    <div className="flex flex-col gap-4 -m-1">
      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-600 shrink-0">请选择时间范围：</span>
          <input
            type="date"
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            className="h-8 w-[9.5rem] rounded-sm border border-zinc-200 px-2 text-sm text-zinc-700 bg-white"
          />
          <span className="text-zinc-500 text-sm">~</span>
          <input
            type="date"
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            className="h-8 w-[9.5rem] rounded-sm border border-zinc-200 px-2 text-sm text-zinc-700 bg-white"
          />
          <button
            type="button"
            onClick={handleQuery}
            className="h-8 min-w-[4rem] px-4 rounded-sm border border-zinc-200 bg-white text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            查询
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
        <div className="flex items-center gap-0 border-b border-zinc-100 mb-4">
          {SECTOR_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveSector(tab.key)}
              className={[
                "px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px",
                activeSector === tab.key
                  ? "border-red-500 text-red-600 font-medium"
                  : "border-transparent text-zinc-700 hover:text-zinc-900",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-baseline gap-2 mb-4">
          <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0 self-center" />
          <span className="text-sm font-semibold text-zinc-800">最新风格因子收益</span>
          <span className="text-sm text-zinc-400">{latestDate}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {cardValues.map((card) => (
            <div
              key={card.name}
              className={[
                "rounded border px-3 py-3 text-center",
                cardBgClass(card.value),
              ].join(" ")}
            >
              <div className="text-xs text-zinc-500 mb-2 leading-snug min-h-[2rem] flex items-center justify-center">
                {card.name}
              </div>
              <div className={["text-xl font-semibold tabular-nums", returnColorClass(card.value)].join(" ")}>
                {formatReturnPct(card.value)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 pt-4 pb-2">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
            单日风格因子收益
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleToggleAllSeries}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              <span
                className={[
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm",
                  selectAllSeries ? "bg-red-500" : "border border-zinc-300 bg-white",
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
              className="inline-flex items-center justify-center h-7 w-7 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition-colors"
              title="图表设置"
            >
              <Menu className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {chartDates.length === 0 ? (
          <div className="flex items-center justify-center h-80 text-sm text-zinc-400">
            请选择有效的时间范围后点击查询
          </div>
        ) : (
          <ReactECharts
            option={chartOption}
            style={{ height: 480, width: "100%" }}
            notMerge
            lazyUpdate
            onEvents={{ legendselectchanged: handleLegendSelectChanged }}
          />
        )}
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
        <div className="mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
            区间统计
          </div>
          <div className="text-xs text-zinc-400 mt-1 ml-3">
            当前区间统计截止点为: {statsCutoff}
          </div>
        </div>
        <div className="overflow-x-auto rounded border border-zinc-100">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-50 text-zinc-500">
                <th className="px-3 py-2.5 text-center font-medium border-b border-zinc-100 w-12">序号</th>
                <th className="px-3 py-2.5 text-left font-medium border-b border-zinc-100 min-w-[9rem]">因子名称</th>
                {INTERVAL_PERIOD_COLUMNS.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-2.5 text-center font-medium border-b border-zinc-100 whitespace-nowrap min-w-[5.5rem]"
                  >
                    <SortableHeader label={col} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {intervalTableRows.map((row, rowIndex) => {
                const rowBg = rowIndex % 2 === 1 ? "bg-zinc-50/60" : "bg-white"
                return (
                  <tr key={row.name} className={rowBg}>
                    <td className={["px-3 py-2 text-center text-zinc-500 border-b border-zinc-50 tabular-nums", rowBg].join(" ")}>
                      {row.index}
                    </td>
                    <td className={["px-3 py-2 text-left text-zinc-700 border-b border-zinc-50 whitespace-nowrap", rowBg].join(" ")}>
                      {row.name}
                    </td>
                    {row.returns.map((value, colIndex) => (
                      <td
                        key={`${row.name}-${colIndex}`}
                        className={[
                          "px-3 py-2 text-center tabular-nums border-b border-zinc-50 whitespace-nowrap",
                          intervalReturnColorClass(value),
                          rowBg,
                        ].join(" ")}
                      >
                        {formatIntervalReturnPct(value)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 pt-4 pb-2">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
              <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
              风格因子累计收益
            </div>
            <div className="text-xs text-zinc-400 mt-1 ml-3">
              统计区间: {appliedFrom} ~ {statsCutoff}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleToggleAllCumulativeSeries}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              <span
                className={[
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm",
                  selectAllCumulativeSeries ? "bg-red-500" : "border border-zinc-300 bg-white",
                ].join(" ")}
              >
                {selectAllCumulativeSeries && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              全选
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

        {chartDates.length === 0 ? (
          <div className="flex items-center justify-center h-80 text-sm text-zinc-400">
            请选择有效的时间范围后点击查询
          </div>
        ) : (
          <ReactECharts
            option={cumulativeChartOption}
            style={{ height: 420, width: "100%" }}
            notMerge
            lazyUpdate
            onEvents={{ legendselectchanged: handleCumulativeLegendSelectChanged }}
          />
        )}
      </div>
    </div>
  )
}
