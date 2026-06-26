"use client"

import { memo, useMemo, useState } from "react"
import type { NavRow, BenchmarkPoint } from "./shared"
import { computePeriodReturnBars } from "./periodReturns"
import {
  computeConditionalProbabilities,
  computeIntervalCorrelations,
  computeAnnualCorrelations,
  correlationCellStyle,
} from "./benchmarkAnalytics"

export const BenchmarkRelationPanels = memo(function BenchmarkRelationPanels({
  productName, benchmarkLabel, hasBenchmark, rows, navType, benchmarkSeries, cutoffDate,
}: {
  productName: string
  benchmarkLabel: string
  hasBenchmark: boolean
  rows: NavRow[]
  navType: string
  benchmarkSeries: BenchmarkPoint[]
  cutoffDate: string
}) {
  const [corrMode, setCorrMode] = useState<"interval" | "annual">("interval")

  const weeklyBars = useMemo(
    () => computePeriodReturnBars(rows, navType, "week", benchmarkSeries),
    [rows, navType, benchmarkSeries],
  )

  const conditional = useMemo(() => {
    return computeConditionalProbabilities(
      weeklyBars.map((b) => b.fundPct),
      weeklyBars.map((b) => b.benchPct),
    )
  }, [weeklyBars])

  const intervalCorrs = useMemo(
    () => computeIntervalCorrelations(rows, navType, benchmarkSeries, cutoffDate),
    [rows, navType, benchmarkSeries, cutoffDate],
  )

  const annualCorrs = useMemo(
    () => computeAnnualCorrelations(rows, navType, benchmarkSeries),
    [rows, navType, benchmarkSeries],
  )

  const corrColumns = corrMode === "interval" ? intervalCorrs : annualCorrs

  if (!hasBenchmark) return null

  return (
    <>
      {conditional && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-100 bg-white">
          <table className="w-full text-xs min-w-[960px] border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">总周数</th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                  {benchmarkLabel}（基准）上涨且{productName}上涨概率
                </th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                  {benchmarkLabel}（基准）上涨且{productName}下跌概率
                </th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                  {benchmarkLabel}（基准）下跌且{productName}上涨概率
                </th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                  {benchmarkLabel}（基准）下跌且{productName}下跌概率
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-2.5 text-center tabular-nums text-zinc-800">{conditional.totalPeriods}周</td>
                <td className="px-3 py-2.5 text-center tabular-nums text-red-500">{conditional.benchUpFundUp.toFixed(2)}%</td>
                <td className="px-3 py-2.5 text-center tabular-nums text-green-600">{conditional.benchUpFundDown.toFixed(2)}%</td>
                <td className="px-3 py-2.5 text-center tabular-nums text-red-500">{conditional.benchDownFundUp.toFixed(2)}%</td>
                <td className="px-3 py-2.5 text-center tabular-nums text-green-600">{conditional.benchDownFundDown.toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
              区间相关系数
            </div>
            <div className="text-xs text-zinc-400 mt-1">
              统计截止点：{cutoffDate || "—"}，基准指数：{benchmarkLabel}（基准）
            </div>
          </div>
          <div className="inline-flex text-xs">
            <button
              type="button"
              onClick={() => setCorrMode("interval")}
              className={`px-3 py-1 transition-colors border rounded-l ${
                corrMode === "interval"
                  ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                  : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
              }`}
            >
              区间
            </button>
            <button
              type="button"
              onClick={() => setCorrMode("annual")}
              className={`px-3 py-1 transition-colors border rounded-r -ml-px ${
                corrMode === "annual"
                  ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                  : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
              }`}
            >
              年度
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-zinc-100">
          <table className="w-full text-xs min-w-[720px] border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="px-3 py-2.5 text-left font-medium text-zinc-500 whitespace-nowrap border-r border-zinc-100 min-w-[120px]">
                  基金名称
                </th>
                {corrColumns.map((col) => (
                  <th key={col.key} className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-zinc-100">
                <td className="px-3 py-2.5 text-zinc-800 font-medium border-r border-zinc-100 whitespace-nowrap">
                  {productName}
                </td>
                {corrColumns.map((col) => {
                  const style = correlationCellStyle(col.value)
                  return (
                    <td
                      key={col.key}
                      className="px-3 py-2.5 text-center tabular-nums font-medium"
                      style={style}
                    >
                      {col.value !== null && Number.isFinite(col.value) ? col.value.toFixed(4) : "—"}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
})
BenchmarkRelationPanels.displayName = "BenchmarkRelationPanels"
