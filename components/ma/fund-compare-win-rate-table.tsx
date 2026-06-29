"use client"

import { useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
} from "lucide-react"
import { CopyableInlineText } from "@/components/ma/copyable-inline-text"
import {
  WIN_RATE_GRANULARITY_LABELS,
  buildWinRateRow,
  fmtWinRatePct,
  fmtWinRateSigned,
  winRatePctClass,
  type WinRateGranularity,
  type WinRateRow,
} from "@/lib/fund-compare-win-rate"

interface FundInput {
  beian_hao: string
  name: string
  navPoints: { d: string; v: number }[]
}

interface BenchInput {
  key: string
  label: string
  navPoints: { d: string; v: number }[]
}

type SortKey =
  | "name"
  | "totalPeriods"
  | "range"
  | "upPct"
  | "downPct"
  | "avgUpReturn"
  | "avgDownLoss"
  | "maxReturn"
  | "maxLoss"
  | "upStdDev"
  | "downStdDev"

function readSortValue(row: WinRateRow, key: SortKey): string | number {
  const s = row.stats
  switch (key) {
    case "name": return row.name
    case "totalPeriods": return s.totalPeriods
    case "range": return `${row.rangeFrom ?? ""}~${row.rangeTo ?? ""}`
    case "upPct": return s.upPct
    case "downPct": return s.downPct
    case "avgUpReturn": return s.avgUpReturn ?? Number.NEGATIVE_INFINITY
    case "avgDownLoss": return s.avgDownLoss ?? Number.NEGATIVE_INFINITY
    case "maxReturn": return s.maxReturn ?? Number.NEGATIVE_INFINITY
    case "maxLoss": return s.maxLoss ?? Number.NEGATIVE_INFINITY
    case "upStdDev": return s.upStdDev ?? Number.NEGATIVE_INFINITY
    case "downStdDev": return s.downStdDev ?? Number.NEGATIVE_INFINITY
    default: return ""
  }
}

export function FundCompareWinRateTable({
  funds,
  benchmark,
  analyzed,
  appliedFrom,
  appliedTo,
}: {
  funds: FundInput[]
  benchmark: BenchInput | null
  analyzed: boolean
  appliedFrom: string
  appliedTo: string
}) {
  const [granularity, setGranularity] = useState<WinRateGranularity>("week")
  const [showExcess, setShowExcess] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const labels = WIN_RATE_GRANULARITY_LABELS[granularity]

  const rows = useMemo(() => {
    const benchPoints = benchmark?.navPoints
    const built: WinRateRow[] = funds.map((fund) =>
      buildWinRateRow(
        fund.beian_hao,
        fund.name,
        fund.navPoints,
        granularity,
        appliedFrom,
        appliedTo,
        false,
        showExcess,
        benchPoints,
      ),
    )

    if (benchmark && benchPoints && benchPoints.length > 0 && !showExcess) {
      built.push(
        buildWinRateRow(
          benchmark.key,
          benchmark.label,
          benchPoints,
          granularity,
          appliedFrom,
          appliedTo,
          true,
          false,
        ),
      )
    }

    const dir = sortDir === "asc" ? 1 : -1
    return [...built].sort((a, b) => {
      if (a.isBenchmark && !b.isBenchmark) return 1
      if (!a.isBenchmark && b.isBenchmark) return -1
      const av = readSortValue(a, sortKey)
      const bv = readSortValue(b, sortKey)
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
      return String(av).localeCompare(String(bv), "zh-CN") * dir
    })
  }, [funds, benchmark, granularity, appliedFrom, appliedTo, showExcess, sortKey, sortDir])

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
      labels.total,
      "统计区间",
      labels.upShare,
      labels.downShare,
      labels.avgUp,
      labels.avgDown,
      labels.maxUp,
      labels.maxDown,
      labels.upStd,
      labels.downStd,
    ]
    const lines = rows.map((row) => {
      const s = row.stats
      const range = row.rangeFrom && row.rangeTo ? `${row.rangeFrom} ~ ${row.rangeTo}` : "—"
      const cols = [
        row.name,
        `${s.totalPeriods} ${labels.unit}`,
        range,
        fmtWinRatePct(s.upPct),
        fmtWinRatePct(s.downPct),
        fmtWinRateSigned(s.avgUpReturn),
        fmtWinRateSigned(s.avgDownLoss),
        fmtWinRateSigned(s.maxReturn),
        fmtWinRateSigned(s.maxLoss),
        fmtWinRatePct(s.upStdDev),
        fmtWinRatePct(s.downStdDev),
      ]
      return cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    })
    const csv = "\uFEFF" + [headers.join(","), ...lines].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `胜率对比_${granularity === "week" ? "周度" : "月度"}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const thBase = "px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap select-none border-b bg-muted/40"
  const thSort = thBase + " cursor-pointer hover:text-foreground transition-colors"
  const tdBase = "px-3 py-2 border-b text-sm whitespace-nowrap tabular-nums"

  const hasData = rows.some((r) => r.stats.totalPeriods > 0)
  if (!analyzed || funds.length === 0 || !hasData) return null

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b">
          <div className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-800" />
            胜率对比
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600">
            <button
              type="button"
              onClick={handleExport}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> 导出
            </button>
            {benchmark && (
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showExcess}
                  onChange={(e) => setShowExcess(e.target.checked)}
                  className="rounded h-3 w-3 accent-red-500"
                />
                超额
              </label>
            )}
            <div className="inline-flex rounded border border-zinc-200 overflow-hidden">
              {(["week", "month"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGranularity(g)}
                  className={[
                    "px-2.5 py-1 text-xs transition-colors border-r border-zinc-200 last:border-r-0",
                    granularity === g
                      ? "bg-red-500 text-white font-medium"
                      : "bg-white text-zinc-600 hover:bg-zinc-50",
                  ].join(" ")}
                >
                  {g === "week" ? "周度" : "月度"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full" style={{ minWidth: 1280 }}>
            <thead>
              <tr>
                <th className={`${thSort} min-w-[160px]`} onClick={() => handleSort("name")}>
                  产品名称<SortIcon col="name" />
                </th>
                <th className={`${thSort} min-w-[80px]`} onClick={() => handleSort("totalPeriods")}>
                  {labels.total}<SortIcon col="totalPeriods" />
                </th>
                <th className={`${thSort} min-w-[180px]`} onClick={() => handleSort("range")}>
                  统计区间<SortIcon col="range" />
                </th>
                <th className={`${thSort} min-w-[96px]`} onClick={() => handleSort("upPct")}>
                  {labels.upShare}<SortIcon col="upPct" />
                </th>
                <th className={`${thSort} min-w-[96px]`} onClick={() => handleSort("downPct")}>
                  {labels.downShare}<SortIcon col="downPct" />
                </th>
                <th className={`${thSort} min-w-[108px]`} onClick={() => handleSort("avgUpReturn")}>
                  {labels.avgUp}<SortIcon col="avgUpReturn" />
                </th>
                <th className={`${thSort} min-w-[108px]`} onClick={() => handleSort("avgDownLoss")}>
                  {labels.avgDown}<SortIcon col="avgDownLoss" />
                </th>
                <th className={`${thSort} min-w-[96px]`} onClick={() => handleSort("maxReturn")}>
                  {labels.maxUp}<SortIcon col="maxReturn" />
                </th>
                <th className={`${thSort} min-w-[96px]`} onClick={() => handleSort("maxLoss")}>
                  {labels.maxDown}<SortIcon col="maxLoss" />
                </th>
                <th className={`${thSort} min-w-[96px]`} onClick={() => handleSort("upStdDev")}>
                  {labels.upStd}<SortIcon col="upStdDev" />
                </th>
                <th className={`${thSort} min-w-[96px]`} onClick={() => handleSort("downStdDev")}>
                  {labels.downStd}<SortIcon col="downStdDev" />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const s = row.stats
                return (
                  <tr key={row.key} className="hover:bg-muted/20">
                    <td className={`${tdBase} font-medium`}>
                      <CopyableInlineText
                        text={row.name}
                        copyTitle="复制产品名称"
                        label={
                          <span className="inline-flex items-center gap-1.5" title={row.name}>
                            {row.name}
                            {row.isBenchmark && (
                              <span className="inline-block px-1 py-0.5 rounded text-[10px] border border-zinc-200 bg-zinc-50 text-zinc-500">
                                基准
                              </span>
                            )}
                          </span>
                        }
                      />
                    </td>
                    <td className={tdBase}>
                      {s.totalPeriods > 0 ? `${s.totalPeriods} ${labels.unit}` : "—"}
                    </td>
                    <td className={`${tdBase} text-xs text-muted-foreground`}>
                      {row.rangeFrom && row.rangeTo ? `${row.rangeFrom} ~ ${row.rangeTo}` : "—"}
                    </td>
                    <td className={`${tdBase} text-red-500`}>{fmtWinRatePct(s.upPct)}</td>
                    <td className={`${tdBase} text-green-500`}>{fmtWinRatePct(s.downPct)}</td>
                    <td className={`${tdBase} ${winRatePctClass(s.avgUpReturn)}`}>{fmtWinRateSigned(s.avgUpReturn)}</td>
                    <td className={`${tdBase} ${winRatePctClass(s.avgDownLoss)}`}>{fmtWinRateSigned(s.avgDownLoss)}</td>
                    <td className={`${tdBase} ${winRatePctClass(s.maxReturn)}`}>{fmtWinRateSigned(s.maxReturn)}</td>
                    <td className={`${tdBase} ${winRatePctClass(s.maxLoss)}`}>{fmtWinRateSigned(s.maxLoss)}</td>
                    <td className={tdBase}>{fmtWinRatePct(s.upStdDev)}</td>
                    <td className={tdBase}>{fmtWinRatePct(s.downStdDev)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
