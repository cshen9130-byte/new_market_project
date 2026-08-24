"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronRight, Inbox, Search, X } from "lucide-react"
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
  /** A/B/C share-class children keyed by parent beian_hao */
  const [shareClassMap, setShareClassMap] = useState<Record<string, FundRow[]>>({})
  /** Which parent rows are expanded to show A/B/C children */
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) return
    setCategory("私募基金")
    setKeyword("")
    setSearchKeyword("")
    setSelected(initialAssociations.map((item) => ({ ...item })))
    setShareClassMap({})
    setExpandedParents(new Set())
  }, [open, initialAssociations])

  const loadFunds = useCallback(
    async (q: string) => {
      if (category !== "私募基金") {
        setFundRows([])
        setShareClassMap({})
        setExpandedParents(new Set())
        return
      }

      // Cancel any in-flight request
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setLoading(true)
      try {
        const res = await fetch(
          `/ma/api/private-funds/list?page=1&pageSize=50&keyword=${encodeURIComponent(q)}`,
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        if (!res.ok) {
          setFundRows([])
          setShareClassMap({})
          return
        }
        const payload = (await res.json()) as { data?: FundRow[] }
        if (controller.signal.aborted) return
        const rows = Array.isArray(payload.data) ? payload.data : []
        setFundRows(rows)
        setExpandedParents(new Set())

        // Fetch A/B/C share-class children for all returned products
        if (rows.length > 0) {
          const parents = rows.map((r) => r.beian_hao).join(",")
          const scRes = await fetch(
            `/ma/api/private-funds/share-classes?parents=${encodeURIComponent(parents)}`,
            { signal: controller.signal },
          )
          if (!controller.signal.aborted && scRes.ok) {
            const scPayload = (await scRes.json()) as {
              data?: Record<string, FundRow[]>
            }
            setShareClassMap(scPayload.data ?? {})
          }
        } else {
          setShareClassMap({})
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return
        setFundRows([])
        setShareClassMap({})
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [category],
  )

  useEffect(() => {
    if (!open) return
    loadFunds(searchKeyword)
  }, [open, category, searchKeyword, loadFunds])

  const selectedKeys = useMemo(() => new Set(selected.map(associationKey)), [selected])

  /** All visible rows (parents + any expanded children) */
  const allVisibleItems = useMemo<InvestmentNoteAssociation[]>(() => {
    const items: InvestmentNoteAssociation[] = []
    for (const row of fundRows) {
      items.push({ category, name: row.product_name, recordNo: row.beian_hao })
      if (expandedParents.has(row.beian_hao)) {
        for (const child of shareClassMap[row.beian_hao] ?? []) {
          items.push({ category, name: child.product_name, recordNo: child.beian_hao })
        }
      }
    }
    return items
  }, [fundRows, shareClassMap, expandedParents, category])

  const allVisibleSelected = useMemo(
    () => allVisibleItems.length > 0 && allVisibleItems.every((item) => selectedKeys.has(associationKey(item))),
    [allVisibleItems, selectedKeys],
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
      const visibleKeys = new Set(allVisibleItems.map(associationKey))
      setSelected((prev) => prev.filter((entry) => !visibleKeys.has(associationKey(entry))))
      return
    }
    setSelected((prev) => {
      const next = [...prev]
      for (const item of allVisibleItems) {
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

  function toggleExpand(beianHao: string) {
    setExpandedParents((prev) => {
      const next = new Set(prev)
      if (next.has(beianHao)) next.delete(beianHao)
      else next.add(beianHao)
      return next
    })
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

            {/* Keep rows visible while loading (no flash); only show spinner when truly empty */}
            <div className={`min-h-0 flex-1 overflow-auto transition-opacity duration-150 ${loading && fundRows.length > 0 ? "opacity-50 pointer-events-none" : ""}`}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-50">
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500">
                    <th className="w-10 px-3 py-2">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                        disabled={allVisibleItems.length === 0 || category !== "私募基金"}
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
                  ) : loading && fundRows.length === 0 ? (
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
                      const item: InvestmentNoteAssociation = { category, name: row.product_name, recordNo: row.beian_hao }
                      const checked = selectedKeys.has(associationKey(item))
                      const children = shareClassMap[row.beian_hao] ?? []
                      const hasChildren = children.length > 0
                      const isExpanded = expandedParents.has(row.beian_hao)

                      return (
                        <>
                          <tr key={row.beian_hao} className="border-b border-zinc-100 hover:bg-zinc-50/80">
                            <td className="px-3 py-2.5">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(value) => toggleRow(row, value === true)}
                              />
                            </td>
                            <td className="px-3 py-2.5 text-zinc-700">
                              <div className="flex items-center gap-1">
                                {hasChildren ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleExpand(row.beian_hao)}
                                    className="shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-600"
                                    aria-label={isExpanded ? "收起分级" : "展开分级"}
                                  >
                                    <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                  </button>
                                ) : (
                                  <span className="w-5 shrink-0" />
                                )}
                                <a
                                  href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beian_hao)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sky-600 hover:underline"
                                  title={row.product_name}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {row.product_name}
                                </a>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.beian_hao}</td>
                          </tr>

                          {/* A/B/C share-class child rows */}
                          {hasChildren && isExpanded && children.map((child) => {
                            const childItem: InvestmentNoteAssociation = {
                              category,
                              name: child.product_name,
                              recordNo: child.beian_hao,
                            }
                            const childChecked = selectedKeys.has(associationKey(childItem))
                            return (
                              <tr key={child.beian_hao} className="border-b border-zinc-100 bg-sky-50/40 hover:bg-sky-50/70">
                                <td className="px-3 py-2">
                                  <div className="flex justify-center">
                                    <Checkbox
                                      checked={childChecked}
                                      onCheckedChange={(value) => toggleRow(child, value === true)}
                                    />
                                  </div>
                                </td>
                                <td className="py-2 pr-3 pl-8 text-zinc-600">
                                  <div className="flex items-center gap-1.5">
                                    <span className="shrink-0 text-xs text-zinc-300">└</span>
                                    <a
                                      href={`/ma/dashboard/private-funds/${encodeURIComponent(child.beian_hao)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sky-600 hover:underline"
                                      title={child.product_name}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {child.product_name}
                                    </a>
                                  </div>
                                </td>
                                <td className="py-2 pr-3 text-zinc-500 tabular-nums">{child.beian_hao}</td>
                              </tr>
                            )
                          })}
                        </>
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
                  {selected.map((item) => {
                    const recordNo = (item.recordNo || "").trim()
                    const label = associationDisplayLabel(item)
                    return (
                      <div
                        key={associationKey(item)}
                        className="flex items-start justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-2"
                      >
                        <div className="min-w-0">
                          {recordNo ? (
                            <a
                              href={`/ma/dashboard/private-funds/${encodeURIComponent(recordNo)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block truncate text-sm text-sky-600 hover:underline"
                              title={label}
                            >
                              {label}
                            </a>
                          ) : (
                            <div className="truncate text-sm text-zinc-800">{label}</div>
                          )}
                          {recordNo ? (
                            <div className="mt-0.5 text-xs text-zinc-400 tabular-nums">{recordNo}</div>
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
                    )
                  })}
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
