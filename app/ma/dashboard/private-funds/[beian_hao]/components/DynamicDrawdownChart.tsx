"use client"

import { useMemo, type ReactNode } from "react"
import ReactECharts from "echarts-for-react"
import { dateToUtcTs, echartsTimeXAxis, toGappedLinePoints, type DrawdownChartPoint } from "./performanceChartUtils"
import type { DrawdownEpisodeMark } from "./DrawdownEpisodesTable"

function drawdownYMin(values: (number | null)[]): number {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v))
  if (!nums.length) return -10
  const min = Math.min(...nums)
  const pad = Math.abs(min) * 0.08
  return +(min - pad).toFixed(2)
}

export function DynamicDrawdownChart({
  data,
  productName,
  benchmarkLabel,
  hasBenchmark,
  showExcess,
  showFund = true,
  showBench = true,
  showExcessLine = true,
  maxFundDrawdown,
  height = "100%",
  episodeMarks = [],
}: {
  data: DrawdownChartPoint[]
  productName: string
  benchmarkLabel: string
  hasBenchmark: boolean
  showExcess: boolean
  showFund?: boolean
  showBench?: boolean
  showExcessLine?: boolean
  maxFundDrawdown: number | null
  height?: number | string
  episodeMarks?: DrawdownEpisodeMark[]
}) {
  const option = useMemo(() => {
    const includeFund = !showExcess && showFund
    const includeBench = !showExcess && hasBenchmark && showBench
    const includeExcess = showExcess ? showExcessLine : hasBenchmark && showExcessLine
    const showDots = data.length <= 40
    const fundPoints = includeFund || showExcess
      ? toGappedLinePoints(
          data.map((d) => ({ ts: d.ts, y: showExcess ? d.excessDD : d.fundDD, date: d.date })),
          showDots,
        )
      : []
    const benchPoints = includeBench
      ? toGappedLinePoints(
          data.map((d) => ({ ts: d.ts, y: d.benchDD, date: d.date })),
          showDots,
        )
      : []
    const excessPoints = includeExcess && !showExcess
      ? toGappedLinePoints(
          data.map((d) => ({ ts: d.ts, y: d.excessDD, date: d.date })),
          showDots,
        )
      : []
    const yMin = drawdownYMin([
      ...(includeFund || (showExcess && includeExcess) ? fundPoints.map((p) => p.value[1]) : []),
      ...benchPoints.map((p) => p.value[1]),
      ...excessPoints.map((p) => p.value[1]),
    ])

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

    const series: Array<Record<string, unknown>> = []

    if (showExcess && includeExcess) {
      series.push({
        name: "累计超额回撤",
        type: "line",
        smooth: false,
        showSymbol: true,
        symbol: "circle",
        symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 5 : 0),
        connectNulls: false,
        clip: false,
        lineStyle: { width: 2, color: "#059669" },
        itemStyle: { color: "#059669" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(5,150,105,0.04)" },
              { offset: 1, color: "rgba(5,150,105,0.22)" },
            ],
          },
        },
        data: fundPoints,
        markPoint: episodeMarkPoint,
        markLine: maxFundDrawdown !== null ? {
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", color: "#059669", opacity: 0.6 },
          label: { show: false },
          data: [{ yAxis: maxFundDrawdown }],
        } : undefined,
      })
    } else if (!showExcess) {
      if (includeFund) series.push({
        name: productName,
        type: "line",
        smooth: false,
        showSymbol: true,
        symbol: "circle",
        symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 5 : 0),
        connectNulls: false,
        clip: false,
        lineStyle: { width: 2, color: "#ef4444" },
        itemStyle: { color: "#ef4444" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(239,68,68,0.04)" },
              { offset: 1, color: "rgba(239,68,68,0.22)" },
            ],
          },
        },
        data: fundPoints,
        markPoint: episodeMarkPoint,
        markLine: maxFundDrawdown !== null ? {
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", color: "#ef4444", opacity: 0.6 },
          label: { show: false },
          data: [{ yAxis: maxFundDrawdown }],
        } : undefined,
      })

      if (includeBench) {
        series.push({
          name: `${benchmarkLabel}（基准）`,
          type: "line",
          smooth: false,
          showSymbol: true,
          symbol: "circle",
          symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 4 : 0),
          connectNulls: false,
          clip: false,
          lineStyle: { width: 1.75, color: "#2563eb", type: "dashed" },
          itemStyle: { color: "#2563eb" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(37,99,235,0.04)" },
                { offset: 1, color: "rgba(37,99,235,0.18)" },
              ],
            },
          },
          data: benchPoints,
        })
      }

      if (includeExcess) {
        series.push({
          name: "累计超额回撤",
          type: "line",
          smooth: false,
          showSymbol: true,
          symbol: "circle",
          symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 4 : 0),
          connectNulls: false,
          clip: false,
          lineStyle: { width: 1.75, color: "#059669" },
          itemStyle: { color: "#059669" },
          data: excessPoints,
        })
      }
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      useUTC: true,
      tooltip: {
        trigger: "axis" as const,
        valueFormatter: (v: number) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}%`),
      },
      legend: { show: false },
      grid: { left: 56, right: 28, top: 12, bottom: 28 },
      xAxis: echartsTimeXAxis(data.map((d) => d.date)),
      yAxis: {
        type: "value" as const,
        name: "回撤值(%)",
        max: 0,
        min: yMin,
        nameTextStyle: { fontSize: 11, color: "#71717a" },
        axisLabel: {
          fontSize: 11,
          color: "#71717a",
          formatter: (v: number) => `${v.toFixed(0)}%`,
        },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" as const } },
      },
      series,
    }
  }, [data, productName, benchmarkLabel, hasBenchmark, showExcess, showFund, showBench, showExcessLine, maxFundDrawdown, episodeMarks])

  if (!data.length) return null

  return (
    <ReactECharts
      option={option}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
    />
  )
}

function DrawdownLegendButton({
  visible,
  onClick,
  children,
}: {
  visible: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 cursor-pointer transition-opacity select-none",
        visible ? "opacity-100" : "opacity-40 hover:opacity-60",
      ].join(" ")}
      title={visible ? "点击隐藏该曲线" : "点击显示该曲线"}
      aria-pressed={visible}
    >
      {children}
    </button>
  )
}

export function DrawdownSeriesLegend({
  productName,
  benchmarkLabel,
  showFund = true,
  showBench = false,
  showExcess = false,
  fundVisible,
  benchVisible,
  excessVisible,
  onToggleFund,
  onToggleBench,
  onToggleExcess,
  className = "flex items-center gap-4 text-xs text-zinc-600",
}: {
  productName: string
  benchmarkLabel: string
  showFund?: boolean
  showBench?: boolean
  showExcess?: boolean
  fundVisible: boolean
  benchVisible: boolean
  excessVisible: boolean
  onToggleFund: () => void
  onToggleBench: () => void
  onToggleExcess: () => void
  className?: string
}) {
  return (
    <div className={className}>
      {showFund && (
        <DrawdownLegendButton visible={fundVisible} onClick={onToggleFund}>
          <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: "#ef4444" }} />
          {productName}
        </DrawdownLegendButton>
      )}
      {showBench && (
        <DrawdownLegendButton visible={benchVisible} onClick={onToggleBench}>
          <svg width="20" height="4" aria-hidden="true" className="inline-block">
            <line x1="0" y1="2" x2="20" y2="2" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          {benchmarkLabel}（基准）
        </DrawdownLegendButton>
      )}
      {showExcess && (
        <DrawdownLegendButton visible={excessVisible} onClick={onToggleExcess}>
          <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: "#059669" }} />
          累计超额回撤
        </DrawdownLegendButton>
      )}
    </div>
  )
}
