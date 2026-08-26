"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Download, Menu } from "lucide-react"
import { ChartCalcHelpButton } from "./ChartCalcHelpButton"

export type SectorWeightTrendSeries = {
  sector: string
  values: number[]
}

export type SectorWeightTrendData = {
  dates: string[]
  speculation: SectorWeightTrendSeries[]
  hedging: SectorWeightTrendSeries[]
  has_data: boolean
  point_count: number
}

type Props = {
  data: SectorWeightTrendData | null
  displayName: string
  fromDate?: string
  toDate?: string
  loading?: boolean
}

const SECTOR_ORDER = ["股指", "国债", "黑色", "有色", "能化", "农产"] as const

const SECTOR_COLORS: Record<string, string> = {
  股指: "#e54d42",
  国债: "#5b9bd5",
  黑色: "#ed7d31",
  有色: "#14b8a6",
  能化: "#b8a068",
  农产: "#8b5cf6",
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`
}

export function SectorWeightTrendPanel({
  data,
  displayName,
  fromDate,
  toDate,
  loading,
}: Props) {
  const [positionMode, setPositionMode] = useState<"投机" | "套期">("投机")

  const activeSeries = useMemo(() => {
    const source = positionMode === "投机" ? data?.speculation : data?.hedging
    if (!source?.length) return []
    return SECTOR_ORDER
      .map((sector) => source.find((s) => s.sector === sector))
      .filter((s): s is SectorWeightTrendSeries => Boolean(s))
      .filter((s) => s.values.some((v) => v > 0.001))
  }, [data?.hedging, data?.speculation, positionMode])

  const dates = data?.dates ?? []

  const option = useMemo(() => {
    if (dates.length < 2 || activeSeries.length === 0) return {}

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (params: Array<{ seriesName: string; value: number; axisValue: string }>) => {
          if (!Array.isArray(params) || params.length === 0) return ""
          const lines = [`${params[0].axisValue}`]
          for (const p of [...params].sort((a, b) => b.value - a.value)) {
            if (p.value > 0.001) lines.push(`${p.seriesName}: ${fmtPct(p.value)}`)
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
        data: activeSeries.map((s) => s.sector),
      },
      grid: { left: 56, right: 16, top: 48, bottom: 56 },
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        { type: "slider", height: 18, bottom: 8, borderColor: "transparent", fillerColor: "rgba(148,163,184,0.15)" },
      ],
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: dates,
        axisLabel: { fontSize: 10, color: "#888", rotate: 30 },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
      },
      yAxis: {
        type: "value",
        name: "板块权重(%)",
        min: 0,
        max: 100,
        nameTextStyle: { fontSize: 11, color: "#888" },
        axisLabel: {
          formatter: (v: number) => `${v}%`,
          fontSize: 11,
          color: "#888",
        },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: activeSeries.map((s) => {
        const color = SECTOR_COLORS[s.sector] ?? "#94a3b8"
        return {
          type: "line" as const,
          stack: "sector-weight",
          name: s.sector,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 0, color },
          areaStyle: { color, opacity: 0.9 },
          emphasis: { focus: "series" as const },
          data: s.values.map((v) => +v.toFixed(4)),
          itemStyle: { color },
        }
      }),
    }
  }, [activeSeries, dates])

  function handleExportCsv() {
    if (dates.length === 0 || activeSeries.length === 0) return
    const header = ["日期", ...activeSeries.map((s) => s.sector)]
    const lines = [
      header.join(","),
      ...dates.map((date, i) =>
        [date, ...activeSeries.map((s) => (s.values[i] ?? 0).toFixed(4))].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_板块持仓权重走势_${fromDate ?? dates[0]}_${toDate ?? dates.at(-1)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const showChart = dates.length >= 2 && activeSeries.length > 0

  return (
    <div className="bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-50">
        <div className="text-red-500 font-semibold text-sm">期货</div>
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
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-50">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-medium text-zinc-800">板块持仓权重走势</div>
          <ChartCalcHelpButton
            heading="板块持仓权重走势 · 计算说明"
            blocks={[
              {
                title: "投机",
                paragraphs: [
                  "每个估值日，把期货按板块（有色、黑色、能化、农产、股指、国债）加总 |多头市值| + |空头市值|，再除以当日全部板块合计，得到板块内结构权重。",
                ],
                formula: "权重 = 该板块多空市值绝对值合计 / 全部板块合计 × 100",
              },
              {
                title: "套期",
                paragraphs: [
                  "改用轧差市值绝对值 |净市值|，仍按板块占当日合计的比例。",
                ],
              },
            ]}
          />
        </div>
        <div className="flex items-center gap-1">
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
          加载板块持仓权重走势…
        </div>
      )}

      {!loading && !showChart && (
        <div className="h-[420px] flex items-center justify-center text-sm text-zinc-400 px-6 text-center">
          暂无期货板块持仓历史数据
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
