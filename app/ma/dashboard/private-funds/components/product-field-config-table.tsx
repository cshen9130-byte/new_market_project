"use client"

import type { ReactNode } from "react"
import {
  getProductFieldTextValue,
  isProductFieldMoney,
  isProductFieldNav,
  isProductFieldPct,
  PRODUCT_FIELD_SORT_KEYS,
} from "@/lib/ma/product-field-config"

function PctCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const n = parseFloat(value)
  if (isNaN(n)) return <span className="text-muted-foreground">—</span>
  const cls = n > 0 ? "text-red-500" : n < 0 ? "text-green-600" : "text-foreground"
  return <span className={cls}>{n > 0 ? "+" : ""}{(n * 100).toFixed(2)}%</span>
}

function fmtMoney(v: string | null | undefined): string {
  if (!v) return "—"
  const n = parseFloat(v)
  if (isNaN(n)) return "—"
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function ProductFieldConfigHeader({
  label,
  thSort,
  thBase,
  sortCol,
  onSort,
  SortIcon,
  rightAlign,
}: {
  label: string
  thSort: string
  thBase: string
  sortCol: string
  onSort: (col: string) => void
  SortIcon: ({ col }: { col: string }) => ReactNode
  rightAlign?: boolean
}) {
  const sortKey = PRODUCT_FIELD_SORT_KEYS[label]
  const align = rightAlign || isProductFieldPct(label) ? " text-right" : ""
  const minW = label === "最新单位净值" ? " min-w-[90px]" : label === "最新涨跌幅" ? " min-w-[88px]" : " min-w-[100px]"
  if (sortKey) {
    return (
      <th key={label} className={`${thSort}${align}${minW}`} onClick={() => onSort(sortKey)}>
        {label}<SortIcon col={sortKey} />
      </th>
    )
  }
  return <th key={label} className={`${thBase}${minW}`}>{label}</th>
}

export function ProductFieldConfigCell({
  label,
  row,
  cell,
  valuationDate,
  showTeamNavBadge,
}: {
  label: string
  row: Record<string, unknown>
  cell: string
  valuationDate?: string | null
  showTeamNavBadge?: boolean
}) {
  if (isProductFieldPct(label)) {
    return (
      <td key={label} className={`${cell} text-right tabular-nums`}>
        <PctCell value={getProductFieldTextValue(row, label)} />
      </td>
    )
  }
  if (isProductFieldNav(label)) {
    const nav = getProductFieldTextValue(row, label)
    return (
      <td key={label} className={`${cell} tabular-nums`}>
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{nav ? parseFloat(nav).toFixed(4) : "—"}</span>
          {showTeamNavBadge && nav && (
            <span className="inline-block px-1 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800 shrink-0">团队</span>
          )}
        </div>
      </td>
    )
  }
  if (isProductFieldMoney(label)) {
    const val = getProductFieldTextValue(row, label)
    return (
      <td key={label} className={`${cell} text-right tabular-nums${label === "资产净值" ? " font-medium" : ""}`}>
        <div>{fmtMoney(val)}</div>
        {label === "托管账户余额" && valuationDate && val && (
          <div className="text-[10px] text-zinc-400 mt-0.5">{valuationDate}</div>
        )}
      </td>
    )
  }
  const val = getProductFieldTextValue(row, label)
  return <td key={label} className={`${cell} tabular-nums`}>{val ?? "—"}</td>
}
