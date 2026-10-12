"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"

type Suggestion = {
  beian_hao: string
  product_name: string
  short_name: string | null
}

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

export function TrackingKeywordSearch({
  value,
  pool,
  onChange,
  className,
  variant = "filter",
}: {
  value: string
  pool: string
  onChange: (keyword: string) => void
  className?: string
  variant?: "filter" | "toolbar"
}) {
  const [input, setInput] = useState(value)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(0)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = useRef(0)
  const committedRef = useRef(value)
  const focusedRef = useRef(false)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    committedRef.current = value
    if (focusedRef.current) return
    setInput(value)
  }, [value])

  const updateDropdownPos = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.max(rect.width, 420)
    const left = Math.min(rect.left, window.innerWidth - width - 12)
    setDropdownPos({ top: rect.bottom + 4, left: Math.max(12, left), width })
  }, [])

  function commit(next: string) {
    const q = next.trim()
    if (q === committedRef.current.trim()) return
    committedRef.current = q
    onChange(q)
  }

  useEffect(() => {
    const q = input.trim()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q) {
      setSuggestions([])
      setOpen(false)
      setLoading(false)
      if (committedRef.current.trim()) commit("")
      return
    }
    debounceRef.current = setTimeout(() => {
      commit(q)
      const seq = ++seqRef.current
      setLoading(true)
      const params = new URLSearchParams({ q, pool: pool || "all" })
      fetch(`/ma/api/tracking-funds/suggest?${params}`)
        .then((r) => r.json())
        .then((json) => {
          if (seq !== seqRef.current) return
          const rows: Suggestion[] = Array.isArray(json)
            ? json.filter((row) => row && row.beian_hao && row.product_name)
            : []
          setSuggestions(rows)
          setHoverIdx(0)
          setOpen(focusedRef.current && rows.length > 0)
        })
        .catch(() => {
          if (seq !== seqRef.current) return
          setSuggestions([])
        })
        .finally(() => {
          if (seq === seqRef.current) setLoading(false)
        })
    }, 120)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // commit is stable enough for this timer; parent `value` is tracked via committedRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, pool])

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
  }, [open, suggestions.length, updateDropdownPos])

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
      focusedRef.current = false
      setFocused(false)
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [])

  function selectSuggestion(row: Suggestion) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const label = row.short_name || row.product_name
    setInput(label)
    setOpen(false)
    focusedRef.current = false
    setFocused(false)
    commit(label)
  }

  function clear() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    seqRef.current += 1
    setInput("")
    setSuggestions([])
    setOpen(false)
    setLoading(false)
    committedRef.current = ""
    if (value.trim()) onChange("")
  }

  const query = input.trim()
  const showEmpty = open && focused && query && !loading && suggestions.length === 0

  return (
    <>
      <div ref={wrapRef} className={cn("relative", variant === "filter" ? "w-72" : "min-w-0", className)}>
        <div
          className={cn(
            "flex items-center gap-1.5 bg-background transition-colors",
            variant === "toolbar"
              ? "h-8 rounded-lg border px-3"
              : "h-7 rounded border px-2",
            focused ? "border-red-400" : "border-border",
          )}
        >
          {variant === "toolbar" ? <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : null}
          <input
            className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
            placeholder={variant === "toolbar" ? "输入产品/备案号，即时搜索" : "输入产品/备案号，即时搜索"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => {
              focusedRef.current = true
              setFocused(true)
              updateDropdownPos()
              if (suggestions.length > 0 && input.trim()) setOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (debounceRef.current) clearTimeout(debounceRef.current)
                if (open && suggestions.length > 0) selectSuggestion(suggestions[hoverIdx] ?? suggestions[0])
                else commit(input)
                return
              }
              if (e.key === "Escape") {
                setOpen(false)
                return
              }
              if (!open || suggestions.length === 0) return
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setHoverIdx((i) => Math.min(i + 1, suggestions.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setHoverIdx((i) => Math.max(i - 1, 0))
              }
            }}
          />
          {query ? (
            <button
              type="button"
              onClick={clear}
              className="text-muted-foreground hover:text-foreground text-sm leading-none shrink-0"
              aria-label="清空"
            >
              ×
            </button>
          ) : null}
          {loading ? (
            <svg className="h-3 w-3 animate-spin text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
            </svg>
          ) : variant === "filter" ? (
            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          ) : null}
        </div>
      </div>
      {mounted && open && dropdownPos && (suggestions.length > 0 || showEmpty)
        ? createPortal(
            <div
              ref={listRef}
              className="fixed z-[200] overflow-hidden rounded-md border bg-background shadow-lg"
              style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
            >
              {showEmpty ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">未找到匹配的产品</div>
              ) : (
                <div className="max-h-80 overflow-y-auto py-1">
                  <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-zinc-400">产品</div>
                  {suggestions.map((row, idx) => {
                    const label = row.short_name || row.product_name
                    return (
                      <button
                        key={row.beian_hao}
                        type="button"
                        data-hit-index={idx}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHoverIdx(idx)}
                        onClick={() => selectSuggestion(row)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
                          idx === hoverIdx ? "bg-muted/70" : "hover:bg-muted/50",
                        )}
                      >
                        <span className="min-w-0 flex-1 text-xs truncate text-foreground">
                          <HighlightMatch text={label} query={query} />
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          <HighlightMatch text={row.beian_hao} query={query} />
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
