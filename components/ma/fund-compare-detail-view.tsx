"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Camera, Plus, Save } from "lucide-react"
import { FundCompareFundTable } from "@/components/ma/fund-compare-fund-table"
import { FundCompareMetricsTable } from "@/components/ma/fund-compare-metrics-table"
import { FundCompareIntervalMetricsTable } from "@/components/ma/fund-compare-interval-metrics-table"
import { FundComparePeriodReturnsChart } from "@/components/ma/fund-compare-period-returns-chart"
import { FundCompareMonthlyReturnsTable } from "@/components/ma/fund-compare-monthly-returns-table"
import { FundCompareMultidimChart } from "@/components/ma/fund-compare-multidim-chart"
import { FundCompareDrawdownChart } from "@/components/ma/fund-compare-drawdown-chart"
import { FundCompareAnnualTable } from "@/components/ma/fund-compare-annual-table"
import { FundCompareWinRateTable } from "@/components/ma/fund-compare-win-rate-table"
import { FundCompareReturnScatterChart } from "@/components/ma/fund-compare-return-scatter-chart"
import { FundCompareConditionalProbTable } from "@/components/ma/fund-compare-conditional-prob-table"
import { FundCompareCorrelationTable } from "@/components/ma/fund-compare-correlation-table"
import { FundCompareRollingChart } from "@/components/ma/fund-compare-rolling-chart"
import { FundCompareCorrelationMatrix } from "@/components/ma/fund-compare-correlation-matrix"
import {
  PortfolioFundPickerDialog,
  type PortfolioFundPickerItem,
} from "@/components/ma/portfolio-fund-picker-dialog"
import {
  pickerItemToCompareFund,
  saveFundCompare,
  type SavedFundCompare,
  type SavedFundCompareFund,
} from "@/lib/ma-fund-compare-storage"
import { resolveFundDisplayLabel } from "@/lib/fund-display-name"
import { DateInput } from "@/components/ui/date-input"
import {
  filterPointsByFrequency,
  type NavFrequencyFilter,
} from "@/app/ma/dashboard/private-funds/[beian_hao]/components/shared"
import {
  dateToUtcTs,
  echartsTimeXAxis,
  formatIsoDateFromTs,
} from "@/app/ma/dashboard/private-funds/[beian_hao]/components/performanceChartUtils"

const NAV_FREQ_OPTIONS: NavFrequencyFilter[] = ["全部", "日频", "周频", "月频"]

const LINE_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#64748b"]

const BENCHMARK_OPTIONS = [
  { key: "IF", label: "沪深300" },
  { key: "IC", label: "中证500" },
  { key: "IM", label: "中证1000" },
  { key: "", label: "不显示" },
] as const

interface CurvePoint {
  d: string
  v: number
}

interface FundSeries {
  beian_hao: string
  name: string
  returnPoints: CurvePoint[]
  navPoints: CurvePoint[]
  lastReturn: number | null
  lastNav: number | null
}

interface BenchSeries {
  returnPoints: CurvePoint[]
  navPoints: CurvePoint[]
}

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}

function subYears(dateStr: string, years: number) {
  const d = new Date(dateStr)
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

function minDate(dates: string[]) {
  return dates.filter(Boolean).sort()[0] ?? isoToday()
}

function maxDate(dates: string[]) {
  return dates.filter(Boolean).sort().at(-1) ?? isoToday()
}

function compareFundDisplayName(fund: SavedFundCompareFund): string {
  return resolveFundDisplayLabel(null, fund.product_name) || fund.product_name
}

async function fetchFundSeries(
  fund: SavedFundCompareFund,
  from: string,
  to: string,
): Promise<FundSeries> {
  const displayName = compareFundDisplayName(fund)
  const baseParams = {
    beian_hao: fund.beian_hao,
    product_name: fund.product_name,
    from,
    to,
  }
  const empty: FundSeries = {
    beian_hao: fund.beian_hao,
    name: displayName,
    returnPoints: [],
    navPoints: [],
    lastReturn: null,
    lastNav: null,
  }
  try {
    const [returnRes, navRes] = await Promise.all([
      fetch(`/ma/api/tracking-funds/chart-preview?${new URLSearchParams({ ...baseParams, mode: "return" })}`),
      fetch(`/ma/api/tracking-funds/chart-preview?${new URLSearchParams({ ...baseParams, mode: "nav" })}`),
    ])
    const returnJson = returnRes.ok ? await returnRes.json() as { fund?: CurvePoint[] } : { fund: [] }
    const navJson = navRes.ok ? await navRes.json() as { fund?: CurvePoint[] } : { fund: [] }
    const returnPoints = Array.isArray(returnJson.fund) ? returnJson.fund : []
    const navPoints = Array.isArray(navJson.fund) ? navJson.fund : []
    return {
      beian_hao: fund.beian_hao,
      name: displayName,
      returnPoints,
      navPoints,
      lastReturn: returnPoints.at(-1)?.v ?? null,
      lastNav: navPoints.at(-1)?.v ?? null,
    }
  } catch {
    return empty
  }
}

async function fetchBenchmarkSeries(from: string, to: string, key: string): Promise<BenchSeries> {
  if (!key) return { returnPoints: [], navPoints: [] }
  const params = new URLSearchParams({ key, from, to })
  try {
    const res = await fetch(`/ma/api/private-funds/benchmark?${params}`)
    if (!res.ok) return { returnPoints: [], navPoints: [] }
    const json = await res.json() as { ok?: boolean; data?: { date: string; value: number }[] }
    const rows = Array.isArray(json.data) ? json.data : []
    if (rows.length === 0) return { returnPoints: [], navPoints: [] }
    const navPoints = rows.map((row) => ({
      d: row.date.slice(0, 10),
      v: parseFloat(Number(row.value).toFixed(4)),
    }))
    const first = rows[0].value
    const returnPoints = Number.isFinite(first) && first > 0
      ? rows.map((row) => ({
          d: row.date.slice(0, 10),
          v: parseFloat((((row.value / first) - 1) * 100).toFixed(4)),
        }))
      : []
    return { returnPoints, navPoints }
  } catch {
    return { returnPoints: [], navPoints: [] }
  }
}

function alignReturnSeriesStart(seriesList: FundSeries[], alignStart: boolean): FundSeries[] {
  if (!alignStart || seriesList.length === 0) return seriesList
  const latestStart = seriesList.reduce((max, s) => {
    const start = s.returnPoints[0]?.d ?? ""
    return start > max ? start : max
  }, "")
  if (!latestStart) return seriesList
  return seriesList.map((s) => {
    const filtered = s.returnPoints.filter((p) => p.d >= latestStart)
    if (filtered.length === 0) return { ...s, returnPoints: [], lastReturn: null }
    const base = filtered[0].v
    const rebased = filtered.map((p) => ({
      d: p.d,
      v: parseFloat((p.v - base).toFixed(4)),
    }))
    return { ...s, returnPoints: rebased, lastReturn: rebased.at(-1)?.v ?? null }
  })
}

function alignNavSeriesStart(seriesList: FundSeries[], alignStart: boolean): FundSeries[] {
  if (!alignStart || seriesList.length === 0) return seriesList
  const latestStart = seriesList.reduce((max, s) => {
    const start = s.navPoints[0]?.d ?? ""
    return start > max ? start : max
  }, "")
  if (!latestStart) return seriesList
  return seriesList.map((s) => {
    const filtered = s.navPoints.filter((p) => p.d >= latestStart)
    return {
      ...s,
      navPoints: filtered,
      lastNav: filtered.at(-1)?.v ?? null,
    }
  })
}

function earliestFundStartDate(seriesList: FundSeries[], isNavMode: boolean): string {
  let min = ""
  for (const s of seriesList) {
    const d = (isNavMode ? s.navPoints[0]?.d : s.returnPoints[0]?.d)
      || s.navPoints[0]?.d
      || s.returnPoints[0]?.d
    if (d && (!min || d < min)) min = d
  }
  return min
}

function rebaseReturnFromNav(navPoints: CurvePoint[]): CurvePoint[] {
  const base = navPoints.find((p) => Number.isFinite(p.v) && p.v > 0)?.v
  if (base == null) return []
  return navPoints.map((p) => ({
    d: p.d,
    v: parseFloat((((p.v / base) - 1) * 100).toFixed(4)),
  }))
}

function clipAndRebaseBenchmark(bench: BenchSeries, startDate: string): BenchSeries {
  if (!startDate) return bench
  const navPoints = bench.navPoints.filter((p) => p.d >= startDate)
  if (navPoints.length > 0) {
    return { navPoints, returnPoints: rebaseReturnFromNav(navPoints) }
  }
  const clipped = bench.returnPoints.filter((p) => p.d >= startDate)
  const base = clipped[0]
  if (!base) return { returnPoints: [], navPoints: [] }
  const denom = 1 + base.v / 100
  const returnPoints = Number.isFinite(denom) && denom !== 0
    ? clipped.map((p) => ({
        d: p.d,
        v: parseFloat((((1 + p.v / 100) / denom - 1) * 100).toFixed(4)),
      }))
    : clipped.map((p) => ({ d: p.d, v: parseFloat((p.v - base.v).toFixed(4)) }))
  return { returnPoints, navPoints: [] }
}

function resampleSeries(series: FundSeries, freq: NavFrequencyFilter): FundSeries {
  const returnPoints = filterPointsByFrequency(series.returnPoints, freq)
  const navPoints = filterPointsByFrequency(series.navPoints, freq)
  return {
    ...series,
    returnPoints,
    navPoints,
    lastReturn: returnPoints.at(-1)?.v ?? null,
    lastNav: navPoints.at(-1)?.v ?? null,
  }
}

export function FundCompareDetailView({
  compare: initialCompare,
}: {
  compare: SavedFundCompare
}) {
  const [compare, setCompare] = useState(initialCompare)
  const [showFundPicker, setShowFundPicker] = useState(false)
  const [chartMode, setChartMode] = useState<"return" | "nav">("return")
  const [filterPeriod, setFilterPeriod] = useState("近一年")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [filterBench, setFilterBench] = useState<(typeof BENCHMARK_OPTIONS)[number]["key"]>("IF")
  const [filterFreq, setFilterFreq] = useState<NavFrequencyFilter>("日频")
  const [alignStart, setAlignStart] = useState(true)
  const [appliedFrom, setAppliedFrom] = useState("")
  const [appliedTo, setAppliedTo] = useState("")
  const [appliedBench, setAppliedBench] = useState<(typeof BENCHMARK_OPTIONS)[number]["key"]>("IF")
  const [appliedAlignStart, setAppliedAlignStart] = useState(true)
  const [fundSeries, setFundSeries] = useState<FundSeries[]>([])
  const [benchSeries, setBenchSeries] = useState<BenchSeries>({ returnPoints: [], navPoints: [] })
  const [visibleFunds, setVisibleFunds] = useState<Set<string>>(() => new Set(initialCompare.funds.map((f) => f.beian_hao)))
  const [loading, setLoading] = useState(false)
  const [analyzed, setAnalyzed] = useState(false)

  const defaultTo = useMemo(
    () => maxDate(compare.funds.map((f) => f.latest_nav_date ?? "")),
    [compare.funds],
  )
  const defaultFrom = useMemo(
    () => subYears(defaultTo, 1),
    [defaultTo],
  )

  useEffect(() => {
    setFilterFrom(defaultFrom)
    setFilterTo(defaultTo)
    setAppliedFrom(defaultFrom)
    setAppliedTo(defaultTo)
  }, [defaultFrom, defaultTo])

  useEffect(() => {
    setVisibleFunds(new Set(compare.funds.map((f) => f.beian_hao)))
  }, [compare.funds])

  const persistCompare = useCallback((next: SavedFundCompare) => {
    const updated = { ...next, updatedAt: new Date().toISOString() }
    setCompare(updated)
    saveFundCompare(updated)
  }, [])

  function applyPeriod(period: string) {
    setFilterPeriod(period)
    const to = filterTo || defaultTo
    let from = defaultFrom
    if (period === "近一年") from = subYears(to, 1)
    else if (period === "近六月") {
      const d = new Date(to)
      d.setMonth(d.getMonth() - 6)
      from = d.toISOString().slice(0, 10)
    } else if (period === "成立以来") {
      from = minDate(compare.funds.map((f) => f.nav_start_date ?? f.inception_date ?? ""))
    }
    setFilterFrom(from)
    setFilterTo(to)
  }

  async function runAnalysis() {
    if (compare.funds.length === 0) return
    setLoading(true)
    const from = filterFrom || defaultFrom
    const to = filterTo || defaultTo
    setAppliedFrom(from)
    setAppliedTo(to)
    setAppliedBench(filterBench)
    setAppliedAlignStart(alignStart)

    const series = await Promise.all(compare.funds.map((f) => fetchFundSeries(f, from, to)))
    const alignedFunds = alignNavSeriesStart(
      alignReturnSeriesStart(series, alignStart),
      alignStart,
    )
    setFundSeries(alignedFunds)
    const rawBench = await fetchBenchmarkSeries(from, to, filterBench)
    const fundStart = earliestFundStartDate(alignedFunds, false)
    setBenchSeries(fundStart ? clipAndRebaseBenchmark(rawBench, fundStart) : rawBench)
    setAnalyzed(true)
    setLoading(false)
  }

  function handleReset() {
    setFilterPeriod("近一年")
    setFilterFrom(defaultFrom)
    setFilterTo(defaultTo)
    setFilterBench("IF")
    setFilterFreq("日频")
    setAlignStart(true)
    setAppliedFrom(defaultFrom)
    setAppliedTo(defaultTo)
    setAppliedBench("IF")
    setAppliedAlignStart(true)
    void runAnalysis()
  }

  useEffect(() => {
    void runAnalysis()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleAddFunds(items: PortfolioFundPickerItem[]) {
    const existing = new Set(compare.funds.map((f) => f.beian_hao))
    const added = items.filter((item) => !existing.has(item.beian_hao)).map(pickerItemToCompareFund)
    if (added.length === 0) return
    persistCompare({ ...compare, funds: [...compare.funds, ...added] })
    setShowFundPicker(false)
  }

  function handleRemoveFund(beianHao: string) {
    persistCompare({ ...compare, funds: compare.funds.filter((f) => f.beian_hao !== beianHao) })
  }

  function toggleFundVisibility(beianHao: string) {
    setVisibleFunds((prev) => {
      const next = new Set(prev)
      if (next.has(beianHao)) next.delete(beianHao)
      else next.add(beianHao)
      return next
    })
  }

  const activeSeries = fundSeries.filter((s) => visibleFunds.has(s.beian_hao))

  function toggleAllFunds(selectAll: boolean) {
    setVisibleFunds(selectAll ? new Set(compare.funds.map((f) => f.beian_hao)) : new Set())
  }

  function invertFundSelection() {
    setVisibleFunds((prev) => {
      const next = new Set<string>()
      for (const f of compare.funds) {
        if (!prev.has(f.beian_hao)) next.add(f.beian_hao)
      }
      return next
    })
  }

  const benchLabel = `${BENCHMARK_OPTIONS.find((b) => b.key === appliedBench)?.label ?? "基准"}(基准)`

  const alignedChartBench = useMemo(() => {
    const isNavMode = chartMode === "nav"
    const displaySeries = activeSeries.map((s) => resampleSeries(s, filterFreq))
    const displayBench = {
      returnPoints: filterPointsByFrequency(benchSeries.returnPoints, filterFreq),
      navPoints: filterPointsByFrequency(benchSeries.navPoints, filterFreq),
    }
    const fundStart = earliestFundStartDate(displaySeries, isNavMode)
    return fundStart ? clipAndRebaseBenchmark(displayBench, fundStart) : displayBench
  }, [activeSeries, benchSeries, chartMode, filterFreq])

  const chartOption = useMemo(() => {
    const isNavMode = chartMode === "nav"
    const displaySeries = activeSeries.map((s) => resampleSeries(s, filterFreq))
    const alignedBench = alignedChartBench

    const dates = new Set<string>()
    displaySeries.forEach((s) => {
      const pts = isNavMode ? s.navPoints : s.returnPoints
      pts.forEach((p) => dates.add(p.d))
    })
    if (appliedBench) {
      const benchPts = isNavMode ? alignedBench.navPoints : alignedBench.returnPoints
      benchPts.forEach((p) => dates.add(p.d))
    }
    const sortedDates = [...dates].sort()

    const toLineData = (pts: CurvePoint[]) =>
      pts
        .map((p) => {
          const ts = dateToUtcTs(p.d)
          return Number.isFinite(ts) ? ([ts, p.v] as [number, number]) : null
        })
        .filter((p): p is [number, number] => p != null)

    const fundEchartsSeries = displaySeries.map((s, idx) => {
      const pts = isNavMode ? s.navPoints : s.returnPoints
      const color = LINE_COLORS[idx % LINE_COLORS.length]
      return {
        name: s.name,
        type: "line" as const,
        yAxisIndex: 0,
        showSymbol: pts.length <= 60,
        symbol: "circle",
        symbolSize: 4,
        smooth: false,
        connectNulls: true,
        lineStyle: { width: 2, color },
        itemStyle: { color },
        data: toLineData(pts),
      }
    })

    const series = [...fundEchartsSeries]

    const benchPts = isNavMode ? alignedBench.navPoints : alignedBench.returnPoints
    if (appliedBench && benchPts.length > 0) {
      series.push({
        name: benchLabel,
        type: "line" as const,
        yAxisIndex: isNavMode ? 1 : 0,
        showSymbol: benchPts.length <= 60,
        symbol: "circle",
        symbolSize: 4,
        smooth: false,
        connectNulls: true,
        lineStyle: { width: 2, color: "#60a5fa" },
        itemStyle: { color: "#60a5fa" },
        data: toLineData(benchPts),
      })
    }

    return {
      useUTC: true,
      animation: false,
      grid: { left: 56, right: isNavMode ? 64 : 24, top: 24, bottom: 72 },
      dataZoom: [
        { type: "inside" as const, xAxisIndex: 0, filterMode: "none" as const },
        {
          type: "slider" as const,
          xAxisIndex: 0,
          height: 18,
          bottom: 8,
          filterMode: "none" as const,
          borderColor: "transparent",
          fillerColor: "rgba(239,68,68,0.12)",
          handleStyle: { color: "#ef4444" },
          moveHandleStyle: { color: "#fca5a5" },
          textStyle: { fontSize: 10, color: "#a1a1aa" },
          dataBackground: {
            lineStyle: { color: "#94a3b8" },
            areaStyle: { color: "rgba(148,163,184,0.08)" },
          },
        },
      ],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line", snap: true },
        formatter: (params: unknown) => {
          if (!Array.isArray(params) || params.length === 0) return ""
          const first = params[0] as { axisValue?: string | number; data?: [number, number] }
          const date = typeof first.axisValue === "number"
            ? formatIsoDateFromTs(first.axisValue)
            : String(first.axisValue ?? "").slice(0, 10)
          const lines = params.map((item) => {
            const p = item as { seriesName?: string; value?: number | [number, number | null] | null }
            const raw = Array.isArray(p.value) ? p.value[1] : p.value
            if (raw == null || !Number.isFinite(raw)) return `${p.seriesName}: —`
            const val = isNavMode
              ? Number(raw).toFixed(4)
              : `${Number(raw).toFixed(2)}%`
            return `${p.seriesName}: ${val}`
          })
          return [date, ...lines].join("<br/>")
        },
      },
      legend: { show: false },
      xAxis: echartsTimeXAxis(sortedDates),
      yAxis: isNavMode
        ? [
            {
              type: "value",
              name: "净值",
              scale: true,
              axisLabel: {
                formatter: (v: number) => Number(v).toFixed(2),
                fontSize: 10,
                color: "#71717a",
              },
              splitLine: { lineStyle: { color: "#f4f4f5" } },
            },
            {
              type: "value",
              name: "指数点位",
              scale: true,
              axisLabel: {
                formatter: (v: number) => Number(v).toFixed(0),
                fontSize: 10,
                color: "#71717a",
              },
              splitLine: { show: false },
            },
          ]
        : {
            type: "value",
            name: "收益率(%)",
            axisLabel: {
              formatter: (v: number) => `${v}%`,
              fontSize: 10,
              color: "#71717a",
            },
            splitLine: { lineStyle: { color: "#f4f4f5" } },
          },
      series,
    }
  }, [activeSeries, alignedChartBench, appliedBench, chartMode, benchLabel, filterFreq])

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
        <h1 className="text-base font-semibold text-foreground">基金对比栏</h1>
        <div className="flex items-center gap-2">
          <button type="button" className="p-2 rounded hover:bg-muted text-muted-foreground" title="截图">
            <Camera className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowFundPicker(true)}
            className="p-2 rounded hover:bg-muted text-muted-foreground"
            title="添加基金"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => persistCompare(compare)}
            className="p-2 rounded hover:bg-muted text-muted-foreground"
            title="保存"
          >
            <Save className="h-4 w-4" />
          </button>
        </div>
      </div>

      <FundCompareFundTable
        funds={compare.funds}
        onRemove={handleRemoveFund}
      />

      <div className="px-6 py-3 border-y bg-zinc-50 flex flex-wrap items-center gap-3 text-xs flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">统计区间：</span>
          <select
            value={filterPeriod}
            onChange={(e) => applyPeriod(e.target.value)}
            className="border rounded px-2 py-1 bg-white"
          >
            {["近一年", "近六月", "成立以来", "自定义"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <DateInput
          value={filterFrom}
          onChange={(value) => { setFilterFrom(value); setFilterPeriod("自定义") }}
          placeholder="开始日期"
          className="w-[148px]"
          inputClassName="h-7 rounded px-2 pr-8 text-xs bg-white"
          displayClassName="left-2 text-xs"
        />
        <span className="text-zinc-400">～</span>
        <DateInput
          value={filterTo}
          onChange={(value) => { setFilterTo(value); setFilterPeriod("自定义") }}
          placeholder="结束日期"
          className="w-[148px]"
          inputClassName="h-7 rounded px-2 pr-8 text-xs bg-white"
          displayClassName="left-2 text-xs"
        />
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">净值频率：</span>
          <select
            value={filterFreq}
            onChange={(e) => setFilterFreq(e.target.value as NavFrequencyFilter)}
            className="border rounded px-2 py-1 bg-white"
          >
            {NAV_FREQ_OPTIONS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">业绩基准：</span>
          <select
            value={filterBench}
            onChange={(e) => setFilterBench(e.target.value as typeof filterBench)}
            className="border rounded px-2 py-1 bg-white min-w-[100px]"
          >
            {BENCHMARK_OPTIONS.map((o) => <option key={o.key || "none"} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={alignStart} onChange={(e) => setAlignStart(e.target.checked)} />
          <span className="text-zinc-600">起点对齐</span>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={handleReset} className="px-3 py-1.5 rounded border border-red-500 text-red-500 hover:bg-red-50">
            重置
          </button>
          <button
            type="button"
            onClick={() => void runAnalysis()}
            disabled={loading || compare.funds.length === 0}
            className="px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-40"
          >
            {loading ? "分析中…" : "开始分析"}
          </button>
        </div>
      </div>

      <div className="px-6 py-5 flex-shrink-0">
        <div className="rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h3 className="text-sm font-semibold text-foreground">收益对比</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => toggleAllFunds(true)}
                className="px-2.5 py-1 rounded text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
              >
                全选
              </button>
              <button
                type="button"
                onClick={invertFundSelection}
                className="px-2.5 py-1 rounded text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
              >
                反选
              </button>
              <button
                type="button"
                onClick={() => setChartMode("return")}
                className={[
                  "px-3 py-1 rounded text-xs border transition-colors",
                  chartMode === "return" ? "border-red-500 text-red-500 bg-red-50" : "border-border text-muted-foreground",
                ].join(" ")}
              >
                收益对比
              </button>
              <button
                type="button"
                onClick={() => setChartMode("nav")}
                className={[
                  "px-3 py-1 rounded text-xs border transition-colors",
                  chartMode === "nav" ? "border-red-500 text-red-500 bg-red-50" : "border-border text-muted-foreground",
                ].join(" ")}
              >
                净值对比
              </button>
            </div>
          </div>
          {appliedFrom && appliedTo && (
            <div className="text-right text-xs text-muted-foreground tabular-nums mb-3">{appliedFrom} ~ {appliedTo}</div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-2 mb-4">
            {fundSeries.map((s, idx) => {
              const visible = visibleFunds.has(s.beian_hao)
              const color = LINE_COLORS[idx % LINE_COLORS.length]
              const isNavMode = chartMode === "nav"
              const ret = s.lastReturn
              const nav = s.lastNav
              return (
                <button
                  key={s.beian_hao}
                  type="button"
                  onClick={() => toggleFundVisibility(s.beian_hao)}
                  className={[
                    "inline-flex items-center gap-2 text-xs transition-opacity",
                    visible ? "opacity-100" : "opacity-40",
                  ].join(" ")}
                >
                  <span className="w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
                  <span className="text-zinc-700 max-w-[180px] truncate" title={s.name}>{s.name}</span>
                  {isNavMode ? (
                    nav != null && <span className="text-zinc-600 tabular-nums">{nav.toFixed(4)}</span>
                  ) : ret != null && (
                    <span className={[ret >= 0 ? "text-red-500" : "text-green-500", "tabular-nums"].join(" ")}>
                      {ret >= 0 ? "+" : ""}{ret.toFixed(2)}%
                    </span>
                  )}
                </button>
              )
            })}
            {appliedBench && (chartMode === "nav" ? alignedChartBench.navPoints : alignedChartBench.returnPoints).length > 0 && (
              <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
                <span className="w-3 h-0.5 rounded bg-sky-400" />
                {benchLabel}
                {chartMode === "nav" ? (
                  alignedChartBench.navPoints.at(-1)?.v != null && (
                    <span className="tabular-nums">{alignedChartBench.navPoints.at(-1)!.v.toFixed(4)}</span>
                  )
                ) : alignedChartBench.returnPoints.at(-1)?.v != null && (
                  <span className="tabular-nums">
                    {alignedChartBench.returnPoints.at(-1)!.v >= 0 ? "+" : ""}{alignedChartBench.returnPoints.at(-1)!.v.toFixed(2)}%
                  </span>
                )}
              </span>
            )}
          </div>

          {!analyzed ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">
              点击「开始分析」查看收益对比
            </div>
          ) : activeSeries.every((s) => (chartMode === "nav" ? s.navPoints : s.returnPoints).length === 0) ? (
            <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">
              暂无足够净值数据
            </div>
          ) : (
            <div className="h-[392px] w-full overflow-hidden">
              <ReactECharts option={chartOption} style={{ height: 392, width: "100%" }} notMerge lazyUpdate />
            </div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0">
        <FundCompareMetricsTable
        analyzed={analyzed}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            returnPoints: s.returnPoints,
          }))}
        benchmark={
          appliedBench && benchSeries.returnPoints.length > 0
            ? {
                key: appliedBench,
                label: benchLabel.replace("(基准)", ""),
                returnPoints: benchSeries.returnPoints,
              }
            : null
        }
        />
      </div>

      <FundCompareIntervalMetricsTable
        analyzed={analyzed}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
          }))}
        benchmarkKey={appliedBench}
      />

      <FundComparePeriodReturnsChart
        analyzed={analyzed}
        fromDate={appliedFrom}
        toDate={appliedTo}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            navPoints: s.navPoints,
          }))}
        benchmark={
          appliedBench && benchSeries.navPoints.length > 0
            ? {
                key: appliedBench,
                label: BENCHMARK_OPTIONS.find((b) => b.key === appliedBench)?.label ?? "基准",
                navPoints: benchSeries.navPoints,
              }
            : null
        }
      />

      <FundCompareMonthlyReturnsTable
        analyzed={analyzed}
        fromDate={appliedFrom}
        toDate={appliedTo}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            navPoints: s.navPoints,
          }))}
      />

      <FundCompareMultidimChart
        analyzed={analyzed}
        appliedFrom={appliedFrom}
        appliedTo={appliedTo}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            returnPoints: s.returnPoints,
          }))}
      />

      <FundCompareDrawdownChart
        analyzed={analyzed}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            returnPoints: s.returnPoints,
          }))}
        benchmark={
          appliedBench && benchSeries.returnPoints.length > 0
            ? {
                key: appliedBench,
                label: BENCHMARK_OPTIONS.find((b) => b.key === appliedBench)?.label ?? "基准",
                returnPoints: benchSeries.returnPoints,
              }
            : null
        }
      />

      <FundCompareAnnualTable
        analyzed={analyzed}
        appliedFrom={appliedFrom}
        appliedTo={appliedTo}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            returnPoints: s.returnPoints,
          }))}
        benchmark={
          appliedBench && benchSeries.returnPoints.length > 0
            ? {
                key: appliedBench,
                label: BENCHMARK_OPTIONS.find((b) => b.key === appliedBench)?.label ?? "基准",
                returnPoints: benchSeries.returnPoints,
              }
            : null
        }
      />

      <FundCompareWinRateTable
        analyzed={analyzed}
        appliedFrom={appliedFrom}
        appliedTo={appliedTo}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            navPoints: s.navPoints,
          }))}
        benchmark={
          appliedBench && benchSeries.navPoints.length > 0
            ? {
                key: appliedBench,
                label: BENCHMARK_OPTIONS.find((b) => b.key === appliedBench)?.label ?? "基准",
                returnPoints: benchSeries.navPoints,
              }
            : null
        }
      />

      <FundCompareReturnScatterChart
        analyzed={analyzed}
        appliedFrom={appliedFrom}
        appliedTo={appliedTo}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            navPoints: s.navPoints,
          }))}
        benchmark={
          appliedBench && benchSeries.navPoints.length > 0
            ? {
                key: appliedBench,
                label: BENCHMARK_OPTIONS.find((b) => b.key === appliedBench)?.label ?? "基准",
                navPoints: benchSeries.navPoints,
              }
            : null
        }
      />

      <FundCompareConditionalProbTable
        analyzed={analyzed}
        appliedFrom={appliedFrom}
        appliedTo={appliedTo}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            navPoints: s.navPoints,
          }))}
        benchmark={
          appliedBench && benchSeries.navPoints.length > 0
            ? {
                label: BENCHMARK_OPTIONS.find((b) => b.key === appliedBench)?.label ?? "基准",
                navPoints: benchSeries.navPoints,
              }
            : null
        }
      />

      <FundCompareCorrelationTable
        analyzed={analyzed}
        appliedTo={appliedTo}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            navPoints: s.navPoints,
          }))}
        benchmark={
          appliedBench && benchSeries.navPoints.length > 0
            ? {
                label: BENCHMARK_OPTIONS.find((b) => b.key === appliedBench)?.label ?? "基准",
                navPoints: benchSeries.navPoints,
              }
            : null
        }
      />

      <FundCompareRollingChart
        analyzed={analyzed}
        appliedFrom={appliedFrom}
        appliedTo={appliedTo}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            navPoints: s.navPoints,
          }))}
        benchmark={
          appliedBench && benchSeries.navPoints.length > 0
            ? {
                label: BENCHMARK_OPTIONS.find((b) => b.key === appliedBench)?.label ?? "基准",
                navPoints: benchSeries.navPoints,
              }
            : null
        }
      />

      <FundCompareCorrelationMatrix
        analyzed={analyzed}
        appliedFrom={appliedFrom}
        appliedTo={appliedTo}
        funds={fundSeries
          .filter((s) => visibleFunds.has(s.beian_hao))
          .map((s) => ({
            beian_hao: s.beian_hao,
            name: s.name,
            navPoints: s.navPoints,
          }))}
        benchmark={
          appliedBench && benchSeries.navPoints.length > 0
            ? {
                key: appliedBench,
                label: BENCHMARK_OPTIONS.find((b) => b.key === appliedBench)?.label ?? "基准",
                navPoints: benchSeries.navPoints,
              }
            : null
        }
      />

      <PortfolioFundPickerDialog
        open={showFundPicker}
        title="选择"
        onClose={() => setShowFundPicker(false)}
        onConfirm={handleAddFunds}
        existingIds={compare.funds.map((f) => f.beian_hao)}
      />
    </div>
  )
}
