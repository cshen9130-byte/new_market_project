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
  const displayText = selected.join("、")
  const visibleTags = selected.slice(0, 2)
  const hiddenTagCount = Math.max(0, selected.length - visibleTags.length)

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
    "relative block h-7 max-h-7 w-full overflow-hidden rounded border bg-transparent px-1 text-xs outline-none transition-colors",
    "hover:border-zinc-200 hover:bg-white/80",
    isActive
      ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-300"
      : isSelected
        ? "border-blue-300/60"
        : matchClass || "border-transparent",
    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
    !displayText
      ? "text-zinc-400"
      : matchStatus === "none" && !matchClass
        ? "text-zinc-800"
        : "",
  ].join(" ")

  function addTag(tag: string) {
    if (!tag || selected.includes(tag)) return
    onChange(joinStrategyLevel3([...selected, tag]))
  }

  function removeTag(tag: string) {
    onChange(joinStrategyLevel3(selected.filter((item) => item !== tag)))
  }

  const compactCell = (
    <div
      data-cell={cellId}
      style={style}
      className={baseClass}
      title={displayText || placeholder}
    >
      <span className="pointer-events-none absolute inset-y-0 left-1 right-1 flex items-center gap-0.5 overflow-hidden leading-none">
        {selected.length === 0 ? (
          <span className="truncate text-zinc-400">{placeholder}</span>
        ) : (
          <>
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex max-w-[3.5rem] shrink-0 items-center truncate rounded border border-blue-200 bg-blue-50 px-1 text-[10px] leading-none text-blue-700"
              >
                {tag}
              </span>
            ))}
            {hiddenTagCount > 0 && (
              <span className="shrink-0 text-[10px] text-zinc-500">+{hiddenTagCount}</span>
            )}
          </>
        )}
      </span>
      <select
        value=""
        disabled={disabled || availableOptions.length === 0}
        onMouseDown={(e) => {
          e.stopPropagation()
          onActivate()
        }}
        onFocus={onActivate}
        onChange={(e) => addTag(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        aria-label={levelLabel ?? "三级策略"}
      >
        <option value="">
          {availableOptions.length === 0
            ? selected.length > 0
              ? "已全部添加"
              : placeholder
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

  const showHover = selected.length > 0 || (matchStatus === "mismatch" && dbValue !== undefined && !isActive)

  if (!showHover) return compactCell

  const dbTags = dbValue !== undefined ? parseStrategyLevel3(dbValue) : []
  const showDbMismatch = matchStatus === "mismatch" && dbValue !== undefined && !isActive

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div className="h-7 max-h-7 w-full overflow-hidden">{compactCell}</div>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        sideOffset={6}
        className={[
          "w-auto max-w-xs p-2.5 text-xs shadow-md",
          showDbMismatch
            ? "border border-amber-200 bg-amber-50 text-amber-950"
            : "border border-zinc-200 bg-white text-zinc-800",
        ].join(" ")}
      >
        {showDbMismatch && (
          <>
            <p className="mb-1.5 font-medium text-amber-900">
              {levelLabel ? `${levelLabel} · 与数据库不一致` : "与数据库不一致"}
            </p>
            <div className="mb-2 space-y-1 leading-snug text-amber-950">
              <p>
                <span className="text-amber-800/80">表格：</span>
                {selected.length > 0 ? selected.join("、") : "（空）"}
              </p>
              <p>
                <span className="text-amber-800/80">数据库：</span>
                <span className="font-medium">
                  {dbTags.length > 0 ? dbTags.join("、") : "（空）"}
                </span>
              </p>
            </div>
          </>
        )}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selected.map((tag) => (
              <span
                key={tag}
                className={[
                  "inline-flex max-w-full items-center gap-0.5 rounded border px-1.5 py-0.5 text-[11px] leading-tight",
                  showDbMismatch
                    ? "border-amber-200 bg-white text-amber-900"
                    : "border-blue-200 bg-blue-50 text-blue-700",
                ].join(" ")}
              >
                <span>{tag}</span>
                {!disabled && (
                  <button
                    type="button"
                    className={showDbMismatch ? "text-amber-500 hover:text-amber-800" : "text-blue-400 hover:text-blue-700"}
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
      </HoverCardContent>
    </HoverCard>
  )
}
