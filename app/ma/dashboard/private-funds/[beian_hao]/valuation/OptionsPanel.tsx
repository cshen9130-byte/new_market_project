"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Clock, Download, Filter, Info, Search } from "lucide-react"

export type OptionRow = {
  index: number
  assetName: string
  directionLabel: "买方" | "卖方"
  valuationCode: string
  quantity: number
  price: number | null
  marketValue: number
  marketPct: number
  cost: number | null
  unrealizedPnl: number | null
}

const VISIBLE_ROWS = 10
const ROW_HEIGHT_PX = 42

type SortKey = "quantity" | "price" | "marketValue" | "marketPct" | "cost" | "unrealizedPnl"
type DirectionFilter = "全部" | "买方" | "卖方"

type Props = {
  options: OptionRow[]
  valuationDate: string | null
  displayName: string
}

function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPrice(n: number | null): string {
  if (n == null) return "—"
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function fmtPct(n: number): string {
  return `${n.toFixed(4)}%`
}

function fmtQty(n: number): string {
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
  sortKey?: SortKey
  activeKey: SortKey | null
  dir: "asc" | "desc"
  onSort: (key: SortKey) => void
  className?: string
  extra?: ReactNode
}) {
  const active = sortKey != null && activeKey === sortKey
  return (
    <th className={`px-3 py-2.5 font-semibold text-zinc-500 ${className}`}>
      {sortKey ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="inline-flex items-center gap-0.5 hover:text-zinc-700"
        >
          {label}
          {extra}
          <span className="text-[10px] text-zinc-300">{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
        </button>
      ) : (
        <span className="inline-flex items-center gap-0.5">
          {label}
          {extra}
        </span>
      )}
    </th>
  )
}

export function OptionsPanel({ options, valuationDate, displayName }: Props) {
  const [keyword, setKeyword] = useState("")
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("全部")
  const [showDirectionMenu, setShowDirectionMenu] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const filtered = useMemo(() => {
    let rows = options
    if (directionFilter !== "全部") {
      rows = rows.filter((r) => r.directionLabel === directionFilter)
    }
    const q = keyword.trim().toLowerCase()
    if (q) {
      rows = rows.filter((r) =>
        r.assetName.toLowerCase().includes(q)
        || r.valuationCode.toLowerCase().includes(q),
      )
    }
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortKey] ?? 0
        const bv = b[sortKey] ?? 0
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av)
      })
    }
    return rows.map((row, i) => ({ ...row, index: i + 1 }))
  }, [options, directionFilter, keyword, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  function handleExport() {
    if (!filtered.length) return
    const lines = [
      ["序号", "资产名称", "方向", "估值表代码", "数量", "市价", "市值", "市值占比", "成本", "估值增值"].join(","),
      ...filtered.map((r) =>
        [
          r.index,
          r.assetName,
          r.directionLabel,
          r.valuationCode,
          r.quantity,
          r.price ?? "",
          r.marketValue.toFixed(2),
          r.marketPct.toFixed(4),
          r.cost?.toFixed(2) ?? "",
          r.unrealizedPnl?.toFixed(2) ?? "",
        ].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_期权持仓_${valuationDate?.slice(0, 10) ?? "export"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (options.length === 0) return null

  const dateLabel = valuationDate?.slice(0, 10) ?? "—"

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <div className="text-red-500 font-semibold text-sm">期权持仓</div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1">
            <Clock className="h-3 w-3" />
            <span>{dateLabel}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!filtered.length}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          导出
        </button>
      </div>

      <div className="flex justify-end px-4 pb-2">
        <div className="relative">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder="请输入关键字，按回车搜索"
            className="border border-zinc-200 rounded pl-3 pr-8 py-1.5 text-xs w-56 bg-white focus:outline-none focus:border-red-300"
          />
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
        </div>
      </div>

      <div className="overflow-x-auto border-t border-zinc-100">
        <div
          className="overflow-y-auto"
          style={{ maxHeight: filtered.length > VISIBLE_ROWS ? ROW_HEIGHT_PX * VISIBLE_ROWS + 40 : undefined }}
        >
          <table className="w-full text-sm min-w-[1040px]">
            <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[0_1px_0_0_rgb(244_244_245)]">
              <tr className="border-b border-zinc-100 text-xs">
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-12">序号</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[140px]">资产名称</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-16 relative">
                  <button
                    type="button"
                    onClick={() => setShowDirectionMenu((v) => !v)}
                    className="inline-flex items-center gap-0.5 hover:text-zinc-700"
                  >
                    方向
                    <Filter className="h-3 w-3 text-zinc-400" />
                  </button>
                  {showDirectionMenu && (
                    <div className="absolute left-0 top-full mt-1 bg-white border border-zinc-200 rounded shadow-md z-20 py-1 min-w-[80px]">
                      {(["全部", "买方", "卖方"] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => { setDirectionFilter(d); setShowDirectionMenu(false) }}
                          className={`block w-full text-left px-3 py-1.5 hover:bg-zinc-50 ${
                            directionFilter === d ? "text-red-500 font-medium" : "text-zinc-700"
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  )}
                </th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[120px]">估值表代码</th>
                <SortHeader label="数量" sortKey="quantity" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                <SortHeader label="市价" sortKey="price" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                <SortHeader label="市值" sortKey="marketValue" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                <SortHeader label="市值占比" sortKey="marketPct" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                <SortHeader label="成本" sortKey="cost" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                <SortHeader
                  label="估值增值"
                  sortKey="unrealizedPnl"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                  extra={<Info className="h-3 w-3 text-zinc-300" />}
                />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-zinc-400">
                    无匹配结果
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={`${row.valuationCode}-${row.index}`}
                    className="border-b border-zinc-50 hover:bg-zinc-50/50"
                    style={{ height: ROW_HEIGHT_PX }}
                  >
                    <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.index}</td>
                    <td className="px-3 py-2.5 text-zinc-800">{row.assetName}</td>
                    <td className="px-3 py-2.5 text-zinc-700">{row.directionLabel}</td>
                    <td className="px-3 py-2.5 text-zinc-600 font-mono text-xs">{row.valuationCode}</td>
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
