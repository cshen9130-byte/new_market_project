"use client"

import { useEffect, useState, useMemo, memo, Fragment } from "react"
import type React from "react"
import { useParams } from "next/navigation"
import {
  Area,
  Bar,
  BarChart,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts"
import { ArrowLeft, ChevronDown, Database, Download, HelpCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import {
  ANNUAL_METRIC_COLUMNS,
  computeFundNavMetrics,
  type FundNavMetrics,
  type MetricKey,
} from "@/lib/fund-nav-metrics"

const menuItems = [
  { key: "funds",      label: "基金" },
  { key: "portfolio",  label: "组合" },
  { key: "investment", label: "投资" },
  { key: "operations", label: "运维" },
]

const fundsSidebarGroups = [
  {
    label: "私募数据库",
    items: [
      { key: "private-funds", label: "私募基金" },
      { key: "fund-managers-org", label: "管理人库" },
      { key: "fund-managers", label: "基金经理" },
    ],
  },
]

const TAB_DEFAULT_SIDE: Record<string, string> = {
  funds: "private-funds",
  portfolio: "port-simulated",
  investment: "inv-tracking",
  operations: "ops-strategy-tags",
}

const ACTIVE_SIDE_ITEM = "private-funds"

// ─── Types ────────────────────────────────────────────────────────────────────

interface FundInfo {
  beian_hao:      string
  product_name:   string
  strategy_l1:    string | null
  strategy_l2:    string | null
  strategy_l3:    string | null
  manager:        string
  manager_names:  string | null
  scale:          string | null
  inception_date: string | null
  benchmark:      string | null
  ret_1w:         string | null
  ret_1m:         string | null
  ret_3m:         string | null
  ret_6m:         string | null
  ret_1y:         string | null
  sharpe_1y:      string | null
  calmar_1y:      string | null
}

interface NavRow {
  price_date:         string
  nav:                string
  cumulative_nav:     string
  cum_nav_withdrawal: string
  price_change:       string
}

interface Metrics {
  latest_nav:                string | null
  latest_nav_date:           string | null
  latest_cum_nav:            string | null
  latest_cum_nav_reinvested: string | null
  ret_since_inception:       string | null
  ann_ret:                   string | null
  ytd_ret:                   string | null
  max_drawdown:              string | null
  sharpe_since_inception:    string | null
}

interface DetailData {
  info:       FundInfo
  nav_series: NavRow[]
  metrics:    Metrics
}

interface BenchmarkPoint {
  date: string
  value: number
}

interface PeerMonthlyRow {
  ym:         string
  sample_n:   number
  mean_ret:   number
  median_ret: number
  fund_ret:   number | null
  rank_num:   number | null
}

interface PeerYearlyRow {
  year: number
  interval: string
  sample_n: number
  mean: Record<MetricKey, number | null>
  median: Record<MetricKey, number | null>
  rank: Record<MetricKey, number | null>
  percentile: Record<MetricKey, number | null>
}

interface AnnualFundRow {
  year: number
  interval: string
  metrics: FundNavMetrics
}

const BENCHMARK_OPTIONS = [
  { key: "", label: "不显示" },
  { key: "IM", label: "中证1000" },
  { key: "IC", label: "中证500" },
  { key: "IF", label: "沪深300" },
  { key: "IH", label: "上证50" },
  { key: "NHCI.NH", label: "南华商品指数" },
  { key: "511010.SH", label: "国债ETF" },
  { key: "518880.SH", label: "黄金ETF" },
] as const

function normalizeBenchmarkKey(raw: string | null | undefined): string {
  const text = (raw ?? "").replace(/\s+/g, "")
  if (!text) return ""
  if (text.includes("中证1000")) return "IM"
  if (text.includes("中证500")) return "IC"
  if (text.includes("沪深300")) return "IF"
  if (text.includes("上证50")) return "IH"
  if (text.includes("南华商品")) return "NHCI.NH"
  if (text.includes("国债")) return "511010.SH"
  if (text.includes("黄金")) return "518880.SH"
  return ""
}

function getBenchmarkLabel(key: string): string {
  return BENCHMARK_OPTIONS.find((option) => option.key === key)?.label ?? "业绩基准"
}

function getNavFieldValue(row: NavRow, navType: string): number {
  if (navType === "单位净值") return parseFloat(row.nav)
  if (navType === "累计净值") return parseFloat(row.cum_nav_withdrawal)
  return parseFloat(row.cumulative_nav)
}

function buildAlignedBenchmarkValues(
  rows: NavRow[],
  benchmarkSeries: BenchmarkPoint[],
  chartMode: "nav" | "return",
  navType: string,
): Array<number | null> {
  if (!rows.length || !benchmarkSeries.length) return rows.map(() => null)

  let benchmarkIndex = 0
  let lastBenchmarkValue: number | null = null
  const matchedValues = rows.map((row) => {
    while (benchmarkIndex < benchmarkSeries.length && benchmarkSeries[benchmarkIndex].date <= row.price_date) {
      lastBenchmarkValue = benchmarkSeries[benchmarkIndex].value
      benchmarkIndex += 1
    }
    return lastBenchmarkValue
  })

  const baseIndex = matchedValues.findIndex((value) => value !== null)
  if (baseIndex === -1) return rows.map(() => null)

  const baseBenchmarkValue = matchedValues[baseIndex]
  const baseFundValue = getNavFieldValue(rows[baseIndex], navType)
  if (baseBenchmarkValue === null || !isFinite(baseFundValue) || baseFundValue <= 0) {
    return rows.map(() => null)
  }

  return matchedValues.map((value) => {
    if (value === null || value <= 0) return null
    if (chartMode === "return") {
      return +(((value / baseBenchmarkValue) - 1) * 100).toFixed(4)
    }
    return +((value / baseBenchmarkValue) * baseFundValue).toFixed(4)
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: string | null, decimals = 4): string {
  if (v === null || v === undefined) return "—"
  const n = parseFloat(v)
  if (isNaN(n)) return "—"
  return n.toFixed(decimals)
}

function fmtPct(v: string | null): { text: string; sign: 1 | -1 | 0 } {
  if (v === null || v === undefined) return { text: "—", sign: 0 }
  const n = parseFloat(v)
  if (isNaN(n)) return { text: "—", sign: 0 }
  const sign = n > 0 ? 1 : n < 0 ? -1 : 0
  return { text: (n > 0 ? "+" : "") + n.toFixed(2) + "%", sign }
}

const RED   = "rgb(239,68,68)"
const GREEN = "rgb(34,197,94)"

function PctSpan({ value, large = false }: { value: string | null; large?: boolean }) {
  const { text, sign } = fmtPct(value)
  const cls = large ? "text-2xl font-bold tabular-nums" : "text-sm font-semibold tabular-nums"
  const color =
    sign === 1 ? RED :
    sign === -1 ? GREEN :
    "text-zinc-500"
  return (
    <span className={cls} style={typeof color === "string" && color.startsWith("rgb") ? { color } : undefined}>
      {text}
    </span>
  )
}

// Downsample chart data: keep at most ~500 points for perf
function downsample(rows: NavRow[], maxPoints = 500): NavRow[] {
  if (rows.length <= maxPoints) return rows
  const step = Math.ceil(rows.length / maxPoints)
  const out: NavRow[] = []
  for (let i = 0; i < rows.length; i += step) out.push(rows[i])
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1])
  return out
}

function computeDrawdownSeries(values: number[]): number[] {
  let peak = values[0] ?? 0
  return values.map((v) => {
    if (v > peak) peak = v
    return peak > 0 ? +(((v - peak) / peak) * 100).toFixed(4) : 0
  })
}

function drawdownXTick(val: string): string {
  const month = parseInt(val.slice(5, 7), 10)
  const year = val.slice(0, 4)
  if (month === 1) return year
  if (isNaN(month)) return val.slice(0, 7)
  return `${month}月`
}

interface DrawdownEpisode {
  peakIdx:       number
  troughIdx:     number
  recoveryIdx:   number | null
  maxDrawdown:   number
  peakDate:      string
  troughDate:    string
  recoveryDate:  string | null
  peakValue:     number
}

function computeDrawdownEpisodes(rows: NavRow[], navType: string): DrawdownEpisode[] {
  if (rows.length < 2) return []

  const dates = rows.map((r) => r.price_date)
  const values = rows.map((r) => getNavFieldValue(r, navType))
  const episodes: DrawdownEpisode[] = []

  let peakIdx = 0
  let peakVal = values[0]
  let inEpisode = false
  let troughIdx = 0
  let maxDD = 0

  for (let i = 1; i < values.length; i++) {
    const v = values[i]
    if (v >= peakVal) {
      if (inEpisode && maxDD > 0) {
        episodes.push({
          peakIdx,
          troughIdx,
          recoveryIdx: i,
          maxDrawdown: maxDD,
          peakDate: dates[peakIdx],
          troughDate: dates[troughIdx],
          recoveryDate: dates[i],
          peakValue: peakVal,
        })
      }
      peakIdx = i
      peakVal = v
      inEpisode = false
      maxDD = 0
    } else {
      inEpisode = true
      const dd = peakVal > 0 ? (peakVal - v) / peakVal : 0
      if (dd > maxDD) {
        maxDD = dd
        troughIdx = i
      }
    }
  }

  if (inEpisode && maxDD > 0) {
    episodes.push({
      peakIdx,
      troughIdx,
      recoveryIdx: null,
      maxDrawdown: maxDD,
      peakDate: dates[peakIdx],
      troughDate: dates[troughIdx],
      recoveryDate: null,
      peakValue: peakVal,
    })
  }

  return episodes.sort((a, b) => b.maxDrawdown - a.maxDrawdown).slice(0, 5)
}

interface DrawdownEpisodeRow extends DrawdownEpisode {
  recoveryDays: number | null
  benchReturn:  number | null
}

const DrawdownEpisodesTable = memo(function DrawdownEpisodesTable({
  episodes,
  benchmarkLabel,
  hasBenchmark,
}: {
  episodes: DrawdownEpisodeRow[]
  benchmarkLabel: string
  hasBenchmark: boolean
}) {
  const [showRange, setShowRange] = useState(false)

  if (episodes.length === 0) return null

  return (
    <div className="mt-5">
      <div className="flex items-center justify-end mb-2">
        <button
          type="button"
          onClick={() => setShowRange((v) => !v)}
          className="inline-flex items-center gap-1.5 select-none text-xs text-zinc-600 hover:text-zinc-900 transition-colors"
        >
          <span
            aria-hidden="true"
            className={[
              "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
              showRange ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white",
            ].join(" ")}
          >
            {showRange && (
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 6l3 3 5-5" />
              </svg>
            )}
          </span>
          显示区间
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-100">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 w-16">序号</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">最大回撤</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">
                <span className="inline-flex items-center justify-center gap-1">
                  最大回撤回补期（天）
                  <HelpCircle className="h-3.5 w-3.5 text-zinc-400" title="从回撤低点到净值恢复至前高所需的天数" />
                </span>
              </th>
              {hasBenchmark && (
                <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">
                  <span className="inline-flex items-center justify-center gap-1">
                    同期{benchmarkLabel}（基准）收益
                    <HelpCircle className="h-3.5 w-3.5 text-zinc-400" title="基准在相同回撤区间（前高至低点）的收益率" />
                  </span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {episodes.map((ep, idx) => (
              <tr key={`${ep.peakDate}-${ep.troughDate}`} className="border-b border-zinc-50 last:border-0">
                <td className="px-4 py-2.5 text-xs text-zinc-700">{idx + 1}</td>
                <td className="px-4 py-2.5 text-center text-xs tabular-nums">
                  <div className="text-zinc-900 font-medium">{(ep.maxDrawdown * 100).toFixed(2)}%</div>
                  <div className={`text-[11px] text-zinc-400 mt-0.5 min-h-[1rem] ${showRange ? "" : "invisible"}`}>
                    {ep.peakDate} ~ {ep.troughDate}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-center text-xs text-zinc-700 tabular-nums">
                  <div>{ep.recoveryDays === null ? "未回补" : ep.recoveryDays}</div>
                  {ep.recoveryDate && (
                    <div className={`text-[11px] text-zinc-400 mt-0.5 min-h-[1rem] ${showRange ? "" : "invisible"}`}>
                      {ep.troughDate} ~ {ep.recoveryDate}
                    </div>
                  )}
                </td>
                {hasBenchmark && (
                  <td className="px-4 py-2.5 text-center text-xs tabular-nums">
                    {ep.benchReturn === null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <>
                        <div className="font-medium" style={{ color: ep.benchReturn < 0 ? GREEN : ep.benchReturn > 0 ? RED : undefined }}>
                          {(ep.benchReturn >= 0 ? "+" : "") + (ep.benchReturn * 100).toFixed(2)}%
                        </div>
                        <div className={`text-[11px] text-zinc-400 mt-0.5 min-h-[1rem] ${showRange ? "" : "invisible"}`}>
                          {ep.peakDate} ~ {ep.troughDate}
                        </div>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})
DrawdownEpisodesTable.displayName = "DrawdownEpisodesTable"

const INTERVAL_METRIC_COLUMNS = [
  { key: "ret_1w", period: "近一周", metric: "收益", days: 7, type: "pct" as const },
  { key: "ret_1m", period: "近一月", metric: "收益", days: 30, type: "pct" as const },
  { key: "ret_3m", period: "近三月", metric: "收益", days: 91, type: "pct" as const },
  { key: "ret_6m", period: "近六月", metric: "收益", days: 182, type: "pct" as const },
  { key: "ret_1y", period: "近一年", metric: "收益", days: 365, type: "pct" as const },
  { key: "sharpe_1y", period: "近一年", metric: "夏普比率", type: "ratio" as const },
  { key: "calmar_1y", period: "近一年", metric: "卡玛比率", type: "ratio" as const },
]

type IntervalMetricValues = Record<(typeof INTERVAL_METRIC_COLUMNS)[number]["key"], string | number | null>

function calcMetricInterval(cutoff: string, days: number): string {
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

function buildBenchmarkIntervalMetrics(series: BenchmarkPoint[], cutoff: string): IntervalMetricValues {
  return {
    ret_1w: computeBenchmarkPeriodReturn(series, cutoff, 7),
    ret_1m: computeBenchmarkPeriodReturn(series, cutoff, 30),
    ret_3m: computeBenchmarkPeriodReturn(series, cutoff, 91),
    ret_6m: computeBenchmarkPeriodReturn(series, cutoff, 182),
    ret_1y: computeBenchmarkPeriodReturn(series, cutoff, 365),
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

const IntervalMetricsTable = memo(function IntervalMetricsTable({
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

  function exportCsv() {
    const headers = ["产品名称", ...INTERVAL_METRIC_COLUMNS.map((c) => `${c.period}${c.metric}`)]
    const rows: string[][] = [
      headers,
      [
        productName,
        ...INTERVAL_METRIC_COLUMNS.map((c) => formatIntervalMetricExport(fundMetrics[c.key], c.type, c.type === "pct" ? "percent" : "ratio")),
      ],
    ]
    if (showBenchmark && benchmarkMetrics) {
      rows.push([
        `${benchmarkLabel}（基准）`,
        ...INTERVAL_METRIC_COLUMNS.map((c) => formatIntervalMetricExport(benchmarkMetrics[c.key], c.type, "ratio")),
      ])
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

  const sampleRows = ["样本平均值", "样本中位数", "样本排名", "四分位"]

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            区间指标
            <HelpCircle className="h-3.5 w-3.5 text-zinc-400" title="各时间区间内的收益与风险指标" />
          </div>
          {cutoffDate && (
            <div className="text-xs text-zinc-400 mt-1">统计截止：{cutoffDate}</div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          {hasBenchmark && (
            <button
              type="button"
              onClick={() => setShowBenchmark((v) => !v)}
              className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors"
            >
              <span
                aria-hidden="true"
                className={[
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
                  showBenchmark ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white",
                ].join(" ")}
              >
                {showBenchmark && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              基准指数
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowInterval((v) => !v)}
            className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors"
          >
            <span
              aria-hidden="true"
              className={[
                "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
                showInterval ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white",
              ].join(" ")}
            >
              {showInterval && (
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              )}
            </span>
            显示区间
          </button>
          {sampleGroup && (
            <div className="inline-flex items-center gap-1.5">
              <span className="text-zinc-500">样本组：</span>
              <select
                defaultValue={sampleGroup}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 max-w-[120px]"
              >
                <option value={sampleGroup}>{sampleGroup}</option>
              </select>
              <span className="px-1 py-0.5 text-[10px] rounded bg-red-50 text-red-500 border border-red-200 leading-none">平台</span>
            </div>
          )}
          <select
            disabled
            className="text-xs border border-zinc-200 rounded px-2 py-1 bg-zinc-50 text-zinc-400"
          >
            <option>指标选择</option>
          </select>
          <select
            disabled
            className="text-xs border border-zinc-200 rounded px-2 py-1 bg-zinc-50 text-zinc-400"
          >
            <option>默认模板</option>
          </select>
          <button
            type="button"
            disabled
            className="text-blue-500 hover:text-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            添加指标
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-100">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-100">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 min-w-[140px]">产品名称</th>
              {INTERVAL_METRIC_COLUMNS.map((col) => (
                <th key={col.key} className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 whitespace-nowrap">
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
              {INTERVAL_METRIC_COLUMNS.map((col) => (
                <td key={col.key} className="px-3 py-2.5 text-center text-xs">
                  {col.type === "pct"
                    ? <IntervalPctCell value={fundMetrics[col.key]} unit="percent" />
                    : <IntervalRatioCell value={fundMetrics[col.key]} />}
                </td>
              ))}
            </tr>
            {showBenchmark && benchmarkMetrics && (
              <tr className="border-b border-zinc-50 bg-zinc-50/40">
                <td className="px-4 py-2.5 text-xs text-zinc-600">{benchmarkLabel}（基准）</td>
                {INTERVAL_METRIC_COLUMNS.map((col) => (
                  <td key={col.key} className="px-3 py-2.5 text-center text-xs">
                    {col.type === "pct"
                      ? <IntervalPctCell value={benchmarkMetrics[col.key]} />
                      : <IntervalRatioCell value={benchmarkMetrics[col.key]} />}
                  </td>
                ))}
              </tr>
            )}
            {sampleRows.map((label) => (
              <tr key={label} className="border-b border-zinc-50 last:border-0">
                <td className="px-4 py-2.5 text-xs text-zinc-500">{label}</td>
                {INTERVAL_METRIC_COLUMNS.map((col) => (
                  <td key={col.key} className="px-3 py-2.5 text-center text-xs text-zinc-400">—</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[11px] text-zinc-400">
        说明：<span className="text-blue-500 cursor-default">指标排名及分位计算说明</span>
      </div>
    </div>
  )
})
IntervalMetricsTable.displayName = "IntervalMetricsTable"

type ReturnGranularity = "week" | "month" | "quarter" | "half" | "year" | "phase"

const RETURN_GRANULARITY_OPTIONS: { key: ReturnGranularity; label: string }[] = [
  { key: "week", label: "周度" },
  { key: "month", label: "月度" },
  { key: "quarter", label: "季度" },
  { key: "half", label: "半年度" },
  { key: "year", label: "年度" },
  { key: "phase", label: "阶段" },
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
    const start = rows[0]
    const end = rows[rows.length - 1]
    const f0 = getNavFieldValue(start, navType)
    const f1 = getNavFieldValue(end, navType)
    const b0 = benchmarkAtDate(sortedBench, start.price_date)
    const b1 = benchmarkAtDate(sortedBench, end.price_date)
    const fundPct = f0 > 0 ? (f1 / f0 - 1) * 100 : 0
    const benchPct = b0 && b1 && b0 > 0 ? (b1 / b0 - 1) * 100 : null
    return [{
      label: start.price_date.slice(0, 7),
      fundPct,
      benchPct,
      excessPct: benchPct !== null ? fundPct - benchPct : null,
    }]
  }

  const bucketLast = new Map<string, NavRow>()
  for (const row of rows) {
    bucketLast.set(periodBucket(row.price_date, gran), row)
  }
  const buckets = [...bucketLast.keys()].sort()

  return buckets.map((bucket, i) => {
    const endRow = bucketLast.get(bucket)!
    const endNav = getNavFieldValue(endRow, navType)

    let baseNav: number
    let baseDate: string
    if (i === 0) {
      const firstRow = rows.find((r) => periodBucket(r.price_date, gran) === bucket)!
      baseNav = getNavFieldValue(firstRow, navType)
      baseDate = firstRow.price_date
    } else {
      const prevRow = bucketLast.get(buckets[i - 1])!
      baseNav = getNavFieldValue(prevRow, navType)
      baseDate = prevRow.price_date
    }

    const fundPct = baseNav > 0 ? (endNav / baseNav - 1) * 100 : 0
    const b0 = benchmarkAtDate(sortedBench, baseDate)
    const b1 = benchmarkAtDate(sortedBench, endRow.price_date)
    const benchPct = b0 && b1 && b0 > 0 ? (b1 / b0 - 1) * 100 : null

    return {
      label: formatBucketLabel(bucket, gran),
      fundPct,
      benchPct,
      excessPct: benchPct !== null ? fundPct - benchPct : null,
    }
  })
}

function ReturnBarTooltip({
  active,
  payload,
  label,
  showExcess,
  productName,
  benchmarkLabel,
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

const IntervalReturnsChart = memo(function IntervalReturnsChart({
  productName,
  sampleGroup,
  dateRangeLabel,
  rows,
  navType,
  benchmarkSeries,
  benchmarkLabel,
  hasBenchmark,
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
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = Math.max((max - min) * 0.1, 1)
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }, [chartData, showBenchmark, showExcess])

  const seriesName = showExcess && showBenchmark ? "超额" : productName
  const displayData = chartData

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
    const bom = "\uFEFF"
    const blob = new Blob([bom + [headers, ...lines].map((r) => r.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${productName}_区间收益.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (chartData.length === 0) return null

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            区间收益
          </div>
          {dateRangeLabel && (
            <div className="text-xs text-zinc-400 mt-1">统计区间：{dateRangeLabel}</div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          {hasBenchmark && (
            <>
              <button
                type="button"
                onClick={() => setShowExcess((v) => !v)}
                className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors"
              >
                <span className={["inline-flex h-3.5 w-3.5 items-center justify-center rounded border", showExcess ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white"].join(" ")}>
                  {showExcess && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>}
                </span>
                超额
              </button>
              <button
                type="button"
                onClick={() => setShowBenchmark((v) => !v)}
                className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors"
              >
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
          <select disabled className="text-xs border border-zinc-200 rounded px-2 py-1 bg-zinc-50 text-zinc-400">
            <option>指标选择</option>
          </select>
          <div className="inline-flex rounded border border-zinc-200 overflow-hidden">
            {RETURN_GRANULARITY_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setGranularity(opt.key)}
                className={[
                  "px-2.5 py-1 text-xs transition-colors border-r border-zinc-200 last:border-r-0",
                  granularity === opt.key ? "bg-zinc-900 text-white font-medium" : "bg-white text-zinc-600 hover:bg-zinc-50",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800 transition-colors">
            <Download className="h-3.5 w-3.5" />
            导出
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
          <BarChart data={displayData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#a1a1aa" }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis
              domain={yDomain}
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              width={44}
              tickFormatter={(v: number) => `${v}%`}
              label={{ value: "收益率（%）", angle: -90, position: "insideLeft", offset: 8, style: { fontSize: 11, fill: "#a1a1aa" } }}
            />
            <Tooltip content={(props) => (
              <ReturnBarTooltip
                active={props.active}
                payload={props.payload as Array<{ dataKey?: string; value?: number; color?: string }>}
                label={props.label as string}
                showExcess={showExcess}
                productName={productName}
                benchmarkLabel={benchmarkLabel}
              />
            )} />
            <ReferenceLine y={0} stroke="#d4d4d8" />
            {showBenchmark && !showExcess ? (
              <>
                <Bar dataKey="fundPct" name={productName} radius={[2, 2, 0, 0]}>
                  {displayData.map((entry, i) => (
                    <Cell key={`f-${i}`} fill={entry.fundPct >= 0 ? RED : GREEN} />
                  ))}
                </Bar>
                <Bar dataKey="benchPct" name={`${benchmarkLabel}（基准）`} radius={[2, 2, 0, 0]}>
                  {displayData.map((entry, i) => (
                    <Cell key={`b-${i}`} fill={entry.benchPct !== null && entry.benchPct >= 0 ? "#2563eb" : "#34d399"} />
                  ))}
                </Bar>
              </>
            ) : (
              <Bar dataKey={showExcess && showBenchmark ? "excessPct" : "fundPct"} name={seriesName} radius={[2, 2, 0, 0]}>
                {displayData.map((entry, i) => {
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

// ─── Monthly Returns Calendar ──────────────────────────────────────────────────

interface MonthlyReturn {
  year: number
  month: number
  ret: number | null
}

function computeMonthlyReturns(rows: NavRow[], navType: string): MonthlyReturn[] {
  if (!rows.length) return []
  const sorted = [...rows].sort((a, b) => a.price_date.localeCompare(b.price_date))

  const monthFirst = new Map<string, number>()
  const monthLast  = new Map<string, number>()
  for (const row of sorted) {
    const ym = row.price_date.slice(0, 7)
    const v  = getNavFieldValue(row, navType)
    if (!monthFirst.has(ym)) monthFirst.set(ym, v)
    monthLast.set(ym, v)
  }

  const keys = [...monthLast.keys()].sort()
  return keys.map((key, i) => {
    const [yearStr, monthStr] = key.split("-")
    const year  = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10)
    const cur   = monthLast.get(key)!
    const prev  = i === 0 ? monthFirst.get(key) : monthLast.get(keys[i - 1])
    if (!prev || prev <= 0 || !isFinite(cur)) return { year, month, ret: null }
    return { year, month, ret: (cur / prev - 1) * 100 }
  })
}

const CALENDAR_MONTHS = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"]

const MonthlyReturnsCalendar = memo(function MonthlyReturnsCalendar({
  productName,
  sampleGroup,
  rows,
  navType,
  peerMonthly,
}: {
  productName: string
  sampleGroup: string | null
  rows: NavRow[]
  navType: string
  peerMonthly: PeerMonthlyRow[]
}) {
  const INITIAL_YEARS = 2
  const [expanded, setExpanded] = useState(false)

  const monthly = useMemo(() => computeMonthlyReturns(rows, navType), [rows, navType])

  // Build a lookup map: ym → PeerMonthlyRow
  const peerByYm = useMemo(() => {
    const m = new Map<string, PeerMonthlyRow>()
    for (const r of peerMonthly) m.set(r.ym, r)
    return m
  }, [peerMonthly])

  const yearGroups = useMemo(() => {
    const map = new Map<number, (number | null)[]>()
    for (const { year, month, ret } of monthly) {
      if (!map.has(year)) map.set(year, Array(12).fill(null))
      map.get(year)![month - 1] = ret
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0])
  }, [monthly])

  if (!yearGroups.length) return null

  function yearTotalReturn(rets: (number | null)[]): number | null {
    const valid = rets.filter((r): r is number => r !== null)
    if (!valid.length) return null
    return valid.reduce((acc, r) => acc * (1 + r / 100), 1) * 100 - 100
  }

  function calcWinRate(rets: (number | null)[]): number | null {
    const valid = rets.filter((r): r is number => r !== null)
    if (!valid.length) return null
    return (valid.filter((r) => r > 0).length / valid.length) * 100
  }

  function fmtPctCell(v: number | null): { text: string; style?: React.CSSProperties } {
    if (v === null) return { text: "—" }
    const color = v > 0 ? RED : v < 0 ? GREEN : undefined
    return { text: (v > 0 ? "+" : "") + v.toFixed(2) + "%", style: color ? { color } : undefined }
  }

  // Quartile bar: wider = better rank. Score = 1 − (rank−1)/sampleN ∈ (0,1]
  function quartileBar(ym: string): React.ReactNode {
    const p = peerByYm.get(ym)
    if (!p || p.rank_num === null || p.sample_n <= 0) {
      return <div className="h-1.5 w-full rounded-full bg-zinc-100 mx-auto max-w-[40px]" />
    }
    const score = Math.max(0, Math.min(1, 1 - (p.rank_num - 1) / p.sample_n))
    const pct = Math.round(score * 100)
    // Color: Q1 (top 25%) → red, Q2 → orange, Q3 → yellow, Q4 → zinc
    const barColor = score > 0.75 ? "#ef4444" : score > 0.5 ? "#f97316" : score > 0.25 ? "#eab308" : "#a1a1aa"
    return (
      <div className="w-full rounded-full bg-zinc-100 mx-auto max-w-[40px] h-1.5 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
    )
  }

  const visibleYears = expanded ? yearGroups : yearGroups.slice(0, INITIAL_YEARS)
  const hasMore = yearGroups.length > INITIAL_YEARS
  const hasPeer = peerMonthly.length > 0

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
          月度收益
        </div>
        {sampleGroup && (
          <div className="inline-flex items-center gap-1.5 text-xs text-zinc-600">
            <span className="text-zinc-500">样本组：</span>
            <select defaultValue={sampleGroup} className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 max-w-[120px]">
              <option value={sampleGroup}>{sampleGroup}</option>
            </select>
            <span className="px-1 py-0.5 text-[10px] rounded bg-red-50 text-red-500 border border-red-200 leading-none">平台</span>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-100">
        <table className="w-full text-xs min-w-[960px] border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              <th className="px-3 py-2.5 text-left font-medium text-zinc-500 w-12 border-r border-zinc-100">年份</th>
              <th className="px-3 py-2.5 text-left font-medium text-zinc-500 min-w-[100px] border-r border-zinc-100">基金名称</th>
              {CALENDAR_MONTHS.map((m) => (
                <th key={m} className="px-2 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{m}</th>
              ))}
              <th className="px-2 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap border-l border-zinc-100">胜率</th>
              <th className="px-2 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">全年</th>
            </tr>
          </thead>
          <tbody>
            {visibleYears.map(([year, rets], yi) => {
              const yr = yearTotalReturn(rets)
              const wr = calcWinRate(rets)
              const yrFmt = fmtPctCell(yr)
              const wrText = wr !== null ? wr.toFixed(2) + "%" : "—"
              const isLastGroup = yi === visibleYears.length - 1

              // Peer stats rows configuration
              type SampleRowDef = { label: string; render: (ym: string) => React.ReactNode }
              const sampleRows: SampleRowDef[] = hasPeer ? [
                {
                  label: "样本平均值",
                  render: (ym) => {
                    const p = peerByYm.get(ym)
                    if (!p) return <span className="text-zinc-300">—</span>
                    const { text, style } = fmtPctCell(p.mean_ret)
                    return <span className="text-zinc-500 tabular-nums" style={style}>{text}</span>
                  },
                },
                {
                  label: "样本中位数",
                  render: (ym) => {
                    const p = peerByYm.get(ym)
                    if (!p) return <span className="text-zinc-300">—</span>
                    const { text, style } = fmtPctCell(p.median_ret)
                    return <span className="text-zinc-500 tabular-nums" style={style}>{text}</span>
                  },
                },
                {
                  label: "样本排名",
                  render: (ym) => {
                    const p = peerByYm.get(ym)
                    if (!p || p.rank_num === null) return <span className="text-zinc-300">—</span>
                    return <span className="text-zinc-500 tabular-nums">{p.rank_num}/{p.sample_n}</span>
                  },
                },
                {
                  label: "四分位",
                  render: (ym) => quartileBar(ym),
                },
              ] : [
                { label: "样本平均值", render: () => <span className="text-zinc-300">—</span> },
                { label: "样本中位数", render: () => <span className="text-zinc-300">—</span> },
                { label: "样本排名",   render: () => <span className="text-zinc-300">—</span> },
                { label: "四分位",     render: () => <div className="h-1.5 w-full rounded-full bg-zinc-100 mx-auto max-w-[40px]" /> },
              ]

              return (
                <Fragment key={year}>
                  <tr className="border-b border-zinc-50 hover:bg-zinc-50/40">
                    <td
                      className="px-3 py-2.5 text-zinc-700 font-semibold border-r border-zinc-100 align-top"
                      rowSpan={sampleRows.length + 1}
                    >
                      {year}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-800 font-medium border-r border-zinc-100 truncate max-w-[120px]">{productName}</td>
                    {rets.map((r, mi) => {
                      const { text, style } = fmtPctCell(r)
                      return (
                        <td key={mi} className="px-2 py-2.5 text-center tabular-nums font-medium" style={style}>
                          {text}
                        </td>
                      )
                    })}
                    <td className="px-2 py-2.5 text-center tabular-nums text-zinc-700 border-l border-zinc-100">{wrText}</td>
                    <td className="px-2 py-2.5 text-center tabular-nums font-medium" style={yrFmt.style}>{yrFmt.text}</td>
                  </tr>
                  {sampleRows.map(({ label, render }, ri) => {
                    const isLast = ri === sampleRows.length - 1
                    const rowCls = ["border-b", isLast && !isLastGroup ? "border-b-zinc-200" : "border-b-zinc-50"].join(" ")
                    return (
                      <tr key={label} className={rowCls}>
                        <td className="px-3 py-1.5 text-zinc-400 border-r border-zinc-100">{label}</td>
                        {Array.from({ length: 12 }, (_, mi) => {
                          const ym = `${year}-${String(mi + 1).padStart(2, "0")}`
                          return (
                            <td key={mi} className="px-2 py-1.5 text-center">
                              {render(ym)}
                            </td>
                          )
                        })}
                        <td className="px-2 py-1.5 text-center text-zinc-300 border-l border-zinc-100">—</td>
                        <td className="px-2 py-1.5 text-center text-zinc-300">—</td>
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
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full text-xs text-blue-500 hover:text-blue-600 transition-colors py-1 text-center"
        >
          {expanded ? "收起" : "展开更多年份"}
        </button>
      )}
    </div>
  )
})
MonthlyReturnsCalendar.displayName = "MonthlyReturnsCalendar"

// ─── Rank Percentile Trend Chart ──────────────────────────────────────────────

interface RankPoint {
  ym:    string
  pct:   number   // (rank-1)/sample_n*100, 0=best, ~100=worst
  rank:  number
  total: number
}

function RankPercentileTooltip({
  active, payload, label,
}: {
  active?: boolean
  payload?: Array<{ value?: number; payload?: RankPoint }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload!
  return (
    <div className="bg-white border border-zinc-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="font-semibold text-zinc-700 mb-1">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="text-zinc-500">排名分位：</span>
        <span className="tabular-nums font-medium" style={{ color: RED }}>
          {d.pct.toFixed(2)}%
        </span>
      </div>
      <div className="text-zinc-400 mt-0.5 tabular-nums">
        {d.rank} / {d.total}
      </div>
    </div>
  )
}

const RankPercentileTrendChart = memo(function RankPercentileTrendChart({
  peerMonthly,
  dateRangeLabel,
}: {
  peerMonthly: PeerMonthlyRow[]
  dateRangeLabel: string
}) {
  const chartData = useMemo((): RankPoint[] =>
    peerMonthly
      .filter((r) => r.rank_num !== null && r.sample_n > 0)
      .map((r) => ({
        ym:    r.ym,
        pct:   +((r.rank_num! - 1) / r.sample_n * 100).toFixed(2),
        rank:  r.rank_num!,
        total: r.sample_n,
      })),
  [peerMonthly])

  if (!chartData.length) return null

  const firstYm = chartData[0].ym
  const lastYm  = chartData[chartData.length - 1].ym
  const rangeLabel = dateRangeLabel || `${firstYm} ~ ${lastYm}`

  function exportCsv() {
    const bom  = "\uFEFF"
    const headers = ["月份", "排名分位", "排名", "样本数"]
    const lines = chartData.map((d) =>
      [d.ym, d.pct.toFixed(2) + "%", d.rank, d.total].join(",")
    )
    const blob = new Blob([bom + [headers.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8;",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = "排名分位走势.csv"; a.click()
    URL.revokeObjectURL(url)
  }

  // Y-axis ticks: 0 at top → 100 at bottom (reversed)
  const Y_TICKS = [0, 20, 40, 60, 80, 100]

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            区间收益排名分位走势
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            统计区间：{rangeLabel}&nbsp;&nbsp;排名周期：月度
          </div>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          title="导出CSV"
          className="p-1.5 rounded hover:bg-zinc-50 text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="3" y1="4"  x2="13" y2="4"  strokeLinecap="round" />
            <line x1="3" y1="8"  x2="13" y2="8"  strokeLinecap="round" />
            <line x1="3" y1="12" x2="13" y2="12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* legend */}
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-3 mt-2">
        <span className="inline-block w-6 h-0.5 rounded" style={{ backgroundColor: RED }} />
        排名分位
      </div>

      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
            <XAxis
              dataKey="ym"
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              reversed
              domain={[0, 100]}
              ticks={Y_TICKS}
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              width={44}
              tickFormatter={(v: number) => v === 0 ? "0%" : `+${v}%`}
            />
            <Tooltip
              content={(props) => (
                <RankPercentileTooltip
                  active={props.active}
                  payload={props.payload as Array<{ value?: number; payload?: RankPoint }>}
                  label={props.label as string}
                />
              )}
            />
            <ReferenceLine y={25} stroke="#e4e4e7" strokeDasharray="4 2" />
            <ReferenceLine y={50} stroke="#e4e4e7" strokeDasharray="4 2" />
            <ReferenceLine y={75} stroke="#e4e4e7" strokeDasharray="4 2" />
            <Line
              type="linear"
              dataKey="pct"
              stroke={RED}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4, fill: RED }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})
RankPercentileTrendChart.displayName = "RankPercentileTrendChart"

// ─── Annual Metrics Table ────────────────────────────────────────────────────

function AnnualMetricFundCell({ value, type }: { value: number | null; type: "pct" | "ratio" | "days" }) {
  if (value === null || !isFinite(value)) return <span className="text-zinc-400">—</span>
  if (type === "days") return <span className="tabular-nums font-medium text-zinc-800">{Math.round(value)}</span>
  if (type === "ratio") {
    return <span className="tabular-nums font-medium text-zinc-800">{value.toFixed(4)}</span>
  }
  const pct = value * 100
  const color = pct > 0 ? RED : pct < 0 ? GREEN : undefined
  return (
    <span className="tabular-nums font-medium" style={color ? { color } : undefined}>
      {pct.toFixed(2)}%
    </span>
  )
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

const AnnualMetricsTable = memo(function AnnualMetricsTable({
  productName,
  sampleGroup,
  dateRangeLabel,
  fundRows,
  peerByYear,
  hasBenchmark,
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

  if (!fundRows.length) return null

  const visibleRows = expanded ? fundRows : fundRows.slice(0, INITIAL_YEARS)
  const hasMore = fundRows.length > INITIAL_YEARS
  const hasPeer = peerByYear.size > 0

  function exportCsv() {
    const headers = ["年份", "基金名称", ...ANNUAL_METRIC_COLUMNS.map((c) => c.label)]
    const lines: string[][] = [headers]
    for (const row of fundRows) {
      lines.push([
        String(row.year),
        productName,
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
    const bom = "\uFEFF"
    const blob = new Blob([bom + lines.map((r) => r.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${productName}_年度指标.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sampleLabels = ["样本平均值", "样本中位数", "样本排名", "四分位"] as const

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            年度指标
          </div>
          {dateRangeLabel && (
            <div className="text-xs text-zinc-400 mt-1">统计区间：{dateRangeLabel}</div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          {hasBenchmark && (
            <button
              type="button"
              onClick={() => setShowBenchmark((v) => !v)}
              className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors"
            >
              <span
                aria-hidden="true"
                className={[
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
                  showBenchmark ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white",
                ].join(" ")}
              >
                {showBenchmark && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              基准指数
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowInterval((v) => !v)}
            className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors"
          >
            <span
              aria-hidden="true"
              className={[
                "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
                showInterval ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white",
              ].join(" ")}
            >
              {showInterval && (
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              )}
            </span>
            显示区间
          </button>
          {sampleGroup && (
            <div className="inline-flex items-center gap-1.5">
              <span className="text-zinc-500">样本组：</span>
              <select
                defaultValue={sampleGroup}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 max-w-[120px]"
              >
                <option value={sampleGroup}>{sampleGroup}</option>
              </select>
              <span className="px-1 py-0.5 text-[10px] rounded bg-red-50 text-red-500 border border-red-200 leading-none">平台</span>
            </div>
          )}
          <select disabled className="text-xs border border-zinc-200 rounded px-2 py-1 bg-zinc-50 text-zinc-400">
            <option>指标选择</option>
          </select>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            导出
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
                  {showInterval && (
                    <div className="text-[10px] font-normal text-zinc-400 mt-0.5 min-h-[0.875rem]">&nbsp;</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((fundRow, yi) => {
              const peer = peerByYear.get(fundRow.year)
              const isLastGroup = yi === visibleRows.length - 1
              const rowSpan = sampleLabels.length + 1

              return (
                <Fragment key={fundRow.year}>
                  <tr className="border-b border-zinc-50 hover:bg-zinc-50/40">
                    <td
                      className="px-3 py-2.5 text-zinc-700 font-semibold border-r border-zinc-100 align-top"
                      rowSpan={rowSpan}
                    >
                      <div>{fundRow.year}</div>
                      {showInterval && (
                        <div className="text-[10px] font-normal text-zinc-400 mt-1 font-normal whitespace-nowrap">
                          {fundRow.interval}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-800 font-medium border-r border-zinc-100 truncate max-w-[120px]">
                      {productName}
                    </td>
                    {ANNUAL_METRIC_COLUMNS.map((col) => (
                      <td key={col.key} className="px-2 py-2.5 text-center">
                        <AnnualMetricFundCell value={fundRow.metrics[col.key]} type={col.type} />
                      </td>
                    ))}
                  </tr>
                  {sampleLabels.map((label, ri) => {
                    const isLast = ri === sampleLabels.length - 1
                    const rowCls = ["border-b", isLast && !isLastGroup ? "border-b-zinc-200" : "border-b-zinc-50"].join(" ")
                    return (
                      <tr key={label} className={rowCls}>
                        <td className="px-3 py-1.5 text-zinc-400 border-r border-zinc-100">{label}</td>
                        {ANNUAL_METRIC_COLUMNS.map((col) => (
                          <td key={col.key} className="px-2 py-1.5 text-center">
                            {!hasPeer || !peer ? (
                              <span className="text-zinc-300">—</span>
                            ) : label === "样本平均值" ? (
                              <AnnualMetricPeerCell value={peer.mean[col.key]} type={col.type} />
                            ) : label === "样本中位数" ? (
                              <AnnualMetricPeerCell value={peer.median[col.key]} type={col.type} />
                            ) : label === "样本排名" ? (
                              peer.rank[col.key] !== null ? (
                                <span className="tabular-nums text-zinc-500">
                                  {peer.rank[col.key]}/{peer.sample_n}
                                </span>
                              ) : (
                                <span className="text-zinc-300">—</span>
                              )
                            ) : (
                              <AnnualQuartileCell percentile={peer.percentile[col.key]} />
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
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1 text-xs text-blue-500 hover:text-blue-600 transition-colors py-1"
        >
          {expanded ? "收起" : "展开更多"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  )
})
AnnualMetricsTable.displayName = "AnnualMetricsTable"

// ─── Annual Rank Radar ───────────────────────────────────────────────────────

const ANNUAL_RADAR_METRICS = ANNUAL_METRIC_COLUMNS.filter((c) =>
  (["periodRet", "annVol", "sharpe", "calmar", "maxDD"] as MetricKey[]).includes(c.key),
)

const YEAR_RADAR_COLORS = ["#ef4444", "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2"]

function peerHasRadarRanks(peer: PeerYearlyRow): boolean {
  return ANNUAL_RADAR_METRICS.some((c) => peer.rank[c.key] !== null)
}

function radarScore(rank: number, sampleN: number): number {
  if (sampleN <= 0) return 0
  return +((1 - (rank - 1) / sampleN) * 100).toFixed(2)
}

const AnnualRankRadarPanel = memo(function AnnualRankRadarPanel({
  peerByYear,
}: {
  peerByYear: Map<number, PeerYearlyRow>
}) {
  const INITIAL_YEARS = 2
  const [expanded, setExpanded] = useState(false)

  const rankedYears = useMemo(
    () => [...peerByYear.entries()]
      .filter(([, peer]) => peerHasRadarRanks(peer))
      .sort((a, b) => b[0] - a[0]),
    [peerByYear],
  )

  if (!rankedYears.length) return null

  const visibleYears = expanded ? rankedYears : rankedYears.slice(0, INITIAL_YEARS)
  const hasMore = rankedYears.length > INITIAL_YEARS

  const radarData = useMemo(() => {
    return ANNUAL_RADAR_METRICS.map((col) => {
      const row: Record<string, string | number> = { metric: col.label }
      for (const [year, peer] of visibleYears) {
        const rank = peer.rank[col.key]
        if (rank !== null) row[`y${year}`] = radarScore(rank, peer.sample_n)
      }
      return row
    })
  }, [visibleYears])

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-col lg:flex-row gap-6 items-stretch">
        <div className="flex-1 min-w-0">
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="72%">
                <PolarGrid stroke="#e4e4e7" />
                <PolarAngleAxis
                  dataKey="metric"
                  tick={{ fontSize: 11, fill: "#71717a" }}
                />
                <PolarRadiusAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: "#a1a1aa" }}
                  axisLine={false}
                  tickCount={5}
                />
                {visibleYears.map(([year], i) => (
                  <Radar
                    key={year}
                    name={`${year}年`}
                    dataKey={`y${year}`}
                    stroke={YEAR_RADAR_COLORS[i % YEAR_RADAR_COLORS.length]}
                    fill={YEAR_RADAR_COLORS[i % YEAR_RADAR_COLORS.length]}
                    fillOpacity={0.12}
                    strokeWidth={1.5}
                    dot={{ r: 2.5 }}
                    isAnimationActive={false}
                  />
                ))}
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, color: "#71717a" }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="overflow-x-auto rounded-lg border border-zinc-100 flex-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-100">
                  <th className="px-4 py-2.5 text-left font-medium text-zinc-500">指标</th>
                  {visibleYears.map(([year]) => (
                    <th key={year} className="px-4 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">
                      {year}年排名
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ANNUAL_RADAR_METRICS.map((col) => (
                  <tr key={col.key} className="border-b border-zinc-50 last:border-0">
                    <td className="px-4 py-2.5 text-zinc-700">{col.label}</td>
                    {visibleYears.map(([year, peer]) => {
                      const rank = peer.rank[col.key]
                      return (
                        <td key={year} className="px-4 py-2.5 text-center tabular-nums text-zinc-600">
                          {rank !== null ? `${rank}/${peer.sample_n}` : "—"}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1 text-xs text-blue-500 hover:text-blue-600 transition-colors py-1"
        >
          {expanded ? "收起" : "展开更多"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  )
})
AnnualRankRadarPanel.displayName = "AnnualRankRadarPanel"

// ─── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 px-4 rounded-lg bg-zinc-50 border border-zinc-100 min-w-0">
      <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide leading-none">{label}</span>
      <div className="mt-1 text-[22px] font-bold tabular-nums leading-tight text-zinc-900">{value}</div>
      {sub && <span className="text-[11px] text-zinc-400 mt-0.5">{sub}</span>}
    </div>
  )
}

// ─── NAV Table (scrollable, no pagination) ──────────────────────────────────

function exportNavCsv(rows: NavRow[], filename: string) {
  const escape = (v: string | null | undefined) => {
    if (v == null || v === "") return ""
    const s = String(v)
    return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
  }
  const headers = ["日期", "单位净值", "累计净值", "复权净值", "涨跌幅"]
  const csvRows = [
    headers.join(","),
    ...rows.map((r) => {
      const chg = parseFloat(r.price_change)
      const chgPct = isNaN(chg) ? "" : (chg * 100).toFixed(2) + "%"
      return [
        escape(r.price_date),
        escape(r.nav),
        escape(r.cum_nav_withdrawal),
        escape(r.cumulative_nav),
        escape(chgPct),
      ].join(",")
    }),
  ]
  const bom = "\uFEFF"
  const blob = new Blob([bom + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function NavTable({ rows }: { rows: NavRow[] }) {
  // Show newest first
  const reversed = useMemo(() => [...rows].reverse(), [rows])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="overflow-y-auto flex-1 rounded-lg border border-zinc-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-zinc-50 border-b border-zinc-100">
              <th className="px-3 py-2.5 text-left font-medium text-zinc-500 text-xs">日期</th>
              <th className="px-3 py-2.5 text-right font-medium text-zinc-500 text-xs">单位净值</th>
              <th className="px-3 py-2.5 text-right font-medium text-zinc-500 text-xs">累计净值</th>
              <th className="px-3 py-2.5 text-right font-medium text-zinc-500 text-xs">复权净值</th>
              <th className="px-3 py-2.5 text-right font-medium text-zinc-500 text-xs">涨跌幅</th>
            </tr>
          </thead>
          <tbody>
            {reversed.map((r) => {
              const chg = parseFloat(r.price_change)
              const chgPct = isNaN(chg) ? null : (chg * 100).toFixed(2)
              const chgStyle = isNaN(chg) ? {} : chg > 0 ? { color: RED } : chg < 0 ? { color: GREEN } : {}
              return (
                <tr key={r.price_date} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/60">
                  <td className="px-3 py-2 text-zinc-700 text-xs">{r.price_date}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-900 font-medium text-xs">{fmt(r.nav, 4)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700 text-xs">{fmt(r.cum_nav_withdrawal, 4)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700 text-xs">{fmt(r.cumulative_nav, 4)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-xs" style={chgStyle}>
                    {chgPct !== null ? (parseFloat(chgPct) > 0 ? "+" : "") + chgPct + "%" : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-zinc-400 mt-2 text-right">共 {rows.length} 条</div>
    </div>
  )
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
  mode,
}: {
  active?: boolean
  payload?: Array<{ value?: number; name?: string; color?: string }>
  label?: string
  mode?: "nav" | "return"
}) {
  if (!active || !payload?.length) return null
  const visibleItems = payload.filter((item) => typeof item.value === "number")
  if (!visibleItems.length) return null

  function formatValue(value: number): string {
    return mode === "return"
      ? (value >= 0 ? "+" : "") + value.toFixed(2) + "%"
      : value.toFixed(4)
  }

  return (
    <div className="bg-white border border-zinc-100 shadow-md rounded-lg px-3 py-2 text-xs">
      <div className="text-zinc-500 mb-1">{label}</div>
      <div className="space-y-1">
        {visibleItems.map((item) => (
          <div key={item.name} className="font-semibold text-zinc-900" style={item.color ? { color: item.color } : undefined}>
            {item.name}: {formatValue(item.value as number)}
          </div>
        ))}
      </div>
    </div>
  )
}

function DrawdownTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value?: number; name?: string; color?: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const visibleItems = payload.filter((item) => typeof item.value === "number")
  if (!visibleItems.length) return null
  return (
    <div className="bg-white border border-zinc-100 shadow-md rounded-lg px-3 py-2 text-xs">
      <div className="text-zinc-500 mb-1">{label}</div>
      <div className="space-y-1">
        {visibleItems.map((item) => (
          <div key={item.name} className="font-semibold tabular-nums" style={item.color ? { color: item.color } : undefined}>
            {item.name}: {(item.value as number).toFixed(2)}%
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PrivateFundDetailPage() {
  const params = useParams()
  const router = useRouter()
  const beian_hao = typeof params.beian_hao === "string" ? params.beian_hao : ""

  const [data, setData]       = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const [peerMonthly, setPeerMonthly] = useState<PeerMonthlyRow[]>([])
  const [peerYearly, setPeerYearly] = useState<PeerYearlyRow[]>([])
  const [fundTags, setFundTags]   = useState<string[]>([])
  const [fundPools, setFundPools] = useState<{ pool_key: string; pool_label: string }[]>([])
  const [availTeamTags, setAvailTeamTags] = useState<string[]>([])
  const [showTagEditor, setShowTagEditor] = useState(false)

  // ─── 编辑要素 modal ─────────────────────────────────────────────────────────
  type StrategyL2 = { l2: string; l3s: string[] }
  type StrategyTree = { l1: string; l2s: StrategyL2[] }[]
  const [showStrategyModal, setShowStrategyModal] = useState(false)
  const [strategyTab, setStrategyTab] = useState<"team" | "platform" | "subscription" | "attachment">("team")
  const [strategyTree, setStrategyTree] = useState<StrategyTree>([])
  const [editL1, setEditL1] = useState<string>("")
  const [editL2, setEditL2] = useState<string>("")
  const [editL3s, setEditL3s] = useState<string[]>([])
  const [savingStrategy, setSavingStrategy] = useState(false)

  function openStrategyModal() {
    if (!data) return
    setEditL1(data.info.strategy_l1 ?? "")
    setEditL2(data.info.strategy_l2 ?? "")
    const l3raw = data.info.strategy_l3 ?? ""
    setEditL3s(l3raw ? l3raw.split(/[，,]/).map(s => s.trim()).filter(Boolean) : [])
    setStrategyTab("team")
    setShowStrategyModal(true)
    if (!strategyTree.length) {
      fetch("/ma/api/tracking-funds/strategies?pool=tracking")
        .then(r => r.json())
        .then(d => Array.isArray(d) && setStrategyTree(d))
        .catch(() => {})
    }
  }

  async function saveStrategy() {
    setSavingStrategy(true)
    try {
      const res = await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/strategy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_l1: editL1 || null,
          strategy_l2: editL2 || null,
          strategy_l3: editL3s.length ? editL3s.join(",") : null,
        }),
      })
      if (res.ok && data) {
        setData({
          ...data,
          info: {
            ...data.info,
            strategy_l1: editL1 || null,
            strategy_l2: editL2 || null,
            strategy_l3: editL3s.length ? editL3s.join(",") : null,
          },
        })
        setShowStrategyModal(false)
      }
    } finally {
      setSavingStrategy(false)
    }
  }

  // ─── 编辑产品池 modal ──────────────────────────────────────────────────────
  const ALL_POOLS = [
    { key: "bfl",      label: "bfl跟踪池" },
    { key: "tracking", label: "跟踪池" },
    { key: "selected", label: "精选池" },
    { key: "core",     label: "核心池" },
    { key: "hy",       label: "hy跟踪池" },
    { key: "fof",      label: "FOF&MOM跟踪" },
  ]
  const [showPoolModal, setShowPoolModal] = useState(false)
  const [editPools, setEditPools] = useState<{ pool_key: string; pool_label: string }[]>([])
  const [savingPools, setSavingPools] = useState(false)

  function openPoolModal() {
    setEditPools([...fundPools])
    setShowPoolModal(true)
  }

  function toggleEditPool(key: string, label: string) {
    setEditPools(prev => {
      if (prev.some(p => p.pool_key === key)) return prev.filter(p => p.pool_key !== key)
      return [...prev, { pool_key: key, pool_label: label }]
    })
  }

  async function savePoolChanges() {
    if (!data) return
    setSavingPools(true)
    const productName = data.info.product_name ?? ""
    const toAdd = editPools.filter(p => !fundPools.some(q => q.pool_key === p.pool_key))
    const toRemove = fundPools.filter(p => !editPools.some(q => q.pool_key === p.pool_key))
    try {
      await Promise.all([
        ...toAdd.map(p =>
          fetch("/ma/api/tracking-funds/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pool: p.pool_key, beian_hao, product_name: productName }),
          })
        ),
        ...toRemove.map(p =>
          fetch(`/ma/api/tracking-funds/add?pool=${encodeURIComponent(p.pool_key)}&beian_hao=${encodeURIComponent(beian_hao)}`, {
            method: "DELETE",
          })
        ),
      ])
      setFundPools(editPools)
      setShowPoolModal(false)
    } finally {
      setSavingPools(false)
    }
  }

  function currentUserName(): string {
    try {
      const u = JSON.parse(localStorage.getItem("currentUser") || "null")
      return u?.name || u?.email || ""
    } catch { return "" }
  }

  async function loadFundMeta(id: string) {
    try {
      const res = await fetch(`/ma/api/ops/fund-tags?beian_hao=${encodeURIComponent(id)}`)
      const d = await res.json()
      setFundTags(Array.isArray(d.tags) ? d.tags : [])
      setFundPools(Array.isArray(d.pools) ? d.pools : [])
    } catch {}
  }

  async function addTag(tag: string) {
    if (!beian_hao || fundTags.includes(tag)) return
    await fetch("/ma/api/ops/fund-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beian_hao, tag_name: tag, user_name: currentUserName() }),
    })
    setFundTags((p) => [...p, tag])
  }

  async function removeTag(tag: string) {
    await fetch(`/ma/api/ops/fund-tags?beian_hao=${encodeURIComponent(beian_hao)}&tag_name=${encodeURIComponent(tag)}`, { method: "DELETE" })
    setFundTags((p) => p.filter((t) => t !== tag))
  }

  useEffect(() => {
    if (!beian_hao) return
    setLoading(true)
    setError(null)
    setPeerMonthly([])
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<DetailData>
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    loadFundMeta(beian_hao)
    fetch("/ma/api/ops/team-tags?category=fund")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setAvailTeamTags(d.map((t: { name: string }) => t.name)) : null)
      .catch(() => {})
  }, [beian_hao])

  // Fetch peer monthly stats once the main fund data (and its resolved strategy) is available
  useEffect(() => {
    if (!beian_hao || !data) return
    const strategy = data.info.strategy_l1 ?? data.info.strategy_l2
    if (!strategy) return
    const qs = `strategy=${encodeURIComponent(strategy)}`
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/peer-monthly?${qs}`)
      .then((r) => r.ok ? r.json() : { monthly: [] })
      .then((d) => { if (Array.isArray(d.monthly)) setPeerMonthly(d.monthly) })
      .catch(() => {})
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/peer-yearly?${qs}`)
      .then((r) => r.ok ? r.json() : { yearly: [] })
      .then((d) => { if (Array.isArray(d.yearly)) setPeerYearly(d.yearly) })
      .catch(() => {})
  }, [beian_hao, data?.info.strategy_l1, data?.info.strategy_l2])

  const [chartMode, setChartMode] = useState<"nav" | "return">("nav")

  // ─── Filter state ────────────────────────────────────────────────────────
  const inceptionDate = data?.info.inception_date?.slice(0, 10) ?? ""
  const todayStr = new Date().toISOString().slice(0, 10)

  const [filterPeriod,   setFilterPeriod]   = useState<string>("成立以来")
  const [filterFrom,     setFilterFrom]     = useState<string>("")
  const [filterTo,       setFilterTo]       = useState<string>("")
  const [filterNavType,  setFilterNavType]  = useState<string>("复权净值")
  const [filterFreq,     setFilterFreq]     = useState<string>("全部")
  const [filterBench,    setFilterBench]    = useState<string>("")
  // Applied values (only updated on 开始分析)
  const [appliedFrom,    setAppliedFrom]    = useState<string>("")
  const [appliedTo,      setAppliedTo]      = useState<string>("")
  const [appliedBench,   setAppliedBench]   = useState<string>("")
  const [benchmarkData,  setBenchmarkData]  = useState<BenchmarkPoint[]>([])
  const [showDateRange,    setShowDateRange]    = useState(true)
  const [excessByDivision, setExcessByDivision] = useState(false)

  // When data loads, seed benchmark and dates
  useEffect(() => {
    if (!data) return
    const inc = data.info.inception_date?.slice(0, 10) ?? ""
    const last = data.nav_series.length ? data.nav_series[data.nav_series.length - 1].price_date : todayStr
    const benchmarkKey = normalizeBenchmarkKey(data.info.benchmark)
    setFilterFrom(inc)
    setFilterTo(last)
    setFilterBench(benchmarkKey)
    setAppliedBench(benchmarkKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useEffect(() => {
    if (!data || !appliedBench) {
      setBenchmarkData([])
      return
    }

    const first = data.nav_series[0]?.price_date
    const last = data.nav_series[data.nav_series.length - 1]?.price_date
    if (!first || !last) {
      setBenchmarkData([])
      return
    }

    let cancelled = false
    const params = new URLSearchParams({ key: appliedBench, from: first, to: last })
    fetch(`/ma/api/private-funds/benchmark?${params.toString()}`)
      .then(async (response) => {
        const json = await response.json()
        if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`)
        if (!cancelled) setBenchmarkData(Array.isArray(json.data) ? json.data : [])
      })
      .catch(() => {
        if (!cancelled) setBenchmarkData([])
      })

    return () => {
      cancelled = true
    }
  }, [data, appliedBench])

  const PERIOD_OPTIONS = ["成立以来", "近1年", "近3年", "近5年", "今年以来", "自定义"]
  function applyPeriod(p: string) {
    setFilterPeriod(p)
    if (!data) return
    const last = data.nav_series.length ? data.nav_series[data.nav_series.length - 1].price_date : todayStr
    const inc  = data.info.inception_date?.slice(0, 10) ?? last
    let from = inc
    if (p === "近1年")  from = sub(last, 1, "year")
    else if (p === "近3年")  from = sub(last, 3, "year")
    else if (p === "近5年")  from = sub(last, 5, "year")
    else if (p === "今年以来") from = last.slice(0, 4) + "-01-01"
    setFilterFrom(from)
    setFilterTo(last)
  }
  function sub(dateStr: string, n: number, unit: "year"): string {
    const d = new Date(dateStr)
    d.setFullYear(d.getFullYear() - n)
    return d.toISOString().slice(0, 10)
  }
  function handleApply() {
    setAppliedFrom(filterFrom)
    setAppliedTo(filterTo)
    setAppliedBench(filterBench)
  }
  function handleReset() {
    const inc  = inceptionDate
    const last = data?.nav_series.length ? data.nav_series[data.nav_series.length - 1].price_date : todayStr
    const benchmarkKey = normalizeBenchmarkKey(data?.info.benchmark)
    setFilterPeriod("成立以来")
    setFilterFrom(inc)
    setFilterTo(last)
    setFilterNavType("复权净值")
    setFilterFreq("全部")
    setFilterBench(benchmarkKey)
    setAppliedFrom("")
    setAppliedTo("")
    setAppliedBench(benchmarkKey)
  }

  // Active date range for chart/table
  const activeFrom = appliedFrom || filterFrom
  const activeTo   = appliedTo   || filterTo

  const filteredNavRows = useMemo(() => {
    if (!data) return []
    return data.nav_series.filter((row) => (!activeFrom || row.price_date >= activeFrom) && (!activeTo || row.price_date <= activeTo))
  }, [data, activeFrom, activeTo])

  const activeChartData = useMemo(() => {
    if (!filteredNavRows.length) return []
    const rows = downsample(filteredNavRows)
    const benchmarkValues = appliedBench
      ? buildAlignedBenchmarkValues(rows, benchmarkData, chartMode, filterNavType)
      : rows.map(() => null)
    const firstNav = getNavFieldValue(rows[0], filterNavType)

    return rows.map((row, index) => {
      const navValue = getNavFieldValue(row, filterNavType)
      return {
        date: row.price_date,
        value: chartMode === "return"
          ? (firstNav > 0 ? +(((navValue / firstNav) - 1) * 100).toFixed(4) : 0)
          : navValue,
        benchmarkValue: benchmarkValues[index],
      }
    })
  }, [appliedBench, benchmarkData, chartMode, filterNavType, filteredNavRows])

  const drawdownChartData = useMemo(() => {
    if (!filteredNavRows.length) return []
    const rows = downsample(filteredNavRows)
    const fundValues = rows.map((r) => getNavFieldValue(r, filterNavType))
    const fundDD = computeDrawdownSeries(fundValues)

    const benchValues = appliedBench && benchmarkData.length
      ? buildAlignedBenchmarkValues(rows, benchmarkData, "nav", filterNavType)
      : rows.map(() => null)

    let benchPeak = NaN
    const benchDD = benchValues.map((v) => {
      if (v === null || !isFinite(v)) return null
      if (!isFinite(benchPeak) || v > benchPeak) benchPeak = v
      return benchPeak > 0 ? +(((v - benchPeak) / benchPeak) * 100).toFixed(4) : 0
    })

    return rows.map((row, i) => ({
      date: row.price_date,
      fundDD: fundDD[i],
      benchDD: benchDD[i],
    }))
  }, [filteredNavRows, filterNavType, appliedBench, benchmarkData])

  const drawdownYDomain = useMemo((): [number, number] => {
    if (!drawdownChartData.length) return [-10, 0]
    const vals = drawdownChartData.flatMap((d) => {
      const out = [d.fundDD]
      if (d.benchDD !== null) out.push(d.benchDD)
      return out
    })
    const min = Math.min(...vals)
    const pad = Math.abs(min) * 0.08
    return [+(min - pad).toFixed(2), 0]
  }, [drawdownChartData])

  const maxFundDrawdown = useMemo(() => {
    if (!drawdownChartData.length) return null
    return Math.min(...drawdownChartData.map((d) => d.fundDD))
  }, [drawdownChartData])

  const drawdownEpisodes = useMemo(() => {
    if (filteredNavRows.length < 2) return []
    const episodes = computeDrawdownEpisodes(filteredNavRows, filterNavType)
    const benchValues = appliedBench && benchmarkData.length
      ? buildAlignedBenchmarkValues(filteredNavRows, benchmarkData, "nav", filterNavType)
      : filteredNavRows.map(() => null)
    const dateTs = filteredNavRows.map((r) => new Date(r.price_date).getTime())

    return episodes.map((ep) => {
      const recoveryDays = ep.recoveryIdx !== null
        ? Math.round((dateTs[ep.recoveryIdx] - dateTs[ep.troughIdx]) / 86400000)
        : null

      const benchPeak = benchValues[ep.peakIdx]
      const benchTrough = benchValues[ep.troughIdx]
      const benchReturn = benchPeak !== null && benchTrough !== null && benchPeak > 0
        ? benchTrough / benchPeak - 1
        : null

      return { ...ep, recoveryDays, benchReturn }
    })
  }, [filteredNavRows, filterNavType, appliedBench, benchmarkData])

  const benchmarkLabel = getBenchmarkLabel(appliedBench)

  const intervalCutoffDate = data?.metrics.latest_nav_date
    ?? filteredNavRows[filteredNavRows.length - 1]?.price_date
    ?? ""

  const fundIntervalMetrics = useMemo((): IntervalMetricValues => {
    const fundInfo = data?.info
    if (!fundInfo) {
      return { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null, sharpe_1y: null, calmar_1y: null }
    }
    return {
      ret_1w:    fundInfo.ret_1w    ? parseFloat(fundInfo.ret_1w)    : null,
      ret_1m:    fundInfo.ret_1m    ? parseFloat(fundInfo.ret_1m)    : null,
      ret_3m:    fundInfo.ret_3m    ? parseFloat(fundInfo.ret_3m)    : null,
      ret_6m:    fundInfo.ret_6m    ? parseFloat(fundInfo.ret_6m)    : null,
      ret_1y:    fundInfo.ret_1y    ? parseFloat(fundInfo.ret_1y)    : null,
      sharpe_1y: fundInfo.sharpe_1y ? parseFloat(fundInfo.sharpe_1y) : null,
      calmar_1y: fundInfo.calmar_1y ? parseFloat(fundInfo.calmar_1y) : null,
    }
  }, [data?.info])

  const benchmarkIntervalMetrics = useMemo(() => {
    if (!appliedBench || !benchmarkData.length || !intervalCutoffDate) return null
    return buildBenchmarkIntervalMetrics(benchmarkData, intervalCutoffDate)
  }, [appliedBench, benchmarkData, intervalCutoffDate])

  const annualFundRows = useMemo((): AnnualFundRow[] => {
    if (filteredNavRows.length < 2) return []
    const groups = new Map<number, NavRow[]>()
    for (const row of filteredNavRows) {
      const year = parseInt(row.price_date.slice(0, 4), 10)
      if (!groups.has(year)) groups.set(year, [])
      groups.get(year)!.push(row)
    }
    const out: AnnualFundRow[] = []
    for (const [year, rows] of groups) {
      const dates = rows.map((r) => r.price_date)
      const values = rows.map((r) => getNavFieldValue(r, filterNavType))
      const metrics = computeFundNavMetrics({ dates, values })
      if (metrics) {
        out.push({
          year,
          interval: `${dates[0]} ~ ${dates[dates.length - 1]}`,
          metrics,
        })
      }
    }
    return out.sort((a, b) => b.year - a.year)
  }, [filteredNavRows, filterNavType])

  const peerByYear = useMemo(() => {
    const m = new Map<number, PeerYearlyRow>()
    for (const row of peerYearly) m.set(row.year, row)
    return m
  }, [peerYearly])

  // ─── Period statistics ────────────────────────────────────────────────────
  const periodStats = useMemo(() => {
    if (filteredNavRows.length < 3) return null

    const _mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
    const _std  = (arr: number[], ddof = 1): number => {
      if (arr.length <= ddof) return NaN
      const m = _mean(arr)
      return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - ddof))
    }
    const _skew = (arr: number[]): number => {
      if (arr.length < 3) return NaN
      const m = _mean(arr); const s = _std(arr)
      if (!isFinite(s) || s === 0) return NaN
      return arr.reduce((sum, v) => sum + ((v - m) / s) ** 3, 0) / arr.length
    }
    const _kurt = (arr: number[]): number => {
      if (arr.length < 4) return NaN
      const m = _mean(arr); const s = _std(arr)
      if (!isFinite(s) || s === 0) return NaN
      return arr.reduce((sum, v) => sum + ((v - m) / s) ** 4, 0) / arr.length - 3
    }
    const _var95 = (arr: number[]): number => {
      if (arr.length < 5) return NaN
      return [...arr].sort((a, b) => a - b)[Math.floor(arr.length * 0.05)]
    }

    const navVals   = filteredNavRows.map(r => getNavFieldValue(r, filterNavType))
    const dateTsArr = filteredNavRows.map(r => new Date(r.price_date).getTime())
    const totalDays = (dateTsArr[dateTsArr.length - 1] - dateTsArr[0]) / 86400000
    const years     = Math.max(totalDays / 365.25, 1 / 365)

    // Median gap → annualization factor
    const gaps = []
    for (let i = 1; i < dateTsArr.length; i++) gaps.push((dateTsArr[i] - dateTsArr[i - 1]) / 86400000)
    gaps.sort((a, b) => a - b)
    const medGap = gaps[Math.floor(gaps.length / 2)] || 1
    const ppy = medGap <= 2 ? 252 : medGap <= 10 ? 52 : medGap <= 20 ? 26 : medGap <= 45 ? 12 : 4

    // Fund returns
    const fundRets: number[] = []
    for (let i = 1; i < navVals.length; i++) {
      fundRets.push(navVals[i - 1] > 0 ? navVals[i] / navVals[i - 1] - 1 : 0)
    }

    const fundPeriodRet = navVals[navVals.length - 1] / navVals[0] - 1
    const fundAnnRet    = Math.pow(1 + fundPeriodRet, 1 / years) - 1
    const fundAnnVol    = fundRets.length > 1 ? _std(fundRets) * Math.sqrt(ppy) : NaN
    const RF = 0.02
    const fundSharpe = isFinite(fundAnnVol) && fundAnnVol > 0 ? (fundAnnRet - RF) / fundAnnVol : NaN

    // Drawdown + recovery + no-new-high streak
    let peak = navVals[0], peakTs = dateTsArr[0]
    let maxDD = 0, troughTs = dateTsArr[0], maxDDPeakVal = navVals[0]
    let longestNoNewHigh = 0, curHighTs = dateTsArr[0]
    for (let i = 0; i < navVals.length; i++) {
      if (navVals[i] > peak) { peak = navVals[i]; peakTs = dateTsArr[i]; curHighTs = dateTsArr[i] }
      else { const d = (dateTsArr[i] - curHighTs) / 86400000; if (d > longestNoNewHigh) longestNoNewHigh = d }
      const dd = (peak - navVals[i]) / peak
      if (dd > maxDD) { maxDD = dd; troughTs = dateTsArr[i]; maxDDPeakVal = peak }
    }
    let ddRecoveryDays: number | null = null
    for (let i = 0; i < navVals.length; i++) {
      if (dateTsArr[i] > troughTs && navVals[i] >= maxDDPeakVal) {
        ddRecoveryDays = Math.round((dateTsArr[i] - troughTs) / 86400000); break
      }
    }

    const fundCalmar = maxDD > 0 ? fundAnnRet / maxDD : NaN
    const downRets   = fundRets.filter(r => r < 0)
    const fundDsr    = downRets.length > 0 ? Math.sqrt(downRets.reduce((s, r) => s + r * r, 0) / downRets.length) * Math.sqrt(ppy) : 0
    const fundSortino = fundDsr > 0 ? (fundAnnRet - RF) / fundDsr : NaN

    const fund = {
      periodRet: fundPeriodRet, annRet: fundAnnRet, annVol: fundAnnVol,
      sharpe: fundSharpe, calmar: fundCalmar, downsideRisk: fundDsr,
      maxDD, ddRecoveryDays, longestNoNewHighDays: Math.round(longestNoNewHigh),
      sortino: fundSortino,
      correlation: NaN, infoRatio: NaN, trackingError: NaN, alpha: NaN, beta: NaN,
      skewness: _skew(fundRets), kurtosis: _kurt(fundRets), var95: _var95(fundRets),
    }

    // ── Benchmark ──────────────────────────────────────────────────────────
    type BenchStats = typeof fund & { ddRecoveryDays: number | null }
    let bench: BenchStats | null = null

    if (appliedBench && benchmarkData.length) {
      const benchAligned = buildAlignedBenchmarkValues(filteredNavRows, benchmarkData, "nav", filterNavType)
      const baseIdx = benchAligned.findIndex(v => v !== null)

      if (baseIdx >= 0 && baseIdx < navVals.length - 1) {
        const fRetsAl: number[] = [], bRetsAl: number[] = []
        for (let i = Math.max(1, baseIdx); i < benchAligned.length; i++) {
          const bp = benchAligned[i - 1], bc = benchAligned[i]
          if (bp !== null && bc !== null && bp > 0) {
            fRetsAl.push(navVals[i] / navVals[i - 1] - 1)
            bRetsAl.push(bc / bp - 1)
          }
        }

        const bLevels: Array<{ v: number; ts: number }> = []
        for (let i = 0; i < benchAligned.length; i++) {
          if (benchAligned[i] !== null) bLevels.push({ v: benchAligned[i]!, ts: dateTsArr[i] })
        }

        if (bLevels.length >= 2 && bRetsAl.length >= 2) {
          const bPeriodRet = bLevels[bLevels.length - 1].v / bLevels[0].v - 1
          const bAnnRet    = Math.pow(1 + bPeriodRet, 1 / years) - 1
          const bAnnVol    = _std(bRetsAl) * Math.sqrt(ppy)
          const bSharpe    = isFinite(bAnnVol) && bAnnVol > 0 ? (bAnnRet - RF) / bAnnVol : NaN

          let bPeak = bLevels[0].v, bMaxDD = 0, bTroughTs = bLevels[0].ts
          let bMaxDDPeakVal = bLevels[0].v, bLongestNoNewHigh = 0, bCurHighTs = bLevels[0].ts
          for (const { v, ts } of bLevels) {
            if (v > bPeak) { bPeak = v; bCurHighTs = ts }
            else { const d = (ts - bCurHighTs) / 86400000; if (d > bLongestNoNewHigh) bLongestNoNewHigh = d }
            const dd = (bPeak - v) / bPeak
            if (dd > bMaxDD) { bMaxDD = dd; bTroughTs = ts; bMaxDDPeakVal = bPeak }
          }
          let bDDRecoveryDays: number | null = null
          for (const { v, ts } of bLevels) {
            if (ts > bTroughTs && v >= bMaxDDPeakVal) { bDDRecoveryDays = Math.round((ts - bTroughTs) / 86400000); break }
          }

          const bCalmar      = bMaxDD > 0 ? bAnnRet / bMaxDD : NaN
          const bDownRets    = bRetsAl.filter(r => r < 0)
          const bDsr         = bDownRets.length > 0 ? Math.sqrt(bDownRets.reduce((s, r) => s + r * r, 0) / bDownRets.length) * Math.sqrt(ppy) : 0
          const bSortino     = bDsr > 0 ? (bAnnRet - RF) / bDsr : NaN

          const mf = _mean(fRetsAl), mb = _mean(bRetsAl)
          const cov  = fRetsAl.reduce((s, v, i) => s + (v - mf) * (bRetsAl[i] - mb), 0) / fRetsAl.length
          const sf   = _std(fRetsAl), sb = _std(bRetsAl)
          const corr = isFinite(sf) && sf > 0 && isFinite(sb) && sb > 0 ? cov / (sf * sb) : NaN
          const varB = bRetsAl.reduce((s, v) => s + (v - mb) ** 2, 0) / bRetsAl.length
          const beta = varB > 0 ? cov / varB : NaN
          const alpha = isFinite(beta) ? fundAnnRet - (RF + beta * (bAnnRet - RF)) : NaN

          const excessRets = excessByDivision
            ? fRetsAl.map((r, i) => (1 + r) / (1 + bRetsAl[i]) - 1)
            : fRetsAl.map((r, i) => r - bRetsAl[i])
          const trackingError = excessRets.length > 1 ? _std(excessRets) * Math.sqrt(ppy) : NaN
          const excessAnnRet  = excessByDivision
            ? Math.pow((1 + fundPeriodRet) / (1 + bPeriodRet), 1 / years) - 1
            : fundAnnRet - bAnnRet
          const infoRatio = isFinite(trackingError) && trackingError > 0 ? excessAnnRet / trackingError : NaN

          bench = {
            periodRet: bPeriodRet, annRet: bAnnRet, annVol: bAnnVol,
            sharpe: bSharpe, calmar: bCalmar, downsideRisk: bDsr,
            maxDD: bMaxDD, ddRecoveryDays: bDDRecoveryDays, longestNoNewHighDays: Math.round(bLongestNoNewHigh),
            sortino: bSortino,
            correlation: 1, infoRatio: NaN, trackingError: 0, alpha: 0, beta: 1,
            skewness: _skew(bRetsAl), kurtosis: _kurt(bRetsAl), var95: _var95(bRetsAl),
          }
          // overwrite fund-relative fields on fund itself
          fund.correlation    = corr
          fund.infoRatio      = infoRatio
          fund.trackingError  = trackingError
          fund.alpha          = alpha
          fund.beta           = beta
        }
      }
    }

    return {
      dateRange: `${filteredNavRows[0].price_date} ～ ${filteredNavRows[filteredNavRows.length - 1].price_date}`,
      fund,
      bench,
    }
  }, [filteredNavRows, benchmarkData, filterNavType, appliedBench, excessByDivision])

  const yDomain = useMemo(() => {
    if (!activeChartData.length) return ["auto", "auto"] as [string, string]
    const vals = activeChartData.map((d) => d.value)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.05
    return [+(min - pad).toFixed(4), +(max + pad).toFixed(4)] as [number, number]
  }, [activeChartData])

  function navigateToFundsPage(tab: string, side?: string) {
    const sideItem = side ?? TAB_DEFAULT_SIDE[tab] ?? "private-funds"
    router.push(`/ma/dashboard/private-funds?tab=${tab}&side=${sideItem}`)
  }

  function PageShell({ children }: { children: React.ReactNode }) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Top menu bar */}
        <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex-shrink-0">
          <nav className="flex items-center gap-1 px-6 h-12">
            {menuItems.map((item) => (
              <button
                key={item.key}
                onClick={() => item.key !== "funds" && navigateToFundsPage(item.key)}
                className={[
                  "relative px-4 h-full text-sm font-medium transition-colors focus:outline-none",
                  item.key === "funds"
                    ? "text-red-600 dark:text-red-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-red-500 after:rounded-full"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          <aside className="w-44 border-r bg-background flex-shrink-0">
            <div className="flex items-center gap-2 px-4 py-4 border-b">
              <div className="h-7 w-7 rounded-md bg-red-500 flex items-center justify-center flex-shrink-0">
                <Database className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-foreground">基金数据库</span>
            </div>
            <nav className="flex flex-col pt-2 pb-4 overflow-y-auto">
              {fundsSidebarGroups.map((group) => {
                const hasActive = group.items.some((i) => i.key === ACTIVE_SIDE_ITEM)
                return (
                  <div key={group.label}>
                    <div className={[
                      "px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide select-none",
                      hasActive ? "text-red-500" : "text-zinc-400 dark:text-zinc-500",
                    ].join(" ")}>{group.label}</div>
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => {
                          if (item.key === "private-funds") {
                            router.push("/ma/dashboard/private-funds?tab=funds&side=private-funds")
                          } else {
                            navigateToFundsPage("funds", item.key)
                          }
                        }}
                        className={[
                          "w-full text-left pl-5 pr-3 py-1.5 text-sm transition-colors focus:outline-none relative",
                          item.key === ACTIVE_SIDE_ITEM
                            ? "text-red-600 dark:text-red-400 font-medium bg-red-50/60 dark:bg-red-950/20 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-red-500"
                            : "text-zinc-600 dark:text-zinc-400 hover:text-foreground hover:bg-muted/40",
                        ].join(" ")}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )
              })}
            </nav>
          </aside>
          <div className="flex-1 min-w-0 min-h-0 overflow-x-hidden overflow-y-auto p-5 [overflow-anchor:none]">{children}</div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-40 text-zinc-400 text-sm">加载中…</div>
      </PageShell>
    )
  }

  if (error || !data) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-40 text-red-500 text-sm">
          加载失败：{error ?? "未知错误"}
        </div>
      </PageShell>
    )
  }

  const { info, metrics, nav_series } = data
  const pct1w = fmtPct(info.ret_1w)
  const pct1m = fmtPct(info.ret_1m)
  const pct3m = fmtPct(info.ret_3m)
  const pct6m = fmtPct(info.ret_6m)
  const pct1y = fmtPct(info.ret_1y)

  function RetPill({ label, pct }: { label: string; pct: { text: string; sign: 1 | -1 | 0 } }) {
    const color = pct.sign === 1 ? RED : pct.sign === -1 ? GREEN : "#a1a1aa"
    return (
      <div className="flex flex-col items-center gap-0.5 px-3 py-2 rounded bg-zinc-50 border border-zinc-100">
        <span className="text-[10px] text-zinc-400 font-medium">{label}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color }}>{pct.text}</span>
      </div>
    )
  }

  // X-axis tick formatter: only show year changes
  let lastYear = ""
  function xTick(val: string): string {
    const yr = val.slice(0, 4)
    if (yr !== lastYear) { lastYear = yr; return yr }
    return ""
  }

  return (
    <>
    <PageShell>
    <div>
      {/* Back link */}
      <a
        href="/ma/dashboard/private-funds"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        返回基金列表
      </a>

      {/* ── Header: fund name + strategy tags ────────────── */}
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-zinc-900 leading-tight">{info.product_name}</h1>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-xs">
          {/* ── 策略标签（一级 / 二级 / 三级） ── */}
          {(info.strategy_l1 || info.strategy_l2 || info.strategy_l3) && (
            <>
              {(info.strategy_l1 || info.strategy_l2) && (
                <span
                  className="px-1.5 py-0.5 rounded font-medium whitespace-nowrap text-xs"
                  style={{ backgroundColor: "#eff6ff", color: "#2563eb", border: "1px solid #93c5fd" }}
                >
                  {[info.strategy_l1, info.strategy_l2].filter(Boolean).join(" /")}
                </span>
              )}
              {info.strategy_l3 && info.strategy_l3 !== "-" && (
                <span
                  className="px-1.5 py-0.5 rounded whitespace-nowrap text-xs"
                  style={{ backgroundColor: "#eff6ff", color: "#2563eb", border: "1px solid #93c5fd" }}
                >
                  {info.strategy_l3}
                </span>
              )}
              <button className="text-zinc-400 hover:text-zinc-700 transition-colors" title="编辑策略标签" onClick={openStrategyModal}>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <span className="text-zinc-300 select-none mx-0.5">|</span>
            </>
          )}

          {/* ── 团队标签 ── */}
          {fundTags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded whitespace-nowrap text-xs"
              style={{ backgroundColor: "#eff6ff", color: "#2563eb", border: "1px solid #93c5fd" }}
            >
              {tag}
            </span>
          ))}

          {/* ── 池 ── */}
          {fundPools.length > 0 && (
            <>
              {(info.strategy_l1 || info.strategy_l2 || info.strategy_l3 || fundTags.length > 0) && (
                <span className="text-zinc-300 select-none mx-0.5">|</span>
              )}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500 flex-shrink-0"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              <button onClick={openPoolModal} className="text-zinc-600 font-medium whitespace-nowrap text-xs hover:text-zinc-900 transition-colors flex items-center gap-0.5">
                团队产品池
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <span className="text-zinc-300 select-none mx-0.5">|</span>
              {fundPools.map((p) => (
                <span
                  key={p.pool_key}
                  className="px-1.5 py-0.5 rounded whitespace-nowrap text-xs"
                  style={{ backgroundColor: "#fffbeb", color: "#d97706", border: "1px solid #fcd34d" }}
                >
                  {p.pool_label}
                </span>
              ))}
            </>
          )}

          {/* ── 编辑产品池 button ── */}
          <button
            onClick={openPoolModal}
            className="text-zinc-400 hover:text-zinc-700 transition-colors ml-0.5"
            title="编辑产品池"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
      </div>

      {/* ── Key info band ── */}
      <div className="flex items-start gap-8 py-4 mb-4 border-y border-zinc-100">

        {/* LEFT: all metric cells – flex-1 + justify-between to fill the row */}
        <div className="flex flex-wrap items-start gap-x-16 gap-y-3">

        {/* 单位净值 – hero number */}
        <div className="min-w-[120px]">
          <div className="text-[2rem] font-bold tabular-nums leading-none" style={{ color: RED }}>
            {fmt(metrics.latest_nav, 4)}
          </div>
          <div className="text-xs text-zinc-500 mt-1">单位净值（{metrics.latest_nav_date ?? ""}）</div>
        </div>

        {/* 累计净值 + 复权净值 */}
        <div className="flex flex-col gap-1 justify-center">
          <div className="text-xs text-zinc-500">
            累计净值：<span className="font-semibold text-zinc-800 tabular-nums">{fmt(metrics.latest_cum_nav, 4)}</span>
          </div>
          <div className="text-xs text-zinc-500">
            复权净值：<span className="font-semibold text-zinc-800 tabular-nums">{fmt(metrics.latest_cum_nav_reinvested, 4)}</span>
          </div>
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px self-stretch bg-zinc-100" />

        {/* 成立以来收益 */}
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[1.4rem] font-bold tabular-nums" style={{ color: RED }}>
            {metrics.ret_since_inception !== null ? "+" + metrics.ret_since_inception + "%" : "—"}
          </span>
          <span className="text-xs text-zinc-500">成立以来收益</span>
        </div>

        {/* 今年以来收益 */}
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[1.4rem] font-bold tabular-nums" style={{ color: RED }}>
            {metrics.ytd_ret !== null
              ? (parseFloat(metrics.ytd_ret) > 0 ? "+" : "") + metrics.ytd_ret + "%"
              : "—"}
          </span>
          <span className="text-xs text-zinc-500">今年以来收益</span>
        </div>

        {/* 成立以来年化 */}
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[1.4rem] font-bold tabular-nums" style={{ color: RED }}>
            {metrics.ann_ret !== null ? "+" + metrics.ann_ret + "%" : "—"}
          </span>
          <span className="text-xs text-zinc-500">成立以来年化</span>
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px self-stretch bg-zinc-100" />

        {/* 最大回撤 */}
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[1.4rem] font-bold tabular-nums" style={{ color: GREEN }}>
            {metrics.max_drawdown !== null ? "-" + metrics.max_drawdown + "%" : "—"}
          </span>
          <span className="text-xs text-zinc-500">成立以来最大回撤</span>
        </div>

        {/* 夏普比率 – computed since inception */}
        {metrics.sharpe_since_inception && (
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-[1.4rem] font-bold tabular-nums text-zinc-800">
              {metrics.sharpe_since_inception}
            </span>
            <span className="text-xs text-zinc-500">成立以来夏普比率</span>
          </div>
        )}

        </div>{/* end LEFT */}

        {/* RIGHT: 备案 / 管理人 info block */}
        <div className="shrink-0 grid grid-cols-2 gap-x-8 self-center">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            <span>备案编号：</span>
            <span className="font-medium text-zinc-800">{info.beian_hao}</span>
            <span>产品成立时间：</span>
            <span className="font-medium text-zinc-800">{info.inception_date?.slice(0, 10) ?? "—"}</span>
            <span>基金经理：</span>
            <span className="font-medium text-zinc-800">{info.manager_names || "—"}</span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            <span>私募管理人：</span>
            <span className="font-medium text-zinc-800">{info.manager || "—"}</span>
            <span>公司管理规模：</span>
            <span className="font-medium text-zinc-800">{info.scale || "—"}</span>
            {info.benchmark && (
              <>
                <span>业绩基准：</span>
                <span className="font-medium text-zinc-800">{info.benchmark}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 mb-4 rounded-lg border border-zinc-100 bg-zinc-50 text-xs">

        {/* 统计区间 */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 whitespace-nowrap">统计区间：</span>
          <select
            value={filterPeriod}
            onChange={e => applyPeriod(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
          >
            {PERIOD_OPTIONS.map(o => <option key={o}>{o}</option>)}
          </select>
        </div>

        {/* Date from */}
        <input
          type="date"
          value={filterFrom}
          onChange={e => { setFilterFrom(e.target.value); setFilterPeriod("自定义") }}
          className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
        />
        <span className="text-zinc-400">～</span>
        {/* Date to */}
        <input
          type="date"
          value={filterTo}
          onChange={e => { setFilterTo(e.target.value); setFilterPeriod("自定义") }}
          className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
        />

        {/* 净值类型 */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 whitespace-nowrap">净值类型：</span>
          <select
            value={filterNavType}
            onChange={e => setFilterNavType(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
          >
            {["复权净值", "单位净值", "累计净值"].map(o => <option key={o}>{o}</option>)}
          </select>
        </div>

        {/* 净值频率 */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 whitespace-nowrap">净值频率：</span>
          <select
            value={filterFreq}
            onChange={e => setFilterFreq(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
          >
            {["全部", "日频", "周频", "月频"].map(o => <option key={o}>{o}</option>)}
          </select>
        </div>

        {/* 业绩基准 */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 whitespace-nowrap">业绩基准：</span>
          <select
            value={filterBench}
            onChange={e => { setFilterBench(e.target.value); setAppliedBench(e.target.value) }}
            className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none min-w-[120px]"
          >
            {BENCHMARK_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </div>

        {/* Buttons */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded border border-red-500 text-red-500 hover:bg-red-50 font-medium transition-colors"
          >
            重置
          </button>
          <button
            onClick={handleApply}
            className="px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600 font-medium transition-colors"
          >
            开始分析
          </button>
        </div>
      </div>

      {/* ── Chart + Table side by side ─────────────────── */}
      <div className="flex flex-col xl:flex-row gap-4" style={{ height: 420 }}>
      {activeChartData.length > 1 && (
        <div className="xl:w-[60%] min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <div className="text-sm font-semibold text-zinc-700">
              {chartMode === "nav" ? `净值走势（${filterNavType}）` : `收益曲线（${filterNavType}）`}
            </div>
            <div className="flex rounded-lg border border-zinc-200 overflow-hidden text-xs">
              <button
                onClick={() => setChartMode("return")}
                className={`px-3 py-1.5 transition-colors ${
                  chartMode === "return"
                    ? "bg-zinc-900 text-white font-semibold"
                    : "bg-white text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                收益曲线
              </button>
              <button
                onClick={() => setChartMode("nav")}
                className={`px-3 py-1.5 transition-colors border-l border-zinc-200 ${
                  chartMode === "nav"
                    ? "bg-zinc-900 text-white font-semibold"
                    : "bg-white text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                净值曲线
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={activeChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#a1a1aa" }}
                tickFormatter={xTick}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontSize: 11, fill: "#a1a1aa" }}
                width={60}
                tickFormatter={(v: number) => chartMode === "return" ? v.toFixed(0) + "%" : v.toFixed(2)}
              />
              <Tooltip content={(props) => (
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                <ChartTooltip {...(props as any)} mode={chartMode} />
              )} />
              {appliedBench && (
                <Line
                  type="monotone"
                  dataKey="benchmarkValue"
                  name={benchmarkLabel}
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls={false}
                  activeDot={{ r: 3, fill: "#2563eb" }}
                />
              )}
              <Area
                type="monotone"
                dataKey="value"
                name={chartMode === "return" ? "基金收益率" : filterNavType}
                stroke="#ef4444"
                strokeWidth={1.5}
                fill="url(#navGrad)"
                dot={false}
                activeDot={{ r: 4, fill: "#ef4444" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── NAV Table ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <div className="text-sm font-semibold text-zinc-700">净值数据</div>
          <button
            onClick={() => exportNavCsv(
              filteredNavRows,
              `${info.product_name}_净值_${new Date().toISOString().slice(0, 10)}.csv`
            )}
            disabled={filteredNavRows.length === 0}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
        </div>
        <NavTable rows={filteredNavRows} />
      </div>
      </div>{/* end flex chart+table */}

      {/* ── Period Statistics Table ──────────────────────── */}
      {periodStats && (
        <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
          {/* Header row */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-zinc-500">
              {showDateRange && <span>统计区间：{periodStats.dateRange}</span>}
            </div>
            <div className="flex items-center gap-5 text-xs text-zinc-600">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={showDateRange} onChange={e => setShowDateRange(e.target.checked)} className="rounded border-zinc-300 accent-zinc-700" />
                显示区间
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={excessByDivision} onChange={e => setExcessByDivision(e.target.checked)} className="rounded border-zinc-300 accent-zinc-700" />
                超额（除法）
              </label>
            </div>
          </div>

          {/* Two-panel table */}
          {(() => {
            const { fund, bench } = periodStats
            const hasBench = appliedBench && bench !== null

            // Formatters
            const pct = (v: number | undefined) =>
              v !== undefined && isFinite(v) ? (v * 100).toFixed(2) + "%" : "—"
            const num = (v: number | undefined, dp = 4) =>
              v !== undefined && isFinite(v) ? v.toFixed(dp) : "—"
            const colorPct = (v: number | undefined) => {
              if (v === undefined || !isFinite(v)) return <span className="text-zinc-400 tabular-nums">—</span>
              const s = (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%"
              return <span className="tabular-nums font-semibold" style={{ color: v > 0 ? RED : v < 0 ? GREEN : undefined }}>{s}</span>
            }

            const TH = ({ children }: { children: React.ReactNode }) => (
              <th className="pb-2 pt-1 text-right text-xs font-medium text-zinc-600 border-b border-zinc-100">{children}</th>
            )
            const THLeft = ({ children }: { children: React.ReactNode }) => (
              <th className="pb-2 pt-1 text-left text-xs font-medium text-zinc-400 border-b border-zinc-100 w-[44%]">{children}</th>
            )
            const TD = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
              <td className={`py-1.5 text-xs text-zinc-700 tabular-nums${right ? " text-right" : ""}`}>{children}</td>
            )

            const leftRows: Array<{
              label: string
              fNode: React.ReactNode
              bNode: React.ReactNode
            }> = [
              { label: "区间收益",                 fNode: colorPct(fund.periodRet),     bNode: hasBench ? colorPct(bench!.periodRet)     : <span className="text-zinc-300">—</span> },
              { label: "年化收益",                 fNode: colorPct(fund.annRet),        bNode: hasBench ? colorPct(bench!.annRet)        : <span className="text-zinc-300">—</span> },
              { label: "年化波动率",               fNode: pct(fund.annVol),             bNode: hasBench ? pct(bench!.annVol)             : "—" },
              { label: "夏普比率（Rf=2.00%）",     fNode: num(fund.sharpe),             bNode: hasBench ? num(bench!.sharpe)             : "—" },
              { label: "卡马比率",                 fNode: num(fund.calmar),             bNode: hasBench ? num(bench!.calmar)             : "—" },
              { label: "下行风险",                 fNode: pct(fund.downsideRisk),       bNode: hasBench ? pct(bench!.downsideRisk)       : "—" },
              { label: "最大回撤",                 fNode: pct(fund.maxDD),              bNode: hasBench ? pct(bench!.maxDD)              : "—" },
              {
                label: "最大回撤补期（天）",
                fNode: fund.ddRecoveryDays === null ? "未回补" : fund.ddRecoveryDays,
                bNode: !hasBench ? "—" : bench!.ddRecoveryDays === null ? "未回补" : bench!.ddRecoveryDays,
              },
              {
                label: "最长连续不创新高天数（天）",
                fNode: fund.longestNoNewHighDays,
                bNode: hasBench ? bench!.longestNoNewHighDays : "—",
              },
            ]

            const rightRows: Array<{
              label: string
              fNode: React.ReactNode
              bNode: React.ReactNode
            }> = [
              { label: "索提诺比率",   fNode: num(fund.sortino),      bNode: hasBench ? num(bench!.sortino)    : "—" },
              { label: "相关系数",     fNode: num(fund.correlation),  bNode: hasBench ? num(1)                 : "—" },
              { label: "信息比率",     fNode: num(fund.infoRatio),    bNode: hasBench ? "—"                   : "—" },
              { label: "跟踪误差",     fNode: pct(fund.trackingError),bNode: hasBench ? "0.00%"               : "—" },
              { label: "Alpha",        fNode: colorPct(fund.alpha !== undefined && isFinite(fund.alpha) ? fund.alpha : NaN), bNode: hasBench ? "0.00%" : "—" },
              { label: "Beta",         fNode: num(fund.beta),         bNode: hasBench ? "1.0000"              : "—" },
              { label: "偏度",         fNode: num(fund.skewness),     bNode: hasBench ? num(bench!.skewness)  : "—" },
              { label: "峰度",         fNode: num(fund.kurtosis),     bNode: hasBench ? num(bench!.kurtosis)  : "—" },
              { label: "VaR（95%置信）",fNode: num(fund.var95),       bNode: hasBench ? num(bench!.var95)     : "—" },
            ]

            const Panel = ({ rows }: { rows: typeof leftRows }) => (
              <table className="w-full">
                <thead>
                  <tr>
                    <THLeft>指标名称</THLeft>
                    <TH>{info.product_name}</TH>
                    {hasBench && <TH>{benchmarkLabel}（基准）</TH>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.label} className={i % 2 === 1 ? "bg-zinc-50/60" : ""}>
                      <TD>{row.label}</TD>
                      <TD right>{row.fNode}</TD>
                      {hasBench && <TD right>{row.bNode}</TD>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )

            return (
              <div className="grid grid-cols-2 gap-6">
                <Panel rows={leftRows} />
                <Panel rows={rightRows} />
              </div>
            )
          })()}
        </div>
      )}

      {/* ── Dynamic Drawdown Chart ───────────────────────── */}
      {drawdownChartData.length > 1 && (
        <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
          <div className="flex items-start justify-between mb-1">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                动态回撤
              </div>
              {filteredNavRows.length > 0 && (
                <div className="text-xs text-zinc-400 mt-1">
                  统计时间：{filteredNavRows[0].price_date} ~ {filteredNavRows[filteredNavRows.length - 1].price_date}
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-zinc-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: RED }} />
                {info.product_name}
              </span>
              {appliedBench && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: "#2563eb" }} />
                  {benchmarkLabel}（基准）
                </span>
              )}
            </div>
          </div>
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={drawdownChartData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="fundDdGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.05} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.25} />
                  </linearGradient>
                  <linearGradient id="benchDdGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.05} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#a1a1aa" }}
                  tickFormatter={drawdownXTick}
                  interval="preserveStartEnd"
                  minTickGap={36}
                />
                <YAxis
                  domain={drawdownYDomain}
                  tick={{ fontSize: 11, fill: "#a1a1aa" }}
                  width={52}
                  tickFormatter={(v: number) => v.toFixed(0) + "%"}
                  label={{ value: "回撤值(%)", angle: -90, position: "insideLeft", offset: 8, style: { fontSize: 11, fill: "#a1a1aa" } }}
                />
                <Tooltip content={(props) => (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <DrawdownTooltip {...(props as any)} />
                )} />
                {maxFundDrawdown !== null && (
                  <ReferenceLine
                    y={maxFundDrawdown}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                  />
                )}
                {appliedBench && (
                  <Area
                    type="monotone"
                    dataKey="benchDD"
                    name={`${benchmarkLabel}（基准）`}
                    stroke="#2563eb"
                    strokeWidth={1.5}
                    fill="url(#benchDdGrad)"
                    dot={false}
                    connectNulls={false}
                    activeDot={{ r: 3, fill: "#2563eb" }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="fundDD"
                  name={info.product_name}
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  fill="url(#fundDdGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: "#ef4444" }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <DrawdownEpisodesTable
            episodes={drawdownEpisodes}
            benchmarkLabel={benchmarkLabel}
            hasBenchmark={!!appliedBench}
          />
        </div>
      )}

      <IntervalMetricsTable
        productName={info.product_name}
        sampleGroup={info.strategy_l1 ?? info.strategy_l2}
        cutoffDate={intervalCutoffDate}
        fundMetrics={fundIntervalMetrics}
        benchmarkLabel={benchmarkLabel}
        benchmarkMetrics={benchmarkIntervalMetrics}
        hasBenchmark={!!appliedBench}
      />

      {filteredNavRows.length >= 2 && (
        <IntervalReturnsChart
          productName={info.product_name}
          sampleGroup={info.strategy_l1 ?? info.strategy_l2}
          dateRangeLabel={`${filteredNavRows[0].price_date} ~ ${filteredNavRows[filteredNavRows.length - 1].price_date}`}
          rows={filteredNavRows}
          navType={filterNavType}
          benchmarkSeries={benchmarkData}
          benchmarkLabel={benchmarkLabel}
          hasBenchmark={!!appliedBench}
        />
      )}

      {filteredNavRows.length >= 2 && (
        <MonthlyReturnsCalendar
          productName={info.product_name}
          sampleGroup={info.strategy_l1 ?? info.strategy_l2}
          rows={filteredNavRows}
          navType={filterNavType}
          peerMonthly={peerMonthly}
        />
      )}

      {peerMonthly.some((r) => r.rank_num !== null) && (
        <RankPercentileTrendChart
          peerMonthly={peerMonthly}
          dateRangeLabel={
            filteredNavRows.length >= 2
              ? `${filteredNavRows[0].price_date} ~ ${filteredNavRows[filteredNavRows.length - 1].price_date}`
              : ""
          }
        />
      )}

      {annualFundRows.length > 0 && (
        <AnnualMetricsTable
          productName={info.product_name}
          sampleGroup={info.strategy_l1 ?? info.strategy_l2}
          dateRangeLabel={
            filteredNavRows.length >= 2
              ? `${filteredNavRows[0].price_date} ~ ${filteredNavRows[filteredNavRows.length - 1].price_date}`
              : ""
          }
          fundRows={annualFundRows}
          peerByYear={peerByYear}
          hasBenchmark={!!appliedBench}
        />
      )}

      <AnnualRankRadarPanel peerByYear={peerByYear} />
    </div>
    </PageShell>

    {/* ── 编辑产品池 modal ────────────────────────────────────────────────── */}
    {showPoolModal && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
        onClick={(e) => e.target === e.currentTarget && setShowPoolModal(false)}
      >
        <div className="bg-white rounded-lg shadow-xl w-[520px] max-w-[95vw] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b">
            <span className="font-semibold text-zinc-900 text-sm">编辑产品池</span>
            <button onClick={() => setShowPoolModal(false)} className="text-zinc-400 hover:text-zinc-700 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {/* Fund name */}
          <div className="px-5 pt-3 pb-1 flex items-center gap-2">
            <div className="w-1 self-stretch rounded-full" style={{ backgroundColor: "#dc2626" }} />
            <span className="font-semibold text-zinc-800 text-sm">{info.product_name}</span>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4">
            {/* Current pools row */}
            <div className="flex items-start gap-3">
              <label className="text-sm text-zinc-600 w-20 flex-shrink-0 text-right pt-1">产品池：</label>
              <div className="flex-1 border border-zinc-200 rounded px-2.5 py-2 min-h-[40px] flex flex-wrap gap-1.5">
                {editPools.map(p => (
                  <span
                    key={p.pool_key}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                    style={{ backgroundColor: "#fffbeb", color: "#d97706", border: "1px solid #fcd34d" }}
                  >
                    {p.pool_label}
                    <button
                      onClick={() => setEditPools(prev => prev.filter(q => q.pool_key !== p.pool_key))}
                      className="hover:opacity-70"
                    >&#x00D7;</button>
                  </span>
                ))}
              </div>
              <button
                onClick={() => setEditPools([])}
                className="text-xs text-zinc-500 hover:text-red-500 transition-colors flex-shrink-0 pt-1"
              >
                清空
              </button>
            </div>

            {/* All team pools row */}
            <div className="flex items-start gap-3">
              <label className="text-sm text-zinc-600 w-20 flex-shrink-0 text-right pt-1">团队产品池：</label>
              <div className="flex-1 flex flex-wrap gap-1.5">
                {ALL_POOLS.map(p => {
                  const active = editPools.some(q => q.pool_key === p.key)
                  return (
                    <button
                      key={p.key}
                      onClick={() => toggleEditPool(p.key, p.label)}
                      className="px-2.5 py-0.5 rounded text-xs transition-colors"
                      style={active
                        ? { backgroundColor: "#eff6ff", color: "#2563eb", border: "1px solid #93c5fd" }
                        : { backgroundColor: "white", color: "#52525b", border: "1px solid #d4d4d8" }
                      }
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t">
            <button
              onClick={() => setShowPoolModal(false)}
              className="px-4 py-1.5 rounded border border-zinc-200 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              取消
            </button>
            <button
              onClick={savePoolChanges}
              disabled={savingPools}
              className="px-4 py-1.5 rounded text-sm text-white font-medium transition-colors"
              style={{ backgroundColor: savingPools ? "#f87171" : "#dc2626" }}
            >
              {savingPools ? "保存中…" : "确定"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── 编辑要素 modal ─────────────────────────────────────────────────── */}
    {showStrategyModal && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
        onClick={(e) => e.target === e.currentTarget && setShowStrategyModal(false)}
      >
        <div className="bg-white rounded-lg shadow-xl w-[520px] max-w-[95vw] flex flex-col" style={{ maxHeight: "90vh" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b">
            <span className="font-semibold text-zinc-900 text-sm">编辑要素</span>
            <button
              onClick={() => setShowStrategyModal(false)}
              className="text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {/* Fund name */}
          <div className="px-5 pt-3 pb-2 flex items-center gap-2">
            <div className="w-1 self-stretch rounded-full" style={{ backgroundColor: "#dc2626" }} />
            <span className="font-semibold text-zinc-800 text-sm">{info.product_name}</span>
          </div>

          {/* Tabs */}
          <div className="flex border-b px-5 gap-0">
            {([
              { key: "platform",     label: "平台策略" },
              { key: "subscription", label: "申赎信息" },
              { key: "attachment",   label: "要素附件" },
              { key: "team",         label: "团队策略" },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setStrategyTab(tab.key)}
                className={[
                  "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                  strategyTab === tab.key
                    ? "border-red-500 text-red-600"
                    : "border-transparent text-zinc-500 hover:text-zinc-800",
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {strategyTab === "team" ? (
              <div className="space-y-4">
                {/* Info notice */}
                <div className="rounded px-3 py-2.5 text-xs" style={{ backgroundColor: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
                  团队策略的新增、编辑在【运维-数据维护-团队策略】中。
                </div>

                {/* 一级策略 */}
                <div className="flex items-center gap-3">
                  <label className="text-sm text-zinc-600 w-20 flex-shrink-0 text-right">一级策略：</label>
                  <select
                    value={editL1}
                    onChange={e => { setEditL1(e.target.value); setEditL2(""); setEditL3s([]) }}
                    className="flex-1 border border-zinc-200 rounded px-3 py-1.5 text-sm text-zinc-800 bg-white focus:outline-none focus:border-zinc-400"
                  >
                    <option value="">— 请选择 —</option>
                    {strategyTree.map(n => (
                      <option key={n.l1} value={n.l1}>{n.l1}</option>
                    ))}
                  </select>
                </div>

                {/* 二级策略 */}
                <div className="flex items-center gap-3">
                  <label className="text-sm text-zinc-600 w-20 flex-shrink-0 text-right">二级策略：</label>
                  <select
                    value={editL2}
                    onChange={e => { setEditL2(e.target.value); setEditL3s([]) }}
                    className="flex-1 border border-zinc-200 rounded px-3 py-1.5 text-sm text-zinc-800 bg-white focus:outline-none focus:border-zinc-400"
                    disabled={!editL1}
                  >
                    <option value="">— 请选择 —</option>
                    {(strategyTree.find(n => n.l1 === editL1)?.l2s ?? []).map(n => (
                      <option key={n.l2} value={n.l2}>{n.l2}</option>
                    ))}
                  </select>
                </div>

                {/* 三级策略 (multi-select chips) */}
                <div className="flex items-start gap-3">
                  <label className="text-sm text-zinc-600 w-20 flex-shrink-0 text-right pt-1.5">三级策略：</label>
                  <div className="flex-1">
                    {editL3s.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {editL3s.map(v => (
                          <span
                            key={v}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                            style={{ backgroundColor: "#eff6ff", color: "#2563eb", border: "1px solid #93c5fd" }}
                          >
                            {v}
                            <button
                              onClick={() => setEditL3s(p => p.filter(x => x !== v))}
                              className="text-blue-400 hover:text-blue-700"
                            >×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <select
                      value=""
                      onChange={e => { const v = e.target.value; if (v && !editL3s.includes(v)) setEditL3s(p => [...p, v]) }}
                      className="w-full border border-zinc-200 rounded px-3 py-1.5 text-sm text-zinc-800 bg-white focus:outline-none focus:border-zinc-400"
                      disabled={!editL2}
                    >
                      <option value="">— 添加三级策略 —</option>
                      {(strategyTree.find(n => n.l1 === editL1)?.l2s.find(n => n.l2 === editL2)?.l3s ?? [])
                        .filter(v => !editL3s.includes(v))
                        .map(v => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-24 text-zinc-400 text-sm">
                {strategyTab === "platform" ? "平台策略" : strategyTab === "subscription" ? "申赎信息" : "要素附件"} 暂无内容
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t">
            <button
              onClick={() => setShowStrategyModal(false)}
              className="px-4 py-1.5 rounded border border-zinc-200 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              取消
            </button>
            <button
              onClick={saveStrategy}
              disabled={savingStrategy}
              className="px-4 py-1.5 rounded text-sm text-white font-medium transition-colors"
              style={{ backgroundColor: savingStrategy ? "#f87171" : "#dc2626" }}
            >
              {savingStrategy ? "保存中…" : "确定"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
