"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, Inbox, Search, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ma/ui/checkbox"
import {
  ASSOCIATION_CATEGORIES,
  type AssociationCategory,
  type InvestmentNoteAssociation,
  associationDisplayLabel,
  associationKey,
} from "@/lib/ma/investment-notes"

type FundRow = {
  beian_hao: string
  product_name: string
}

export function InvestmentNoteAssociationDialog({
  open,
  onOpenChange,
  initialAssociations,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialAssociations: InvestmentNoteAssociation[]
  onConfirm: (associations: InvestmentNoteAssociation[]) => void
}) {
  const [category, setCategory] = useState<AssociationCategory>("私募基金")
  const [keyword, setKeyword] = useState("")
  const [searchKeyword, setSearchKeyword] = useState("")
  const [selected, setSelected] = useState<InvestmentNoteAssociation[]>([])
  const [fundRows, setFundRows] = useState<FundRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setCategory("私募基金")
    setKeyword("")
    setSearchKeyword("")
    setSelected(initialAssociations.map((item) => ({ ...item })))
  }, [open, initialAssociations])

  const loadFunds = useCallback(async (q: string) => {
    if (category !== "私募基金") {
      setFundRows([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(
        `/ma/api/private-funds/list?page=1&pageSize=50&keyword=${encodeURIComponent(q)}`,
      )
      if (!res.ok) {
        setFundRows([])
        return
      }
      const payload = (await res.json()) as { data?: FundRow[] }
      setFundRows(Array.isArray(payload.data) ? payload.data : [])
    } catch {
      setFundRows([])
    } finally {
      setLoading(false)
    }
  }, [category])

  useEffect(() => {
    if (!open) return
    loadFunds(searchKeyword)
  }, [open, category, searchKeyword, loadFunds])

  const selectedKeys = useMemo(() => new Set(selected.map(associationKey)), [selected])

  const allVisibleSelected = useMemo(
    () => fundRows.length > 0 && fundRows.every((row) => selectedKeys.has(associationKey({
      category,
      name: row.product_name,
      recordNo: row.beian_hao,
    }))),
    [fundRows, selectedKeys, category],
  )

  function toggleRow(row: FundRow, checked: boolean) {
    const item: InvestmentNoteAssociation = {
      category,
      name: row.product_name,
      recordNo: row.beian_hao,
    }
    const key = associationKey(item)
    setSelected((prev) => {
      if (checked) {
        if (prev.some((entry) => associationKey(entry) === key)) return prev
        return [...prev, item]
      }
      return prev.filter((entry) => associationKey(entry) !== key)
    })
  }

  function toggleAllVisible(checked: boolean) {
    if (!checked) {
      const visibleKeys = new Set(
        fundRows.map((row) => associationKey({ category, name: row.product_name, recordNo: row.beian_hao })),
      )
      setSelected((prev) => prev.filter((entry) => !visibleKeys.has(associationKey(entry))))
      return
    }
    setSelected((prev) => {
      const next = [...prev]
      for (const row of fundRows) {
        const item = { category, name: row.product_name, recordNo: row.beian_hao }
        const key = associationKey(item)
        if (!next.some((entry) => associationKey(entry) === key)) next.push(item)
      }
      return next
    })
  }

  function removeSelected(item: InvestmentNoteAssociation) {
    const key = associationKey(item)
    setSelected((prev) => prev.filter((entry) => associationKey(entry) !== key))
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
          <DialogTitle className="text-base font-semibold">关联管理</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px]">
          <div className="flex min-h-0 flex-col border-r">
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <div className="relative w-36 shrink-0">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as AssociationCategory)}
                  className="h-9 w-full appearance-none rounded border border-zinc-200 bg-white pl-3 pr-8 text-sm text-zinc-700 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
                >
                  {ASSOCIATION_CATEGORIES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              </div>
              <div className="relative min-w-0 flex-1">
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearchSubmit()
                  }}
                  placeholder="请输入名称，回车搜索"
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
                        disabled={fundRows.length === 0 || category !== "私募基金"}
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-medium">产品名称</th>
                    <th className="px-3 py-2 text-left font-medium">备案号</th>
                  </tr>
                </thead>
                <tbody>
                  {category !== "私募基金" ? (
                    <tr>
                      <td colSpan={3} className="h-56">
                        <div className="flex flex-col items-center justify-center text-zinc-400 gap-2">
                          <Inbox className="h-10 w-10 text-zinc-300" strokeWidth={1} />
                          <span className="text-sm">暂无数据</span>
                        </div>
                      </td>
                    </tr>
                  ) : loading ? (
                    <tr>
                      <td colSpan={3} className="h-56 text-center text-sm text-zinc-400">加载中...</td>
                    </tr>
                  ) : fundRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="h-56">
                        <div className="flex flex-col items-center justify-center text-zinc-400 gap-2">
                          <Inbox className="h-10 w-10 text-zinc-300" strokeWidth={1} />
                          <span className="text-sm">暂无数据</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    fundRows.map((row) => {
                      const item = { category, name: row.product_name, recordNo: row.beian_hao }
                      const checked = selectedKeys.has(associationKey(item))
                      return (
                        <tr key={row.beian_hao} className="border-b border-zinc-100 hover:bg-zinc-50/80">
                          <td className="px-3 py-2.5">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => toggleRow(row, value === true)}
                            />
                          </td>
                          <td className="px-3 py-2.5 text-zinc-700">{row.product_name}</td>
                          <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.beian_hao}</td>
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
                      key={associationKey(item)}
                      className="flex items-start justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-zinc-800">{associationDisplayLabel(item)}</div>
                        {item.recordNo ? (
                          <div className="mt-0.5 text-xs text-zinc-400 tabular-nums">{item.recordNo}</div>
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
