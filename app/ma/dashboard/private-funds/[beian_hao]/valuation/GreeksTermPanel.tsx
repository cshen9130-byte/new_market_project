"use client"

import { useMemo, useState, type ReactNode } from "react"
import { HelpCircle } from "lucide-react"

export type GreekLetterRow = {
  index: number
  variety: string
  delta: number | null
  gamma: number | null
  vega: number | null
  theta: number | null
  rho: number | null
}

export type TermAnalysisRow = {
  index: number
  variety: string
  expiryDate: string | null
  remainingDays: number | null
  multiplier: number | null
  currencyPositionPct: number | null
  marketPct: number | null
}

const VISIBLE_ROWS = 10
const ROW_HEIGHT_PX = 42

type GreekSortKey = "delta" | "gamma" | "vega" | "theta" | "rho"
type TermSortKey = "remainingDays" | "multiplier" | "currencyPositionPct" | "marketPct"

function fmtGreek(n: number | null): string {
  if (n == null) return "—"
  if (Math.abs(n) >= 100 || Number.isInteger(n)) {
    return n.toLocaleString("zh-CN", { maximumFractionDigits: 0 })
  }
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function fmtPct(n: number | null): string {
  if (n == null) return "—"
  return `${n.toFixed(2)}%`
}

function fmtQty(n: number | null): string {
  if (n == null) return "—"
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 0 })
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className = "",
  extra,
}: {
  label: string
  sortKey: string
  activeKey: string | null
  dir: "asc" | "desc"
  onSort: (key: string) => void
  className?: string
  extra?: ReactNode
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
        {extra}
        <span className="text-[10px] text-zinc-300">{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  )
}

function ScrollTable({
  children,
  rowCount,
  minWidth,
}: {
  children: ReactNode
  rowCount: number
  minWidth: string
}) {
  return (
    <div className="overflow-x-auto">
      <div
        className="overflow-y-auto"
        style={{ maxHeight: rowCount > VISIBLE_ROWS ? ROW_HEIGHT_PX * VISIBLE_ROWS + 40 : undefined }}
      >
        <table className={`w-full text-sm ${minWidth}`}>{children}</table>
      </div>
    </div>
  )
}

export function GreeksPanel({ greekLetters }: { greekLetters: GreekLetterRow[] }) {
  const [greekSortKey, setGreekSortKey] = useState<GreekSortKey | null>(null)
  const [greekSortDir, setGreekSortDir] = useState<"asc" | "desc">("desc")

  const sortedGreeks = useMemo(() => {
    let rows = [...greekLetters]
    if (greekSortKey) {
      rows.sort((a, b) => {
        const av = a[greekSortKey] ?? 0
        const bv = b[greekSortKey] ?? 0
        return greekSortDir === "asc" ? av - bv : bv - av
      })
    }
    return rows.map((r, i) => ({ ...r, index: i + 1 }))
  }, [greekLetters, greekSortKey, greekSortDir])

  function handleSort(key: GreekSortKey) {
    if (greekSortKey === key) setGreekSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setGreekSortKey(key)
      setGreekSortDir("desc")
    }
  }

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex items-center gap-1.5">
        <span className="text-red-500 font-semibold text-sm">希腊字母</span>
        <HelpCircle className="h-3.5 w-3.5 text-zinc-300" />
      </div>
      <ScrollTable rowCount={sortedGreeks.length} minWidth="min-w-[720px]">
        <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[0_1px_0_0_rgb(244_244_245)]">
          <tr className="border-y border-zinc-100 text-xs">
            <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-12">序号</th>
            <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[120px]">品种</th>
            <SortHeader label="Delta" sortKey="delta" activeKey={greekSortKey} dir={greekSortDir} onSort={handleSort} className="text-right" />
            <SortHeader label="Gamma" sortKey="gamma" activeKey={greekSortKey} dir={greekSortDir} onSort={handleSort} className="text-right" />
            <SortHeader label="Vega" sortKey="vega" activeKey={greekSortKey} dir={greekSortDir} onSort={handleSort} className="text-right" />
            <SortHeader label="Theta" sortKey="theta" activeKey={greekSortKey} dir={greekSortDir} onSort={handleSort} className="text-right" />
            <SortHeader label="Rho" sortKey="rho" activeKey={greekSortKey} dir={greekSortDir} onSort={handleSort} className="text-right" />
          </tr>
        </thead>
        <tbody>
          {sortedGreeks.length === 0 ? (
            <tr style={{ height: ROW_HEIGHT_PX }}>
              <td colSpan={7} className="px-3 py-2.5 text-center text-sm text-zinc-400">
                暂无希腊字母数据
              </td>
            </tr>
          ) : (
            sortedGreeks.map((row, i) => (
            <tr
              key={row.variety}
              className={`border-b border-zinc-50 hover:bg-zinc-50/50 ${i % 2 === 1 ? "bg-zinc-50/30" : ""}`}
              style={{ height: ROW_HEIGHT_PX }}
            >
              <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.index}</td>
              <td className="px-3 py-2.5 text-zinc-800">{row.variety}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtGreek(row.delta)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtGreek(row.gamma)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtGreek(row.vega)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtGreek(row.theta)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtGreek(row.rho)}</td>
            </tr>
          ))
          )}
        </tbody>
      </ScrollTable>
    </div>
  )
}

export function TermAnalysisPanel({ termAnalysis }: { termAnalysis: TermAnalysisRow[] }) {
  const [termSortKey, setTermSortKey] = useState<TermSortKey | null>(null)
  const [termSortDir, setTermSortDir] = useState<"asc" | "desc">("desc")

  const sortedTerms = useMemo(() => {
    let rows = [...termAnalysis]
    if (termSortKey) {
      rows.sort((a, b) => {
        const av = a[termSortKey] ?? 0
        const bv = b[termSortKey] ?? 0
        return termSortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av)
      })
    }
    return rows.map((r, i) => ({ ...r, index: i + 1 }))
  }, [termAnalysis, termSortKey, termSortDir])

  if (termAnalysis.length === 0) return null

  function handleSort(key: TermSortKey) {
    if (termSortKey === key) setTermSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setTermSortKey(key)
      setTermSortDir("desc")
    }
  }

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex items-center gap-1.5">
        <span className="text-red-500 font-semibold text-sm">期限分析</span>
        <HelpCircle className="h-3.5 w-3.5 text-zinc-300" />
      </div>
      <ScrollTable rowCount={sortedTerms.length} minWidth="min-w-[880px]">
        <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[0_1px_0_0_rgb(244_244_245)]">
          <tr className="border-y border-zinc-100 text-xs">
            <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-12">序号</th>
            <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[100px]">品种</th>
            <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-28">到期日</th>
            <SortHeader label="剩余天数" sortKey="remainingDays" activeKey={termSortKey} dir={termSortDir} onSort={handleSort} className="text-right" />
            <SortHeader
              label="乘量"
              sortKey="multiplier"
              activeKey={termSortKey}
              dir={termSortDir}
              onSort={handleSort}
              className="text-right"
              extra={<HelpCircle className="h-3 w-3 text-zinc-300" />}
            />
            <SortHeader
              label="币种持仓占比"
              sortKey="currencyPositionPct"
              activeKey={termSortKey}
              dir={termSortDir}
              onSort={handleSort}
              className="text-right"
              extra={<HelpCircle className="h-3 w-3 text-zinc-300" />}
            />
            <SortHeader
              label="市值占比"
              sortKey="marketPct"
              activeKey={termSortKey}
              dir={termSortDir}
              onSort={handleSort}
              className="text-right"
              extra={<HelpCircle className="h-3 w-3 text-zinc-300" />}
            />
          </tr>
        </thead>
        <tbody>
          {sortedTerms.map((row, i) => (
            <tr
              key={`${row.variety}-${row.expiryDate}-${row.index}`}
              className={`border-b border-zinc-50 hover:bg-zinc-50/50 ${i % 2 === 1 ? "bg-zinc-50/30" : ""}`}
              style={{ height: ROW_HEIGHT_PX }}
            >
              <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.index}</td>
              <td className="px-3 py-2.5 text-zinc-800">{row.variety}</td>
              <td className="px-3 py-2.5 text-zinc-700 tabular-nums">{row.expiryDate ?? "—"}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">
                {row.remainingDays != null ? row.remainingDays : "—"}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtQty(row.multiplier)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{fmtPct(row.currencyPositionPct)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{fmtPct(row.marketPct)}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </div>
  )
}
