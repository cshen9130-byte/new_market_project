"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Download, Menu, BarChart3, LineChart as LineChartIcon } from "lucide-react"
import {
  LineChart, Line,
  BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RED, GREEN, getNavFieldValue, type NavRow, type BenchmarkPoint } from "./shared"
import {
  buildFactorReturns,
  buildMultiAssetFactorReturns,
  computeFundDailyReturns,
  computeStyleAttribution,
  factorDefsForModel,
  marketCodesForModel,
  subtractSeries,
  listYearsInRange,
  listQuartersInRange,
  quarterBounds,
  attributionToSensitivityColumn,
  type AttributionFactorModel,
  type DailyCloseSeries,
  type StyleAttributionResult,
  type FactorSensitivityTrend,
} from "@/lib/style-attribution"
import { FactorSensitivityTrendPanel } from "./FactorSensitivityTrendPanel"
import { CalcExplanationButton } from "./AttributionCalcExplanation"

export type { AttributionFactorModel }

export function guessAttributionFactorModel(productName: string): AttributionFactorModel {
  const text = productName.trim().toLowerCase()
  if (/cta|期货|商品|管理期货|trend\s*following|managed\s*futures/.test(text)) {
    return "commodity-cta"
  }
  return "multi-asset"
}

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

function fmtNum(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "—"
  return v.toFixed(digits)
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return "—"
  return `${v.toFixed(2)}%`
}

function CheckboxToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="inline-flex items-center gap-1.5 hover:text-zinc-900 transition-colors text-xs text-zinc-600"
    >
      <span
        aria-hidden="true"
        className={[
          "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
          checked ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white",
        ].join(" ")}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </span>
      {label}
    </button>
  )
}

function CoeffBar({ value, maxAbs }: { value: number; maxAbs: number }) {
  const widthPct = maxAbs > 0 ? Math.min(Math.abs(value) / maxAbs * 100, 100) : 0
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <span
        className="inline-block h-2.5 rounded-sm shrink-0"
        style={{
          width: `${Math.max(widthPct, value !== 0 ? 4 : 0)}%`,
          maxWidth: 72,
          backgroundColor: value >= 0 ? "#fca5a5" : "#fecaca",
        }}
      />
      <span className="tabular-nums text-zinc-800">{fmtNum(value)}</span>
    </div>
  )
}

async function fetchMarketSeries(code: string, from: string, to: string): Promise<DailyCloseSeries[]> {
  // ETF tickers use benchmark API; equity/futures indices use scenario-market.
  if (/^\d+\.(SH|SZ)$/i.test(code)) {
    const qs = new URLSearchParams({ key: code, from, to })
    const res = await fetch(`/ma/api/private-funds/benchmark?${qs}`)
    if (!res.ok) return []
    const json = await res.json()
    if (!json.ok || !Array.isArray(json.data)) return []
    return json.data
      .map((row: { date: string; value: number | null }) => ({
        date: row.date,
        close: row.value ?? 0,
      }))
      .filter((row: DailyCloseSeries) => row.close > 0)
  }

  const qs = new URLSearchParams({ code, from, to })
  const res = await fetch(`/ma/api/private-funds/scenario-market?${qs}`)
  if (!res.ok) return []
  const json = await res.json()
  if (!json.ok || !Array.isArray(json.data)) return []
  return json.data
    .map((row: { date: string; close: number | null }) => ({
      date: row.date,
      close: row.close ?? 0,
    }))
    .filter((row: DailyCloseSeries) => row.close > 0)
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

function computeFundReturnsForRows(
  sliceRows: NavRow[],
  navType: string,
  excessMode: boolean,
  hasBenchmark: boolean,
  benchmarkSeries: BenchmarkPoint[],
): { dates: string[]; fundReturns: number[] } | null {
  if (sliceRows.length < 30) return null
  const navValues = sliceRows.map((r) => getNavFieldValue(r, navType))
  const dates = sliceRows.slice(1).map((r) => r.price_date)
  let fundReturns = computeFundDailyReturns(navValues)

  if (excessMode && hasBenchmark && benchmarkSeries.length) {
    const benchMap = new Map(benchmarkSeries.map((p) => [p.date, p.value]))
    let lastBench = benchmarkSeries[0]?.value ?? 1
    const benchReturns: number[] = []
    for (let i = 1; i < sliceRows.length; i++) {
      const d = sliceRows[i].price_date
      if (benchMap.has(d)) lastBench = benchMap.get(d)!
      const prevDate = sliceRows[i - 1].price_date
      let prevBench = lastBench
      for (const p of benchmarkSeries) {
        if (p.date <= prevDate) prevBench = p.value
        else break
      }
      benchReturns.push(prevBench > 0 ? lastBench / prevBench - 1 : 0)
    }
    fundReturns = subtractSeries(fundReturns, benchReturns)
  }

  return { dates, fundReturns }
}

function runAttributionForRows(
  sliceRows: NavRow[],
  navType: string,
  indexSeries: Record<string, DailyCloseSeries[]>,
  excessMode: boolean,
  hasBenchmark: boolean,
  benchmarkSeries: BenchmarkPoint[],
  factorModel: AttributionFactorModel,
): StyleAttributionResult | null {
  const prepared = computeFundReturnsForRows(sliceRows, navType, excessMode, hasBenchmark, benchmarkSeries)
  if (!prepared) return null
  const factorDefs = factorDefsForModel(factorModel)
  const factorReturns =
    factorModel === "multi-asset"
      ? buildMultiAssetFactorReturns(indexSeries, prepared.dates, sliceRows[0].price_date)
      : buildFactorReturns(indexSeries, prepared.dates)
  return computeStyleAttribution({
    dates: prepared.dates,
    fundReturns: prepared.fundReturns,
    factorReturns,
    factorDefs,
  })
}

export const NavAttributionPanel = memo(function NavAttributionPanel({
  productName,
  dateRangeLabel,
  dateFrom,
  dateTo,
  rows,
  navType,
  benchmarkSeries,
  hasBenchmark,
  defaultFactorModel = "commodity-cta",
  showFactorModelSelect = false,
}: {
  productName: string
  dateRangeLabel: string
  dateFrom: string
  dateTo: string
  rows: NavRow[]
  navType: string
  benchmarkSeries: BenchmarkPoint[]
  hasBenchmark: boolean
  defaultFactorModel?: AttributionFactorModel
  showFactorModelSelect?: boolean
}) {
  const [excessMode, setExcessMode] = useState(false)
  const [factorModel, setFactorModel] = useState<AttributionFactorModel>(defaultFactorModel)
  const [loading, setLoading] = useState(true)
  const [indexSeries, setIndexSeries] = useState<Record<string, DailyCloseSeries[]>>({})
  const tableRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const contributionRef = useRef<HTMLDivElement>(null)
  const riskContributionRef = useRef<HTMLDivElement>(null)
  const [contributionChartMode, setContributionChartMode] = useState<"bar" | "line">("bar")
  const factorDefs = useMemo(() => factorDefsForModel(factorModel), [factorModel])

  useEffect(() => {
    setFactorModel(defaultFactorModel)
  }, [defaultFactorModel])

  useEffect(() => {
    if (!dateFrom || !dateTo) return
    let cancelled = false
    setLoading(true)
    const codes = marketCodesForModel(factorModel)
    // Extend lookback so rolling CTA factors / asset-class ffill have history.
    const fetchFrom = (() => {
      const d = new Date(`${dateFrom}T12:00:00`)
      d.setDate(d.getDate() - 120)
      return d.toISOString().slice(0, 10)
    })()
    Promise.all(
      codes.map(async (code) => {
        const data = await fetchMarketSeries(code, fetchFrom, dateTo)
        return [code, data] as const
      }),
    )
      .then((entries) => {
        if (cancelled) return
        setIndexSeries(Object.fromEntries(entries))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dateFrom, dateTo, factorModel])

  const attribution = useMemo((): StyleAttributionResult | null => {
    if (rows.length < 30 || loading) return null
    return runAttributionForRows(
      rows, navType, indexSeries, excessMode, hasBenchmark, benchmarkSeries, factorModel,
    )
  }, [rows, navType, excessMode, hasBenchmark, benchmarkSeries, indexSeries, loading, factorModel])

  const sensitivityTrend = useMemo((): FactorSensitivityTrend | null => {
    if (!attribution || loading) return null

    const annualPeriodCols = listYearsInRange(dateFrom, dateTo)
      .map((year) => {
        const from = `${year}-01-01` < dateFrom ? dateFrom : `${year}-01-01`
        const to = `${year}-12-31` > dateTo ? dateTo : `${year}-12-31`
        const slice = rows.filter((r) => r.price_date >= from && r.price_date <= to)
        const result = runAttributionForRows(
          slice, navType, indexSeries, excessMode, hasBenchmark, benchmarkSeries, factorModel,
        )
        if (!result) return null
        return attributionToSensitivityColumn(result, `year-${year}`, `${year}年`, false)
      })
      .filter((col): col is NonNullable<typeof col> => col !== null)

    const quarterlyPeriodCols = listQuartersInRange(dateFrom, dateTo)
      .map((qKey) => {
        const bounds = quarterBounds(qKey, dateFrom, dateTo)
        if (!bounds) return null
        const slice = rows.filter((r) => r.price_date >= bounds.from && r.price_date <= bounds.to)
        const result = runAttributionForRows(
          slice, navType, indexSeries, excessMode, hasBenchmark, benchmarkSeries, factorModel,
        )
        if (!result) return null
        const [, year, quarter] = qKey.match(/^(\d{4})-Q(\d)$/) ?? []
        const label = year && quarter ? `${year}Q${quarter}` : qKey
        return attributionToSensitivityColumn(result, `quarter-${qKey}`, label, false)
      })
      .filter((col): col is NonNullable<typeof col> => col !== null)

    const intervalCol = attributionToSensitivityColumn(attribution, "interval", "归因区间", true)

    return {
      annualColumns: [...annualPeriodCols, intervalCol],
      quarterlyColumns: [...quarterlyPeriodCols, intervalCol],
    }
  }, [attribution, loading, rows, navType, indexSeries, excessMode, hasBenchmark, benchmarkSeries, dateFrom, dateTo, factorModel])

  const maxAbsCoeff = useMemo(
    () => Math.max(...(attribution?.factors.map((f) => Math.abs(f.coefficient)) ?? [1]), 0.01),
    [attribution],
  )

  const chartData = useMemo(
    () => attribution?.explainedReturns ?? [],
    [attribution],
  )

  const chartDomain = useMemo(() => {
    if (!chartData.length) return [-10, 70] as [number, number]
    const vals = chartData.flatMap((p) => [p.productReturn, p.factorReturn])
    const min = Math.min(...vals, -5)
    const max = Math.max(...vals, 5)
    const pad = (max - min) * 0.08
    const lo = Math.floor((min - pad) / 10) * 10
    const hi = Math.ceil((max + pad) / 10) * 10
    return [lo, hi] as [number, number]
  }, [chartData])

  const xTicks = useMemo(() => pickYearTicks(chartData.map((p) => p.date)), [chartData])

  const contributionBars = useMemo(
    () => attribution?.factorContributions ?? [],
    [attribution],
  )

  const contributionLineKeys = useMemo(() => {
    if (!attribution) return []
    return [
      { key: "idiosyncratic", name: "特质因子", color: RED },
      ...attribution.factors.slice(0, 5).map((f, i) => ({
        key: f.factorKey,
        name: f.factorName,
        color: ["#2563eb", "#f97316", "#8b5cf6", "#14b8a6", "#eab308"][i] ?? "#71717a",
      })),
    ]
  }, [attribution])

  const contributionBarDomain = useMemo((): [number, number] => {
    if (!contributionBars.length) return [-10, 40]
    const vals = contributionBars.map((b) => b.contributionPct)
    const min = Math.min(...vals, -5)
    const max = Math.max(...vals, 5)
    const pad = Math.max((max - min) * 0.1, 2)
    const lo = Math.floor((min - pad) / 10) * 10
    const hi = Math.ceil((max + pad) / 10) * 10
    return [lo, hi]
  }, [contributionBars])

  const contributionLineDomain = useMemo((): [number, number] => {
    const series = attribution?.factorContributionSeries ?? []
    if (!series.length) return [-10, 40]
    const vals = series.flatMap((p) =>
      contributionLineKeys.map((k) => Number(p[k.key] ?? 0)),
    )
    const min = Math.min(...vals, -5)
    const max = Math.max(...vals, 5)
    const pad = Math.max((max - min) * 0.1, 2)
    const lo = Math.floor((min - pad) / 10) * 10
    const hi = Math.ceil((max + pad) / 10) * 10
    return [lo, hi]
  }, [attribution, contributionLineKeys])

  const contributionLineTicks = useMemo(
    () => pickYearTicks(attribution?.factorContributionSeries.map((p) => p.date) ?? []),
    [attribution],
  )

  const riskContributionBars = useMemo(
    () => attribution?.factorRiskContributions ?? [],
    [attribution],
  )

  const riskContributionDomain = useMemo((): [number, number] => {
    if (!riskContributionBars.length) return [0, 25]
    const max = Math.max(...riskContributionBars.map((b) => b.contributionPct), 1)
    const hi = Math.ceil((max * 1.1) / 5) * 5
    return [0, hi]
  }, [riskContributionBars])

  const exportRegressionCsv = useCallback(() => {
    if (!attribution) return
    const headers = ["序号", "因子名称", "收益敏感度(回归系数)", "标准误差", "t", "P>|t|", "相关系数"]
    const csvRows = attribution.factors.map((f) => [
      String(f.index),
      f.factorName,
      fmtNum(f.coefficient),
      fmtNum(f.stdError),
      fmtNum(f.tStat),
      fmtNum(f.pValue),
      fmtNum(f.correlation),
    ])
    const escape = (v: string) => (v.includes(",") || v.includes("\"") ? `"${v.replace(/"/g, "\"\"")}"` : v)
    const bom = "\uFEFF"
    const blob = new Blob(
      [bom + [headers, ...csvRows].map((r) => r.map(escape).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8;" },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${productName}_区间因子回归分析_${dateFrom}_${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [attribution, productName, dateFrom, dateTo])

  if (rows.length < 30) {
    return (
      <div className="min-h-[320px] flex items-center justify-center text-sm text-zinc-400">
        净值数据不足，无法进行归因分析（至少需要 30 个净值点）
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 leading-relaxed">
        {factorModel === "multi-asset"
          ? "当前为多资产大类归因：用权益/债券/黄金/商品指数收益对产品净值做回归，解释大类风险暴露，并非持仓还原，仅供参考。"
          : "当前为商品 CTA 风格归因：因子由南华商品指数体系构造，适用于期货/CTA 策略；用于非商品策略时解释力可能很弱，仅供参考。"}
      </div>

      <div className="rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-1">
              <span className="inline-block w-1 self-stretch rounded-full bg-red-500" />
              {factorModel === "multi-asset" ? "多资产大类归因分析" : "商品CTA风格归因分析"}
            </div>
            <div className="text-xs text-zinc-500 pl-3 tabular-nums">
              归因区间：{dateRangeLabel}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {showFactorModelSelect && (
              <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600">
                因子模型
                <select
                  value={factorModel}
                  onChange={(e) => setFactorModel(e.target.value as AttributionFactorModel)}
                  className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-300"
                >
                  <option value="multi-asset">多资产大类（FOF/综合）</option>
                  <option value="commodity-cta">商品CTA风格</option>
                </select>
              </label>
            )}
            <CheckboxToggle
              checked={excessMode}
              onChange={() => setExcessMode((v) => !v)}
              label="超额收益"
            />
          </div>
        </div>

        <div ref={tableRef}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
              区间因子回归分析
              <CalcExplanationButton section="regression" factorModel={factorModel} label="区间因子回归分析说明" />
            </div>
            <button
              type="button"
              onClick={exportRegressionCsv}
              disabled={!attribution}
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-40 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              导出
            </button>
          </div>

          {loading ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-zinc-400">
              加载因子数据中…
            </div>
          ) : !attribution ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-zinc-400">
              无法完成回归分析，请检查净值区间与因子数据
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mb-4 text-xs text-zinc-600">
                <span>R²：<span className="tabular-nums font-medium text-zinc-800">{fmtNum(attribution.summary.rSquared)}</span></span>
                <span>回归方法：<span className="text-zinc-800">{attribution.summary.method}</span></span>
                <span>净值数量：<span className="tabular-nums text-zinc-800">{attribution.summary.navCount}</span></span>
                <span>调整R²：<span className="tabular-nums font-medium text-zinc-800">{fmtNum(attribution.summary.adjRSquared)}</span></span>
                <span>F统计量：<span className="tabular-nums font-medium text-zinc-800">{fmtNum(attribution.summary.fStat)}</span></span>
                <span>概率(F-统计量)：<span className="tabular-nums font-medium text-zinc-800">{fmtNum(attribution.summary.fProb)}</span></span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-100 text-zinc-500">
                      <th className="py-2 pr-3 text-left font-medium w-10">序号</th>
                      <th className="py-2 pr-3 text-left font-medium min-w-[140px]">因子名称</th>
                      <th className="py-2 pr-3 text-left font-medium min-w-[180px]">收益敏感度(回归系数)</th>
                      <th className="py-2 pr-3 text-right font-medium">标准误差</th>
                      <th className="py-2 pr-3 text-right font-medium">t</th>
                      <th className="py-2 pr-3 text-right font-medium">P&gt;|t|</th>
                      <th className="py-2 text-right font-medium">相关系数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attribution.factors.map((row) => (
                      <tr key={row.factorKey} className="border-b border-zinc-50 hover:bg-zinc-50/60">
                        <td className="py-2.5 pr-3 tabular-nums text-zinc-500">{row.index}</td>
                        <td className="py-2.5 pr-3 text-zinc-800">{row.factorName}</td>
                        <td className="py-2.5 pr-3">
                          <CoeffBar value={row.coefficient} maxAbs={maxAbsCoeff} />
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-zinc-700">{fmtNum(row.stdError)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-zinc-700">{fmtNum(row.tStat)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-zinc-700">{fmtNum(row.pValue)}</td>
                        <td className="py-2.5 text-right tabular-nums text-zinc-700">{fmtNum(row.correlation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <div ref={chartRef} className="rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-1">
              <span className="inline-block w-1 self-stretch rounded-full bg-red-500" />
              风格因子解释
            </div>
            <div className="flex items-center gap-1 text-xs text-zinc-600 pl-3">
              区间因子解释收益率
              <CalcExplanationButton section="explained" factorModel={factorModel} label="区间因子解释收益率说明" />
            </div>
          </div>
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
              <DropdownMenuItem
                onClick={() => chartRef.current && downloadPanelImage(chartRef.current, `${productName}_风格因子解释_${dateFrom}_${dateTo}.png`)}
              >
                下载图片
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {attribution && chartData.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-4 mb-3 text-xs pl-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-5 h-0.5 rounded" style={{ backgroundColor: RED }} />
                产品收益率 {fmtPct(attribution.productTotalReturn)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-5 h-0.5 rounded bg-blue-600" />
                因子贡献收益率 {fmtPct(attribution.factorTotalReturn)}
              </span>
              <span className="text-zinc-400">
                特异因子贡献收益率 {fmtPct(attribution.idiosyncraticTotalReturn)}
              </span>
            </div>

            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatAxisDate}
                    ticks={xTicks}
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    axisLine={{ stroke: "#e4e4e7" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `${v}%`}
                    domain={chartDomain}
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    label={{ value: "收益率", angle: -90, position: "insideLeft", offset: 12, fontSize: 11, fill: "#a1a1aa" }}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [fmtPct(value), name]}
                    labelFormatter={(label) => String(label)}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="productReturn"
                    name="产品收益率"
                    stroke={RED}
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="factorReturn"
                    name="因子贡献收益率"
                    stroke="#2563eb"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <div className="h-[320px] flex items-center justify-center text-sm text-zinc-400">
            {loading ? "加载中…" : "暂无解释收益率数据"}
          </div>
        )}
      </div>

      <div ref={contributionRef} className="rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-1">
              <span className="inline-block w-1 self-stretch rounded-full bg-red-500" />
              区间因子收益率贡献
              <CalcExplanationButton section="contribution" factorModel={factorModel} label="区间因子收益率贡献说明" />
            </div>
            <div className="text-xs text-zinc-500 pl-3">因子贡献收益率</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="inline-flex text-xs border border-zinc-200 rounded overflow-hidden">
              <button
                type="button"
                onClick={() => setContributionChartMode("bar")}
                className={`px-2 py-1 transition-colors ${
                  contributionChartMode === "bar"
                    ? "bg-red-50 text-red-600"
                    : "bg-white text-zinc-400 hover:text-zinc-600"
                }`}
                aria-label="柱状图"
              >
                <BarChart3 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setContributionChartMode("line")}
                className={`px-2 py-1 transition-colors border-l border-zinc-200 ${
                  contributionChartMode === "line"
                    ? "bg-red-50 text-red-600"
                    : "bg-white text-zinc-400 hover:text-zinc-600"
                }`}
                aria-label="折线图"
              >
                <LineChartIcon className="h-3.5 w-3.5" />
              </button>
            </div>
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
                <DropdownMenuItem
                  onClick={() => contributionRef.current && downloadPanelImage(
                    contributionRef.current,
                    `${productName}_区间因子收益率贡献_${dateFrom}_${dateTo}.png`,
                  )}
                >
                  下载图片
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {attribution && contributionBars.length > 0 ? (
          <div style={{ height: 360 }}>
            <ResponsiveContainer width="100%" height="100%">
              {contributionChartMode === "bar" ? (
                <BarChart
                  data={contributionBars}
                  margin={{ top: 12, right: 16, left: 0, bottom: 72 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "#a1a1aa" }}
                    angle={-45}
                    textAnchor="end"
                    height={72}
                    interval={0}
                    axisLine={{ stroke: "#e4e4e7" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `${v}%`}
                    domain={contributionBarDomain}
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <ReferenceLine y={0} stroke="#d4d4d8" />
                  <Tooltip
                    formatter={(value: number) => [fmtPct(value), "因子贡献收益率"]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="contributionPct" name="因子贡献收益率" maxBarSize={28}>
                    {contributionBars.map((entry) => (
                      <Cell
                        key={entry.key}
                        fill={entry.contributionPct >= 0 ? RED : GREEN}
                      />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <LineChart
                  data={attribution.factorContributionSeries}
                  margin={{ top: 12, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatAxisDate}
                    ticks={contributionLineTicks}
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    axisLine={{ stroke: "#e4e4e7" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `${v}%`}
                    domain={contributionLineDomain}
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <ReferenceLine y={0} stroke="#d4d4d8" />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      const label = contributionLineKeys.find((k) => k.key === name)?.name ?? name
                      return [fmtPct(value), label]
                    }}
                    labelFormatter={(label) => String(label)}
                    contentStyle={{ fontSize: 12 }}
                  />
                  {contributionLineKeys.map((k) => (
                    <Line
                      key={k.key}
                      type="monotone"
                      dataKey={k.key}
                      name={k.name}
                      stroke={k.color}
                      strokeWidth={1.5}
                      dot={false}
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[360px] flex items-center justify-center text-sm text-zinc-400">
            {loading ? "加载中…" : "暂无因子贡献数据"}
          </div>
        )}
      </div>

      <div ref={riskContributionRef} className="rounded-xl border border-zinc-100 bg-white p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-1">
              <span className="inline-block w-1 self-stretch rounded-full bg-red-500" />
              区间因子风险贡献
              <CalcExplanationButton section="riskContribution" factorModel={factorModel} label="区间因子风险贡献说明" />
            </div>
            <div className="text-xs text-zinc-500 pl-3">因子贡献年化波动率</div>
          </div>
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
              <DropdownMenuItem
                onClick={() => riskContributionRef.current && downloadPanelImage(
                  riskContributionRef.current,
                  `${productName}_区间因子风险贡献_${dateFrom}_${dateTo}.png`,
                )}
              >
                下载图片
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {attribution && riskContributionBars.length > 0 ? (
          <div style={{ height: 360 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={riskContributionBars}
                margin={{ top: 12, right: 16, left: 0, bottom: 72 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: "#a1a1aa" }}
                  angle={-45}
                  textAnchor="end"
                  height={72}
                  interval={0}
                  axisLine={{ stroke: "#e4e4e7" }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `${v}%`}
                  domain={riskContributionDomain}
                  tick={{ fontSize: 11, fill: "#a1a1aa" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  formatter={(value: number) => [fmtPct(value), "因子贡献年化波动率"]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="contributionPct" name="因子贡献年化波动率" fill={RED} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[360px] flex items-center justify-center text-sm text-zinc-400">
            {loading ? "加载中…" : "暂无因子风险贡献数据"}
          </div>
        )}
      </div>

      <FactorSensitivityTrendPanel
        productName={productName}
        dateFrom={dateFrom}
        dateTo={dateTo}
        trend={sensitivityTrend}
        loading={loading}
        factorDefs={factorDefs}
        factorModel={factorModel}
      />
    </div>
  )
})
