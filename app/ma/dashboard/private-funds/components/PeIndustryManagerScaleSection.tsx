"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { ArrowDown, ArrowUp, ChevronDown, Download } from "lucide-react"
import {
  PE_INDUSTRY_MANAGER_SCALE_CHANGES,
  PE_INDUSTRY_SCALE_TREND,
  PE_INDUSTRY_SCALE_TREND_BUCKETS,
  type PeIndustryScaleTrendBucket,
} from "@/lib/pe-industry-data"

const TREND_COLORS = ["#1A73E8", "#D93025", "#FBBC04", "#9333ea", "#14b8a6", "#78716C"]
const PAGE_SIZE = 10

function buildScaleTrendOption(): Record<string, unknown> {
  const months = PE_INDUSTRY_SCALE_TREND.map((p) => p.month)
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      type: "scroll",
      top: 0,
      left: 0,
      right: 16,
      textStyle: { fontSize: 11, color: "#52525b" },
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 12,
    },
    grid: { left: 48, right: 16, top: 48, bottom: 32 },
    xAxis: {
      type: "category",
      data: months,
      axisLabel: {
        fontSize: 11,
        color: "#a1a1aa",
        interval: (index: number) => index % 6 === 0,
      },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      name: "数量(家)",
      nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
    },
    series: PE_INDUSTRY_SCALE_TREND_BUCKETS.map((bucket, index) => ({
      name: bucket,
      type: "line",
      smooth: true,
      symbol: "none",
      lineStyle: { width: 2 },
      itemStyle: { color: TREND_COLORS[index % TREND_COLORS.length] },
      data: PE_INDUSTRY_SCALE_TREND.map((p) => p.counts[bucket as PeIndustryScaleTrendBucket]),
    })),
  }
}

function pageButtons(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: Array<number | "…"> = [1]
  if (current > 3) pages.push("…")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p += 1) pages.push(p)
  if (current < total - 2) pages.push("…")
  pages.push(total)
  return pages
}

function exportChangesCsv(rows: typeof PE_INDUSTRY_MANAGER_SCALE_CHANGES.rows) {
  const headers = ["序号", "管理人名称", "登记编号", "成立日期", "变更前规模区间", "变更后规模区间", "变更方向"]
  const body = rows.map((row, index) => [
    String(index + 1),
    row.managerName,
    row.registrationNo,
    row.inceptionDate,
    row.scaleBefore,
    row.scaleAfter,
    row.direction === "up" ? "规模增加" : "规模减少",
  ])
  const escape = (v: string) => (v.includes(",") ? `"${v}"` : v)
  const blob = new Blob(
    ["\uFEFF" + [headers, ...body].map((r) => r.map(escape).join(",")).join("\n")],
    { type: "text/csv;charset=utf-8;" },
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "私募证券类管理人规模变动明细.csv"
  a.click()
  URL.revokeObjectURL(url)
}

export function PeIndustryManagerScaleSection() {
  const [page, setPage] = useState(1)
  const [updatedAt, setUpdatedAt] = useState(PE_INDUSTRY_MANAGER_SCALE_CHANGES.updatedAt)
  const trendOption = useMemo(() => buildScaleTrendOption(), [])

  const rows = PE_INDUSTRY_MANAGER_SCALE_CHANGES.rows
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pagedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-3">
          <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
          私募证券类管理人规模走势
        </div>
        <ReactECharts option={trendOption} style={{ height: 340, width: "100%" }} notMerge lazyUpdate />
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
            私募证券类管理人规模变动明细
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>更新日期</span>
              <div className="relative">
                <select
                  value={updatedAt}
                  onChange={(e) => setUpdatedAt(e.target.value)}
                  className="appearance-none h-7 pl-2.5 pr-7 rounded border border-zinc-200 bg-white text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-red-200"
                >
                  <option value="2026-06">2026-06</option>
                  <option value="2026-05">2026-05</option>
                  <option value="2026-04">2026-04</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
              </div>
            </div>
            <button
              type="button"
              onClick={() => exportChangesCsv(rows)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              导出
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-50 text-zinc-500">
                <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 w-12">序号</th>
                <th className="px-3 py-2 text-left font-medium border-b border-zinc-100 min-w-[8rem]">管理人名称</th>
                <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[6.5rem]">登记编号</th>
                <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[6.5rem]">成立日期</th>
                <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[7rem]">变更前规模区间</th>
                <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[7rem]">变更后规模区间</th>
                <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[6.5rem]">变更方向</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, index) => (
                <tr key={row.registrationNo} className={index % 2 === 1 ? "bg-zinc-50/60" : "bg-white"}>
                  <td className="px-3 py-2 text-center tabular-nums text-zinc-500 border-b border-zinc-50">
                    {(page - 1) * PAGE_SIZE + index + 1}
                  </td>
                  <td className="px-3 py-2 text-left border-b border-zinc-50">
                    <button type="button" className="text-blue-600 hover:underline">
                      {row.managerName}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-zinc-700 border-b border-zinc-50">{row.registrationNo}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-zinc-700 border-b border-zinc-50">{row.inceptionDate}</td>
                  <td className="px-3 py-2 text-center text-zinc-700 border-b border-zinc-50">{row.scaleBefore}</td>
                  <td className="px-3 py-2 text-center text-zinc-700 border-b border-zinc-50">{row.scaleAfter}</td>
                  <td className="px-3 py-2 text-center border-b border-zinc-50">
                    <span className={[
                      "inline-flex items-center gap-0.5",
                      row.direction === "up" ? "text-red-500" : "text-green-600",
                    ].join(" ")}>
                      {row.direction === "up" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )}
                      {row.direction === "up" ? "规模增加" : "规模减少"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-1 px-4 py-3 border-t border-zinc-100 text-xs">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="min-w-[28px] h-7 px-2 border border-zinc-200 rounded disabled:opacity-40 hover:bg-zinc-50 transition-colors"
          >
            ‹
          </button>
          {pageButtons(page, totalPages).map((btn, index) =>
            btn === "…" ? (
              <span key={`ellipsis-${index}`} className="px-1 text-zinc-400">…</span>
            ) : (
              <button
                key={btn}
                type="button"
                onClick={() => setPage(btn)}
                className={[
                  "min-w-[28px] h-7 px-2 border rounded transition-colors",
                  page === btn ? "bg-red-500 text-white border-red-500" : "border-zinc-200 hover:bg-zinc-50",
                ].join(" ")}
              >
                {btn}
              </button>
            ),
          )}
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="min-w-[28px] h-7 px-2 border border-zinc-200 rounded disabled:opacity-40 hover:bg-zinc-50 transition-colors"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  )
}
