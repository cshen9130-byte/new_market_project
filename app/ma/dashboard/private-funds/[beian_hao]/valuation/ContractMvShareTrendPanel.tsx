"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Download, Info, Menu } from "lucide-react"
import { numericMax } from "./chart-numeric-bounds"

export type ContractMvShareSeries = {
  contract: string
  sector: string
  values: number[]
}

export type ContractMvShareTrendData = {
  dates: string[]
  series: ContractMvShareSeries[]
  has_data: boolean
  point_count: number
}

type Props = {
  data: ContractMvShareTrendData | null
  displayName: string
  fromDate?: string
  toDate?: string
  loading?: boolean
}

const INDEX_SECTORS = new Set(["股指", "国债"])

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

function yAxisBounds(totals: number[]): { max: number; interval: number } {
  const maxVal = numericMax(totals, 0)
  if (maxVal <= 0) return { max: 100, interval: 20 }
  const interval = Math.max(50, Math.ceil(maxVal / 5 / 50) * 50)
  const max = Math.ceil(maxVal / interval) * interval
  return { max, interval }
}

export function ContractMvShareTrendPanel({
  data,
  displayName,
  fromDate,
  toDate,
  loading,
}: Props) {
  const [scope, setScope] = useState<"全期" | "指数">("全期")
  const [selectAll, setSelectAll] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const dates = data?.dates ?? []

  const filteredSeries = useMemo(() => {
    const source = data?.series ?? []
    if (scope === "指数") {
      return source.filter((s) => INDEX_SECTORS.has(s.sector))
    }
    return source
  }, [data?.series, scope])

  useEffect(() => {
    setHidden(new Set())
    setSelectAll(true)
  }, [scope, data?.series])

  const activeSeries = useMemo(
    () => filteredSeries.filter((s) => selectAll || !hidden.has(s.contract)),
    [filteredSeries, hidden, selectAll],
  )

  const stackTotals = useMemo(() => {
    if (dates.length === 0) return []
    return dates.map((_, i) =>
      activeSeries.reduce((sum, s) => sum + (s.values[i] ?? 0), 0),
    )
  }, [activeSeries, dates])

  const option = useMemo(() => {
    if (dates.length < 2 || activeSeries.length === 0) return {}

    const { max, interval } = yAxisBounds(stackTotals)

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: Array<{ seriesName: string; value: number; axisValue: string; marker: string }>) => {
          if (!Array.isArray(params) || params.length === 0) return ""
          const rows = params
            .filter((p) => p.value > 0.001)
            .sort((a, b) => b.value - a.value)
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
        data: filteredSeries.map((s) => s.contract),
        selected: Object.fromEntries(
          filteredSeries.map((s) => [s.contract, selectAll || !hidden.has(s.contract)]),
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
        min: 0,
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
        const colorIndex = Math.max(0, filteredSeries.findIndex((x) => x.contract === s.contract))
        const color = colorForIndex(colorIndex)
        return {
          type: "bar" as const,
          stack: "contract-mv",
          name: s.contract,
          barMaxWidth: 18,
          emphasis: { focus: "series" as const },
          data: s.values.map((v) => +v.toFixed(4)),
          itemStyle: { color },
        }
      }),
    }
  }, [activeSeries, dates, filteredSeries, hidden, selectAll, stackTotals])

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
    if (dates.length === 0 || filteredSeries.length === 0) return
    const header = ["日期", ...filteredSeries.map((s) => s.contract)]
    const lines = [
      header.join(","),
      ...dates.map((date, i) =>
        [date, ...filteredSeries.map((s) => (s.values[i] ?? 0).toFixed(4))].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_品种市值占比_${fromDate ?? dates[0]}_${toDate ?? dates.at(-1)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const showChart = dates.length >= 2 && filteredSeries.length > 0

  return (
    <div className="bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-50 gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-sm font-medium text-zinc-800 shrink-0">品种市值占比</div>
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
          <div className="inline-flex rounded border border-zinc-200 overflow-hidden text-xs">
            {(["指数", "全期"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setScope(mode)}
                className={[
                  "px-3 py-1 transition-colors",
                  scope === mode
                    ? "bg-red-50 text-red-500 border-red-400 font-medium"
                    : "text-zinc-600 hover:bg-zinc-50",
                  mode === "全期" ? "border-l border-zinc-200" : "",
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
        <div className="h-[460px] flex items-center justify-center text-sm text-zinc-400">
          加载品种市值占比…
        </div>
      )}

      {!loading && !showChart && (
        <div className="h-[460px] flex items-center justify-center text-sm text-zinc-400 px-6 text-center">
          暂无品种市值占比历史数据
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
