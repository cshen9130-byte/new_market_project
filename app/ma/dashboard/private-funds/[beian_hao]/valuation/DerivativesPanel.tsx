"use client"

import { useMemo, useState } from "react"
import { Clock, Download, Info, Search } from "lucide-react"

export type DerivativeRow = {
  index: number
  contractName: string
  symbol: string | null
  sector: string
  direction: "long" | "short"
  directionLabel: "多头" | "空头"
  quantity: number
  price: number | null
  marketValue: number
  marketPct: number
  cost: number | null
  unrealizedPnl: number | null
}

const SECTOR_TABS = ["全部", "黑色", "有色", "能化", "农产", "股指", "国债"] as const
type SectorTab = (typeof SECTOR_TABS)[number]

const VISIBLE_ROWS = 10
const ROW_HEIGHT_PX = 42

type SortKey = "quantity" | "price" | "marketValue" | "marketPct" | "cost" | "unrealizedPnl"

type Props = {
  derivatives: DerivativeRow[]
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

export function DerivativesPanel({ derivatives, valuationDate, displayName }: Props) {
  const [sectorTab, setSectorTab] = useState<SectorTab>("全部")
  const [keyword, setKeyword] = useState("")
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const activeSectors = useMemo(() => {
    const set = new Set(derivatives.map((d) => d.sector))
    return SECTOR_TABS.filter((tab) => tab === "全部" || set.has(tab))
  }, [derivatives])

  const filtered = useMemo(() => {
    let rows = derivatives
    if (sectorTab !== "全部") {
      rows = rows.filter((r) => r.sector === sectorTab)
    }
    const q = keyword.trim().toLowerCase()
    if (q) {
      rows = rows.filter((r) =>
        r.contractName.toLowerCase().includes(q)
        || (r.symbol ?? "").toLowerCase().includes(q),
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
  }, [derivatives, sectorTab, keyword, sortKey, sortDir])

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
      ["序号", "合约名称", "方向", "数量", "市价", "市值", "市值占比", "成本", "估值增值"].join(","),
      ...filtered.map((r) =>
        [
          r.index,
          r.contractName,
          r.directionLabel,
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
    a.download = `${displayName}_期货及衍生品_${valuationDate?.slice(0, 10) ?? "export"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const dateLabel = valuationDate?.slice(0, 10) ?? "—"

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <div className="text-red-500 font-semibold text-sm">期货及衍生品</div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1">
            <span className="text-zinc-600">期货合约</span>
            <Clock className="h-3 w-3" />
            <span>{dateLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={handleExport}
            disabled={!filtered.length}
            className="inline-flex items-center gap-1 px-2 py-1 text-zinc-500 hover:text-zinc-700 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
          <button
            type="button"
            className="px-3 py-1 rounded border border-red-500 text-red-500 hover:bg-red-50 font-medium"
          >
            详情
          </button>
          <button
            type="button"
            className="px-3 py-1 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          >
            查询
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {activeSectors.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSectorTab(tab)}
              className={[
                "px-3 py-1 rounded text-xs border transition-colors",
                sectorTab === tab
                  ? "bg-red-500 text-white border-red-500"
                  : "border-red-400 text-red-500 hover:bg-red-50",
              ].join(" ")}
            >
              {tab}
            </button>
          ))}
        </div>
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
          style={{ maxHeight: filtered.length > VISIBLE_ROWS ? ROW_HEIGHT_PX * VISIBLE_ROWS : undefined }}
        >
          <table className="w-full text-sm min-w-[960px]">
            <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[0_1px_0_0_rgb(244_244_245)]">
              <tr className="border-b border-zinc-100 text-xs">
              <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-12">序号</th>
              <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[140px]">合约名称</th>
              <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-16">方向</th>
              <SortHeader label="数量" sortKey="quantity" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
              <SortHeader label="市价" sortKey="price" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
              <SortHeader label="市值" sortKey="marketValue" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
              <SortHeader label="市值占比" sortKey="marketPct" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
              <SortHeader label="成本" sortKey="cost" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
              <th className="px-3 py-2.5 text-right font-semibold text-zinc-500">
                <span className="inline-flex items-center gap-0.5">
                  估值增值
                  <Info className="h-3 w-3 text-zinc-300" />
                  <button type="button" onClick={() => handleSort("unrealizedPnl")} className="text-[10px] text-zinc-300 ml-0.5">
                    {sortKey === "unrealizedPnl" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                  </button>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-zinc-400">
                  {derivatives.length === 0 ? "暂无期货及衍生品持仓" : "无匹配结果"}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={`${row.contractName}-${row.index}`} className="border-b border-zinc-50 hover:bg-zinc-50/50" style={{ height: ROW_HEIGHT_PX }}>
                  <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.index}</td>
                  <td className="px-3 py-2.5 text-zinc-800">{row.contractName}</td>
                  <td className="px-3 py-2.5 text-zinc-700">{row.directionLabel}</td>
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
