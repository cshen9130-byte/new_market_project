"use client"

import { useMemo, useState } from "react"
import { ChevronsUpDown, Menu } from "lucide-react"
import {
  annualCorrelationColumns,
  buildFundCorrelationRow,
  correlationCellStyle,
  fmtCorrelation,
  intervalCorrelationColumns,
  type CorrelationRow,
} from "@/lib/fund-compare-correlation"

interface FundInput {
  beian_hao: string
  name: string
  navPoints: { d: string; v: number }[]
}

interface BenchmarkInput {
  label: string
  navPoints: { d: string; v: number }[]
}

export function FundCompareCorrelationTable({
  funds,
  benchmark,
  analyzed,
  appliedTo,
}: {
  funds: FundInput[]
  benchmark: BenchmarkInput | null
  analyzed: boolean
  appliedTo: string
}) {
  const [mode, setMode] = useState<"interval" | "annual">("interval")

  const cutoffDate = appliedTo || funds.flatMap((f) => f.navPoints.map((p) => p.d)).sort().at(-1)?.slice(0, 10) || ""

  const columns = useMemo(() => {
    if (mode === "interval") return intervalCorrelationColumns(cutoffDate)
    const allPoints = funds.flatMap((f) => f.navPoints)
    return annualCorrelationColumns(allPoints)
  }, [mode, cutoffDate, funds])

  const rows = useMemo((): CorrelationRow[] => {
    if (!benchmark) return []
    return funds.map((fund) =>
      buildFundCorrelationRow(
        fund.beian_hao,
        fund.name,
        fund.navPoints,
        benchmark.navPoints,
        mode,
        cutoffDate,
      ),
    )
  }, [funds, benchmark, mode, cutoffDate])

  const hasData = rows.some((row) => row.cells.some((c) => c.value != null))
  if (!analyzed || funds.length === 0 || !benchmark || benchmark.navPoints.length === 0 || !hasData) {
    return null
  }

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 border-b">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-800" />
              相关系数对比
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              统计截止：{cutoffDate}
              <span className="mx-2">·</span>
              基准指数：{benchmark.label}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
            <div className="inline-flex rounded border border-zinc-200 overflow-hidden">
              {(["interval", "annual"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={[
                    "px-2.5 py-1 text-xs transition-colors border-r border-zinc-200 last:border-r-0",
                    mode === m
                      ? "bg-red-500 text-white font-medium"
                      : "bg-white text-zinc-600 hover:bg-zinc-50",
                  ].join(" ")}
                >
                  {m === "interval" ? "区间" : "年度"}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center h-7 w-7 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition-colors"
              title="图表设置"
            >
              <Menu className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full" style={{ minWidth: 960 }}>
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-muted-foreground">
                <th className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap border-r border-zinc-100 min-w-[160px] sticky left-0 bg-zinc-50 z-10">
                  产品名称
                </th>
                {columns.map((col) => (
                  <th key={col.key} className="px-3 py-2.5 text-center text-xs font-semibold whitespace-nowrap min-w-[88px]">
                    <span className="inline-flex items-center gap-0.5">
                      {col.label}
                      <ChevronsUpDown className="h-3 w-3 opacity-40" />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const cellMap = new Map(row.cells.map((c) => [c.key, c]))
                return (
                  <tr key={row.key} className={rowIndex % 2 === 1 ? "bg-zinc-50/40" : "bg-white"}>
                    <td className={[
                      "px-3 py-2.5 text-sm font-medium border-r border-zinc-100 whitespace-nowrap sticky left-0 z-10",
                      rowIndex % 2 === 1 ? "bg-zinc-50/40" : "bg-white",
                    ].join(" ")}>
                      {row.name}
                    </td>
                    {columns.map((col) => {
                      const cell = cellMap.get(col.key)
                      const value = cell?.value ?? null
                      const style = correlationCellStyle(value)
                      return (
                        <td
                          key={col.key}
                          className="px-3 py-2.5 text-center text-sm tabular-nums font-medium whitespace-nowrap"
                          style={style}
                        >
                          {fmtCorrelation(value)}
                        </td>
                      )
                    })}
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
