"use client"

import { useRef, type CSSProperties } from "react"
import { CalendarDays } from "lucide-react"
import type { CellFormat } from "@/lib/ma/due-diligence-table"
import { formatTableDate, parseTableDate, tableDateWeekdayLabel } from "@/lib/ma/due-diligence-table-to-calendar"

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

export function DdDateCell({
  cellId,
  value,
  width,
  format,
  isActive,
  isSelected,
  onActivate,
  onChange,
}: {
  cellId: string
  value: string
  width: number
  format: CellFormat
  isActive: boolean
  isSelected: boolean
  onActivate: () => void
  onChange: (value: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isoValue = parseTableDate(value) ?? ""
  const weekdayLabel = tableDateWeekdayLabel(value)
  const displayValue = isoValue ? value.trim() || formatTableDate(isoValue) : ""

  const style: CSSProperties = {
    width: width - 4,
    ...formatToStyle(format),
  }

  const baseClass = [
    "block h-7 w-full rounded border bg-transparent pl-1 pr-5 text-xs outline-none transition-colors",
    "text-transparent caret-transparent",
    "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
    "hover:border-zinc-200 hover:bg-white/80",
    isActive
      ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-300"
      : isSelected
        ? "border-blue-300/60"
        : "border-transparent",
  ].join(" ")

  return (
    <div className="relative" title={weekdayLabel ?? "选择尽调日期"}>
      <input
        ref={inputRef}
        type="date"
        data-cell={cellId}
        value={isoValue}
        style={style}
        onMouseDown={(e) => {
          e.stopPropagation()
          onActivate()
        }}
        onFocus={onActivate}
        onClick={() => inputRef.current?.showPicker?.()}
        onChange={(e) => {
          const next = e.target.value
          onChange(next ? formatTableDate(next) : "")
        }}
        className={baseClass}
      />
      {displayValue ? (
        <span
          className="pointer-events-none absolute left-1 top-1/2 max-w-[calc(100%-1.25rem)] -translate-y-1/2 truncate text-xs text-zinc-800"
          style={formatToStyle(format)}
        >
          {displayValue}
        </span>
      ) : (
        <span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
          选择日期
        </span>
      )}
      <CalendarDays className="pointer-events-none absolute right-0.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
    </div>
  )
}
