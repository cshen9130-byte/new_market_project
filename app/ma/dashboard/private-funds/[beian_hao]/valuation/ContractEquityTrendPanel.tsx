"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Download, Info, Menu } from "lucide-react"
import type { ContractMvShareSeries } from "./ContractMvShareTrendPanel"
import { numericMax, numericMin } from "./chart-numeric-bounds"

export type ContractEquityTrendData = {
  dates: string[]
  speculation: ContractMvShareSeries[]
  hedging: ContractMvShareSeries[]
  has_data: boolean
  point_count: number
}

type Props = {
  data: ContractEquityTrendData | null
  displayName: string
  fromDate?: string
  toDate?: string
  loading?: boolean
}

const PALETTE = [
  "#e54d42", "#5b9bd5", "#ed7d31", "#14b8a6", "#8b5cf6", "#eab308",
  "#64748b", "#ec4899", "#22c55e", "#f97316", "#06b6d4", "#a855f7",
  "#84cc16", "#ef4444", "#3b82f6", "#d97706", "#10b981", "#6366f1",
  "#f43f5e", "#0ea5e9", "#f59e0b", "#059669", "#7c3aed", "#dc2626",
]

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`
}

function colorForIndex(index: number): string {
  return PALETTE[index % PALETTE.length]
}

function yAxisBounds(values: number[]): { min: number; max: number; interval: number } {
  if (values.length === 0) return { min: -60, max: 120, interval: 30 }
  const minVal = numericMin(values, 0)
  const maxVal = numericMax(values, 0)
  const span = Math.max(maxVal - minVal, 30)
  const interval = Math.max(30, Math.ceil(span / 4 / 30) * 30)
  const min = Math.floor(minVal / interval) * interval
  const max = Math.ceil(maxVal / interval) * interval
  return { min, max, interval }
}

export function ContractEquityTrendPanel({
  data,
  displayName,
  fromDate,
  toDate,
  loading,
}: Props) {
  const [positionMode, setPositionMode] = useState<"投机" | "套期">("投机")
  const [selectAll, setSelectAll] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const dates = data?.dates ?? []

  const sourceSeries = useMemo(
    () => (positionMode === "投机" ? data?.speculation : data?.hedging) ?? [],
    [data?.hedging, data?.speculation, positionMode],
  )

  useEffect(() => {
    setHidden(new Set())
    setSelectAll(true)
  }, [positionMode, data?.speculation, data?.hedging])

  const activeSeries = useMemo(
    () => sourceSeries.filter((s) => selectAll || !hidden.has(s.contract)),
    [hidden, selectAll, sourceSeries],
  )

  const allValues = useMemo(
    () => activeSeries.flatMap((s) => s.values),
    [activeSeries],
  )

  const option = useMemo(() => {
    if (dates.length < 2 || activeSeries.length === 0) return {}

    const { min, max, interval } = yAxisBounds(allValues)

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (params: Array<{ seriesName: string; value: number; axisValue: string; marker: string }>) => {
          if (!Array.isArray(params) || params.length === 0) return ""
          const rows = params
            .filter((p) => Math.abs(p.value) > 0.001)
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
          const lines = [`${params[0].axisValue}`]
          for (const p of rows.slice(0, 20)) {
            lines.push(`${p.marker}${p.seriesName}: ${fmtPct(p.value)}`)
          }
          if (rows.length > 20) lines.push(`…共 ${rows.length} 个品种`)
          return lines.join("<br/>")
        },
      },
      legend: {
        type: "scroll",
        top: 0,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { fontSize: 11, color: "#666" },
        data: sourceSeries.map((s) => s.contract),
        selected: Object.fromEntries(
          sourceSeries.map((s) => [s.contract, selectAll || !hidden.has(s.contract)]),
        ),
      },
      grid: { left: 56, right: 16, top: 56, bottom: 56 },
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
      series: activeSeries.map((s) => {
        const colorIndex = Math.max(0, sourceSeries.findIndex((x) => x.contract === s.contract))
        const color = colorForIndex(colorIndex)
        return {
          type: "line" as const,
          name: s.contract,
          showSymbol: false,
          smooth: false,
          lineStyle: { width: 1.5, color },
          itemStyle: { color },
          emphasis: { focus: "series" as const },
          data: s.values.map((v) => +v.toFixed(4)),
        }
      }),
    }
  }, [activeSeries, allValues, dates, hidden, selectAll, sourceSeries])

  function handleLegendToggle(contract: string, visible: boolean) {
    setSelectAll(false)
    setHidden((prev) => {
      const next = new Set(prev)
      if (visible) next.delete(contract)
      else next.add(contract)
      return next
    })
  }

  function handleExportCsv() {
    if (dates.length === 0 || sourceSeries.length === 0) return
    const header = ["日期", ...sourceSeries.map((s) => s.contract)]
    const lines = [
      header.join(","),
      ...dates.map((date, i) =>
        [date, ...sourceSeries.map((s) => (s.values[i] ?? 0).toFixed(4))].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_品种权益走势_${positionMode}_${fromDate ?? dates[0]}_${toDate ?? dates.at(-1)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const showChart = dates.length >= 2 && sourceSeries.length > 0

  return (
    <div className="bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-50 gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-sm font-medium text-zinc-800 shrink-0">品种权益走势</div>
          <Info className="h-3.5 w-3.5 text-zinc-300 shrink-0" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
          {(["投机", "套期"] as const).map((mode) => (
            <label key={mode} className="inline-flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer">
              <input
                type="checkbox"
                checked={positionMode === mode}
                onChange={() => setPositionMode(mode)}
                className="rounded border-zinc-300"
              />
              {mode}
            </label>
          ))}
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
        <div className="h-[460px] flex items-center justify-center text-sm text-zinc-400">
          加载品种权益走势…
        </div>
      )}

      {!loading && !showChart && (
        <div className="h-[460px] flex items-center justify-center text-sm text-zinc-400 px-6 text-center">
          暂无品种权益历史数据
        </div>
      )}

      {!loading && showChart && (
        <div className="px-2 pb-2">
          <ReactECharts
            option={option}
            style={{ height: 460 }}
            notMerge
            onEvents={{
              legendselectchanged: (params: { name: string; selected: Record<string, boolean> }) => {
                const visible = params.selected[params.name]
                handleLegendToggle(params.name, visible)
              },
            }}
          />
        </div>
      )}
    </div>
  )
}
