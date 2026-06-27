"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Search } from "lucide-react"

function PrefixHighlight({ name, query }: { name: string; query: string }) {
  if (!query) return <>{name}</>
  const qLen = query.length
  if (name.length >= qLen && name.slice(0, qLen).toLowerCase() === query.toLowerCase()) {
    return (
      <>
        <span className="text-red-500">{name.slice(0, qLen)}</span>
        {name.slice(qLen)}
      </>
    )
  }
  return <>{name}</>
}

function usePrefixAutocomplete(searchUrl: string, value: string) {
  const [input, setInput] = useState(value)
  const [results, setResults] = useState<string[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(0)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { setInput(value) }, [value])

  const updateDropdownPos = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setDropdownPos((prev) => {
      const next = { top: rect.bottom + 2, left: rect.left, width: rect.width }
      if (prev && prev.top === next.top && prev.left === next.left && prev.width === next.width) return prev
      return next
    })
  }, [])

  useEffect(() => {
    if (!input.trim()) {
      setResults([])
      setShowDropdown(false)
      return
    }
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`${searchUrl}?q=${encodeURIComponent(input.trim())}`)
        const json = await res.json()
        const names = Array.isArray(json) ? json.filter((x): x is string => typeof x === "string") : []
        setResults(names)
        setHoverIdx(0)
        setShowDropdown(focused && names.length > 0)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => { if (searchRef.current) clearTimeout(searchRef.current) }
  }, [input, focused, searchUrl])

  useEffect(() => {
    if (!showDropdown) {
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
  }, [showDropdown, updateDropdownPos])

  useEffect(() => {
    if (!showDropdown || !listRef.current) return
    const item = listRef.current.children[hoverIdx] as HTMLElement | undefined
    item?.scrollIntoView({ block: "nearest" })
  }, [hoverIdx, showDropdown])

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      if (listRef.current?.contains(target)) return
      setShowDropdown(false)
      setFocused(false)
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [])

  function onFocus() {
    setFocused(true)
    updateDropdownPos()
    if (results.length > 0) setShowDropdown(true)
  }

  function closeDropdown() {
    setShowDropdown(false)
    setFocused(false)
  }

  function dropdownPortal(select: (name: string) => void) {
    if (!mounted || !showDropdown || !dropdownPos || results.length === 0) return null
    return createPortal(
      <div
        ref={listRef}
        className="fixed z-[200] bg-background border rounded shadow-lg max-h-56 overflow-y-auto"
        style={{ top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width }}
      >
        {results.map((name, idx) => (
          <button
            key={name}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHoverIdx(idx)}
            onClick={() => select(name)}
            className={`block w-full text-left px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${idx === hoverIdx ? "bg-muted/70" : "hover:bg-muted/50"}`}
          >
            <PrefixHighlight name={name} query={input.trim()} />
          </button>
        ))}
      </div>,
      document.body,
    )
  }

  return {
    input,
    setInput,
    results,
    showDropdown,
    loading,
    focused,
    hoverIdx,
    setHoverIdx,
    wrapRef,
    onFocus,
    closeDropdown,
    dropdownPortal,
  }
}

export function ProductKeywordSearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (keyword: string) => void
}) {
  const ac = usePrefixAutocomplete("/ma/api/private-funds/products/search", value)

  function applyKeyword(keyword: string) {
    ac.setInput(keyword)
    onChange(keyword)
    ac.closeDropdown()
  }

  function clearKeyword() {
    ac.setInput("")
    onChange("")
    ac.closeDropdown()
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <div
          ref={ac.wrapRef}
          className={`flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-60 transition-colors ${ac.focused ? "border-red-400" : ""}`}
        >
          <input
            className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50 min-w-0"
            placeholder="输入产品/产品备案号，回车搜索"
            value={ac.input}
            onChange={(e) => ac.setInput(e.target.value)}
            onFocus={ac.onFocus}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (ac.showDropdown && ac.results.length > 0) applyKeyword(ac.results[ac.hoverIdx])
                else applyKeyword(ac.input.trim())
                return
              }
              if (!ac.showDropdown || ac.results.length === 0) return
              if (e.key === "ArrowDown") {
                e.preventDefault()
                ac.setHoverIdx((i) => Math.min(i + 1, ac.results.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                ac.setHoverIdx((i) => Math.max(i - 1, 0))
              } else if (e.key === "Escape") {
                ac.closeDropdown()
              }
            }}
          />
          {ac.input.trim() ? (
            <button
              type="button"
              onClick={clearKeyword}
              className="text-muted-foreground hover:text-foreground transition-colors text-sm leading-none shrink-0"
              aria-label="清空"
            >
              ×
            </button>
          ) : ac.loading ? (
            <svg className="h-3 w-3 animate-spin text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
            </svg>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => applyKeyword(ac.input.trim())}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <Search className="h-3 w-3" />
        </button>
      </div>
      {ac.dropdownPortal(applyKeyword)}
    </>
  )
}

export function ManagerSearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (manager: string) => void
}) {
  const ac = usePrefixAutocomplete("/ma/api/private-funds/managers/search", value)

  function selectManager(name: string) {
    ac.setInput(name)
    onChange(name)
    ac.closeDropdown()
  }

  return (
    <>
      <div ref={ac.wrapRef} className="relative w-52">
        <div className={`flex items-center border rounded px-2 h-7 bg-background transition-colors ${ac.focused ? "border-red-400" : ""}`}>
          <input
            className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50 min-w-0"
            placeholder="输入关键字搜索管理人"
            value={ac.input}
            onChange={(e) => {
              ac.setInput(e.target.value)
              if (!e.target.value.trim()) onChange("")
            }}
            onFocus={ac.onFocus}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ac.showDropdown && ac.results.length > 0) {
                e.preventDefault()
                selectManager(ac.results[ac.hoverIdx])
                return
              }
              if (!ac.showDropdown || ac.results.length === 0) return
              if (e.key === "ArrowDown") {
                e.preventDefault()
                ac.setHoverIdx((i) => Math.min(i + 1, ac.results.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                ac.setHoverIdx((i) => Math.max(i - 1, 0))
              } else if (e.key === "Escape") {
                ac.closeDropdown()
              }
            }}
          />
          {ac.loading && (
            <svg className="h-3 w-3 animate-spin text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
            </svg>
          )}
        </div>
      </div>
      {ac.dropdownPortal(selectManager)}
    </>
  )
}
