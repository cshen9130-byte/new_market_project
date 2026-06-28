"use client"

import { useMemo, useState, useEffect } from "react"
import { ChevronDown, Download } from "lucide-react"
import type { ReturnCurveSeries } from "./FofReturnCurvePanel"
import type { FundHoldingRow } from "./FofFundsPanel"

type Props = {
  series: ReturnCurveSeries[]
  fundHoldings: FundHoldingRow[]
  displayName: string
  fromDate?: string
  toDate?: string
  loading?: boolean
}

type MetricMode = "nav" | "pct"

const PAGE_SIZE = 10

function slicePoints(
  points: ReturnCurveSeries["points"],
  fromDate?: string,
  toDate?: string,
) {
  let sliced = points
  if (fromDate) sliced = sliced.filter((p) => p.date >= fromDate.slice(0, 10))
  if (toDate) sliced = sliced.filter((p) => p.date <= toDate.slice(0, 10))
  return sliced
}

function normalizeDisplayName(fundName: string): string {
  return fundName
    .replace(/私募证券投资基金/g, "")
    .replace(/私募基金/g, "")
    .trim() || fundName
}

function buildTableData(
  columns: string[],
  seriesByColumn: Map<string, ReturnCurveSeries>,
  fromDate: string | undefined,
  toDate: string | undefined,
  mode: MetricMode,
) {
  const dateSet = new Set<string>()
  const byFund = new Map<string, Map<string, number | null>>()

  for (const col of columns) {
    const s = seriesByColumn.get(col)
    const points = s ? slicePoints(s.points, fromDate, toDate) : []
    const map = new Map<string, number | null>()
    if (mode === "nav") {
      for (const p of points) {
        map.set(p.date, p.nav)
        dateSet.add(p.date)
      }
    } else {
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1].nav
        const curr = points[i].nav
        const pct = prev > 0 && Number.isFinite(curr) ? ((curr / prev) - 1) * 100 : null
        map.set(points[i].date, pct)
        dateSet.add(points[i].date)
      }
    }
    byFund.set(col, map)
  }

  const dates = [...dateSet].sort((a, b) => b.localeCompare(a))
  const rows = dates.map((date) => ({
    date,
    values: Object.fromEntries(
      columns.map((col) => [col, byFund.get(col)?.get(date) ?? null]),
    ) as Record<string, number | null>,
  }))

  return { columns, rows }
}

function PctCell({ value, mode }: { value: number | null; mode: MetricMode }) {
  if (value == null) return <span className="text-zinc-400">—</span>
  if (mode === "nav") {
    return <span className="tabular-nums text-zinc-800">{value.toFixed(4)}</span>
  }
  const cls = value > 0 ? "text-red-500" : value < 0 ? "text-emerald-600" : "text-zinc-600"
  return (
    <span className={`tabular-nums ${cls}`}>
      {value > 0 ? "+" : ""}{value.toFixed(2)}%
    </span>
  )
}

function PageButtons({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (p: number) => void
}) {
  if (totalPages <= 1) return null
  const pages: number[] = []
  for (let i = 1; i <= Math.min(totalPages, 5); i++) pages.push(i)

  return (
    <div className="flex items-center justify-end gap-1 px-4 py-3 text-xs">
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPage(p)}
          className={[
            "min-w-[28px] h-7 rounded border transition-colors",
            p === page
              ? "bg-red-500 text-white border-red-500"
              : "border-zinc-200 text-zinc-600 hover:bg-zinc-50",
          ].join(" ")}
        >
          {p}
        </button>
      ))}
      {totalPages > 5 && (
        <>
          <span className="text-zinc-400 px-1">…</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPage(Math.min(page + 1, totalPages))}
            className="min-w-[28px] h-7 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
          >
            ›
          </button>
        </>
      )}
    </div>
  )
}

export function FofReturnAnalysisPanel({
  series,
  fundHoldings,
  displayName,
  fromDate,
  toDate,
  loading,
}: Props) {
  const [metricMode, setMetricMode] = useState<MetricMode>("pct")
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [fromDate, toDate, series, fundHoldings])

  const columns = useMemo(
    () => (fundHoldings.length > 0
      ? fundHoldings.map((h) => normalizeDisplayName(h.fundName))
      : series.map((s) => s.displayName)),
    [fundHoldings, series],
  )

  const seriesByColumn = useMemo(() => {
    const map = new Map<string, ReturnCurveSeries>()
    for (const s of series) {
      map.set(s.displayName, s)
      map.set(normalizeDisplayName(s.fundName), s)
      map.set(s.fundName, s)
    }
    return map
  }, [series])

  const { rows } = useMemo(
    () => buildTableData(columns, seriesByColumn, fromDate, toDate, metricMode),
    [columns, seriesByColumn, fromDate, toDate, metricMode],
  )

  const hasAnyData = useMemo(
    () => columns.some((col) => {
      const s = seriesByColumn.get(col)
      return s != null && slicePoints(s.points, fromDate, toDate).length >= 1
    }),
    [columns, seriesByColumn, fromDate, toDate],
  )

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleExport() {
    if (!rows.length) return
    const headers = ["日期", ...columns]
    const lines = [
      headers.join(","),
      ...rows.map((row) =>
        [row.date, ...columns.map((col) => {
          const v = row.values[col]
          if (v == null) return ""
          return metricMode === "nav" ? v.toFixed(4) : v.toFixed(4)
        })].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_基金收益_${fromDate ?? "export"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-2">
        <div className="text-red-500 font-semibold text-sm">基金收益</div>
        <div className="text-xs text-zinc-500 mt-0.5">基金表现</div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 px-4 pb-3">
        <div className="relative">
          <select
            value={metricMode}
            onChange={(e) => {
              setMetricMode(e.target.value as MetricMode)
              setPage(1)
            }}
            className="h-7 min-w-[5rem] appearance-none rounded border border-zinc-200 bg-white pl-2 pr-6 text-xs text-zinc-600 focus:outline-none focus:border-red-300"
          >
            <option value="pct">涨跌幅</option>
            <option value="nav">费后复权净值</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
        </div>
        <div className="relative">
          <select
            defaultValue="daily"
            className="h-7 min-w-[4.5rem] appearance-none rounded border border-zinc-200 bg-white pl-2 pr-6 text-xs text-zinc-600 focus:outline-none"
          >
            <option value="daily">净值日</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!rows.length}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-red-500 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-40"
        >
          <Download className="h-3 w-3" />
          导出
        </button>
      </div>

      <div className="overflow-x-auto border-t border-zinc-100">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50">
              <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap sticky left-0 bg-zinc-50 z-10">
                日期
              </th>
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2.5 text-right font-semibold text-zinc-500 whitespace-nowrap min-w-[100px]"
                  title={col}
                >
                  <span className="block truncate max-w-[140px]">{col}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-12 text-center text-sm text-zinc-400">
                  加载基金收益数据…
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(columns.length + 1, 2)} className="px-4 py-12 text-center text-sm text-zinc-400">
                  {!hasAnyData ? "暂无底层基金净值数据" : "所选区间暂无收益数据"}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.date} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                  <td className="px-3 py-2 tabular-nums text-zinc-700 whitespace-nowrap sticky left-0 bg-white z-10">
                    {row.date}
                  </td>
                  {columns.map((col) => (
                    <td key={col} className="px-3 py-2 text-right whitespace-nowrap">
                      <PctCell value={row.values[col] ?? null} mode={metricMode} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PageButtons page={page} totalPages={totalPages} onPage={setPage} />
    </div>
  )
}
