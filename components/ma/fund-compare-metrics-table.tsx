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
  buildCompareMetricsRows,
  fmtPct,
  fmtRatio,
  fmtRecovery,
  fmtSignedPct,
  type CompareMetricsRow,
} from "@/lib/fund-compare-metrics"

interface FundInput {
  beian_hao: string
  name: string
  returnPoints: { d: string; v: number }[]
}

interface BenchInput {
  returnPoints: { d: string; v: number }[]
  label: string
  key: string
}

type SortKey =
  | "name"
  | "navRange"
  | "periodReturn"
  | "annReturn"
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

function readSortValue(row: CompareMetricsRow, key: SortKey): string | number {
  const m = row.metrics
  switch (key) {
    case "name": return row.name
    case "navRange": return `${row.navFrom ?? ""}~${row.navTo ?? ""}`
    case "periodReturn": return m.periodReturn ?? Number.NEGATIVE_INFINITY
    case "annReturn": return m.annReturn ?? Number.NEGATIVE_INFINITY
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

export function FundCompareMetricsTable({
  funds,
  benchmark,
  analyzed,
}: {
  funds: FundInput[]
  benchmark: BenchInput | null
  analyzed: boolean
}) {
  const [showNavRange, setShowNavRange] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const rows = useMemo(() => {
    const built = buildCompareMetricsRows(
      funds.map((f) => ({ key: f.beian_hao, name: f.name, returnPoints: f.returnPoints })),
      benchmark && benchmark.returnPoints.length > 0
        ? { key: benchmark.key, name: benchmark.label, returnPoints: benchmark.returnPoints }
        : undefined,
    )
    const dir = sortDir === "asc" ? 1 : -1
    return [...built].sort((a, b) => {
      if (a.isBenchmark && !b.isBenchmark) return 1
      if (!a.isBenchmark && b.isBenchmark) return -1
      const av = readSortValue(a, sortKey)
      const bv = readSortValue(b, sortKey)
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
      return String(av).localeCompare(String(bv), "zh-CN") * dir
    })
  }, [funds, benchmark, sortKey, sortDir])

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
      "期间收益", "年化收益", "年化波动率", "夏普比率", "卡玛比率", "索提诺比率",
      "下行风险", "最大回撤", "最大回撤回补期(天)", "最长连续不创新高天数",
    ]
    const lines = rows.map((row) => {
      const m = row.metrics
      const cols = [
        row.name,
        ...(showNavRange ? [`${row.navFrom ?? ""} ~ ${row.navTo ?? ""}`] : []),
        fmtSignedPct(m.periodReturn),
        fmtSignedPct(m.annReturn),
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
    a.download = "对比统计.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const thBase = "px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap select-none border-b bg-muted/40"
  const thSort = thBase + " cursor-pointer hover:text-foreground transition-colors"
  const tdBase = "px-3 py-2 border-b text-sm whitespace-nowrap tabular-nums"

  if (!analyzed) return null

  return (
    <div className="px-6 pb-6 pt-4 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex items-center justify-end gap-4 px-4 py-3 border-b text-xs text-zinc-600">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showNavRange}
              onChange={(e) => setShowNavRange(e.target.checked)}
              className="rounded h-3 w-3"
            />
            显示区间
          </label>
          <button
            type="button"
            onClick={handleExport}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> 导出
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full" style={{ minWidth: 1400 }}>
            <thead>
              <tr>
                <th className={`${thSort} min-w-[160px]`} onClick={() => handleSort("name")}>
                  产品名称<SortIcon col="name" />
                </th>
                {showNavRange && (
                  <th className={`${thSort} min-w-[180px]`} onClick={() => handleSort("navRange")}>
                    净值区间<SortIcon col="navRange" />
                  </th>
                )}
                <th className={`${thSort} min-w-[88px]`} onClick={() => handleSort("periodReturn")}>
                  期间收益<SortIcon col="periodReturn" />
                </th>
                <th className={`${thSort} min-w-[88px]`} onClick={() => handleSort("annReturn")}>
                  年化收益<SortIcon col="annReturn" />
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
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={showNavRange ? 12 : 11} className="py-10 text-center text-muted-foreground">
                    暂无统计数据
                  </td>
                </tr>
              ) : rows.map((row) => {
                const m = row.metrics
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
                    {showNavRange && (
                      <td className={`${tdBase} text-xs text-muted-foreground`}>
                        {row.navFrom && row.navTo ? `${row.navFrom} ~ ${row.navTo}` : "—"}
                      </td>
                    )}
                    <td className={`${tdBase} ${pctClass(m.periodReturn)}`}>{fmtSignedPct(m.periodReturn)}</td>
                    <td className={`${tdBase} ${pctClass(m.annReturn)}`}>{fmtSignedPct(m.annReturn)}</td>
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
