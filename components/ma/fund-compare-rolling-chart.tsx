"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Menu } from "lucide-react"
import {
  EXTRA_ROLLING_METRICS,
  PRIMARY_ROLLING_METRICS,
  ROLLING_WINDOW_OPTIONS,
  computeBenchmarkRollingSeriesNav,
  computeRollingMetricSeriesNav,
  downsampleRollingSeries,
  formatRollingAxisDate,
  formatRollingMetricValue,
  mergeRollingDates,
  rollingMetricFormatType,
  rollingMetricLabel,
  rollingYDomain,
  type RollingMetricKey,
} from "@/lib/fund-compare-rolling"

const LINE_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#14b8a6", "#84cc16", "#8b5cf6", "#06b6d4", "#64748b"]
const BENCH_COLOR = "#60a5fa"

interface FundInput {
  beian_hao: string
  name: string
  navPoints: { d: string; v: number }[]
}

interface BenchmarkInput {
  label: string
  navPoints: { d: string; v: number }[]
}

export function FundCompareRollingChart({
  funds,
  benchmark,
  analyzed,
  appliedFrom,
  appliedTo,
}: {
  funds: FundInput[]
  benchmark: BenchmarkInput | null
  analyzed: boolean
  appliedFrom: string
  appliedTo: string
}) {
  const [metric, setMetric] = useState<RollingMetricKey>("periodRet")
  const [windowDays, setWindowDays] = useState(365)
  const [selectAllSeries, setSelectAllSeries] = useState(true)
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  const hasBenchmark = benchmark != null && benchmark.navPoints.length > 0
  const availablePrimary = useMemo(
    () => PRIMARY_ROLLING_METRICS.filter((k) => k !== "correlation" || hasBenchmark),
    [hasBenchmark],
  )

  const fundSeries = useMemo(() => {
    const benchNav = benchmark?.navPoints ?? []
    if (metric === "correlation" && benchNav.length === 0) return []
    return funds.map((fund, idx) => {
      const raw = computeRollingMetricSeriesNav(
        fund.navPoints.filter((p) => p.d >= appliedFrom && p.d <= appliedTo),
        benchNav,
        windowDays,
        metric,
      )
      return {
        key: fund.beian_hao,
        name: fund.name,
        color: LINE_COLORS[idx % LINE_COLORS.length],
        points: downsampleRollingSeries(raw),
      }
    })
  }, [funds, benchmark, windowDays, metric, appliedFrom, appliedTo])

  const benchSeries = useMemo(() => {
    if (!benchmark || metric === "correlation") return null
    const raw = computeBenchmarkRollingSeriesNav(
      benchmark.navPoints.filter((p) => p.d >= appliedFrom && p.d <= appliedTo),
      windowDays,
      metric,
    )
    const points = downsampleRollingSeries(raw)
    if (!points.length) return null
    return {
      name: `${benchmark.label}(基准)`,
      color: BENCH_COLOR,
      points,
    }
  }, [benchmark, metric, windowDays, appliedFrom, appliedTo])

  const dates = useMemo(() => {
    const all = [
      ...fundSeries.map((s) => s.points),
      ...(benchSeries ? [benchSeries.points] : []),
    ]
    return mergeRollingDates(all)
  }, [fundSeries, benchSeries])

  const allNamedSeries = useMemo(() => {
    const list = fundSeries.map((s) => ({ name: s.name, color: s.color, points: s.points }))
    if (benchSeries) list.push(benchSeries)
    return list
  }, [fundSeries, benchSeries])

  const activeSeries = useMemo(() => {
    if (selectAllSeries) return allNamedSeries
    return allNamedSeries.filter((s) => !hiddenSeries.has(s.name))
  }, [allNamedSeries, hiddenSeries, selectAllSeries])

  const yAxisLabel = rollingMetricLabel(metric)

  const chartOption = useMemo(() => {
    const allValues = activeSeries.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v != null)
    const [yMin, yMax] = rollingYDomain(allValues, metric)
    const fmtType = rollingMetricFormatType(metric)

    const fmtAxis = (v: number) => {
      if (fmtType === "pct") return `${v.toFixed(0)}%`
      if (fmtType === "corr") return v.toFixed(1)
      if (fmtType === "days") return String(Math.round(v))
      return v.toFixed(1)
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: Array<{ seriesName: string; value: number | null; axisValue: string }>) => {
          if (!params?.length) return ""
          const lines = params
            .filter((p) => p.value != null && Number.isFinite(p.value))
            .map((p) => `${p.seriesName}: ${formatRollingMetricValue(p.value, metric)}`)
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
        selected: Object.fromEntries(
          allNamedSeries.map((s) => [s.name, !hiddenSeries.has(s.name)]),
        ),
      },
      grid: { left: 56, right: 24, top: 44, bottom: 40 },
      xAxis: {
        type: "category" as const,
        data: dates,
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (v: string) => formatRollingAxisDate(v),
        },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        min: yMin,
        max: yMax,
        name: yAxisLabel,
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: fmtAxis,
        },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" as const } },
      },
      series: activeSeries.map((s) => {
        const valueMap = new Map(s.points.map((p) => [p.date, p.value]))
        return {
          name: s.name,
          type: "line" as const,
          smooth: true,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 2, color: s.color },
          itemStyle: { color: s.color },
          data: dates.map((d) => {
            const v = valueMap.get(d)
            return v == null ? null : v
          }),
        }
      }),
    }
  }, [activeSeries, allNamedSeries, dates, hiddenSeries, metric, yAxisLabel])

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
      setHiddenSeries(next ? new Set() : new Set(allNamedSeries.map((s) => s.name)))
      return next
    })
  }

  const hasData = fundSeries.some((s) => s.points.length > 0)
  if (!analyzed || funds.length === 0 || !hasData) return null

  const dateRangeLabel = appliedFrom && appliedTo ? `${appliedFrom} ~ ${appliedTo}` : ""

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 border-b">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-800" />
              滚动分析对比
            </h3>
            <div className="flex flex-wrap items-center gap-1 mb-2">
              {availablePrimary.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMetric(key)}
                  className={[
                    "px-2.5 py-1 text-xs whitespace-nowrap transition-colors rounded border",
                    metric === key
                      ? "bg-red-500 text-white border-red-500 font-medium"
                      : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50",
                  ].join(" ")}
                >
                  {rollingMetricLabel(key)}
                </button>
              ))}
              <select
                value={EXTRA_ROLLING_METRICS.includes(metric) ? metric : ""}
                onChange={(e) => {
                  const v = e.target.value as RollingMetricKey
                  if (v) setMetric(v)
                }}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-500 max-w-[140px]"
              >
                <option value="">请选择更多指标</option>
                {EXTRA_ROLLING_METRICS.map((key) => (
                  <option key={key} value={key}>{rollingMetricLabel(key)}</option>
                ))}
              </select>
            </div>
            {dateRangeLabel && (
              <p className="text-xs text-muted-foreground">统计区间：{dateRangeLabel}</p>
            )}
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
            <label className="inline-flex items-center gap-1.5">
              <span className="text-zinc-500">滚动周期：</span>
              <select
                value={windowDays}
                onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
              >
                {ROLLING_WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.days} value={opt.days}>{opt.label}</option>
                ))}
              </select>
            </label>
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
