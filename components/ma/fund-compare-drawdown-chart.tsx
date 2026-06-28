"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Menu } from "lucide-react"
import {
  computeExcessReturnSeries,
  drawdownOnTimeline,
  drawdownYMin,
  hexToRgba,
  mergeDates,
  monthAxisLabel,
  type ReturnPoint,
} from "@/lib/fund-compare-drawdown"

const LINE_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#14b8a6", "#84cc16", "#8b5cf6", "#06b6d4", "#64748b"]
const BENCH_COLOR = "#60a5fa"

interface FundInput {
  beian_hao: string
  name: string
  returnPoints: ReturnPoint[]
}

interface BenchmarkInput {
  key: string
  label: string
  returnPoints: ReturnPoint[]
}

export function FundCompareDrawdownChart({
  funds,
  benchmark,
  analyzed,
}: {
  funds: FundInput[]
  benchmark: BenchmarkInput | null
  analyzed: boolean
}) {
  const [selectAllSeries, setSelectAllSeries] = useState(true)
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())
  const [showExcess, setShowExcess] = useState(false)

  const chartSeries = useMemo(() => {
    const fundInputs = funds.map((fund) => {
      if (showExcess && benchmark && benchmark.returnPoints.length > 0) {
        return {
          key: fund.beian_hao,
          name: fund.name,
          points: computeExcessReturnSeries(fund.returnPoints, benchmark.returnPoints),
        }
      }
      return { key: fund.beian_hao, name: fund.name, points: fund.returnPoints }
    })

    const allSeries = [
      ...fundInputs.map((f) => f.points),
      ...(benchmark && !showExcess ? [benchmark.returnPoints] : []),
    ]
    const dates = mergeDates(allSeries)
    const lastDate = dates.at(-1) ?? ""

    const fundSeries = fundInputs.map((fund, idx) => ({
      key: fund.key,
      name: fund.name,
      color: LINE_COLORS[idx % LINE_COLORS.length],
      data: drawdownOnTimeline(dates, fund.points),
    }))

    const benchSeries = benchmark && !showExcess && benchmark.returnPoints.length > 0
      ? [{
          key: benchmark.key,
          name: `${benchmark.label}(基准)`,
          color: BENCH_COLOR,
          data: drawdownOnTimeline(dates, benchmark.returnPoints),
        }]
      : []

    return { dates, lastDate, fundSeries, benchSeries }
  }, [funds, benchmark, showExcess])

  const allNamedSeries = useMemo(
    () => [...chartSeries.fundSeries, ...chartSeries.benchSeries],
    [chartSeries],
  )

  const activeSeries = useMemo(() => {
    if (selectAllSeries) return allNamedSeries
    return allNamedSeries.filter((s) => !hiddenSeries.has(s.name))
  }, [allNamedSeries, hiddenSeries, selectAllSeries])

  const chartOption = useMemo(() => {
    const yMin = drawdownYMin(activeSeries.flatMap((s) => s.data))

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        valueFormatter: (v: number) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}%`),
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
        data: chartSeries.dates,
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (v: string) => monthAxisLabel(v, chartSeries.lastDate),
        },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "回撤率（%）",
        max: 0,
        min: yMin,
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (v: number) => `${v.toFixed(2)}%`,
        },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" as const } },
      },
      series: activeSeries.map((s) => ({
        name: s.name,
        type: "line" as const,
        smooth: true,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: s.color },
        itemStyle: { color: s.color },
        areaStyle: {
          color: {
            type: "linear" as const,
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: hexToRgba(s.color, 0.04) },
              { offset: 1, color: hexToRgba(s.color, 0.22) },
            ],
          },
        },
        data: s.data,
      })),
    }
  }, [activeSeries, allNamedSeries, chartSeries.dates, chartSeries.lastDate, hiddenSeries])

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

  const hasData = chartSeries.fundSeries.some((s) => s.data.some((v) => v != null))
  if (!analyzed || funds.length === 0 || !hasData) return null

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 border-b">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-800" />
              动态回撤对比
            </h3>
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
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showExcess}
                  onChange={(e) => setShowExcess(e.target.checked)}
                  className="rounded h-3 w-3 accent-red-500"
                />
                超额（算法）
              </label>
            )}
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
