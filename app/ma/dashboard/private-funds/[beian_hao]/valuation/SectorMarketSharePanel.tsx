"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Download, Menu } from "lucide-react"
import { ChartCalcHelpButton } from "./ChartCalcHelpButton"

export type DerivativeSectorShareRow = {
  sector: string
  longMarketValue: number
  longMarketPct: number
  shortMarketValue: number
  shortMarketPct: number
  netMarketValue: number
}

type SortKey =
  | "longMarketValue"
  | "longMarketPct"
  | "shortMarketValue"
  | "shortMarketPct"
  | "netMarketValue"

type Props = {
  rows: DerivativeSectorShareRow[]
  displayName: string
  valuationDate: string | null
}

const CHART_SECTORS = ["全部", "有色", "黑色", "能化", "农产", "股指", "国债"] as const
const VISIBLE_ROWS = 10
const ROW_HEIGHT_PX = 42

function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  return `${n.toFixed(4)}%`
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className = "",
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey | null
  dir: "asc" | "desc"
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = activeKey === sortKey
  return (
    <th className={`px-3 py-2.5 font-semibold text-zinc-500 ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-0.5 hover:text-zinc-700"
      >
        {label}
        <span className="text-[10px] text-zinc-300">{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  )
}

export function SectorMarketSharePanel({ rows, displayName, valuationDate }: Props) {
  const [positionMode, setPositionMode] = useState<"投机" | "套期">("投机")
  const [category, setCategory] = useState<(typeof CHART_SECTORS)[number]>("全部")
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const chartRows = useMemo(() => {
    if (category === "全部") return rows
    return rows.filter((r) => r.sector === category)
  }, [rows, category])

  const tableRows = useMemo(() => {
    let list = [...rows]
    if (sortKey) {
      list.sort((a, b) => {
        const av = a[sortKey]
        const bv = b[sortKey]
        return sortDir === "asc" ? av - bv : bv - av
      })
    }
    return list
  }, [rows, sortKey, sortDir])

  const chartOption = useMemo(() => {
    const sectors = chartRows.map((r) => r.sector)
    const longPcts = chartRows.map((r) => +r.longMarketPct.toFixed(4))
    const shortPcts = chartRows.map((r) => +r.shortMarketPct.toFixed(4))
    const maxPct = Math.max(...longPcts, ...shortPcts, 30)
    const yMax = Math.ceil(maxPct / 30) * 30

    return {
      color: ["#e54d42", "#5b9bd5"],
      grid: { top: 48, right: 16, bottom: 36, left: 52 },
      legend: {
        data: ["多头", "空头"],
        top: 8,
        right: 80,
        itemWidth: 12,
        itemHeight: 12,
        textStyle: { fontSize: 12, color: "#666" },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: Array<{ seriesName: string; name: string; value: number }>) => {
          const lines = params.map((p) => `${p.seriesName}: ${p.value.toFixed(4)}%`)
          return [`${params[0]?.name ?? ""}`, ...lines].join("<br/>")
        },
      },
      xAxis: {
        type: "category",
        data: sectors,
        axisLabel: { fontSize: 11, color: "#666" },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
      },
      yAxis: {
        type: "value",
        name: "市值占比(%)",
        nameTextStyle: { fontSize: 11, color: "#999" },
        max: yMax,
        interval: 30,
        axisLabel: { formatter: "{value}%", fontSize: 11, color: "#999" },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: [
        {
          name: "多头",
          type: "bar",
          barGap: "20%",
          barMaxWidth: 28,
          data: longPcts,
          itemStyle: { color: "#e54d42" },
        },
        {
          name: "空头",
          type: "bar",
          barMaxWidth: 28,
          data: shortPcts,
          itemStyle: { color: "#5b9bd5" },
        },
      ],
    }
  }, [chartRows])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  function handleExport() {
    if (!tableRows.length) return
    const lines = [
      ["板块", "多头市值(元)", "多头市值占比", "空头市值(元)", "空头市值占比", "轧差市值(元)"].join(","),
      ...tableRows.map((r) =>
        [
          r.sector,
          r.longMarketValue.toFixed(2),
          r.longMarketPct.toFixed(4),
          r.shortMarketValue.toFixed(2),
          r.shortMarketPct.toFixed(4),
          r.netMarketValue.toFixed(2),
        ].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_期货板块市值占比_${valuationDate?.slice(0, 10) ?? "export"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (rows.length === 0) return null

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-2">
        <div className="flex items-center gap-1">
          <div className="text-red-500 font-semibold text-sm">期货板块市值占比</div>
          <ChartCalcHelpButton
            heading="期货板块市值占比 · 计算说明"
            blocks={[
              {
                title: "多头 / 空头柱",
                paragraphs: [
                  "把期货合约按板块加总。多头市值占比、空头市值占比都是相对资产净值。「投机」用全部合约，「套期」只保留股指、国债。",
                ],
                formula: "多头% = 该板块多头市值 / 净值 × 100\n空头% = 该板块空头市值 / 净值 × 100\n轧差市值 = 多头市值 − 空头市值",
              },
            ]}
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1 px-2 py-1 text-zinc-500 hover:text-zinc-700"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
          <div className="inline-flex rounded border border-red-400 overflow-hidden">
            {(["投机", "套期"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPositionMode(mode)}
                className={[
                  "px-3 py-1 transition-colors",
                  positionMode === mode
                    ? "bg-red-500 text-white"
                    : "bg-white text-red-500 hover:bg-red-50",
                ].join(" ")}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x divide-zinc-100">
        {/* Chart */}
        <div className="p-4 relative">
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as (typeof CHART_SECTORS)[number])}
              className="border border-zinc-200 rounded px-2 py-1 text-xs bg-white text-zinc-600 focus:outline-none"
            >
              {CHART_SECTORS.map((c) => (
                <option key={c} value={c}>
                  类别: {c}
                </option>
              ))}
            </select>
            <button type="button" className="p-1 text-zinc-400 hover:text-zinc-600" title="更多">
              <Menu className="h-4 w-4" />
            </button>
          </div>
          <ReactECharts option={chartOption} style={{ height: 320 }} notMerge />
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <div
            className="overflow-y-auto"
            style={{ maxHeight: tableRows.length > VISIBLE_ROWS ? ROW_HEIGHT_PX * VISIBLE_ROWS + 40 : undefined }}
          >
            <table className="w-full text-sm min-w-[640px]">
              <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[0_1px_0_0_rgb(244_244_245)]">
                <tr className="border-b border-zinc-100 text-xs">
                  <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-16">板块</th>
                  <SortHeader label="多头市值(元)" sortKey="longMarketValue" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                  <SortHeader label="多头市值占比" sortKey="longMarketPct" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                  <SortHeader label="空头市值(元)" sortKey="shortMarketValue" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                  <SortHeader label="空头市值占比" sortKey="shortMarketPct" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                  <SortHeader label="轧差市值(元)" sortKey="netMarketValue" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr
                    key={row.sector}
                    className={`border-b border-zinc-50 hover:bg-zinc-50/50 ${i % 2 === 1 ? "bg-zinc-50/30" : ""}`}
                    style={{ height: ROW_HEIGHT_PX }}
                  >
                    <td className="px-3 py-2.5 text-zinc-800">{row.sector}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtMoney(row.longMarketValue)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{fmtPct(row.longMarketPct)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtMoney(row.shortMarketValue)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{fmtPct(row.shortMarketPct)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${
                      row.netMarketValue >= 0 ? "text-zinc-800" : "text-emerald-600"
                    }`}>
                      {fmtMoney(row.netMarketValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
