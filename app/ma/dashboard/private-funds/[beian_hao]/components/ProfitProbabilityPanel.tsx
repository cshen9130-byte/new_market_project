"use client"

import { memo, useState, useMemo, useCallback } from "react"
import { Menu } from "lucide-react"
import {
  BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RED, type NavRow, type BenchmarkPoint } from "./shared"
import {
  HOLDING_PERIOD_OPTIONS,
  POSITIVE_RETURN_HORIZONS,
  buildReturnHistogram,
  computeHoldingReturnPairs,
  positiveReturnProbability,
} from "./holdingPeriodAnalytics"

function fmtProb(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—"
  return v.toFixed(2) + "%"
}

export const ProfitProbabilityPanel = memo(function ProfitProbabilityPanel({
  productName, benchmarkLabel, hasBenchmark, rows, navType, benchmarkSeries, dateRangeLabel,
}: {
  productName: string
  benchmarkLabel: string
  hasBenchmark: boolean
  rows: NavRow[]
  navType: string
  benchmarkSeries: BenchmarkPoint[]
  dateRangeLabel: string
}) {
  const [holdMonths, setHoldMonths] = useState(3)

  const inceptionDate = rows[0]?.price_date ?? ""

  const pairs = useMemo(
    () => computeHoldingReturnPairs(rows, navType, benchmarkSeries, holdMonths),
    [rows, navType, benchmarkSeries, holdMonths],
  )

  const histogram = useMemo(() => {
    const fundRets = pairs.map((p) => p.fund)
    const benchRets = pairs.map((p) => p.bench).filter((v): v is number => v !== null)
    return buildReturnHistogram(fundRets, benchRets)
  }, [pairs])

  const yMax = useMemo(() => {
    if (!histogram.length) return 25
    const max = Math.max(...histogram.flatMap((b) => [b.fundFreq, b.benchFreq]))
    return Math.ceil(max / 5) * 5 + 5
  }, [histogram])

  const positiveTable = useMemo(() => {
    return POSITIVE_RETURN_HORIZONS.map((h) => {
      const hp = computeHoldingReturnPairs(rows, navType, benchmarkSeries, h.months)
      const fundProb = positiveReturnProbability(hp.map((p) => p.fund))
      const benchProb = positiveReturnProbability(hp.map((p) => p.bench).filter((v): v is number => v !== null))
      return { ...h, fundProb, benchProb }
    })
  }, [rows, navType, benchmarkSeries])

  const holdLabel = HOLDING_PERIOD_OPTIONS.find((o) => o.months === holdMonths)?.label ?? "三个月"

  const exportCsv = useCallback(() => {
    const headers = ["收益区间", productName, hasBenchmark ? `${benchmarkLabel}（基准）` : ""].filter(Boolean)
    const lines = histogram.map((b) => [
      b.label,
      b.fundFreq.toFixed(2) + "%",
      hasBenchmark ? b.benchFreq.toFixed(2) + "%" : "",
    ].filter(Boolean).join(","))
    const blob = new Blob(["\uFEFF" + [headers.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${productName}_盈利概率_${holdLabel}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [histogram, productName, benchmarkLabel, hasBenchmark, holdLabel])

  if (!rows.length) return null

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
              盈利概率
            </div>
            {dateRangeLabel && <div className="text-xs text-zinc-400 mt-1">统计区间：{dateRangeLabel}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
            <div className="inline-flex items-center gap-1.5">
              <span className="text-zinc-500">持有周期：</span>
              <select
                value={holdMonths}
                onChange={(e) => setHoldMonths(parseInt(e.target.value, 10))}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
              >
                {HOLDING_PERIOD_OPTIONS.map((opt) => (
                  <option key={opt.months} value={opt.months}>{opt.label}</option>
                ))}
              </select>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="p-1 text-zinc-400 hover:text-zinc-600 rounded transition-colors" aria-label="图表菜单">
                  <Menu className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[7.5rem] text-xs">
                <DropdownMenuItem onClick={exportCsv}>下载数据</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {hasBenchmark && (
          <div className="flex items-center gap-4 text-xs text-zinc-600 mb-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RED }} />
              {productName}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" />
              {benchmarkLabel}（基准）
            </span>
          </div>
        )}

        {!histogram.length ? (
          <div className="h-[320px] flex items-center justify-center text-sm text-zinc-400">暂无足够数据</div>
        ) : (
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogram} margin={{ top: 8, right: 12, left: 0, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#a1a1aa" }}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  domain={[0, yMax]}
                  tick={{ fontSize: 11, fill: "#a1a1aa" }}
                  width={44}
                  tickFormatter={(v: number) => `${v}%`}
                  label={{ value: "概率（%）", angle: -90, position: "insideLeft", offset: 8, style: { fontSize: 11, fill: "#a1a1aa" } }}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="fundFreq" name={productName} radius={[2, 2, 0, 0]}>
                  {histogram.map((_, i) => <Cell key={`f-${i}`} fill={RED} />)}
                </Bar>
                {hasBenchmark && (
                  <Bar dataKey="benchFreq" name={`${benchmarkLabel}（基准）`} radius={[2, 2, 0, 0]}>
                    {histogram.map((_, i) => <Cell key={`b-${i}`} fill="#2563eb" />)}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <div className="text-sm font-semibold text-zinc-700">获取大于0%收益概率</div>
          <button type="button" className="text-xs text-blue-500 hover:text-blue-600">设置</button>
        </div>
        {inceptionDate && (
          <div className="text-xs text-zinc-400 mb-3">（自{inceptionDate}起任意时间买入）</div>
        )}

        <div className="overflow-x-auto rounded-lg border border-zinc-100">
          <table className="w-full text-xs min-w-[800px] border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="px-3 py-2.5 text-left font-medium text-zinc-500 whitespace-nowrap border-r border-zinc-100">类别</th>
                {POSITIVE_RETURN_HORIZONS.map((h) => (
                  <th key={h.months} className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                    持有{h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-zinc-100">
                <td className="px-3 py-2.5 text-zinc-800 font-medium border-r border-zinc-100 whitespace-nowrap">{productName}</td>
                {positiveTable.map((row) => (
                  <td key={row.months} className="px-3 py-2.5 text-center tabular-nums text-red-500">
                    {fmtProb(row.fundProb)}
                  </td>
                ))}
              </tr>
              {hasBenchmark && (
                <tr>
                  <td className="px-3 py-2.5 text-zinc-600 border-r border-zinc-100 whitespace-nowrap">{benchmarkLabel}（基准）</td>
                  {positiveTable.map((row) => (
                    <td key={row.months} className="px-3 py-2.5 text-center tabular-nums text-zinc-700">
                      {fmtProb(row.benchProb)}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
})
ProfitProbabilityPanel.displayName = "ProfitProbabilityPanel"
