"use client"

import { useEffect, useMemo, useState } from "react"
import { BookOpen } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Catalog = {
  columns: string[]
  rows: Record<string, string>[]
  updated_at: string
  bytes: number
}

const POLL_MS = 5000
const TYPE_COLUMN = "记录类型"

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function NavRulesCatalogButton() {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [checkedAt, setCheckedAt] = useState("")

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch("/ma/api/ops/data-overview/nav-rules", { cache: "no-store" })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok || !Array.isArray(json?.columns) || !Array.isArray(json?.rows)) {
          throw new Error(typeof json?.message === "string" ? json.message : "净值规则表加载失败")
        }
        const next = json as Catalog
        setCatalog((prev) => (
          prev
          && prev.updated_at === next.updated_at
          && prev.bytes === next.bytes
          && prev.rows.length === next.rows.length
            ? prev
            : next
        ))
        setError("")
        setCheckedAt(new Date().toISOString())
      } catch (err: unknown) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "净值规则表加载失败")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    setLoading(true)
    void load()
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open])

  const types = useMemo(() => {
    const seen: string[] = []
    for (const row of catalog?.rows ?? []) {
      const value = row[TYPE_COLUMN] || ""
      if (value && !seen.includes(value)) seen.push(value)
    }
    return seen
  }, [catalog])

  const visibleRows = useMemo(() => {
    const rows = catalog?.rows ?? []
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (typeFilter !== "all" && row[TYPE_COLUMN] !== typeFilter) return false
      if (!needle) return true
      return Object.values(row).some((value) => value.toLowerCase().includes(needle))
    })
  }, [catalog, query, typeFilter])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          "inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition-colors",
          open
            ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
            : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
        ].join(" ")}
      >
        <BookOpen className="h-3.5 w-3.5" />
        系统净值规则
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className="flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-2rem)]"
        >
          <DialogHeader className="shrink-0 border-b px-4 py-3 text-left">
            <DialogTitle className="text-sm font-semibold">系统净值规则</DialogTitle>
            <DialogDescription className="text-[11px] leading-4 text-zinc-500">
              {catalog
                ? `共 ${catalog.rows.length} 条${loading ? " · 更新中" : ""} · 文件时间 ${formatUpdatedAt(catalog.updated_at)} · 最近核对 ${formatUpdatedAt(checkedAt)} · 每 5 秒自动刷新`
                : loading
                  ? "正在读取净值规则表…"
                  : "打开后每 5 秒自动刷新"}
              {error ? ` · ${error}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-4 py-2">
            <button
              type="button"
              onClick={() => setTypeFilter("all")}
              className={[
                "inline-flex items-center rounded border px-2.5 py-1 text-xs font-medium transition-colors",
                typeFilter === "all"
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              全部
            </button>
            {types.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(type)}
                className={[
                  "inline-flex items-center rounded border px-2.5 py-1 text-xs font-medium transition-colors",
                  typeFilter === type
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                    : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                ].join(" ")}
              >
                {type}
              </button>
            ))}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索产品、备案号、规则"
              className="ml-auto h-7 w-56 rounded border bg-background px-2 text-xs text-foreground outline-none placeholder:text-zinc-400 focus:border-red-300"
            />
            <span className="text-[11px] text-zinc-400">{visibleRows.length} 条</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {catalog && (
              <table className="w-max min-w-full border-separate border-spacing-0 text-[11px] leading-4">
                <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900">
                  <tr>
                    {catalog.columns.map((column) => (
                      <th
                        key={column}
                        className="whitespace-nowrap border-b px-3 py-2 text-left font-medium text-zinc-500"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, index) => (
                    <tr key={`${row[TYPE_COLUMN]}-${row["备案号"]}-${row["记录日期"]}-${index}`} className="align-top">
                      {catalog.columns.map((column) => (
                        <td
                          key={column}
                          className={[
                            "border-b border-zinc-100 px-3 py-2 text-zinc-700 dark:border-zinc-800 dark:text-zinc-200",
                            column === TYPE_COLUMN || column === "备案号" || column === "记录日期" || column === "产品名称"
                              ? "whitespace-nowrap"
                              : "min-w-56 max-w-md",
                          ].join(" ")}
                        >
                          {row[column] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={catalog.columns.length} className="px-3 py-8 text-center text-zinc-400">
                        没有匹配的规则
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
