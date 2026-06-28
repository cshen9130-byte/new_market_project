"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  Info,
} from "lucide-react"
import { computeExcessReturnSeries } from "@/lib/fund-compare-drawdown"
import {
  computeCompareMetrics,
  fmtPct,
  fmtRatio,
  fmtRecovery,
  fmtSignedPct,
  type CompareMetrics,
  type CompareMetricsRow,
} from "@/lib/fund-compare-metrics"
import { sliceReturnToCalendarYear } from "@/lib/fund-compare-multidim"
import { yearsInRange } from "@/lib/fund-compare-period-returns"

interface FundInput {
  beian_hao: string
  name: string
  returnPoints: { d: string; v: number }[]
}

interface BenchInput {
  key: string
  label: string
  returnPoints: { d: string; v: number }[]
}

type SortKey =
  | "name"
  | "periodReturn"
  | "annVol"
  | "sharpe"
  | "calmar"
  | "sortino"
  | "downsideRisk"
  | "maxDrawdown"
  | "maxDdRecoveryDays"
  | "longestNoNewHighDays"

function pctClass(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "text-foreground"
  if (v > 0) return "text-red-500"
  if (v < 0) return "text-green-500"
  return "text-foreground"
}

function buildAnnualRow(
  key: string,
  name: string,
  returnPoints: { d: string; v: number }[],
  year: number,
  appliedFrom: string,
  appliedTo: string,
  isBenchmark: boolean,
  showExcess: boolean,
  benchPoints?: { d: string; v: number }[],
): CompareMetricsRow {
  let points = sliceReturnToCalendarYear(returnPoints, year, appliedFrom, appliedTo)
  if (showExcess && benchPoints && !isBenchmark) {
    const yearBench = sliceReturnToCalendarYear(benchPoints, year, appliedFrom, appliedTo)
    points = computeExcessReturnSeries(points, yearBench)
  }
  const metrics = computeCompareMetrics(points)
  return {
    key,
    name,
    isBenchmark,
    navFrom: points[0]?.d ?? null,
    navTo: points.at(-1)?.d ?? null,
    metrics,
  }
}

function readSortValue(row: CompareMetricsRow, key: SortKey): string | number {
  const m = row.metrics
  switch (key) {
    case "name": return row.name
    case "periodReturn": return m.periodReturn ?? Number.NEGATIVE_INFINITY
    case "annVol": return m.annVol ?? Number.NEGATIVE_INFINITY
    case "sharpe": return m.sharpe ?? Number.NEGATIVE_INFINITY
    case "calmar": return m.calmar ?? Number.NEGATIVE_INFINITY
    case "sortino": return m.sortino ?? Number.NEGATIVE_INFINITY
    case "downsideRisk": return m.downsideRisk ?? Number.NEGATIVE_INFINITY
    case "maxDrawdown": return m.maxDrawdown ?? Number.NEGATIVE_INFINITY
    case "maxDdRecoveryDays":
      return m.maxDdRecoveryDays === "未回补" ? Number.POSITIVE_INFINITY : (m.maxDdRecoveryDays ?? Number.NEGATIVE_INFINITY)
    case "longestNoNewHighDays": return m.longestNoNewHighDays ?? Number.NEGATIVE_INFINITY
    default: return ""
  }
}

export function FundCompareAnnualTable({
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
  const yearOptions = useMemo(() => yearsInRange(appliedFrom, appliedTo), [appliedFrom, appliedTo])
  const [year, setYear] = useState(() => yearOptions[0] ?? new Date().getFullYear())
  const [showExcess, setShowExcess] = useState(false)
  const [showYearPicker, setShowYearPicker] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  useEffect(() => {
    if (yearOptions.length > 0 && !yearOptions.includes(year)) {
      setYear(yearOptions[0])
    }
  }, [yearOptions, year])

  const rows = useMemo(() => {
    const benchPoints = benchmark?.returnPoints
    const built: CompareMetricsRow[] = funds.map((fund) =>
      buildAnnualRow(
        fund.beian_hao,
        fund.name,
        fund.returnPoints,
        year,
        appliedFrom,
        appliedTo,
        false,
        showExcess,
        benchPoints,
      ),
    )

    if (benchmark && benchPoints && benchPoints.length > 0 && !showExcess) {
      built.push(
        buildAnnualRow(
          benchmark.key,
          benchmark.label,
          benchPoints,
          year,
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
  }, [funds, benchmark, year, appliedFrom, appliedTo, showExcess, sortKey, sortDir])

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
      "产品名称", "年度收益", "年化波动率", "夏普比率", "卡玛比率", "索提诺比率",
      "下行风险", "最大回撤", "最大回撤回补期(天)", "最长连续不创新高天数",
    ]
    const lines = rows.map((row) => {
      const m: CompareMetrics = row.metrics
      const cols = [
        row.name,
        fmtSignedPct(m.periodReturn),
        fmtPct(m.annVol),
        fmtRatio(m.sharpe),
        fmtRatio(m.calmar),
        fmtRatio(m.sortino),
        fmtPct(m.downsideRisk),
        fmtPct(m.maxDrawdown),
        fmtRecovery(m.maxDdRecoveryDays),
        m.longestNoNewHighDays == null ? "—" : String(m.longestNoNewHighDays),
      ]
      return cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    })
    const csv = "\uFEFF" + [headers.join(","), ...lines].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `年度对比_${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const thBase = "px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap select-none border-b bg-muted/40"
  const thSort = thBase + " cursor-pointer hover:text-foreground transition-colors"
  const tdBase = "px-3 py-2 border-b text-sm whitespace-nowrap tabular-nums"

  const hasData = rows.some((r) => r.metrics.periodReturn != null)
  if (!analyzed || funds.length === 0 || !hasData) return null

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            年度对比
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
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
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showYearPicker}
                onChange={(e) => setShowYearPicker(e.target.checked)}
                className="rounded h-3 w-3"
              />
              显示区间
            </label>
            {showYearPicker && (
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full" style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                <th className={`${thSort} min-w-[160px]`} onClick={() => handleSort("name")}>
                  产品名称<SortIcon col="name" />
                </th>
                <th className={`${thSort} min-w-[88px]`} onClick={() => handleSort("periodReturn")}>
                  年度收益<SortIcon col="periodReturn" />
                </th>
                <th className={`${thSort} min-w-[96px]`} onClick={() => handleSort("annVol")}>
                  年化波动率<SortIcon col="annVol" />
                </th>
                <th className={`${thSort} min-w-[80px]`} onClick={() => handleSort("sharpe")}>
                  夏普比率<SortIcon col="sharpe" />
                </th>
                <th className={`${thSort} min-w-[80px]`} onClick={() => handleSort("calmar")}>
                  卡玛比率<SortIcon col="calmar" />
                </th>
                <th className={`${thSort} min-w-[88px]`} onClick={() => handleSort("sortino")}>
                  索提诺比率<SortIcon col="sortino" />
                </th>
                <th className={`${thSort} min-w-[80px]`} onClick={() => handleSort("downsideRisk")}>
                  下行风险<SortIcon col="downsideRisk" />
                </th>
                <th className={`${thSort} min-w-[80px]`} onClick={() => handleSort("maxDrawdown")}>
                  最大回撤<SortIcon col="maxDrawdown" />
                </th>
                <th className={`${thSort} min-w-[120px]`} onClick={() => handleSort("maxDdRecoveryDays")}>
                  最大回撤回补期(天)<SortIcon col="maxDdRecoveryDays" />
                </th>
                <th className={`${thSort} min-w-[140px]`} onClick={() => handleSort("longestNoNewHighDays")}>
                  最长连续不创新高天数<SortIcon col="longestNoNewHighDays" />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const m = row.metrics
                return (
                  <tr key={row.key} className="hover:bg-muted/20">
                    <td className={`${tdBase} font-medium`}>
                      <span className="inline-flex items-center gap-1.5">
                        {row.name}
                        {row.isBenchmark && (
                          <span className="inline-block px-1 py-0.5 rounded text-[10px] border border-zinc-200 bg-zinc-50 text-zinc-500">
                            基准
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${tdBase} ${pctClass(m.periodReturn)}`}>{fmtSignedPct(m.periodReturn)}</td>
                    <td className={tdBase}>{fmtPct(m.annVol)}</td>
                    <td className={tdBase}>{fmtRatio(m.sharpe)}</td>
                    <td className={tdBase}>{fmtRatio(m.calmar)}</td>
                    <td className={tdBase}>{fmtRatio(m.sortino)}</td>
                    <td className={tdBase}>{fmtPct(m.downsideRisk)}</td>
                    <td className={tdBase}>{fmtPct(m.maxDrawdown)}</td>
                    <td className={tdBase}>{fmtRecovery(m.maxDdRecoveryDays)}</td>
                    <td className={tdBase}>{m.longestNoNewHighDays ?? "—"}</td>
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
