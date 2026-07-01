"use client"

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import {
  openFundCompareWithProducts,
  openPortfolioWithProducts,
  type SelectableProduct,
} from "@/lib/ma-product-selection-actions"

export type ProductSelectionPanelItem = {
  id: string
  product_name: string
}

type ProductSelectionPanelProps = {
  items: ProductSelectionPanelItem[]
  onRemove: (id: string) => void
  onClear: () => void
  onPortfolio?: () => void
  onFundCompare?: () => void
  portfolioDisabled?: boolean
  fundCompareDisabled?: boolean
}

export function ProductSelectionPanel({
  items,
  onRemove,
  onClear,
  onPortfolio,
  onFundCompare,
  portfolioDisabled = false,
  fundCompareDisabled = false,
}: ProductSelectionPanelProps) {
  const [mounted, setMounted] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || items.length === 0) return null

  const content = collapsed ? (
    <button
      type="button"
      onClick={() => setCollapsed(false)}
      className="fixed bottom-6 right-6 z-[60] rounded-lg border bg-background px-4 py-2.5 text-sm font-medium shadow-lg hover:bg-muted/50 transition-colors"
    >
      已选 ({items.length})
    </button>
  ) : (
    <div className="fixed bottom-6 right-6 z-[60] w-80 rounded-lg border bg-background shadow-xl flex flex-col max-h-[min(420px,calc(100vh-3rem))]">
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
        <span className="text-sm font-medium">已选 ({items.length})</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          收起
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 min-h-0">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-muted/50 group"
          >
            <span className="text-sm truncate" title={item.product_name}>
              {item.product_name}
            </span>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="text-muted-foreground hover:text-foreground shrink-0 opacity-60 group-hover:opacity-100 transition-opacity"
              aria-label={`移除 ${item.product_name}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t flex-shrink-0">
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          清空
        </button>
        {(onPortfolio || onFundCompare) && (
          <div className="flex items-center gap-2">
            {onPortfolio && (
              <button
                type="button"
                disabled={portfolioDisabled}
                onClick={onPortfolio}
                className="px-3 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                模拟组合
              </button>
            )}
            {onFundCompare && (
              <button
                type="button"
                disabled={fundCompareDisabled}
                onClick={onFundCompare}
                className="px-3 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                基金对比
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(content, document.body)
}

type ProductSelectionPanelBoundProps<T> = {
  data: T[]
  selected: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  getId: (row: T) => string
  getName: (row: T) => string
  getBeianHao?: (row: T) => string | null
  getLatestNavDate?: (row: T) => string | null
  showActions?: boolean
  compareScope?: "team" | "mine"
}

export function ProductSelectionPanelBound<T>({
  data,
  selected,
  setSelected,
  getId,
  getName,
  getBeianHao,
  getLatestNavDate,
  showActions = true,
  compareScope = "team",
}: ProductSelectionPanelBoundProps<T>) {
  const selectedProducts = useMemo(() => {
    const rows = data.filter((row) => selected.has(getId(row)))
    return rows.map((row): SelectableProduct => ({
      id: getId(row),
      product_name: getName(row),
      beian_hao: getBeianHao?.(row) ?? null,
      latest_nav_date: getLatestNavDate?.(row) ?? null,
    }))
  }, [data, selected, getId, getName, getBeianHao, getLatestNavDate])

  const hasBeian = selectedProducts.some((p) => p.beian_hao)

  function removeId(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  return (
    <ProductSelectionPanel
      items={selectedProducts}
      onRemove={removeId}
      onClear={() => setSelected(new Set())}
      onPortfolio={showActions ? () => openPortfolioWithProducts(selectedProducts) : undefined}
      onFundCompare={showActions ? () => openFundCompareWithProducts(selectedProducts, compareScope) : undefined}
      portfolioDisabled={!hasBeian}
      fundCompareDisabled={!hasBeian}
    />
  )
}
