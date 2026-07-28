"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type React from "react"
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
} from "recharts"
import { Download, Menu, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  RED,
  GREEN,
  getNavFieldValue,
  computeNavPctChange,
  type NavRow,
  type BenchmarkPoint,
} from "./shared"
import { computePeriodStats } from "./computePeriodStats"
import { DrawdownEpisodesTable, useDrawdownEpisodeRows } from "./DrawdownEpisodesTable"
import { DynamicDrawdownChart } from "./DynamicDrawdownChart"
import { DrawdownCalcHelpButton } from "./DrawdownCalcHelpButton"
import {
  buildChartDateAxisConfig,
  buildNavChartData,
  buildDrawdownChartData,
  computeNavChartYDomain,
  type NavChartPoint,
  type ReturnLabelMode,
  formatReturnTooltipLabel,
  buildBenchmarkPctChangesByDate,
} from "./performanceChartUtils"

function fmt(v: string | null, decimals = 4): string {
  if (v === null || v === undefined) return "—"
  const n = parseFloat(v)
  if (isNaN(n)) return "—"
  return n.toFixed(decimals)
}

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
  const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
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

const NavTable = memo(function NavTable({
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
})

function exportDrawdownCsv(
  data: Array<{ date: string; fundDD: number; benchDD: number | null; excessDD: number | null }>,
  showExcess: boolean,
  productName: string,
  benchmarkLabel: string,
  hasBenchmark: boolean,
  filename: string,
) {
  const escape = (v: string | null | undefined) => {
    if (v == null || v === "") return ""
    const s = String(v)
    return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
  }
  const headers = showExcess
    ? ["日期", "超额回撤(%)"]
    : hasBenchmark
      ? ["日期", `${productName}回撤(%)`, `${benchmarkLabel}回撤(%)`]
      : ["日期", `${productName}回撤(%)`]
  const lines = [
    headers.join(","),
    ...data.map((row) => {
      if (showExcess) {
        return [escape(row.date), row.excessDD === null ? "" : row.excessDD.toFixed(4)].join(",")
      }
      const cols = [escape(row.date), row.fundDD.toFixed(4)]
      if (hasBenchmark) cols.push(row.benchDD === null ? "" : row.benchDD.toFixed(4))
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
}) {
  return (
    <ResponsiveContainer width="100%" height={height} debounce={1}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.12} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.01} />
          </linearGradient>
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
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function PeriodStatisticsTable({
  productName,
  benchmarkLabel,
  hasBenchmark,
  periodStats,
  showDateRange,
  onShowDateRangeChange,
  excessByDivision,
  onExcessByDivisionChange,
}: {
  productName: string
  benchmarkLabel: string
  hasBenchmark: boolean
  periodStats: NonNullable<ReturnType<typeof computePeriodStats>>
  showDateRange: boolean
  onShowDateRangeChange: (value: boolean) => void
  excessByDivision: boolean
  onExcessByDivisionChange: (value: boolean) => void
}) {
  const { fund, bench, excess } = periodStats
  const hasBench = hasBenchmark && bench !== null
  const showExcessMetrics = excessByDivision && hasBench && excess !== null
  const dash = <span className="text-zinc-300">—</span>

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

  type StatRow = {
    label: string
    fNode: React.ReactNode
    bNode: React.ReactNode
    fInterval?: string | null
    bInterval?: string | null
  }

  const leftRows: StatRow[] = showExcessMetrics ? [
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
    { label: "区间收益", fNode: colorPct(fund.periodRet), bNode: hasBench ? colorPct(bench!.periodRet) : <span className="text-zinc-300">—</span> },
    { label: "年化收益", fNode: colorPct(fund.annRet), bNode: hasBench ? colorPct(bench!.annRet) : <span className="text-zinc-300">—</span> },
    { label: "年化波动率", fNode: pct(fund.annVol), bNode: hasBench ? pct(bench!.annVol) : "—" },
    { label: "夏普比率（Rf=2.00%）", fNode: num(fund.sharpe), bNode: hasBench ? num(bench!.sharpe) : "—" },
    { label: "卡马比率", fNode: num(fund.calmar), bNode: hasBench ? num(bench!.calmar) : "—" },
    { label: "下行风险", fNode: pct(fund.downsideRisk), bNode: hasBench ? pct(bench!.downsideRisk) : "—" },
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

  const rightRows: Array<{ label: string; fNode: React.ReactNode; bNode: React.ReactNode }> = showExcessMetrics ? [
    { label: "超额索提诺比率", fNode: num(excess!.sortino), bNode: dash },
    { label: "相关系数", fNode: num(fund.correlation), bNode: num(1) },
    { label: "信息比率", fNode: num(fund.infoRatio), bNode: dash },
    { label: "跟踪误差", fNode: pct(fund.trackingError), bNode: "0.00%" },
    { label: "Alpha", fNode: colorPct(fund.alpha !== undefined && isFinite(fund.alpha) ? fund.alpha : NaN), bNode: "0.00%" },
    { label: "Beta", fNode: num(fund.beta), bNode: "1.0000" },
    { label: "偏度", fNode: num(fund.skewness), bNode: num(bench!.skewness) },
    { label: "峰度", fNode: num(fund.kurtosis), bNode: num(bench!.kurtosis) },
    { label: "VaR（95%置信）", fNode: num(fund.var95), bNode: num(bench!.var95) },
  ] : [
    { label: "索提诺比率", fNode: num(fund.sortino), bNode: hasBench ? num(bench!.sortino) : "—" },
    { label: "相关系数", fNode: num(fund.correlation), bNode: hasBench ? num(1) : "—" },
    { label: "信息比率", fNode: num(fund.infoRatio), bNode: hasBench ? "—" : "—" },
    { label: "跟踪误差", fNode: pct(fund.trackingError), bNode: hasBench ? "0.00%" : "—" },
    { label: "Alpha", fNode: colorPct(fund.alpha !== undefined && isFinite(fund.alpha) ? fund.alpha : NaN), bNode: hasBench ? "0.00%" : "—" },
    { label: "Beta", fNode: num(fund.beta), bNode: hasBench ? "1.0000" : "—" },
    { label: "偏度", fNode: num(fund.skewness), bNode: hasBench ? num(bench!.skewness) : "—" },
    { label: "峰度", fNode: num(fund.kurtosis), bNode: hasBench ? num(bench!.kurtosis) : "—" },
    { label: "VaR（95%置信）", fNode: num(fund.var95), bNode: hasBench ? num(bench!.var95) : "—" },
  ]

  const Panel = ({ rows }: { rows: StatRow[] }) => (
    <table className="w-full">
      <thead>
        <tr>
          <THLeft>指标名称</THLeft>
          <TH>{productName}</TH>
          {hasBench && <TH>{benchmarkLabel}（基准）</TH>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.label} className={i % 2 === 1 ? "bg-zinc-50/60" : ""}>
            <TD>{row.label}</TD>
            <TD right>
              {row.fInterval !== undefined
                ? <StatCell value={row.fNode} interval={row.fInterval} />
                : row.fNode}
            </TD>
            {hasBench && (
              <TD right>
                {row.bInterval !== undefined
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
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-zinc-500 min-h-[1rem]">
          {showDateRange && <span>统计区间：{periodStats.dateRange}</span>}
        </div>
        <div className="flex items-center gap-5 text-xs text-zinc-600">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDateRange}
              onChange={(e) => onShowDateRangeChange(e.target.checked)}
              className="rounded border-zinc-300 accent-zinc-700"
            />
            显示区间
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={excessByDivision}
              onChange={(e) => onExcessByDivisionChange(e.target.checked)}
              className="rounded border-zinc-300 accent-zinc-700"
            />
            超额（除法）
          </label>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Panel rows={leftRows} />
        <Panel rows={rightRows} />
      </div>
    </div>
  )
}

export interface FundPerformanceIndicatorsPanelProps {
  productName: string
  rows: NavRow[]
  navType?: string
  benchmarkSeries: BenchmarkPoint[]
  benchmarkLabel: string
  hasBenchmark: boolean
  dateFrom: string
  dateTo: string
  navTableTitle?: string
}

export function FundPerformanceIndicatorsPanel({
  productName,
  rows,
  navType = "复权净值",
  benchmarkSeries,
  benchmarkLabel,
  hasBenchmark,
  dateFrom,
  dateTo,
  navTableTitle = "平台数据",
}: FundPerformanceIndicatorsPanelProps) {
  const [chartMode, setChartMode] = useState<"nav" | "return">("return")
  const [returnLabelMode, setReturnLabelMode] = useState<ReturnLabelMode>("cumulative")
  const [showTableBenchmarkChg, setShowTableBenchmarkChg] = useState(false)
  const [showDateRange, setShowDateRange] = useState(false)
  const [excessByDivision, setExcessByDivision] = useState(false)
  const [showDrawdownExcess, setShowDrawdownExcess] = useState(false)
  const [navChartLightboxOpen, setNavChartLightboxOpen] = useState(false)
  const [lightboxChartHeight, setLightboxChartHeight] = useState(0)

  const navChartCaptureRef = useRef<HTMLDivElement>(null)
  const drawdownChartCaptureRef = useRef<HTMLDivElement>(null)
  const navChartLightboxRef = useRef<HTMLDivElement>(null)

  const activeChartData = useMemo(
    () => buildNavChartData(rows, chartMode, navType, hasBenchmark, benchmarkSeries),
    [rows, chartMode, navType, hasBenchmark, benchmarkSeries],
  )

  const yDomain = useMemo(
    () => computeNavChartYDomain(activeChartData, chartMode),
    [activeChartData, chartMode],
  )

  const navChartShowDots = activeChartData.length <= 40
  const benchmarkChgByDate = useMemo(() => {
    if (!hasBenchmark || !benchmarkSeries.length || !rows.length) return undefined
    return buildBenchmarkPctChangesByDate(rows, benchmarkSeries)
  }, [hasBenchmark, benchmarkSeries, rows])
  const navChartXAxis = useMemo(
    () => buildChartDateAxisConfig(activeChartData.map((d) => d.date)),
    [activeChartData],
  )

  const periodStats = useMemo(
    () => computePeriodStats(rows, navType, benchmarkSeries, hasBenchmark, excessByDivision),
    [rows, navType, benchmarkSeries, hasBenchmark, excessByDivision],
  )

  const drawdownChartData = useMemo(
    () => buildDrawdownChartData(rows, navType, hasBenchmark, benchmarkSeries),
    [rows, navType, hasBenchmark, benchmarkSeries],
  )

  const maxFundDrawdown = useMemo(() => {
    if (!drawdownChartData.length) return null
    if (showDrawdownExcess) {
      const vals = drawdownChartData.map((d) => d.excessDD).filter((v): v is number => v !== null)
      return vals.length ? Math.min(...vals) : null
    }
    return Math.min(...drawdownChartData.map((d) => d.fundDD))
  }, [drawdownChartData, showDrawdownExcess])

  const drawdownEpisodes = useDrawdownEpisodeRows(rows, navType, hasBenchmark, benchmarkSeries)

  const drawdownExportName = useMemo(
    () => `${productName}_动态回撤_${new Date().toISOString().slice(0, 10)}`,
    [productName],
  )

  const handleDownloadDrawdownImage = useCallback(async () => {
    const el = drawdownChartCaptureRef.current
    if (!el) return
    await downloadNavChartImage(el, `${drawdownExportName}.png`)
  }, [drawdownExportName])

  const handleDownloadDrawdownData = useCallback(() => {
    exportDrawdownCsv(
      drawdownChartData,
      showDrawdownExcess,
      productName,
      benchmarkLabel,
      hasBenchmark,
      `${drawdownExportName}.csv`,
    )
  }, [drawdownChartData, showDrawdownExcess, productName, benchmarkLabel, hasBenchmark, drawdownExportName])

  const navChartExportName = useMemo(() => {
    const modeLabel = chartMode === "return" ? "收益曲线" : "净值曲线"
    return `${productName}_${modeLabel}_${new Date().toISOString().slice(0, 10)}`
  }, [productName, chartMode])

  const handleDownloadNavChartImage = useCallback(async () => {
    const el = navChartCaptureRef.current
    if (!el) return
    await downloadNavChartImage(el, `${navChartExportName}.png`)
  }, [navChartExportName])

  const handleDownloadNavChartData = useCallback(() => {
    exportNavChartCsv(
      activeChartData,
      chartMode,
      chartMode === "return" ? "基金收益率" : navType,
      benchmarkLabel,
      hasBenchmark,
      `${navChartExportName}.csv`,
    )
  }, [activeChartData, chartMode, navType, benchmarkLabel, hasBenchmark, navChartExportName])

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

  return (
    <>
      <div className="flex flex-col xl:flex-row gap-4" style={{ height: 420 }}>
        {activeChartData.length > 1 && (
          <div className="xl:w-[60%] min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
            <div ref={navChartCaptureRef} className="flex flex-col flex-1 min-h-0">
              <div className="flex items-start justify-between mb-2 flex-shrink-0 gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-800">
                    {chartMode === "nav" ? `净值走势（${navType}）` : `收益曲线（${navType}）`}
                  </div>
                  {dateFrom && dateTo && (
                    <div className="text-[11px] text-zinc-400 mt-1 tabular-nums">
                      {dateFrom} ~ {dateTo}
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-xs text-zinc-600 mt-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: RED }} />
                      {chartMode === "return" ? "基金收益率" : navType}
                    </span>
                    {hasBenchmark && (
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
                  navTypeLabel={navType}
                  yDomain={yDomain}
                  xAxis={navChartXAxis}
                  showDots={navChartShowDots}
                  showBench={hasBenchmark}
                  benchmarkLabel={benchmarkLabel}
                  gradientId="navGradMain"
                  returnLabelMode={returnLabelMode}
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 rounded-xl border border-zinc-100 bg-white p-5 flex flex-col h-full">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <div className="text-sm font-semibold text-zinc-700">{navTableTitle}</div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!hasBenchmark) return
                  setShowTableBenchmarkChg((v) => !v)
                }}
                disabled={!hasBenchmark}
                title={hasBenchmark ? undefined : "请先选择业绩基准并点击开始分析"}
                className={`inline-flex items-center text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  showTableBenchmarkChg && hasBenchmark
                    ? "text-red-600 font-medium"
                    : "text-zinc-500 hover:text-zinc-800 disabled:hover:text-zinc-500"
                }`}
              >
                {showTableBenchmarkChg && hasBenchmark ? "隐藏基准涨跌幅" : "显示基准涨跌幅"}
              </button>
              <button
                type="button"
                onClick={() => exportNavCsv(
                  rows,
                  navType,
                  `${productName}_${navTableTitle}_${new Date().toISOString().slice(0, 10)}.csv`,
                  {
                    showBenchmarkChg: !!(showTableBenchmarkChg && hasBenchmark),
                    benchmarkLabel,
                    benchmarkChgByDate,
                  },
                )}
                disabled={rows.length === 0}
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" />
                导出
              </button>
            </div>
          </div>
          <NavTable
            rows={rows}
            navType={navType}
            showBenchmarkChg={!!(showTableBenchmarkChg && hasBenchmark)}
            benchmarkLabel={benchmarkLabel}
            benchmarkChgByDate={benchmarkChgByDate}
          />
        </div>
      </div>

      {periodStats && (
        <PeriodStatisticsTable
          productName={productName}
          benchmarkLabel={benchmarkLabel}
          hasBenchmark={hasBenchmark}
          periodStats={periodStats}
          showDateRange={showDateRange}
          onShowDateRangeChange={setShowDateRange}
          excessByDivision={excessByDivision}
          onExcessByDivisionChange={setExcessByDivision}
        />
      )}

      {drawdownChartData.length > 1 && (
        <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
          <div ref={drawdownChartCaptureRef}>
            <div className="flex items-start justify-between mb-1">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
                  动态回撤
                  <DrawdownCalcHelpButton showExcess={hasBenchmark} />
                </div>
                {dateFrom && dateTo && (
                  <div className="text-[11px] text-zinc-400 mt-1 tabular-nums">
                    统计区间：{dateFrom} - {dateTo}
                  </div>
                )}
                {!showDrawdownExcess && (
                  <div className="flex items-center gap-4 text-xs text-zinc-600 mt-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: RED }} />
                      {productName}
                    </span>
                    {hasBenchmark && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: "#2563eb" }} />
                        {benchmarkLabel}（基准）
                      </span>
                    )}
                  </div>
                )}
                {showDrawdownExcess && (
                  <div className="flex items-center gap-4 text-xs text-zinc-600 mt-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: RED }} />
                      超额回撤
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                {hasBenchmark && (
                  <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      checked={showDrawdownExcess}
                      onChange={(e) => setShowDrawdownExcess(e.target.checked)}
                      className="rounded border-zinc-300 accent-zinc-700"
                    />
                    超额
                  </label>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="p-1 text-zinc-400 hover:text-zinc-600 rounded transition-colors"
                      aria-label="回撤图表菜单"
                    >
                      <Menu className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[7.5rem] text-xs">
                    <DropdownMenuItem onClick={handleDownloadDrawdownImage}>下载图片</DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadDrawdownData}>下载数据</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <DynamicDrawdownChart
              data={drawdownChartData}
              productName={productName}
              benchmarkLabel={benchmarkLabel}
              hasBenchmark={hasBenchmark}
              showExcess={showDrawdownExcess}
              maxFundDrawdown={maxFundDrawdown}
            />

            <DrawdownEpisodesTable
              episodes={drawdownEpisodes}
              benchmarkLabel={benchmarkLabel}
              hasBenchmark={hasBenchmark}
            />
          </div>
        </div>
      )}

      {navChartLightboxOpen && activeChartData.length > 1 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setNavChartLightboxOpen(false)}
        >
          <div
            className="relative w-full max-w-6xl rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setNavChartLightboxOpen(false)}
              className="absolute right-4 top-4 p-1 text-zinc-400 hover:text-zinc-600 rounded"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="text-sm font-semibold text-zinc-800 mb-4">
              {chartMode === "nav" ? `净值走势（${navType}）` : `收益曲线（${navType}）`}
            </div>
            <div ref={navChartLightboxRef} style={{ height: lightboxChartHeight || 480 }}>
              <NavPerformanceChart
                data={activeChartData}
                chartMode={chartMode}
                navTypeLabel={navType}
                yDomain={yDomain}
                xAxis={navChartXAxis}
                showDots={navChartShowDots}
                showBench={hasBenchmark}
                benchmarkLabel={benchmarkLabel}
                gradientId="navGradLightbox"
                height={lightboxChartHeight || 480}
                returnLabelMode={returnLabelMode}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
