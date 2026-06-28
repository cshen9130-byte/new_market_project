"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Download, Info, Menu } from "lucide-react"

export type FofShareTrendSeries = {
  name: string
  values: number[]
}

export type FofShareTrendData = {
  dates: string[]
  series: FofShareTrendSeries[]
  has_data: boolean
  point_count: number
}

export type FofTrendAnalysisData = {
  underlying_trend: FofShareTrendData
  strategy_trend: FofShareTrendData
  month_end_underlying: FofShareTrendData
  month_end_strategy: FofShareTrendData
}

type Props = {
  title: string
  data: FofShareTrendData | null
  displayName: string
  fromDate?: string
  toDate?: string
  loading?: boolean
  chartType?: "area" | "bar"
  exportLabel?: string
  showStrategySelect?: boolean
  minPoints?: number
}

const PALETTE = [
  "#e54d42", "#5b9bd5", "#ed7d31", "#14b8a6", "#8b5cf6", "#eab308",
  "#64748b", "#ec4899", "#22c55e", "#f97316", "#06b6d4", "#a855f7",
  "#84cc16", "#ef4444", "#3b82f6", "#d97706", "#10b981", "#6366f1",
]

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`
}

function colorForIndex(index: number): string {
  return PALETTE[index % PALETTE.length]
}

export function FofShareTrendPanel({
  title,
  data,
  displayName,
  fromDate,
  toDate,
  loading,
  chartType = "area",
  exportLabel,
  showStrategySelect = false,
  minPoints = 2,
}: Props) {
  const [selectAll, setSelectAll] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const dates = data?.dates ?? []
  const sourceSeries = data?.series ?? []

  useEffect(() => {
    setHidden(new Set())
    setSelectAll(true)
  }, [data?.series])

  const activeSeries = useMemo(
    () => sourceSeries.filter((s) => selectAll || !hidden.has(s.name)),
    [hidden, selectAll, sourceSeries],
  )

  const option = useMemo(() => {
    if (dates.length < minPoints || activeSeries.length === 0) return {}

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: chartType === "bar" ? "shadow" : "cross" },
        formatter: (params: Array<{ seriesName: string; value: number; axisValue: string; marker: string }>) => {
          if (!Array.isArray(params) || params.length === 0) return ""
          const rows = params
            .filter((p) => p.value > 0.001)
            .sort((a, b) => b.value - a.value)
          const lines = [`${params[0].axisValue}`]
          for (const p of rows) {
            lines.push(`${p.marker}${p.seriesName}: ${fmtPct(p.value)}`)
          }
          return lines.join("<br/>")
        },
      },
      legend: {
        type: "scroll",
        top: 0,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { fontSize: 11, color: "#666" },
        data: sourceSeries.map((s) => s.name),
        selected: Object.fromEntries(
          sourceSeries.map((s) => [s.name, selectAll || !hidden.has(s.name)]),
        ),
      },
      grid: { left: 48, right: 16, top: 56, bottom: chartType === "bar" ? 56 : 28 },
      dataZoom: chartType === "bar"
        ? [
          { type: "inside", start: 0, end: 100 },
          { type: "slider", height: 18, bottom: 8, borderColor: "transparent", fillerColor: "rgba(148,163,184,0.15)" },
        ]
        : undefined,
      xAxis: {
        type: "category",
        boundaryGap: chartType === "bar",
        data: dates,
        axisLabel: { fontSize: 10, color: "#888", rotate: chartType === "bar" ? 30 : 0 },
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
      series: activeSeries.map((s) => {
        const colorIndex = Math.max(0, sourceSeries.findIndex((x) => x.name === s.name))
        const color = colorForIndex(colorIndex)
        if (chartType === "bar") {
          return {
            type: "bar" as const,
            stack: "fof-share",
            name: s.name,
            barMaxWidth: 36,
            emphasis: { focus: "series" as const },
            data: s.values.map((v) => +v.toFixed(4)),
            itemStyle: { color },
          }
        }
        return {
          type: "line" as const,
          stack: "fof-share",
          name: s.name,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 0, color },
          areaStyle: { color, opacity: 0.85 },
          emphasis: { focus: "series" as const },
          data: s.values.map((v) => +v.toFixed(4)),
          itemStyle: { color },
        }
      }),
    }
  }, [activeSeries, chartType, dates, hidden, minPoints, selectAll, sourceSeries])

  function handleLegendToggle(name: string, visible: boolean) {
    setSelectAll(false)
    setHidden((prev) => {
      const next = new Set(prev)
      if (visible) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function handleExportCsv() {
    if (dates.length === 0 || sourceSeries.length === 0) return
    const header = ["日期", ...sourceSeries.map((s) => s.name)]
    const lines = [
      header.join(","),
      ...dates.map((date, i) =>
        [date, ...sourceSeries.map((s) => (s.values[i] ?? 0).toFixed(4))].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_${exportLabel ?? title}_${fromDate ?? dates[0]}_${toDate ?? dates.at(-1)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const showChart = dates.length >= minPoints && sourceSeries.length > 0

  return (
    <div className="bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-50 gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-sm font-medium text-zinc-800 shrink-0">{title}</div>
          <Info className="h-3.5 w-3.5 text-zinc-300 shrink-0" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {showStrategySelect && (
            <select
              className="border border-zinc-200 rounded px-2 py-1 text-xs text-zinc-600 bg-white"
              defaultValue="团队策略"
            >
              <option value="团队策略">团队策略</option>
            </select>
          )}
          <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer">
            <input
              type="checkbox"
              checked={selectAll}
              onChange={(e) => {
                setSelectAll(e.target.checked)
                if (e.target.checked) setHidden(new Set())
              }}
              className="rounded border-zinc-300"
            />
            全选
          </label>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!showChart}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-40"
            title="导出"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 transition-colors"
            title="菜单"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading && (
        <div className="h-[420px] flex items-center justify-center text-sm text-zinc-400">
          加载{title}…
        </div>
      )}

      {!loading && !showChart && (
        <div className="h-[420px] flex items-center justify-center text-sm text-zinc-400 px-6 text-center">
          暂无{title}历史数据
        </div>
      )}

      {!loading && showChart && (
        <div className="px-2 pb-2">
          <ReactECharts
            option={option}
            style={{ height: 420 }}
            notMerge
            onEvents={{
              legendselectchanged: (params: { name: string; selected: Record<string, boolean> }) => {
                handleLegendToggle(params.name, params.selected[params.name])
              },
            }}
          />
        </div>
      )}
    </div>
  )
}
