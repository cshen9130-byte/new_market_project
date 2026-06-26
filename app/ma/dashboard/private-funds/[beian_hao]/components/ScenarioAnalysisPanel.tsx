"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Menu, X } from "lucide-react"
import {
  ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RED, type NavRow, type BenchmarkPoint } from "./shared"
import {
  buildScenarioChartSeries,
  computeIndicatorDomain,
  computeReturnDomain,
  scenarioIndicatorAxisLabel,
  scenarioIndicatorLabel,
  FUTURES_CATEGORY_OPTIONS,
  STOCK_CATEGORY_OPTIONS,
  ROLLING_WINDOW_OPTIONS,
  FUTURES_INDICATORS,
  STOCK_INDICATORS,
  OPTION_INDICATORS,
  type OhlcBar,
  type ScenarioAssetClass,
  type ScenarioIndicatorKey,
} from "./scenarioMetrics"
import { EventScenarioAnalysisPanel } from "./EventScenarioAnalysisPanel"
import { StyleScenarioAnalysisPanel } from "./StyleScenarioAnalysisPanel"

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

function TextTabs<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ key: T; label: string }>
  value: T
  onChange: (key: T) => void
  label: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
      <span className="text-zinc-400 mr-1">{label}</span>
      {options.map((opt, i) => (
        <span key={opt.key} className="inline-flex items-center">
          {i > 0 && <span className="text-zinc-200 mx-1">|</span>}
          <button
            type="button"
            onClick={() => onChange(opt.key)}
            className={`px-0.5 py-0.5 transition-colors ${
              value === opt.key ? "text-red-600 font-medium" : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {opt.label}
          </button>
        </span>
      ))}
    </div>
  )
}

export const ScenarioAnalysisPanel = memo(function ScenarioAnalysisPanel({
  beian_hao,
  productName,
  dateRangeLabel,
  dateFrom,
  dateTo,
  rows,
  navType,
  benchmarkSeries,
  benchmarkLabel,
  hasBenchmark,
  defaultCategoryCode,
}: {
  beian_hao: string
  productName: string
  dateRangeLabel: string
  dateFrom: string
  dateTo: string
  rows: NavRow[]
  navType: string
  benchmarkSeries: BenchmarkPoint[]
  benchmarkLabel: string
  hasBenchmark: boolean
  defaultCategoryCode?: string
}) {
  const resolvedDefault = defaultCategoryCode && STOCK_CATEGORY_OPTIONS.some((o) => o.code === defaultCategoryCode)
    ? { assetClass: "stock" as const, code: defaultCategoryCode }
    : defaultCategoryCode && FUTURES_CATEGORY_OPTIONS.some((o) => o.code === defaultCategoryCode)
      ? { assetClass: "futures" as const, code: defaultCategoryCode }
      : { assetClass: "futures" as const, code: "NHCI.NH" }

  const [assetClass, setAssetClass] = useState<ScenarioAssetClass>(resolvedDefault.assetClass)
  const [indicator, setIndicator] = useState<ScenarioIndicatorKey>("tsVol")
  const [categoryCode, setCategoryCode] = useState(resolvedDefault.code)
  const [windowDays, setWindowDays] = useState(20)
  const [showExcess, setShowExcess] = useState(false)
  const [marketBars, setMarketBars] = useState<OhlcBar[]>([])
  const [crossSectionBars, setCrossSectionBars] = useState<OhlcBar[][]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxHeight, setLightboxHeight] = useState(420)
  const captureRef = useRef<HTMLDivElement>(null)
  const lightboxRef = useRef<HTMLDivElement>(null)

  const categoryOptions = assetClass === "futures"
    ? FUTURES_CATEGORY_OPTIONS
    : assetClass === "stock"
      ? STOCK_CATEGORY_OPTIONS
      : []

  const indicatorOptions = useMemo(() => {
    const keys = assetClass === "futures"
      ? FUTURES_INDICATORS
      : assetClass === "stock"
        ? STOCK_INDICATORS
        : OPTION_INDICATORS
    return keys.map((key) => ({
      key,
      label: scenarioIndicatorLabel(key, assetClass),
    }))
  }, [assetClass])

  useEffect(() => {
    if (assetClass === "option") return
    const valid = categoryOptions.some((o) => o.code === categoryCode)
    if (!valid && categoryOptions[0]) setCategoryCode(categoryOptions[0].code)
  }, [assetClass, categoryCode, categoryOptions])

  useEffect(() => {
    const valid = indicatorOptions.some((o) => o.key === indicator)
    if (!valid && indicatorOptions[0]) setIndicator(indicatorOptions[0].key)
  }, [indicator, indicatorOptions])

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
    if (assetClass === "option") return
    if (!dateFrom || !dateTo || !categoryCode) return

    let cancelled = false
    setLoading(true)
    setLoadError(null)

    const fetchBars = async (code: string): Promise<OhlcBar[]> => {
      const qs = new URLSearchParams({ code, from: dateFrom, to: dateTo })
      const res = await fetch(`/ma/api/private-funds/scenario-market?${qs}`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || "加载市场数据失败")
      return (json.data ?? []) as OhlcBar[]
    }

    ;(async () => {
      try {
        const primary = await fetchBars(categoryCode)
        if (cancelled) return
        setMarketBars(primary)

        if (indicator === "crossSection" && assetClass === "futures") {
          const codes = FUTURES_CATEGORY_OPTIONS.map((o) => o.code).filter((c) => c !== categoryCode)
          const all = await Promise.all(codes.map((code) => fetchBars(code).catch(() => [])))
          if (!cancelled) setCrossSectionBars([primary, ...all.filter((s) => s.length > 0)])
        } else {
          setCrossSectionBars([])
        }
      } catch (err) {
        if (!cancelled) {
          setMarketBars([])
          setCrossSectionBars([])
          setLoadError(err instanceof Error ? err.message : "加载失败")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [assetClass, categoryCode, dateFrom, dateTo, indicator])

  const chartData = useMemo(
    () => buildScenarioChartSeries({
      marketBars,
      crossSectionBars: indicator === "crossSection" ? crossSectionBars : undefined,
      navRows: rows,
      navType,
      benchmarkSeries,
      indicator,
      windowDays,
    }),
    [marketBars, crossSectionBars, rows, navType, benchmarkSeries, indicator, windowDays],
  )

  const indicatorDomain = useMemo(() => computeIndicatorDomain(chartData), [chartData])
  const returnDomain = useMemo(() => computeReturnDomain(chartData, showExcess && hasBenchmark), [chartData, showExcess, hasBenchmark])

  const categoryLabel = categoryOptions.find((o) => o.code === categoryCode)?.label ?? categoryCode
  const indicatorLabel = scenarioIndicatorLabel(indicator, assetClass)
  const leftAxisLabel = scenarioIndicatorAxisLabel(indicator)
  const exportName = `${productName}_市场情景分析_${indicatorLabel}`

  const exportCsv = useCallback(() => {
    const headers = ["日期", leftAxisLabel, showExcess && hasBenchmark ? "超额(%)" : `${productName}(%)`]
    if (hasBenchmark && !showExcess) headers.push(`${benchmarkLabel}(%)`)
    const lines = chartData.map((p) => {
      const row = [
        p.date,
        p.indicator !== null ? p.indicator.toFixed(4) : "",
        showExcess && hasBenchmark
          ? (p.excessReturn !== null ? p.excessReturn.toFixed(4) : "")
          : (p.fundReturn !== null ? p.fundReturn.toFixed(4) : ""),
      ]
      if (hasBenchmark && !showExcess) {
        row.push(p.benchReturn !== null ? p.benchReturn.toFixed(4) : "")
      }
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
  }, [chartData, leftAxisLabel, showExcess, hasBenchmark, productName, benchmarkLabel, exportName])

  const handleDownloadImage = useCallback(async () => {
    const el = captureRef.current
    if (!el) return
    await downloadPanelImage(el, `${exportName}.png`)
  }, [exportName])

  const returnKey = showExcess && hasBenchmark ? "excessReturn" : "fundReturn"
  const returnName = showExcess && hasBenchmark ? "超额" : `${productName}(右轴)`

  const chartBlock = (height: number) => (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
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
            yAxisId="left"
            domain={indicatorDomain}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            width={48}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            label={{ value: leftAxisLabel, angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#a1a1aa" } }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={returnDomain}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            width={48}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            label={{ value: "收益率(%)", angle: 90, position: "insideRight", offset: 10, style: { fontSize: 11, fill: "#a1a1aa" } }}
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
          <Area
            yAxisId="right"
            type="monotone"
            dataKey={returnKey}
            name={returnName}
            stroke={RED}
            fill={RED}
            fillOpacity={0.15}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          {hasBenchmark && !showExcess && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="benchReturn"
              name={benchmarkLabel}
              stroke="#2563eb"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          )}
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="indicator"
            name={indicatorLabel}
            stroke="#94a3b8"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            legendType="none"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )

  if (assetClass === "option") {
    return (
      <>
        <div className="rounded-xl border border-zinc-100 bg-white p-5 min-h-[320px] flex items-center justify-center text-sm text-zinc-400">
          期权情景分析数据开发中
        </div>
        <EventScenarioAnalysisPanel
          beian_hao={beian_hao}
          productName={productName}
          dateRangeLabel={dateRangeLabel}
          rows={rows}
          navType={navType}
          benchmarkSeries={benchmarkSeries}
          benchmarkLabel={benchmarkLabel}
          hasBenchmark={hasBenchmark}
        />
        <StyleScenarioAnalysisPanel
          productName={productName}
          dateRangeLabel={dateRangeLabel}
          dateFrom={dateFrom}
          dateTo={dateTo}
          rows={rows}
          navType={navType}
          benchmarkSeries={benchmarkSeries}
          benchmarkLabel={benchmarkLabel}
          hasBenchmark={hasBenchmark}
        />
      </>
    )
  }

  return (
    <>
      <div ref={captureRef} className="rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
              市场情景分析
            </div>
            {dateRangeLabel && <div className="text-xs text-zinc-400 mt-1 tabular-nums">{dateRangeLabel}</div>}
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
            <label className="inline-flex items-center gap-1.5">
              <span className="text-zinc-400">类别</span>
              <select
                value={categoryCode}
                onChange={(e) => setCategoryCode(e.target.value)}
                className="border border-zinc-200 rounded px-2 py-1 text-xs bg-white text-zinc-700 min-w-[8rem]"
              >
                {categoryOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5">
              <span className="text-zinc-400">滚动周期</span>
              <select
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
                className="border border-zinc-200 rounded px-2 py-1 text-xs bg-white text-zinc-700"
              >
                {ROLLING_WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.days} value={opt.days}>{opt.label}</option>
                ))}
              </select>
            </label>
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

        <div className="space-y-3 mb-4">
          <TextTabs
            label="类别"
            options={[
              { key: "futures" as const, label: "期货" },
              { key: "stock" as const, label: "股票" },
              { key: "option" as const, label: "期权" },
            ]}
            value={assetClass}
            onChange={setAssetClass}
          />
          <TextTabs
            label="指标"
            options={indicatorOptions}
            value={indicator}
            onChange={setIndicator}
          />
        </div>

        {loading ? (
          <div className="h-[360px] flex items-center justify-center text-sm text-zinc-400">加载市场数据中…</div>
        ) : loadError ? (
          <div className="h-[360px] flex items-center justify-center text-sm text-red-500">{loadError}</div>
        ) : indicator === "volumeOi" ? (
          <div className="h-[360px] flex items-center justify-center text-sm text-zinc-400">
            成交持仓比数据暂不可用
          </div>
        ) : !chartData.length ? (
          <div className="h-[360px] flex items-center justify-center text-sm text-zinc-400">暂无足够数据</div>
        ) : (
          chartBlock(360)
        )}

        <div className="mt-3 text-[11px] text-zinc-400">
          左轴：{categoryLabel} · {indicatorLabel}（{windowDays}日滚动）
          {hasBenchmark && !showExcess ? `；右轴：${productName} 与 ${benchmarkLabel} 累计收益率` : showExcess ? "；右轴：超额累计收益率" : `；右轴：${productName} 累计收益率`}
        </div>
      </div>

      {lightboxOpen && chartData.length > 0 && (
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
                <div className="text-base font-semibold text-zinc-800">市场情景分析</div>
                <div className="text-xs text-zinc-400 mt-1 tabular-nums">{dateRangeLabel}</div>
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

      <EventScenarioAnalysisPanel
        beian_hao={beian_hao}
        productName={productName}
        dateRangeLabel={dateRangeLabel}
        rows={rows}
        navType={navType}
        benchmarkSeries={benchmarkSeries}
        benchmarkLabel={benchmarkLabel}
        hasBenchmark={hasBenchmark}
      />

      <StyleScenarioAnalysisPanel
        productName={productName}
        dateRangeLabel={dateRangeLabel}
        dateFrom={dateFrom}
        dateTo={dateTo}
        rows={rows}
        navType={navType}
        benchmarkSeries={benchmarkSeries}
        benchmarkLabel={benchmarkLabel}
        hasBenchmark={hasBenchmark}
      />
    </>
  )
})
ScenarioAnalysisPanel.displayName = "ScenarioAnalysisPanel"
