"use client"

import type { CSSProperties } from "react"
import type { CellFormat } from "@/lib/ma/due-diligence-table"

function formatToStyle(fmt: CellFormat): CSSProperties {
  const style: CSSProperties = {}
  if (fmt.bold) style.fontWeight = "700"
  if (fmt.italic) style.fontStyle = "italic"
  const deco: string[] = []
  if (fmt.underline) deco.push("underline")
  if (fmt.strikethrough) deco.push("line-through")
  if (deco.length) style.textDecoration = deco.join(" ")
  if (fmt.color) style.color = fmt.color
  if (fmt.bgColor) style.backgroundColor = fmt.bgColor
  if (fmt.align) style.textAlign = fmt.align
  if (fmt.fontSize) style.fontSize = fmt.fontSize
  return style
}

export function StrategySelectCell({
  cellId,
  value,
  width,
  format,
  isActive,
  isSelected,
  options,
  placeholder,
  disabled = false,
  onActivate,
  onChange,
}: {
  cellId: string
  value: string
  width: number
  format: CellFormat
  isActive: boolean
  isSelected: boolean
  options: string[]
  placeholder: string
  disabled?: boolean
  onActivate: () => void
  onChange: (value: string) => void
}) {
  const style: CSSProperties = {
    width: width - 4,
    ...formatToStyle(format),
  }

  const baseClass = [
    "block h-7 w-full rounded border bg-transparent px-1 text-xs outline-none transition-colors",
    "hover:border-zinc-200 hover:bg-white/80",
    isActive
      ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-300"
      : isSelected
        ? "border-blue-300/60"
        : "border-transparent",
    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
    value ? "text-zinc-800" : "text-zinc-400",
  ].join(" ")

  return (
    <select
      data-cell={cellId}
      value={value}
      disabled={disabled}
      title={value || placeholder}
      style={style}
      onMouseDown={(e) => {
        // Let the native dropdown open; table cell handler calls preventDefault().
        e.stopPropagation()
        onActivate()
      }}
      onFocus={onActivate}
      onChange={(e) => onChange(e.target.value)}
      className={baseClass}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  )
}
