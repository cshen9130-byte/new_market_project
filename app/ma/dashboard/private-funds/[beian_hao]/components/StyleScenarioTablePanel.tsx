"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Download, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react"
import { RED, GREEN } from "./shared"
import type { BenchmarkPoint, NavRow } from "./shared"
import {
  STYLE_SCENARIO_TABS,
  buildStyleScenarioTableRows,
  styleScenarioStyleColumnLabel,
  styleScenarioTableFootnote,
  type StyleScenarioTabKey,
} from "./scenarioMetrics"

const PAGE_SIZE = 10

type SortKey = "interval" | "fundReturn" | "styleReturn" | "benchReturn"
type SortDir = "asc" | "desc"

function ReturnCell({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-zinc-400">—</span>
  const color = value > 0 ? RED : value < 0 ? GREEN : undefined
  return (
    <span className="tabular-nums font-medium" style={color ? { color } : undefined}>
      {value > 0 ? "+" : ""}{value.toFixed(2)}%
    </span>
  )
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
      className="inline-flex items-center gap-0.5 hover:text-zinc-700 transition-colors"
    >
      {label}
      {active ? (
        dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronsUpDown className="h-3 w-3 text-zinc-300" />
      )}
    </button>
  )
}

export const StyleScenarioTablePanel = memo(function StyleScenarioTablePanel({
  productName,
  benchmarkLabel,
  hasBenchmark,
  rows,
  navType,
  styleSeries,
  benchmarkSeries,
  referenceSeries,
  activeTab,
}: {
  productName: string
  benchmarkLabel: string
  hasBenchmark: boolean
  rows: NavRow[]
  navType: string
  styleSeries: BenchmarkPoint[]
  benchmarkSeries: BenchmarkPoint[]
  referenceSeries: BenchmarkPoint[]
  activeTab: StyleScenarioTabKey
}) {
  const [sortKey, setSortKey] = useState<SortKey>("interval")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [activeTab])

  const tabConfig = STYLE_SCENARIO_TABS.find((t) => t.key === activeTab) ?? STYLE_SCENARIO_TABS[0]
  const styleColumnLabel = styleScenarioStyleColumnLabel(activeTab)

  const tableRows = useMemo(
    () => buildStyleScenarioTableRows({
      navRows: rows,
      navType,
      styleSeries,
      benchmarkSeries,
      tabKey: activeTab,
      largeCapSeries: referenceSeries,
    }),
    [rows, navType, styleSeries, benchmarkSeries, activeTab, referenceSeries],
  )

  const sortedRows = useMemo(() => {
    const copy = [...tableRows]
    copy.sort((a, b) => {
      let cmp = 0
      if (sortKey === "interval") cmp = b.from.localeCompare(a.from)
      else if (sortKey === "fundReturn") cmp = (a.fundReturn ?? -Infinity) - (b.fundReturn ?? -Infinity)
      else if (sortKey === "styleReturn") cmp = (a.styleReturn ?? -Infinity) - (b.styleReturn ?? -Infinity)
      else cmp = (a.benchReturn ?? -Infinity) - (b.benchReturn ?? -Infinity)
      return sortDir === "asc" ? cmp : -cmp
    })
    return copy
  }, [tableRows, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const pageRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const exportCsv = useCallback(() => {
    const headers = ["序号", styleColumnLabel, "情景区间", `${productName}收益`, `${tabConfig.indexLabel}收益`]
    if (hasBenchmark) headers.push(`${benchmarkLabel}(基准)收益`)
    const lines = sortedRows.map((row, i) => {
      const line = [
        String(i + 1),
        row.styleLabel,
        `${row.from} ~ ${row.to}`,
        row.fundReturn !== null ? `${row.fundReturn.toFixed(2)}%` : "",
        row.styleReturn !== null ? `${row.styleReturn.toFixed(2)}%` : "",
      ]
      if (hasBenchmark) line.push(row.benchReturn !== null ? `${row.benchReturn.toFixed(2)}%` : "")
      return line
    })
    const escape = (v: string) => v.includes(",") ? `"${v}"` : v
    const blob = new Blob(["\uFEFF" + [headers, ...lines].map((r) => r.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${productName}_风格情景表_${tabConfig.label}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [sortedRows, styleColumnLabel, productName, tabConfig, hasBenchmark, benchmarkLabel])

  if (!tableRows.length) {
    return (
      <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5 min-h-[120px] flex items-center justify-center text-sm text-zinc-400">
        暂无风格情景数据
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-center justify-end gap-3 mb-4 text-xs text-zinc-600">
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          导出
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-100">
        <table className="w-full text-xs min-w-[860px] border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              <th className="px-3 py-2.5 text-center font-medium text-zinc-500 w-12">序号</th>
              <th className="px-3 py-2.5 text-left font-medium text-zinc-500 min-w-[100px]">{styleColumnLabel}</th>
              <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                <SortHeader label="情景区间" active={sortKey === "interval"} dir={sortDir} onClick={() => toggleSort("interval")} />
              </th>
              <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                <SortHeader label={`${productName}收益`} active={sortKey === "fundReturn"} dir={sortDir} onClick={() => toggleSort("fundReturn")} />
              </th>
              <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                <SortHeader label={`${tabConfig.indexLabel}收益`} active={sortKey === "styleReturn"} dir={sortDir} onClick={() => toggleSort("styleReturn")} />
              </th>
              {hasBenchmark && (
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                  <SortHeader label={`${benchmarkLabel}(基准)收益`} active={sortKey === "benchReturn"} dir={sortDir} onClick={() => toggleSort("benchReturn")} />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={row.id} className="border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/50">
                <td className="px-3 py-2.5 text-center tabular-nums text-zinc-600">{(page - 1) * PAGE_SIZE + i + 1}</td>
                <td className="px-3 py-2.5 text-zinc-800">{row.styleLabel}</td>
                <td className="px-3 py-2.5 text-center tabular-nums text-zinc-600 whitespace-nowrap">{row.from} ~ {row.to}</td>
                <td className="px-3 py-2.5 text-center"><ReturnCell value={row.fundReturn} /></td>
                <td className="px-3 py-2.5 text-center"><ReturnCell value={row.styleReturn} /></td>
                {hasBenchmark && (
                  <td className="px-3 py-2.5 text-center"><ReturnCell value={row.benchReturn} /></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-zinc-400 leading-relaxed">{styleScenarioTableFootnote(activeTab)}</p>
        <div className="flex items-center gap-3 text-xs text-zinc-500 shrink-0">
          <span>{sortedRows.length} 条</span>
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2 py-1 rounded border border-zinc-200 disabled:opacity-40 hover:bg-zinc-50"
            >
              ‹
            </button>
            <span className="px-2 py-1 rounded border border-red-400 text-red-600 font-medium">{page}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2 py-1 rounded border border-zinc-200 disabled:opacity-40 hover:bg-zinc-50"
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
StyleScenarioTablePanel.displayName = "StyleScenarioTablePanel"
