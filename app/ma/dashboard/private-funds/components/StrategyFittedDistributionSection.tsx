"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"
import { Menu, Settings2 } from "lucide-react"

const FIT_DISTRIBUTION_CHARTS = [
  { label: "股票市场中性", showExcessToggle: false },
  { label: "1000指增", showExcessToggle: true },
  { label: "500指增", showExcessToggle: true },
  { label: "300指增", showExcessToggle: true },
  { label: "A500指增", showExcessToggle: true },
  { label: "量化选股", showExcessToggle: false },
] as const

const FIT_DISTRIBUTION_CHARTS_SECOND = [
  { label: "主观多头", showExcessToggle: false },
  { label: "量化多头", showExcessToggle: false },
  { label: "主观期货", showExcessToggle: false },
  { label: "期货策略", showExcessToggle: false },
  { label: "股票对冲", showExcessToggle: false },
  { label: "股票多头", showExcessToggle: false },
] as const

const FIT_DISTRIBUTION_CHARTS_THIRD = [
  { label: "套利策略", showExcessToggle: false },
  { label: "期权策略", showExcessToggle: false },
  { label: "多资产策略", showExcessToggle: false },
  { label: "债券策略", showExcessToggle: false },
  { label: "组合策略", showExcessToggle: false },
  { label: "可转债多头", showExcessToggle: false },
] as const

const RED = "#D93025"
const BLUE = "#1A73E8"

function hashSeed(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

function normalPdf(x: number, mean: number, std: number): number {
  if (std <= 0) return 0
  return Math.exp(-0.5 * ((x - mean) / std) ** 2) / (std * Math.sqrt(2 * Math.PI))
}

function distributionParams(strategy: string, periodKey: string, excess: boolean) {
  const seed = hashSeed(`${strategy}:${periodKey}:${excess ? "ex" : "abs"}:dist`)
  const mean = ((seed % 1000) / 1000 - 0.5) * 5.5
  const std = 1.1 + (seed % 80) / 80
  return { mean, std }
}

function buildDensityPoints(mean: number, std: number, xMin: number, xMax: number, steps = 80) {
  const points: [number, number][] = []
  for (let i = 0; i <= steps; i += 1) {
    const x = xMin + ((xMax - xMin) * i) / steps
    points.push([x, normalPdf(x, mean, std) * 100])
  }
  return points
}

function formatWeekRange(endDate: string): string {
  const end = new Date(`${endDate}T12:00:00`)
  if (Number.isNaN(end.getTime())) return `周报(${endDate})`
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return `周报(${start.toISOString().slice(0, 10)}~${endDate})`
}

function buildDistributionChartOption(
  strategy: string,
  currentPeriod: string,
  previousPeriod: string,
  currentLabel: string,
  previousLabel: string,
  showExcess: boolean,
  yAxisName: "概率" | "频率" = "概率",
): EChartsOption {
  const current = distributionParams(strategy, currentPeriod, showExcess)
  const previous = distributionParams(strategy, previousPeriod, showExcess)
  const xMin = -8
  const xMax = 8
  const currentPoints = buildDensityPoints(current.mean, current.std, xMin, xMax)
  const previousPoints = buildDensityPoints(previous.mean, previous.std, xMin, xMax)
  const yMax = Math.max(
    ...currentPoints.map((p) => p[1]),
    ...previousPoints.map((p) => p[1]),
    5,
  )
  const yTop = Math.ceil(yMax / 2.5) * 2.5

  return {
    animation: false,
    legend: {
      top: 0,
      left: 0,
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { fontSize: 10, color: "#71717a" },
      data: [currentLabel, previousLabel],
    },
    grid: { left: 42, right: 8, top: 36, bottom: 28 },
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as Array<{
          seriesName?: string
          value?: [number, number]
          color?: string
        }>
        if (!items.length) return ""
        const x = items[0].value?.[0] ?? 0
        const lines = [`<div style="color:#71717a;margin-bottom:4px">收益率 ${x.toFixed(2)}%</div>`]
        for (const item of items) {
          const y = item.value?.[1]
          if (y == null) continue
          lines.push(
            `<div style="font-weight:600;color:${item.color ?? "#333"}">${item.seriesName}: ${y.toFixed(2)}%</div>`,
          )
        }
        return lines.join("")
      },
    },
    xAxis: {
      type: "value",
      min: xMin,
      max: xMax,
      axisLabel: {
        fontSize: 10,
        color: "#a1a1aa",
        formatter: (v: number) => `${v.toFixed(1).replace(/\.0$/, "")}%`,
      },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      splitLine: { show: false },
      name: "收益率",
      nameLocation: "middle",
      nameGap: 22,
      nameTextStyle: { fontSize: 10, color: "#a1a1aa" },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: yTop,
      interval: yTop <= 5 ? 2.5 : 5,
      axisLabel: { fontSize: 10, color: "#a1a1aa", formatter: "{value}%" },
      splitLine: { lineStyle: { type: "dashed", color: "#f4f4f5" } },
      name: yAxisName,
      nameLocation: "middle",
      nameGap: 32,
      nameTextStyle: { fontSize: 10, color: "#a1a1aa" },
    },
    series: [
      {
        name: currentLabel,
        type: "line",
        data: currentPoints,
        showSymbol: false,
        lineStyle: { color: RED, width: 1.5 },
        itemStyle: { color: RED },
        areaStyle: { color: "rgba(217,48,37,0.35)" },
        z: 2,
      },
      {
        name: previousLabel,
        type: "line",
        data: previousPoints,
        showSymbol: false,
        lineStyle: { color: BLUE, width: 1.5 },
        itemStyle: { color: BLUE },
        areaStyle: { color: "rgba(26,115,232,0.3)" },
        z: 1,
      },
    ],
  }
}

function FittedDistributionChart({
  strategy,
  showExcessToggle,
  currentPeriod,
  previousPeriod,
  currentLabel,
  previousLabel,
  yAxisName = "概率",
}: {
  strategy: string
  showExcessToggle: boolean
  currentPeriod: string
  previousPeriod: string
  currentLabel: string
  previousLabel: string
  yAxisName?: "概率" | "频率"
}) {
  const [showExcess, setShowExcess] = useState(false)

  const option = useMemo(
    () =>
      buildDistributionChartOption(
        strategy,
        currentPeriod,
        previousPeriod,
        currentLabel,
        previousLabel,
        showExcess,
        yAxisName,
      ),
    [strategy, currentPeriod, previousPeriod, currentLabel, previousLabel, showExcess, yAxisName],
  )

  return (
    <div className="rounded-lg border border-zinc-100 bg-white p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h4 className="text-sm font-medium text-zinc-800">{strategy}</h4>
        <div className="flex items-center gap-2 shrink-0">
          {showExcessToggle && (
            <button
              type="button"
              onClick={() => setShowExcess((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              <span
                className={[
                  "inline-flex h-3 w-3 items-center justify-center rounded border",
                  showExcess ? "border-red-500 bg-red-500" : "border-zinc-300 bg-white",
                ].join(" ")}
              >
                {showExcess && (
                  <svg viewBox="0 0 12 12" className="h-2 w-2 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              超额
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center justify-center h-6 w-6 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 transition-colors"
            title="图表菜单"
          >
            <Menu className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <ReactECharts option={option} style={{ height: 220, width: "100%" }} notMerge lazyUpdate />
    </div>
  )
}

function DistributionChartGrid({
  charts,
  currentPeriod,
  previousPeriod,
  currentLabel,
  previousLabel,
  yAxisName = "概率",
}: {
  charts: readonly { label: string; showExcessToggle: boolean }[]
  currentPeriod: string
  previousPeriod: string
  currentLabel: string
  previousLabel: string
  yAxisName?: "概率" | "频率"
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {charts.map((chart) => (
        <FittedDistributionChart
          key={chart.label}
          strategy={chart.label}
          showExcessToggle={chart.showExcessToggle}
          currentPeriod={currentPeriod}
          previousPeriod={previousPeriod}
          currentLabel={currentLabel}
          previousLabel={previousLabel}
          yAxisName={yAxisName}
        />
      ))}
    </div>
  )
}

export function StrategyFittedDistributionSection({
  periodKeys,
}: {
  periodKeys: string[]
}) {
  const { currentPeriod, previousPeriod, currentLabel, previousLabel } = useMemo(() => {
    const current = periodKeys[periodKeys.length - 1] ?? "2026-06-18"
    const previous = periodKeys[periodKeys.length - 2] ?? "2026-06-11"
    return {
      currentPeriod: current,
      previousPeriod: previous,
      currentLabel: formatWeekRange(current),
      previousLabel: formatWeekRange(previous),
    }
  }, [periodKeys])

  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
          拟合分布
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 transition-colors"
        >
          <Settings2 className="h-3.5 w-3.5" />
          区间设置
        </button>
      </div>

      <DistributionChartGrid
        charts={FIT_DISTRIBUTION_CHARTS}
        currentPeriod={currentPeriod}
        previousPeriod={previousPeriod}
        currentLabel={currentLabel}
        previousLabel={previousLabel}
        yAxisName="概率"
      />

      <div className="mt-3">
        <DistributionChartGrid
          charts={FIT_DISTRIBUTION_CHARTS_SECOND}
          currentPeriod={currentPeriod}
          previousPeriod={previousPeriod}
          currentLabel={currentLabel}
          previousLabel={previousLabel}
          yAxisName="频率"
        />
      </div>

      <div className="mt-3">
        <DistributionChartGrid
          charts={FIT_DISTRIBUTION_CHARTS_THIRD}
          currentPeriod={currentPeriod}
          previousPeriod={previousPeriod}
          currentLabel={currentLabel}
          previousLabel={previousLabel}
          yAxisName="频率"
        />
      </div>
    </div>
  )
}
