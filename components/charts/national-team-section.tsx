"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DateInput } from "@/components/ui/date-input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { NATIONAL_TEAM_UNIVERSE_NOTE } from "@/lib/ma/national-team-universe"

type ChartMode = "bar" | "flow" | "scale_chg"

type Point = {
  date: string
  net_flow: number | null
  scale: number | null
  scale_chg: number | null
  scale_chg_pct: number | null
  purchase: number | null
  redeem: number | null
  index_sh: number | null
  index_csi300: number | null
  index_csi1000: number | null
  pool_count: number | null
}

type Summary = {
  start: string | null
  end: string | null
  trading_days: number
  net: number | null
  purch_days: number
  redeem_days: number
  purch_sum: number | null
  redeem_sum: number | null
  abs_sum: number | null
  avg_net: number | null
  max_purch: { date: string; value: number } | null
  max_redeem: { date: string; value: number } | null
  start_scale: number | null
  end_scale: number | null
}

type Payload = {
  bounds: { min: string | null; max: string | null; count: number }
  series: Point[]
  summary: Summary
  universe: { count: number | null; note: string }
  source?: string
  error?: string
}

const TAB_KEY = "ma-stock-national-team-chart-mode"
const CHART_PRESETS = [
  { id: "all", label: "全部" },
  { id: "3m", label: "3月" },
  { id: "6m", label: "6月" },
  { id: "1y", label: "1年" },
  { id: "3y", label: "3年" },
  { id: "5y", label: "5年" },
] as const

function fmtYi(v: number | null | undefined, digits = 1, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—"
  const abs = Math.abs(v).toFixed(digits)
  if (!signed) return abs
  if (v > 0) return `+${abs}`
  if (v < 0) return `-${abs}`
  return abs
}

function toneClass(v: number | null | undefined): string {
  if (v == null || v === 0) return "text-foreground"
  return v > 0 ? "text-red-500" : "text-emerald-600"
}

function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(y, m - 1 + months, d)
  const mm = String(dt.getMonth() + 1).padStart(2, "0")
  const dd = String(dt.getDate()).padStart(2, "0")
  return `${dt.getFullYear()}-${mm}-${dd}`
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

function monthEnd(year: number, month: number): string {
  const last = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`
}

function yearStart(year: number): string {
  return `${year}-01-01`
}

function yearEnd(year: number): string {
  return `${year}-12-31`
}

function clampRange(start: string, end: string, min?: string | null, max?: string | null): [string, string] {
  let s = start
  let e = end
  if (min && s < min) s = min
  if (max && s > max) s = max
  if (min && e < min) e = min
  if (max && e > max) e = max
  if (s > e) return [e, s]
  return [s, e]
}

function normalize(values: Array<number | null>): Array<number | null> {
  const first = values.find((v) => v != null && v !== 0)
  if (first == null) return values.map(() => null)
  return values.map((v) => (v == null ? null : v / first))
}

function finiteNums(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v))
}

/** Symmetric left axis; for 净申赎 use a 1000-wide floor so bars match the usual -1000~1000 frame. */
function valueAxisRange(values: Array<number | null | undefined>, floor = 0, nice = 200): { min: number; max: number } {
  const nums = finiteNums(values)
  const absMax = nums.length ? Math.max(...nums.map((v) => Math.abs(v))) : 0
  const pad = Math.max(floor, Math.ceil(absMax / nice) * nice || nice)
  return { min: -pad, max: pad }
}

function scaleAxisRange(values: Array<number | null | undefined>): { min: number; max: number } {
  const nums = finiteNums(values)
  const hi = nums.length ? Math.max(...nums) : 0
  return { min: 0, max: Math.max(1000, Math.ceil(hi / 1000) * 1000) }
}

function indexAxisRange(values: Array<number | null | undefined>): { min: number; max: number } {
  const nums = finiteNums(values)
  const lo = nums.length ? Math.min(...nums) : 1
  const hi = nums.length ? Math.max(...nums) : 1
  return {
    min: Math.min(0.75, Math.floor(lo * 20) / 20),
    max: Math.max(1.1, Math.ceil(hi * 20) / 20),
  }
}

function sameDay(a?: string | null, b?: string | null): boolean {
  return Boolean(a && b && a === b)
}

function summarizeClient(series: Point[], start: string, end: string): Summary {
  const sliced = series.filter((p) => p.date >= start && p.date <= end && p.net_flow != null)
  const empty: Summary = {
    start: start || null,
    end: end || null,
    trading_days: 0,
    net: null,
    purch_days: 0,
    redeem_days: 0,
    purch_sum: null,
    redeem_sum: null,
    abs_sum: null,
    avg_net: null,
    max_purch: null,
    max_redeem: null,
    start_scale: null,
    end_scale: null,
  }
  if (!sliced.length) return empty
  let net = 0
  let purchSum = 0
  let redeemSum = 0
  let purchDays = 0
  let redeemDays = 0
  let maxPurch: Summary["max_purch"] = null
  let maxRedeem: Summary["max_redeem"] = null
  for (const p of sliced) {
    const flow = p.net_flow ?? 0
    net += flow
    if (flow > 0) {
      purchDays += 1
      purchSum += flow
      if (!maxPurch || flow > maxPurch.value) maxPurch = { date: p.date, value: flow }
    } else if (flow < 0) {
      redeemDays += 1
      redeemSum += -flow
      if (!maxRedeem || -flow > maxRedeem.value) maxRedeem = { date: p.date, value: flow }
    }
  }
  return {
    start: sliced[0].date,
    end: sliced[sliced.length - 1].date,
    trading_days: sliced.length,
    net,
    purch_days: purchDays,
    redeem_days: redeemDays,
    purch_sum: purchSum,
    redeem_sum: redeemSum,
    abs_sum: purchSum + redeemSum,
    avg_net: net / sliced.length,
    max_purch: maxPurch,
    max_redeem: maxRedeem,
    start_scale: sliced[0].scale,
    end_scale: sliced[sliced.length - 1].scale,
  }
}

export default function NationalTeamSection() {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ChartMode>("flow")
  const [summaryStart, setSummaryStart] = useState("")
  const [summaryEnd, setSummaryEnd] = useState("")
  const [chartStart, setChartStart] = useState("")
  const [chartEnd, setChartEnd] = useState("")
  const [chartPreset, setChartPreset] = useState<string>("1y")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY)
      if (saved === "bar" || saved === "flow" || saved === "scale_chg") setMode(saved)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/ma/api/stock/national-team", { cache: "no-store" })
        const data = (await res.json()) as Payload
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (cancelled) return
        setPayload(data)
        const max = data.bounds.max
        const min = data.bounds.min
        if (max) {
          const ms = monthStart(max)
          const [ss, se] = clampRange(ms, max, min, max)
          setSummaryStart((v) => v || ss)
          setSummaryEnd((v) => v || se)
          const rawStart = shiftMonths(max, -12)
          const [cs, ce] = clampRange(rawStart, max, min, max)
          setChartStart((v) => v || cs)
          setChartEnd((v) => v || ce)
        }
        setReady(true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const series = payload?.series ?? []
  const bounds = payload?.bounds
  const summary = useMemo(
    () => (summaryStart && summaryEnd ? summarizeClient(series, summaryStart, summaryEnd) : payload?.summary),
    [series, summaryStart, summaryEnd, payload?.summary],
  )

  const chartSeries = useMemo(
    () => series.filter((p) => (!chartStart || p.date >= chartStart) && (!chartEnd || p.date <= chartEnd)),
    [series, chartStart, chartEnd],
  )

  const years = useMemo(() => {
    if (!bounds?.min || !bounds?.max) return []
    const ys: number[] = []
    for (let y = Number(bounds.min.slice(0, 4)); y <= Number(bounds.max.slice(0, 4)); y += 1) ys.push(y)
    return ys
  }, [bounds])

  const months = useMemo(() => {
    if (!bounds?.min || !bounds?.max) return []
    const out: string[] = []
    let y = Number(bounds.min.slice(0, 4))
    let m = Number(bounds.min.slice(5, 7))
    const endY = Number(bounds.max.slice(0, 4))
    const endM = Number(bounds.max.slice(5, 7))
    while (y < endY || (y === endY && m <= endM)) {
      out.push(`${y}-${String(m).padStart(2, "0")}`)
      m += 1
      if (m > 12) {
        m = 1
        y += 1
      }
    }
    return out
  }, [bounds])

  function applySummary(start: string, end: string) {
    const [s, e] = clampRange(start, end, bounds?.min, bounds?.max)
    setSummaryStart(s)
    setSummaryEnd(e)
  }

  function applyChartPreset(id: string) {
    setChartPreset(id)
    const max = bounds?.max
    const min = bounds?.min
    if (!max) return
    if (id === "all") {
      const [s, e] = clampRange(min || max, max, min, max)
      setChartStart(s)
      setChartEnd(e)
      return
    }
    const monthsBack = { "3m": 3, "6m": 6, "1y": 12, "3y": 36, "5y": 60 }[id] ?? 12
    const [s, e] = clampRange(shiftMonths(max, -monthsBack), max, min, max)
    setChartStart(s)
    setChartEnd(e)
  }

  const option = useMemo(() => {
    const dates = chartSeries.map((p) => p.date)
    const flow = chartSeries.map((p) => p.net_flow)
    const scale = chartSeries.map((p) => p.scale)
    const scaleChg = chartSeries.map((p) => p.scale_chg)
    const scalePct = chartSeries.map((p) => p.scale_chg_pct)
    const sh = normalize(chartSeries.map((p) => p.index_sh))
    const csi300 = normalize(chartSeries.map((p) => p.index_csi300))
    const csi1000 = normalize(chartSeries.map((p) => p.index_csi1000))

    const barValues = mode === "scale_chg" ? scalePct : mode === "bar" ? scaleChg : flow
    const barName = mode === "scale_chg" ? "规模环比(%)" : mode === "bar" ? "规模变动(亿元)" : "净申赎估算(亿元)"
    const leftName = mode === "scale_chg" ? "规模环比(%)" : mode === "bar" ? "规模变动(亿元)" : "净申赎(亿元)"
    const leftAxis = mode === "scale_chg"
      ? valueAxisRange(barValues, 2, 1)
      : valueAxisRange(barValues, 1000, 200)
    const rightScale = scaleAxisRange(scale)
    const rightIndex = indexAxisRange([...sh, ...csi300, ...csi1000])

    return {
      animation: false,
      color: ["#ef4444", "#14b8a6", "#94a3b8", "#f59e0b", "#8b5cf6"],
      legend: {
        top: 4,
        textStyle: { color: "#94a3b8", fontSize: 11 },
        data: [barName, "泛国家队总规模", "上证指数归一", "沪深300归一", "中证1000归一"],
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(15,23,42,0.92)",
        borderColor: "transparent",
        textStyle: { color: "#f8fafc", fontSize: 12 },
        formatter: (params: Array<{ seriesName: string; data: number | null; axisValue: string; marker: string }>) => {
          if (!params?.length) return ""
          const date = params[0].axisValue
          const lines = [`<b>${date}</b>`]
          for (const p of params) {
            const raw = p.data
            if (raw == null) continue
            const val = p.seriesName.includes("归一")
              ? Number(raw).toFixed(2)
              : p.seriesName.includes("%")
                ? `${Number(raw).toFixed(2)}%`
                : Number(raw).toFixed(2)
            lines.push(`${p.marker}${p.seriesName} <b>${val}</b>`)
          }
          return lines.join("<br/>")
        },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: { top: 48, right: 88, bottom: 36, left: 64 },
      xAxis: {
        type: "category",
        data: dates,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "#334155" } },
        axisLabel: { color: "#64748b", fontSize: 10, hideOverlap: true },
      },
      yAxis: [
        {
          type: "value",
          name: leftName,
          min: leftAxis.min,
          max: leftAxis.max,
          nameTextStyle: { color: "#64748b", fontSize: 11 },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: "#64748b",
            fontSize: 10,
            formatter: (v: number) => (mode === "scale_chg" ? `${v}` : `${v}`),
          },
          splitLine: { lineStyle: { color: "#1e293b", type: "dashed" } },
        },
        {
          type: "value",
          name: "规模(亿元)",
          min: rightScale.min,
          max: rightScale.max,
          nameTextStyle: { color: "#64748b", fontSize: 11 },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: "#64748b", fontSize: 10 },
          splitLine: { show: false },
        },
        {
          type: "value",
          name: "指数归一",
          min: rightIndex.min,
          max: rightIndex.max,
          nameTextStyle: { color: "#64748b", fontSize: 11 },
          offset: 52,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: "#64748b", fontSize: 10, formatter: (v: number) => v.toFixed(2) },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: barName,
          type: "bar",
          yAxisIndex: 0,
          data: barValues.map((v) => ({
            value: v,
            itemStyle: {
              color: v == null || v === 0 ? "#64748b" : v > 0 ? "#ef4444" : "#10b981",
              opacity: 0.88,
            },
          })),
          barMaxWidth: 14,
        },
        {
          name: "泛国家队总规模",
          type: "line",
          yAxisIndex: 1,
          data: scale,
          showSymbol: false,
          lineStyle: { width: 1.8, color: "#14b8a6" },
          itemStyle: { color: "#14b8a6" },
        },
        {
          name: "上证指数归一",
          type: "line",
          yAxisIndex: 2,
          data: sh,
          showSymbol: false,
          lineStyle: { width: 1.2, type: "dashed", color: "#94a3b8" },
          itemStyle: { color: "#94a3b8" },
        },
        {
          name: "沪深300归一",
          type: "line",
          yAxisIndex: 2,
          data: csi300,
          showSymbol: false,
          lineStyle: { width: 1.2, type: "dashed", color: "#f59e0b" },
          itemStyle: { color: "#f59e0b" },
        },
        {
          name: "中证1000归一",
          type: "line",
          yAxisIndex: 2,
          data: csi1000,
          showSymbol: false,
          lineStyle: { width: 1.2, type: "dashed", color: "#8b5cf6" },
          itemStyle: { color: "#8b5cf6" },
        },
      ],
    }
  }, [chartSeries, mode])

  const monthValue = (() => {
    if (!summaryStart || !summaryEnd) return undefined
    const ym = summaryStart.slice(0, 7)
    const [y, m] = ym.split("-").map(Number)
    const [ms, me] = clampRange(monthStart(`${ym}-01`), monthEnd(y, m), bounds?.min, bounds?.max)
    return sameDay(summaryStart, ms) && sameDay(summaryEnd, me) ? ym : undefined
  })()
  const yearValue = (() => {
    if (!summaryStart || !summaryEnd) return undefined
    const y = Number(summaryStart.slice(0, 4))
    if (!y) return undefined
    const [ys, ye] = clampRange(yearStart(y), yearEnd(y), bounds?.min, bounds?.max)
    return sameDay(summaryStart, ys) && sameDay(summaryEnd, ye) ? String(y) : undefined
  })()
  const isLatestMonth = Boolean(
    bounds?.max &&
      summaryStart &&
      summaryEnd &&
      sameDay(summaryStart, clampRange(monthStart(bounds.max), bounds.max, bounds.min, bounds.max)[0]) &&
      sameDay(summaryEnd, clampRange(monthStart(bounds.max), bounds.max, bounds.min, bounds.max)[1]),
  )
  const isThisYear = Boolean(
    bounds?.max &&
      summaryStart &&
      summaryEnd &&
      sameDay(summaryStart, clampRange(yearStart(Number(bounds.max.slice(0, 4))), bounds.max, bounds.min, bounds.max)[0]) &&
      sameDay(summaryEnd, clampRange(yearStart(Number(bounds.max.slice(0, 4))), bounds.max, bounds.min, bounds.max)[1]),
  )

  return (
    <div className="space-y-6">
      <Card className="gap-4 py-4">
        <div className="flex flex-col gap-3 px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold leading-none">区间净申赎汇总</CardTitle>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground whitespace-nowrap">月份</span>
                <Select
                  value={monthValue}
                  onValueChange={(v) => {
                    const [y, m] = v.split("-").map(Number)
                    applySummary(monthStart(`${v}-01`), monthEnd(y, m))
                  }}
                >
                  <SelectTrigger className="h-8 w-[128px]">
                    <SelectValue placeholder="选择月份" />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((m) => (
                      <SelectItem key={m} value={m}>
                        {`${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant={yearValue ? "default" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => {
                  const y = Number(yearValue || summaryStart.slice(0, 4) || bounds?.max?.slice(0, 4))
                  if (!y) return
                  applySummary(yearStart(y), yearEnd(y))
                }}
              >
                全年
              </Button>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground whitespace-nowrap">选择年份</span>
                <Select
                  value={yearValue}
                  onValueChange={(v) => applySummary(yearStart(Number(v)), yearEnd(Number(v)))}
                >
                  <SelectTrigger className="h-8 w-[96px]">
                    <SelectValue placeholder="年份" />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}年
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant={isLatestMonth ? "default" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => {
                  if (!bounds?.max) return
                  applySummary(monthStart(bounds.max), bounds.max)
                }}
              >
                最新月
              </Button>
              <Button
                type="button"
                variant={isThisYear ? "default" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => {
                  if (!bounds?.max) return
                  const y = Number(bounds.max.slice(0, 4))
                  applySummary(yearStart(y), bounds.max)
                }}
              >
                今年
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">起始</span>
            <DateInput
              className="w-[150px]"
              value={summaryStart}
              min={bounds?.min ?? undefined}
              max={bounds?.max ?? undefined}
              onChange={(v) => applySummary(v, summaryEnd || v)}
              placeholder="起始日期"
            />
            <span className="text-sm text-muted-foreground">结束</span>
            <DateInput
              className="w-[150px]"
              value={summaryEnd}
              min={bounds?.min ?? undefined}
              max={bounds?.max ?? undefined}
              onChange={(v) => applySummary(summaryStart || v, v)}
              placeholder="结束日期"
            />
          </div>
        </div>
        <CardContent className="px-6">
          {loading && !ready ? (
            <div className="py-10 text-center text-sm text-muted-foreground">加载净申赎数据…</div>
          ) : error ? (
            <div className="py-10 text-center text-sm text-red-500">{error}</div>
          ) : !series.length ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              暂无观察池份额数据。请在项目根目录运行
              <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                python scripts/ma/fetch_national_team_etf.py --start 2023-01-01
              </code>
              后刷新本页。
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              <SummaryCard
                label="当前区间"
                value={fmtYi(summary?.net)}
                valueClass={toneClass(summary?.net)}
                hint={`${summary?.start ?? "—"} ~ ${summary?.end ?? "—"} · ${(summary?.net ?? 0) >= 0 ? "净申购" : "净赎回"}`}
              />
              <SummaryCard
                label="净申赎合计"
                value={`${fmtYi(summary?.net)} 亿元`}
                valueClass={toneClass(summary?.net)}
                hint={`申购日 ${summary?.purch_days ?? 0} / 赎回日 ${summary?.redeem_days ?? 0}`}
              />
              <SummaryCard
                label="申购额合计"
                value={`${fmtYi(summary?.purch_sum, 1, false)} 亿元`}
                valueClass="text-red-500"
                hint={
                  summary?.max_purch
                    ? `最大单日 ${summary.max_purch.date} ${fmtYi(summary.max_purch.value)}`
                    : "区间内无申购日"
                }
              />
              <SummaryCard
                label="赎回额合计"
                value={`${fmtYi(summary?.redeem_sum, 1, false)} 亿元`}
                valueClass="text-emerald-600"
                hint={
                  summary?.max_redeem
                    ? `最大单日 ${summary.max_redeem.date} ${fmtYi(summary.max_redeem.value)}`
                    : "区间内无赎回日"
                }
              />
              <SummaryCard
                label="申赎总额"
                value={`${fmtYi(summary?.abs_sum, 1, false)} 亿元`}
                hint="正负金额绝对值合计"
              />
              <SummaryCard
                label="日均净额"
                value={`${fmtYi(summary?.avg_net)} 亿元`}
                valueClass={toneClass(summary?.avg_net)}
                hint={`有效交易日 ${summary?.trading_days ?? 0} 天`}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-xl">泛国家队观察池净申赎历史走势</CardTitle>
              <CardDescription className="mt-1">
                {payload?.universe.note || NATIONAL_TEAM_UNIVERSE_NOTE}
                {payload?.universe.count ? ` 当前纳入 ${payload.universe.count} 只。` : ""}
              </CardDescription>
            </div>
            <Tabs
              value={mode}
              onValueChange={(v) => {
                const next = v as ChartMode
                setMode(next)
                try {
                  localStorage.setItem(TAB_KEY, next)
                } catch { /* ignore */ }
              }}
            >
              <TabsList>
                <TabsTrigger value="bar">柱状口径</TabsTrigger>
                <TabsTrigger value="flow">净申赎估算</TabsTrigger>
                <TabsTrigger value="scale_chg">规模环比</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">起始</span>
            <DateInput
              className="w-[150px]"
              value={chartStart}
              min={bounds?.min ?? undefined}
              max={chartEnd || bounds?.max || undefined}
              onChange={(v) => {
                setChartPreset("custom")
                setChartStart(v)
              }}
              placeholder="起始日期"
            />
            <span className="text-sm text-muted-foreground">结束</span>
            <DateInput
              className="w-[150px]"
              value={chartEnd}
              min={chartStart || bounds?.min || undefined}
              max={bounds?.max ?? undefined}
              onChange={(v) => {
                setChartPreset("custom")
                setChartEnd(v)
              }}
              placeholder="结束日期"
            />
            <div className="flex flex-wrap gap-1.5">
              {CHART_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant={chartPreset === p.id ? "default" : "outline"}
                  className="h-8"
                  onClick={() => applyChartPreset(p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && !ready ? (
            <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground">加载图表…</div>
          ) : !chartSeries.length ? (
            <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
              所选区间暂无数据
            </div>
          ) : (
            <ReactECharts option={option} style={{ height: 460 }} opts={{ renderer: "canvas" }} notMerge />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string
  value: string
  hint: string
  valueClass?: string
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2.5 shadow-sm">
      <div className="text-[11px] text-muted-foreground leading-none">{label}</div>
      <div className={cn("mt-1 truncate text-lg font-semibold tracking-tight", valueClass)}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground leading-snug">{hint}</div>
    </div>
  )
}

