"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ma/ui/dialog"

type HoldingRow = {
  subjectCode?: string
  subjectName?: string
  quantity?: number | null
  price?: number | null
  marketValue?: number | null
  marketWeight?: number | null
  rowKind?: string | null
}

type RecordDetail = {
  id: number
  fundName: string | null
  valuationDate: string | null
  unitNav: number | null
  cumulativeNav: number | null
  netAsset: number | null
  holdingsCount: number | null
  attachmentFilename: string | null
  normalizedHoldings?: HoldingRow[]
}

type Props = {
  open: boolean
  onClose: () => void
  recordId: number | null
  displayName: string
}

function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const pct = Math.abs(value) <= 1 ? value * 100 : value
  return `${pct.toFixed(4)}%`
}

export function exportValuationRecordCsv(detail: RecordDetail, displayName: string) {
  const holdings = detail.normalizedHoldings ?? []
  const lines = [
    ["科目代码", "科目名称", "数量", "市价", "市值", "市值占比", "类型"].join(","),
    ...holdings.map((row) => [
      row.subjectCode ?? "",
      `"${(row.subjectName ?? "").replace(/"/g, '""')}"`,
      row.quantity ?? "",
      row.price ?? "",
      row.marketValue ?? "",
      row.marketWeight ?? "",
      row.rowKind ?? "",
    ].join(",")),
  ]
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${displayName}_估值表_${detail.valuationDate?.slice(0, 10) ?? detail.id}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function fetchValuationRecordDetail(recordId: number): Promise<RecordDetail> {
  const res = await fetch(`/ma/api/ops/email-valuation-records/${recordId}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<RecordDetail>
}

export function ValuationParseDialog({ open, onClose, recordId, displayName }: Props) {
  const [detail, setDetail] = useState<RecordDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDetail = useCallback(async () => {
    if (!recordId) return
    setLoading(true)
    setError(null)
    try {
      setDetail(await fetchValuationRecordDetail(recordId))
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [recordId])

  useEffect(() => {
    if (open && recordId) void loadDetail()
    if (!open) {
      setDetail(null)
      setError(null)
    }
  }, [open, recordId, loadDetail])

  const holdings = detail?.normalizedHoldings ?? []

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            查看解析 — {displayName}
            {detail?.valuationDate ? ` (${detail.valuationDate.slice(0, 10)})` : ""}
          </DialogTitle>
        </DialogHeader>

        {loading && <div className="py-10 text-center text-sm text-zinc-400">加载中…</div>}
        {error && <div className="py-6 text-center text-sm text-red-600">{error}</div>}

        {!loading && !error && detail && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
              <div><span className="text-zinc-500">单位净值：</span>{fmtNum(detail.unitNav, 4)}</div>
              <div><span className="text-zinc-500">累计净值：</span>{fmtNum(detail.cumulativeNav, 4)}</div>
              <div><span className="text-zinc-500">资产净值：</span>{fmtNum(detail.netAsset)}</div>
              <div><span className="text-zinc-500">持仓数：</span>{detail.holdingsCount ?? holdings.length}</div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto rounded border border-zinc-100">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="sticky top-0 z-10 bg-zinc-50">
                  <tr className="border-b border-zinc-100">
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">科目代码</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">科目名称</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-zinc-500">数量</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-zinc-500">市价</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-zinc-500">市值</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-zinc-500">市值占比</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">暂无解析明细</td>
                    </tr>
                  ) : (
                    holdings.map((row, i) => (
                      <tr key={`${row.subjectCode ?? i}-${i}`} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                        <td className="px-3 py-2 text-zinc-600 tabular-nums">{row.subjectCode ?? "—"}</td>
                        <td className="px-3 py-2 text-zinc-800">{row.subjectName ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-800">{fmtNum(row.quantity, 2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-800">{fmtNum(row.price, 4)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-800">{fmtNum(row.marketValue)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{fmtPct(row.marketWeight)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
