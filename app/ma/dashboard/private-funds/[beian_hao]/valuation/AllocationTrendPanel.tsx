"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Download } from "lucide-react"

export type AllocationTrendSeries = {
  category: string
  rowKind: string
  values: number[]
}

type Props = {
  dates: string[]
  series: AllocationTrendSeries[]
  displayName: string
  fromDate?: string
  toDate?: string
  loading?: boolean
}

const ALLOCATION_COLORS: Record<string, string> = {
  托管户现金: "#ef4444",
  清算备付金: "#3b82f6",
  存出保证金: "#f97316",
  私募基金: "#4472c4",
  公募基金: "#70ad47",
  衍生品: "#8b5cf6",
  股票: "#14b8a6",
  债券: "#eab308",
  其他: "#a5a5a5",
}

const FALLBACK_COLORS = [
  "#ef4444",
  "#3b82f6",
  "#f97316",
  "#14b8a6",
  "#8b5cf6",
  "#eab308",
  "#64748b",
  "#ec4899",
]

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`
}

function colorForCategory(category: string, index: number): string {
  return ALLOCATION_COLORS[category] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

export function AllocationTrendPanel({
  dates,
  series,
  displayName,
  fromDate,
  toDate,
  loading,
}: Props) {
  const activeSeries = useMemo(
    () => series.filter((s) => s.values.some((v) => v > 0.001)),
    [series],
  )

  const option = useMemo(() => {
    if (dates.length < 2 || activeSeries.length === 0) return {}

    return {
      color: activeSeries.map((s, i) => colorForCategory(s.category, i)),
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (params: Array<{ seriesName: string; value: number; axisValue: string }>) => {
          if (!Array.isArray(params) || params.length === 0) return ""
          const lines = [`${params[0].axisValue}`]
          for (const p of params) {
            if (p.value > 0.001) {
              lines.push(`${p.seriesName}: ${fmtPct(p.value)}`)
            }
          }
          return lines.join("<br/>")
        },
      },
      legend: {
        type: "scroll",
        top: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 12, color: "#666" },
        data: activeSeries.map((s) => s.category),
      },
      grid: { left: 48, right: 16, top: 48, bottom: 28 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: dates,
        axisLabel: { fontSize: 11, color: "#888" },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: {
          formatter: (v: number) => `${v}%`,
          fontSize: 11,
          color: "#888",
        },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: activeSeries.map((s, i) => ({
        type: "area",
        stack: "allocation",
        name: s.category,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1 },
        areaStyle: { opacity: 0.85 },
        emphasis: { focus: "series" },
        data: s.values.map((v) => +v.toFixed(4)),
        itemStyle: { color: colorForCategory(s.category, i) },
      })),
    }
  }, [dates, activeSeries])

  function handleExportCsv() {
    if (dates.length === 0 || activeSeries.length === 0) return
    const header = ["日期", ...activeSeries.map((s) => s.category)]
    const lines = [
      header.join(","),
      ...dates.map((date, i) =>
        [date, ...activeSeries.map((s) => (s.values[i] ?? 0).toFixed(4))].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_资产配置走势_${fromDate ?? dates[0]}_${toDate ?? dates.at(-1)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const showChart = dates.length >= 2 && activeSeries.length > 0

  return (
    <div className="bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-50">
        <div>
          <div className="text-red-500 font-semibold text-sm">资产配置走势</div>
          {fromDate && toDate && (
            <div className="text-zinc-400 text-xs mt-0.5">
              {fromDate} ～ {toDate}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={!showChart}
          className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-40"
          title="导出"
        >
          <Download className="h-4 w-4" />
        </button>
      </div>

      {loading && (
        <div className="h-[420px] flex items-center justify-center text-sm text-zinc-400">
          加载资产配置走势…
        </div>
      )}

      {!loading && !showChart && (
        <div className="h-[420px] flex flex-col items-center justify-center text-sm text-zinc-500 gap-2 px-6 text-center">
          <p className="font-medium text-zinc-700">暂无足够的历史估值数据</p>
          <p className="text-xs text-zinc-400 leading-relaxed max-w-lg">
            需要至少两个估值日的资产配置数据才能绘制走势。数据由 nightly ETL 从邮件同步，请等待下次 ETL 运行或在「运维 → 邮件解析」中手动抓取。
          </p>
        </div>
      )}

      {!loading && showChart && (
        <div className="px-2 pb-2">
          <ReactECharts option={option} style={{ height: 420 }} notMerge />
        </div>
      )}
    </div>
  )
}
