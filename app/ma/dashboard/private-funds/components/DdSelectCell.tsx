"use client"

import { useEffect, useRef, type CSSProperties } from "react"
import { ChevronDown } from "lucide-react"
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

export function DdSelectCell({
  cellId,
  value,
  width,
  format,
  isActive,
  isSelected,
  options,
  placeholder,
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
  onActivate: () => void
  onChange: (value: string) => void
}) {
  const selectRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (!isActive) return
    selectRef.current?.focus()
  }, [isActive])

  const style: CSSProperties = {
    width: width - 4,
    ...formatToStyle(format),
  }

  const frameClass = [
    "block h-7 w-full rounded border bg-transparent text-xs outline-none transition-colors",
    "hover:border-zinc-200 hover:bg-white/80",
    isActive
      ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-300"
      : isSelected
        ? "border-blue-300/60"
        : "border-transparent",
  ].join(" ")

  if (!isActive) {
    return (
      <button
        type="button"
        data-cell={cellId}
        title={value || placeholder}
        style={style}
        onMouseDown={(event) => {
          event.stopPropagation()
          onActivate()
        }}
        className={[frameClass, "cursor-pointer px-1 text-left truncate", value ? "text-zinc-800" : "text-zinc-400"].join(" ")}
      >
        {value.trim() || placeholder}
      </button>
    )
  }

  return (
    <div className="relative" style={{ width: width - 4 }}>
      <select
        ref={selectRef}
        data-cell={cellId}
        value={value}
        title={value || placeholder}
        style={{ ...style, width: "100%" }}
        onMouseDown={(event) => event.stopPropagation()}
        onFocus={onActivate}
        onChange={(event) => onChange(event.target.value)}
        className={[frameClass, "appearance-none cursor-pointer pl-1 pr-5", value ? "text-zinc-800" : "text-zinc-400"].join(" ")}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-0.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
    </div>
  )
}
