"use client"

import { useMemo, useState } from "react"
import {
  buildFundConditionalProb,
  fmtConditionalPct,
  type ConditionalProbabilityStats,
} from "@/lib/fund-compare-conditional-prob"
import type { WinRateGranularity } from "@/lib/fund-compare-win-rate"

interface FundInput {
  beian_hao: string
  name: string
  navPoints: { d: string; v: number }[]
}

interface BenchmarkInput {
  label: string
  navPoints: { d: string; v: number }[]
}

interface TableRow {
  key: string
  name: string
  stats: ConditionalProbabilityStats
}

export function FundCompareConditionalProbTable({
  funds,
  benchmark,
  analyzed,
  appliedFrom,
  appliedTo,
}: {
  funds: FundInput[]
  benchmark: BenchmarkInput | null
  analyzed: boolean
  appliedFrom: string
  appliedTo: string
}) {
  const [granularity, setGranularity] = useState<WinRateGranularity>("week")

  const rows = useMemo((): TableRow[] => {
    if (!benchmark) return []
    return funds
      .map((fund) => {
        const stats = buildFundConditionalProb(
          fund.navPoints,
          benchmark.navPoints,
          granularity,
          appliedFrom,
          appliedTo,
        )
        if (!stats) return null
        return { key: fund.beian_hao, name: fund.name, stats }
      })
      .filter((row): row is TableRow => row != null)
  }, [funds, benchmark, granularity, appliedFrom, appliedTo])

  const periodUnit = granularity === "week" ? "周" : "月"
  const benchLabel = benchmark?.label ?? "基准"

  if (!analyzed || funds.length === 0) return null

  if (!benchmark || benchmark.navPoints.length === 0) return null

  if (rows.length === 0) return null

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3 border-b">
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

        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full" style={{ minWidth: 960 }}>
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-muted-foreground">
                <th className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap border-r border-zinc-100 min-w-[160px]">
                  产品名称
                </th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold whitespace-nowrap">
                  总{periodUnit}数
                </th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold whitespace-nowrap min-w-[140px]">
                  {benchLabel}上涨且基金上涨概率
                </th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold whitespace-nowrap min-w-[140px]">
                  {benchLabel}上涨且基金下跌概率
                </th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold whitespace-nowrap min-w-[140px]">
                  {benchLabel}下跌且基金上涨概率
                </th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold whitespace-nowrap min-w-[140px]">
                  {benchLabel}下跌且基金下跌概率
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={row.key}
                  className={rowIndex % 2 === 1 ? "bg-zinc-50/40" : "bg-white"}
                >
                  <td className="px-3 py-2.5 text-sm font-medium border-r border-zinc-100 whitespace-nowrap">
                    {row.name}
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm tabular-nums whitespace-nowrap">
                    {row.stats.totalPeriods}{periodUnit}
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm tabular-nums text-red-500 whitespace-nowrap">
                    {fmtConditionalPct(row.stats.benchUpFundUp)}
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm tabular-nums text-green-500 whitespace-nowrap">
                    {fmtConditionalPct(row.stats.benchUpFundDown)}
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm tabular-nums text-red-500 whitespace-nowrap">
                    {fmtConditionalPct(row.stats.benchDownFundUp)}
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm tabular-nums text-green-500 whitespace-nowrap">
                    {fmtConditionalPct(row.stats.benchDownFundDown)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
