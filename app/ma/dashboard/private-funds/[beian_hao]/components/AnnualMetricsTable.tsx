"use client"

import { memo, useState, Fragment } from "react"
import { Download, ChevronDown } from "lucide-react"
import { ANNUAL_METRIC_COLUMNS, type MetricKey } from "@/lib/fund-nav-metrics"
import { RED, GREEN, type AnnualFundRow, type PeerYearlyRow } from "./shared"
import {
  SAMPLE_INDICATOR_OPTIONS,
  SampleIndicatorPicker,
  defaultSampleIndicatorVisibility,
  type SampleIndicatorKey,
} from "./SampleIndicatorPicker"

function AnnualMetricFundCell({ value, type }: { value: number | null; type: "pct" | "ratio" | "days" }) {
  if (value === null || !isFinite(value)) return <span className="text-zinc-400">—</span>
  if (type === "days") return <span className="tabular-nums font-medium text-zinc-800">{Math.round(value)}</span>
  if (type === "ratio") return <span className="tabular-nums font-medium text-zinc-800">{value.toFixed(4)}</span>
  const pct = value * 100
  const color = pct > 0 ? RED : pct < 0 ? GREEN : undefined
  return <span className="tabular-nums font-medium" style={color ? { color } : undefined}>{pct.toFixed(2)}%</span>
}

function AnnualMetricPeerCell({ value, type }: { value: number | null; type: "pct" | "ratio" | "days" }) {
  if (value === null || !isFinite(value)) return <span className="text-zinc-300">—</span>
  if (type === "days") return <span className="tabular-nums text-zinc-500">{Math.round(value)}</span>
  if (type === "ratio") return <span className="tabular-nums text-zinc-500">{value.toFixed(4)}</span>
  const pct = value * 100
  return <span className="tabular-nums text-zinc-500">{pct.toFixed(2)}%</span>
}

function AnnualQuartileCell({ percentile }: { percentile: number | null }) {
  if (percentile === null || !isFinite(percentile)) {
    return <div className="h-1.5 w-full rounded-full bg-zinc-100 mx-auto max-w-[40px]" />
  }
  const score = Math.max(0, Math.min(100, 100 - percentile))
  const barColor = score > 75 ? "#ef4444" : score > 50 ? "#f97316" : score > 25 ? "#eab308" : "#a1a1aa"
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="w-full rounded-full bg-zinc-100 mx-auto max-w-[40px] h-1.5 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: barColor }} />
      </div>
      <span className="text-[10px] tabular-nums text-zinc-400">{percentile.toFixed(2)}%</span>
    </div>
  )
}

const SAMPLE_LABELS = SAMPLE_INDICATOR_OPTIONS

export const AnnualMetricsTable = memo(function AnnualMetricsTable({
  productName, sampleGroup, dateRangeLabel, fundRows, peerByYear, hasBenchmark,
}: {
  productName: string
  sampleGroup: string | null
  dateRangeLabel: string
  fundRows: AnnualFundRow[]
  peerByYear: Map<number, PeerYearlyRow>
  hasBenchmark: boolean
}) {
  const INITIAL_YEARS = 1
  const [expanded, setExpanded] = useState(false)
  const [showInterval, setShowInterval] = useState(true)
  const [showBenchmark, setShowBenchmark] = useState(hasBenchmark)
  const [visibleSampleRows, setVisibleSampleRows] = useState(defaultSampleIndicatorVisibility)

  function toggleSampleRow(key: SampleIndicatorKey) {
    setVisibleSampleRows((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const activeSampleLabels = SAMPLE_LABELS.filter((label) => visibleSampleRows[label])

  if (!fundRows.length) return null

  const visibleRows = expanded ? fundRows : fundRows.slice(0, INITIAL_YEARS)
  const hasMore = fundRows.length > INITIAL_YEARS
  const hasPeer = peerByYear.size > 0

  function exportCsv() {
    const headers = ["年份", "基金名称", ...ANNUAL_METRIC_COLUMNS.map((c) => c.label)]
    const lines: string[][] = [headers]
    for (const row of fundRows) {
      lines.push([
        String(row.year), productName,
        ...ANNUAL_METRIC_COLUMNS.map((c) => {
          const v = row.metrics[c.key]
          if (v === null || !isFinite(v as number)) return ""
          if (c.type === "days") return String(Math.round(v as number))
          if (c.type === "ratio") return (v as number).toFixed(4)
          return ((v as number) * 100).toFixed(2) + "%"
        }),
      ])
    }
    const escape = (v: string) => v.includes(",") || v.includes("\"") ? `"${v.replace(/"/g, "\"\"")}"` : v
    const blob = new Blob(["\uFEFF" + lines.map((r) => r.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `${productName}_年度指标.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            年度指标
          </div>
          {dateRangeLabel && <div className="text-xs text-zinc-400 mt-1">统计区间：{dateRangeLabel}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          {hasBenchmark && (
            <button type="button" onClick={() => setShowBenchmark((v) => !v)} className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors">
              <span aria-hidden="true" className={["inline-flex h-3.5 w-3.5 items-center justify-center rounded border", showBenchmark ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white"].join(" ")}>
                {showBenchmark && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>}
              </span>
              基准指数
            </button>
          )}
          <button type="button" onClick={() => setShowInterval((v) => !v)} className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors">
            <span aria-hidden="true" className={["inline-flex h-3.5 w-3.5 items-center justify-center rounded border", showInterval ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white"].join(" ")}>
              {showInterval && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>}
            </span>
            显示区间
          </button>
          {sampleGroup && (
            <div className="inline-flex items-center gap-1.5">
              <span className="text-zinc-500">样本组：</span>
              <select defaultValue={sampleGroup} className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 max-w-[120px]">
                <option value={sampleGroup}>{sampleGroup}</option>
              </select>
              <span className="px-1 py-0.5 text-[10px] rounded bg-red-50 text-red-500 border border-red-200 leading-none">平台</span>
            </div>
          )}
          <SampleIndicatorPicker visible={visibleSampleRows} onToggle={toggleSampleRow} />
          <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800 transition-colors">
            <Download className="h-3.5 w-3.5" />导出
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-100">
        <table className="w-full text-xs min-w-[1100px] border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-12 border-r border-zinc-100">年份</th>
              <th className="px-3 py-2.5 text-left font-medium text-zinc-500 min-w-[100px] border-r border-zinc-100">基金名称</th>
              {ANNUAL_METRIC_COLUMNS.map((col) => (
                <th key={col.key} className="px-2 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                  <div>{col.label}</div>
                  {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5 min-h-[0.875rem]">&nbsp;</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((fundRow, yi) => {
              const peer = peerByYear.get(fundRow.year)
              const isLastGroup = yi === visibleRows.length - 1
              const rowSpan = activeSampleLabels.length + 1

              return (
                <Fragment key={fundRow.year}>
                  <tr className="border-b border-zinc-50 hover:bg-zinc-50/40">
                    <td className="px-3 py-2.5 text-zinc-700 font-semibold border-r border-zinc-100 align-top" rowSpan={rowSpan}>
                      <div>{fundRow.year}</div>
                      {showInterval && (
                        <div className="text-[10px] font-normal text-zinc-400 mt-1 whitespace-nowrap">{fundRow.interval}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-800 font-medium border-r border-zinc-100 truncate max-w-[120px]">{productName}</td>
                    {ANNUAL_METRIC_COLUMNS.map((col) => (
                      <td key={col.key} className="px-2 py-2.5 text-center">
                        <AnnualMetricFundCell value={fundRow.metrics[col.key]} type={col.type} />
                      </td>
                    ))}
                  </tr>
                  {activeSampleLabels.map((label, ri) => {
                    const isLast = ri === activeSampleLabels.length - 1
                    const rowCls = ["border-b", isLast && !isLastGroup ? "border-b-zinc-200" : "border-b-zinc-50"].join(" ")
                    return (
                      <tr key={label} className={rowCls}>
                        <td className="px-3 py-1.5 text-zinc-400 border-r border-zinc-100">{label}</td>
                        {ANNUAL_METRIC_COLUMNS.map((col) => (
                          <td key={col.key} className="px-2 py-1.5 text-center">
                            {!hasPeer || !peer ? (
                              <span className="text-zinc-300">—</span>
                            ) : label === "样本平均值" ? (
                              <AnnualMetricPeerCell value={peer.mean[col.key as MetricKey]} type={col.type} />
                            ) : label === "样本中位数" ? (
                              <AnnualMetricPeerCell value={peer.median[col.key as MetricKey]} type={col.type} />
                            ) : label === "样本排名" ? (
                              peer.rank[col.key as MetricKey] !== null ? (
                                <span className="tabular-nums text-zinc-500">{peer.rank[col.key as MetricKey]}/{peer.sample_n}</span>
                              ) : <span className="text-zinc-300">—</span>
                            ) : (
                              <AnnualQuartileCell percentile={peer.percentile[col.key as MetricKey]} />
                            )}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1 text-xs text-blue-500 hover:text-blue-600 transition-colors py-1">
          {expanded ? "收起" : "展开更多"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  )
})
AnnualMetricsTable.displayName = "AnnualMetricsTable"
