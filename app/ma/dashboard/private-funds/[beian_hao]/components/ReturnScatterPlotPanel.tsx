"use client"

import { memo, useState, useMemo, useRef, useCallback, useEffect } from "react"
import { Menu, X } from "lucide-react"
import {
  ComposedChart, Scatter, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ZAxis,
} from "recharts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RED, type NavRow, type BenchmarkPoint } from "./shared"
import { computePeriodReturnBars, type PeriodGranularity } from "./periodReturns"

interface ScatterPoint {
  label: string
  bench: number
  fund: number
}

function linearRegression(points: ScatterPoint[]): { slope: number; intercept: number } | null {
  if (points.length < 2) return null
  const n = points.length
  const mx = points.reduce((s, p) => s + p.bench, 0) / n
  const my = points.reduce((s, p) => s + p.fund, 0) / n
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.bench - mx) * (p.fund - my)
    den += (p.bench - mx) ** 2
  }
  if (den === 0) return null
  const slope = num / den
  return { slope, intercept: my - slope * mx }
}

function buildRegressionLine(points: ScatterPoint[], reg: { slope: number; intercept: number }) {
  const xs = points.map((p) => p.bench)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  return [
    { bench: minX, fund: reg.slope * minX + reg.intercept },
    { bench: maxX, fund: reg.slope * maxX + reg.intercept },
  ]
}

function ScatterTooltip({
  active, payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: ScatterPoint }>
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload!
  return (
    <div className="bg-white border border-zinc-100 shadow-md rounded-lg px-3 py-2 text-xs">
      <div className="text-zinc-500 mb-1">{d.label}</div>
      <div className="tabular-nums">基准：{d.bench > 0 ? "+" : ""}{d.bench.toFixed(2)}%</div>
      <div className="tabular-nums font-semibold" style={{ color: RED }}>
        基金：{d.fund > 0 ? "+" : ""}{d.fund.toFixed(2)}%
      </div>
    </div>
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

export const ReturnScatterPlotPanel = memo(function ReturnScatterPlotPanel({
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
  const [granularity, setGranularity] = useState<PeriodGranularity>("week")
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

  const scatterPoints = useMemo((): ScatterPoint[] => {
    if (!hasBenchmark) return []
    const bars = computePeriodReturnBars(rows, navType, granularity, benchmarkSeries)
    return bars
      .filter((b) => b.benchPct !== null)
      .map((b) => ({
        label: b.label,
        bench: b.benchPct!,
        fund: showExcess ? (b.excessPct ?? b.fundPct - b.benchPct!) : b.fundPct,
      }))
  }, [rows, navType, granularity, benchmarkSeries, hasBenchmark, showExcess])

  const regression = useMemo(() => linearRegression(scatterPoints), [scatterPoints])
  const regressionLine = useMemo(
    () => (regression ? buildRegressionLine(scatterPoints, regression) : []),
    [scatterPoints, regression],
  )

  const xDomain = useMemo((): [number, number] => {
    if (!scatterPoints.length) return [-6, 8]
    const vals = scatterPoints.map((p) => p.bench)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = Math.max((max - min) * 0.1, 1)
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }, [scatterPoints])

  const yDomain = useMemo((): [number, number] => {
    if (!scatterPoints.length) return [-15, 15]
    const vals = scatterPoints.map((p) => p.fund)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = Math.max((max - min) * 0.1, 1)
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }, [scatterPoints])

  const exportName = `${productName}_收益散点图_${granularity === "week" ? "周度" : "月度"}`

  const exportCsv = useCallback(() => {
    const yLabel = showExcess ? "超额收益(%)" : "基金收益(%)"
    const headers = ["区间", `${benchmarkLabel}(%)`, yLabel]
    const lines = scatterPoints.map((p) => [
      p.label,
      p.bench.toFixed(2),
      p.fund.toFixed(2),
    ].join(","))
    const blob = new Blob(["\uFEFF" + [headers.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${exportName}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [scatterPoints, benchmarkLabel, showExcess, exportName])

  const handleDownloadImage = useCallback(async () => {
    const el = captureRef.current
    if (!el) return
    await downloadPanelImage(el, `${exportName}.png`)
  }, [exportName])

  const chartBlock = (height: number) => (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={{ top: 16, right: 16, left: 4, bottom: 28 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
          <XAxis
            type="number"
            dataKey="bench"
            domain={xDomain}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickFormatter={(v: number) => `${v}%`}
            label={{
              value: `${benchmarkLabel}（基准）`,
              position: "insideBottom",
              offset: -12,
              style: { fontSize: 11, fill: "#71717a" },
            }}
          />
          <YAxis
            type="number"
            dataKey="fund"
            domain={yDomain}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            width={48}
            tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`}
            label={{
              value: "收益率（%）",
              angle: -90,
              position: "insideLeft",
              offset: 4,
              style: { fontSize: 11, fill: "#71717a" },
            }}
          />
          <ZAxis range={[40, 40]} />
          <Tooltip content={(props) => (
            <ScatterTooltip active={props.active} payload={props.payload as Array<{ payload?: ScatterPoint }>} />
          )} />
          <ReferenceLine x={0} stroke="#18181b" strokeWidth={1.5} />
          <ReferenceLine y={0} stroke="#18181b" strokeWidth={1.5} />
          <Scatter name={productName} data={scatterPoints} fill={RED} fillOpacity={0.85} />
          {regressionLine.length === 2 && (
            <Line
              data={regressionLine}
              dataKey="fund"
              stroke="#60a5fa"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              legendType="none"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )

  if (!hasBenchmark) {
    return (
      <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
              收益散点图
            </div>
            {dateRangeLabel && <div className="text-xs text-zinc-400 mt-1">统计区间：{dateRangeLabel}</div>}
          </div>
        </div>
        <div className="h-[320px] flex items-center justify-center text-sm text-zinc-400">
          请在上方选择业绩基准并点击「开始分析」
        </div>
      </div>
    )
  }

  return (
    <>
      <div ref={captureRef} className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
              收益散点图
            </div>
            {dateRangeLabel && <div className="text-xs text-zinc-400 mt-1">统计区间：{dateRangeLabel}</div>}
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 mt-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: RED }} />
              {productName}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
            <label className="inline-flex items-center gap-1.5 cursor-pointer hover:text-zinc-900 transition-colors">
              <input
                type="checkbox"
                checked={showExcess}
                onChange={(e) => setShowExcess(e.target.checked)}
                className="rounded border-zinc-300 accent-zinc-700"
              />
              超额
            </label>
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

        {!scatterPoints.length ? (
          <div className="h-[320px] flex items-center justify-center text-sm text-zinc-400">暂无足够数据</div>
        ) : (
          chartBlock(320)
        )}
      </div>

      {lightboxOpen && scatterPoints.length > 0 && (
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
                <div className="text-base font-semibold text-zinc-800">收益散点图</div>
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
ReturnScatterPlotPanel.displayName = "ReturnScatterPlotPanel"
