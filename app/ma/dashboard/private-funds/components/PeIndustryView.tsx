"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { BarChart2, Building2, ChevronDown, Coins, TableIcon, Timer } from "lucide-react"
import {
  formatPeIndustryMonthLabel,
  formatPeIndustryNumber,
  peIndustryRowsForGranularity,
  type PeIndustryGranularity,
  type PeIndustryManagerScaleChange,
  type PeIndustryMonthRow,
  type PeIndustryRegionRow,
  type PeIndustryScaleTrendPoint,
  type PeIndustrySummary,
} from "@/lib/pe-industry-data"
import { PeIndustryManagerScaleSection } from "./PeIndustryManagerScaleSection"
import { PeIndustryRegionSection } from "./PeIndustryRegionSection"

const GRANULARITY_OPTIONS: { key: PeIndustryGranularity; label: string }[] = [
  { key: "month", label: "月度" },
  { key: "quarter", label: "季度" },
  { key: "year", label: "年度" },
]

const RED = "#D93025"
const BLUE = "#1A73E8"

function KpiCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Coins
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-zinc-100 bg-white px-5 py-4 min-w-0 flex-1">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-zinc-500 truncate">{label}</div>
        <div className="text-2xl font-semibold tabular-nums text-zinc-900 mt-0.5">{value}</div>
      </div>
    </div>
  )
}

function DataTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string; format?: (v: number) => string }[]
  rows: Record<string, string | number>[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr className="bg-zinc-50 text-zinc-500">
            {columns.map((col) => (
              <th key={col.key} className="px-3 py-2 text-center font-medium border-b border-zinc-100 whitespace-nowrap">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.period)} className={index % 2 === 1 ? "bg-zinc-50/60" : "bg-white"}>
              {columns.map((col) => (
                <td key={col.key} className="px-3 py-1.5 text-center tabular-nums border-b border-zinc-50 whitespace-nowrap text-zinc-700">
                  {typeof row[col.key] === "number" && col.format
                    ? col.format(row[col.key] as number)
                    : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChartPanel({
  title,
  granularity,
  onGranularityChange,
  viewMode,
  onViewModeChange,
  chartOption,
  tableColumns,
  tableRows,
  height = 280,
  updatedAt,
  showGranularity = true,
}: {
  title: string
  granularity?: PeIndustryGranularity
  onGranularityChange?: (g: PeIndustryGranularity) => void
  viewMode: "chart" | "table"
  onViewModeChange: (mode: "chart" | "table") => void
  chartOption: Record<string, unknown>
  tableColumns: { key: string; label: string; format?: (v: number) => string }[]
  tableRows: Record<string, string | number>[]
  height?: number
  updatedAt?: string
  showGranularity?: boolean
}) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 min-w-0">
          <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
          <span className="truncate">{title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {updatedAt && (
            <span className="text-xs text-zinc-400">更新日期：{updatedAt}</span>
          )}
          {showGranularity && granularity && onGranularityChange && (
            <div className="relative">
              <select
                value={granularity}
                onChange={(e) => onGranularityChange(e.target.value as PeIndustryGranularity)}
                className="appearance-none h-7 pl-2.5 pr-7 rounded border border-zinc-200 bg-white text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-red-200"
              >
                {GRANULARITY_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            </div>
          )}
          <button
            type="button"
            onClick={() => onViewModeChange(viewMode === "chart" ? "table" : "chart")}
            className={[
              "inline-flex items-center justify-center h-7 w-7 rounded border transition-colors",
              viewMode === "table"
                ? "border-red-500 bg-red-50 text-red-600"
                : "border-zinc-200 text-zinc-500 hover:bg-zinc-50",
            ].join(" ")}
            title={viewMode === "chart" ? "切换表格" : "切换图表"}
          >
            {viewMode === "chart" ? <TableIcon className="h-3.5 w-3.5" /> : <BarChart2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {viewMode === "chart" ? (
        <ReactECharts option={chartOption} style={{ height, width: "100%" }} notMerge lazyUpdate />
      ) : (
        <DataTable columns={tableColumns} rows={tableRows} />
      )}
    </div>
  )
}

function buildComboOption(
  rows: PeIndustryMonthRow[],
  granularity: PeIndustryGranularity,
  barKey: "newFilingCount" | "stockFundCount",
  lineKey: "newFilingScale" | "stockFundScale",
  barLabel: string,
  lineLabel: string,
): Record<string, unknown> {
  const labels = rows.map((r) => formatPeIndustryMonthLabel(r.month, granularity))
  const barData = rows.map((r) => r[barKey])
  const lineData = rows.map((r) => r[lineKey])
  const barMax = Math.max(...barData) * 1.15
  const lineMax = Math.max(...lineData) * 1.08

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    legend: {
      top: 0,
      left: 0,
      textStyle: { fontSize: 11, color: "#52525b" },
      itemWidth: 10,
      itemHeight: 10,
    },
    grid: { left: 52, right: 52, top: 36, bottom: 28 },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: "value",
        max: Math.ceil(barMax / 1000) * 1000 || undefined,
        axisLabel: { fontSize: 11, color: "#a1a1aa" },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
      },
      {
        type: "value",
        max: Math.ceil(lineMax / 1000) * 1000 || undefined,
        axisLabel: { fontSize: 11, color: "#a1a1aa" },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: barLabel,
        type: "bar",
        barMaxWidth: 18,
        itemStyle: { color: RED },
        data: barData,
      },
      {
        name: lineLabel,
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2, color: BLUE },
        itemStyle: { color: BLUE },
        data: lineData,
      },
    ],
  }
}

function buildBarOption(
  rows: PeIndustryMonthRow[],
  granularity: PeIndustryGranularity,
  valueKey: "newManagerCount" | "stockManagerCount" | "liquidationCount" | "deregisteredManagerCount",
  seriesLabel: string,
): Record<string, unknown> {
  const labels = rows.map((r) => formatPeIndustryMonthLabel(r.month, granularity))
  const data = rows.map((r) => r[valueKey])
  const max = Math.max(...data) * 1.2

  let yMax: number | undefined
  if (valueKey === "newManagerCount") yMax = Math.max(10, Math.ceil(max))
  else if (valueKey === "deregisteredManagerCount") yMax = Math.max(80, Math.ceil(max / 10) * 10)
  else if (valueKey === "liquidationCount") yMax = Math.ceil(max / 500) * 500
  else yMax = Math.ceil(max / 100) * 100

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: {
      top: 0,
      left: 0,
      textStyle: { fontSize: 11, color: "#52525b" },
      itemWidth: 10,
      itemHeight: 10,
    },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      max: yMax,
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
    },
    series: [
      {
        name: seriesLabel,
        type: "bar",
        barMaxWidth: 18,
        itemStyle: { color: RED },
        data,
      },
    ],
  }
}

function buildCategoryBarOption(
  labels: string[],
  data: number[],
  seriesLabel: string,
): Record<string, unknown> {
  const max = Math.max(...data) * 1.15
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: {
      top: 0,
      left: 0,
      textStyle: { fontSize: 11, color: "#52525b" },
      itemWidth: 10,
      itemHeight: 10,
    },
    grid: { left: 48, right: 16, top: 36, bottom: 36 },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { fontSize: 11, color: "#a1a1aa", interval: 0 },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      max: Math.ceil(max / 1000) * 1000,
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
    },
    series: [
      {
        name: seriesLabel,
        type: "bar",
        barMaxWidth: 36,
        itemStyle: { color: RED },
        data,
      },
    ],
  }
}

export function PeIndustryView() {
  const [granularity, setGranularity] = useState<PeIndustryGranularity>("month")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<PeIndustrySummary | null>(null)
  const [monthly, setMonthly] = useState<PeIndustryMonthRow[]>([])
  const [scaleDist, setScaleDist] = useState<{ updatedAt: string; buckets: { label: string; count: number }[] }>({
    updatedAt: "",
    buckets: [],
  })
  const [scaleTrend, setScaleTrend] = useState<PeIndustryScaleTrendPoint[]>([])
  const [scaleChanges, setScaleChanges] = useState<{ updatedAt: string; rows: PeIndustryManagerScaleChange[] }>({
    updatedAt: "",
    rows: [],
  })
  const [regionDonut, setRegionDonut] = useState<Array<{ name: string; value: number; color: string }>>([])
  const [regionTable, setRegionTable] = useState<PeIndustryRegionRow[]>([])
  const [viewModes, setViewModes] = useState({
    newFiling: "chart" as "chart" | "table",
    newManager: "chart" as "chart" | "table",
    stockFund: "chart" as "chart" | "table",
    stockManager: "chart" as "chart" | "table",
    liquidation: "chart" as "chart" | "table",
    deregistered: "chart" as "chart" | "table",
    scaleDist: "chart" as "chart" | "table",
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch("/ma/api/pe-industry", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok || !body.ok) {
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        if (cancelled) return
        setSummary(body.summary)
        setMonthly(body.monthly ?? [])
        setScaleDist(body.managerScaleDist ?? { updatedAt: "", buckets: [] })
        setScaleTrend(body.scaleTrend ?? [])
        setScaleChanges(body.scaleChanges ?? { updatedAt: "", rows: [] })
        setRegionDonut(body.regionDonut ?? [])
        setRegionTable(body.regionTable ?? [])
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const chartMonthly = useMemo(
    () => monthly.slice(-12),
    [monthly],
  )

  const rows = useMemo(
    () => peIndustryRowsForGranularity(chartMonthly, granularity),
    [chartMonthly, granularity],
  )

  const periodRows = useMemo(
    () => rows.map((r) => ({ period: formatPeIndustryMonthLabel(r.month, granularity), ...r })),
    [rows, granularity],
  )

  const newFilingOption = useMemo(
    () => buildComboOption(rows, granularity, "newFilingCount", "newFilingScale", "备案数量", "备案规模"),
    [rows, granularity],
  )
  const stockFundOption = useMemo(
    () => buildComboOption(rows, granularity, "stockFundCount", "stockFundScale", "存量数量", "存量规模"),
    [rows, granularity],
  )
  const newManagerOption = useMemo(
    () => buildBarOption(rows, granularity, "newManagerCount", "登记数量"),
    [rows, granularity],
  )
  const stockManagerOption = useMemo(
    () => buildBarOption(rows, granularity, "stockManagerCount", "存量数量"),
    [rows, granularity],
  )
  const liquidationOption = useMemo(
    () => buildBarOption(rows, granularity, "liquidationCount", "清盘数量"),
    [rows, granularity],
  )
  const deregisteredOption = useMemo(
    () => buildBarOption(rows, granularity, "deregisteredManagerCount", "注销数量"),
    [rows, granularity],
  )
  const scaleDistOption = useMemo(
    () => buildCategoryBarOption(
      scaleDist.buckets.map((b) => b.label),
      scaleDist.buckets.map((b) => b.count),
      "数量",
    ),
    [scaleDist.buckets],
  )
  const scaleDistRows = useMemo(
    () => scaleDist.buckets.map((b) => ({ period: b.label, count: b.count })),
    [scaleDist.buckets],
  )

  function setViewMode(key: keyof typeof viewModes, mode: "chart" | "table") {
    setViewModes((prev) => ({ ...prev, [key]: mode }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
        正在加载私募行业数据…
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-6 text-sm text-red-700">
        私募行业数据加载失败：{error ?? "暂无数据"}。请确认已运行 nightly ETL 中的 pe_industry_stats 步骤。
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 -m-1">
      <div className="text-xs text-zinc-400">*数据截止日期{summary.asOf.replace("-", ".")}</div>

      <div className="grid gap-3 lg:grid-cols-3">
        <KpiCard
          icon={Coins}
          label="存量私募证券基金规模"
          value={formatPeIndustryNumber(summary.stockScale, "scale")}
        />
        <KpiCard
          icon={Timer}
          label="存量私募证券基金产品"
          value={formatPeIndustryNumber(summary.stockFundCount, "count")}
        />
        <KpiCard
          icon={Building2}
          label="存量私募证券管理人数"
          value={formatPeIndustryNumber(summary.stockManagerCount, "manager")}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel
          title="私募证券基金新增备案"
          granularity={granularity}
          onGranularityChange={setGranularity}
          viewMode={viewModes.newFiling}
          onViewModeChange={(mode) => setViewMode("newFiling", mode)}
          chartOption={newFilingOption}
          tableColumns={[
            { key: "period", label: "日期" },
            { key: "newFilingCount", label: "备案数量", format: (v) => v.toLocaleString("zh-CN") },
            { key: "newFilingScale", label: "备案规模(亿)", format: (v) => v.toFixed(2) },
          ]}
          tableRows={periodRows}
        />
        <ChartPanel
          title="私募证券管理人员新增登记数量"
          granularity={granularity}
          onGranularityChange={setGranularity}
          viewMode={viewModes.newManager}
          onViewModeChange={(mode) => setViewMode("newManager", mode)}
          chartOption={newManagerOption}
          tableColumns={[
            { key: "period", label: "日期" },
            { key: "newManagerCount", label: "登记数量", format: (v) => v.toLocaleString("zh-CN") },
          ]}
          tableRows={periodRows}
        />
        <ChartPanel
          title="私募证券基金存量统计"
          granularity={granularity}
          onGranularityChange={setGranularity}
          viewMode={viewModes.stockFund}
          onViewModeChange={(mode) => setViewMode("stockFund", mode)}
          chartOption={stockFundOption}
          tableColumns={[
            { key: "period", label: "日期" },
            { key: "stockFundCount", label: "存量数量", format: (v) => v.toLocaleString("zh-CN") },
            { key: "stockFundScale", label: "存量规模(亿)", format: (v) => v.toFixed(2) },
          ]}
          tableRows={periodRows}
        />
        <ChartPanel
          title="私募证券管理人员存量数量"
          granularity={granularity}
          onGranularityChange={setGranularity}
          viewMode={viewModes.stockManager}
          onViewModeChange={(mode) => setViewMode("stockManager", mode)}
          chartOption={stockManagerOption}
          tableColumns={[
            { key: "period", label: "日期" },
            { key: "stockManagerCount", label: "存量数量", format: (v) => v.toLocaleString("zh-CN") },
          ]}
          tableRows={periodRows}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel
          title="私募证券类基金清盘数量"
          granularity={granularity}
          onGranularityChange={setGranularity}
          viewMode={viewModes.liquidation}
          onViewModeChange={(mode) => setViewMode("liquidation", mode)}
          chartOption={liquidationOption}
          tableColumns={[
            { key: "period", label: "日期" },
            { key: "liquidationCount", label: "清盘数量(只)", format: (v) => v.toLocaleString("zh-CN") },
          ]}
          tableRows={periodRows}
        />
        <ChartPanel
          title="私募证券类管理人注销数量"
          granularity={granularity}
          onGranularityChange={setGranularity}
          viewMode={viewModes.deregistered}
          onViewModeChange={(mode) => setViewMode("deregistered", mode)}
          chartOption={deregisteredOption}
          tableColumns={[
            { key: "period", label: "日期" },
            { key: "deregisteredManagerCount", label: "注销数量(家)", format: (v) => v.toLocaleString("zh-CN") },
          ]}
          tableRows={periodRows}
        />
      </div>

      <ChartPanel
        title="最新私募证券类管理人规模分布"
        viewMode={viewModes.scaleDist}
        onViewModeChange={(mode) => setViewMode("scaleDist", mode)}
        chartOption={scaleDistOption}
        updatedAt={scaleDist.updatedAt}
        showGranularity={false}
        height={320}
        tableColumns={[
          { key: "period", label: "管理规模" },
          { key: "count", label: "数量(家)", format: (v) => v.toLocaleString("zh-CN") },
        ]}
        tableRows={scaleDistRows}
      />

      <PeIndustryManagerScaleSection scaleTrend={scaleTrend} scaleChanges={scaleChanges} />

      <PeIndustryRegionSection regionDonut={regionDonut} regionTable={regionTable} />
    </div>
  )
}
