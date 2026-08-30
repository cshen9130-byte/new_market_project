"use client"

import { useMemo, useState } from "react"
import { Clock, Download, Search } from "lucide-react"
import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"

export type OtherHoldingRow = {
  index: number
  assetName: string
  category: string
  marketValue: number
  marketPct: number
  quantity: number | null
  cost: number | null
}

type Props = {
  rows: OtherHoldingRow[]
  valuationDate: string | null
  displayName: string
}

const VISIBLE_ROWS = 8
const ROW_HEIGHT_PX = 42

function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  return `${n.toFixed(4)}%`
}

export function OtherHoldingsPanel({ rows, valuationDate, displayName }: Props) {
  const [keyword, setKeyword] = useState("")

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    let list = rows.map((row) => ({
      ...row,
      assetName: stripValuationSubjectPathPrefix(row.assetName) || row.assetName,
    }))
    if (q) {
      list = list.filter((r) =>
        r.assetName.toLowerCase().includes(q)
        || r.category.toLowerCase().includes(q),
      )
    }
    return list.map((row, i) => ({ ...row, index: i + 1 }))
  }, [rows, keyword])

  const dateLabel = valuationDate?.slice(0, 10) ?? "—"

  function handleExport() {
    if (!filtered.length) return
    const lines = [
      ["序号", "资产名称", "资产类别", "市值", "市值占比", "数量", "成本"].join(","),
      ...filtered.map((r) =>
        [
          r.index,
          r.assetName,
          r.category,
          r.marketValue.toFixed(2),
          r.marketPct.toFixed(4),
          r.quantity?.toFixed(2) ?? "",
          r.cost?.toFixed(2) ?? "",
        ].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_其他持仓_${dateLabel}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <div className="text-red-500 font-semibold text-sm">其他持仓</div>
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

      <div className="flex justify-end px-4 pb-3">
        <div className="relative">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
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
          <table className="w-full text-sm min-w-[760px]">
            <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[0_1px_0_0_rgb(244_244_245)]">
              <tr className="border-b border-zinc-100 text-xs">
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-12">序号</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[180px]">资产名称</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-24">资产类别</th>
                <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 w-28">市值</th>
                <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 w-24">市值占比</th>
                <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 w-24">数量</th>
                <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 w-28">成本</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-400">
                    {rows.length === 0 ? "暂无其他持仓" : "无匹配结果"}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={`${row.assetName}-${row.index}`} className="border-b border-zinc-50 hover:bg-zinc-50/50" style={{ height: ROW_HEIGHT_PX }}>
                    <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.index}</td>
                    <td className="px-3 py-2.5 text-zinc-800">{row.assetName}</td>
                    <td className="px-3 py-2.5 text-zinc-600">{row.category}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtMoney(row.marketValue)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{fmtPct(row.marketPct)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">
                      {row.quantity != null ? row.quantity.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">
                      {row.cost != null ? fmtMoney(row.cost) : "—"}
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
