"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  FileText,
  Plus,
} from "lucide-react"
import { CopyableInlineText } from "@/components/ma/copyable-inline-text"
import {
  fmtIntervalPct,
  fmtIntervalRatio,
  type IntervalMetricsRow,
} from "@/lib/fund-compare-interval-metrics"

type ColumnKey =
  | "ret_1w"
  | "ret_1m"
  | "ret_3m"
  | "ret_6m"
  | "ret_1y"
  | "sharpe_1y"
  | "calmar_1y"

const DEFAULT_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "ret_1w", label: "近一周收益" },
  { key: "ret_1m", label: "近一月收益" },
  { key: "ret_3m", label: "近三月收益" },
  { key: "ret_6m", label: "近六月收益" },
  { key: "ret_1y", label: "近一年收益" },
  { key: "sharpe_1y", label: "近一年夏普比率" },
  { key: "calmar_1y", label: "近一年卡玛比率" },
]

type SortKey = "name" | ColumnKey

function pctClass(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "text-foreground"
  if (v > 0) return "text-red-500"
  if (v < 0) return "text-green-500"
  return "text-foreground"
}

function readSortValue(row: IntervalMetricsRow, key: SortKey): string | number {
  if (key === "name") return row.name
  const v = row.metrics[key]
  return v ?? Number.NEGATIVE_INFINITY
}

function formatCell(key: ColumnKey, value: number | null) {
  if (key === "sharpe_1y" || key === "calmar_1y") return fmtIntervalRatio(value)
  return fmtIntervalPct(value)
}

export function FundCompareIntervalMetricsTable({
  funds,
  benchmarkKey,
  analyzed,
}: {
  funds: Array<{ beian_hao: string; name: string }>
  benchmarkKey: string
  analyzed: boolean
}) {
  const [rows, setRows] = useState<IntervalMetricsRow[]>([])
  const [benchmarkRow, setBenchmarkRow] = useState<IntervalMetricsRow | null>(null)
  const [cutoffDate, setCutoffDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showBenchmark, setShowBenchmark] = useState(true)
  const [showNavRange, setShowNavRange] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  useEffect(() => {
    if (!analyzed || funds.length === 0) {
      setRows([])
      setBenchmarkRow(null)
      setCutoffDate(null)
      return
    }

    let cancelled = false
    setLoading(true)
    fetch("/ma/api/fund-compare/interval-metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        beian_haos: funds.map((f) => f.beian_hao),
        products: funds.map((f) => ({
          beian_hao: f.beian_hao,
          product_name: f.name,
        })),
        benchmark: benchmarkKey || undefined,
      }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        const data = Array.isArray(json.data) ? json.data as IntervalMetricsRow[] : []
        const nameMap = new Map(funds.map((f) => [f.beian_hao, f.name]))
        setRows(data.map((row) => ({
          ...row,
          name: nameMap.get(row.key) ?? row.name,
        })))
        setBenchmarkRow(json.benchmark ?? null)
        setCutoffDate(json.cutoffDate ?? null)
      })
      .catch(() => {
        if (!cancelled) {
          setRows([])
          setBenchmarkRow(null)
          setCutoffDate(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [analyzed, funds, benchmarkKey])

  const displayRows = useMemo(() => {
    const merged = [...rows]
    if (showBenchmark && benchmarkRow) merged.push(benchmarkRow)
    const dir = sortDir === "asc" ? 1 : -1
    return [...merged].sort((a, b) => {
      if (a.isBenchmark && !b.isBenchmark) return 1
      if (!a.isBenchmark && b.isBenchmark) return -1
      const av = readSortValue(a, sortKey)
      const bv = readSortValue(b, sortKey)
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
      return String(av).localeCompare(String(bv), "zh-CN") * dir
    })
  }, [rows, benchmarkRow, showBenchmark, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5" />
  }

  function handleExport() {
    const headers = [
      "产品名称",
      ...(showNavRange ? ["净值区间"] : []),
      ...DEFAULT_COLUMNS.map((c) => c.label),
    ]
    const lines = displayRows.map((row) => {
      const cols = [
        row.name,
        ...(showNavRange ? [`${row.navFrom ?? ""} ~ ${row.navTo ?? ""}`] : []),
        ...DEFAULT_COLUMNS.map((c) => formatCell(c.key, row.metrics[c.key])),
      ]
      return cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    })
    const csv = "\uFEFF" + [headers.join(","), ...lines].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "区间指标对比.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const thBase = "px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap select-none border-b bg-muted/40"
  const thSort = thBase + " cursor-pointer hover:text-foreground transition-colors text-right"
  const tdBase = "px-3 py-2 border-b text-sm whitespace-nowrap tabular-nums text-right"

  if (!analyzed) return null

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-4 py-4 border-b">
          <div>
            <h3 className="text-sm font-semibold text-foreground">区间指标对比</h3>
            <p className="text-xs text-muted-foreground mt-1">
              统计截止：{cutoffDate ?? "—"}
              {loading ? " · 加载中…" : ""}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-600 flex-wrap justify-end">
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-red-500">
              <input
                type="checkbox"
                checked={showBenchmark}
                onChange={(e) => setShowBenchmark(e.target.checked)}
                className="rounded h-3 w-3 accent-red-500"
              />
              基准指数
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showNavRange}
                onChange={(e) => setShowNavRange(e.target.checked)}
                className="rounded h-3 w-3"
              />
              显示区间
            </label>
            <div className="relative">
              <select className="h-7 appearance-none rounded border bg-background pl-2 pr-7 text-xs">
                <option>默认模板</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              title="添加指标"
            >
              <Plus className="h-3.5 w-3.5" /> 添加指标
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={displayRows.length === 0}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-40"
            >
              <FileText className="h-3.5 w-3.5" /> 导出
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full" style={{ minWidth: 1100 }}>
            <thead>
              <tr>
                <th className={`${thSort} text-left min-w-[160px]`} onClick={() => handleSort("name")}>
                  产品名称<SortIcon col="name" />
                </th>
                {showNavRange && (
                  <th className={`${thBase} min-w-[180px]`}>净值区间</th>
                )}
                {DEFAULT_COLUMNS.map((col) => (
                  <th key={col.key} className={`${thSort} min-w-[96px]`} onClick={() => handleSort(col.key)}>
                    {col.label}<SortIcon col={col.key} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={(showNavRange ? 1 : 0) + DEFAULT_COLUMNS.length + 1} className="py-10 text-center text-muted-foreground">
                    {loading ? "加载中…" : "暂无区间指标数据"}
                  </td>
                </tr>
              ) : displayRows.map((row) => (
                <tr key={row.key} className="hover:bg-muted/20">
                  <td className="px-3 py-2 border-b text-sm text-left">
                    <CopyableInlineText
                      text={row.name}
                      copyTitle="复制产品名称"
                      label={
                        <span className="inline-flex items-center gap-1.5" title={row.name}>
                          {row.isBenchmark ? `${row.name}(基准)` : row.name}
                          {row.isBenchmark && (
                            <span className="inline-block px-1 py-0.5 rounded text-[10px] border border-zinc-200 bg-zinc-50 text-zinc-500">
                              基准
                            </span>
                          )}
                        </span>
                      }
                    />
                  </td>
                  {showNavRange && (
                    <td className="px-3 py-2 border-b text-xs text-muted-foreground whitespace-nowrap">
                      {row.navFrom && row.navTo ? `${row.navFrom} ~ ${row.navTo}` : "—"}
                    </td>
                  )}
                  {DEFAULT_COLUMNS.map((col) => {
                    const value = row.metrics[col.key]
                    const isPct = col.key.startsWith("ret_")
                    return (
                      <td
                        key={col.key}
                        className={[tdBase, isPct ? pctClass(value) : ""].join(" ")}
                      >
                        {formatCell(col.key, value)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
