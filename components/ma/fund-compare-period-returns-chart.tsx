"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Download, Menu } from "lucide-react"
import {
  RETURN_GRANULARITY_OPTIONS,
  computePeriodReturnsFromNav,
  filterPointsToYear,
  seriesToAlignedData,
  type NavPoint,
  type ReturnGranularity,
  yearsInRange,
} from "@/lib/fund-compare-period-returns"

const LINE_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#14b8a6", "#84cc16", "#8b5cf6", "#06b6d4", "#64748b"]

interface FundInput {
  beian_hao: string
  name: string
  navPoints: NavPoint[]
}

interface BenchmarkInput {
  key: string
  label: string
  navPoints: NavPoint[]
}

export function FundComparePeriodReturnsChart({
  funds,
  benchmark,
  analyzed,
  fromDate,
  toDate,
}: {
  funds: FundInput[]
  benchmark: BenchmarkInput | null
  analyzed: boolean
  fromDate: string
  toDate: string
}) {
  const yearOptions = useMemo(() => yearsInRange(fromDate, toDate), [fromDate, toDate])
  const [year, setYear] = useState(() => yearOptions[0] ?? new Date().getFullYear())
  const [granularity, setGranularity] = useState<ReturnGranularity>("month")
  const [selectAllSeries, setSelectAllSeries] = useState(true)
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())
  const [showBenchmark, setShowBenchmark] = useState(false)
  const [showExcess, setShowExcess] = useState(false)

  const fundSeries = useMemo(() => {
    return funds.map((fund, idx) => {
      const yearPoints = filterPointsToYear(fund.navPoints, year)
      const periodReturns = computePeriodReturnsFromNav(yearPoints, granularity)
      return {
        key: fund.beian_hao,
        name: fund.name,
        color: LINE_COLORS[idx % LINE_COLORS.length],
        periodReturns,
      }
    })
  }, [funds, year, granularity])

  const benchmarkSeries = useMemo(() => {
    if (!benchmark) return null
    const yearPoints = filterPointsToYear(benchmark.navPoints, year)
    const periodReturns = computePeriodReturnsFromNav(yearPoints, granularity)
    return {
      key: benchmark.key,
      name: `${benchmark.label}(基准)`,
      color: "#60a5fa",
      periodReturns,
    }
  }, [benchmark, year, granularity])

  const periodLabels = useMemo(() => {
    const all = [
      ...fundSeries.map((s) => s.periodReturns),
      ...(benchmarkSeries ? [benchmarkSeries.periodReturns] : []),
    ]
    const labels = new Set<string>()
    for (const series of all) {
      for (const pt of series) labels.add(pt.label)
    }
    return [...labels].sort()
  }, [fundSeries, benchmarkSeries])

  const chartSeries = useMemo(() => {
    const base = fundSeries.map((s) => ({
      name: s.name,
      color: s.color,
      data: seriesToAlignedData(s.periodReturns, periodLabels),
    }))

    if (!showBenchmark || !benchmarkSeries) {
      if (!showExcess) return base
      return base
    }

    if (showExcess) {
      const benchMap = new Map(benchmarkSeries.periodReturns.map((p) => [p.label, p.pct]))
      return base.map((s) => ({
        ...s,
        data: periodLabels.map((label, i) => {
          const fundVal = s.data[i]
          const benchVal = benchMap.get(label)
          if (!Number.isFinite(fundVal) || benchVal == null) return NaN
          return parseFloat((fundVal - benchVal).toFixed(2))
        }),
      }))
    }

    return [
      ...base,
      {
        name: benchmarkSeries.name,
        color: benchmarkSeries.color,
        data: seriesToAlignedData(benchmarkSeries.periodReturns, periodLabels),
      },
    ]
  }, [fundSeries, benchmarkSeries, periodLabels, showBenchmark, showExcess])

  const activeSeries = useMemo(() => {
    if (selectAllSeries) return chartSeries
    return chartSeries.filter((s) => !hiddenSeries.has(s.name))
  }, [chartSeries, hiddenSeries, selectAllSeries])

  const statsCutoff = useMemo(() => {
    const dates = funds.flatMap((f) => f.navPoints.map((p) => p.d))
    if (benchmark) dates.push(...benchmark.navPoints.map((p) => p.d))
    const sorted = dates.filter((d) => d.startsWith(`${year}-`)).sort()
    return sorted.at(-1)?.slice(0, 10) ?? toDate
  }, [funds, benchmark, year, toDate])

  const chartOption = useMemo(() => {
    const allValues = activeSeries.flatMap((s) => s.data).filter((v) => Number.isFinite(v))
    const minVal = allValues.length ? Math.min(...allValues, 0) : -10
    const maxVal = allValues.length ? Math.max(...allValues, 0) : 10
    const pad = Math.max((maxVal - minVal) * 0.1, 3)
    const yMin = Math.floor((minVal - pad) / 10) * 10
    const yMax = Math.ceil((maxVal + pad) / 10) * 10

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        formatter: (params: Array<{ seriesName: string; value: number; marker: string; axisValue: string }>) => {
          if (!params?.length) return ""
          const lines = params
            .filter((p) => p.value != null && Number.isFinite(p.value))
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
        data: periodLabels,
        axisLabel: { fontSize: 11, color: "#a1a1aa" },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        min: yMin,
        max: yMax,
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (v: number) => `${v}%`,
        },
        name: "收益率（%）",
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
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
  }, [activeSeries, chartSeries, hiddenSeries, periodLabels])

  const handleLegendSelectChanged = useCallback((params: { selected?: Record<string, boolean> }) => {
    const selected = params.selected ?? {}
    const hidden = new Set<string>()
    for (const [name, visible] of Object.entries(selected)) {
      if (!visible) hidden.add(name)
    }
    setHiddenSeries(hidden)
    setSelectAllSeries(hidden.size === 0)
  }, [])

  function handleToggleAllSeries() {
    setSelectAllSeries((prev) => {
      const next = !prev
      setHiddenSeries(next ? new Set() : new Set(chartSeries.map((s) => s.name)))
      return next
    })
  }

  function exportCsv() {
    const headers = ["日期", ...activeSeries.map((s) => s.name)]
    const rows = periodLabels.map((label, i) => [
      label,
      ...activeSeries.map((s) => (Number.isFinite(s.data[i]) ? `${s.data[i].toFixed(2)}%` : "")),
    ])
    const escape = (v: string) => (v.includes(",") ? `"${v}"` : v)
    const blob = new Blob(
      ["\uFEFF" + [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8;" },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `区间收益对比_${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!analyzed || funds.length === 0 || periodLabels.length === 0) return null

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 border-b">
          <div>
            <h3 className="text-sm font-semibold text-foreground">区间收益对比</h3>
            <p className="text-xs text-muted-foreground mt-1">统计截止点：{statsCutoff}</p>
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
            {benchmark && (
              <>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showExcess}
                    onChange={(e) => setShowExcess(e.target.checked)}
                    className="rounded h-3 w-3"
                  />
                  超额
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-red-500">
                  <input
                    type="checkbox"
                    checked={showBenchmark}
                    onChange={(e) => setShowBenchmark(e.target.checked)}
                    className="rounded h-3 w-3 accent-red-500"
                  />
                  基准指数
                </label>
              </>
            )}
            <div className="inline-flex items-center gap-1.5">
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
              >
                {yearOptions.map((y) => (
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

        <div className="px-4 py-4">
          <ReactECharts
            option={chartOption}
            style={{ height: 360, width: "100%" }}
            notMerge
            lazyUpdate
            onEvents={{ legendselectchanged: handleLegendSelectChanged }}
          />
        </div>
      </div>
    </div>
  )
}
