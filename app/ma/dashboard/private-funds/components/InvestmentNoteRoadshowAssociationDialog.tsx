"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Inbox, Search, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ma/ui/checkbox"
import {
  type InvestmentNoteRoadshowAssociation,
  buildRoadshowAssociationFromDdRow,
  roadshowAssociationDisplayLabel,
  roadshowAssociationKey,
} from "@/lib/ma/investment-notes"
import {
  type DueDiligenceTableRow,
  loadDueDiligenceTableFromServer,
} from "@/lib/ma/due-diligence-table"

function companyOrTarget(row: Pick<DueDiligenceTableRow, "fundCompany" | "ddTarget">): string {
  return row.fundCompany.trim() || row.ddTarget.trim() || "—"
}

/** Skip blank DD placeholder rows with nothing useful to identify a roadshow. */
function hasIdentifiableFields(row: DueDiligenceTableRow): boolean {
  return Boolean(
    row.ddDate.trim() ||
      row.fundCompany.trim() ||
      row.ddTarget.trim() ||
      row.representativeProduct.trim(),
  )
}

function rowMatchesKeyword(row: DueDiligenceTableRow, keyword: string): boolean {
  if (!keyword) return true
  const haystack = [
    row.ddDate,
    row.fundCompany,
    row.ddTarget,
    row.representativeProduct,
    row.investmentManager,
    row.ddConclusion,
    row.ddPersonnel,
    row.recommender,
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(keyword)
}

export function InvestmentNoteRoadshowAssociationDialog({
  open,
  onOpenChange,
  initialAssociations,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialAssociations: InvestmentNoteRoadshowAssociation[]
  onConfirm: (associations: InvestmentNoteRoadshowAssociation[]) => void
}) {
  const [keyword, setKeyword] = useState("")
  const [searchKeyword, setSearchKeyword] = useState("")
  const [selected, setSelected] = useState<InvestmentNoteRoadshowAssociation[]>([])
  const [rows, setRows] = useState<DueDiligenceTableRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setKeyword("")
    setSearchKeyword("")
    setSelected(initialAssociations.map((item) => ({ ...item })))
  }, [open, initialAssociations])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const data = await loadDueDiligenceTableFromServer()
      setRows(Array.isArray(data.rows) ? data.rows : [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadRows()
  }, [open, loadRows])

  const filteredRows = useMemo(() => {
    const q = searchKeyword.trim().toLowerCase()
    return rows.filter((row) => hasIdentifiableFields(row) && rowMatchesKeyword(row, q))
  }, [rows, searchKeyword])

  const selectedKeys = useMemo(() => new Set(selected.map(roadshowAssociationKey)), [selected])

  const allVisibleSelected = useMemo(
    () =>
      filteredRows.length > 0 &&
      filteredRows.every((row) => selectedKeys.has(row.id)),
    [filteredRows, selectedKeys],
  )

  function toggleRow(row: DueDiligenceTableRow, checked: boolean) {
    const item = buildRoadshowAssociationFromDdRow(row)
    const key = roadshowAssociationKey(item)
    setSelected((prev) => {
      if (checked) {
        if (prev.some((entry) => roadshowAssociationKey(entry) === key)) return prev
        return [...prev, item]
      }
      return prev.filter((entry) => roadshowAssociationKey(entry) !== key)
    })
  }

  function toggleAllVisible(checked: boolean) {
    if (!checked) {
      const visibleKeys = new Set(filteredRows.map((row) => row.id))
      setSelected((prev) => prev.filter((entry) => !visibleKeys.has(roadshowAssociationKey(entry))))
      return
    }
    setSelected((prev) => {
      const next = [...prev]
      for (const row of filteredRows) {
        const item = buildRoadshowAssociationFromDdRow(row)
        const key = roadshowAssociationKey(item)
        if (!next.some((entry) => roadshowAssociationKey(entry) === key)) next.push(item)
      }
      return next
    })
  }

  function removeSelected(item: InvestmentNoteRoadshowAssociation) {
    const key = roadshowAssociationKey(item)
    setSelected((prev) => prev.filter((entry) => roadshowAssociationKey(entry) !== key))
  }

  function handleSearchSubmit() {
    setSearchKeyword(keyword.trim())
  }

  function handleConfirm() {
    onConfirm(selected)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[860px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[860px]" showCloseButton>
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="text-base font-semibold">关联路演</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px]">
          <div className="flex min-h-0 flex-col border-r">
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <div className="relative min-w-0 flex-1">
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearchSubmit()
                  }}
                  placeholder="搜索日期、基金公司、对象、代表产品…"
                  className="h-9 w-full rounded border border-zinc-200 bg-white pl-3 pr-9 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={handleSearchSubmit}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                  aria-label="搜索"
                >
                  <Search className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-50">
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500">
                    <th className="w-10 px-3 py-2">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                        disabled={filteredRows.length === 0}
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-medium">尽调日期</th>
                    <th className="px-3 py-2 text-left font-medium">基金公司/对象</th>
                    <th className="px-3 py-2 text-left font-medium">代表产品</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="h-56 text-center text-sm text-zinc-400">加载中...</td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="h-56">
                        <div className="flex flex-col items-center justify-center text-zinc-400 gap-2">
                          <Inbox className="h-10 w-10 text-zinc-300" strokeWidth={1} />
                          <span className="text-sm">暂无数据</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      const checked = selectedKeys.has(row.id)
                      return (
                        <tr key={row.id} className="border-b border-zinc-100 hover:bg-zinc-50/80">
                          <td className="px-3 py-2.5">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => toggleRow(row, value === true)}
                            />
                          </td>
                          <td className="px-3 py-2.5 text-zinc-700 tabular-nums whitespace-nowrap">
                            {row.ddDate.trim() || "—"}
                          </td>
                          <td className="px-3 py-2.5 text-zinc-700">{companyOrTarget(row)}</td>
                          <td className="px-3 py-2.5 text-zinc-500">
                            {row.representativeProduct.trim() || "—"}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex min-h-0 flex-col bg-zinc-50/40">
            <div className="border-b px-4 py-3 text-sm font-medium text-zinc-700">当前关联</div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              {selected.length === 0 ? (
                <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-zinc-400">
                  暂无关联
                </div>
              ) : (
                <div className="space-y-2">
                  {selected.map((item) => (
                    <div
                      key={roadshowAssociationKey(item)}
                      className="flex items-start justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-zinc-800">
                          {roadshowAssociationDisplayLabel(item)}
                        </div>
                        {item.ddDate ? (
                          <div className="mt-0.5 text-xs text-zinc-400 tabular-nums">{item.ddDate}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSelected(item)}
                        className="shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-600"
                        aria-label="移除"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded border border-zinc-200 bg-white px-5 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded bg-red-500 px-5 py-2 text-sm text-white hover:bg-red-600"
          >
            确定
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
