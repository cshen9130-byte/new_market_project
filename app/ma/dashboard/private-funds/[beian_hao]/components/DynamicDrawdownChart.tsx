"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { dateToUtcTs, formatIsoDateFromTs, toGappedLinePoints, type DrawdownChartPoint } from "./performanceChartUtils"
import type { DrawdownEpisodeMark } from "./DrawdownEpisodesTable"

function monthAxisLabel(dateStr: string, lastDate: string): string {
  const month = parseInt(dateStr.slice(5, 7), 10)
  const year = dateStr.slice(0, 4)
  if (month === 1 || dateStr.slice(0, 4) !== lastDate.slice(0, 4)) return year
  return `${month}月`
}

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
  maxFundDrawdown,
  height = "100%",
  episodeMarks = [],
}: {
  data: DrawdownChartPoint[]
  productName: string
  benchmarkLabel: string
  hasBenchmark: boolean
  showExcess: boolean
  maxFundDrawdown: number | null
  height?: number | string
  episodeMarks?: DrawdownEpisodeMark[]
}) {
  const dates = useMemo(() => data.map((d) => d.date), [data])
  const lastDate = dates.at(-1) ?? ""

  const option = useMemo(() => {
    const showDots = data.length <= 40
    const fundPoints = toGappedLinePoints(
      data.map((d) => ({ ts: d.ts, y: showExcess ? d.excessDD : d.fundDD, date: d.date })),
      showDots,
    )
    const benchPoints = showExcess
      ? []
      : toGappedLinePoints(
          data.map((d) => ({ ts: d.ts, y: d.benchDD, date: d.date })),
          showDots,
        )
    const minTs = data[0]?.ts
    const maxTs = data[data.length - 1]?.ts
    const yMin = drawdownYMin([
      ...fundPoints.map((p) => p.value[1]),
      ...benchPoints.map((p) => p.value[1]),
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

    if (showExcess) {
      series.push({
        name: "超额回撤",
        type: "line",
        smooth: false,
        showSymbol: true,
        symbol: "circle",
        symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 5 : 0),
        connectNulls: false,
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
    } else {
      series.push({
        name: productName,
        type: "line",
        smooth: false,
        showSymbol: true,
        symbol: "circle",
        symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 5 : 0),
        connectNulls: false,
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

      if (hasBenchmark) {
        series.push({
          name: `${benchmarkLabel}（基准）`,
          type: "line",
          smooth: false,
          showSymbol: true,
          symbol: "circle",
          symbolSize: (_v: unknown, params: { data?: { showDot?: boolean } }) => (params.data?.showDot ? 4 : 0),
          connectNulls: false,
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
      grid: { left: 56, right: 20, top: 12, bottom: 28 },
      xAxis: {
        type: "time" as const,
        min: minTs,
        max: maxTs,
        boundaryGap: false,
        axisLabel: {
          fontSize: 11,
          color: "#71717a",
          hideOverlap: true,
          formatter: (value: number) => monthAxisLabel(formatIsoDateFromTs(value), lastDate),
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
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
  }, [data, dates, lastDate, productName, benchmarkLabel, hasBenchmark, showExcess, maxFundDrawdown, episodeMarks])

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
