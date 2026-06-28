"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Menu } from "lucide-react"
import {
  buildFundScatterPoints,
  scatterAxisBounds,
  type WinRateGranularity,
} from "@/lib/fund-compare-win-rate"

const LINE_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#14b8a6", "#84cc16", "#8b5cf6", "#06b6d4", "#64748b"]

interface FundInput {
  beian_hao: string
  name: string
  navPoints: { d: string; v: number }[]
}

interface BenchmarkInput {
  key: string
  label: string
  navPoints: { d: string; v: number }[]
}

export function FundCompareReturnScatterChart({
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
  const [granularity, setGranularity] = useState<WinRateGranularity>("week")
  const [showExcess, setShowExcess] = useState(false)
  const [selectAllSeries, setSelectAllSeries] = useState(true)
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  const fundSeries = useMemo(() => {
    if (!benchmark) return []
    return funds.map((fund, idx) => ({
      key: fund.beian_hao,
      name: fund.name,
      color: LINE_COLORS[idx % LINE_COLORS.length],
      points: buildFundScatterPoints(
        fund.navPoints,
        benchmark.navPoints,
        granularity,
        appliedFrom,
        appliedTo,
        showExcess,
      ),
    }))
  }, [funds, benchmark, granularity, appliedFrom, appliedTo, showExcess])

  const allNamedSeries = fundSeries
  const activeSeries = useMemo(() => {
    if (selectAllSeries) return allNamedSeries
    return allNamedSeries.filter((s) => !hiddenSeries.has(s.name))
  }, [allNamedSeries, hiddenSeries, selectAllSeries])

  const chartOption = useMemo(() => {
    const allPoints = activeSeries.flatMap((s) => s.points)
    const xDomain = scatterAxisBounds(allPoints.map((p) => p.bench), [-6, 8])
    const yDomain = scatterAxisBounds(allPoints.map((p) => p.fund), [-15, 15])
    const yAxisLabel = showExcess ? "超额收益率（%）" : "收益率（%）"
    const benchLabel = benchmark?.label ?? "基准"

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "item" as const,
        formatter: (p: { seriesName: string; value: [number, number]; marker: string }) => {
          if (!p?.value) return ""
          const [bench, fund] = p.value
          const benchSign = bench > 0 ? "+" : ""
          const fundSign = fund > 0 ? "+" : ""
          return [
            `<div style="font-weight:600;margin-bottom:4px">${p.seriesName}</div>`,
            `${benchLabel}（基准）: ${benchSign}${bench.toFixed(2)}%`,
            `<br/>${showExcess ? "超额" : "基金"}: ${fundSign}${fund.toFixed(2)}%`,
          ].join("")
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
        itemGap: 14,
        icon: "circle",
        selected: Object.fromEntries(
          allNamedSeries.map((s) => [s.name, !hiddenSeries.has(s.name)]),
        ),
      },
      grid: { left: 56, right: 24, top: 44, bottom: 48 },
      xAxis: {
        type: "value" as const,
        min: xDomain[0],
        max: xDomain[1],
        name: `${benchLabel}（基准）收益率（%）`,
        nameLocation: "middle" as const,
        nameGap: 28,
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (v: number) => `${v}%`,
        },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" as const } },
      },
      yAxis: {
        type: "value" as const,
        min: yDomain[0],
        max: yDomain[1],
        name: yAxisLabel,
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (v: number) => `${v > 0 ? "+" : ""}${v}%`,
        },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" as const } },
      },
      series: activeSeries.map((s, index) => ({
        name: s.name,
        type: "scatter" as const,
        symbolSize: 8,
        itemStyle: { color: s.color, opacity: 0.85 },
        data: s.points.map((p) => [p.bench, p.fund]),
        ...(index === 0
          ? {
              markLine: {
                silent: true,
                symbol: "none" as const,
                lineStyle: { color: "#18181b", width: 1.5 },
                label: { show: false },
                data: [{ xAxis: 0 }, { yAxis: 0 }],
              },
            }
          : {}),
      })),
    }
  }, [activeSeries, allNamedSeries, benchmark?.label, hiddenSeries, showExcess])

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

  if (!analyzed || funds.length === 0) return null

  if (!benchmark || benchmark.navPoints.length === 0) {
    return (
      <div className="px-6 pb-6 pt-2 flex-shrink-0">
        <div className="rounded-xl border bg-white overflow-hidden px-4 py-8 text-center text-sm text-muted-foreground">
          请选择业绩基准并点击「开始分析」以查看收益散点图对比
        </div>
      </div>
    )
  }

  const hasData = fundSeries.some((s) => s.points.length > 0)
  if (!hasData) return null

  const dateRangeLabel = appliedFrom && appliedTo ? `${appliedFrom} ~ ${appliedTo}` : ""

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 border-b">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-800" />
              收益散点图对比
            </h3>
            {dateRangeLabel && (
              <p className="text-xs text-muted-foreground mt-1">统计区间：{dateRangeLabel}</p>
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
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showExcess}
                onChange={(e) => setShowExcess(e.target.checked)}
                className="rounded h-3 w-3 accent-red-500"
              />
              超额
            </label>
            <div className="inline-flex rounded border border-zinc-200 overflow-hidden">
              {(["week", "month"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGranularity(g)}
                  className={[
                    "px-2.5 py-1 text-xs transition-colors border-r border-zinc-200 last:border-r-0",
                    granularity === g
                      ? "bg-red-500 text-white font-medium"
                      : "bg-white text-zinc-600 hover:bg-zinc-50",
                  ].join(" ")}
                >
                  {g === "week" ? "周度" : "月度"}
                </button>
              ))}
            </div>
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
