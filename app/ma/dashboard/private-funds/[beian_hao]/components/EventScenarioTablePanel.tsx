"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Download, List, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react"
import { RED, GREEN } from "./shared"
import type { BenchmarkPoint, NavRow } from "./shared"
import {
  buildEventScenarioRows,
  type CustomScenarioEvent,
  type ScenarioChartPoint,
} from "./scenarioMetrics"

const PAGE_SIZE = 10
const STORAGE_PREFIX = "pf-scenario-events:"

type SortKey = "interval" | "fundReturn" | "benchReturn"
type SortDir = "asc" | "desc"

function loadCustomEvents(storageKey: string): CustomScenarioEvent[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CustomScenarioEvent[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveCustomEvents(storageKey: string, events: CustomScenarioEvent[]) {
  localStorage.setItem(storageKey, JSON.stringify(events))
}

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

function EventManageModal({
  events,
  onClose,
  onSave,
}: {
  events: CustomScenarioEvent[]
  onClose: () => void
  onSave: (events: CustomScenarioEvent[]) => void
}) {
  const [draft, setDraft] = useState(events)
  const [name, setName] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const addEvent = () => {
    if (!name.trim() || !from || !to || from > to) return
    setDraft((prev) => [
      ...prev,
      { id: `custom-${Date.now()}`, name: name.trim(), from, to },
    ])
    setName("")
    setFrom("")
    setTo("")
  }

  const removeEvent = (id: string) => {
    setDraft((prev) => prev.filter((e) => e.id !== id))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-[520px] max-w-[95vw] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <span className="font-semibold text-zinc-900 text-sm">事件管理</span>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-700 transition-colors">×</button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="事件名称"
              className="border border-zinc-200 rounded px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-zinc-200 rounded px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border border-zinc-200 rounded px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={addEvent}
              className="self-start px-3 py-1.5 rounded border border-zinc-200 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              添加事件
            </button>
          </div>
          {draft.length > 0 ? (
            <div className="space-y-2">
              {draft.map((event) => (
                <div key={event.id} className="flex items-start justify-between gap-3 rounded border border-zinc-100 px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-zinc-800">{event.name}</div>
                    <div className="text-xs text-zinc-400 tabular-nums mt-0.5">{event.from} ~ {event.to}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEvent(event.id)}
                    className="text-xs text-red-500 hover:text-red-700 shrink-0"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-zinc-400">暂无自定义事件</div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded border border-zinc-200 text-sm text-zinc-600 hover:bg-zinc-50">
            取消
          </button>
          <button
            type="button"
            onClick={() => { onSave(draft); onClose() }}
            className="px-4 py-1.5 rounded bg-red-500 text-sm text-white hover:bg-red-600"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

export const EventScenarioTablePanel = memo(function EventScenarioTablePanel({
  productName,
  benchmarkLabel,
  hasBenchmark,
  rows,
  navType,
  benchmarkSeries,
  chartData,
  storageKey,
}: {
  productName: string
  benchmarkLabel: string
  hasBenchmark: boolean
  rows: NavRow[]
  navType: string
  benchmarkSeries: BenchmarkPoint[]
  chartData: ScenarioChartPoint[]
  storageKey: string
}) {
  const [customEvents, setCustomEvents] = useState<CustomScenarioEvent[]>([])
  const [manageOpen, setManageOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("interval")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [page, setPage] = useState(1)

  useEffect(() => {
    setCustomEvents(loadCustomEvents(storageKey))
  }, [storageKey])

  const tableRows = useMemo(
    () => buildEventScenarioRows({ navRows: rows, navType, benchmarkSeries, chartData, customEvents }),
    [rows, navType, benchmarkSeries, chartData, customEvents],
  )

  const sortedRows = useMemo(() => {
    const copy = [...tableRows]
    copy.sort((a, b) => {
      let cmp = 0
      if (sortKey === "interval") cmp = b.from.localeCompare(a.from)
      else if (sortKey === "fundReturn") cmp = (a.fundReturn ?? -Infinity) - (b.fundReturn ?? -Infinity)
      else cmp = (a.benchReturn ?? -Infinity) - (b.benchReturn ?? -Infinity)
      return sortDir === "asc" ? cmp : -cmp
    })
    return copy
  }, [tableRows, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const pageRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir(key === "interval" ? "desc" : "desc")
    }
  }

  const exportCsv = useCallback(() => {
    const headers = ["序号", "事件名称", "情景区间", `${productName}收益`]
    if (hasBenchmark) headers.push(`${benchmarkLabel}(基准)收益`)
    const lines = sortedRows.map((row, i) => {
      const line = [
        String(i + 1),
        row.name,
        `${row.from} ~ ${row.to}`,
        row.fundReturn !== null ? `${row.fundReturn.toFixed(2)}%` : "",
      ]
      if (hasBenchmark) line.push(row.benchReturn !== null ? `${row.benchReturn.toFixed(2)}%` : "")
      return line
    })
    const escape = (v: string) => v.includes(",") ? `"${v}"` : v
    const blob = new Blob(["\uFEFF" + [headers, ...lines].map((r) => r.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${productName}_事件情景表.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [sortedRows, productName, benchmarkLabel, hasBenchmark])

  const handleSaveEvents = (events: CustomScenarioEvent[]) => {
    setCustomEvents(events)
    saveCustomEvents(storageKey, events)
  }

  if (!tableRows.length) {
    return (
      <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5 min-h-[160px] flex items-center justify-center text-sm text-zinc-400">
        暂无事件情景数据
      </div>
    )
  }

  return (
    <>
      <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-end gap-3 mb-4 text-xs text-zinc-600">
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            <List className="h-3.5 w-3.5" />
            事件管理
          </button>
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
          <table className="w-full text-xs min-w-[760px] border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 w-12">序号</th>
                <th className="px-3 py-2.5 text-left font-medium text-zinc-500 min-w-[220px]">事件名称</th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                  <SortHeader label="情景区间" active={sortKey === "interval"} dir={sortDir} onClick={() => toggleSort("interval")} />
                </th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                  <SortHeader label={`${productName}收益`} active={sortKey === "fundReturn"} dir={sortDir} onClick={() => toggleSort("fundReturn")} />
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
                  <td className="px-3 py-2.5 text-zinc-800">{row.name}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-zinc-600 whitespace-nowrap">{row.from} ~ {row.to}</td>
                  <td className="px-3 py-2.5 text-center"><ReturnCell value={row.fundReturn} /></td>
                  {hasBenchmark && (
                    <td className="px-3 py-2.5 text-center"><ReturnCell value={row.benchReturn} /></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-end gap-3 text-xs text-zinc-500">
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

      {manageOpen && (
        <EventManageModal
          events={customEvents}
          onClose={() => setManageOpen(false)}
          onSave={handleSaveEvents}
        />
      )}
    </>
  )
})
EventScenarioTablePanel.displayName = "EventScenarioTablePanel"

export { STORAGE_PREFIX as EVENT_SCENARIO_STORAGE_PREFIX }
