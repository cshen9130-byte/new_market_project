"use client"

import { memo, useState, useMemo, useRef, useCallback, useEffect } from "react"
import { HelpCircle, Menu, X } from "lucide-react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RED } from "./shared"
import type { PeriodReturnBar } from "./periodReturns"

const BIN_WIDTH_OPTIONS = [0.25, 0.5, 1.0, 1.5, 2.0] as const

interface DistributionBin {
  center: number
  label: string
  fundFreq: number
  fundCurve: number
  benchFreq: number
  benchCurve: number
}

const PERCENTILE_LINES = [
  { key: "p5" as const, title: "5%分位线" },
  { key: "p25" as const, title: "25%分位线" },
  { key: "p75" as const, title: "75%分位线" },
  { key: "p95" as const, title: "95%分位线" },
]

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function normalPdf(x: number, mean: number, std: number): number {
  if (std <= 0) return 0
  return Math.exp(-0.5 * ((x - mean) / std) ** 2) / (std * Math.sqrt(2 * Math.PI))
}

function buildDistributionBins(
  fundReturns: number[],
  benchReturns: number[],
  binWidth: number,
): DistributionBin[] {
  const all = [...fundReturns, ...benchReturns].filter((v) => Number.isFinite(v))
  if (!all.length || binWidth <= 0) return []

  const rawMin = Math.min(...all)
  const rawMax = Math.max(...all)
  const minEdge = Math.floor(rawMin / binWidth) * binWidth
  const maxEdge = Math.ceil(rawMax / binWidth) * binWidth

  const fundMean = fundReturns.reduce((s, v) => s + v, 0) / fundReturns.length
  const fundVar = fundReturns.reduce((s, v) => s + (v - fundMean) ** 2, 0) / fundReturns.length
  const fundStd = Math.sqrt(fundVar) || binWidth

  const benchMean = benchReturns.length
    ? benchReturns.reduce((s, v) => s + v, 0) / benchReturns.length
    : 0
  const benchVar = benchReturns.length
    ? benchReturns.reduce((s, v) => s + (v - benchMean) ** 2, 0) / benchReturns.length
    : 0
  const benchStd = Math.sqrt(benchVar) || binWidth

  const fundN = fundReturns.length
  const benchN = benchReturns.length
  const bins: DistributionBin[] = []

  for (let edge = minEdge; edge < maxEdge + binWidth * 0.001; edge += binWidth) {
    const center = edge + binWidth / 2
    const lo = edge
    const hi = edge + binWidth
    const inBin = (v: number) => (v >= lo && (v < hi || (hi >= maxEdge && v <= hi)))

    const fundCount = fundReturns.filter(inBin).length
    const benchCount = benchReturns.filter(inBin).length

    bins.push({
      center,
      label: `${center.toFixed(0)}%`,
      fundFreq: fundN > 0 ? (fundCount / fundN) * 100 : 0,
      fundCurve: normalPdf(center, fundMean, fundStd) * binWidth * 100,
      benchFreq: benchN > 0 ? (benchCount / benchN) * 100 : 0,
      benchCurve: benchN > 0 ? normalPdf(center, benchMean, benchStd) * binWidth * 100 : 0,
    })
  }

  return bins
}

function buildPercentileMarkLine(
  percentiles: Record<(typeof PERCENTILE_LINES)[number]["key"], number>,
  yMax: number,
) {
  return {
    silent: true,
    symbol: "none",
    animation: false,
    lineStyle: { color: "#ef4444", type: "dashed", width: 1 },
    data: PERCENTILE_LINES.flatMap(({ key, title }) => {
      const x = percentiles[key]
      const valueText = `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`
      return [[
        {
          coord: [x, 0],
          label: {
            show: true,
            formatter: title,
            position: "insideStartTop",
            color: "#ef4444",
            fontSize: 10,
            distance: 4,
          },
        },
        {
          coord: [x, yMax],
          label: {
            show: true,
            formatter: valueText,
            position: "insideEndBottom",
            color: "#ef4444",
            fontSize: 10,
            distance: 4,
          },
        },
      ]]
    }),
  }
}

function buildDistributionChartOption(
  bins: DistributionBin[],
  binWidth: number,
  yMax: number,
  showFundHist: boolean,
  showFundCurve: boolean,
  showBenchHist: boolean,
  showBenchCurve: boolean,
  showPercentileLines: boolean,
  percentiles: Record<(typeof PERCENTILE_LINES)[number]["key"], number>,
  seriesLabel: string,
  benchmarkLabel: string,
): EChartsOption {
  const axisLabel = { fontSize: 11, color: "#a1a1aa" }
  let xMin = bins.length ? bins[0].center - binWidth / 2 : -5
  let xMax = bins.length ? bins[bins.length - 1].center + binWidth / 2 : 5
  if (showPercentileLines) {
    for (const { key } of PERCENTILE_LINES) {
      xMin = Math.min(xMin, percentiles[key] - binWidth)
      xMax = Math.max(xMax, percentiles[key] + binWidth)
    }
  }
  const barMaxWidth = bins.length ? Math.max(6, Math.min(22, 300 / bins.length)) : 12

  const series: EChartsOption["series"] = []

  if (showFundHist) {
    series.push({
      name: `${seriesLabel}-直方图`,
      type: "bar",
      data: bins.map((b) => [b.center, b.fundFreq]),
      barMaxWidth,
      itemStyle: { color: RED, opacity: 0.85 },
      z: 2,
    })
  }

  if (showFundCurve) {
    series.push({
      name: `${seriesLabel}-拟合曲线`,
      type: "line",
      data: bins.map((b) => [b.center, b.fundCurve]),
      showSymbol: false,
      lineStyle: { color: "#2563eb", width: 2 },
      z: 3,
    })
  }

  if (showBenchHist) {
    series.push({
      name: `${benchmarkLabel}（基准）-直方图`,
      type: "bar",
      data: bins.map((b) => [b.center, b.benchFreq]),
      barMaxWidth,
      itemStyle: { color: "#94a3b8", opacity: 0.7 },
      z: 1,
    })
  }

  if (showBenchCurve) {
    series.push({
      name: `${benchmarkLabel}（基准）-拟合曲线`,
      type: "line",
      data: bins.map((b) => [b.center, b.benchCurve]),
      showSymbol: false,
      lineStyle: { color: "#64748b", width: 2, type: "dashed" },
      z: 3,
    })
  }

  if (showPercentileLines) {
    if (series.length === 0) {
      series.push({
        name: "_percentile_anchor",
        type: "line",
        data: [],
        markLine: buildPercentileMarkLine(percentiles, yMax),
        silent: true,
        symbol: "none",
        lineStyle: { opacity: 0 },
      })
    } else {
      const first = series[0] as { markLine?: ReturnType<typeof buildPercentileMarkLine> }
      first.markLine = buildPercentileMarkLine(percentiles, yMax)
    }
  }

  return {
    animation: false,
    grid: { left: 48, right: 12, top: showPercentileLines ? 28 : 12, bottom: showPercentileLines ? 28 : 20 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as Array<{
          seriesName?: string
          value?: number | [number, number]
          color?: string
        }>
        if (!items.length) return ""
        const firstVal = items[0].value
        const xVal = Array.isArray(firstVal) ? firstVal[0] : 0
        const lines = [`<div style="color:#71717a;margin-bottom:4px">收益率 ${Number(xVal).toFixed(2)}%</div>`]
        for (const item of items) {
          const val = Array.isArray(item.value) ? item.value[1] : item.value
          if (val === null || val === undefined || !Number.isFinite(val)) continue
          lines.push(
            `<div style="font-weight:600;color:${item.color ?? "#333"}">${item.seriesName}: ${Number(val).toFixed(2)}%</div>`,
          )
        }
        return lines.join("")
      },
      confine: true,
    },
    xAxis: {
      type: "value",
      min: xMin,
      max: xMax,
      axisLabel: { ...axisLabel, formatter: (v: number) => `${v.toFixed(0)}%` },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      splitLine: { show: false },
      name: "收益率",
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: yMax,
      axisLabel: { ...axisLabel, formatter: "{value}%" },
      splitLine: { lineStyle: { type: "dashed", color: "#f4f4f5" } },
      name: "频率",
      nameLocation: "middle",
      nameGap: 36,
      nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
    },
    series,
  }
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

function LegendToggle({
  active, color, shape, label, onClick,
}: {
  active: boolean
  color: string
  shape: "bar" | "line"
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 transition-opacity",
        active ? "opacity-100" : "opacity-40 hover:opacity-60",
      ].join(" ")}
    >
      {shape === "bar" ? (
        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
      ) : (
        <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: color }} />
      )}
      <span className="text-xs text-zinc-600">{label}</span>
    </button>
  )
}

export const ReturnDistributionPanel = memo(function ReturnDistributionPanel({
  productName, dateRangeLabel, chartData, benchmarkLabel, hasBenchmark,
}: {
  productName: string
  dateRangeLabel: string
  chartData: PeriodReturnBar[]
  benchmarkLabel: string
  hasBenchmark: boolean
}) {
  const [binWidth, setBinWidth] = useState<number>(0.5)
  const [showExcess, setShowExcess] = useState(false)
  const [showPercentileLines, setShowPercentileLines] = useState(false)
  const [showFundHist, setShowFundHist] = useState(true)
  const [showFundCurve, setShowFundCurve] = useState(true)
  const [showBenchHist, setShowBenchHist] = useState(false)
  const [showBenchCurve, setShowBenchCurve] = useState(false)
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

  const fundReturns = useMemo(() => {
    if (showExcess && hasBenchmark) {
      return chartData.map((d) => d.excessPct).filter((v): v is number => v !== null)
    }
    return chartData.map((d) => d.fundPct)
  }, [chartData, showExcess, hasBenchmark])

  const benchReturns = useMemo(
    () => chartData.map((d) => d.benchPct).filter((v): v is number => v !== null),
    [chartData],
  )

  const bins = useMemo(
    () => buildDistributionBins(fundReturns, benchReturns, binWidth),
    [fundReturns, benchReturns, binWidth],
  )

  const percentiles = useMemo(() => {
    const sorted = [...fundReturns].sort((a, b) => a - b)
    return {
      p5: percentile(sorted, 0.05),
      p25: percentile(sorted, 0.25),
      p75: percentile(sorted, 0.75),
      p95: percentile(sorted, 0.95),
    }
  }, [fundReturns])

  const yMax = useMemo(() => {
    const vals = bins.flatMap((b) => {
      const out: number[] = []
      if (showFundHist) out.push(b.fundFreq)
      if (showFundCurve) out.push(b.fundCurve)
      if (showBenchHist) out.push(b.benchFreq)
      if (showBenchCurve) out.push(b.benchCurve)
      return out
    })
    if (!vals.length) return 25
    const max = Math.max(...vals)
    return Math.ceil(max / 5) * 5 + 5
  }, [bins, showFundHist, showFundCurve, showBenchHist, showBenchCurve])

  const seriesLabel = showExcess && hasBenchmark ? "超额" : productName

  const chartOption = useMemo(
    () => buildDistributionChartOption(
      bins,
      binWidth,
      yMax,
      showFundHist,
      showFundCurve,
      showBenchHist && hasBenchmark,
      showBenchCurve && hasBenchmark,
      showPercentileLines,
      percentiles,
      seriesLabel,
      benchmarkLabel,
    ),
    [
      bins, binWidth, yMax, showFundHist, showFundCurve, showBenchHist, showBenchCurve,
      showPercentileLines, percentiles, seriesLabel, benchmarkLabel, hasBenchmark,
    ],
  )

  const exportName = `${productName}_收益分布`

  const exportCsv = useCallback(() => {
    const headers = ["收益率区间", "基金频率(%)", "基金拟合(%)"]
    if (hasBenchmark) headers.push("基准频率(%)", "基准拟合(%)")
    const lines = bins.map((b) => {
      const row = [
        `${(b.center - binWidth / 2).toFixed(2)}%~${(b.center + binWidth / 2).toFixed(2)}%`,
        b.fundFreq.toFixed(2),
        b.fundCurve.toFixed(2),
      ]
      if (hasBenchmark) row.push(b.benchFreq.toFixed(2), b.benchCurve.toFixed(2))
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
  }, [bins, binWidth, hasBenchmark, exportName])

  const handleDownloadImage = useCallback(async () => {
    const el = captureRef.current
    if (!el) return
    await downloadPanelImage(el, `${exportName}.png`)
  }, [exportName])

  const chartBlock = (height: number) => (
    <ReactECharts
      option={chartOption}
      style={{ height, width: "100%" }}
      notMerge
      opts={{ renderer: "canvas" }}
    />
  )

  if (!fundReturns.length || !bins.length) return null

  return (
    <>
      <div ref={captureRef} className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
              收益分布
              <HelpCircle className="h-3.5 w-3.5 text-zinc-300" aria-label="收益分布说明" />
            </div>
            {dateRangeLabel && <div className="text-xs text-zinc-400 mt-1">统计区间：{dateRangeLabel}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
            <label className="inline-flex items-center gap-1.5 cursor-pointer hover:text-zinc-900 transition-colors">
              <input
                type="checkbox"
                checked={showPercentileLines}
                onChange={(e) => setShowPercentileLines(e.target.checked)}
                className="rounded border-zinc-300 accent-zinc-700"
              />
              产品分位线
            </label>
            <div className="inline-flex items-center gap-1.5">
              <span className="text-zinc-500">指标统计区间：</span>
              <select
                value={binWidth}
                onChange={(e) => setBinWidth(parseFloat(e.target.value))}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
              >
                {BIN_WIDTH_OPTIONS.map((w) => (
                  <option key={w} value={w}>{w.toFixed(2)}%</option>
                ))}
              </select>
            </div>
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

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs mb-2">
          <LegendToggle
            active={showFundHist}
            color={RED}
            shape="bar"
            label={`${seriesLabel}-直方图`}
            onClick={() => setShowFundHist((v) => !v)}
          />
          <LegendToggle
            active={showFundCurve}
            color="#2563eb"
            shape="line"
            label={`${seriesLabel}-拟合曲线`}
            onClick={() => setShowFundCurve((v) => !v)}
          />
          {hasBenchmark && (
            <>
              <LegendToggle
                active={showBenchHist}
                color="#94a3b8"
                shape="bar"
                label={`${benchmarkLabel}（基准）-直方图`}
                onClick={() => setShowBenchHist((v) => !v)}
              />
              <LegendToggle
                active={showBenchCurve}
                color="#64748b"
                shape="line"
                label={`${benchmarkLabel}（基准）-拟合曲线`}
                onClick={() => setShowBenchCurve((v) => !v)}
              />
            </>
          )}
        </div>

        {chartBlock(320)}
      </div>

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
                <div className="text-base font-semibold text-zinc-800">收益分布</div>
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
ReturnDistributionPanel.displayName = "ReturnDistributionPanel"
