"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Clock, Download, Info, Search } from "lucide-react"

export type AssetHoldingTableRow = {
  index: number
  assetName: string
  valuationCode: string | null
  category?: string | null
  quantity: number | null
  price: number | null
  marketValue: number
  marketPct: number
  cost: number | null
  unrealizedPnl: number | null
  settlementStatus: string
}

type SortKey = "quantity" | "price" | "marketValue" | "marketPct" | "cost" | "unrealizedPnl"

type Props = {
  title: string
  subtitle?: string
  rows: AssetHoldingTableRow[]
  valuationDate: string | null
  displayName: string
  exportLabel: string
  accent?: "amber" | "red"
  topN?: number
  showCategory?: boolean
  statusColumnLabel?: string
}

const VISIBLE_ROWS = 10
const ROW_HEIGHT_PX = 42

function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  return `${n.toFixed(4)}%`
}

function fmtPrice(n: number | null): string {
  if (n == null) return "—"
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function fmtQty(n: number | null): string {
  if (n == null) return "—"
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 0 })
}

function SortTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  extra,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey | null
  dir: "asc" | "desc"
  onSort: (key: SortKey) => void
  extra?: ReactNode
}) {
  const active = activeKey === sortKey
  return (
    <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 whitespace-nowrap">
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-0.5 hover:text-zinc-700">
        {label}
        {extra}
        <span className="text-[10px] text-zinc-300">{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  )
}

export function AssetHoldingsTable({
  title,
  subtitle,
  rows,
  valuationDate,
  displayName,
  exportLabel,
  accent = "amber",
  topN,
  showCategory = false,
  statusColumnLabel = "结算状态",
}: Props) {
  const [keyword, setKeyword] = useState("")
  const [sortKey, setSortKey] = useState<SortKey | null>("marketValue")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const dateLabel = valuationDate?.slice(0, 10) ?? "—"
  const titleCls = accent === "red" ? "text-red-500" : "text-amber-600"
  const btnCls = accent === "red"
    ? "bg-red-500 hover:bg-red-600"
    : "bg-amber-500 hover:bg-amber-600"
  const focusCls = accent === "red" ? "focus:border-red-300" : "focus:border-amber-300"

  const filtered = useMemo(() => {
    let list = [...rows].sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue))
    if (topN != null) list = list.slice(0, topN)
    const q = keyword.trim().toLowerCase()
    if (q) {
      list = list.filter((r) =>
        r.assetName.toLowerCase().includes(q)
        || (r.valuationCode ?? "").toLowerCase().includes(q)
        || (r.category ?? "").toLowerCase().includes(q),
      )
    }
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = a[sortKey] ?? 0
        const bv = b[sortKey] ?? 0
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av)
      })
    }
    return list.map((row, i) => ({ ...row, index: i + 1 }))
  }, [rows, keyword, sortKey, sortDir, topN])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  function handleExport() {
    if (!filtered.length) return
    const headers = [
      "序号", "资产名称",
      ...(showCategory ? ["类别"] : []),
      "估值表代码", "数量", "市价", "市值", "市值占比", "成本", "估值增值", statusColumnLabel,
    ]
    const lines = [
      headers.join(","),
      ...filtered.map((r) =>
        [
          r.index,
          r.assetName,
          ...(showCategory ? [r.category ?? ""] : []),
          r.valuationCode ?? "",
          r.quantity ?? "",
          r.price ?? "",
          r.marketValue.toFixed(2),
          r.marketPct.toFixed(4),
          r.cost?.toFixed(2) ?? "",
          r.unrealizedPnl?.toFixed(2) ?? "",
          r.settlementStatus,
        ].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_${exportLabel}_${dateLabel}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (rows.length === 0) return null

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-zinc-100">
        <div>
          <div className={`${titleCls} font-semibold text-sm leading-tight`}>{title}</div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-0.5">
            {subtitle && <span className="text-zinc-600">{subtitle}</span>}
            <Clock className="h-3 w-3" />
            <span>{dateLabel}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!filtered.length}
          className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-white rounded transition-colors disabled:opacity-40 ${btnCls}`}
        >
          <Download className="h-3.5 w-3.5" />
          导出
        </button>
      </div>

      <div className="flex justify-end px-4 py-2">
        <div className="relative">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder="请输入关键字，按回车搜索"
            className={`border border-zinc-200 rounded pl-3 pr-8 py-1.5 text-xs w-56 bg-white focus:outline-none ${focusCls}`}
          />
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
        </div>
      </div>

      <div className="overflow-x-auto border-t border-zinc-100">
        <div
          className="overflow-y-auto"
          style={{ maxHeight: filtered.length > VISIBLE_ROWS ? ROW_HEIGHT_PX * VISIBLE_ROWS + 40 : undefined }}
        >
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[0_1px_0_0_rgb(244_244_245)]">
              <tr className="border-b border-zinc-100 text-xs">
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-12">序号</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[140px]">资产名称</th>
                {showCategory && (
                  <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[100px]">类别</th>
                )}
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[100px]">估值表代码</th>
                <SortTh label="数量" sortKey="quantity" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="市价" sortKey="price" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="市值" sortKey="marketValue" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="市值占比" sortKey="marketPct" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="成本" sortKey="cost" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh
                  label="估值增值"
                  sortKey="unrealizedPnl"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                  extra={<Info className="h-3 w-3 text-zinc-300" />}
                />
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap min-w-[100px]">
                  {statusColumnLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={showCategory ? 11 : 10} className="px-4 py-10 text-center text-sm text-zinc-400">
                    无匹配结果
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={`${row.valuationCode ?? row.assetName}-${row.index}`}
                    className="border-b border-zinc-50 hover:bg-zinc-50/50"
                    style={{ height: ROW_HEIGHT_PX }}
                  >
                    <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.index}</td>
                    <td className="px-3 py-2.5 text-zinc-800">{row.assetName}</td>
                    {showCategory && (
                      <td className="px-3 py-2.5 text-zinc-600 whitespace-nowrap">{row.category ?? "—"}</td>
                    )}
                    <td className="px-3 py-2.5 text-zinc-600 font-mono text-xs whitespace-nowrap">{row.valuationCode ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtQty(row.quantity)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtPrice(row.price)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtMoney(row.marketValue)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{fmtPct(row.marketPct)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">
                      {row.cost != null ? fmtMoney(row.cost) : "—"}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${
                      (row.unrealizedPnl ?? 0) >= 0 ? "text-red-500" : "text-emerald-600"
                    }`}>
                      {row.unrealizedPnl != null ? fmtMoney(row.unrealizedPnl) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-600 whitespace-nowrap">{row.settlementStatus || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
