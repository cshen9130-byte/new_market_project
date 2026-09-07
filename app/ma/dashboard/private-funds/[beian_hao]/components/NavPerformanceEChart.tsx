"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { RED } from "./shared"
import {
  dateToUtcTs,
  echartsTimeXAxis,
  formatIsoDateFromTs,
  formatReturnTooltipLabel,
  toGappedLinePoints,
  type NavChartPoint,
  type ReturnLabelMode,
} from "./performanceChartUtils"

export type NavChartMaterialMark = {
  id: number
  date: string
  y: number
  label: string
}

function yTick(value: number, chartMode: "nav" | "return"): string {
  if (chartMode === "return") return `${value > 0 ? "+" : ""}${value.toFixed(0)}%`
  return value.toFixed(2)
}

function yTooltip(value: number, chartMode: "nav" | "return"): string {
  if (chartMode === "return") return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
  return value.toFixed(4)
}

export function NavPerformanceEChart({
  data,
  chartMode,
  navTypeLabel,
  yDomain,
  showDots,
  showFund = true,
  showBench,
  benchmarkLabel,
  height = "100%",
  returnLabelMode = "cumulative",
  episodeMarks = [],
  materialMarks = [],
  onMaterialMarkClick,
}: {
  data: NavChartPoint[]
  chartMode: "nav" | "return"
  navTypeLabel: string
  yDomain: [number, number] | [string, string]
  showDots: boolean
  showFund?: boolean
  showBench: boolean
  benchmarkLabel: string
  height?: number | string
  returnLabelMode?: ReturnLabelMode
  episodeMarks?: Array<{ date: string; y: number; no: number }>
  materialMarks?: NavChartMaterialMark[]
  onMaterialMarkClick?: (mark: NavChartMaterialMark) => void
}) {
  const fundName = chartMode === "return" ? "基金收益率" : navTypeLabel

  const option = useMemo(() => {
    const numericDomain = Array.isArray(yDomain) && typeof yDomain[0] === "number"
      && Number.isFinite(yDomain[0]) && Number.isFinite(yDomain[1])
      ? yDomain as [number, number]
      : null
    const fundPoints = toGappedLinePoints(
      data.map((d) => ({ ts: d.ts, y: d.value, date: d.date, periodReturn: d.periodReturn })),
      showDots,
    )
    const benchPoints = showBench
      ? toGappedLinePoints(
          data.map((d) => ({
            ts: d.ts,
            y: d.benchmarkValue,
            date: d.date,
            periodReturn: d.benchmarkPeriodReturn,
          })),
          showDots,
        )
      : []

    const episodeMarkPoint = episodeMarks.length
      ? {
          symbol: "circle",
          symbolSize: 26,
          data: episodeMarks.map((mark) => ({
            coord: [dateToUtcTs(mark.date), mark.y],
            value: mark.no,
            itemStyle: { color: "#ffffff", borderColor: "#dc2626", borderWidth: 2.5 },
            label: {
              show: true,
              formatter: "{c}",
              color: "#dc2626",
              fontSize: 13,
              fontWeight: 800,
            },
          })),
        }
      : undefined

    const materialMarkPoint = materialMarks.length
      ? {
          symbol: "pin",
          symbolSize: 18,
          data: materialMarks.map((mark) => ({
            coord: [dateToUtcTs(mark.date), mark.y],
            value: mark.label,
            markId: mark.id,
            itemStyle: { color: "#2563eb" },
            label: { show: false },
          })),
        }
      : undefined

    const zeroMarkLine = chartMode === "return"
      ? {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#d4d4d8", width: 1 },
          data: [{ yAxis: 0 }],
          label: { show: false },
        }
      : undefined

    const series: Array<Record<string, unknown>> = []
    if (showBench) {
      series.push({
        name: benchmarkLabel,
        type: "line",
        showSymbol: true,
        symbol: "circle",
        symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 5 : 0),
        connectNulls: false,
        clip: false,
        lineStyle: { width: 1.75, color: "#2563eb", type: "dashed" },
        itemStyle: { color: "#2563eb" },
        data: benchPoints,
        markLine: showFund ? undefined : zeroMarkLine,
      })
    }
    if (showFund) {
      series.push({
        name: fundName,
        type: "line",
        showSymbol: true,
        symbol: "circle",
        symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 5 : 0),
        connectNulls: false,
        clip: false,
        lineStyle: { width: 2, color: RED },
        itemStyle: { color: RED },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(239,68,68,0.12)" },
              { offset: 1, color: "rgba(239,68,68,0.01)" },
            ],
          },
        },
        data: fundPoints,
        markPoint: episodeMarkPoint,
        markLine: zeroMarkLine,
      })
    }
    if (materialMarkPoint) {
      series.push({
        name: "__materials",
        type: "line",
        data: [],
        silent: false,
        tooltip: { show: false },
        lineStyle: { opacity: 0 },
        showSymbol: false,
        markPoint: materialMarkPoint,
      })
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      useUTC: true,
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "line" as const, snap: true },
        formatter: (raw: unknown) => {
          const params = Array.isArray(raw) ? raw : [raw]
          const first = params[0] as { axisValue?: string | number; data?: { date?: string; periodReturn?: number | null }; seriesName?: string; value?: [number, number] } | undefined
          const date = first?.data?.date
            ?? (typeof first?.axisValue === "number" ? formatIsoDateFromTs(first.axisValue) : String(first?.axisValue ?? "").slice(0, 10))
          const lines = [date]
          for (const item of params as Array<{ seriesName?: string; data?: { periodReturn?: number | null; date?: string }; value?: [number, number | null] }>) {
            const isBench = item.seriesName === benchmarkLabel
            const y = Array.isArray(item.value) ? item.value[1] : null
            if (typeof y !== "number" || !Number.isFinite(y)) continue
            const shown = chartMode === "return" && returnLabelMode === "period"
              ? item.data?.periodReturn
              : y
            if (typeof shown !== "number" || !Number.isFinite(shown)) continue
            const label = chartMode === "return"
              ? formatReturnTooltipLabel(item.seriesName, returnLabelMode, isBench)
              : (item.seriesName ?? "")
            lines.push(`${label}: ${yTooltip(shown, chartMode)}`)
          }
          return lines.join("<br/>")
        },
      },
      grid: { left: 52, right: 28, top: 16, bottom: 28 },
      xAxis: echartsTimeXAxis(data.map((d) => d.date)),
      yAxis: {
        type: "value" as const,
        min: numericDomain ? numericDomain[0] : undefined,
        max: numericDomain ? numericDomain[1] : undefined,
        axisLabel: {
          fontSize: 11,
          color: "#71717a",
          formatter: (v: number) => yTick(v, chartMode),
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#f0f0f2", type: "dashed" as const } },
      },
      series,
    }
  }, [
    benchmarkLabel,
    chartMode,
    data,
    episodeMarks,
    fundName,
    materialMarks,
    returnLabelMode,
    showBench,
    showDots,
    showFund,
    yDomain,
  ])

  if (data.length <= 1) return null

  return (
    <ReactECharts
      option={option}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
      onEvents={onMaterialMarkClick ? {
        click: (params: { data?: { markId?: number } }) => {
          const id = params?.data?.markId
          if (id == null) return
          const mark = materialMarks.find((m) => m.id === id)
          if (mark) onMaterialMarkClick(mark)
        },
      } : undefined}
    />
  )
}

export function NavChartSeriesLegend({
  chartMode,
  navTypeLabel,
  benchmarkLabel,
  hasBenchmark,
  fundVisible,
  benchVisible,
  onToggleFund,
  onToggleBench,
}: {
  chartMode: "nav" | "return"
  navTypeLabel: string
  benchmarkLabel: string
  hasBenchmark: boolean
  fundVisible: boolean
  benchVisible: boolean
  onToggleFund: () => void
  onToggleBench: () => void
}) {
  const fundLabel = chartMode === "return" ? "基金收益率" : navTypeLabel
  return (
    <div className="flex items-center gap-4 text-xs text-zinc-600 mt-2">
      <button
        type="button"
        onClick={onToggleFund}
        className={[
          "inline-flex items-center gap-1.5 cursor-pointer transition-opacity select-none",
          fundVisible ? "opacity-100" : "opacity-40 hover:opacity-60",
        ].join(" ")}
        title={fundVisible ? "点击隐藏该曲线" : "点击显示该曲线"}
        aria-pressed={fundVisible}
      >
        <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: RED }} />
        {fundLabel}
      </button>
      {hasBenchmark && (
        <button
          type="button"
          onClick={onToggleBench}
          className={[
            "inline-flex items-center gap-1.5 cursor-pointer transition-opacity select-none",
            benchVisible ? "opacity-100" : "opacity-40 hover:opacity-60",
          ].join(" ")}
          title={benchVisible ? "点击隐藏该曲线" : "点击显示该曲线"}
          aria-pressed={benchVisible}
        >
          <svg width="20" height="4" aria-hidden="true" className="inline-block">
            <line x1="0" y1="2" x2="20" y2="2" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          {benchmarkLabel}
        </button>
      )}
    </div>
  )
}
