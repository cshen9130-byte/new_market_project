"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown } from "lucide-react"

type PerfPoint = {
  ret_1w: number | null
  ret_1m: number | null
  ret_3m: number | null
  ret_6m: number | null
  ret_1y: number | null
}

type PerformanceGroup = {
  bucket: string
  mode: "excess" | "absolute"
  count: number
  median: PerfPoint
  products: Array<PerfPoint & { code: string; name: string }>
}

type PerformanceBody = {
  week_start: string
  week_end: string
  fund_count: number
  groups: PerformanceGroup[]
}

const RETURN_COLUMNS: Array<{ key: keyof PerfPoint; label: string }> = [
  { key: "ret_1w", label: "近一周" },
  { key: "ret_1m", label: "近一月" },
  { key: "ret_3m", label: "近三月" },
  { key: "ret_6m", label: "近六月" },
  { key: "ret_1y", label: "近一年" },
]

type SortKey = "bucket" | "mode" | "count" | keyof PerfPoint
type SortDir = "asc" | "desc"

function compareNumber(a: number | null, b: number | null, dir: SortDir): number {
  const aMissing = a == null || !Number.isFinite(a)
  const bMissing = b == null || !Number.isFinite(b)
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  return dir === "asc" ? a - b : b - a
}

function sortGroups(groups: PerformanceGroup[], key: SortKey, dir: SortDir): PerformanceGroup[] {
  const next = groups.map((group) => {
    if (key === "bucket" || key === "mode" || key === "count") return group
    return {
      ...group,
      products: [...group.products].sort((a, b) => compareNumber(a[key], b[key], dir)),
    }
  })
  next.sort((a, b) => {
    if (key === "bucket") {
      const cmp = a.bucket.localeCompare(b.bucket, "zh")
      return dir === "asc" ? cmp : -cmp
    }
    if (key === "mode") {
      const label = (mode: PerformanceGroup["mode"]) => (mode === "excess" ? "超额" : "绝对收益")
      const cmp = label(a.mode).localeCompare(label(b.mode), "zh")
      return dir === "asc" ? cmp : -cmp
    }
    if (key === "count") return compareNumber(a.count, b.count, dir)
    return compareNumber(a.median[key], b.median[key], dir)
  })
  return next
}

function SortableTh({
  label,
  align,
  active,
  dir,
  onClick,
}: {
  label: string
  align: "left" | "right"
  active: boolean
  dir: SortDir
  onClick: () => void
}) {
  const icon = !active
    ? <ChevronsUpDown className="h-3 w-3 opacity-40" />
    : dir === "asc"
      ? <ChevronUp className="h-3 w-3" />
      : <ChevronDown className="h-3 w-3" />
  return (
    <th className={`py-2 font-medium ${align === "right" ? "px-3 text-right" : "px-4 text-left"}`}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-0.5 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        {label}
        {icon}
      </button>
    </th>
  )
}

function Pct({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-zinc-300">—</span>
  const color = value > 0 ? "text-red-600 dark:text-red-400" : value < 0 ? "text-green-600 dark:text-green-400" : "text-zinc-500"
  const text = `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`
  return <span className={`tabular-nums ${color}`}>{text}</span>
}

export function PublicEnhancedWeeklyPerformance({ weekEnd }: { weekEnd: string }) {
  const [body, setBody] = useState<PerformanceBody | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const load = useCallback(async (date: string) => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(
        `/ma/api/tracking-funds/weekly-review/public-enhanced/performance?week_end=${encodeURIComponent(date)}`,
        { cache: "no-store" },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "收益加载失败")
      setBody(json as PerformanceBody)
    } catch (err) {
      setBody(null)
      setError(err instanceof Error ? err.message : "收益加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setOpen(null)
    void load(weekEnd)
  }, [weekEnd, load])

  const groups = useMemo(
    () => (body && sortKey ? sortGroups(body.groups, sortKey, sortDir) : body?.groups ?? []),
    [body, sortKey, sortDir],
  )

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "desc" ? "asc" : "desc"))
      return
    }
    setSortKey(key)
    setSortDir(key === "bucket" || key === "mode" ? "asc" : "desc")
  }

  return (
    <section className={`rounded-xl border bg-background shadow-sm overflow-hidden ${loading && body ? "opacity-60" : ""}`}>
      <div className="px-4 py-2.5 border-b">
        <h3 className="text-xs font-semibold text-foreground">分组表现</h3>
        <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">
          数字是该组产品的中位数。指增组是相对基准的超额，其他指增是绝对收益。点表头排序，再点一次换方向。点开一组后，组内产品按同一列排序。
        </p>
      </div>
      {error && <div className="px-4 py-3 text-xs text-red-600">{error}</div>}
      {loading && !body && !error && (
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">正在计算收益…</div>
      )}
      {body && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead>
              <tr className="text-zinc-400 border-b">
                <SortableTh label="基准" align="left" active={sortKey === "bucket"} dir={sortDir} onClick={() => onSort("bucket")} />
                <SortableTh label="口径" align="left" active={sortKey === "mode"} dir={sortDir} onClick={() => onSort("mode")} />
                <SortableTh label="产品数" align="right" active={sortKey === "count"} dir={sortDir} onClick={() => onSort("count")} />
                {RETURN_COLUMNS.map((column) => (
                  <SortableTh
                    key={column.key}
                    label={column.label}
                    align="right"
                    active={sortKey === column.key}
                    dir={sortDir}
                    onClick={() => onSort(column.key)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const expanded = open === group.bucket
                return (
                  <Fragment key={group.bucket}>
                    <tr
                      key={group.bucket}
                      className="border-t border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                      onClick={() => setOpen(expanded ? null : group.bucket)}
                    >
                      <td className="px-4 py-2 font-medium text-zinc-800 dark:text-zinc-100">
                        <span className="inline-flex items-center gap-1">
                          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
                          {group.bucket}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-zinc-500">{group.mode === "excess" ? "超额" : "绝对收益"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{group.count}</td>
                      {RETURN_COLUMNS.map((column) => (
                        <td key={column.key} className="px-3 py-2 text-right"><Pct value={group.median[column.key]} /></td>
                      ))}
                    </tr>
                    {expanded && group.products.map((product) => (
                      <tr key={product.code} className="border-t border-zinc-50 dark:border-zinc-900">
                        <td className="px-4 py-1.5 pl-9">
                          <a
                            href={`/ma/dashboard/private-funds/${encodeURIComponent(product.code)}`}
                            className="text-zinc-700 hover:text-red-600 dark:text-zinc-200"
                          >
                            {product.name}
                          </a>
                          <span className="ml-2 text-[10px] text-zinc-400">{product.code}</span>
                        </td>
                        <td />
                        <td />
                        {RETURN_COLUMNS.map((column) => (
                          <td key={column.key} className="px-3 py-1.5 text-right"><Pct value={product[column.key]} /></td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
