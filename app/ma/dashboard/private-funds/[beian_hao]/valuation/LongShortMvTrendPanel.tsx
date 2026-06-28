"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Download, Info, Menu } from "lucide-react"
import { numericMax, numericMin } from "./chart-numeric-bounds"

export type LongShortMvTrendPoint = {
  longPct: number
  shortPct: number
  netPct: number
}

export type LongShortMvTrendData = {
  dates: string[]
  speculation: LongShortMvTrendPoint[]
  hedging: LongShortMvTrendPoint[]
  has_data: boolean
  point_count: number
}

type Props = {
  data: LongShortMvTrendData | null
  displayName: string
  fromDate?: string
  toDate?: string
  loading?: boolean
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`
}

function yAxisBounds(values: number[]): { min: number; max: number; interval: number } {
  if (values.length === 0) return { min: -100, max: 100, interval: 50 }
  const minVal = numericMin(values, 0)
  const maxVal = numericMax(values, 0)
  const span = Math.max(maxVal - minVal, 40)
  const interval = Math.max(50, Math.ceil(span / 4 / 50) * 50)
  const min = Math.floor(minVal / interval) * interval
  const max = Math.ceil(maxVal / interval) * interval
  return { min, max, interval }
}

export function LongShortMvTrendPanel({
  data,
  displayName,
  fromDate,
  toDate,
  loading,
}: Props) {
  const [positionMode, setPositionMode] = useState<"投机" | "套期">("投机")

  const dates = data?.dates ?? []
  const points = useMemo(
    () => (positionMode === "投机" ? data?.speculation : data?.hedging) ?? [],
    [data?.hedging, data?.speculation, positionMode],
  )

  const option = useMemo(() => {
    if (dates.length < 2 || points.length === 0) return {}

    const longData = points.map((p) => +p.longPct.toFixed(4))
    const shortData = points.map((p) => +p.shortPct.toFixed(4))
    const netData = points.map((p) => +p.netPct.toFixed(4))
    const { min, max, interval } = yAxisBounds([...longData, ...shortData, ...netData])

    return {
      color: ["#5b9bd5", "#e54d42", "#ed7d31"],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (params: Array<{ seriesName: string; value: number; axisValue: string }>) => {
          if (!Array.isArray(params) || params.length === 0) return ""
          const lines = [`${params[0].axisValue}`]
          for (const p of params) {
            const display = p.seriesName === "空头" ? Math.abs(p.value) : p.value
            lines.push(`${p.seriesName}: ${fmtPct(display)}`)
          }
          return lines.join("<br/>")
        },
      },
      legend: {
        data: ["多头", "空头", "差额"],
        top: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 12, color: "#666" },
      },
      grid: { left: 56, right: 16, top: 48, bottom: 56 },
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        { type: "slider", height: 18, bottom: 8, borderColor: "transparent", fillerColor: "rgba(148,163,184,0.15)" },
      ],
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { fontSize: 10, color: "#888", rotate: 30 },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
      },
      yAxis: {
        type: "value",
        name: "市值占比(%)",
        min,
        max,
        interval,
        nameTextStyle: { fontSize: 11, color: "#888" },
        axisLabel: {
          formatter: (v: number) => `${v}%`,
          fontSize: 11,
          color: "#888",
        },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: [
        {
          name: "多头",
          type: "bar" as const,
          barMaxWidth: 14,
          data: longData,
          itemStyle: { color: "#5b9bd5" },
        },
        {
          name: "空头",
          type: "bar" as const,
          barMaxWidth: 14,
          data: shortData,
          itemStyle: { color: "#e54d42" },
        },
        {
          name: "差额",
          type: "line" as const,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: "#ed7d31" },
          itemStyle: { color: "#ed7d31" },
          data: netData,
          z: 3,
        },
      ],
    }
  }, [dates, points])

  function handleExportCsv() {
    if (dates.length === 0 || points.length === 0) return
    const lines = [
      ["日期", "多头市值占比", "空头市值占比", "差额"].join(","),
      ...dates.map((date, i) =>
        [
          date,
          points[i]?.longPct.toFixed(4) ?? "0",
          Math.abs(points[i]?.shortPct ?? 0).toFixed(4),
          points[i]?.netPct.toFixed(4) ?? "0",
        ].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_多空市值占比走势_${fromDate ?? dates[0]}_${toDate ?? dates.at(-1)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const showChart = dates.length >= 2 && points.some((p) => p.longPct > 0 || p.shortPct < 0)

  return (
    <div className="bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-50">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-medium text-zinc-800">多空市值占比走势</div>
          <Info className="h-3.5 w-3.5 text-zinc-300" />
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded border border-zinc-200 overflow-hidden text-xs">
            {(["投机", "套期"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPositionMode(mode)}
                className={[
                  "px-3 py-1 transition-colors",
                  positionMode === mode
                    ? "bg-red-50 text-red-500 border-red-400 font-medium"
                    : "text-zinc-600 hover:bg-zinc-50",
                  mode === "套期" ? "border-l border-zinc-200" : "",
                ].join(" ")}
              >
                {mode}
              </button>
            ))}
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
          加载多空市值占比走势…
        </div>
      )}

      {!loading && !showChart && (
        <div className="h-[420px] flex items-center justify-center text-sm text-zinc-400 px-6 text-center">
          暂无多空市值占比历史数据
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
