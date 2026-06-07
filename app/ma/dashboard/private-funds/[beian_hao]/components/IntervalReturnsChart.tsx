"use client"

import { memo, useState, useMemo } from "react"
import { Download } from "lucide-react"
import {
  BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts"
import { RED, GREEN, getNavFieldValue, type NavRow, type BenchmarkPoint } from "./shared"

type ReturnGranularity = "week" | "month" | "quarter" | "half" | "year" | "phase"

const RETURN_GRANULARITY_OPTIONS: { key: ReturnGranularity; label: string }[] = [
  { key: "week",    label: "周度" },
  { key: "month",   label: "月度" },
  { key: "quarter", label: "季度" },
  { key: "half",    label: "半年度" },
  { key: "year",    label: "年度" },
  { key: "phase",   label: "阶段" },
]

function periodBucket(date: string, gran: ReturnGranularity): string {
  const y = parseInt(date.slice(0, 4), 10)
  const m = parseInt(date.slice(5, 7), 10)
  if (gran === "month") return date.slice(0, 7)
  if (gran === "year") return String(y)
  if (gran === "quarter") return `${y}-Q${Math.ceil(m / 3)}`
  if (gran === "half") return `${y}-H${m <= 6 ? 1 : 2}`
  if (gran === "phase") return "phase"
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setDate(diff)
  return monday.toISOString().slice(0, 10)
}

function formatBucketLabel(bucket: string, gran: ReturnGranularity): string {
  if (gran === "month" || gran === "week") return bucket.length >= 7 ? bucket.slice(0, 7) : bucket
  return bucket
}

function benchmarkAtDate(series: BenchmarkPoint[], date: string): number | null {
  let last: number | null = null
  for (const p of series) {
    if (p.date <= date) last = p.value
    else break
  }
  return last
}

interface PeriodReturnBar {
  label: string
  fundPct: number
  benchPct: number | null
  excessPct: number | null
}

function computePeriodReturnBars(
  rows: NavRow[],
  navType: string,
  gran: ReturnGranularity,
  benchmarkSeries: BenchmarkPoint[],
): PeriodReturnBar[] {
  if (rows.length < 2) return []
  const sortedBench = [...benchmarkSeries].sort((a, b) => a.date.localeCompare(b.date))

  if (gran === "phase") {
    const start = rows[0], end = rows[rows.length - 1]
    const f0 = getNavFieldValue(start, navType), f1 = getNavFieldValue(end, navType)
    const b0 = benchmarkAtDate(sortedBench, start.price_date)
    const b1 = benchmarkAtDate(sortedBench, end.price_date)
    const fundPct = f0 > 0 ? (f1 / f0 - 1) * 100 : 0
    const benchPct = b0 && b1 && b0 > 0 ? (b1 / b0 - 1) * 100 : null
    return [{ label: start.price_date.slice(0, 7), fundPct, benchPct, excessPct: benchPct !== null ? fundPct - benchPct : null }]
  }

  const bucketLast = new Map<string, NavRow>()
  for (const row of rows) bucketLast.set(periodBucket(row.price_date, gran), row)
  const buckets = [...bucketLast.keys()].sort()

  return buckets.map((bucket, i) => {
    const endRow = bucketLast.get(bucket)!
    const endNav = getNavFieldValue(endRow, navType)
    let baseNav: number, baseDate: string
    if (i === 0) {
      const firstRow = rows.find((r) => periodBucket(r.price_date, gran) === bucket)!
      baseNav = getNavFieldValue(firstRow, navType); baseDate = firstRow.price_date
    } else {
      const prevRow = bucketLast.get(buckets[i - 1])!
      baseNav = getNavFieldValue(prevRow, navType); baseDate = prevRow.price_date
    }
    const fundPct = baseNav > 0 ? (endNav / baseNav - 1) * 100 : 0
    const b0 = benchmarkAtDate(sortedBench, baseDate)
    const b1 = benchmarkAtDate(sortedBench, endRow.price_date)
    const benchPct = b0 && b1 && b0 > 0 ? (b1 / b0 - 1) * 100 : null
    return { label: formatBucketLabel(bucket, gran), fundPct, benchPct, excessPct: benchPct !== null ? fundPct - benchPct : null }
  })
}

function ReturnBarTooltip({
  active, payload, label, showExcess, productName, benchmarkLabel,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string; value?: number; color?: string }>
  label?: string
  showExcess: boolean
  productName: string
  benchmarkLabel: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-zinc-100 shadow-md rounded-lg px-3 py-2 text-xs">
      <div className="text-zinc-500 mb-1">{label}</div>
      {payload.map((item) => {
        const name =
          item.dataKey === "fundPct" ? productName :
          item.dataKey === "benchPct" ? `${benchmarkLabel}（基准）` :
          item.dataKey === "excessPct" ? "超额" : String(item.dataKey)
        const val = item.value as number
        return (
          <div key={item.dataKey} className="font-semibold tabular-nums" style={item.color ? { color: item.color } : undefined}>
            {name}: {val > 0 ? "+" : ""}{val.toFixed(2)}%
          </div>
        )
      })}
    </div>
  )
}

export const IntervalReturnsChart = memo(function IntervalReturnsChart({
  productName, sampleGroup, dateRangeLabel, rows, navType, benchmarkSeries, benchmarkLabel, hasBenchmark,
}: {
  productName: string
  sampleGroup: string | null
  dateRangeLabel: string
  rows: NavRow[]
  navType: string
  benchmarkSeries: BenchmarkPoint[]
  benchmarkLabel: string
  hasBenchmark: boolean
}) {
  const [granularity, setGranularity] = useState<ReturnGranularity>("month")
  const [showBenchmark, setShowBenchmark] = useState(false)
  const [showExcess, setShowExcess] = useState(false)

  const chartData = useMemo(
    () => computePeriodReturnBars(rows, navType, granularity, benchmarkSeries),
    [rows, navType, granularity, benchmarkSeries],
  )

  const yDomain = useMemo((): [number, number] => {
    if (!chartData.length) return [-5, 5]
    const vals = chartData.flatMap((d) => {
      if (showExcess && showBenchmark) return [d.excessPct ?? d.fundPct]
      if (showBenchmark) return [d.fundPct, d.benchPct ?? 0]
      return [d.fundPct]
    }).filter((v) => v !== null && isFinite(v)) as number[]
    if (!vals.length) return [-5, 5]
    const min = Math.min(...vals), max = Math.max(...vals)
    const pad = Math.max((max - min) * 0.1, 1)
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }, [chartData, showBenchmark, showExcess])

  const seriesName = showExcess && showBenchmark ? "超额" : productName

  function exportCsv() {
    const headers = ["区间", productName]
    if (showBenchmark) headers.push(`${benchmarkLabel}（基准）`)
    if (showExcess && showBenchmark) headers.push("超额")
    const lines = chartData.map((d) => {
      const row = [d.label, `${d.fundPct.toFixed(2)}%`]
      if (showBenchmark) row.push(d.benchPct !== null ? `${d.benchPct.toFixed(2)}%` : "")
      if (showExcess && showBenchmark) row.push(d.excessPct !== null ? `${d.excessPct.toFixed(2)}%` : "")
      return row
    })
    const escape = (v: string) => v.includes(",") ? `"${v}"` : v
    const blob = new Blob(["\uFEFF" + [headers, ...lines].map((r) => r.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `${productName}_区间收益.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (!chartData.length) return null

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            区间收益
          </div>
          {dateRangeLabel && <div className="text-xs text-zinc-400 mt-1">统计区间：{dateRangeLabel}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          {hasBenchmark && (
            <>
              <button type="button" onClick={() => setShowExcess((v) => !v)} className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors">
                <span className={["inline-flex h-3.5 w-3.5 items-center justify-center rounded border", showExcess ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white"].join(" ")}>
                  {showExcess && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>}
                </span>
                超额
              </button>
              <button type="button" onClick={() => setShowBenchmark((v) => !v)} className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors">
                <span className={["inline-flex h-3.5 w-3.5 items-center justify-center rounded border", showBenchmark ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white"].join(" ")}>
                  {showBenchmark && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>}
                </span>
                基准指数
              </button>
            </>
          )}
          {sampleGroup && (
            <div className="inline-flex items-center gap-1.5">
              <span className="text-zinc-500">样本组：</span>
              <select defaultValue={sampleGroup} className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 max-w-[120px]">
                <option value={sampleGroup}>{sampleGroup}</option>
              </select>
            </div>
          )}
          <select disabled className="text-xs border border-zinc-200 rounded px-2 py-1 bg-zinc-50 text-zinc-400"><option>指标选择</option></select>
          <div className="inline-flex rounded border border-zinc-200 overflow-hidden">
            {RETURN_GRANULARITY_OPTIONS.map((opt) => (
              <button key={opt.key} type="button" onClick={() => setGranularity(opt.key)}
                className={["px-2.5 py-1 text-xs transition-colors border-r border-zinc-200 last:border-r-0", granularity === opt.key ? "bg-zinc-900 text-white font-medium" : "bg-white text-zinc-600 hover:bg-zinc-50"].join(" ")}>
                {opt.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800 transition-colors">
            <Download className="h-3.5 w-3.5" />导出
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-zinc-600 mb-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RED }} />
          {seriesName}
        </span>
        {showBenchmark && !showExcess && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" />
            {benchmarkLabel}（基准）
          </span>
        )}
      </div>

      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#a1a1aa" }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis domain={yDomain} tick={{ fontSize: 11, fill: "#a1a1aa" }} width={44}
              tickFormatter={(v: number) => `${v}%`}
              label={{ value: "收益率（%）", angle: -90, position: "insideLeft", offset: 8, style: { fontSize: 11, fill: "#a1a1aa" } }} />
            <Tooltip content={(props) => (
              <ReturnBarTooltip active={props.active} payload={props.payload as Array<{ dataKey?: string; value?: number; color?: string }>}
                label={props.label as string} showExcess={showExcess} productName={productName} benchmarkLabel={benchmarkLabel} />
            )} />
            <ReferenceLine y={0} stroke="#d4d4d8" />
            {showBenchmark && !showExcess ? (
              <>
                <Bar dataKey="fundPct" name={productName} radius={[2, 2, 0, 0]}>
                  {chartData.map((entry, i) => <Cell key={`f-${i}`} fill={entry.fundPct >= 0 ? RED : GREEN} />)}
                </Bar>
                <Bar dataKey="benchPct" name={`${benchmarkLabel}（基准）`} radius={[2, 2, 0, 0]}>
                  {chartData.map((entry, i) => <Cell key={`b-${i}`} fill={entry.benchPct !== null && entry.benchPct >= 0 ? "#2563eb" : "#34d399"} />)}
                </Bar>
              </>
            ) : (
              <Bar dataKey={showExcess && showBenchmark ? "excessPct" : "fundPct"} name={seriesName} radius={[2, 2, 0, 0]}>
                {chartData.map((entry, i) => {
                  const v = showExcess && showBenchmark ? (entry.excessPct ?? entry.fundPct) : entry.fundPct
                  return <Cell key={i} fill={v >= 0 ? RED : GREEN} />
                })}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})
IntervalReturnsChart.displayName = "IntervalReturnsChart"
