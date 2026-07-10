"use client"

import { useMemo, type CSSProperties } from "react"
import type { CellFormat } from "@/lib/ma/due-diligence-table"
import { parseStrategyLevel3, joinStrategyLevel3 } from "@/lib/ma/strategy-level3"
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

export function StrategyMultiSelectCell({
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
  const selected = useMemo(() => parseStrategyLevel3(value), [value])
  const availableOptions = useMemo(
    () => options.filter((opt) => !selected.includes(opt)),
    [options, selected],
  )

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
    "min-h-[1.75rem] w-full rounded border px-1 py-0.5 text-xs outline-none transition-colors",
    "hover:border-zinc-200 hover:bg-white/80",
    isActive
      ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-300"
      : isSelected
        ? "border-blue-300/60"
        : matchClass || "border-transparent",
    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
  ].join(" ")

  function addTag(tag: string) {
    if (!tag || selected.includes(tag)) return
    onChange(joinStrategyLevel3([...selected, tag]))
  }

  function removeTag(tag: string) {
    onChange(joinStrategyLevel3(selected.filter((item) => item !== tag)))
  }

  const content = (
    <div
      data-cell={cellId}
      style={style}
      className={baseClass}
      onMouseDown={(e) => {
        e.stopPropagation()
        onActivate()
      }}
      onFocus={onActivate}
      tabIndex={disabled ? -1 : 0}
      title={selected.length > 0 ? selected.join("、") : placeholder}
    >
      {selected.length > 0 && (
        <div className="mb-0.5 flex flex-wrap gap-0.5">
          {selected.map((tag) => (
            <span
              key={tag}
              className="inline-flex max-w-full items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1 py-px text-[10px] leading-tight text-blue-700"
            >
              <span className="truncate">{tag}</span>
              {!disabled && (
                <button
                  type="button"
                  className="shrink-0 text-blue-400 hover:text-blue-700"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeTag(tag)
                  }}
                  aria-label={`移除 ${tag}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <select
        value=""
        disabled={disabled || availableOptions.length === 0}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => addTag(e.target.value)}
        className={[
          "block h-6 w-full rounded border border-transparent bg-transparent px-0.5 text-xs outline-none",
          selected.length === 0 ? "text-zinc-400" : "text-zinc-600",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        <option value="">
          {disabled
            ? placeholder
            : availableOptions.length === 0
              ? selected.length > 0
                ? "已全部添加"
                : placeholder
              : selected.length > 0
                ? "添加标签"
                : placeholder}
        </option>
        {availableOptions.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  )

  const showDbHover = matchStatus === "mismatch" && dbValue !== undefined && !isActive

  if (showDbHover) {
    const tableDisplay = selected.length > 0 ? selected.join("、") : "（空）"
    const dbDisplay = parseStrategyLevel3(dbValue).join("、") || "（空）"
    return (
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div className="w-full">{content}</div>
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

  return content
}
