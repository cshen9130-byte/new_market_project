"use client"

import { memo, useMemo, useState } from "react"
import { Download, HelpCircle } from "lucide-react"
import { RED, GREEN, type BenchmarkPoint } from "./shared"
import {
  SAMPLE_INDICATOR_OPTIONS,
  SampleIndicatorPicker,
  defaultSampleIndicatorVisibility,
  type SampleIndicatorKey,
} from "./SampleIndicatorPicker"
import { MetricTemplatePicker, loadMetricTemplates, type MetricTemplate } from "./MetricTemplatePicker"
import { AddMetricModal, type AddedMetricCol } from "./AddMetricModal"

export { SAMPLE_INDICATOR_OPTIONS, type SampleIndicatorKey } from "./SampleIndicatorPicker"

export const INTERVAL_METRIC_COLUMNS = [
  { key: "ret_1w",     period: "近一周", metric: "收益",    days: 7,   type: "pct"   as const },
  { key: "ret_1m",     period: "近一月", metric: "收益",    days: 30,  type: "pct"   as const },
  { key: "ret_3m",     period: "近三月", metric: "收益",    days: 91,  type: "pct"   as const },
  { key: "ret_6m",     period: "近六月", metric: "收益",    days: 182, type: "pct"   as const },
  { key: "ret_1y",     period: "近一年", metric: "收益",    days: 365, type: "pct"   as const },
  { key: "sharpe_1y",  period: "近一年", metric: "夏普比率",            type: "ratio" as const },
  { key: "calmar_1y",  period: "近一年", metric: "卡玛比率",            type: "ratio" as const },
]

export type IntervalMetricValues = Record<(typeof INTERVAL_METRIC_COLUMNS)[number]["key"], string | number | null>

type IntervalColDef = (typeof INTERVAL_METRIC_COLUMNS)[number] | {
  key: string
  period: string
  metric: string
  days?: number
  type: "pct" | "ratio"
}

const RATIO_METRICS = new Set([
  "夏普比率", "超额夏普比率", "卡玛比率", "超额卡玛比率", "索提诺比率",
  "Alpha", "Beta", "信息比率", "偏度", "峰度", "VaR（95%置信）",
])

function addedColToDef(col: AddedMetricCol): IntervalColDef {
  const known = INTERVAL_METRIC_COLUMNS.find((c) => c.period === col.period && c.metric === col.metric)
  if (known) return known
  return {
    key: col.id,
    period: col.period,
    metric: col.metric,
    type: RATIO_METRICS.has(col.metric) ? "ratio" : "pct",
  }
}

function getColMetricValue(metrics: IntervalMetricValues, col: IntervalColDef): string | number | null {
  if (col.key in metrics) return metrics[col.key as keyof IntervalMetricValues]
  return null
}

export function calcMetricInterval(cutoff: string, days: number): string {
  const end = new Date(cutoff)
  const start = new Date(cutoff)
  start.setDate(start.getDate() - days)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return `${fmt(start)} ~ ${fmt(end)}`
}

function computeBenchmarkPeriodReturn(series: BenchmarkPoint[], cutoff: string, days: number): number | null {
  if (!series.length || !cutoff) return null
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date))
  const upToCutoff = sorted.filter((p) => p.date <= cutoff)
  if (!upToCutoff.length) return null
  const endVal = upToCutoff[upToCutoff.length - 1].value
  const startDate = new Date(cutoff)
  startDate.setDate(startDate.getDate() - days)
  const startStr = startDate.toISOString().slice(0, 10)
  const upToStart = sorted.filter((p) => p.date <= startStr)
  if (!upToStart.length) return null
  const startVal = upToStart[upToStart.length - 1].value
  if (startVal <= 0) return null
  return endVal / startVal - 1
}

export function buildBenchmarkIntervalMetrics(series: BenchmarkPoint[], cutoff: string): IntervalMetricValues {
  return {
    ret_1w:    computeBenchmarkPeriodReturn(series, cutoff, 7),
    ret_1m:    computeBenchmarkPeriodReturn(series, cutoff, 30),
    ret_3m:    computeBenchmarkPeriodReturn(series, cutoff, 91),
    ret_6m:    computeBenchmarkPeriodReturn(series, cutoff, 182),
    ret_1y:    computeBenchmarkPeriodReturn(series, cutoff, 365),
    sharpe_1y: null,
    calmar_1y: null,
  }
}

function IntervalPctCell({ value, unit = "ratio" }: { value: string | number | null; unit?: "ratio" | "percent" }) {
  if (value === null || value === undefined || value === "") return <span className="text-zinc-400">—</span>
  const n = typeof value === "number" ? value : parseFloat(value)
  if (isNaN(n)) return <span className="text-zinc-400">—</span>
  const pct = unit === "percent" ? n : n * 100
  const color = pct > 0 ? RED : pct < 0 ? GREEN : undefined
  return (
    <span className="tabular-nums font-medium" style={color ? { color } : undefined}>
      {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
    </span>
  )
}

function IntervalRatioCell({ value }: { value: string | number | null }) {
  if (value === null || value === undefined || value === "") return <span className="text-zinc-400">—</span>
  const n = typeof value === "number" ? value : parseFloat(value)
  if (isNaN(n)) return <span className="text-zinc-400">—</span>
  const color = n > 0 ? RED : n < 0 ? GREEN : undefined
  return (
    <span className="tabular-nums font-medium" style={color ? { color } : undefined}>
      {n.toFixed(4)}
    </span>
  )
}

function formatIntervalMetricExport(
  value: string | number | null,
  type: "pct" | "ratio",
  unit: "ratio" | "percent" = "ratio",
): string {
  if (value === null || value === undefined || value === "") return ""
  const n = typeof value === "number" ? value : parseFloat(value)
  if (isNaN(n)) return ""
  if (type === "ratio") return n.toFixed(4)
  const pct = unit === "percent" ? n : n * 100
  return `${pct.toFixed(2)}%`
}

export const IntervalMetricsTable = memo(function IntervalMetricsTable({
  productName,
  sampleGroup,
  cutoffDate,
  fundMetrics,
  benchmarkLabel,
  benchmarkMetrics,
  hasBenchmark,
}: {
  productName: string
  sampleGroup: string | null
  cutoffDate: string
  fundMetrics: IntervalMetricValues
  benchmarkLabel: string
  benchmarkMetrics: IntervalMetricValues | null
  hasBenchmark: boolean
}) {
  const [showBenchmark, setShowBenchmark] = useState(hasBenchmark)
  const [showInterval, setShowInterval] = useState(false)
  const [visibleSampleRows, setVisibleSampleRows] = useState(defaultSampleIndicatorVisibility)
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null)
  const [metricTemplates, setMetricTemplates] = useState<MetricTemplate[]>([])
  const [showAddMetric, setShowAddMetric] = useState(false)
  const [addedCols, setAddedCols] = useState<AddedMetricCol[]>([])

  function toggleSampleRow(key: SampleIndicatorKey) {
    setVisibleSampleRows((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const activeSampleRows = SAMPLE_INDICATOR_OPTIONS.filter((label) => visibleSampleRows[label])

  const visibleColumns = useMemo((): IntervalColDef[] => {
    let base: IntervalColDef[]
    if (activeTemplate) {
      const template = metricTemplates.find((t) => t.name === activeTemplate)
      if (template) {
        base = template.items
          .map((item) => INTERVAL_METRIC_COLUMNS.find((c) => c.period === item.period && c.metric === item.metric))
          .filter((c): c is (typeof INTERVAL_METRIC_COLUMNS)[number] => c !== undefined)
      } else {
        base = [...INTERVAL_METRIC_COLUMNS]
      }
    } else {
      base = [...INTERVAL_METRIC_COLUMNS]
    }
    if (base.length === 0) base = [...INTERVAL_METRIC_COLUMNS]

    const baseIds = new Set(base.map((c) => `${c.period}__${c.metric}`))
    const extras = addedCols
      .filter((c) => !baseIds.has(`${c.period}__${c.metric}`))
      .map(addedColToDef)
    return [...base, ...extras]
  }, [activeTemplate, metricTemplates, addedCols])

  function exportCsv() {
    const headers = ["产品名称", ...visibleColumns.map((c) => `${c.period}${c.metric}`)]
    const rows: string[][] = [
      headers,
      [
        productName,
        ...visibleColumns.map((c) => formatIntervalMetricExport(getColMetricValue(fundMetrics, c), c.type, c.type === "pct" ? "percent" : "ratio")),
      ],
    ]
    if (showBenchmark && benchmarkMetrics) {
      rows.push([
        `${benchmarkLabel}（基准）`,
        ...visibleColumns.map((c) => formatIntervalMetricExport(getColMetricValue(benchmarkMetrics, c), c.type, "ratio")),
      ])
    }
    for (const label of activeSampleRows) {
      rows.push([label, ...visibleColumns.map(() => "")])
    }
    const escape = (v: string) => v.includes(",") || v.includes("\"") ? `"${v.replace(/"/g, "\"\"")}"` : v
    const bom = "\uFEFF"
    const blob = new Blob([bom + rows.map((r) => r.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${productName}_区间指标_${cutoffDate || new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sampleRows = activeSampleRows

  return (
    <>
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            区间指标
            <HelpCircle className="h-3.5 w-3.5 text-zinc-400" />
          </div>
          {cutoffDate && (
            <div className="text-xs text-zinc-400 mt-1">统计截止：{cutoffDate}</div>
          )}
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
          <span className="text-zinc-300">|</span>
          <MetricTemplatePicker
            activeTemplate={activeTemplate}
            templates={metricTemplates}
            onOpen={() => setMetricTemplates(loadMetricTemplates())}
            onSelectDefault={() => setActiveTemplate(null)}
            onSelectTemplate={(template) => setActiveTemplate(template.name)}
          />
          <button
            type="button"
            onClick={() => setShowAddMetric(true)}
            className="text-blue-500 hover:text-blue-600 transition-colors"
          >
            {addedCols.length > 0 ? `添加指标(${addedCols.length})` : "添加指标"}
          </button>
          <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800 transition-colors">
            <Download className="h-3.5 w-3.5" />导出
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-100">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-100">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 min-w-[140px]">产品名称</th>
              {visibleColumns.map((col) => (
                <th key={`${col.period}__${col.metric}`} className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap">
                  <div>{col.period}</div>
                  <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{col.metric}</div>
                  {col.days && (
                    <div className={`text-[10px] font-normal text-zinc-400 mt-0.5 min-h-[0.875rem] ${showInterval ? "" : "invisible"}`}>
                      {calcMetricInterval(cutoffDate, col.days)}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-zinc-50">
              <td className="px-4 py-2.5 text-xs text-zinc-800 font-medium">{productName}</td>
              {visibleColumns.map((col) => (
                <td key={`${col.period}__${col.metric}`} className="px-3 py-2.5 text-center text-xs">
                  {col.type === "pct"
                    ? <IntervalPctCell value={getColMetricValue(fundMetrics, col)} unit="percent" />
                    : <IntervalRatioCell value={getColMetricValue(fundMetrics, col)} />}
                </td>
              ))}
            </tr>
            {showBenchmark && benchmarkMetrics && (
              <tr className="border-b border-zinc-50 bg-zinc-50/40">
                <td className="px-4 py-2.5 text-xs text-zinc-600">{benchmarkLabel}（基准）</td>
                {visibleColumns.map((col) => (
                  <td key={`${col.period}__${col.metric}`} className="px-3 py-2.5 text-center text-xs">
                    {col.type === "pct"
                      ? <IntervalPctCell value={getColMetricValue(benchmarkMetrics, col)} />
                      : <IntervalRatioCell value={getColMetricValue(benchmarkMetrics, col)} />}
                  </td>
                ))}
              </tr>
            )}
            {sampleRows.map((label) => (
              <tr key={label} className="border-b border-zinc-50 last:border-0">
                <td className="px-4 py-2.5 text-xs text-zinc-500">{label}</td>
                {visibleColumns.map((col) => (
                  <td key={`${col.period}__${col.metric}`} className="px-3 py-2.5 text-center text-xs text-zinc-400">—</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-1 text-[11px]">
        <div className="text-red-500">指标排名截止日期需要是每周最后交易日。</div>
        <div className="text-zinc-400">
          说明：<span className="text-blue-500 cursor-default">指标排名及分位计算逻辑</span>
        </div>
      </div>
    </div>

      {showAddMetric && (
        <AddMetricModal
          initial={addedCols}
          onClose={() => setShowAddMetric(false)}
          onConfirm={(cols) => {
            setAddedCols(cols)
            setActiveTemplate(null)
            setShowAddMetric(false)
          }}
        />
      )}
    </>
  )
})
IntervalMetricsTable.displayName = "IntervalMetricsTable"
