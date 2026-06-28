"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Info, Menu } from "lucide-react"
import {
  buildCorrelationMatrix,
  dailyReturnMap,
  excessReturnMap,
  fmtMatrixCorrelation,
  sortCorrelationMatrix,
} from "@/lib/fund-compare-correlation-matrix"

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

function truncateLabel(name: string, max = 14): string {
  return name.length > max ? `${name.slice(0, max)}…` : name
}

export function FundCompareCorrelationMatrix({
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
  const [sorted, setSorted] = useState(false)
  const [showBenchmark, setShowBenchmark] = useState(false)
  const [showExcess, setShowExcess] = useState(false)

  const matrix = useMemo(() => {
    const benchMap = benchmark
      ? dailyReturnMap(benchmark.navPoints, appliedFrom, appliedTo)
      : null

    const fundItems = funds.map((fund) => {
      const raw = dailyReturnMap(fund.navPoints, appliedFrom, appliedTo)
      const returnMap = showExcess && benchMap ? excessReturnMap(raw, benchMap) : raw
      return {
        key: fund.beian_hao,
        name: fund.name,
        returnMap,
        isBenchmark: false,
      }
    })

    if (showBenchmark && benchmark && benchMap && !showExcess) {
      fundItems.push({
        key: benchmark.key,
        name: benchmark.label,
        returnMap: benchMap,
        isBenchmark: true,
      })
    }

    if (fundItems.length < 2) return null
    const built = buildCorrelationMatrix(fundItems)
    return sorted ? sortCorrelationMatrix(built) : built
  }, [funds, benchmark, appliedFrom, appliedTo, showBenchmark, showExcess, sorted])

  const chartOption = useMemo(() => {
    if (!matrix) return null
    const { entities, values } = matrix
    const names = entities.map((e) => e.name)
    const n = names.length

    const heatData: [number, number, number][] = []
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = values[i][j]
        if (v != null && Number.isFinite(v)) heatData.push([j, i, v])
      }
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        position: "top" as const,
        formatter: (p: { data: [number, number, number] }) => {
          const [x, y, v] = p.data
          return `${names[y]} × ${names[x]}<br/>${fmtMatrixCorrelation(v)}`
        },
      },
      grid: {
        top: 12,
        left: 8,
        right: 24,
        bottom: 8,
        containLabel: true,
      },
      xAxis: {
        type: "category" as const,
        data: names,
        position: "top" as const,
        splitArea: { show: true },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 11,
          color: "#71717a",
          interval: 0,
          rotate: names.length > 5 ? 35 : 0,
          formatter: (v: string) => truncateLabel(v, 12),
        },
      },
      yAxis: {
        type: "category" as const,
        data: names,
        inverse: true,
        splitArea: { show: true },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 11,
          color: "#52525b",
          width: 110,
          overflow: "truncate" as const,
          formatter: (v: string) => truncateLabel(v, 16),
        },
      },
      visualMap: {
        min: 0,
        max: 1,
        show: false,
        inRange: {
          color: ["#fafafa", "#fee2e2", "#fca5a5", "#f87171", "#ef4444", "#b91c1c"],
        },
      },
      series: [
        {
          type: "heatmap" as const,
          data: heatData,
          itemStyle: {
            borderColor: "#fff",
            borderWidth: 2,
          },
          label: {
            show: true,
            formatter: (p: { data: [number, number, number] }) => p.data[2].toFixed(4),
            fontSize: 11,
            color: "#52525b",
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 8,
              shadowColor: "rgba(0,0,0,0.15)",
            },
          },
        },
      ],
    }
  }, [matrix])

  const chartHeight = useMemo(() => {
    const n = matrix?.entities.length ?? 0
    return Math.max(420, n * 56 + 100)
  }, [matrix])

  if (!analyzed || funds.length < 2 || !matrix || !chartOption) return null

  if (showExcess && (!benchmark || benchmark.navPoints.length === 0)) {
    return (
      <div className="px-6 pb-6 pt-2 flex-shrink-0">
        <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-muted-foreground">
          请选择业绩基准以计算超额相关系数
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            相关系数矩阵
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sorted}
                onChange={(e) => setSorted(e.target.checked)}
                className="rounded h-3 w-3"
              />
              排序
            </label>
            {benchmark && (
              <>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showBenchmark}
                    onChange={(e) => setShowBenchmark(e.target.checked)}
                    className="rounded h-3 w-3"
                    disabled={showExcess}
                  />
                  显示基准指数
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showExcess}
                    onChange={(e) => {
                      setShowExcess(e.target.checked)
                      if (e.target.checked) setShowBenchmark(false)
                    }}
                    className="rounded h-3 w-3 accent-red-500"
                  />
                  超额相关系数
                </label>
              </>
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

        <div className="px-2 py-4 w-full">
          <ReactECharts
            option={chartOption}
            style={{ height: chartHeight, width: "100%" }}
            notMerge
            lazyUpdate
          />
        </div>
      </div>
    </div>
  )
}
