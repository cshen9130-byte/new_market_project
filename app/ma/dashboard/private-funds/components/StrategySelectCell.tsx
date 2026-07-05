"use client"

import type { CSSProperties } from "react"
import type { CellFormat } from "@/lib/ma/due-diligence-table"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"

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
  matchStatus = "none",
  dbValue,
  levelLabel,
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
  matchStatus?: "match" | "mismatch" | "none"
  dbValue?: string
  levelLabel?: string
  onActivate: () => void
  onChange: (value: string) => void
}) {
  const style: CSSProperties = {
    width: width - 4,
    ...formatToStyle(format),
  }

  const matchClass =
    !isActive && !isSelected && !format.bgColor
      ? matchStatus === "match"
        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
        : matchStatus === "mismatch"
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : ""
      : ""

  const baseClass = [
    "block h-7 w-full rounded border bg-transparent px-1 text-xs outline-none transition-colors",
    "hover:border-zinc-200 hover:bg-white/80",
    isActive
      ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-300"
      : isSelected
        ? "border-blue-300/60"
        : matchClass || "border-transparent",
    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
    !value
      ? "text-zinc-400"
      : matchStatus === "none" && !matchClass
        ? "text-zinc-800"
        : "",
  ].join(" ")

  const select = (
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

  const showDbHover = matchStatus === "mismatch" && dbValue !== undefined && !isActive

  if (showDbHover) {
    const tableDisplay = value.trim() || "（空）"
    const dbDisplay = dbValue.trim() || "（空）"
    return (
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div className="w-full">{select}</div>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="start"
          sideOffset={6}
          className="pointer-events-none w-auto max-w-xs border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-950 shadow-md"
        >
          <p className="mb-1 font-medium text-amber-900">
            {levelLabel ? `${levelLabel} · 与数据库不一致` : "与数据库不一致"}
          </p>
          <div className="space-y-1 leading-snug">
            <p>
              <span className="text-amber-800/80">表格：</span>
              {tableDisplay}
            </p>
            <p>
              <span className="text-amber-800/80">数据库：</span>
              <span className="font-medium">{dbDisplay}</span>
            </p>
          </div>
        </HoverCardContent>
      </HoverCard>
    )
  }

  return select
}
