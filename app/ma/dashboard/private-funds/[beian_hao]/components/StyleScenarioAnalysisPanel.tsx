"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Menu, X } from "lucide-react"
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceArea,
} from "recharts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RED, type NavRow, type BenchmarkPoint } from "./shared"
import {
  STYLE_SCENARIO_TABS,
  buildStyleScenarioChartSeries,
  computeStyleReturnDomain,
  detectEventBands,
  stylePointsForBandDetection,
  type StyleScenarioTabKey,
  type EventBand,
} from "./scenarioMetrics"
import { StyleScenarioTablePanel } from "./StyleScenarioTablePanel"

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

async function downloadPanelImage(el: HTMLElement, filename: string) {
  const { default: html2canvas } = await import("html2canvas-pro")
  const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2, useCORS: true })
  const url = canvas.toDataURL("image/png")
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
}

export const StyleScenarioAnalysisPanel = memo(function StyleScenarioAnalysisPanel({
  productName,
  dateRangeLabel,
  dateFrom,
  dateTo,
  rows,
  navType,
  benchmarkSeries,
  benchmarkLabel,
  hasBenchmark,
}: {
  productName: string
  dateRangeLabel: string
  dateFrom: string
  dateTo: string
  rows: NavRow[]
  navType: string
  benchmarkSeries: BenchmarkPoint[]
  benchmarkLabel: string
  hasBenchmark: boolean
}) {
  const [activeTab, setActiveTab] = useState<StyleScenarioTabKey>("market")
  const [showExcess, setShowExcess] = useState(false)
  const [styleSeries, setStyleSeries] = useState<BenchmarkPoint[]>([])
  const [referenceSeries, setReferenceSeries] = useState<BenchmarkPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxHeight, setLightboxHeight] = useState(420)
  const captureRef = useRef<HTMLDivElement>(null)
  const lightboxRef = useRef<HTMLDivElement>(null)

  const tabConfig = STYLE_SCENARIO_TABS.find((t) => t.key === activeTab) ?? STYLE_SCENARIO_TABS[0]

  useEffect(() => {
    if (!lightboxOpen || !lightboxRef.current) return
    const el = lightboxRef.current
    const update = () => setLightboxHeight(Math.max(el.clientHeight, 420))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [lightboxOpen])

  useEffect(() => {
    if (!dateFrom || !dateTo) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    const fetchSeries = async (key: string) => {
      const qs = new URLSearchParams({ key, from: dateFrom, to: dateTo })
      const res = await fetch(`/ma/api/private-funds/benchmark?${qs}`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || "加载风格指数失败")
      return (json.data ?? []) as BenchmarkPoint[]
    }

    const referenceKey = activeTab === "market" ? null : "IF"

    ;(async () => {
      try {
        const [primary, reference] = await Promise.all([
          fetchSeries(tabConfig.indexKey),
          referenceKey ? fetchSeries(referenceKey) : Promise.resolve([] as BenchmarkPoint[]),
        ])
        if (cancelled) return
        setStyleSeries(primary)
        setReferenceSeries(reference)
      } catch (err) {
        if (!cancelled) {
          setStyleSeries([])
          setReferenceSeries([])
          setLoadError(err instanceof Error ? err.message : "加载失败")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [activeTab, tabConfig.indexKey, dateFrom, dateTo])

  const chartData = useMemo(
    () => buildStyleScenarioChartSeries(rows, navType, styleSeries, benchmarkSeries),
    [rows, navType, styleSeries, benchmarkSeries],
  )

  const styleBands = useMemo(() => {
    if (!styleSeries.length || !chartData.length) return [] as EventBand[]
    return detectEventBands(stylePointsForBandDetection(chartData), styleSeries)
  }, [chartData, styleSeries])

  const yDomain = useMemo(
    () => computeStyleReturnDomain(chartData, showExcess && hasBenchmark),
    [chartData, showExcess, hasBenchmark],
  )

  const exportName = `${productName}_风格情景分析_${tabConfig.label}`
  const returnKey = showExcess && hasBenchmark ? "excessReturn" : "fundReturn"
  const returnLabel = showExcess && hasBenchmark ? "超额" : productName

  const exportCsv = useCallback(() => {
    const headers = ["日期", returnLabel]
    if (!showExcess || !hasBenchmark) headers.push(tabConfig.indexLabel)
    if (hasBenchmark && !showExcess) headers.push(`${benchmarkLabel}（基准）`)
    const lines = chartData.map((p) => {
      const row = [p.date, p[returnKey] !== null ? p[returnKey]!.toFixed(4) : ""]
      if (!showExcess || !hasBenchmark) row.push(p.styleReturn !== null ? p.styleReturn.toFixed(4) : "")
      if (hasBenchmark && !showExcess) row.push(p.benchReturn !== null ? p.benchReturn.toFixed(4) : "")
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
  }, [chartData, returnKey, returnLabel, showExcess, hasBenchmark, tabConfig.indexLabel, benchmarkLabel, exportName])

  const handleDownloadImage = useCallback(async () => {
    const el = captureRef.current
    if (!el) return
    await downloadPanelImage(el, `${exportName}.png`)
  }, [exportName])

  const renderBands = (bands: EventBand[]) =>
    bands.map((band) => (
      <ReferenceArea
        key={`${band.tone}-${band.from}-${band.to}`}
        x1={band.from}
        x2={band.to}
        fill={band.tone === "blue" ? "#dbeafe" : "#fecdd3"}
        fillOpacity={0.5}
        strokeOpacity={0}
      />
    ))

  const chartBlock = (height: number) => (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
          {renderBands(styleBands)}
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
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            label={{ value: "收益率(%)", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#a1a1aa" } }}
          />
          <Tooltip
            labelFormatter={(d) => String(d)}
            formatter={(value: number, name: string) => {
              if (value === null || !Number.isFinite(value)) return ["—", name]
              return [`${value.toFixed(2)}%`, name]
            }}
            contentStyle={{ fontSize: 12 }}
          />
          <Legend
            verticalAlign="top"
            align="left"
            iconType="plainline"
            wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
          />
          <Line
            type="monotone"
            dataKey={returnKey}
            name={returnLabel}
            stroke={RED}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          {(!showExcess || !hasBenchmark) && (
            <Line
              type="monotone"
              dataKey="styleReturn"
              name={tabConfig.indexLabel}
              stroke="#1d4ed8"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          )}
          {hasBenchmark && !showExcess && (
            <Line
              type="monotone"
              dataKey="benchReturn"
              name={`${benchmarkLabel}（基准）`}
              stroke="#60a5fa"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )

  return (
    <>
      <div ref={captureRef} className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
              风格情景分析
            </div>
            {dateRangeLabel && <div className="text-xs text-zinc-400 mt-1 tabular-nums">统计区间：{dateRangeLabel}</div>}
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

        <div className="inline-flex text-xs mb-4">
          {STYLE_SCENARIO_TABS.map((tab, i) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={[
                "px-3 py-1 transition-colors border",
                i === 0 ? "rounded-l" : "",
                i === STYLE_SCENARIO_TABS.length - 1 ? "rounded-r -ml-px" : i > 0 ? "-ml-px" : "",
                activeTab === tab.key
                  ? "bg-white text-red-600 border-red-400 font-medium z-[1]"
                  : "bg-white text-zinc-600 hover:bg-zinc-50 border-zinc-200",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="h-[320px] flex items-center justify-center text-sm text-zinc-400">加载风格指数中…</div>
        ) : loadError ? (
          <div className="h-[320px] flex items-center justify-center text-sm text-red-500">{loadError}</div>
        ) : !chartData.length || !styleSeries.length ? (
          <div className="h-[320px] flex items-center justify-center text-sm text-zinc-400">暂无足够数据</div>
        ) : (
          chartBlock(320)
        )}
      </div>

      {lightboxOpen && chartData.length > 0 && styleSeries.length > 0 && (
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
                <div className="text-base font-semibold text-zinc-800">风格情景分析</div>
                <div className="text-xs text-zinc-400 mt-1 tabular-nums">统计区间：{dateRangeLabel}</div>
              </div>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded transition-colors"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div ref={lightboxRef} className="w-full flex-1 min-h-[420px]">
              {lightboxHeight > 0 && chartBlock(lightboxHeight)}
            </div>
          </div>
        </div>
      )}

      <StyleScenarioTablePanel
        productName={productName}
        benchmarkLabel={benchmarkLabel}
        hasBenchmark={hasBenchmark}
        rows={rows}
        navType={navType}
        styleSeries={styleSeries}
        benchmarkSeries={benchmarkSeries}
        referenceSeries={activeTab === "market" ? styleSeries : referenceSeries}
        activeTab={activeTab}
      />
    </>
  )
})
StyleScenarioAnalysisPanel.displayName = "StyleScenarioAnalysisPanel"
