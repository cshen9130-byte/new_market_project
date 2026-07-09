"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { ChevronDown, ChevronUp, Download, Menu } from "lucide-react"
import {
  PE_INDUSTRY_REGION_NOTE,
  type PeIndustryRegionRow,
} from "@/lib/pe-industry-data"

const PAGE_SIZE = 10

type SortKey = "managerCount" | "activeProductCount"
type SortDir = "asc" | "desc"

function buildDonutOption(
  regionDonut: Array<{ name: string; value: number; color: string }>,
): Record<string, unknown> {
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "item",
      formatter: "{b}: {c} ({d}%)",
    },
    legend: {
      orient: "vertical",
      left: 0,
      top: "middle",
      textStyle: { fontSize: 11, color: "#52525b" },
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 10,
    },
    series: [
      {
        type: "pie",
        radius: ["42%", "68%"],
        center: ["62%", "50%"],
        avoidLabelOverlap: true,
        label: {
          show: true,
          formatter: "{b}\n{c}",
          fontSize: 11,
          color: "#52525b",
        },
        labelLine: {
          length: 12,
          length2: 8,
        },
        data: regionDonut.map((item) => ({
          name: item.name,
          value: item.value,
          itemStyle: { color: item.color },
        })),
      },
    ],
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

function exportRegionCsv(rows: PeIndustryRegionRow[]) {
  const headers = ["序号", "办公地区", "管理人数量（家）", "运作中产品（只）"]
  const body = rows.map((row, index) => [
    String(index + 1),
    row.region,
    String(row.managerCount),
    String(row.activeProductCount),
  ])
  const escape = (v: string) => (v.includes(",") ? `"${v}"` : v)
  const blob = new Blob(
    ["\uFEFF" + [headers, ...body].map((r) => r.map(escape).join(",")).join("\n")],
    { type: "text/csv;charset=utf-8;" },
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "私募证券类管理人办公地区分布.csv"
  a.click()
  URL.revokeObjectURL(url)
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-0.5 w-full hover:text-zinc-700 transition-colors"
    >
      {label}
      <span className="inline-flex flex-col leading-none text-zinc-300">
        <ChevronUp className={["h-2.5 w-2.5", active && dir === "asc" ? "text-red-500" : ""].join(" ")} />
        <ChevronDown className={["h-2.5 w-2.5 -mt-0.5", active && dir === "desc" ? "text-red-500" : ""].join(" ")} />
      </span>
    </button>
  )
}

export function PeIndustryRegionSection({
  regionDonut,
  regionTable,
}: {
  regionDonut: Array<{ name: string; value: number; color: string }>
  regionTable: PeIndustryRegionRow[]
}) {
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>("managerCount")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const donutOption = useMemo(() => buildDonutOption(regionDonut), [regionDonut])

  const sortedRows = useMemo(() => {
    const rows = [...regionTable]
    rows.sort((a, b) => {
      const diff = a[sortKey] - b[sortKey]
      return sortDir === "asc" ? diff : -diff
    })
    return rows
  }, [regionTable, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const pagedRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-4">
          <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
          私募证券类管理人办公地区分布
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0">
            {regionDonut.length > 0 ? (
              <ReactECharts option={donutOption} style={{ height: 320, width: "100%" }} notMerge lazyUpdate />
            ) : (
              <div className="flex items-center justify-center h-[320px] text-sm text-zinc-400">暂无地区分布数据</div>
            )}
          </div>

          <div className="min-w-0 rounded border border-zinc-100 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-100 bg-zinc-50/50">
              <button
                type="button"
                className="inline-flex items-center justify-center h-7 w-7 rounded border border-zinc-200 text-zinc-500 hover:bg-white transition-colors"
                title="菜单"
              >
                <Menu className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => exportRegionCsv(sortedRows)}
                disabled={sortedRows.length === 0}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded border border-zinc-200 text-xs text-zinc-600 hover:bg-white transition-colors disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                导出
              </button>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500">
                    <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 w-12">序号</th>
                    <th className="px-3 py-2 text-left font-medium border-b border-zinc-100 min-w-[6rem]">办公地区</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[7rem]">
                      <SortHeader
                        label="管理人数量（家）"
                        active={sortKey === "managerCount"}
                        dir={sortDir}
                        onClick={() => toggleSort("managerCount")}
                      />
                    </th>
                    <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[7rem]">
                      <SortHeader
                        label="运作中产品（只）"
                        active={sortKey === "activeProductCount"}
                        dir={sortDir}
                        onClick={() => toggleSort("activeProductCount")}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row, index) => (
                    <tr key={row.region} className={index % 2 === 1 ? "bg-zinc-50/60" : "bg-white"}>
                      <td className="px-3 py-2 text-center tabular-nums text-zinc-500 border-b border-zinc-50">
                        {(page - 1) * PAGE_SIZE + index + 1}
                      </td>
                      <td className="px-3 py-2 text-left text-zinc-700 border-b border-zinc-50">{row.region}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-zinc-700 border-b border-zinc-50">
                        {row.managerCount.toLocaleString("zh-CN")}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-zinc-700 border-b border-zinc-50">
                        {row.activeProductCount.toLocaleString("zh-CN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-1 px-3 py-2 border-t border-zinc-100 text-xs">
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
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-3 text-xs text-zinc-500 leading-relaxed">
        <span className="font-medium text-zinc-600">说明：</span>
        {PE_INDUSTRY_REGION_NOTE}
      </div>
    </div>
  )
}
