"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import type { DrawdownChartPoint } from "./performanceChartUtils"

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
}: {
  data: DrawdownChartPoint[]
  productName: string
  benchmarkLabel: string
  hasBenchmark: boolean
  showExcess: boolean
  maxFundDrawdown: number | null
}) {
  const dates = useMemo(() => data.map((d) => d.date), [data])
  const lastDate = dates.at(-1) ?? ""

  const option = useMemo(() => {
    const fundData = data.map((d) => (showExcess ? d.excessDD : d.fundDD))
    const benchData = showExcess ? [] : data.map((d) => d.benchDD)
    const yMin = drawdownYMin([...fundData, ...benchData])

    const series: Array<Record<string, unknown>> = []

    if (showExcess) {
      series.push({
        name: "超额回撤",
        type: "line",
        smooth: true,
        showSymbol: false,
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
        data: fundData,
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
        smooth: true,
        showSymbol: false,
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
        data: fundData,
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
          smooth: true,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.75, color: "#2563eb" },
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
          data: benchData,
        })
      }
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        valueFormatter: (v: number) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}%`),
      },
      legend: { show: false },
      grid: { left: 56, right: 20, top: 12, bottom: 28 },
      xAxis: {
        type: "category" as const,
        data: dates,
        boundaryGap: false,
        axisLabel: {
          fontSize: 11,
          color: "#71717a",
          formatter: (v: string) => monthAxisLabel(v, lastDate),
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
  }, [data, dates, lastDate, productName, benchmarkLabel, hasBenchmark, showExcess, maxFundDrawdown])

  if (!data.length) return null

  return (
    <ReactECharts
      option={option}
      style={{ height: 320, width: "100%" }}
      notMerge
      lazyUpdate
    />
  )
}
