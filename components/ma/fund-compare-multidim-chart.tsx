"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import {
  AXIS_METRICS,
  PERIOD_PRESETS,
  axisTitle,
  computeFundPeriodMetrics,
  niceAxisBounds,
  readMetricValue,
  resolvePeriodRange,
  type AxisMetricKey,
  type PeriodPreset,
} from "@/lib/fund-compare-multidim"

const LINE_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#14b8a6", "#84cc16", "#8b5cf6", "#06b6d4", "#64748b"]

interface FundInput {
  beian_hao: string
  name: string
  returnPoints: { d: string; v: number }[]
}

interface ScatterFund {
  beian_hao: string
  name: string
  color: string
  x: number
  y: number
}

export function FundCompareMultidimChart({
  funds,
  analyzed,
  appliedFrom,
  appliedTo,
}: {
  funds: FundInput[]
  analyzed: boolean
  appliedFrom: string
  appliedTo: string
}) {
  const [period, setPeriod] = useState<PeriodPreset>("1y")
  const [xMetric, setXMetric] = useState<AxisMetricKey>("periodReturn")
  const [yMetric, setYMetric] = useState<AxisMetricKey>("maxDrawdown")
  const [selectAllSeries, setSelectAllSeries] = useState(true)
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  const periodRange = useMemo(
    () => resolvePeriodRange(period, appliedFrom, appliedTo),
    [period, appliedFrom, appliedTo],
  )

  const scatterFunds = useMemo((): ScatterFund[] => {
    return funds.map((fund, idx) => {
      const metrics = computeFundPeriodMetrics(
        fund.returnPoints,
        periodRange.from,
        periodRange.to,
      )
      const x = readMetricValue(metrics, xMetric)
      const y = readMetricValue(metrics, yMetric)
      return {
        beian_hao: fund.beian_hao,
        name: fund.name,
        color: LINE_COLORS[idx % LINE_COLORS.length],
        x: x ?? NaN,
        y: y ?? NaN,
      }
    })
  }, [funds, periodRange, xMetric, yMetric])

  const activeFunds = useMemo(() => {
    if (selectAllSeries) return scatterFunds
    return scatterFunds.filter((f) => !hiddenSeries.has(f.name))
  }, [scatterFunds, hiddenSeries, selectAllSeries])

  const xMeta = AXIS_METRICS.find((m) => m.key === xMetric)!
  const yMeta = AXIS_METRICS.find((m) => m.key === yMetric)!

  const chartOption = useMemo(() => {
    const xValues = activeFunds.map((f) => f.x).filter(Number.isFinite)
    const yValues = activeFunds.map((f) => f.y).filter(Number.isFinite)
    const xBounds = niceAxisBounds(xValues, {
      symmetric: xMeta.isPct && xMetric !== "maxDrawdown",
    })
    const yBounds = niceAxisBounds(yValues, {
      minZero: yMetric === "maxDrawdown" || yMetric === "annVol" || yMetric === "downsideRisk",
    })

    const fmtAxis = (v: number, isPct: boolean) =>
      isPct ? `${v.toFixed(2)}%` : v.toFixed(2)

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "item" as const,
        formatter: (p: { seriesName: string; value: [number, number]; marker: string }) => {
          if (!p?.value) return ""
          const [x, y] = p.value
          return [
            `<div style="font-weight:600;margin-bottom:4px">${p.seriesName}</div>`,
            `${p.marker}${axisTitle(xMetric, periodRange.label)}: ${fmtAxis(x, xMeta.isPct)}`,
            `<br/>${axisTitle(yMetric, periodRange.label)}: ${fmtAxis(y, yMeta.isPct)}`,
          ].join("")
        },
      },
      legend: {
        type: "scroll" as const,
        top: 0,
        left: 0,
        right: 0,
        textStyle: { fontSize: 11, color: "#52525b" },
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 14,
        icon: "circle",
        selected: Object.fromEntries(
          scatterFunds.map((f) => [f.name, !hiddenSeries.has(f.name)]),
        ),
      },
      grid: { left: 56, right: 24, top: 44, bottom: 48 },
      xAxis: {
        type: "value" as const,
        min: xBounds.min,
        max: xBounds.max,
        name: axisTitle(xMetric, periodRange.label),
        nameLocation: "middle" as const,
        nameGap: 28,
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (v: number) => fmtAxis(v, xMeta.isPct),
        },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" as const } },
      },
      yAxis: {
        type: "value" as const,
        min: yBounds.min,
        max: yBounds.max,
        name: axisTitle(yMetric, periodRange.label),
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (v: number) => fmtAxis(v, yMeta.isPct),
        },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" as const } },
      },
      series: activeFunds.map((fund) => ({
        name: fund.name,
        type: "scatter" as const,
        symbolSize: 10,
        itemStyle: { color: fund.color },
        data: [[fund.x, fund.y]],
      })),
    }
  }, [
    activeFunds,
    hiddenSeries,
    periodRange.label,
    scatterFunds,
    xMeta.isPct,
    xMetric,
    yMeta.isPct,
    yMetric,
  ])

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
      setHiddenSeries(next ? new Set() : new Set(scatterFunds.map((f) => f.name)))
      return next
    })
  }

  const hasData = scatterFunds.some((f) => Number.isFinite(f.x) && Number.isFinite(f.y))
  if (!analyzed || !appliedTo || funds.length === 0 || !hasData) return null

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 border-b">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-800" />
              多维对比
            </h3>
            <p className="text-xs text-muted-foreground mt-1">统计截止点：{appliedTo}</p>
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
              <span className="text-zinc-500">统计区间</span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as PeriodPreset)}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
              >
                {PERIOD_PRESETS.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5">
              <span className="text-zinc-500">X轴指标</span>
              <select
                value={xMetric}
                onChange={(e) => setXMetric(e.target.value as AxisMetricKey)}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
              >
                {AXIS_METRICS.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5">
              <span className="text-zinc-500">Y轴指标</span>
              <select
                value={yMetric}
                onChange={(e) => setYMetric(e.target.value as AxisMetricKey)}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
              >
                {AXIS_METRICS.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </label>
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
