"use client"

import { memo, useState, useMemo, useRef, useCallback, useEffect } from "react"
import { Menu, X } from "lucide-react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RED, GREEN, type NavRow, type BenchmarkPoint } from "./shared"
import { computePeriodReturnBars, type PeriodGranularity, type PeriodReturnBar } from "./periodReturns"
import { ReturnDistributionPanel } from "./ReturnDistributionPanel"
import { RollingAnalysisPanel } from "./RollingAnalysisPanel"
import { RollingRankPercentileTrendChart } from "./RollingRankPercentileTrendChart"
import { ReturnScatterPlotPanel } from "./ReturnScatterPlotPanel"
import { BenchmarkRelationPanels } from "./BenchmarkRelationPanels"
import { ProfitProbabilityPanel } from "./ProfitProbabilityPanel"

type WinRateGranularity = PeriodGranularity

interface WinRateStats {
  totalPeriods: number
  upPct: number
  downPct: number
  avgUpReturn: number | null
  avgDownLoss: number | null
  maxReturn: number | null
  maxLoss: number | null
  upStdDev: number | null
  downStdDev: number | null
}

function stdDev(values: number[]): number | null {
  if (values.length === 0) return null
  if (values.length === 1) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
}

function computeWinRateStats(returns: number[]): WinRateStats {
  const valid = returns.filter((r) => Number.isFinite(r))
  const total = valid.length
  const up = valid.filter((r) => r > 0)
  const down = valid.filter((r) => r < 0)
  return {
    totalPeriods: total,
    upPct: total > 0 ? (up.length / total) * 100 : 0,
    downPct: total > 0 ? (down.length / total) * 100 : 0,
    avgUpReturn: up.length ? up.reduce((s, v) => s + v, 0) / up.length : null,
    avgDownLoss: down.length ? down.reduce((s, v) => s + v, 0) / down.length : null,
    maxReturn: valid.length ? Math.max(...valid) : null,
    maxLoss: valid.length ? Math.min(...valid) : null,
    upStdDev: up.length ? stdDev(up) : null,
    downStdDev: down.length ? stdDev(down) : null,
  }
}

const GRANULARITY_LABELS: Record<WinRateGranularity, {
  total: string; upShare: string; downShare: string
  avgUp: string; avgDown: string; maxUp: string; maxDown: string; upStd: string; downStd: string
}> = {
  week: {
    total: "总周数", upShare: "上涨周数占比", downShare: "下跌周数占比",
    avgUp: "上涨周平均收益", avgDown: "下跌周平均亏损",
    maxUp: "最大周收益", maxDown: "最大周亏损",
    upStd: "上涨周标准差", downStd: "下跌周标准差",
  },
  month: {
    total: "总月数", upShare: "上涨月数占比", downShare: "下跌月数占比",
    avgUp: "上涨月平均收益", avgDown: "下跌月平均亏损",
    maxUp: "最大月收益", maxDown: "最大月亏损",
    upStd: "上涨月标准差", downStd: "下跌月标准差",
  },
}

function fmtRatio(v: number): string {
  return v.toFixed(2) + "%"
}

function fmtReturn(v: number | null): { text: string; color?: string } {
  if (v === null || !Number.isFinite(v)) return { text: "—" }
  const color = v > 0 ? RED : v < 0 ? GREEN : undefined
  return { text: (v > 0 ? "+" : "") + v.toFixed(2) + "%", color }
}

type WinRateChartMode = "fund" | "dual" | "excess"

function buildWinRateChartOption(
  chartData: PeriodReturnBar[],
  chartMode: WinRateChartMode,
  productName: string,
  benchmarkLabel: string,
  yDomain: [number, number],
): EChartsOption {
  const labels = chartData.map((d) => d.label)
  const axisLabel = { fontSize: 11, color: "#a1a1aa" }

  const tooltipFormatter = (params: unknown) => {
    const items = (Array.isArray(params) ? params : [params]) as Array<{
      axisValue?: string
      seriesName?: string
      value?: number | null
      color?: string
    }>
    if (!items.length) return ""
    const lines = [`<div style="color:#71717a;margin-bottom:4px">${items[0].axisValue ?? ""}</div>`]
    for (const item of items) {
      const val = item.value
      if (val === null || val === undefined || !Number.isFinite(val)) continue
      const sign = val > 0 ? "+" : ""
      lines.push(
        `<div style="font-weight:600;color:${item.color ?? "#333"}">${item.seriesName}: ${sign}${val.toFixed(2)}%</div>`,
      )
    }
    return lines.join("")
  }

  const base: EChartsOption = {
    animation: false,
    grid: { left: 48, right: 12, top: 8, bottom: 28 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: tooltipFormatter,
      confine: true,
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { ...axisLabel, hideOverlap: true },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      min: yDomain[0],
      max: yDomain[1],
      axisLabel: { ...axisLabel, formatter: "{value}%" },
      splitLine: { lineStyle: { type: "dashed", color: "#f4f4f5" } },
    },
  }

  if (chartMode === "excess") {
    return {
      ...base,
      series: [{
        name: "超额",
        type: "bar",
        data: chartData.map((d) => {
          const v = d.excessPct ?? d.fundPct
          return { value: v, itemStyle: { color: v >= 0 ? RED : GREEN } }
        }),
        barMaxWidth: 14,
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#d4d4d8", type: "solid" },
          data: [{ yAxis: 0 }],
        },
      }],
    }
  }

  const series: EChartsOption["series"] = [{
    name: productName,
    type: "bar",
    data: chartData.map((d) => ({
      value: d.fundPct,
      itemStyle: { color: d.fundPct >= 0 ? RED : GREEN },
    })),
    barMaxWidth: chartMode === "dual" ? 10 : 14,
    markLine: {
      silent: true,
      symbol: "none",
      lineStyle: { color: "#d4d4d8", type: "solid" },
      data: [{ yAxis: 0 }],
    },
  }]

  if (chartMode === "dual") {
    series.push({
      name: `${benchmarkLabel}（基准）`,
      type: "bar",
      data: chartData.map((d) => {
        if (d.benchPct === null || !Number.isFinite(d.benchPct)) return { value: null }
        return {
          value: d.benchPct,
          itemStyle: { color: d.benchPct >= 0 ? "#2563eb" : "#34d399" },
        }
      }),
      barMaxWidth: 10,
    })
  }

  return { ...base, series }
}

function StatsTableRow({
  name, stats,
}: {
  name: string
  stats: WinRateStats
}) {
  const avgUp = fmtReturn(stats.avgUpReturn)
  const avgDown = fmtReturn(stats.avgDownLoss)
  const maxUp = fmtReturn(stats.maxReturn)
  const maxLoss = fmtReturn(stats.maxLoss)
  const upStd = fmtReturn(stats.upStdDev)
  const downStd = fmtReturn(stats.downStdDev)

  return (
    <tr className="border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/50">
      <td className="px-3 py-2.5 text-zinc-800 font-medium whitespace-nowrap border-r border-zinc-100">{name}</td>
      <td className="px-3 py-2.5 text-center tabular-nums text-zinc-700">{stats.totalPeriods}</td>
      <td className="px-3 py-2.5 text-center tabular-nums text-red-500">{fmtRatio(stats.upPct)}</td>
      <td className="px-3 py-2.5 text-center tabular-nums text-green-600">{fmtRatio(stats.downPct)}</td>
      <td className="px-3 py-2.5 text-center tabular-nums" style={avgUp.color ? { color: avgUp.color } : undefined}>{avgUp.text}</td>
      <td className="px-3 py-2.5 text-center tabular-nums" style={avgDown.color ? { color: avgDown.color } : undefined}>{avgDown.text}</td>
      <td className="px-3 py-2.5 text-center tabular-nums" style={maxUp.color ? { color: maxUp.color } : undefined}>{maxUp.text}</td>
      <td className="px-3 py-2.5 text-center tabular-nums" style={maxLoss.color ? { color: maxLoss.color } : undefined}>{maxLoss.text}</td>
      <td className="px-3 py-2.5 text-center tabular-nums" style={upStd.color ? { color: upStd.color } : undefined}>{upStd.text}</td>
      <td className="px-3 py-2.5 text-center tabular-nums" style={downStd.color ? { color: downStd.color } : undefined}>{downStd.text}</td>
    </tr>
  )
}

async function downloadPanelImage(el: HTMLElement, filename: string) {
  const { default: html2canvas } = await import("html2canvas-pro")
  const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2, useCORS: true })
  const url = canvas.toDataURL("image/png")
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
}

export const WinRateAnalysisPanel = memo(function WinRateAnalysisPanel({
  beian_hao, productName, dateRangeLabel, rows, navType, benchmarkSeries, benchmarkLabel, hasBenchmark, sampleGroup, companyStrategy,
}: {
  beian_hao: string
  productName: string
  dateRangeLabel: string
  rows: NavRow[]
  navType: string
  benchmarkSeries: BenchmarkPoint[]
  benchmarkLabel: string
  hasBenchmark: boolean
  sampleGroup: string | null
  companyStrategy: string | null
}) {
  const [granularity, setGranularity] = useState<WinRateGranularity>("week")
  const [showExcess, setShowExcess] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxHeight, setLightboxHeight] = useState(420)
  const captureRef = useRef<HTMLDivElement>(null)
  const lightboxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!lightboxOpen || !lightboxRef.current) return
    const el = lightboxRef.current
    const update = () => setLightboxHeight(Math.max(el.clientHeight, 420))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [lightboxOpen])

  const chartData = useMemo(
    () => computePeriodReturnBars(rows, navType, granularity, benchmarkSeries),
    [rows, navType, granularity, benchmarkSeries],
  )

  const labels = GRANULARITY_LABELS[granularity]

  const fundStats = useMemo(
    () => computeWinRateStats(chartData.map((d) => d.fundPct)),
    [chartData],
  )

  const benchStats = useMemo(
    () => computeWinRateStats(chartData.map((d) => d.benchPct).filter((v): v is number => v !== null)),
    [chartData],
  )

  const excessStats = useMemo(
    () => computeWinRateStats(chartData.map((d) => d.excessPct).filter((v): v is number => v !== null)),
    [chartData],
  )

  const yDomain = useMemo((): [number, number] => {
    if (!chartData.length) return [-5, 5]
    const vals = chartData.flatMap((d) => {
      if (showExcess && hasBenchmark) return [d.excessPct ?? d.fundPct]
      if (hasBenchmark) return [d.fundPct, d.benchPct ?? 0]
      return [d.fundPct]
    }).filter((v) => v !== null && Number.isFinite(v)) as number[]
    if (!vals.length) return [-5, 5]
    const min = Math.min(...vals), max = Math.max(...vals)
    const pad = Math.max((max - min) * 0.1, 1)
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }, [chartData, hasBenchmark, showExcess])

  const exportName = `${productName}_胜率分析_${granularity === "week" ? "周度" : "月度"}`

  const exportCsv = useCallback(() => {
    const headers = ["区间", productName]
    if (hasBenchmark && !showExcess) headers.push(`${benchmarkLabel}（基准）`)
    if (showExcess && hasBenchmark) headers.push("超额")
    const lines = chartData.map((d) => {
      const row = [d.label, `${d.fundPct.toFixed(2)}%`]
      if (hasBenchmark && !showExcess) row.push(d.benchPct !== null ? `${d.benchPct.toFixed(2)}%` : "")
      if (showExcess && hasBenchmark) row.push(d.excessPct !== null ? `${d.excessPct.toFixed(2)}%` : "")
      return row
    })
    const escape = (v: string) => v.includes(",") ? `"${v}"` : v
    const blob = new Blob(["\uFEFF" + [headers, ...lines].map((r) => r.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${exportName}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [chartData, productName, benchmarkLabel, hasBenchmark, showExcess, exportName])

  const handleDownloadImage = useCallback(async () => {
    const el = captureRef.current
    if (!el) return
    await downloadPanelImage(el, `${exportName}.png`)
  }, [exportName])

  const chartMode: WinRateChartMode = showExcess && hasBenchmark ? "excess" : hasBenchmark && benchmarkSeries.length > 0 ? "dual" : "fund"

  const chartOption = useMemo(
    () => buildWinRateChartOption(chartData, chartMode, productName, benchmarkLabel, yDomain),
    [chartData, chartMode, productName, benchmarkLabel, yDomain],
  )

  const chartBlock = (height: number) => (
    <ReactECharts
      option={chartOption}
      style={{ height, width: "100%" }}
      notMerge
      opts={{ renderer: "canvas" }}
    />
  )

  if (!chartData.length) {
    return (
      <div className="rounded-xl border border-zinc-100 bg-white p-5 min-h-[320px] flex items-center justify-center text-sm text-zinc-400">
        暂无足够数据
      </div>
    )
  }

  return (
    <>
      <div ref={captureRef} className="rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
              胜率分析
            </div>
            {dateRangeLabel && <div className="text-xs text-zinc-400 mt-1">统计区间：{dateRangeLabel}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
            {hasBenchmark && (
              <label className="inline-flex items-center gap-1.5 cursor-pointer hover:text-zinc-900 transition-colors">
                <input
                  type="checkbox"
                  checked={showExcess}
                  onChange={(e) => setShowExcess(e.target.checked)}
                  className="rounded border-zinc-300 accent-zinc-700"
                />
                超额
              </label>
            )}
            <div className="inline-flex text-xs">
              <button
                type="button"
                onClick={() => setGranularity("week")}
                className={`px-3 py-1 transition-colors border rounded-l ${
                  granularity === "week"
                    ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                    : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                }`}
              >
                周度
              </button>
              <button
                type="button"
                onClick={() => setGranularity("month")}
                className={`px-3 py-1 transition-colors border rounded-r -ml-px ${
                  granularity === "month"
                    ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                    : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                }`}
              >
                月度
              </button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="p-1 text-zinc-400 hover:text-zinc-600 rounded transition-colors" aria-label="图表菜单">
                  <Menu className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[7.5rem] text-xs">
                <DropdownMenuItem onClick={handleDownloadImage}>下载图片</DropdownMenuItem>
                <DropdownMenuItem onClick={exportCsv}>下载数据</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLightboxOpen(true)}>查看大图</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-zinc-600 mb-2">
          {chartMode !== "excess" && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RED }} />
              {productName}
            </span>
          )}
          {chartMode === "dual" && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" />
              {benchmarkLabel}（基准）
            </span>
          )}
          {chartMode === "excess" && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RED }} />
              超额
            </span>
          )}
        </div>

        {chartBlock(320)}

        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-100">
          <table className="w-full text-xs min-w-[960px] border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="px-3 py-2.5 text-left font-medium text-zinc-500 whitespace-nowrap border-r border-zinc-100">基金名称</th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{labels.total}</th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{labels.upShare}</th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{labels.downShare}</th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{labels.avgUp}</th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{labels.avgDown}</th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{labels.maxUp}</th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{labels.maxDown}</th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{labels.upStd}</th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{labels.downStd}</th>
              </tr>
            </thead>
            <tbody>
              {showExcess && hasBenchmark ? (
                <StatsTableRow name="超额" stats={excessStats} />
              ) : (
                <>
                  <StatsTableRow name={productName} stats={fundStats} />
                  {hasBenchmark && benchStats.totalPeriods > 0 && (
                    <StatsTableRow name={`${benchmarkLabel}（基准）`} stats={benchStats} />
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ReturnDistributionPanel
        productName={productName}
        dateRangeLabel={dateRangeLabel}
        chartData={chartData}
        benchmarkLabel={benchmarkLabel}
        hasBenchmark={hasBenchmark}
      />

      <RollingAnalysisPanel
        productName={productName}
        dateRangeLabel={dateRangeLabel}
        rows={rows}
        navType={navType}
        benchmarkSeries={benchmarkSeries}
        benchmarkLabel={benchmarkLabel}
        hasBenchmark={hasBenchmark}
      />

      <RollingRankPercentileTrendChart
        beian_hao={beian_hao}
        productName={productName}
        dateRangeLabel={dateRangeLabel}
        sampleGroup={sampleGroup}
        companyStrategy={companyStrategy}
      />

      <ReturnScatterPlotPanel
        productName={productName}
        dateRangeLabel={dateRangeLabel}
        rows={rows}
        navType={navType}
        benchmarkSeries={benchmarkSeries}
        benchmarkLabel={benchmarkLabel}
        hasBenchmark={hasBenchmark}
      />

      <BenchmarkRelationPanels
        productName={productName}
        benchmarkLabel={benchmarkLabel}
        hasBenchmark={hasBenchmark}
        rows={rows}
        navType={navType}
        benchmarkSeries={benchmarkSeries}
        cutoffDate={rows.length ? rows[rows.length - 1].price_date : ""}
      />

      <ProfitProbabilityPanel
        productName={productName}
        benchmarkLabel={benchmarkLabel}
        hasBenchmark={hasBenchmark}
        rows={rows}
        navType={navType}
        benchmarkSeries={benchmarkSeries}
        dateRangeLabel={dateRangeLabel}
      />

      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3 flex-shrink-0">
              <div>
                <div className="text-base font-semibold text-zinc-800">胜率分析</div>
                {dateRangeLabel && <div className="text-xs text-zinc-400 mt-1 tabular-nums">{dateRangeLabel}</div>}
              </div>
              <button type="button" onClick={() => setLightboxOpen(false)} className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded transition-colors" aria-label="关闭">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div ref={lightboxRef} className="w-full h-[70vh] min-h-[420px]">
              {chartBlock(lightboxHeight)}
            </div>
          </div>
        </div>
      )}
    </>
  )
})
WinRateAnalysisPanel.displayName = "WinRateAnalysisPanel"
