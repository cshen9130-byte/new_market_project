"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"

type ProductHit = {
  kind: "product"
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_one: string | null
}

type ManagerHit = {
  kind: "manager"
  registration_no: string
  manager_name: string
}

type SearchHit = ProductHit | ManagerHit

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-red-500">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  )
}

function resultsHref(q: string) {
  return `/ma/dashboard/private-funds/search?q=${encodeURIComponent(q)}`
}

function openInNewTab(href: string) {
  window.open(href, "_blank", "noopener,noreferrer")
}

export function HeaderGlobalSearch({ className }: { className?: string }) {
  const [query, setQuery] = useState("")
  const [products, setProducts] = useState<ProductHit[]>([])
  const [managers, setManagers] = useState<ManagerHit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(0)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = useRef(0)

  const hits = useMemo<SearchHit[]>(() => [...products, ...managers], [products, managers])

  useEffect(() => {
    setMounted(true)
  }, [])

  const updateDropdownPos = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.max(rect.width, 320)
    const left = Math.min(rect.left, window.innerWidth - width - 12)
    setDropdownPos({ top: rect.bottom + 4, left: Math.max(12, left), width })
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setProducts([])
      setManagers([])
      setOpen(false)
      setLoading(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current
      setLoading(true)
      try {
        const res = await fetch(`/ma/api/private-funds/global-search?q=${encodeURIComponent(q)}`)
        const json = await res.json()
        if (seq !== seqRef.current) return
        const nextProducts: ProductHit[] = Array.isArray(json.products)
          ? json.products
              .filter((row: { beian_hao?: string; product_name?: string }) => row.beian_hao && row.product_name)
              .map((row: ProductHit) => ({ ...row, kind: "product" as const }))
          : []
        const nextManagers: ManagerHit[] = Array.isArray(json.managers)
          ? json.managers
              .filter((row: { registration_no?: string; manager_name?: string }) => row.registration_no && row.manager_name)
              .map((row: ManagerHit) => ({ ...row, kind: "manager" as const }))
          : []
        setProducts(nextProducts)
        setManagers(nextManagers)
        setHoverIdx(0)
        setOpen(focused)
      } catch {
        if (seq !== seqRef.current) return
        setProducts([])
        setManagers([])
      } finally {
        if (seq === seqRef.current) setLoading(false)
      }
    }, 220)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, focused])

  useEffect(() => {
    if (!open) {
      setDropdownPos(null)
      return
    }
    updateDropdownPos()
    const onReposition = () => updateDropdownPos()
    window.addEventListener("scroll", onReposition, true)
    window.addEventListener("resize", onReposition)
    return () => {
      window.removeEventListener("scroll", onReposition, true)
      window.removeEventListener("resize", onReposition)
    }
  }, [open, hits.length, updateDropdownPos])

  useEffect(() => {
    if (!open || !listRef.current) return
    const item = listRef.current.querySelector<HTMLElement>(`[data-hit-index="${hoverIdx}"]`)
    item?.scrollIntoView({ block: "nearest" })
  }, [hoverIdx, open])

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      if (listRef.current?.contains(target)) return
      setOpen(false)
      setFocused(false)
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [])

  function hrefFor(hit: SearchHit) {
    return hit.kind === "product"
      ? `/ma/dashboard/private-funds/${encodeURIComponent(hit.beian_hao)}`
      : `/ma/dashboard/private-funds/managers/${encodeURIComponent(hit.registration_no)}`
  }

  function goTo(hit: SearchHit) {
    setOpen(false)
    setFocused(false)
    openInNewTab(hrefFor(hit))
  }

  function submitSearch() {
    const q = query.trim()
    if (!q) return
    setOpen(false)
    setFocused(false)
    openInNewTab(resultsHref(q))
  }

  function onFocus() {
    setFocused(true)
    updateDropdownPos()
    if (query.trim()) setOpen(true)
  }

  const showEmpty = open && focused && query.trim() && !loading && hits.length === 0

  return (
    <>
      <div ref={wrapRef} className={cn("relative shrink-0", className)}>
        <div
          className={cn(
            "flex items-center h-8 w-52 sm:w-64 md:w-72 rounded-md border bg-background px-2.5 gap-1.5 transition-colors",
            focused ? "border-red-400" : "border-border",
          )}
        >
          <input
            className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
            placeholder="产品/管理人/备案号，按回车搜索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={onFocus}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                submitSearch()
                return
              }
              if (e.key === "Escape") {
                setOpen(false)
                ;(e.target as HTMLInputElement).blur()
                return
              }
              if (!open || hits.length === 0) return
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setHoverIdx((i) => Math.min(i + 1, hits.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setHoverIdx((i) => Math.max(i - 1, 0))
              }
            }}
          />
          {query.trim() ? (
            <button
              type="button"
              onClick={() => {
                setQuery("")
                setProducts([])
                setManagers([])
                setOpen(false)
              }}
              className="text-muted-foreground hover:text-foreground text-sm leading-none shrink-0"
              aria-label="清空"
            >
              ×
            </button>
          ) : null}
          {loading ? (
            <svg className="h-3.5 w-3.5 animate-spin text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
            </svg>
          ) : (
            <button
              type="button"
              onClick={submitSearch}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label="搜索"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {mounted && open && dropdownPos && (hits.length > 0 || showEmpty)
        ? createPortal(
            <div
              ref={listRef}
              className="fixed z-[200] overflow-hidden rounded-md border bg-background shadow-lg"
              style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
            >
              {showEmpty ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">未找到匹配的产品或管理人</div>
              ) : (
                <div className="max-h-80 overflow-y-auto py-1">
                  {products.length > 0 && (
                    <div>
                      <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-zinc-400">产品</div>
                      {products.map((hit, idx) => (
                        <button
                          key={`p-${hit.beian_hao}`}
                          type="button"
                          data-hit-index={idx}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setHoverIdx(idx)}
                          onClick={() => goTo(hit)}
                          className={cn(
                            "flex w-full items-start justify-between gap-3 px-3 py-1.5 text-left transition-colors",
                            idx === hoverIdx ? "bg-muted/70" : "hover:bg-muted/50",
                          )}
                        >
                          <span className="min-w-0 text-xs text-foreground truncate">
                            <HighlightMatch text={hit.short_name || hit.product_name} query={query.trim()} />
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                            <HighlightMatch text={hit.beian_hao} query={query.trim()} />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {managers.length > 0 && (
                    <div>
                      <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-zinc-400">管理人</div>
                      {managers.map((hit, idx) => {
                        const absIdx = products.length + idx
                        return (
                          <button
                            key={`m-${hit.registration_no}`}
                            type="button"
                            data-hit-index={absIdx}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setHoverIdx(absIdx)}
                            onClick={() => goTo(hit)}
                            className={cn(
                              "flex w-full items-start justify-between gap-3 px-3 py-1.5 text-left transition-colors",
                              absIdx === hoverIdx ? "bg-muted/70" : "hover:bg-muted/50",
                            )}
                          >
                            <span className="min-w-0 text-xs text-foreground truncate">
                              <HighlightMatch text={hit.manager_name} query={query.trim()} />
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                              <HighlightMatch text={hit.registration_no} query={query.trim()} />
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
