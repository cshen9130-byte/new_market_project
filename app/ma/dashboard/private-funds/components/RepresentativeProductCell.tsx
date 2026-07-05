"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { ExternalLink, Link2, Unlink } from "lucide-react"
import { TrendHoverChart } from "@/components/ma/trend-hover-chart"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import type { CellFormat } from "@/lib/ma/due-diligence-table"
import { privateFundProductHref } from "@/lib/ma/due-diligence-table"
import { parseTableDate } from "@/lib/ma/due-diligence-table-to-calendar"

type FundSearchResult = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_one: string | null
}

type DropdownPos = { top: number; left: number; width: number }

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

export function RepresentativeProductCell({
  cellId,
  value,
  linkedBeianHao,
  ddDate,
  width,
  format,
  isActive,
  isSelected,
  onActivate,
  onChange,
}: {
  cellId: string
  value: string
  linkedBeianHao?: string
  ddDate?: string
  width: number
  format: CellFormat
  isActive: boolean
  isSelected: boolean
  onActivate: () => void
  onChange: (value: string, link?: { beianHao: string } | null) => void
}) {
  const [results, setResults] = useState<FundSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null)
  const [mounted, setMounted] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const style: CSSProperties = {
    width: width - 4,
    ...formatToStyle(format),
  }

  const baseClass = [
    "block w-full rounded border bg-transparent px-1 text-xs text-zinc-800 outline-none transition-colors",
    "hover:border-zinc-200 hover:bg-white/80",
    isActive || isEditing
      ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-300"
      : isSelected
        ? "border-blue-300/60"
        : "border-transparent",
  ].join(" ")

  const isLinked = Boolean(linkedBeianHao && value.trim())
  const productHref = linkedBeianHao ? privateFundProductHref(linkedBeianHao) : null
  const markerDate = parseTableDate(ddDate ?? "")
  const query = value.trim()
  const editing = isActive || isEditing
  const shouldShowDropdown = editing && showDropdown && query.length > 0

  const updateDropdownPos = useCallback(() => {
    const el = inputRef.current ?? rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 288),
    })
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isActive) setIsEditing(true)
  }, [isActive])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  useEffect(() => {
    if (!editing) {
      setShowDropdown(false)
      setResults([])
      setLoading(false)
      return
    }
    if (query.length < 1) {
      setShowDropdown(false)
      setResults([])
      setLoading(false)
      return
    }

    setShowDropdown(true)
    updateDropdownPos()

    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/ma/api/private-funds/products/search?q=${encodeURIComponent(query)}&format=picker`,
        )
        const json = await res.json()
        if (Array.isArray(json)) {
          setResults(json)
        } else {
          setResults([])
        }
      } catch {
        setResults([])
      } finally {
        setLoading(false)
        updateDropdownPos()
      }
    }, 200)

    return () => {
      if (searchRef.current) clearTimeout(searchRef.current)
    }
  }, [query, editing, updateDropdownPos])

  useEffect(() => {
    if (!shouldShowDropdown) return
    updateDropdownPos()
    function onScrollOrResize() {
      updateDropdownPos()
    }
    window.addEventListener("scroll", onScrollOrResize, true)
    window.addEventListener("resize", onScrollOrResize)
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true)
      window.removeEventListener("resize", onScrollOrResize)
    }
  }, [shouldShowDropdown, query, results.length, updateDropdownPos])

  useEffect(() => {
    if (!shouldShowDropdown) return
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      const portal = document.getElementById(`rep-product-dropdown-${cellId}`)
      if (portal?.contains(target)) return
      setShowDropdown(false)
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [shouldShowDropdown, cellId])

  function handleFocus() {
    if (blurRef.current) clearTimeout(blurRef.current)
    setIsEditing(true)
    onActivate()
  }

  function handleBlur() {
    blurRef.current = setTimeout(() => setIsEditing(false), 150)
  }

  function handleInputChange(next: string) {
    if (linkedBeianHao) {
      onChange(next, null)
      return
    }
    onChange(next)
  }

  function handlePick(result: FundSearchResult) {
    if (blurRef.current) clearTimeout(blurRef.current)
    onChange(result.product_name, { beianHao: result.beian_hao })
    setShowDropdown(false)
    setIsEditing(false)
  }

  function handleUnlink() {
    onChange(value, null)
    setShowDropdown(false)
  }

  const dropdownPanel = shouldShowDropdown && dropdownPos && mounted ? (
    <div
      id={`rep-product-dropdown-${cellId}`}
      className="fixed z-[9999] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-xl"
      style={{
        top: dropdownPos.top,
        left: dropdownPos.left,
        width: dropdownPos.width,
      }}
    >
      {loading && (
        <div className="px-3 py-2 text-xs text-zinc-500">搜索中…</div>
      )}
      {!loading && results.length === 0 && (
        <div className="px-3 py-2 text-xs text-zinc-500">未找到匹配产品，可直接保存文本</div>
      )}
      {!loading && results.length > 0 && (
        <ul className="max-h-52 overflow-auto py-1">
          {results.map((result) => (
            <li key={result.beian_hao}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePick(result)}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-red-50"
              >
                <span className="text-xs font-medium text-zinc-800">{result.product_name}</span>
                <span className="text-[11px] text-zinc-500">
                  {result.beian_hao}
                  {result.short_name ? ` · ${result.short_name}` : ""}
                  {result.strategy_one ? ` · ${result.strategy_one}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {isLinked && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleUnlink}
          className="flex w-full items-center gap-1.5 border-t border-zinc-100 px-3 py-2 text-left text-xs text-zinc-600 hover:bg-zinc-50"
        >
          <Unlink className="h-3 w-3" />
          取消关联，仅保留文本
        </button>
      )}
      {!isLinked && query && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowDropdown(false)}
          className="flex w-full items-center gap-1.5 border-t border-zinc-100 px-3 py-2 text-left text-xs text-zinc-600 hover:bg-zinc-50"
        >
          仅保存文本，不关联产品
        </button>
      )}
    </div>
  ) : null

  const linkedProductView = (
    <div
      className={[
        "flex h-7 items-center gap-1 px-1",
        isSelected ? "rounded border border-blue-300/60" : "",
      ].join(" ")}
      style={formatToStyle(format)}
      title="悬停查看净值走势，点击名称打开产品页"
    >
      <Link2 className="h-3 w-3 shrink-0 text-blue-500" aria-hidden />
      <a
        href={productHref!}
        target="_blank"
        rel="noopener noreferrer"
        title={`打开产品页：${value}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 truncate text-xs text-blue-600 hover:text-blue-700 hover:underline"
        style={{ color: format.color ?? undefined }}
      >
        {value}
      </a>
      <ExternalLink className="h-3 w-3 shrink-0 text-blue-400" aria-hidden />
    </div>
  )

  return (
    <>
      <div ref={rootRef} className="relative">
        {isLinked && !editing && productHref ? (
          <HoverCard openDelay={250} closeDelay={120}>
            <HoverCardTrigger asChild>
              {linkedProductView}
            </HoverCardTrigger>
            <HoverCardContent
              side="left"
              align="start"
              sideOffset={8}
              className="w-auto border border-zinc-200 bg-white p-0 shadow-xl"
            >
              <div className="border-b border-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-700">
                净值走势
              </div>
              <TrendHoverChart
                beian_hao={linkedBeianHao!}
                mode="nav"
                days={365}
                markerDate={markerDate}
              />
            </HoverCardContent>
          </HoverCard>
        ) : (
          <input
            ref={inputRef}
            type="text"
            data-cell={cellId}
            value={value}
            style={style}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className={`${baseClass} h-7 py-0`}
            placeholder="搜索产品…"
          />
        )}
      </div>
      {mounted && dropdownPanel ? createPortal(dropdownPanel, document.body) : null}
    </>
  )
}
