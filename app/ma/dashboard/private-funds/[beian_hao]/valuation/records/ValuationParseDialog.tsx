"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Filter } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ma/ui/dialog"
import { fetchValuationRecordDetail, type ValuationRecordDetail } from "./valuation-record-fetch"

type HoldingRow = {
  subjectCode?: string
  originalSubjectCode?: string | null
  subjectName?: string
  symbol?: string | null
  rowKind?: string | null
  assetClass?: string | null
  includeInDetail?: boolean
  includeInAnalysis?: boolean
  quantity?: number | null
  price?: number | null
  marketValue?: number | null
  marketWeight?: number | null
}

type RecordDetail = ValuationRecordDetail

type Props = {
  open: boolean
  onClose: () => void
  recordId: number | null
  displayName: string
}

type StatusFilter = "all" | "success" | "failed"

const ROW_KIND_LABELS: Record<string, string> = {
  bank_deposit: "托管户现金",
  settlement_reserve: "清算备付金",
  margin_deposit: "存出保证金",
  clearing: "证券清算款",
  derivative: "衍生品",
  stock: "股票",
  bond: "债券",
  private_fund: "私募基金",
  fund: "基金",
  fund_or_stock: "基金/股票",
  money_fund: "货币基金",
  repo: "回购",
  receivable: "应收款",
  payable: "应付款",
  option: "期权",
  other: "其他",
}

function displayAccountCode(row: HoldingRow): string {
  const original = row.originalSubjectCode?.trim()
  if (original) return original
  const code = row.subjectCode?.trim()
  if (code) return code
  const symbol = row.symbol?.trim()
  if (symbol) return symbol
  return "—"
}

function deriveBelongingCategory(row: HoldingRow): string {
  const name = String(row.subjectName ?? "")
  const kind = row.rowKind ?? "other"

  if (/^银行存款/.test(name) || /^1002/.test(row.originalSubjectCode ?? row.subjectCode ?? "")) {
    return "托管户现金"
  }
  if (kind === "settlement_reserve" || /^结算备付金/.test(name)) {
    return /期货/.test(name) ? "清算备付金(期货)" : "清算备付金"
  }
  if (kind === "margin_deposit" || /^存出保证金/.test(name)) {
    return /期货/.test(name) ? "存出保证金(期货)" : "存出保证金"
  }
  if (kind === "receivable" || /^其他应收款/.test(name)) {
    if (/利息/.test(name)) return "应收利息"
    if (/申购/.test(name)) return "应收申购款"
    return "应收款"
  }
  if (kind === "payable" || /^应付/.test(name)) return "应付款"
  if (/托管户|银行活期/.test(name)) return "托管户现金"

  return ROW_KIND_LABELS[kind] ?? "其他"
}

function parseStatus(row: HoldingRow): "成功" | "失败" {
  const name = row.subjectName?.trim()
  const code = row.originalSubjectCode?.trim() || row.subjectCode?.trim()
  if (!name || !code) return "失败"
  return "成功"
}

export function exportValuationRecordCsv(detail: RecordDetail, displayName: string) {
  const holdings = detail.normalizedHoldings ?? []
  const lines = [
    ["序号", "科目名称", "归属科目", "科目代码", "解析状态"].join(","),
    ...holdings.map((row, i) => [
      i + 1,
      `"${(row.subjectName ?? "").replace(/"/g, '""')}"`,
      deriveBelongingCategory(row),
      displayAccountCode(row),
      parseStatus(row),
    ].join(",")),
  ]
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${displayName}_估值表_${detail.valuationDate?.slice(0, 10) ?? detail.id}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function ValuationParseDialog({ open, onClose, recordId, displayName }: Props) {
  const [detail, setDetail] = useState<RecordDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

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
      setStatusFilter("all")
    }
  }, [open, recordId, loadDetail])

  const holdings = detail?.normalizedHoldings ?? []
  const dateLabel = detail?.valuationDate?.slice(0, 10) ?? "—"

  const filteredHoldings = useMemo(() => {
    return holdings.filter((row) => {
      const status = parseStatus(row)
      if (statusFilter === "success") return status === "成功"
      if (statusFilter === "failed") return status === "失败"
      return true
    })
  }, [holdings, statusFilter])

  function cycleStatusFilter() {
    setStatusFilter((prev) => {
      if (prev === "all") return "success"
      if (prev === "success") return "failed"
      return "all"
    })
  }

  const filterLabel = statusFilter === "all" ? "全部" : statusFilter === "success" ? "成功" : "失败"

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden sm:max-w-4xl">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-zinc-100">
          <DialogTitle className="text-base font-semibold text-zinc-900">查看估值表解析</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-1 h-4 bg-red-500 rounded-sm shrink-0" />
            <span className="text-sm font-medium text-zinc-800">
              {displayName} ({dateLabel})
            </span>
          </div>

          {loading && (
            <div className="py-16 text-center text-sm text-zinc-400">加载中…</div>
          )}

          {error && (
            <div className="py-10 text-center text-sm text-red-600">{error}</div>
          )}

          {!loading && !error && detail && (
            <div className="flex-1 min-h-0 overflow-auto rounded border border-zinc-100">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="sticky top-0 z-10 bg-zinc-50">
                  <tr className="border-b border-zinc-100">
                    <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-14">序号</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">科目名称</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">归属科目</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-28">科目代码</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-28">
                      <button
                        type="button"
                        onClick={cycleStatusFilter}
                        className="inline-flex items-center gap-1 hover:text-zinc-700 transition-colors"
                        title={`筛选：${filterLabel}`}
                      >
                        解析状态
                        <Filter className="h-3.5 w-3.5 text-zinc-400" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHoldings.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-zinc-400">
                        {holdings.length === 0 ? "暂无解析明细" : "无匹配结果"}
                      </td>
                    </tr>
                  ) : (
                    filteredHoldings.map((row, i) => {
                      const status = parseStatus(row)
                      return (
                        <tr key={`${row.subjectCode ?? i}-${i}`} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                          <td className="px-4 py-2.5 text-zinc-500 tabular-nums text-center">{i + 1}</td>
                          <td className="px-4 py-2.5 text-zinc-800">{row.subjectName ?? "—"}</td>
                          <td className="px-4 py-2.5 text-zinc-700">{deriveBelongingCategory(row)}</td>
                          <td className="px-4 py-2.5 text-zinc-600 tabular-nums">{displayAccountCode(row)}</td>
                          <td className={`px-4 py-2.5 font-medium ${status === "成功" ? "text-emerald-600" : "text-red-500"}`}>
                            {status}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-zinc-100 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-8 py-1.5 rounded border border-zinc-300 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            关闭
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
