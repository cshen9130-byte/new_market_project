"use client"

import { memo, useState, useMemo, useRef, useCallback, useEffect } from "react"
import { Menu, X } from "lucide-react"
import {
  ComposedChart, Bar, Line,
  LineChart, Line as SimpleLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RED, type NavRow, type BenchmarkPoint } from "./shared"
import {
  computeRollingMetricSeries,
  downsampleRollingSeries,
  formatMetricValue,
  metricFormatType,
  metricLabel,
  type RollingMetricKey,
} from "./rollingMetrics"

const PRIMARY_METRICS: RollingMetricKey[] = [
  "periodRet", "annVol", "sharpe", "calmar", "maxDD", "correlation",
]

const EXTRA_METRICS: RollingMetricKey[] = [
  "sortino", "downsideRisk", "ddRecoveryDays", "longestNoNewHighDays",
]

const ROLLING_WINDOW_OPTIONS = [
  { days: 20, label: "20天" },
  { days: 90, label: "三个月" },
  { days: 182, label: "六个月" },
  { days: 365, label: "一年" },
  { days: 730, label: "两年" },
] as const

function formatAxisDate(dateStr: string): string {
  const year = dateStr.slice(2, 4)
  const month = parseInt(dateStr.slice(5, 7), 10)
  if (month === 1 || dateStr.endsWith("-01-01")) return year
  return `${month}月`
}

function pickYearTicks(dates: string[]): string[] {
  if (!dates.length) return []
  const seen = new Set<string>()
  const ticks: string[] = []
  for (const d of dates) {
    const y = d.slice(0, 4)
    if (!seen.has(y)) {
      seen.add(y)
      ticks.push(d)
    }
  }
  if (ticks.length < 2 && dates.length >= 2) {
    return [dates[0], dates[dates.length - 1]]
  }
  return ticks
}

function normalPdf(x: number, mean: number, std: number): number {
  if (std <= 0) return 0
  return Math.exp(-0.5 * ((x - mean) / std) ** 2) / (std * Math.sqrt(2 * Math.PI))
}

function buildFitBins(values: number[], binCount = 12) {
  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length < 2) return []
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const span = max - min || 1
  const binWidth = span / binCount
  const bins = Array.from({ length: binCount }, (_, i) => {
    const lo = min + i * binWidth
    const center = lo + binWidth / 2
    const count = valid.filter((v) => v >= lo && (i === binCount - 1 ? v <= lo + binWidth : v < lo + binWidth)).length
    return { center, freq: (count / valid.length) * 100, curve: 0 }
  })
  const mean = valid.reduce((s, v) => s + v, 0) / valid.length
  const std = Math.sqrt(valid.reduce((s, v) => s + (v - mean) ** 2, 0) / valid.length) || binWidth
  return bins.map((b) => ({
    ...b,
    curve: normalPdf(b.center, mean, std) * binWidth * 100,
  }))
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

export const RollingAnalysisPanel = memo(function RollingAnalysisPanel({
  productName, dateRangeLabel, rows, navType, benchmarkSeries, benchmarkLabel, hasBenchmark,
}: {
  productName: string
  dateRangeLabel: string
  rows: NavRow[]
  navType: string
  benchmarkSeries: BenchmarkPoint[]
  benchmarkLabel: string
  hasBenchmark: boolean
}) {
  const [metric, setMetric] = useState<RollingMetricKey>("periodRet")
  const [windowDays, setWindowDays] = useState(20)
  const [chartMode, setChartMode] = useState<"line" | "fit">("line")
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

  const availableMetrics = useMemo(() => {
    const base = PRIMARY_METRICS.filter((k) => k !== "correlation" || hasBenchmark)
    return base
  }, [hasBenchmark])

  const series = useMemo(() => {
    const raw = computeRollingMetricSeries(rows, navType, benchmarkSeries, windowDays, metric)
    return downsampleRollingSeries(raw)
  }, [rows, navType, benchmarkSeries, windowDays, metric])

  const chartData = useMemo(
    () => series.map((p) => ({ date: p.date, fund: p.fund, bench: p.bench })),
    [series],
  )

  const fitBins = useMemo(() => {
    const fundVals = series.map((p) => p.fund).filter((v): v is number => v !== null && Number.isFinite(v))
    return buildFitBins(fundVals)
  }, [series])

  const yDomain = useMemo((): [number, number] => {
    const vals = chartData.flatMap((d) => [d.fund, d.bench]).filter((v): v is number => v !== null && Number.isFinite(v))
    if (!vals.length) return metric === "correlation" ? [-1, 1] : [0, 1]
    if (metric === "correlation") return [-1, 1]
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = Math.max((max - min) * 0.08, metricFormatType(metric) === "ratio" ? 0.1 : 1)
    return [+(min - pad).toFixed(2), +(max + pad).toFixed(2)]
  }, [chartData, metric])

  const yAxisLabel = metricLabel(metric)
  const exportName = `${productName}_滚动分析_${yAxisLabel}`

  const exportCsv = useCallback(() => {
    const headers = ["日期", productName]
    if (hasBenchmark && metric !== "correlation") headers.push(`${benchmarkLabel}（基准）`)
    const lines = series.map((p) => {
      const row = [p.date, formatMetricValue(p.fund, metric)]
      if (hasBenchmark && metric !== "correlation") row.push(formatMetricValue(p.bench, metric))
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
  }, [series, productName, benchmarkLabel, hasBenchmark, metric, exportName])

  const handleDownloadImage = useCallback(async () => {
    const el = captureRef.current
    if (!el) return
    await downloadPanelImage(el, `${exportName}.png`)
  }, [exportName])

  const tickFormatter = useCallback((v: number) => {
    const type = metricFormatType(metric)
    if (type === "pct") return `${v.toFixed(0)}%`
    if (type === "corr") return v.toFixed(1)
    if (type === "days") return String(Math.round(v))
    return v.toFixed(1)
  }, [metric])

  const lineChart = (height: number) => (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickFormatter={formatAxisDate}
            ticks={pickYearTicks(chartData.map((d) => d.date))}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            width={48}
            tickFormatter={tickFormatter}
            label={{ value: yAxisLabel, angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#a1a1aa" } }}
          />
          <Tooltip
            labelFormatter={(d) => String(d)}
            formatter={(value: number, name: string) => [formatMetricValue(value, metric), name]}
            contentStyle={{ fontSize: 12 }}
          />
          <SimpleLine
            type="linear"
            dataKey="fund"
            name={productName}
            stroke={RED}
            strokeWidth={1.75}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          {hasBenchmark && metric !== "correlation" && (
            <SimpleLine
              type="linear"
              dataKey="bench"
              name={`${benchmarkLabel}（基准）`}
              stroke="#2563eb"
              strokeWidth={1.75}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )

  const fitChart = (height: number) => (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={fitBins} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
          <XAxis
            dataKey="center"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickFormatter={(v: number) => tickFormatter(v)}
            label={{ value: yAxisLabel, position: "insideBottom", offset: -2, style: { fontSize: 11, fill: "#a1a1aa" } }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            width={44}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            label={{ value: "频率", angle: -90, position: "insideLeft", offset: 8, style: { fontSize: 11, fill: "#a1a1aa" } }}
          />
          <Tooltip formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]} contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="freq" name={`${productName}-直方图`} fill={RED} fillOpacity={0.85} radius={[2, 2, 0, 0]} />
          <Line dataKey="curve" name={`${productName}-拟合曲线`} stroke="#2563eb" strokeWidth={2} dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )

  if (!chartData.length) return null

  return (
    <>
      <div ref={captureRef} className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700 mb-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
              滚动分析
            </div>
            <div className="flex flex-wrap items-center gap-1 mb-2">
              {availableMetrics.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMetric(key)}
                  className={[
                    "px-2.5 py-1 text-xs whitespace-nowrap transition-colors rounded",
                    metric === key ? "text-red-500 font-medium" : "text-zinc-500 hover:text-zinc-700",
                  ].join(" ")}
                >
                  {metricLabel(key)}
                </button>
              ))}
              <select
                value={EXTRA_METRICS.includes(metric) ? metric : ""}
                onChange={(e) => {
                  const v = e.target.value as RollingMetricKey
                  if (v) setMetric(v)
                }}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-500 max-w-[140px]"
              >
                <option value="">请选择更多指标</option>
                {EXTRA_METRICS.map((key) => (
                  <option key={key} value={key}>{metricLabel(key)}</option>
                ))}
              </select>
            </div>
            {dateRangeLabel && <div className="text-xs text-zinc-400">统计区间：{dateRangeLabel}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
            <div className="inline-flex text-xs">
              <button
                type="button"
                onClick={() => setChartMode("line")}
                className={`px-3 py-1 transition-colors border rounded-l ${
                  chartMode === "line"
                    ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                    : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                }`}
              >
                曲线图
              </button>
              <button
                type="button"
                onClick={() => setChartMode("fit")}
                className={`px-3 py-1 transition-colors border rounded-r -ml-px ${
                  chartMode === "fit"
                    ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                    : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200"
                }`}
              >
                拟合分布
              </button>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <span className="text-zinc-500">滚动周期：</span>
              <select
                value={windowDays}
                onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
                className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
              >
                {ROLLING_WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.days} value={opt.days}>{opt.label}</option>
                ))}
              </select>
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

        {chartMode === "line" && (
          <div className="flex items-center gap-4 text-xs text-zinc-600 mb-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: RED }} />
              {productName}
            </span>
            {hasBenchmark && metric !== "correlation" && (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-4 h-0.5 rounded bg-blue-500" />
                {benchmarkLabel}（基准）
              </span>
            )}
          </div>
        )}

        {chartMode === "line" ? lineChart(320) : fitChart(320)}
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
                <div className="text-base font-semibold text-zinc-800">滚动分析 · {yAxisLabel}</div>
                {dateRangeLabel && <div className="text-xs text-zinc-400 mt-1 tabular-nums">{dateRangeLabel}</div>}
              </div>
              <button type="button" onClick={() => setLightboxOpen(false)} className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded transition-colors" aria-label="关闭">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div ref={lightboxRef} className="w-full h-[70vh] min-h-[420px]">
              {chartMode === "line" ? lineChart(lightboxHeight) : fitChart(lightboxHeight)}
            </div>
          </div>
        </div>
      )}
    </>
  )
})
RollingAnalysisPanel.displayName = "RollingAnalysisPanel"
