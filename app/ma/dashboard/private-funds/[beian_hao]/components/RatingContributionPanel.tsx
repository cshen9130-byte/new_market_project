"use client"

import { memo, useMemo } from "react"
import { Menu } from "lucide-react"
import {
  PieChart, Pie, Cell, ResponsiveContainer,
} from "recharts"
import {
  computeDimensionContributions,
  type FundRatingResult,
} from "@/lib/fund-rating"
import { RED } from "./shared"

function PieSliceLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: {
  cx?: number
  cy?: number
  midAngle?: number
  innerRadius?: number
  outerRadius?: number
  percent?: number
}) {
  if (
    cx === undefined || cy === undefined || midAngle === undefined
    || innerRadius === undefined || outerRadius === undefined || percent === undefined
  ) return null
  const RAD = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55
  const x = cx + radius * Math.cos(-midAngle * RAD)
  const y = cy + radius * Math.sin(-midAngle * RAD)
  if (percent < 0.08) return null
  return (
    <text x={x} y={y} fill="#52525b" textAnchor="middle" dominantBaseline="central" fontSize={11}>
      {(percent * 100).toFixed(2)}%
    </text>
  )
}

export const RatingContributionPanel = memo(function RatingContributionPanel({
  data,
  selectedPeriodKey,
}: {
  data: FundRatingResult
  selectedPeriodKey: string
}) {
  const selectedRow = useMemo(
    () => data.rows.find((r) => r.periodKey === selectedPeriodKey) ?? data.rows[0] ?? null,
    [data.rows, selectedPeriodKey],
  )

  const contributions = useMemo(
    () => (selectedRow ? computeDimensionContributions(selectedRow) : []),
    [selectedRow],
  )

  const pieData = useMemo(
    () => contributions.filter((d) => d.contributionValue !== null && d.contributionValue > 0),
    [contributions],
  )

  if (!selectedRow || !pieData.length) return null

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-1">
          <span className="inline-block w-1 self-stretch rounded-full bg-red-500" />
          {selectedRow.periodLabel}维度评分贡献度
        </div>
        <div className="text-xs text-zinc-600 pl-3">
          总评分：
          <span className="font-semibold tabular-nums" style={{ color: RED }}>
            {selectedRow.totalScore?.toFixed(2) ?? "—"}
          </span>
          {selectedRow.totalOutperformPct !== null && (
            <span className="text-zinc-500">
              {" "}(超越同类 {selectedRow.totalOutperformPct.toFixed(2)}%)
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-5 mb-4 text-xs text-zinc-600">
        {contributions.map((d) => (
          <span key={d.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
            {d.label}
          </span>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-stretch">
        <div className="lg:w-[42%] min-w-0 flex items-center justify-center">
          <div className="w-full max-w-[320px]" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="contributionValue"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius="52%"
                  outerRadius="78%"
                  paddingAngle={1}
                  labelLine={false}
                  label={PieSliceLabel}
                  isAnimationActive={false}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} stroke="#fff" strokeWidth={2} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:flex-1 min-w-0">
          <div className="overflow-x-auto rounded-lg border border-zinc-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-100">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 w-10">
                    <Menu className="h-3.5 w-3.5 text-zinc-400" />
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-500">维度名称</th>
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500">贡献值</th>
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500">贡献度</th>
                </tr>
              </thead>
              <tbody>
                {contributions.map((d, idx) => (
                  <tr
                    key={d.key}
                    className={[
                      "border-b border-zinc-50 last:border-0",
                      idx % 2 === 1 ? "bg-zinc-50/40" : "",
                    ].join(" ")}
                  >
                    <td className="px-4 py-2.5" />
                    <td className="px-3 py-2.5 text-xs text-zinc-800">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: d.color }}
                        />
                        {d.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs tabular-nums text-zinc-800">
                      {d.contributionValue?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs tabular-nums text-zinc-800">
                      {d.contributionPct !== null ? `${d.contributionPct.toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
})
