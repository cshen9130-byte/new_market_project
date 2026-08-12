"use client"

import { useEffect, useState, useMemo, useCallback, useRef, memo, Fragment } from "react"
import type React from "react"
import { useParams, useSearchParams } from "next/navigation"
import {
  Area,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
} from "recharts"
import { ArrowLeft, Camera, Database, Download, Files, Heart, HelpCircle, Menu, Plus, Send, Siren, X } from "lucide-react"
import { AddMyTrackingDialog } from "@/components/ma/add-my-tracking-dialog"
import { AddToTeamTrackingDialog } from "@/components/ma/add-to-team-tracking-dialog"
import { FundNavCorrectionRulesDialog } from "@/components/ma/fund-nav-correction-rules-dialog"
import { invalidateTrackingListCache } from "@/lib/client/tracking-list-cache"
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ma/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useRouter } from "next/navigation"
import { computeFundNavMetrics, type MetricKey } from "@/lib/fund-nav-metrics"
import { isWeekendIsoDate } from "@/lib/nav-trading-day"
import { RED, GREEN, getNavFieldValue, computeNavPctChange, filterNavRowsByFrequency, type NavFrequencyFilter, type NavRow, type BenchmarkPoint, type PeerMonthlyRow, type PeerYearlyRow, type AnnualFundRow } from "./components/shared"
import { IntervalMetricsTable, buildBenchmarkIntervalMetrics, type IntervalMetricValues } from "./components/IntervalMetricsTable"
import { IntervalReturnsChart } from "./components/IntervalReturnsChart"
import { WinRateAnalysisPanel } from "./components/WinRateAnalysisPanel"
import { DrawdownEpisodesTable, buildDrawdownEpisodeRows, buildDrawdownEpisodeMarks, DrawdownEpisodeMarkLabel, findNearestDrawdownPoint } from "./components/DrawdownEpisodesTable"
import { MonthlyReturnsCalendar } from "./components/MonthlyReturnsCalendar"
import { RankPercentileTrendChart } from "./components/RankPercentileTrendChart"
import { AnnualMetricsTable } from "./components/AnnualMetricsTable"
import { AnnualRankRadarPanel } from "./components/AnnualRankRadarPanel"
import { FundRatingPanel } from "./components/FundRatingPanel"
import { ScenarioAnalysisPanel } from "./components/ScenarioAnalysisPanel"
import { NavAttributionPanel } from "./components/NavAttributionPanel"
import { FundCompanyPanel } from "./components/FundCompanyPanel"
import { FundProfilePanel } from "./components/FundProfilePanel"
import { FundMaterialsPanel } from "./components/FundMaterialsPanel"
import { DrawdownCalcHelpButton } from "./components/DrawdownCalcHelpButton"
import { amacFundUrl } from "@/lib/amac-urls"
import { formatReturnTooltipLabel, buildBenchmarkPctChangesByDate, type NavChartPoint, type ReturnLabelMode } from "./components/performanceChartUtils"
import { resolveFundDisplayLabel } from "@/lib/fund-display-name"

const menuItems = [
  { key: "market",     label: "市场" },
  { key: "funds",      label: "基金" },
  { key: "portfolio",  label: "组合" },
  { key: "investment", label: "投资" },
  { key: "operations", label: "运维" },
  { key: "instructions", label: "指令" },
  { key: "reports",    label: "报告" },
]

const fundsSidebarGroups = [
  {
    label: "私募数据库",
    items: [
      { key: "private-funds", label: "私募基金" },
      { key: "fund-managers-org", label: "私募管理人" },
      { key: "fund-managers", label: "基金经理" },
    ],
  },
  {
    label: "自建数据库",
    items: [
      { key: "custom-funds", label: "自建基金" },
      { key: "custom-index", label: "自建指数" },
    ],
  },
]

const TAB_DEFAULT_SIDE: Record<string, string> = {
  market: "strategy-observation",
  funds: "private-funds",
  portfolio: "port-simulated",
  investment: "inv-tracking",
  operations: "ops-strategy-tags",
  instructions: "cmd-initiate",
  reports: "rpt-mine",
}

const FUND_DETAIL_TABS = [
  { key: "performance", label: "业绩指标" },
  { key: "product", label: "产品表现" },
  { key: "rating", label: "基金评分" },
  { key: "scenario", label: "情景分析" },
  { key: "attribution", label: "净值归因" },
  { key: "company", label: "基金公司" },
  { key: "profile", label: "基金档案" },
  { key: "materials", label: "相关资料" },
] as const

type FundDetailTab = (typeof FUND_DETAIL_TABS)[number]["key"]

function FundHeaderActionTip({
  label,
  children,
}: {
  label: string
  children: React.ReactElement
}) {
  return (
    <UiTooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={8}
        className="bg-zinc-800 text-white border-0 px-2.5 py-1 text-xs shadow-md [&>svg]:fill-zinc-800 [&>svg]:bg-zinc-800"
      >
        {label}
      </TooltipContent>
    </UiTooltip>
  )
}

/** 估值表分析 – pie chart with one outlined slice (top-right quadrant). */
function ValuationPieChartIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Solid 3/4 – leaves a thin gap before the top-right slice */}
      <path
        d="M12 12 L21.2 12 A9.2 9.2 0 1 1 12 3.05 Z"
        fill="currentColor"
      />
      {/* Outlined top-right slice – hollow center, red stroke */}
      <path
        d="M12 12 L12 2.55 A9.45 9.45 0 0 1 21.45 12 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const DEFAULT_ACTIVE_SIDE_ITEM = "private-funds"

function FundDetailPageShell({
  children,
  onNavigateFunds,
  activeSideItem = DEFAULT_ACTIVE_SIDE_ITEM,
}: {
  children: React.ReactNode
  onNavigateFunds: (tab: string, side?: string) => void
  activeSideItem?: string
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex-shrink-0">
        <nav className="flex items-center gap-1 px-6 h-12">
          {menuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => item.key !== "funds" && onNavigateFunds(item.key)}
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
              const hasActive = group.items.some((i) => i.key === activeSideItem)
              return (
                <div key={group.label}>
                  <div className={[
                    "px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide select-none",
                    hasActive ? "text-red-500" : "text-zinc-400 dark:text-zinc-500",
                  ].join(" ")}>{group.label}</div>
                  {group.items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onNavigateFunds("funds", item.key)}
                      className={[
                        "w-full text-left pl-5 pr-3 py-1.5 text-sm transition-colors focus:outline-none relative",
                        item.key === activeSideItem
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface FundInfo {
  beian_hao:      string
  product_name:   string
  short_name?:    string | null
  strategy_l1:    string | null
  strategy_l2:    string | null
  strategy_l3:    string | null
  manager:        string
  manager_names:  string | null
  manager_registration_no?: string | null
  scale:          string | null
  inception_date: string | null
  operation_date: string | null
  benchmark:      string | null
  ret_1w:         string | null
  ret_1m:         string | null
  ret_3m:         string | null
  ret_6m:         string | null
  ret_1y:         string | null
  sharpe_1y:      string | null
  calmar_1y:      string | null
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
  is_custom_fund?: boolean
  /** True while serving list-cache header before full NAV series arrives. */
  partial?: boolean
  info:       FundInfo
  nav_series: NavRow[]
  metrics:    Metrics
  nav_data_source?: "team" | "platform"
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

function PctSpan({ value, large = false, className }: { value: string | null; large?: boolean; className?: string }) {
  const { text, sign } = fmtPct(value)
  const cls = className ?? (large ? "text-2xl font-bold tabular-nums" : "text-sm font-semibold tabular-nums")
  const color =
    sign === 1 ? RED :
    sign === -1 ? GREEN :
    "#a1a1aa"
  return (
    <span className={cls} style={{ color }}>
      {text}
    </span>
  )
}

// Downsample chart data: keep at most ~500 points for perf
function getDefaultFilterRange(data: DetailData, todayStr: string): { from: string; to: string } {
  const trading = filterNavRowsByFrequency(data.nav_series, "全部")
  const to = trading.length
    ? trading[trading.length - 1].price_date
    : todayStr
  const seriesStart = trading[0]?.price_date
  const inception = data.info.inception_date?.slice(0, 10)
  // Prefer 成立日 when the series still has pre-inception junk (mis-dated 估值表 rows).
  const from =
    seriesStart && inception && seriesStart < inception
      ? inception
      : (seriesStart ?? inception ?? to)
  return { from, to }
}

function getOperationFilterRange(data: DetailData, todayStr: string): { from: string; to: string } {
  const { from: defaultFrom, to } = getDefaultFilterRange(data, todayStr)
  const from = data.info.operation_date?.slice(0, 10) ?? defaultFrom
  return { from, to }
}

function getInitialFilterPeriod(data: DetailData): string {
  return data.info.operation_date?.slice(0, 10) ? "运作以来" : "成立以来"
}

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

function chartDateSpanDays(dates: string[]): number {
  if (dates.length < 2) return 1
  const start = new Date(dates[0]).getTime()
  const end = new Date(dates[dates.length - 1]).getTime()
  return Math.max(1, Math.round((end - start) / 86400000))
}

function pickMonthStep(spanDays: number): number {
  if (spanDays <= 45) return 1
  if (spanDays <= 150) return 1
  if (spanDays <= 450) return 2
  if (spanDays <= 900) return 3
  if (spanDays <= 1800) return 6
  return 12
}

function formatChartAxisDateLabel(dateStr: string, spanDays: number): string {
  const year = dateStr.slice(0, 4)
  const month = parseInt(dateStr.slice(5, 7), 10)
  const day = parseInt(dateStr.slice(8, 10), 10)
  if (!year || isNaN(month)) return dateStr.slice(0, 10)

  if (spanDays <= 45 && !isNaN(day)) {
    return `${month}/${day}`
  }
  if (month === 1) return year
  return `${month}月`
}

function nearestDateInSeries(target: Date, dates: string[]): string {
  const targetTs = target.getTime()
  let best = dates[0]
  let bestDiff = Math.abs(new Date(best).getTime() - targetTs)
  for (let i = 1; i < dates.length; i++) {
    const diff = Math.abs(new Date(dates[i]).getTime() - targetTs)
    if (diff < bestDiff) {
      bestDiff = diff
      best = dates[i]
    }
  }
  return best
}

function formatMonthTargetLabel(year: number, month: number, spanDays: number): string {
  if (spanDays <= 45) return `${month}/${year}`
  if (month === 1) return String(year)
  return `${month}月`
}

function dateForMonthTarget(year: number, month: number, dates: string[]): string {
  const mm = String(month).padStart(2, "0")
  const inMonth = dates.filter((d) => d.startsWith(`${year}-${mm}`))
  if (inMonth.length) return inMonth[Math.floor(inMonth.length / 2)]

  if (month === 1) {
    const inYear = dates.filter((d) => d.startsWith(String(year)))
    if (inYear.length) return inYear[0]
  }

  return nearestDateInSeries(new Date(year, month - 1, 15), dates)
}

function buildChartDateAxisConfig(dates: string[]) {
  if (!dates.length) {
    return {
      ticks: [] as string[],
      tickFormatter: (val: string) => val,
    }
  }
  if (dates.length === 1) {
    const spanDays = 1
    return {
      ticks: dates,
      tickFormatter: (val: string) => formatChartAxisDateLabel(val, spanDays),
    }
  }

  const spanDays = chartDateSpanDays(dates)
  const monthStep = pickMonthStep(spanDays)
  const start = new Date(dates[0])
  const end = new Date(dates[dates.length - 1])

  let curYear = start.getFullYear()
  let curMonth = start.getMonth() + 1 + (start.getDate() > 15 ? 1 : 0)
  while (curMonth > 12) {
    curMonth -= 12
    curYear += 1
  }

  const endYear = end.getFullYear()
  const endMonth = end.getMonth() + 1
  const targets: Array<{ year: number; month: number }> = []
  const seenTargets = new Set<string>()

  function addTarget(year: number, month: number) {
    const key = `${year}-${month}`
    if (seenTargets.has(key)) return
    seenTargets.add(key)
    targets.push({ year, month })
  }

  while (curYear < endYear || (curYear === endYear && curMonth <= endMonth)) {
    addTarget(curYear, curMonth)
    curMonth += monthStep
    while (curMonth > 12) {
      curMonth -= 12
      curYear += 1
    }
  }

  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    const janStart = new Date(y, 0, 1)
    const janEnd = new Date(y, 0, 31)
    if (janEnd >= start && janStart <= end) addTarget(y, 1)
  }

  targets.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month))

  const tickLabels = new Map<string, string>()
  const ticks: string[] = []

  for (const target of targets) {
    const date = dateForMonthTarget(target.year, target.month, dates)
    const label = formatMonthTargetLabel(target.year, target.month, spanDays)
    if (tickLabels.has(date)) {
      if (target.month === 1) tickLabels.set(date, label)
      continue
    }
    ticks.push(date)
    tickLabels.set(date, label)
  }

  ticks.sort((a, b) => a.localeCompare(b))
  if (!ticks.length) ticks.push(dates[0])

  return {
    ticks,
    tickFormatter: (val: string) => tickLabels.get(val) ?? formatChartAxisDateLabel(val, spanDays),
  }
}

function formatDateRange(startTs: number, endTs: number): string {
  return `${new Date(startTs).toISOString().slice(0, 10)} ~ ${new Date(endTs).toISOString().slice(0, 10)}`
}

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

function exportNavChartCsv(
  data: NavChartPoint[],
  chartMode: "nav" | "return",
  fundLabel: string,
  benchmarkLabel: string,
  hasBench: boolean,
  filename: string,
) {
  const escape = (v: string | null | undefined) => {
    if (v == null || v === "") return ""
    const s = String(v)
    return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
  }
  const valueHeader = chartMode === "return" ? "基金收益率(%)" : fundLabel
  const headers = ["日期", valueHeader]
  if (hasBench) headers.push(chartMode === "return" ? `${benchmarkLabel}(%)` : benchmarkLabel)
  const fmtVal = (v: number) => (chartMode === "return" ? v.toFixed(2) : v.toFixed(4))
  const lines = [
    headers.join(","),
    ...data.map((row) => {
      const cols = [escape(row.date), fmtVal(row.value)]
      if (hasBench) cols.push(row.benchmarkValue === null ? "" : fmtVal(row.benchmarkValue))
      return cols.join(",")
    }),
  ]
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadNavChartImage(el: HTMLElement, filename: string) {
  const { default: html2canvas } = await import("html2canvas-pro")
  const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2, useCORS: true })
  const url = canvas.toDataURL("image/png")
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
}

function exportNavCsv(
  rows: NavRow[],
  navType: string,
  filename: string,
  options?: {
    showBenchmarkChg?: boolean
    benchmarkLabel?: string
    benchmarkChgByDate?: Map<string, number | null>
  },
) {
  const escape = (v: string | null | undefined) => {
    if (v == null || v === "") return ""
    const s = String(v)
    return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
  }
  const headers = ["日期", "单位净值", "累计净值", "复权净值", "涨跌幅"]
  if (options?.showBenchmarkChg && options.benchmarkLabel) {
    headers.push(`${options.benchmarkLabel}涨跌幅`)
  }
  const csvRows = [
    headers.join(","),
    ...rows.map((r) => {
      const chg = computeNavPctChange(rows, navType, r.price_date)
      const chgPct = chg === null ? "" : chg.toFixed(2) + "%"
      const cols = [
        escape(r.price_date),
        escape(r.nav),
        escape(r.cum_nav_withdrawal),
        escape(r.cumulative_nav),
        escape(chgPct),
      ]
      if (options?.showBenchmarkChg && options.benchmarkLabel) {
        const benchChg = options.benchmarkChgByDate?.get(r.price_date) ?? null
        cols.push(benchChg === null ? "" : benchChg.toFixed(2) + "%")
      }
      return cols.join(",")
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

function formatPctCell(chg: number | null) {
  const chgPct = chg === null ? null : chg.toFixed(2)
  const chgStyle = chg === null ? {} : chg > 0 ? { color: RED } : chg < 0 ? { color: GREEN } : {}
  const text = chgPct !== null ? (parseFloat(chgPct) > 0 ? "+" : "") + chgPct + "%" : "—"
  return { chgStyle, text }
}

function NavTable({
  rows,
  navType,
  showBenchmarkChg = false,
  benchmarkLabel,
  benchmarkChgByDate,
}: {
  rows: NavRow[]
  navType: string
  showBenchmarkChg?: boolean
  benchmarkLabel?: string
  benchmarkChgByDate?: Map<string, number | null>
}) {
  // Show newest first
  const reversed = useMemo(() => [...rows].reverse(), [rows])
  const benchColLabel = benchmarkLabel ?? "基准"
  const th = "px-2.5 py-2.5 font-medium text-zinc-500 text-xs whitespace-nowrap"
  const td = "px-2.5 py-2 text-xs whitespace-nowrap"
  const tdNum = `${td} text-right tabular-nums`
  const colCount = showBenchmarkChg ? 6 : 5
  const evenPct = `${(100 / colCount).toFixed(4)}%`

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="overflow-y-auto flex-1 rounded-lg border border-zinc-100">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            {Array.from({ length: colCount }, (_, i) => (
              <col key={i} style={{ width: evenPct }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-zinc-50 border-b border-zinc-100">
              <th className={`${th} text-left`}>日期</th>
              <th className={`${th} text-right`}>单位净值</th>
              <th className={`${th} text-right`}>累计净值</th>
              <th className={`${th} text-right`}>复权净值</th>
              <th className={`${th} text-right`}>涨跌幅</th>
              {showBenchmarkChg && (
                <th className={`${th} text-right`}>{benchColLabel}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {reversed.map((r) => {
              const fundCell = formatPctCell(computeNavPctChange(rows, navType, r.price_date))
              const benchCell = showBenchmarkChg
                ? formatPctCell(benchmarkChgByDate?.get(r.price_date) ?? null)
                : null
              return (
                <tr key={r.price_date} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/60">
                  <td className={`${td} text-zinc-700`}>{r.price_date}</td>
                  <td className={`${tdNum} text-zinc-900 font-medium`}>{fmt(r.nav, 4)}</td>
                  <td className={`${tdNum} text-zinc-700`}>{fmt(r.cum_nav_withdrawal, 4)}</td>
                  <td className={`${tdNum} text-zinc-700`}>{fmt(r.cumulative_nav, 4)}</td>
                  <td className={`${tdNum} font-medium`} style={fundCell.chgStyle}>
                    {fundCell.text}
                  </td>
                  {showBenchmarkChg && benchCell && (
                    <td className={`${tdNum} font-medium`} style={benchCell.chgStyle}>
                      {benchCell.text}
                    </td>
                  )}
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
  returnLabelMode = "cumulative",
}: {
  active?: boolean
  payload?: Array<{ value?: number; name?: string; color?: string; dataKey?: string; payload?: NavChartPoint }>
  label?: string
  mode?: "nav" | "return"
  returnLabelMode?: ReturnLabelMode
}) {
  if (!active || !payload?.length) return null
  const visibleItems = payload.filter((item) => {
    if (mode === "return" && returnLabelMode === "period") {
      const point = item.payload
      const periodVal = item.dataKey === "benchmarkValue"
        ? point?.benchmarkPeriodReturn
        : point?.periodReturn
      return typeof periodVal === "number"
    }
    return typeof item.value === "number"
  })
  if (!visibleItems.length) return null

  function resolveValue(item: (typeof visibleItems)[number]): number | null {
    if (mode === "return" && returnLabelMode === "period") {
      const point = item.payload
      const periodVal = item.dataKey === "benchmarkValue"
        ? point?.benchmarkPeriodReturn
        : point?.periodReturn
      return typeof periodVal === "number" ? periodVal : null
    }
    return typeof item.value === "number" ? item.value : null
  }

  function formatValue(value: number): string {
    return mode === "return"
      ? (value >= 0 ? "+" : "") + value.toFixed(2) + "%"
      : value.toFixed(4)
  }

  function formatSeriesLabel(item: (typeof visibleItems)[number]): string {
    if (mode !== "return") return item.name ?? ""
    return formatReturnTooltipLabel(
      item.name,
      returnLabelMode,
      item.dataKey === "benchmarkValue",
    )
  }

  return (
    <div className="bg-white border border-zinc-100 shadow-md rounded-lg px-3 py-2 text-xs">
      <div className="text-zinc-500 mb-1">{label}</div>
      <div className="space-y-1">
        {visibleItems.map((item) => {
          const resolved = resolveValue(item)
          if (resolved === null) return null
          return (
            <div key={item.name} className="font-semibold text-zinc-900" style={item.color ? { color: item.color } : undefined}>
              {formatSeriesLabel(item)}: {formatValue(resolved)}
            </div>
          )
        })}
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

type MaterialChartMark = {
  id: number
  date: string
  chartDate: string
  y: number
  label: string
  filename: string
}

function MaterialMarkShape({
  cx,
  cy,
  mark,
  shadowId,
  onClick,
}: {
  cx?: number
  cy?: number
  mark: MaterialChartMark
  shadowId: string
  onClick?: (mark: MaterialChartMark) => void
}) {
  const [hovered, setHovered] = useState(false)
  if (cx == null || cy == null || !Number.isFinite(cx) || !Number.isFinite(cy)) return null

  const tipWidth = 176
  const tipHeight = 52
  const tipX = cx + 10 + tipWidth > 420 ? -tipWidth - 10 : 10
  const tipY = cy - tipHeight - 8 < 0 ? 10 : -tipHeight - 8

  return (
    <g
      transform={`translate(${cx}, ${cy})`}
      style={{ cursor: "pointer" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(mark)
      }}
    >
      <line x1={0} y1={0} x2={0} y2={-14} stroke="#d97706" strokeWidth={1.5} />
      <circle r={5.5} fill="#f59e0b" stroke="#ffffff" strokeWidth={2} />
      <circle r={12} fill="transparent" />
      {hovered && (
        <g transform={`translate(${tipX}, ${tipY})`} style={{ pointerEvents: "none" }}>
          <rect
            width={tipWidth}
            height={tipHeight}
            rx={6}
            fill="#ffffff"
            stroke="#e4e4e7"
            strokeWidth={1}
            filter={`url(#${shadowId})`}
          />
          <text x={10} y={18} fontSize={11} fontWeight={600} fill="#18181b">
            {(mark.label.length > 18 ? `${mark.label.slice(0, 18)}…` : mark.label)}
          </text>
          <text x={10} y={36} fontSize={10} fill="#71717a">
            {`净值日期 ${mark.chartDate} · 点击查看`}
          </text>
        </g>
      )}
    </g>
  )
}

function NavPerformanceChart({
  data,
  chartMode,
  navTypeLabel,
  yDomain,
  xAxis,
  showDots,
  showBench,
  benchmarkLabel,
  height = "100%",
  gradientId = "navGrad",
  returnLabelMode = "cumulative",
  episodeMarks = [],
  materialMarks = [],
  onMaterialMarkClick,
}: {
  data: NavChartPoint[]
  chartMode: "nav" | "return"
  navTypeLabel: string
  yDomain: [number, number] | [string, string]
  xAxis: ReturnType<typeof buildChartDateAxisConfig>
  showDots: boolean
  showBench: boolean
  benchmarkLabel: string
  height?: number | string
  gradientId?: string
  returnLabelMode?: ReturnLabelMode
  episodeMarks?: Array<{ date: string; y: number; no: number }>
  materialMarks?: MaterialChartMark[]
  onMaterialMarkClick?: (mark: MaterialChartMark) => void
}) {
  const markShadowId = `${gradientId}-materialMarkShadow`
  return (
    <ResponsiveContainer width="100%" height={height} debounce={1}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.12} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.01} />
          </linearGradient>
          <filter id={markShadowId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000000" floodOpacity="0.08" />
          </filter>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f2" vertical={false} />
        <XAxis
          dataKey="date"
          ticks={xAxis.ticks}
          tick={{ fontSize: 11, fill: "#71717a" }}
          tickFormatter={xAxis.tickFormatter}
          interval={0}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={yDomain}
          tick={{ fontSize: 11, fill: "#71717a" }}
          width={chartMode === "return" ? 52 : 60}
          tickFormatter={(v: number) =>
            chartMode === "return"
              ? (v > 0 ? "+" : "") + v.toFixed(0) + "%"
              : v.toFixed(2)
          }
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={(props) => (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <ChartTooltip {...(props as any)} mode={chartMode} returnLabelMode={returnLabelMode} />
        )} />
        {chartMode === "return" && (
          <ReferenceLine y={0} stroke="#d4d4d8" strokeWidth={1} />
        )}
        {showBench && (
          <Line
            type="linear"
            dataKey="benchmarkValue"
            name={benchmarkLabel}
            stroke="#2563eb"
            strokeWidth={1.75}
            strokeDasharray="6 3"
            dot={showDots ? { r: 2, fill: "#2563eb", strokeWidth: 0 } : false}
            connectNulls={false}
            activeDot={{ r: 3.5, fill: "#2563eb", stroke: "#fff", strokeWidth: 1.5 }}
            isAnimationActive={false}
          />
        )}
        <Area
          type="linear"
          dataKey="value"
          name={chartMode === "return" ? "基金收益率" : navTypeLabel}
          stroke={RED}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={showDots ? { r: 2.5, fill: RED, strokeWidth: 0 } : false}
          activeDot={{ r: 4.5, fill: RED, stroke: "#fff", strokeWidth: 1.5 }}
          isAnimationActive={false}
        />
        {episodeMarks.map((mark) => (
          <ReferenceDot
            key={`nav-ep-${mark.no}-${mark.date}`}
            x={mark.date}
            y={mark.y}
            r={0}
            ifOverflow="extendDomain"
            label={<DrawdownEpisodeMarkLabel value={mark.no} />}
          />
        ))}
        {materialMarks.map((mark) => (
          <ReferenceDot
            key={`nav-mat-${mark.id}-${mark.date}`}
            x={mark.date}
            y={mark.y}
            r={0}
            ifOverflow="extendDomain"
            shape={(props) => (
              <MaterialMarkShape
                cx={props.cx}
                cy={props.cy}
                mark={mark}
                shadowId={markShadowId}
                onClick={onMaterialMarkClick}
              />
            )}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PrivateFundDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const beian_hao = typeof params.beian_hao === "string" ? params.beian_hao : ""

  const [data, setData]       = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const [peerMonthly, setPeerMonthly] = useState<PeerMonthlyRow[]>([])
  const [peerYearly, setPeerYearly] = useState<PeerYearlyRow[]>([])
  const [fundTags, setFundTags]   = useState<string[]>([])
  const [fundPools, setFundPools] = useState<{ pool_key: string; pool_label: string }[]>([])
  const [availTeamTags, setAvailTeamTags] = useState<string[]>([])
  const [showTagEditor, setShowTagEditor] = useState(false)
  const [trackedMine, setTrackedMine] = useState(false)
  const [trackedTeam, setTrackedTeam] = useState(false)
  const [showMyTrackingDialog, setShowMyTrackingDialog] = useState(false)
  const [showTeamTrackingDialog, setShowTeamTrackingDialog] = useState(false)
  const [showNavCorrectionDialog, setShowNavCorrectionDialog] = useState(false)
  const [managerRegistrationNo, setManagerRegistrationNo] = useState<string | null>(null)

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
  const [strategySaveError, setStrategySaveError] = useState<string | null>(null)

  function openStrategyModal() {
    if (!data) return
    // Prefill from displayed tags first, then overwrite with raw 团队策略 from type6.
    setEditL1(data.info.strategy_l1 ?? "")
    setEditL2(data.info.strategy_l2 ?? "")
    const l3raw = data.info.strategy_l3 ?? ""
    setEditL3s(l3raw ? l3raw.split(/[，,]/).map(s => s.trim()).filter(Boolean) : [])
    setStrategyTab("team")
    setStrategySaveError(null)
    setShowStrategyModal(true)
    Promise.all([
      fetch("/ma/api/tracking-funds/strategies?strategy_source=company&pool=all").then((r) => r.json()),
      fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/strategy`).then((r) => r.json()),
    ])
      .then(([tree, company]) => {
        if (Array.isArray(tree)) setStrategyTree(tree)
        if (company && !company.error) {
          setEditL1(company.strategy_l1 ?? "")
          setEditL2(company.strategy_l2 ?? "")
          const raw = company.strategy_l3 ?? ""
          setEditL3s(raw ? String(raw).split(/[，,]/).map((s: string) => s.trim()).filter(Boolean) : [])
        }
      })
      .catch(() => {})
  }

  async function saveStrategy() {
    if (!data) return
    setSavingStrategy(true)
    setStrategySaveError(null)
    try {
      const res = await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/strategy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_l1: editL1 || null,
          strategy_l2: editL2 || null,
          strategy_l3: editL3s.length ? editL3s.join(",") : null,
          product_name: data.info.product_name ?? null,
        }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => null) as { error?: string } | null
        setStrategySaveError(errBody?.error || `保存失败（${res.status}）`)
        return
      }
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
    } catch {
      setStrategySaveError("保存失败，请稍后重试")
    } finally {
      setSavingStrategy(false)
    }
  }

  // ─── 编辑产品池 modal ──────────────────────────────────────────────────────
  const [availTeamPools, setAvailTeamPools] = useState<{ key: string; label: string }[]>([])
  const [showPoolModal, setShowPoolModal] = useState(false)
  const [editPools, setEditPools] = useState<{ pool_key: string; pool_label: string }[]>([])
  const [savingPools, setSavingPools] = useState(false)

  function openPoolModal() {
    setEditPools([...fundPools])
    setShowPoolModal(true)
    fetch("/ma/api/tracking-funds/pools?scope=team", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d?.data)) return
        setAvailTeamPools(
          d.data
            .filter((p: { pool_key?: string }) => p?.pool_key && !String(p.pool_key).startsWith("__"))
            .map((p: { pool_key: string; label: string }) => ({ key: p.pool_key, label: p.label })),
        )
      })
      .catch(() => {})
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
      invalidateTrackingListCache([
        ...toAdd.map((p) => p.pool_key),
        ...toRemove.map((p) => p.pool_key),
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

  function userFetchHeaders(): Record<string, string> {
    try {
      const u = JSON.parse(localStorage.getItem("currentUser") || "null")
      const id = u?.id ?? ""
      return id ? { "x-market-user-id": id } : {}
    } catch {
      return {}
    }
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

  function refreshTrackedIds() {
    fetch("/ma/api/tracking-funds/tracked-ids")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.mine)) setTrackedMine(d.mine.includes(beian_hao))
        if (Array.isArray(d?.team)) setTrackedTeam(d.team.includes(beian_hao))
      })
      .catch(() => {})
  }

  useEffect(() => {
    if (!beian_hao) return
    const manager = data?.info?.manager?.trim()
    const qs = manager ? `?manager=${encodeURIComponent(manager)}` : ""
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/company${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.registration_no) setManagerRegistrationNo(d.registration_no)
      })
      .catch(() => {})
  }, [beian_hao, data?.info?.manager])

  useEffect(() => {
    if (data?.info?.manager_registration_no) {
      setManagerRegistrationNo(data.info.manager_registration_no)
    }
  }, [data?.info?.manager_registration_no])

  useEffect(() => {
    if (!beian_hao) return
    let cancelled = false
    setLoading(true)
    setSeriesLoading(true)
    setError(null)
    setPeerMonthly([])
    setData(null)

    const headers = userFetchHeaders()
    const detailUrl = `/ma/api/private-funds/${encodeURIComponent(beian_hao)}`

    // Phase 1: list-cache header (name / latest NAV / period returns) for instant paint.
    const headerPromise = fetch(`${detailUrl}?phase=header`, { headers })
      .then(async (r) => {
        if (!r.ok) return null
        return r.json() as Promise<DetailData>
      })
      .catch(() => null)

    void headerPromise.then((header) => {
      if (cancelled || !header?.info) return
      setData((prev) => {
        // Don't clobber a full response that won the race.
        if (prev && prev.partial === false) return prev
        if (prev && !prev.partial && (prev.nav_series?.length ?? 0) > 0) return prev
        return header
      })
      setLoading(false)
    })

    // Phase 2: full detail with NAV series + refined metrics.
    // Abort if the series path hangs (e.g. cold valuation history scan) so the UI
    // is not stuck on “加载净值曲线…” forever after the header already painted.
    const seriesAbort = new AbortController()
    const seriesTimeout = window.setTimeout(() => seriesAbort.abort(), 20_000)
    fetch(detailUrl, { headers, signal: seriesAbort.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<DetailData>
      })
      .then((full) => {
        if (cancelled) return
        setData(full)
        setError(null)
        // Detail open write-throughs 跟踪产品 list tip — drop stale client list rows
        // so returning to the list picks up the same 最新净值日期 as this page.
        window.setTimeout(() => invalidateTrackingListCache(), 400)
      })
      .catch(async (e: Error) => {
        if (cancelled) return
        const header = await headerPromise
        // Keep partial header visible if the series request fails / times out.
        if (!header?.info) setError(e.name === "AbortError" ? "加载超时" : e.message)
      })
      .finally(() => {
        window.clearTimeout(seriesTimeout)
        if (cancelled) return
        setLoading(false)
        setSeriesLoading(false)
      })

    loadFundMeta(beian_hao)
    fetch("/ma/api/ops/team-tags?category=fund")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setAvailTeamTags(d.map((t: { name: string }) => t.name)) : null)
      .catch(() => {})
    refreshTrackedIds()

    return () => {
      cancelled = true
      seriesAbort.abort()
      window.clearTimeout(seriesTimeout)
    }
  }, [beian_hao])

  const reloadFundDetail = useCallback(() => {
    if (!beian_hao) return
    setSeriesLoading(true)
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}`, { headers: userFetchHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<DetailData>
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setSeriesLoading(false))
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

  const [chartMode, setChartMode] = useState<"nav" | "return">("return")
  const [returnLabelMode, setReturnLabelMode] = useState<ReturnLabelMode>("cumulative")
  const [showTableBenchmarkChg, setShowTableBenchmarkChg] = useState(false)
  const [detailTab, setDetailTab] = useState<FundDetailTab>("performance")

  useEffect(() => {
    const tab = searchParams.get("tab")
    if (tab === "materials") setDetailTab("materials")
  }, [searchParams])

  type MaterialMetaRow = {
    id: number
    original_filename: string
    chart_date: string | null
    title: string
  }
  const [materialMetaRows, setMaterialMetaRows] = useState<MaterialMetaRow[]>([])

  useEffect(() => {
    if (!beian_hao) return
    let cancelled = false
    fetch(`/ma/api/ops/fund-contracts?beian_hao=${encodeURIComponent(beian_hao)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || json.error) return
        const rows = Array.isArray(json.data) ? (json.data as MaterialMetaRow[]) : []
        setMaterialMetaRows(rows)
      })
      .catch(() => {
        if (!cancelled) setMaterialMetaRows([])
      })
    return () => { cancelled = true }
  }, [beian_hao, detailTab])

  const navChartCaptureRef = useRef<HTMLDivElement>(null)
  const navChartLightboxRef = useRef<HTMLDivElement>(null)
  const [navChartLightboxOpen, setNavChartLightboxOpen] = useState(false)
  const [lightboxChartHeight, setLightboxChartHeight] = useState(0)

  // ─── Filter state ────────────────────────────────────────────────────────
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
  const [appliedFreq,    setAppliedFreq]    = useState<NavFrequencyFilter>("全部")
  const [appliedBench,   setAppliedBench]   = useState<string>("")
  const [benchmarkData,  setBenchmarkData]  = useState<BenchmarkPoint[]>([])
  const [showDateRange,    setShowDateRange]    = useState(false)
  const [excessByDivision, setExcessByDivision] = useState(false)

  // When data loads, seed benchmark and dates
  useEffect(() => {
    if (!data) return
    const period = getInitialFilterPeriod(data)
    const range = period === "运作以来"
      ? getOperationFilterRange(data, todayStr)
      : getDefaultFilterRange(data, todayStr)
    const benchmarkKey = normalizeBenchmarkKey(data.info.benchmark)
    setFilterPeriod(period)
    setFilterFrom(range.from)
    setFilterTo(range.to)
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

  const PERIOD_OPTIONS = ["成立以来", "运作以来", "近1年", "近3年", "近5年", "今年以来", "自定义"]
  function applyPeriod(p: string) {
    setFilterPeriod(p)
    if (!data) return
    const { from: defaultFrom, to: last } = getDefaultFilterRange(data, todayStr)
    let from = defaultFrom
    if (p === "运作以来") from = getOperationFilterRange(data, todayStr).from
    else if (p === "近1年")  from = sub(last, 1, "year")
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
    setAppliedFreq(filterFreq as NavFrequencyFilter)
    setAppliedBench(filterBench)
  }
  function handleReset() {
    if (!data) return
    const period = getInitialFilterPeriod(data)
    const range = period === "运作以来"
      ? getOperationFilterRange(data, todayStr)
      : getDefaultFilterRange(data, todayStr)
    const benchmarkKey = normalizeBenchmarkKey(data.info.benchmark)
    setFilterPeriod(period)
    setFilterFrom(range.from)
    setFilterTo(range.to)
    setFilterNavType("复权净值")
    setFilterFreq("全部")
    setFilterBench(benchmarkKey)
    setAppliedFrom("")
    setAppliedTo("")
    setAppliedFreq("全部")
    setAppliedBench(benchmarkKey)
  }

  // Active date range for chart/table
  const defaultFilterRange = data ? getDefaultFilterRange(data, todayStr) : null
  const displayFrom = filterFrom || defaultFilterRange?.from || ""
  const displayTo = filterTo || defaultFilterRange?.to || ""
  const activeFrom = appliedFrom || displayFrom
  const activeTo   = appliedTo   || displayTo

  const filteredNavRows = useMemo(() => {
    if (!data) return []
    // filterNavRowsByFrequency also drops Sat/Sun custody forward-fills.
    const byDate = data.nav_series.filter((row) => (!activeFrom || row.price_date >= activeFrom) && (!activeTo || row.price_date <= activeTo))
    return filterNavRowsByFrequency(byDate, appliedFreq)
  }, [data, activeFrom, activeTo, appliedFreq])

  const activeChartData = useMemo(() => {
    if (!filteredNavRows.length) return []
    const rows = downsample(filteredNavRows)
    const benchmarkValues = appliedBench
      ? buildAlignedBenchmarkValues(rows, benchmarkData, chartMode, filterNavType)
      : rows.map(() => null)
    const firstNav = getNavFieldValue(rows[0], filterNavType)
    const fundNavValues = rows.map((row) => getNavFieldValue(row, filterNavType))

    return rows.map((row, index) => {
      const navValue = fundNavValues[index]
      const prevNav = index > 0 ? fundNavValues[index - 1] : null
      const periodReturn = prevNav !== null && prevNav > 0
        ? +(((navValue / prevNav) - 1) * 100).toFixed(4)
        : null

      let benchmarkPeriodReturn: number | null = null
      if (index > 0 && benchmarkValues[index] !== null && benchmarkValues[index - 1] !== null) {
        const prevFactor = 1 + benchmarkValues[index - 1]! / 100
        const currFactor = 1 + benchmarkValues[index]! / 100
        if (prevFactor > 0) {
          benchmarkPeriodReturn = +(((currFactor / prevFactor) - 1) * 100).toFixed(4)
        }
      }

      return {
        date: row.price_date,
        value: chartMode === "return"
          ? (firstNav > 0 ? +(((navValue / firstNav) - 1) * 100).toFixed(4) : 0)
          : navValue,
        benchmarkValue: benchmarkValues[index],
        periodReturn,
        benchmarkPeriodReturn,
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

  const drawdownEpisodes = useMemo(
    () => buildDrawdownEpisodeRows(filteredNavRows, filterNavType, !!appliedBench, benchmarkData),
    [filteredNavRows, filterNavType, appliedBench, benchmarkData],
  )

  const drawdownEpisodeMarks = useMemo(
    () => buildDrawdownEpisodeMarks(drawdownChartData, drawdownEpisodes, (p) => p.fundDD),
    [drawdownChartData, drawdownEpisodes],
  )

  const returnChartEpisodeMarks = useMemo(
    () => buildDrawdownEpisodeMarks(activeChartData, drawdownEpisodes, (p) => p.value),
    [activeChartData, drawdownEpisodes],
  )

  const materialChartMarks = useMemo((): MaterialChartMark[] => {
    if (!activeChartData.length) return []
    return materialMetaRows.flatMap((row) => {
      const chartDate = (row.chart_date || "").trim()
      if (!chartDate) return []
      const point = findNearestDrawdownPoint(activeChartData, chartDate)
      if (!point || !Number.isFinite(point.value)) return []
      return [{
        id: row.id,
        date: point.date,
        chartDate,
        y: point.value,
        label: (row.title || "").trim() || row.original_filename,
        filename: row.original_filename,
      }]
    })
  }, [activeChartData, materialMetaRows])

  const handleMaterialMarkClick = useCallback((mark: MaterialChartMark) => {
    setDetailTab("materials")
    router.replace(
      `/ma/dashboard/private-funds/${encodeURIComponent(beian_hao)}?tab=materials&materialId=${mark.id}`,
      { scroll: false },
    )
  }, [beian_hao, router])

  const benchmarkLabel = getBenchmarkLabel(appliedBench)

  const benchmarkChgByDate = useMemo(() => {
    if (!appliedBench || !benchmarkData.length || !filteredNavRows.length) return undefined
    return buildBenchmarkPctChangesByDate(filteredNavRows, benchmarkData)
  }, [appliedBench, benchmarkData, filteredNavRows])

  const intervalCutoffDate = filteredNavRows[filteredNavRows.length - 1]?.price_date
    ?? (data?.metrics.latest_nav_date && !isWeekendIsoDate(data.metrics.latest_nav_date)
      ? data.metrics.latest_nav_date
      : "")
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
    let maxDD = 0, troughTs = dateTsArr[0], maxDDPeakVal = navVals[0], maxDDPeakTs = dateTsArr[0]
    let longestNoNewHigh = 0, curHighTs = dateTsArr[0]
    let longestNoNewHighStartTs = dateTsArr[0], longestNoNewHighEndTs = dateTsArr[0]
    for (let i = 0; i < navVals.length; i++) {
      if (navVals[i] > peak) { peak = navVals[i]; peakTs = dateTsArr[i]; curHighTs = dateTsArr[i] }
      else {
        const d = (dateTsArr[i] - curHighTs) / 86400000
        if (d > longestNoNewHigh) {
          longestNoNewHigh = d
          longestNoNewHighStartTs = curHighTs
          longestNoNewHighEndTs = dateTsArr[i]
        }
      }
      const dd = (peak - navVals[i]) / peak
      if (dd > maxDD) { maxDD = dd; troughTs = dateTsArr[i]; maxDDPeakVal = peak; maxDDPeakTs = peakTs }
    }
    let ddRecoveryDays: number | null = null
    let ddRecoveryEndTs: number | null = null
    for (let i = 0; i < navVals.length; i++) {
      if (dateTsArr[i] > troughTs && navVals[i] >= maxDDPeakVal) {
        ddRecoveryDays = Math.round((dateTsArr[i] - troughTs) / 86400000)
        ddRecoveryEndTs = dateTsArr[i]
        break
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
      maxDDInterval: formatDateRange(maxDDPeakTs, troughTs),
      ddRecoveryInterval: ddRecoveryEndTs !== null ? formatDateRange(troughTs, ddRecoveryEndTs) : null,
      longestNoNewHighInterval: formatDateRange(longestNoNewHighStartTs, longestNoNewHighEndTs),
      sortino: fundSortino,
      correlation: NaN, infoRatio: NaN, trackingError: NaN, alpha: NaN, beta: NaN,
      skewness: _skew(fundRets), kurtosis: _kurt(fundRets), var95: _var95(fundRets),
    }

    // ── Benchmark ──────────────────────────────────────────────────────────
    type BenchStats = typeof fund & { ddRecoveryDays: number | null }
    type PeriodStatBlock = typeof fund
    let bench: BenchStats | null = null
    let excess: PeriodStatBlock | null = null

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

          let bPeak = bLevels[0].v, bPeakTs = bLevels[0].ts, bMaxDD = 0, bTroughTs = bLevels[0].ts
          let bMaxDDPeakVal = bLevels[0].v, bMaxDDPeakTs = bLevels[0].ts
          let bLongestNoNewHigh = 0, bCurHighTs = bLevels[0].ts
          let bLongestNoNewHighStartTs = bLevels[0].ts, bLongestNoNewHighEndTs = bLevels[0].ts
          for (const { v, ts } of bLevels) {
            if (v > bPeak) { bPeak = v; bPeakTs = ts; bCurHighTs = ts }
            else {
              const d = (ts - bCurHighTs) / 86400000
              if (d > bLongestNoNewHigh) {
                bLongestNoNewHigh = d
                bLongestNoNewHighStartTs = bCurHighTs
                bLongestNoNewHighEndTs = ts
              }
            }
            const dd = (bPeak - v) / bPeak
            if (dd > bMaxDD) { bMaxDD = dd; bTroughTs = ts; bMaxDDPeakVal = bPeak; bMaxDDPeakTs = bPeakTs }
          }
          let bDDRecoveryDays: number | null = null
          let bDDRecoveryEndTs: number | null = null
          for (const { v, ts } of bLevels) {
            if (ts > bTroughTs && v >= bMaxDDPeakVal) {
              bDDRecoveryDays = Math.round((ts - bTroughTs) / 86400000)
              bDDRecoveryEndTs = ts
              break
            }
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

          if (excessByDivision && excessRets.length >= 2) {
            const exPeriodRet = (1 + fundPeriodRet) / (1 + bPeriodRet) - 1
            const exAnnRet = Math.pow(1 + exPeriodRet, 1 / years) - 1
            const exAnnVol = _std(excessRets) * Math.sqrt(ppy)
            const exSharpe = isFinite(exAnnVol) && exAnnVol > 0 ? (exAnnRet - RF) / exAnnVol : NaN

            const exLevels: Array<{ v: number; ts: number }> = []
            let exNav = 1
            let retIdx = 0
            for (let i = Math.max(1, baseIdx); i < benchAligned.length; i++) {
              const bp = benchAligned[i - 1], bc = benchAligned[i]
              if (bp !== null && bc !== null && bp > 0 && navVals[i - 1] > 0) {
                if (exLevels.length === 0) exLevels.push({ v: 1, ts: dateTsArr[i - 1] })
                exNav *= (1 + excessRets[retIdx])
                exLevels.push({ v: exNav, ts: dateTsArr[i] })
                retIdx++
              }
            }

            let exPeak = exLevels[0]?.v ?? 1, exPeakTs = exLevels[0]?.ts ?? dateTsArr[0]
            let exMaxDD = 0, exTroughTs = exPeakTs, exMaxDDPeakVal = exPeak, exMaxDDPeakTs = exPeakTs
            let exLongestNoNewHigh = 0, exCurHighTs = exPeakTs
            let exLongestNoNewHighStartTs = exPeakTs, exLongestNoNewHighEndTs = exPeakTs
            for (const { v, ts } of exLevels) {
              if (v > exPeak) { exPeak = v; exPeakTs = ts; exCurHighTs = ts }
              else {
                const d = (ts - exCurHighTs) / 86400000
                if (d > exLongestNoNewHigh) {
                  exLongestNoNewHigh = d
                  exLongestNoNewHighStartTs = exCurHighTs
                  exLongestNoNewHighEndTs = ts
                }
              }
              const dd = (exPeak - v) / exPeak
              if (dd > exMaxDD) { exMaxDD = dd; exTroughTs = ts; exMaxDDPeakVal = exPeak; exMaxDDPeakTs = exPeakTs }
            }
            let exDDRecoveryDays: number | null = null
            let exDDRecoveryEndTs: number | null = null
            for (const { v, ts } of exLevels) {
              if (ts > exTroughTs && v >= exMaxDDPeakVal) {
                exDDRecoveryDays = Math.round((ts - exTroughTs) / 86400000)
                exDDRecoveryEndTs = ts
                break
              }
            }

            const exCalmar = exMaxDD > 0 ? exAnnRet / exMaxDD : NaN
            const exDownRets = excessRets.filter(r => r < 0)
            const exDsr = exDownRets.length > 0
              ? Math.sqrt(exDownRets.reduce((s, r) => s + r * r, 0) / exDownRets.length) * Math.sqrt(ppy)
              : 0
            const exSortino = exDsr > 0 ? (exAnnRet - RF) / exDsr : NaN

            excess = {
              periodRet: exPeriodRet, annRet: exAnnRet, annVol: exAnnVol,
              sharpe: exSharpe, calmar: exCalmar, downsideRisk: exDsr,
              maxDD: exMaxDD, ddRecoveryDays: exDDRecoveryDays,
              longestNoNewHighDays: Math.round(exLongestNoNewHigh),
              maxDDInterval: formatDateRange(exMaxDDPeakTs, exTroughTs),
              ddRecoveryInterval: exDDRecoveryEndTs !== null ? formatDateRange(exTroughTs, exDDRecoveryEndTs) : null,
              longestNoNewHighInterval: formatDateRange(exLongestNoNewHighStartTs, exLongestNoNewHighEndTs),
              sortino: exSortino,
              correlation: NaN, infoRatio: NaN, trackingError: NaN, alpha: NaN, beta: NaN,
              skewness: _skew(excessRets), kurtosis: _kurt(excessRets), var95: _var95(excessRets),
            }
          }

          bench = {
            periodRet: bPeriodRet, annRet: bAnnRet, annVol: bAnnVol,
            sharpe: bSharpe, calmar: bCalmar, downsideRisk: bDsr,
            maxDD: bMaxDD, ddRecoveryDays: bDDRecoveryDays, longestNoNewHighDays: Math.round(bLongestNoNewHigh),
            maxDDInterval: formatDateRange(bMaxDDPeakTs, bTroughTs),
            ddRecoveryInterval: bDDRecoveryEndTs !== null ? formatDateRange(bTroughTs, bDDRecoveryEndTs) : null,
            longestNoNewHighInterval: formatDateRange(bLongestNoNewHighStartTs, bLongestNoNewHighEndTs),
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
      dateRange: `${filteredNavRows[0].price_date} ~ ${filteredNavRows[filteredNavRows.length - 1].price_date}`,
      fund,
      bench,
      excess,
    }
  }, [filteredNavRows, benchmarkData, filterNavType, appliedBench, excessByDivision])

  const yDomain = useMemo(() => {
    if (!activeChartData.length) return ["auto", "auto"] as [string, string]
    const vals = activeChartData.flatMap((d) => {
      const out = [d.value]
      if (typeof d.benchmarkValue === "number") out.push(d.benchmarkValue)
      return out
    })
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    if (chartMode === "return") {
      min = Math.min(min, 0)
      max = Math.max(max, 0)
    }
    const span = max - min
    const pad = span > 0 ? span * 0.08 : Math.max(Math.abs(max), 1) * 0.08
    return [+(min - pad).toFixed(4), +(max + pad).toFixed(4)] as [number, number]
  }, [activeChartData, chartMode])

  const navChartPointCount = activeChartData.length
  const navChartShowDots = navChartPointCount <= 40
  const navChartXAxis = useMemo(
    () => buildChartDateAxisConfig(activeChartData.map((d) => d.date)),
    [activeChartData],
  )
  const drawdownChartXAxis = useMemo(
    () => buildChartDateAxisConfig(drawdownChartData.map((d) => d.date)),
    [drawdownChartData],
  )

  const navChartExportName = useMemo(() => {
    const product = data?.info.product_name ?? "chart"
    const modeLabel = chartMode === "return" ? "收益曲线" : "净值曲线"
    return `${product}_${modeLabel}_${new Date().toISOString().slice(0, 10)}`
  }, [data?.info.product_name, chartMode])

  const handleDownloadNavChartImage = useCallback(async () => {
    const el = navChartCaptureRef.current
    if (!el) return
    await downloadNavChartImage(el, `${navChartExportName}.png`)
  }, [navChartExportName])

  const handleDownloadNavChartData = useCallback(() => {
    exportNavChartCsv(
      activeChartData,
      chartMode,
      chartMode === "return" ? "基金收益率" : filterNavType,
      benchmarkLabel,
      !!appliedBench,
      `${navChartExportName}.csv`,
    )
  }, [activeChartData, chartMode, filterNavType, benchmarkLabel, appliedBench, navChartExportName])

  useEffect(() => {
    if (!navChartLightboxOpen) {
      setLightboxChartHeight(0)
      return
    }
    const el = navChartLightboxRef.current
    if (!el) return
    const measure = () => {
      const h = el.clientHeight
      setLightboxChartHeight(h > 0 ? h : Math.max(420, Math.round(window.innerHeight * 0.7)))
    }
    measure()
    requestAnimationFrame(measure)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [navChartLightboxOpen, chartMode, activeChartData.length])

  const navigateToFundsPage = useCallback((tab: string, side?: string) => {
    if (tab === "funds" && side === "fund-managers-org") {
      if (managerRegistrationNo) {
        router.push(`/ma/dashboard/private-funds/managers/${encodeURIComponent(managerRegistrationNo)}`)
        return
      }
      const managerKeyword = data?.info?.manager?.trim()
      if (managerKeyword) {
        router.push(
          `/ma/dashboard/private-funds?tab=funds&side=fund-managers-org&keyword=${encodeURIComponent(managerKeyword)}`,
        )
        return
      }
    }
    const sideItem = side ?? TAB_DEFAULT_SIDE[tab] ?? "private-funds"
    router.push(`/ma/dashboard/private-funds?tab=${tab}&side=${sideItem}`)
  }, [router, managerRegistrationNo, data?.info?.manager])

  const activeSideItem = data?.is_custom_fund ? "custom-funds" : DEFAULT_ACTIVE_SIDE_ITEM
  const backHref = data?.is_custom_fund
    ? "/ma/dashboard/private-funds?tab=funds&side=custom-funds"
    : "/ma/dashboard/private-funds"

  if (loading) {
    return (
      <FundDetailPageShell onNavigateFunds={navigateToFundsPage} activeSideItem={DEFAULT_ACTIVE_SIDE_ITEM}>
        <div className="space-y-4 animate-pulse">
          <div className="h-4 w-24 rounded bg-zinc-100" />
          <div className="h-10 w-64 rounded bg-zinc-100" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-zinc-100" />
            ))}
          </div>
          <div className="h-[360px] rounded-xl bg-zinc-100" />
        </div>
        <p className="text-center text-zinc-400 text-sm mt-6">加载业绩数据…</p>
      </FundDetailPageShell>
    )
  }

  if (error || !data) {
    return (
      <FundDetailPageShell onNavigateFunds={navigateToFundsPage} activeSideItem={DEFAULT_ACTIVE_SIDE_ITEM}>
        <div className="flex items-center justify-center h-40 text-red-500 text-sm">
          加载失败：{error ?? "未知错误"}
        </div>
      </FundDetailPageShell>
    )
  }

  const { info, metrics, nav_series, nav_data_source } = data
  const displayName = resolveFundDisplayLabel(info.short_name, info.product_name)
    .replace(/私募证券投资基金/g, "")
    .replace(/私募股权投资基金/g, "")
    .trim() || info.product_name
  const navTableTitle = nav_data_source === "team" ? "团队净值" : "平台数据"
  // Prefer last trading-day point so header never shows Sat/Sun forward-fills.
  const latestTradingNav = filterNavRowsByFrequency(nav_series, "全部").at(-1) ?? null
  const displayLatestNav = latestTradingNav?.nav ?? metrics.latest_nav
  const displayLatestNavDate = latestTradingNav?.price_date ?? metrics.latest_nav_date
  const displayLatestCumNav = latestTradingNav?.cum_nav_withdrawal ?? metrics.latest_cum_nav
  const displayLatestAdjNav = latestTradingNav?.cumulative_nav ?? metrics.latest_cum_nav_reinvested
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

  return (
    <>
    <FundDetailPageShell onNavigateFunds={navigateToFundsPage} activeSideItem={activeSideItem}>
    <div>
      {/* Back link */}
      <a
        href={backHref}
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        返回基金列表
      </a>

      {/* ── Header: fund name + strategy tags ────────────── */}
      <div className="mb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-zinc-900 leading-tight" title={info.product_name}>{displayName}</h1>
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

          {/* Header action icons */}
          <div className="flex items-center gap-0.5 shrink-0 pt-0.5">
            <FundHeaderActionTip label="估值表分析">
              <button
                type="button"
                onClick={() => window.open(
                  `/ma/dashboard/private-funds/${encodeURIComponent(beian_hao)}/valuation`,
                  "_blank",
                  "noopener,noreferrer",
                )}
                className="p-1.5 rounded text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <ValuationPieChartIcon className="h-[18px] w-[18px]" />
              </button>
            </FundHeaderActionTip>
            <FundHeaderActionTip label="净值修正规则">
              <button
                type="button"
                onClick={() => setShowNavCorrectionDialog(true)}
                className="p-1.5 rounded text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                <Database className="h-[18px] w-[18px]" />
              </button>
            </FundHeaderActionTip>
            <FundHeaderActionTip label="添加预警">
              <button
                type="button"
                onClick={() => {}}
                className="p-1.5 rounded text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                <Siren className="h-[18px] w-[18px]" />
              </button>
            </FundHeaderActionTip>
            <FundHeaderActionTip label="导出报告">
              <button
                type="button"
                onClick={() => setDetailTab("materials")}
                className="p-1.5 rounded text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                <Files className="h-[18px] w-[18px]" />
              </button>
            </FundHeaderActionTip>
            <FundHeaderActionTip label="截图">
              <button
                type="button"
                onClick={() => {
                  if (detailTab !== "performance") {
                    setDetailTab("performance")
                    window.setTimeout(() => { void handleDownloadNavChartImage() }, 150)
                  } else {
                    void handleDownloadNavChartImage()
                  }
                }}
                className="p-1.5 rounded text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                <Camera className="h-[18px] w-[18px]" />
              </button>
            </FundHeaderActionTip>
            <FundHeaderActionTip label="对比">
              <button
                type="button"
                onClick={() => router.push("/ma/dashboard/private-funds?tab=investment&side=inv-compare")}
                className="px-1.5 py-1.5 rounded text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors text-xs font-semibold tracking-tight"
              >
                VS
              </button>
            </FundHeaderActionTip>
            <FundHeaderActionTip label="添加到我的跟踪">
              <button
                type="button"
                onClick={() => setShowMyTrackingDialog(true)}
                className={[
                  "relative p-1.5 rounded transition-colors",
                  trackedMine
                    ? "text-red-500 hover:text-red-600 hover:bg-red-50"
                    : "text-zinc-500 hover:text-red-500 hover:bg-zinc-100",
                ].join(" ")}
              >
                <Heart className={["h-[18px] w-[18px]", trackedMine ? "fill-current" : ""].join(" ")} />
                {!trackedMine && (
                  <Plus className="absolute -bottom-0.5 -right-0.5 h-2 w-2 stroke-[3]" />
                )}
              </button>
            </FundHeaderActionTip>
            <FundHeaderActionTip label="添加到团队跟踪">
              <button
                type="button"
                onClick={() => setShowTeamTrackingDialog(true)}
                className={[
                  "p-1.5 rounded transition-colors",
                  trackedTeam
                    ? "text-red-500 hover:text-red-600 hover:bg-red-50"
                    : "text-zinc-500 hover:text-red-500 hover:bg-zinc-100",
                ].join(" ")}
              >
                <Send className={["h-[18px] w-[18px]", trackedTeam ? "fill-current" : ""].join(" ")} />
              </button>
            </FundHeaderActionTip>
          </div>
        </div>
      </div>

      {/* ── Key info band – stacks on narrow containers, single row on wide ── */}
      <div className="@container py-[clamp(0.625rem,1.2cqw,1rem)] mb-4 border-y border-zinc-100">
        <div className="flex flex-col gap-4 @[52rem]:flex-row @[52rem]:items-start @[52rem]:gap-x-[clamp(0.5rem,1.5cqw,2rem)]">

        {/* Nav group: unit + cumulative */}
        <div className="flex items-start gap-[clamp(0.5rem,1.5cqw,2rem)] shrink-0">
          <div className="shrink-0">
            <div className="text-[clamp(1.125rem,3cqw,2rem)] font-bold tabular-nums leading-none" style={{ color: RED }}>
              {fmt(displayLatestNav, 4)}
            </div>
            <div className="text-[clamp(0.625rem,1.1cqw,0.75rem)] text-zinc-500 mt-0.5 whitespace-nowrap">单位净值（{displayLatestNavDate ?? ""}）</div>
          </div>

          <div className="shrink-0 flex flex-col gap-0.5 justify-center text-[clamp(0.625rem,1.1cqw,0.75rem)] text-zinc-500">
            <div className="whitespace-nowrap">
              累计净值：<span className="font-semibold text-zinc-800 tabular-nums">{fmt(displayLatestCumNav, 4)}</span>
            </div>
            <div className="whitespace-nowrap">
              复权净值：<span className="font-semibold text-zinc-800 tabular-nums">{fmt(displayLatestAdjNav, 4)}</span>
            </div>
          </div>
        </div>

        <div className="hidden @[52rem]:block w-px self-stretch bg-zinc-100 shrink-0" />

        {/* Performance metrics – grid wraps columns by container width */}
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 @[36rem]:grid-cols-3 @[56rem]:grid-cols-5">
            <div className="min-w-0 flex flex-col items-start gap-0.5">
              <PctSpan
                value={metrics.ret_since_inception}
                className="text-sm @[40rem]:text-base @[64rem]:text-xl font-bold tabular-nums leading-tight"
              />
              <span className="text-[10px] @[40rem]:text-xs text-zinc-500 leading-snug">成立以来收益</span>
            </div>

            <div className="min-w-0 flex flex-col items-start gap-0.5">
              <PctSpan
                value={metrics.ytd_ret}
                className="text-sm @[40rem]:text-base @[64rem]:text-xl font-bold tabular-nums leading-tight"
              />
              <span className="text-[10px] @[40rem]:text-xs text-zinc-500 leading-snug">今年以来收益</span>
            </div>

            <div className="min-w-0 flex flex-col items-start gap-0.5">
              <PctSpan
                value={metrics.ann_ret}
                className="text-sm @[40rem]:text-base @[64rem]:text-xl font-bold tabular-nums leading-tight"
              />
              <span className="text-[10px] @[40rem]:text-xs text-zinc-500 leading-snug">成立以来年化</span>
            </div>

            <div className="min-w-0 flex flex-col items-start gap-0.5">
              <span className="text-sm @[40rem]:text-base @[64rem]:text-xl font-bold tabular-nums leading-tight" style={{ color: GREEN }}>
                {metrics.max_drawdown !== null ? "-" + metrics.max_drawdown + "%" : "—"}
              </span>
              <span className="text-[10px] @[40rem]:text-xs text-zinc-500 leading-snug">成立以来最大回撤</span>
            </div>

            {metrics.sharpe_since_inception && (
              <div className="min-w-0 flex flex-col items-start gap-0.5">
                <span
                  className="text-sm @[40rem]:text-base @[64rem]:text-xl font-bold tabular-nums leading-tight"
                  style={{
                    color: parseFloat(metrics.sharpe_since_inception) > 0
                      ? RED
                      : parseFloat(metrics.sharpe_since_inception) < 0
                        ? GREEN
                        : "#27272a",
                  }}
                >
                  {metrics.sharpe_since_inception}
                </span>
                <span className="text-[10px] @[40rem]:text-xs text-zinc-500 leading-snug">成立以来夏普比率</span>
              </div>
            )}
          </div>
        </div>

        <div className="hidden @[52rem]:block w-px self-stretch bg-zinc-100 shrink-0" />

        {/* 备案 / 管理人 info block */}
        <div className="shrink-0 border-t border-zinc-100 pt-3 @[52rem]:border-t-0 @[52rem]:pt-0 grid grid-cols-2 gap-x-[clamp(0.375rem,1.5cqw,2rem)] @[52rem]:self-center text-[clamp(0.625rem,1cqw,0.75rem)] text-zinc-500">
          <div className="grid grid-cols-[auto_1fr] gap-x-[clamp(0.25rem,0.8cqw,0.75rem)] gap-y-0.5">
            <span className="whitespace-nowrap">备案编号：</span>
            {info.beian_hao ? (
              <a
                href={amacFundUrl(info.beian_hao)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-600 hover:underline"
              >
                {info.beian_hao}
              </a>
            ) : (
              <span className="font-medium text-zinc-800">—</span>
            )}
            <span className="whitespace-nowrap">产品成立时间：</span>
            <span className="font-medium text-zinc-800 whitespace-nowrap">{info.inception_date?.slice(0, 10) ?? "—"}</span>
            <span className="whitespace-nowrap">基金经理：</span>
            <span className="font-medium text-zinc-800">{info.manager_names || "—"}</span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-[clamp(0.25rem,0.8cqw,0.75rem)] gap-y-0.5">
            <span className="whitespace-nowrap">私募管理人：</span>
            {managerRegistrationNo && info.manager ? (
              <a
                href={`/ma/dashboard/private-funds/managers/${encodeURIComponent(managerRegistrationNo)}?manager=${encodeURIComponent(info.manager)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-600 hover:underline"
              >
                {info.manager}
              </a>
            ) : (
              <span className="font-medium text-zinc-800">{info.manager || "—"}</span>
            )}
            <span className="whitespace-nowrap">公司管理规模：</span>
            <span className="font-medium text-zinc-800 whitespace-nowrap">{info.scale || "—"}</span>
            {info.benchmark && (
              <>
                <span className="whitespace-nowrap">业绩基准：</span>
                <span className="font-medium text-zinc-800">{info.benchmark}</span>
              </>
            )}
          </div>
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
          value={displayFrom}
          onChange={e => { setFilterFrom(e.target.value); setFilterPeriod("自定义") }}
          className="border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700 focus:outline-none"
        />
        <span className="text-zinc-400">～</span>
        {/* Date to */}
        <input
          type="date"
          value={displayTo}
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

      <div className="flex items-center gap-6 border-b border-zinc-100 mb-4 overflow-x-auto">
        {FUND_DETAIL_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setDetailTab(tab.key)}
            className={[
              "pb-2.5 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
              detailTab === tab.key
                ? "text-red-500 border-red-500 font-medium"
                : "text-zinc-500 border-transparent hover:text-zinc-700",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {detailTab === "performance" && (
      <>
      {/* ── Chart + Table side by side ─────────────────── */}
      <div className="flex flex-col xl:flex-row gap-4" style={{ height: 420 }}>
      {seriesLoading && activeChartData.length <= 1 && (
        <div className="xl:w-[60%] min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
          <div className="text-sm font-semibold text-zinc-800 mb-2">净值走势</div>
          <div className="flex-1 rounded-lg bg-zinc-100 animate-pulse" />
          <p className="text-center text-xs text-zinc-400 mt-3">加载净值曲线…</p>
        </div>
      )}
      {activeChartData.length > 1 && (
        <div className="xl:w-[60%] min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
          <div ref={navChartCaptureRef} className="flex flex-col flex-1 min-h-0">
          <div className="flex items-start justify-between mb-2 flex-shrink-0 gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-800">
              {chartMode === "nav" ? `净值走势（${filterNavType}）` : `收益曲线（${filterNavType}）`}
            </div>
              {activeFrom && activeTo && (
                <div className="text-[11px] text-zinc-400 mt-1 tabular-nums">
                  {activeFrom} ~ {activeTo}
                </div>
              )}
              <div className="flex items-center gap-4 text-xs text-zinc-600 mt-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: RED }} />
                  {chartMode === "return" ? "基金收益率" : filterNavType}
                </span>
                {appliedBench && (
                  <span className="inline-flex items-center gap-1.5">
                    <svg width="20" height="4" aria-hidden="true" className="inline-block">
                      <line x1="0" y1="2" x2="20" y2="2" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 3" />
                    </svg>
                    {benchmarkLabel}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <div className="inline-flex text-xs">
              <button
                  type="button"
                onClick={() => setChartMode("return")}
                  className={`px-3 py-1 transition-colors border rounded-l ${
                  chartMode === "return"
                      ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                      : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                }`}
              >
                收益曲线
              </button>
              <button
                  type="button"
                onClick={() => setChartMode("nav")}
                  className={`px-3 py-1 transition-colors border rounded-r -ml-px ${
                  chartMode === "nav"
                      ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                      : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                }`}
              >
                净值曲线
              </button>
              </div>
              {chartMode === "return" && (
                <div className="inline-flex text-xs">
                  <button
                    type="button"
                    onClick={() => setReturnLabelMode("cumulative")}
                    className={`px-2.5 py-1 transition-colors border rounded-l ${
                      returnLabelMode === "cumulative"
                        ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                        : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                    }`}
                  >
                    累计收益
                  </button>
                  <button
                    type="button"
                    onClick={() => setReturnLabelMode("period")}
                    className={`px-2.5 py-1 transition-colors border rounded-r -ml-px ${
                      returnLabelMode === "period"
                        ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                        : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                    }`}
                  >
                    涨跌幅
                  </button>
                </div>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="p-1 text-zinc-400 hover:text-zinc-600 rounded transition-colors"
                    aria-label="图表菜单"
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[7.5rem] text-xs">
                  <DropdownMenuItem onClick={handleDownloadNavChartImage}>下载图片</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadNavChartData}>下载数据</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setNavChartLightboxOpen(true)}>查看大图</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <NavPerformanceChart
              data={activeChartData}
              chartMode={chartMode}
              navTypeLabel={filterNavType}
              yDomain={yDomain}
              xAxis={navChartXAxis}
              showDots={navChartShowDots}
              showBench={!!appliedBench}
              benchmarkLabel={benchmarkLabel}
              gradientId="navGradMain"
              returnLabelMode={returnLabelMode}
              materialMarks={materialChartMarks}
              onMaterialMarkClick={handleMaterialMarkClick}
            />
          </div>
          </div>
        </div>
      )}

      {/* ── NAV Table ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-semibold text-zinc-700">{navTableTitle}</div>
            {nav_data_source === "team" && (
              <span className="relative group/help inline-flex">
                <HelpCircle className="h-3.5 w-3.5 text-zinc-400 cursor-help" aria-label="团队净值说明" />
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded text-xs leading-snug text-white bg-zinc-700 whitespace-nowrap opacity-0 group-hover/help:opacity-100 transition-opacity z-50 shadow-md">
                  团队净值仅团队内部可见，可在运维进行净值管理。
                  <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-[5px] border-transparent border-t-zinc-700" />
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!appliedBench) return
                setShowTableBenchmarkChg((v) => !v)
              }}
              disabled={!appliedBench}
              title={appliedBench ? undefined : "请先选择业绩基准并点击开始分析"}
              className={`inline-flex items-center text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                showTableBenchmarkChg && appliedBench
                  ? "text-red-600 font-medium"
                  : "text-zinc-500 hover:text-zinc-800 disabled:hover:text-zinc-500"
              }`}
            >
              {showTableBenchmarkChg && appliedBench ? "隐藏基准涨跌幅" : "显示基准涨跌幅"}
            </button>
            <button
              onClick={() => exportNavCsv(
                filteredNavRows,
                filterNavType,
                `${info.product_name}_${navTableTitle}_${new Date().toISOString().slice(0, 10)}.csv`,
                {
                  showBenchmarkChg: !!(showTableBenchmarkChg && appliedBench),
                  benchmarkLabel,
                  benchmarkChgByDate,
                },
              )}
              disabled={filteredNavRows.length === 0}
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-3.5 w-3.5" />
              导出
            </button>
          </div>
        </div>
        <NavTable
          rows={filteredNavRows}
          navType={filterNavType}
          showBenchmarkChg={!!(showTableBenchmarkChg && appliedBench)}
          benchmarkLabel={benchmarkLabel}
          benchmarkChgByDate={benchmarkChgByDate}
        />
      </div>
      </div>{/* end flex chart+table */}

      {/* ── Period Statistics Table ──────────────────────── */}
      {periodStats && (
        <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
          {/* Header row */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-zinc-500 min-h-[1rem]">
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
            const { fund, bench, excess } = periodStats
            const hasBench = appliedBench && bench !== null
            const showExcessMetrics = excessByDivision && hasBench && excess !== null
            const dash = <span className="text-zinc-300">—</span>

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
            const highlightPct = (v: number | undefined) => {
              if (v === undefined || !isFinite(v)) return <span className="text-zinc-400 tabular-nums">—</span>
              const s = (v * 100).toFixed(2) + "%"
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
            const StatCell = ({ value, interval }: { value: React.ReactNode; interval?: string | null }) => (
              <div>
                <div>{value}</div>
                <div className={`text-[10px] font-normal text-zinc-400 mt-0.5 min-h-[0.875rem] ${showDateRange && interval ? "" : "invisible"}`}>
                  {interval ?? "\u00a0"}
                </div>
              </div>
            )

            const leftRows: Array<{
              label: string
              fNode: React.ReactNode
              bNode: React.ReactNode
              fInterval?: string | null
              bInterval?: string | null
            }> = showExcessMetrics ? [
              { label: "超额区间收益", fNode: highlightPct(excess!.periodRet), bNode: dash },
              { label: "超额年化收益", fNode: highlightPct(excess!.annRet), bNode: dash },
              { label: "超额年化波动率", fNode: pct(excess!.annVol), bNode: dash },
              { label: "超额夏普比率", fNode: num(excess!.sharpe), bNode: dash },
              { label: "超额卡玛比率", fNode: num(excess!.calmar), bNode: dash },
              { label: "超额下行风险", fNode: pct(excess!.downsideRisk), bNode: dash },
              {
                label: "超额最大回撤",
                fNode: pct(excess!.maxDD),
                bNode: dash,
                fInterval: excess!.maxDDInterval,
                bInterval: null,
              },
              {
                label: "超额最大回撤回补期（天）",
                fNode: excess!.ddRecoveryDays === null ? "未回补" : excess!.ddRecoveryDays,
                bNode: dash,
                fInterval: excess!.ddRecoveryInterval,
                bInterval: null,
              },
              {
                label: "超额最长连续不创新高天数（天）",
                fNode: excess!.longestNoNewHighDays,
                bNode: dash,
                fInterval: excess!.longestNoNewHighInterval,
                bInterval: null,
              },
            ] : [
              { label: "区间收益",                 fNode: colorPct(fund.periodRet),     bNode: hasBench ? colorPct(bench!.periodRet)     : <span className="text-zinc-300">—</span> },
              { label: "年化收益",                 fNode: colorPct(fund.annRet),        bNode: hasBench ? colorPct(bench!.annRet)        : <span className="text-zinc-300">—</span> },
              { label: "年化波动率",               fNode: pct(fund.annVol),             bNode: hasBench ? pct(bench!.annVol)             : "—" },
              { label: "夏普比率（Rf=2.00%）",     fNode: num(fund.sharpe),             bNode: hasBench ? num(bench!.sharpe)             : "—" },
              { label: "卡马比率",                 fNode: num(fund.calmar),             bNode: hasBench ? num(bench!.calmar)             : "—" },
              { label: "下行风险",                 fNode: pct(fund.downsideRisk),       bNode: hasBench ? pct(bench!.downsideRisk)       : "—" },
              {
                label: "最大回撤",
                fNode: pct(fund.maxDD),
                bNode: hasBench ? pct(bench!.maxDD) : "—",
                fInterval: fund.maxDDInterval,
                bInterval: hasBench ? bench!.maxDDInterval : null,
              },
              {
                label: "最大回撤回补期（天）",
                fNode: fund.ddRecoveryDays === null ? "未回补" : fund.ddRecoveryDays,
                bNode: !hasBench ? "—" : bench!.ddRecoveryDays === null ? "未回补" : bench!.ddRecoveryDays,
                fInterval: fund.ddRecoveryInterval,
                bInterval: hasBench ? bench!.ddRecoveryInterval : null,
              },
              {
                label: "最长连续不创新高天数（天）",
                fNode: fund.longestNoNewHighDays,
                bNode: hasBench ? bench!.longestNoNewHighDays : "—",
                fInterval: fund.longestNoNewHighInterval,
                bInterval: hasBench ? bench!.longestNoNewHighInterval : null,
              },
            ]

            const rightRows: Array<{
              label: string
              fNode: React.ReactNode
              bNode: React.ReactNode
            }> = showExcessMetrics ? [
              { label: "超额索提诺比率", fNode: num(excess!.sortino), bNode: dash },
              { label: "相关系数",       fNode: num(fund.correlation), bNode: num(1) },
              { label: "信息比率",       fNode: num(fund.infoRatio),   bNode: dash },
              { label: "跟踪误差",       fNode: pct(fund.trackingError), bNode: "0.00%" },
              { label: "Alpha",          fNode: colorPct(fund.alpha !== undefined && isFinite(fund.alpha) ? fund.alpha : NaN), bNode: "0.00%" },
              { label: "Beta",           fNode: num(fund.beta),        bNode: "1.0000" },
              { label: "偏度",           fNode: num(fund.skewness),    bNode: num(bench!.skewness) },
              { label: "峰度",           fNode: num(fund.kurtosis),    bNode: num(bench!.kurtosis) },
              { label: "VaR（95%置信）", fNode: num(fund.var95),       bNode: num(bench!.var95) },
            ] : [
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
                    <TH>{displayName}</TH>
                    {hasBench && <TH>{benchmarkLabel}（基准）</TH>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.label} className={i % 2 === 1 ? "bg-zinc-50/60" : ""}>
                      <TD>{row.label}</TD>
                      <TD right>
                        {"fInterval" in row && row.fInterval !== undefined
                          ? <StatCell value={row.fNode} interval={row.fInterval} />
                          : row.fNode}
                      </TD>
                      {hasBench && (
                        <TD right>
                          {"bInterval" in row && row.bInterval !== undefined
                            ? <StatCell value={row.bNode} interval={row.bInterval} />
                            : row.bNode}
                        </TD>
                      )}
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

      {/* ── Chart + Table (copy above drawdown) ─────────── */}
      <div className="mt-4 flex flex-col xl:flex-row gap-4" style={{ height: 420 }}>
      {seriesLoading && activeChartData.length <= 1 && (
        <div className="xl:w-[60%] min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
          <div className="text-sm font-semibold text-zinc-800 mb-2">净值走势</div>
          <div className="flex-1 rounded-lg bg-zinc-100 animate-pulse" />
          <p className="text-center text-xs text-zinc-400 mt-3">加载净值曲线…</p>
        </div>
      )}
      {activeChartData.length > 1 && (
        <div className="xl:w-[60%] min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
          <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-start justify-between mb-2 flex-shrink-0 gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-800">
              {chartMode === "nav" ? `净值走势（${filterNavType}）` : `收益曲线（${filterNavType}）`}
            </div>
              {activeFrom && activeTo && (
                <div className="text-[11px] text-zinc-400 mt-1 tabular-nums">
                  {activeFrom} ~ {activeTo}
                </div>
              )}
              <div className="flex items-center gap-4 text-xs text-zinc-600 mt-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: RED }} />
                  {chartMode === "return" ? "基金收益率" : filterNavType}
                </span>
                {appliedBench && (
                  <span className="inline-flex items-center gap-1.5">
                    <svg width="20" height="4" aria-hidden="true" className="inline-block">
                      <line x1="0" y1="2" x2="20" y2="2" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 3" />
                    </svg>
                    {benchmarkLabel}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <div className="inline-flex text-xs">
              <button
                  type="button"
                onClick={() => setChartMode("return")}
                  className={`px-3 py-1 transition-colors border rounded-l ${
                  chartMode === "return"
                      ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                      : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                }`}
              >
                收益曲线
              </button>
              <button
                  type="button"
                onClick={() => setChartMode("nav")}
                  className={`px-3 py-1 transition-colors border rounded-r -ml-px ${
                  chartMode === "nav"
                      ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                      : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                }`}
              >
                净值曲线
              </button>
              </div>
              {chartMode === "return" && (
                <div className="inline-flex text-xs">
                  <button
                    type="button"
                    onClick={() => setReturnLabelMode("cumulative")}
                    className={`px-2.5 py-1 transition-colors border rounded-l ${
                      returnLabelMode === "cumulative"
                        ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                        : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                    }`}
                  >
                    累计收益
                  </button>
                  <button
                    type="button"
                    onClick={() => setReturnLabelMode("period")}
                    className={`px-2.5 py-1 transition-colors border rounded-r -ml-px ${
                      returnLabelMode === "period"
                        ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                        : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                    }`}
                  >
                    涨跌幅
                  </button>
                </div>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="p-1 text-zinc-400 hover:text-zinc-600 rounded transition-colors"
                    aria-label="图表菜单"
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[7.5rem] text-xs">
                  <DropdownMenuItem onClick={handleDownloadNavChartImage}>下载图片</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadNavChartData}>下载数据</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setNavChartLightboxOpen(true)}>查看大图</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <NavPerformanceChart
              data={activeChartData}
              chartMode={chartMode}
              navTypeLabel={filterNavType}
              yDomain={yDomain}
              xAxis={navChartXAxis}
              showDots={navChartShowDots}
              showBench={!!appliedBench}
              benchmarkLabel={benchmarkLabel}
              gradientId="navGradAboveDd"
              returnLabelMode={returnLabelMode}
              episodeMarks={returnChartEpisodeMarks}
              materialMarks={materialChartMarks}
              onMaterialMarkClick={handleMaterialMarkClick}
            />
          </div>
          </div>
        </div>
      )}

      {/* ── NAV Table ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-semibold text-zinc-700">{navTableTitle}</div>
            {nav_data_source === "team" && (
              <span className="relative group/help inline-flex">
                <HelpCircle className="h-3.5 w-3.5 text-zinc-400 cursor-help" aria-label="团队净值说明" />
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded text-xs leading-snug text-white bg-zinc-700 whitespace-nowrap opacity-0 group-hover/help:opacity-100 transition-opacity z-50 shadow-md">
                  团队净值仅团队内部可见，可在运维进行净值管理。
                  <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-[5px] border-transparent border-t-zinc-700" />
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!appliedBench) return
                setShowTableBenchmarkChg((v) => !v)
              }}
              disabled={!appliedBench}
              title={appliedBench ? undefined : "请先选择业绩基准并点击开始分析"}
              className={`inline-flex items-center text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                showTableBenchmarkChg && appliedBench
                  ? "text-red-600 font-medium"
                  : "text-zinc-500 hover:text-zinc-800 disabled:hover:text-zinc-500"
              }`}
            >
              {showTableBenchmarkChg && appliedBench ? "隐藏基准涨跌幅" : "显示基准涨跌幅"}
            </button>
            <button
              onClick={() => exportNavCsv(
                filteredNavRows,
                filterNavType,
                `${info.product_name}_${navTableTitle}_${new Date().toISOString().slice(0, 10)}.csv`,
                {
                  showBenchmarkChg: !!(showTableBenchmarkChg && appliedBench),
                  benchmarkLabel,
                  benchmarkChgByDate,
                },
              )}
              disabled={filteredNavRows.length === 0}
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-3.5 w-3.5" />
              导出
            </button>
          </div>
        </div>
        <NavTable
          rows={filteredNavRows}
          navType={filterNavType}
          showBenchmarkChg={!!(showTableBenchmarkChg && appliedBench)}
          benchmarkLabel={benchmarkLabel}
          benchmarkChgByDate={benchmarkChgByDate}
        />
      </div>
      </div>{/* end flex chart+table copy */}

      {/* ── Dynamic Drawdown Chart ───────────────────────── */}
      {drawdownChartData.length > 1 && (
        <div className="mt-4 flex flex-col xl:flex-row gap-4" style={{ height: 420 }}>
          <div className="xl:w-[60%] min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
            <div className="flex items-start justify-between mb-1 flex-shrink-0">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                  动态回撤
                  <DrawdownCalcHelpButton />
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
                  {displayName}
                </span>
                {appliedBench && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: "#2563eb" }} />
                    {benchmarkLabel}（基准）
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0">
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
                    ticks={drawdownChartXAxis.ticks}
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    tickFormatter={drawdownChartXAxis.tickFormatter}
                    interval={0}
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
                  {drawdownEpisodeMarks.map((mark) => (
                    <ReferenceDot
                      key={`ep-${mark.no}-${mark.date}`}
                      x={mark.date}
                      y={mark.y}
                      r={0}
                      ifOverflow="extendDomain"
                      label={<DrawdownEpisodeMarkLabel value={mark.no} />}
                    />
                  ))}
                  {appliedBench && (
                    <Area
                      type="linear"
                      dataKey="benchDD"
                      name={`${benchmarkLabel}（基准）`}
                      stroke="#2563eb"
                      strokeWidth={1.75}
                      strokeDasharray="6 3"
                      fill="url(#benchDdGrad)"
                      dot={drawdownChartData.length <= 40 ? { r: 2, fill: "#2563eb", strokeWidth: 0 } : false}
                      connectNulls={false}
                      activeDot={{ r: 3.5, fill: "#2563eb", stroke: "#fff", strokeWidth: 1.5 }}
                      isAnimationActive={false}
                    />
                  )}
                  <Area
                    type="linear"
                    dataKey="fundDD"
                    name={displayName}
                    stroke="#ef4444"
                    strokeWidth={2}
                    fill="url(#fundDdGrad)"
                    dot={drawdownChartData.length <= 40 ? { r: 2.5, fill: "#ef4444", strokeWidth: 0 } : false}
                    activeDot={{ r: 4.5, fill: "#ef4444", stroke: "#fff", strokeWidth: 1.5 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex-1 min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
            <DrawdownEpisodesTable
              episodes={drawdownEpisodes}
              benchmarkLabel={benchmarkLabel}
              hasBenchmark={!!appliedBench}
            />
          </div>
        </div>
      )}


      <IntervalMetricsTable
        productName={displayName}
        sampleGroup={info.strategy_l1 ?? info.strategy_l2}
        cutoffDate={intervalCutoffDate}
        fundMetrics={fundIntervalMetrics}
        benchmarkLabel={benchmarkLabel}
        benchmarkMetrics={benchmarkIntervalMetrics}
        hasBenchmark={!!appliedBench}
      />

      {filteredNavRows.length >= 2 && (
        <IntervalReturnsChart
          productName={displayName}
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
          productName={displayName}
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
          productName={displayName}
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
      </>
      )}

      {detailTab === "product" && (
        <WinRateAnalysisPanel
          beian_hao={beian_hao}
          productName={displayName}
          dateRangeLabel={`${activeFrom} ~ ${activeTo}`}
          rows={filteredNavRows}
          navType={filterNavType}
          benchmarkSeries={benchmarkData}
          benchmarkLabel={benchmarkLabel}
          hasBenchmark={!!appliedBench}
          sampleGroup={info.strategy_l1 ?? info.strategy_l2}
          companyStrategy={info.strategy_l1 ?? info.strategy_l2}
        />
      )}

      {detailTab === "rating" && (
        <FundRatingPanel
          beian_hao={beian_hao}
          productName={displayName}
          cutoffDate={intervalCutoffDate ?? activeTo}
          navSource={navTableTitle}
          sampleGroup={info.strategy_l1 ?? info.strategy_l2}
          benchmarkKey={appliedBench}
        />
      )}

      {detailTab === "scenario" && (
        <ScenarioAnalysisPanel
          beian_hao={beian_hao}
          productName={displayName}
          dateRangeLabel={`${activeFrom} ~ ${activeTo}`}
          dateFrom={activeFrom}
          dateTo={activeTo}
          rows={filteredNavRows}
          navType={filterNavType}
          benchmarkSeries={benchmarkData}
          benchmarkLabel={benchmarkLabel}
          hasBenchmark={!!appliedBench}
          defaultCategoryCode={appliedBench || "NHCI.NH"}
        />
      )}

      {detailTab === "attribution" && (
        <NavAttributionPanel
          productName={displayName}
          dateRangeLabel={`${activeFrom} ~ ${activeTo}`}
          dateFrom={activeFrom}
          dateTo={activeTo}
          rows={filteredNavRows}
          navType={filterNavType}
          benchmarkSeries={benchmarkData}
          hasBenchmark={!!appliedBench}
        />
      )}

      {detailTab === "company" && (
        <FundCompanyPanel beian_hao={beian_hao} />
      )}

      {detailTab === "profile" && (
        <FundProfilePanel
          beian_hao={beian_hao}
          fallback={{
            product_name: info.product_name,
            manager: info.manager,
            inception_date: info.inception_date,
          }}
        />
      )}

      {detailTab === "materials" && (
        <FundMaterialsPanel
          beian_hao={beian_hao}
          product_name={data?.info?.product_name}
        />
      )}

      {detailTab !== "performance" && detailTab !== "product" && detailTab !== "rating" && detailTab !== "scenario" && detailTab !== "attribution" && detailTab !== "company" && detailTab !== "profile" && detailTab !== "materials" && (
        <div className="min-h-[320px]" />
      )}
    </div>
    </FundDetailPageShell>

    {navChartLightboxOpen && activeChartData.length > 1 && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
        onClick={() => setNavChartLightboxOpen(false)}
      >
        <div
          className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between mb-3 flex-shrink-0">
            <div>
              <div className="text-base font-semibold text-zinc-800">
                {chartMode === "nav" ? `净值走势（${filterNavType}）` : `收益曲线（${filterNavType}）`}
              </div>
              {activeFrom && activeTo && (
                <div className="text-xs text-zinc-400 mt-1 tabular-nums">{activeFrom} ~ {activeTo}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setNavChartLightboxOpen(false)}
              className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded transition-colors"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div ref={navChartLightboxRef} className="w-full h-[70vh] min-h-[420px]">
            {lightboxChartHeight > 0 && (
              <NavPerformanceChart
                data={activeChartData}
                chartMode={chartMode}
                navTypeLabel={filterNavType}
                yDomain={yDomain}
                xAxis={navChartXAxis}
                showDots={navChartShowDots}
                showBench={!!appliedBench}
                benchmarkLabel={benchmarkLabel}
                height={lightboxChartHeight}
                gradientId="navGradLightbox"
                returnLabelMode={returnLabelMode}
                materialMarks={materialChartMarks}
                onMaterialMarkClick={handleMaterialMarkClick}
              />
            )}
          </div>
        </div>
      </div>
    )}

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
            <span className="font-semibold text-zinc-800 text-sm" title={info.product_name}>{displayName}</span>
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
                {availTeamPools.map(p => {
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
            <span className="font-semibold text-zinc-800 text-sm" title={info.product_name}>{displayName}</span>
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
                    onChange={e => { setEditL1(e.target.value); setEditL2(""); setEditL3s([]); setStrategySaveError(null) }}
                    className="flex-1 border border-zinc-200 rounded px-3 py-1.5 text-sm text-zinc-800 bg-white focus:outline-none focus:border-zinc-400"
                  >
                    <option value="">— 请选择 —</option>
                    {strategyTree.map(n => (
                      <option key={n.l1} value={n.l1}>{n.l1}</option>
                    ))}
                    {editL1 && !strategyTree.some(n => n.l1 === editL1) && (
                      <option value={editL1}>{editL1}</option>
                    )}
                  </select>
                </div>

                {/* 二级策略 */}
                <div className="flex items-center gap-3">
                  <label className="text-sm text-zinc-600 w-20 flex-shrink-0 text-right">二级策略：</label>
                  <select
                    value={editL2}
                    onChange={e => { setEditL2(e.target.value); setEditL3s([]); setStrategySaveError(null) }}
                    className="flex-1 border border-zinc-200 rounded px-3 py-1.5 text-sm text-zinc-800 bg-white focus:outline-none focus:border-zinc-400"
                    disabled={!editL1}
                  >
                    <option value="">— 请选择 —</option>
                    {(strategyTree.find(n => n.l1 === editL1)?.l2s ?? []).map(n => (
                      <option key={n.l2} value={n.l2}>{n.l2}</option>
                    ))}
                    {editL2 && !(strategyTree.find(n => n.l1 === editL1)?.l2s ?? []).some(n => n.l2 === editL2) && (
                      <option value={editL2}>{editL2}</option>
                    )}
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
            {strategySaveError && (
              <span className="mr-auto text-sm text-red-500 truncate max-w-[60%]" title={strategySaveError}>
                {strategySaveError}
              </span>
            )}
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

    {showMyTrackingDialog && (
      <AddMyTrackingDialog
        open
        beian_hao={beian_hao}
        product_name={info.product_name}
        onClose={() => setShowMyTrackingDialog(false)}
        onSaved={refreshTrackedIds}
      />
    )}
    {showTeamTrackingDialog && (
      <AddToTeamTrackingDialog
        open
        beian_hao={beian_hao}
        product_name={info.product_name}
        onClose={() => setShowTeamTrackingDialog(false)}
        onSaved={refreshTrackedIds}
      />
    )}
    <FundNavCorrectionRulesDialog
      open={showNavCorrectionDialog}
      onClose={() => setShowNavCorrectionDialog(false)}
      beianHao={beian_hao}
      productName={info.product_name}
      onSaved={reloadFundDetail}
    />
    </>
  )
}
