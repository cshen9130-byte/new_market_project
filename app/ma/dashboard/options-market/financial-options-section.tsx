"use client"

import { useCallback, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useChartAutoRefresh } from "@/hooks/use-chart-auto-refresh"
import { underlyingCnLabel } from "@/lib/option-iv-labels"
import { cn } from "@/lib/utils"

const CHART_FONT = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif"

const COLORS = {
  blue: "#2563eb",
  purple: "#7c3aed",
  teal: "#0f766e",
  orange: "#ea580c",
  sky: "#0ea5e9",
  call: "#22c55e",
  put: "#ef4444",
  callBar: "rgba(134,239,172,0.85)",
  putBar: "rgba(252,165,165,0.85)",
  viridis: ["#440154", "#31688e", "#35b779", "#6ece58", "#fde725"],
} as const

function chartBase() {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: CHART_FONT, fontSize: 11 },
  }
}

/** Sparse date ticks for long QVIX / percentile series (~5 years). */
function timeSeriesXAxis(dates: string[]) {
  const n = dates.length
  const tickCount = n > 200 ? 8 : n > 100 ? 10 : n > 50 ? 12 : undefined
  const step = tickCount ? Math.max(1, Math.ceil(n / tickCount)) : 1

  return {
    type: "category" as const,
    data: dates,
    boundaryGap: false,
    axisLabel: {
      fontSize: 10,
      fontFamily: CHART_FONT,
      hideOverlap: true,
      interval: tickCount ? (index: number) => index % step === 0 || index === n - 1 : "auto",
      formatter: (value: string) => {
        if (n > 80 && value.length >= 7) return value.slice(0, 7) // YYYY-MM
        if (n > 40 && value.length >= 10) return value.slice(2) // YY-MM-DD
        return value
      },
    },
  }
}

type ChartPoint = Record<string, number | string | null | undefined>

type SmileData = {
  spot: number
  expiry_date: string
  days_to_expiry: number
  expiry_code: string
  points: ChartPoint[]
}

type SurfaceData = {
  strikes: number[]
  days_to_expiry: number[]
  heatmap: (number | null)[][]
  scatter?: Array<{ strike: number | null; days_to_expiry: number | null; iv: number | null }>
}

const IvSurface3DChart = dynamic(
  () => import("@/components/charts/iv-surface-3d-chart"),
  { ssr: false, loading: () => <div className="h-[440px] flex items-center justify-center text-muted-foreground text-sm">加载 3D 曲面…</div> },
)

type PercentileData = {
  latest_iv: number | null
  percentile_all: number | null
  percentile_1y: number | null
  series: ChartPoint[]
}

type UnderlyingPayload = {
  key: string
  label: string
  short_label?: string
  group?: string
  spot: number | null
  current_iv: number | null
  percentile_all: number | null
  percentile_1y: number | null
  charts?: {
    term_structure?: ChartPoint[] | null
    smile?: SmileData | null
    smile_chain?: SmileData | null
    surface?: SurfaceData | null
    history?: ChartPoint[] | null
    percentile?: PercentileData | null
  }
}

type SummaryRow = {
  group_label: string
  keys: string[]
  iv_display: string
  percentile: number | null
  percentile_display?: string | null
  products: Array<{
    key: string
    label: string
    current_iv: number | null
    percentile_all: number | null
  }>
}

type FinancialPayload = {
  trade_date: string
  summary: SummaryRow[]
  underlyings: Record<string, UnderlyingPayload>
}

const GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: "上证50", keys: ["50etf", "50index"] },
  { label: "沪深300", keys: ["300etf", "300etf_sz", "300index"] },
  { label: "中证500", keys: ["500etf", "500etf_sz"] },
  { label: "中证1000", keys: ["1000index"] },
  { label: "创业板", keys: ["cyb"] },
  { label: "科创50", keys: ["kcb", "kcb_efund"] },
  { label: "深证100", keys: ["100etf"] },
]

function pctLabel(v: number | null | undefined) {
  if (v == null) return "—"
  if (v >= 80) return "偏高"
  if (v >= 60) return "较高"
  if (v >= 40) return "中性"
  if (v >= 20) return "较低"
  return "偏低"
}

function pctColor(v: number | null | undefined) {
  if (v == null) return "text-muted-foreground"
  if (v >= 80) return "text-red-600"
  if (v >= 60) return "text-orange-600"
  if (v >= 40) return "text-foreground"
  if (v >= 20) return "text-emerald-600"
  return "text-blue-600"
}

function buildHistoryOption(series: ChartPoint[]) {
  const dates = series.map((d) => String(d.trade_date))
  const ivs = series.map((d) => d.iv as number | null)
  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
    grid: { left: 48, right: 24, top: 24, bottom: 36 },
    xAxis: timeSeriesXAxis(dates),
    yAxis: {
      type: "value",
      name: "IV (%)",
      nameTextStyle: { fontFamily: CHART_FONT },
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.15 } },
    },
    series: [{
      name: "QVIX",
      type: "line",
      data: ivs,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color: COLORS.purple },
      areaStyle: { color: "rgba(124,58,237,0.12)" },
      itemStyle: { color: COLORS.purple },
    }],
  }
}

function buildPercentileOption(data: PercentileData) {
  const series = data.series ?? []
  const dates = series.map((d) => String(d.trade_date))
  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
    legend: {
      data: ["IV", "全历史分位", "1Y滚动分位"],
      top: 0,
      left: "center",
      itemWidth: 14,
      itemGap: 16,
      textStyle: { fontSize: 11, fontFamily: CHART_FONT },
    },
    grid: { left: 48, right: 48, top: 36, bottom: 36 },
    xAxis: timeSeriesXAxis(dates),
    yAxis: [
      {
        type: "value",
        name: "IV (%)",
        nameTextStyle: { fontFamily: CHART_FONT },
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
        splitLine: { lineStyle: { opacity: 0.15 } },
      },
      {
        type: "value",
        name: "分位 (%)",
        min: 0,
        max: 100,
        nameTextStyle: { fontFamily: CHART_FONT },
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "IV",
        type: "line",
        data: series.map((d) => d.iv),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: COLORS.teal },
        itemStyle: { color: COLORS.teal },
      },
      {
        name: "全历史分位",
        type: "line",
        yAxisIndex: 1,
        data: series.map((d) => d.percentile_all),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: COLORS.blue },
        itemStyle: { color: COLORS.blue },
      },
      {
        name: "1Y滚动分位",
        type: "line",
        yAxisIndex: 1,
        data: series.map((d) => d.percentile_1y),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: COLORS.orange, type: "dashed" },
        itemStyle: { color: COLORS.orange },
      },
    ],
  }
}

function buildTermStructureOption(points: ChartPoint[]) {
  const sorted = [...points].sort(
    (a, b) => Number(a.days_to_expiry ?? 0) - Number(b.days_to_expiry ?? 0),
  )
  const pairs = sorted.map((d) => [Number(d.days_to_expiry), Number(d.iv)] as [number, number])
  const labels = sorted.map((d) => String(d.expiry_date ?? ""))

  const ivs = pairs.map((p) => p[1])
  const ivMin = Math.min(...ivs)
  const ivMax = Math.max(...ivs)
  const ivPad = Math.max(1, (ivMax - ivMin) * 0.12)

  return {
    ...chartBase(),
    tooltip: {
      trigger: "item",
      textStyle: { fontFamily: CHART_FONT },
      formatter: (p: { data: [number, number]; dataIndex: number }) => {
        const [days, iv] = p.data
        return `${labels[p.dataIndex] ?? ""}<br/>${days}D · IV ${iv.toFixed(2)}%`
      },
    },
    grid: { left: 56, right: 24, top: 40, bottom: 48 },
    xAxis: {
      type: "value",
      name: "Days to Expiry",
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { fontFamily: CHART_FONT, fontSize: 11 },
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.12 } },
    },
    yAxis: {
      type: "value",
      name: "ATM Implied Volatility (%)",
      nameTextStyle: { fontFamily: CHART_FONT, fontSize: 11 },
      min: Math.floor(ivMin - ivPad),
      max: Math.ceil(ivMax + ivPad),
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.15 } },
    },
    series: [{
      type: "line",
      data: pairs,
      symbol: "circle",
      symbolSize: 8,
      lineStyle: { width: 2, color: COLORS.blue },
      itemStyle: { color: COLORS.blue },
      label: {
        show: true,
        position: "top",
        distance: 6,
        fontSize: 9,
        fontFamily: CHART_FONT,
        color: "#64748b",
        formatter: (p: { dataIndex: number }) => labels[p.dataIndex] ?? "",
      },
      labelLayout: { hideOverlap: true },
    }],
  }
}

function strikeLabelPrecision(spot: number) {
  if (spot >= 1000) return 0
  if (spot >= 100) return 1
  if (spot >= 10) return 2
  return 3
}

function formatStrike(value: number, spot: number) {
  return value.toFixed(strikeLabelPrecision(spot))
}

/** Padding that scales with strike range / spot — not a fixed tick count. */
function strikeAxisPadding(strikeMin: number, strikeMax: number, spot: number) {
  const range = strikeMax - strikeMin
  if (range > 0) return range * 0.04
  return Math.max(spot * 0.04, 0.05)
}

function dropIvCliffs<T extends { strike: number; iv: number }>(points: T[], maxJump = 12): T[] {
  if (points.length < 3) return points
  const keep = points.map(() => true)
  for (let i = 0; i < points.length - 1; i++) {
    const jump = Math.abs(points[i + 1].iv - points[i].iv)
    if (jump <= maxJump) continue
    if (i === 0) {
      keep[i] = false
    } else if (i + 1 === points.length - 1) {
      keep[i + 1] = false
    } else {
      const left = Math.abs(points[i].iv - points[i - 1].iv)
      const right = i + 2 < points.length ? Math.abs(points[i + 1].iv - points[i + 2].iv) : Infinity
      keep[left >= right ? i : i + 1] = false
    }
  }
  return points.filter((_, idx) => keep[idx])
}

function niceIvAxisBounds(ivMin: number, ivMax: number) {
  const range = Math.max(ivMax - ivMin, 0.5)
  const pad = Math.max(range * 0.08, 0.5)
  let lo = ivMin - pad
  let hi = ivMax + pad
  const step = range <= 3 ? 0.5 : range <= 8 ? 1 : 2
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  return { min: lo, max: hi, decimals: step < 1 ? 1 : 0 }
}

function buildSmileOption(data: SmileData) {
  const points = dropIvCliffs(
    data.points
      .map((d) => ({
        strike: Number(d.strike),
        iv: Number(d.iv),
        optionType: String(d.option_type ?? ""),
      }))
      .filter((p) => Number.isFinite(p.strike) && Number.isFinite(p.iv))
      .sort((a, b) => a.strike - b.strike),
  )

  if (!points.length) return null

  const spot = data.spot
  const seriesData = points.map((p) => [p.strike, p.iv] as [number, number])

  const allStrikes = points.map((p) => p.strike)
  const allIvs = points.map((p) => p.iv)
  const strikeMin = Math.min(...allStrikes)
  const strikeMax = Math.max(...allStrikes)
  const strikePad = strikeAxisPadding(strikeMin, strikeMax, spot)
  const ivBounds = niceIvAxisBounds(Math.min(...allIvs), Math.max(...allIvs))
  const strikeFmt = (value: number) => formatStrike(value, spot)
  const ivFmt = (value: number) => value.toFixed(ivBounds.decimals)

  return {
    ...chartBase(),
    tooltip: {
      trigger: "axis",
      textStyle: { fontFamily: CHART_FONT },
      formatter: (params: Array<{ data: [number, number] }>) => {
        if (!Array.isArray(params) || !params.length) return ""
        const p = params.find((item) => item.data?.[0] != null)
        if (!p) return ""
        return `K=${strikeFmt(p.data[0])}<br/>IV ${p.data[1].toFixed(2)}%`
      },
    },
    grid: { left: 52, right: 24, top: 16, bottom: 48 },
    xAxis: {
      type: "value",
      name: "行权价",
      min: strikeMin - strikePad,
      max: strikeMax + strikePad,
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { fontFamily: CHART_FONT, fontSize: 11 },
      axisLabel: {
        fontSize: 10,
        fontFamily: CHART_FONT,
        formatter: (value: number) => strikeFmt(value),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "IV (%)",
      min: ivBounds.min,
      max: ivBounds.max,
      nameTextStyle: { fontFamily: CHART_FONT },
      axisLabel: {
        fontSize: 10,
        fontFamily: CHART_FONT,
        formatter: (value: number) => ivFmt(value),
      },
      splitLine: { lineStyle: { opacity: 0.15 } },
    },
    series: [{
      name: "OTM IV",
      type: "line",
      data: seriesData,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2, color: COLORS.purple },
      itemStyle: { color: COLORS.purple },
      markLine: {
        silent: true,
        symbol: "none",
        lineStyle: { color: COLORS.sky, type: "solid", width: 1.5 },
        label: {
          fontFamily: CHART_FONT,
          fontSize: 10,
          position: "insideEndTop",
          formatter: `Spot ${strikeFmt(spot)}`,
        },
        data: [{ xAxis: spot }],
      },
    }],
  }
}

function buildChainSmileOption(data: SmileData) {
  const strikes = data.points.map((d) => d.strike as number)
  const ivs = data.points.map((d) => d.iv as number)
  const callOi = data.points.map((d) => (d.call_oi as number) ?? 0)
  const putOi = data.points.map((d) => (d.put_oi as number) ?? 0)
  const hasOi = callOi.some((v) => v > 0) || putOi.some((v) => v > 0)

  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
    legend: hasOi ? { data: ["IV", "Call OI", "Put OI"], bottom: 0, textStyle: { fontSize: 11, fontFamily: CHART_FONT } } : undefined,
    grid: { left: 48, right: hasOi ? 56 : 24, top: 24, bottom: hasOi ? 56 : 48 },
    xAxis: { type: "category", data: strikes.map(String), name: "行权价", nameTextStyle: { fontFamily: CHART_FONT }, axisLabel: { fontSize: 10, fontFamily: CHART_FONT } },
    yAxis: [
      {
        type: "value",
        name: "IV (%)",
        nameTextStyle: { fontFamily: CHART_FONT },
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
        splitLine: { lineStyle: { opacity: 0.15 } },
      },
      ...(hasOi
        ? [{
            type: "value" as const,
            name: "持仓量",
            nameTextStyle: { fontFamily: CHART_FONT },
            axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
            splitLine: { show: false },
          }]
        : []),
    ],
    series: [
      {
        name: "IV",
        type: "line",
        data: ivs,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2, color: COLORS.purple },
        itemStyle: { color: COLORS.purple },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: COLORS.sky, width: 1.5 },
          data: [{ xAxis: strikes.reduce((best, s, i) => Math.abs(s - data.spot) < Math.abs(strikes[best] - data.spot) ? i : best, 0), label: { show: false } }],
        },
      },
      ...(hasOi
        ? [
            {
              name: "Put OI",
              type: "bar" as const,
              yAxisIndex: 1,
              data: putOi,
              itemStyle: { color: COLORS.putBar },
              barMaxWidth: 16,
            },
            {
              name: "Call OI",
              type: "bar" as const,
              yAxisIndex: 1,
              data: callOi,
              itemStyle: { color: COLORS.callBar },
              barMaxWidth: 16,
            },
          ]
        : []),
    ],
  }
}

export default function FinancialOptionsSection() {
  const [payload, setPayload] = useState<FinancialPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeGroup, setActiveGroup] = useState(GROUPS[0].label)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const load = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/ma/api/options/financial?ts=${Date.now()}`, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok || !json.underlyings) throw new Error(json.error || "failed")
      setPayload(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "数据不可用")
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useChartAutoRefresh(load, [])

  const currentGroup = GROUPS.find((g) => g.label === activeGroup) ?? GROUPS[0]
  const availableKeys = useMemo(
    () => currentGroup.keys.filter((k) => payload?.underlyings[k]),
    [currentGroup.keys, payload],
  )

  const selectedKey = activeKey && availableKeys.includes(activeKey)
    ? activeKey
    : availableKeys[0] ?? null

  const selected = selectedKey ? payload?.underlyings[selectedKey] : null
  const charts = selected?.charts

  const historyOption = useMemo(
    () => (charts?.history?.length ? buildHistoryOption(charts.history) : null),
    [charts?.history],
  )
  const percentileOption = useMemo(
    () => (charts?.percentile ? buildPercentileOption(charts.percentile) : null),
    [charts?.percentile],
  )
  const termOption = useMemo(
    () => (charts?.term_structure?.length ? buildTermStructureOption(charts.term_structure) : null),
    [charts?.term_structure],
  )
  const smileOption = useMemo(
    () => (charts?.smile ? buildSmileOption(charts.smile) : null),
    [charts?.smile],
  )
  const chainOption = useMemo(
    () => (charts?.smile_chain ? buildChainSmileOption(charts.smile_chain) : null),
    [charts?.smile_chain],
  )

  if (loading && !payload) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        加载金融期权数据…
      </div>
    )
  }

  if (error && !payload) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <p>{error}</p>
          <p className="text-sm mt-2">请确认夜间 ETL 已运行 option_iv 步骤</p>
          <Button variant="outline" className="mt-4" onClick={() => load(true)}>重试</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {payload?.trade_date && (
        <p className="text-sm text-muted-foreground">数据日期：{payload.trade_date}</p>
      )}

      {/* IV Summary Table */}
      <Card>
        <CardHeader>
          <CardTitle>隐含波动率概览</CardTitle>
          <CardDescription>各品种当前 IV 与历史分位（QVIX 指数）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">品种</th>
                  <th className="py-3 pr-4 font-medium text-right">当前 IV</th>
                  <th className="py-3 pr-4 font-medium text-right">历史分位</th>
                  <th className="py-3 font-medium">分位评价</th>
                </tr>
              </thead>
              <tbody>
                {(payload?.summary ?? []).map((row) => (
                  <tr key={row.group_label} className="border-b last:border-0">
                    <td className="py-3 pr-4">
                      <div className="font-medium">{row.group_label}</div>
                      {row.products.length > 1 && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {row.products
                            .map((p) => {
                              const name = underlyingCnLabel(p.key, p.label)
                              const pct = p.percentile_all != null ? ` ${p.percentile_all.toFixed(0)}%` : ""
                              return `${name}${pct}`
                            })
                            .join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono">{row.iv_display}</td>
                    <td className={cn("py-3 pr-4 text-right font-mono", pctColor(row.percentile))}>
                      {row.percentile_display ?? (row.percentile != null ? `${row.percentile.toFixed(1)}%` : "—")}
                    </td>
                    <td className={cn("py-3", pctColor(row.percentile))}>
                      {pctLabel(row.percentile)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Product Selector */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {GROUPS.filter((g) => g.keys.some((k) => payload?.underlyings[k])).map((g) => (
            <Button
              key={g.label}
              variant={activeGroup === g.label ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setActiveGroup(g.label)
                setActiveKey(null)
              }}
            >
              {g.label}
            </Button>
          ))}
        </div>

        {availableKeys.length > 1 && (
          <div className="flex flex-wrap gap-2 pl-1">
            {availableKeys.map((key) => {
              const u = payload?.underlyings[key]
              return (
                <Button
                  key={key}
                  variant={selectedKey === key ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setActiveKey(key)}
                >
                  {underlyingCnLabel(key, u?.label)}
                </Button>
              )
            })}
          </div>
        )}
      </div>

      {selected && (
        <>
          {/* Key Metrics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">当前 IV</div>
                <div className="text-3xl font-semibold mt-1 font-mono">
                  {selected.current_iv != null ? `${selected.current_iv.toFixed(2)}%` : "—"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">全历史分位</div>
                <div className={cn("text-3xl font-semibold mt-1 font-mono", pctColor(selected.percentile_all))}>
                  {selected.percentile_all != null ? `${selected.percentile_all.toFixed(1)}%` : "—"}
                </div>
                <div className={cn("text-xs mt-1", pctColor(selected.percentile_all))}>
                  {pctLabel(selected.percentile_all)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">1Y 滚动分位</div>
                <div className="text-3xl font-semibold mt-1 font-mono">
                  {selected.percentile_1y != null ? `${selected.percentile_1y.toFixed(1)}%` : "—"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">标的价格</div>
                <div className="text-3xl font-semibold mt-1 font-mono">
                  {selected.spot != null ? selected.spot.toFixed(4) : "—"}
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  {selectedKey ? underlyingCnLabel(selectedKey, selected.label) : selected.label}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Section: Historical Analysis */}
          <div>
            <h2 className="text-lg font-semibold mb-4">历史波动率分析</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">QVIX 时序</CardTitle>
                  <CardDescription>ATM 隐含波动率指数（约 2 年）</CardDescription>
                </CardHeader>
                <CardContent>
                  {historyOption ? (
                    <ReactECharts option={historyOption} style={{ height: 300 }} notMerge lazyUpdate />
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">IV 分位分析</CardTitle>
                  <CardDescription>全历史与 1 年滚动分位</CardDescription>
                </CardHeader>
                <CardContent>
                  {percentileOption ? (
                    <ReactECharts option={percentileOption} style={{ height: 300 }} notMerge lazyUpdate />
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Section: Term Structure & Smile */}
          <div>
            <h2 className="text-lg font-semibold mb-4">截面波动率结构</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">IV 期限结构</CardTitle>
                  <CardDescription>各到期月 ATM 隐含波动率</CardDescription>
                </CardHeader>
                <CardContent>
                  {termOption ? (
                    <ReactECharts option={termOption} style={{ height: 300 }} notMerge lazyUpdate />
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">波动率微笑</CardTitle>
                  <CardDescription>
                    {charts?.smile
                      ? `${charts.smile.expiry_code} · ${charts.smile.days_to_expiry}D · OTM`
                      : "近月 OTM IV vs 行权价"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {smileOption ? (
                    <ReactECharts option={smileOption} style={{ height: 300 }} notMerge lazyUpdate />
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Section: Chain & Surface */}
          <div>
            <h2 className="text-lg font-semibold mb-4">期权链与波动率曲面</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">期权链微笑</CardTitle>
                  <CardDescription>
                    {charts?.smile_chain
                      ? `${charts.smile_chain.expiry_code} · ${charts.smile_chain.days_to_expiry}D · IV + 持仓量`
                      : "近月链 IV 与 OI 分布"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {chainOption ? (
                    <ReactECharts option={chainOption} style={{ height: 320 }} notMerge lazyUpdate />
                  ) : (
                    <div className="h-[320px] flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">IV 波动率曲面（3D）</CardTitle>
                  <CardDescription>行权价 × 到期天数 × 隐含波动率</CardDescription>
                </CardHeader>
                <CardContent>
                  {charts?.surface ? (
                    <IvSurface3DChart data={charts.surface} height={380} />
                  ) : (
                    <div className="h-[380px] flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
