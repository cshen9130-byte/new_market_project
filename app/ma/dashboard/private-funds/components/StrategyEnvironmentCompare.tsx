"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { ChevronDown, Settings } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PRIVATE_FUND_BENCHMARK_OPTIONS, privateFundBenchmarkLabel } from "@/lib/ma/private-fund-benchmark-options"
import type { StrategyComparePayload } from "@/lib/server/strategy-environment-compare"

const COMMON_BENCHMARKS_SETTINGS_HREF = "/ma/dashboard/settings?tab=common-benchmarks"

const FUND_COLORS = ["#2563eb", "#d97706", "#7c3aed", "#0891b2", "#be123c"]

type PointerPayload = { axesInfo?: { axisDim?: string; value?: string | number }[] }

type LinkChart = {
  on: (event: string, handler: (payload: PointerPayload) => void) => void
  off: (event: string, handler: (payload: PointerPayload) => void) => void
  dispatchAction: (payload: object) => void
  convertToPixel: (finder: { xAxisIndex: number }, value: string) => number | number[]
  getHeight: () => number
  getOption: () => { xAxis?: { data?: string[] } | Array<{ data?: string[] }> }
  isDisposed: () => boolean
}

function pointerDate(chart: LinkChart, payload: PointerPayload): string | null {
  const info = payload.axesInfo?.find((axis) => axis.axisDim === "x")
  if (!info || info.value == null) return null
  if (typeof info.value === "number") {
    const axis = chart.getOption().xAxis
    const data = Array.isArray(axis) ? axis[0]?.data : axis?.data
    const raw = data?.[info.value]
    return raw ? String(raw).slice(0, 10) : null
  }
  return String(info.value).slice(0, 10)
}

/** Keep the crosshair and tooltip on the same date across the two charts. */
function linkCharts(left: LinkChart, right: LinkChart) {
  let lock = false
  const sync = (source: LinkChart, target: LinkChart) => (payload: PointerPayload) => {
    if (lock || target.isDisposed()) return
    const date = pointerDate(source, payload)
    if (!date) return
    const rawX = target.convertToPixel({ xAxisIndex: 0 }, date)
    const x = Array.isArray(rawX) ? rawX[0] : rawX
    if (typeof x !== "number" || Number.isNaN(x)) return
    lock = true
    target.dispatchAction({ type: "showTip", x, y: target.getHeight() / 2 })
    lock = false
  }
  const onLeft = sync(left, right)
  const onRight = sync(right, left)
  const hide = (target: LinkChart) => () => {
    if (lock || target.isDisposed()) return
    target.dispatchAction({ type: "hideTip" })
    target.dispatchAction({ type: "updateAxisPointer", currTrigger: "leave" })
  }
  const hideRight = hide(right)
  const hideLeft = hide(left)
  left.on("updateAxisPointer", onLeft)
  right.on("updateAxisPointer", onRight)
  left.on("globalout", hideRight)
  right.on("globalout", hideLeft)
  return () => {
    if (!left.isDisposed()) {
      left.off("updateAxisPointer", onLeft)
      left.off("globalout", hideRight)
    }
    if (!right.isDisposed()) {
      right.off("updateAxisPointer", onRight)
      right.off("globalout", hideLeft)
    }
  }
}

function monthsBefore(ymd: string, months: number): string {
  const [year, month, day] = ymd.split("-").map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 - months, day))
  return shifted.toISOString().slice(0, 10)
}

/** Score smooth and trailing-return length. Most strategies share one window. */
const CHART_SETUP: Record<string, { score: number; span: number; noun: string }> = {}
const DEFAULT_CHART = { score: 10, span: 20, noun: "超额" }

function chartSetup(key: string) {
  return CHART_SETUP[key] ?? DEFAULT_CHART
}

/** Trailing mean. Early points use the days available so the line has no gap. */
function trailingMean(values: Array<number | null>, window: number): Array<number | null> {
  const out: Array<number | null> = []
  const buf: number[] = []
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) {
      out.push(null)
      continue
    }
    buf.push(value)
    if (buf.length > window) buf.shift()
    const sum = buf.reduce((total, item) => total + item, 0)
    out.push(Math.round((sum / buf.length) * 10) / 10)
  }
  return out
}

/** Trailing return of a cumulative index, in percent. The first `window` points stay empty. */
function trailingReturn(values: Array<number | null>, window: number): Array<number | null> {
  return values.map((value, index) => {
    const base = index >= window ? values[index - window] : null
    if (value == null || base == null || !(base > 0) || !Number.isFinite(value)) return null
    return Math.round((value / base - 1) * 1000) / 10
  })
}

function latestZoom(dates: string[]): { start: string; end: string } {
  const end = dates[dates.length - 1] ?? ""
  const cutoff = end ? monthsBefore(end, 6) : ""
  const start = dates.find((date) => date >= cutoff) ?? dates[0] ?? ""
  return { start, end }
}

function dateAt(dates: string[], value: string | number | undefined): string {
  if (typeof value === "string") {
    if (dates.includes(value)) return value
    return dates.find((date) => date >= value) ?? ""
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const index = Math.max(0, Math.min(dates.length - 1, Math.round(value)))
    return dates[index] ?? ""
  }
  return ""
}

function sliceBounds(dates: string[], start: string, end: string): [number, number] {
  if (!dates.length) return [0, -1]
  let i0 = dates.findIndex((date) => date >= start)
  if (i0 < 0) i0 = 0
  let i1 = -1
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] <= end) {
      i1 = i
      break
    }
  }
  if (i1 < i0) return [0, dates.length - 1]
  return [i0, i1]
}

function firstShared(left: Array<number | null>, right: Array<number | null>, i0: number, i1: number): number {
  for (let i = i0; i <= i1; i++) {
    const a = left[i]
    const b = right[i]
    if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) return i
  }
  return -1
}

function extent(columns: Array<Array<number | null>>, i0: number, i1: number): { low: number; high: number } | null {
  let low = Infinity
  let high = -Infinity
  for (const column of columns) {
    for (let i = i0; i <= i1; i++) {
      const value = column[i]
      if (value == null || !Number.isFinite(value)) continue
      if (value < low) low = value
      if (value > high) high = value
    }
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  return { low, high }
}

/**
 * Right-axis limits that put `anchor` on the same pixel as `score` on a 0–100 axis.
 * The visible excess, including picked funds, stays inside the axis.
 */
function peerAxis(anchor: number, low: number, high: number, score: number): { min: number; max: number } {
  const fraction = Math.min(0.98, Math.max(0.02, score / 100))
  const span = Math.max(high - low, Math.abs(anchor) * 0.02, 0.5)
  const pad = span * 0.06
  const paddedLow = Math.min(low, anchor) - pad
  const paddedHigh = Math.max(high, anchor) + pad
  const range = Math.max((anchor - paddedLow) / fraction, (paddedHigh - anchor) / (1 - fraction))
  return { min: anchor - fraction * range, max: anchor + (1 - fraction) * range }
}

type SearchHit = { beian_hao: string; product_name: string; short_name: string | null }

function useDark(): boolean {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const root = document.documentElement
    const read = () => setDark(root.classList.contains("dark"))
    read()
    const obs = new MutationObserver(read)
    obs.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])
  return dark
}

export function StrategyEnvironmentCompare({ strategyKey, strategyName }: { strategyKey: string; strategyName: string }) {
  const dark = useDark()
  const [picked, setPicked] = useState<SearchHit[]>([])
  const [queryText, setQueryText] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [payload, setPayload] = useState<StrategyComparePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [alignStart, setAlignStart] = useState(true)
  const [benchKey, setBenchKey] = useState("")
  const [windowRange, setWindowRange] = useState<{ start: string; end: string } | null>(null)
  const datesRef = useRef<string[]>([])
  const alphaChartRef = useRef<LinkChart | null>(null)
  const betaChartRef = useRef<LinkChart | null>(null)
  const unlinkRef = useRef<(() => void) | null>(null)

  const connectCharts = useCallback((slot: "alpha" | "beta", chart: LinkChart) => {
    if (slot === "alpha") alphaChartRef.current = chart
    else betaChartRef.current = chart
    unlinkRef.current?.()
    unlinkRef.current = null
    const alpha = alphaChartRef.current
    const beta = betaChartRef.current
    if (!alpha || !beta || alpha.isDisposed() || beta.isDisposed()) return
    unlinkRef.current = linkCharts(alpha, beta)
  }, [])

  useEffect(() => () => {
    unlinkRef.current?.()
  }, [])

  const fundParam = picked.map((item) => item.beian_hao).join(",")

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    setPayload(null)
    const params = new URLSearchParams({ key: strategyKey })
    if (fundParam) params.set("funds", fundParam)
    if (benchKey) params.set("bench", benchKey)
    fetch(`/ma/api/private-funds/market/strategy-environment/compare?${params}`, { signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || "加载失败")
        setPayload(json)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setError(err instanceof Error ? err.message : "加载失败")
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [strategyKey, fundParam, benchKey])

  useEffect(() => {
    setWindowRange(null)
  }, [strategyKey])

  useEffect(() => {
    const q = queryText.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      fetch(`/ma/api/private-funds/products/search?format=picker&q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(async (res) => {
          const json = await res.json()
          if (!Array.isArray(json)) throw new Error("搜索失败")
          setHits(json.slice(0, 8))
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return
          setHits([])
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false)
        })
    }, 250)
    return () => {
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [queryText])

  const option = useMemo(() => {
    if (!payload) return null
    const axis = dark ? "#a1a1aa" : "#71717a"
    const split = dark ? "#3f3f46" : "#e4e4e7"
    const dates = payload.points.map((point) => point.date)
    datesRef.current = dates
    const setup = chartSetup(strategyKey)
    const zoom = windowRange ?? latestZoom(dates)
    const smoothed = trailingMean(payload.points.map((point) => point.score), setup.score)
    const peer = trailingReturn(payload.points.map((point) => point.peer), setup.span)
    const fundValues = payload.funds.map((fund) => trailingReturn(fund.values, setup.span))
    const [i0, i1] = sliceBounds(dates, zoom.start, zoom.end)
    const anchor = alignStart ? firstShared(smoothed, peer, i0, i1) : -1
    const rawExtent = anchor >= 0 ? extent([peer, ...fundValues], i0, i1) : null
    const peerExtent = rawExtent ? { low: Math.min(rawExtent.low, 0), high: Math.max(rawExtent.high, 0) } : null
    const aligned = anchor >= 0 && peerExtent ? peerAxis(peer[anchor] as number, peerExtent.low, peerExtent.high, smoothed[anchor] as number) : null
    const series = [
      {
        name: `环境分（${setup.score}日均）`,
        type: "line",
        yAxisIndex: 0,
        showSymbol: false,
        data: smoothed,
        lineStyle: { width: 2, color: "#e11d48" },
        itemStyle: { color: "#e11d48" },
      },
      {
        name: `近${setup.span}日${setup.noun}（${payload.peerCount}）`,
        type: "line",
        yAxisIndex: 1,
        showSymbol: false,
        connectNulls: false,
        data: peer,
        lineStyle: { width: 2, color: "#ca8a04" },
        itemStyle: { color: "#ca8a04" },
        markLine: {
          silent: true,
          symbol: "none",
          label: {
            show: true,
            formatter: "0",
            position: "insideEndTop",
            color: dark ? "#d4d4d8" : "#3f3f46",
            fontSize: 11,
          },
          lineStyle: { color: dark ? "#d4d4d8" : "#3f3f46", type: "dashed", width: 1 },
          data: [{ yAxis: 0 }],
        },
      },
      ...payload.funds.map((fund, index) => ({
        name: fund.name,
        type: "line",
        yAxisIndex: 1,
        showSymbol: false,
        connectNulls: false,
        data: fundValues[index],
        lineStyle: { width: 1.5, color: FUND_COLORS[index % FUND_COLORS.length] },
        itemStyle: { color: FUND_COLORS[index % FUND_COLORS.length] },
      })),
    ]
    return {
      animation: false,
      grid: { left: 48, right: 52, top: 32, bottom: 64 },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          filterMode: "filter",
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          startValue: zoom.start,
          endValue: zoom.end,
        },
        {
          type: "slider",
          xAxisIndex: 0,
          filterMode: "filter",
          height: 22,
          bottom: 8,
          startValue: zoom.start,
          endValue: zoom.end,
          borderColor: split,
          backgroundColor: dark ? "#27272a" : "#f4f4f5",
          fillerColor: dark ? "rgba(161,161,170,0.28)" : "rgba(24,24,27,0.12)",
          handleStyle: { color: dark ? "#e4e4e7" : "#3f3f46" },
          textStyle: { color: axis, fontSize: 10 },
          dataBackground: {
            lineStyle: { color: "#e11d48", width: 1 },
            areaStyle: { color: "rgba(225,29,72,0.15)" },
          },
        },
      ],
      legend: { type: "scroll", top: 0, textStyle: { color: axis, fontSize: 12 } },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line", animation: false },
        backgroundColor: dark ? "#18181b" : "#fff",
        borderColor: split,
        textStyle: { color: dark ? "#e4e4e7" : "#27272a", fontSize: 12 },
        formatter(params: unknown) {
          const rows = (Array.isArray(params) ? params : [params]) as Array<{
            dataIndex?: number
            marker?: string
            seriesName?: string
            data?: number | null
          }>
          const index = rows[0]?.dataIndex ?? 0
          const point = payload.points[index]
          const lines = [point?.date ?? ""]
          for (const row of rows) {
            const missing = row.data == null || Number.isNaN(Number(row.data))
            const isScore = (row.seriesName ?? "").startsWith("环境分")
            const value = missing ? "—" : isScore ? Number(row.data).toFixed(1) : `${Number(row.data).toFixed(1)}%`
            lines.push(`${row.marker ?? ""}${row.seriesName ?? ""} ${value}`)
          }
          return lines.join("<br/>")
        },
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { color: axis, fontSize: 11 },
        axisLine: { lineStyle: { color: split } },
      },
      yAxis: [
        {
          type: "value",
          name: "环境分",
          min: 0,
          max: 100,
          nameTextStyle: { color: axis, fontSize: 11 },
          axisLabel: { color: axis, fontSize: 11 },
          splitLine: { lineStyle: { color: split } },
        },
        {
          type: "value",
          name: `${setup.span}日${setup.noun}%`,
          scale: false,
          min: aligned ? aligned.min : undefined,
          max: aligned ? aligned.max : undefined,
          nameTextStyle: { color: axis, fontSize: 11 },
          axisLabel: {
            color: axis,
            fontSize: 11,
            formatter: (value: number) => value.toFixed(aligned && aligned.max - aligned.min >= 40 ? 0 : 1),
          },
          splitLine: { show: false },
        },
      ],
      series,
    }
  }, [payload, dark, alignStart, windowRange, strategyKey])

  const betaOption = useMemo(() => {
    if (!payload) return null
    const axis = dark ? "#a1a1aa" : "#71717a"
    const split = dark ? "#3f3f46" : "#e4e4e7"
    const dates = payload.points.map((point) => point.date)
    const setup = chartSetup(strategyKey)
    const zoom = windowRange ?? latestZoom(dates)
    const total = trailingReturn(payload.points.map((point) => point.total ?? null), setup.span)
    const beta = trailingReturn(payload.points.map((point) => point.beta ?? null), setup.span)
    return {
      animation: false,
      grid: { left: 48, right: 16, top: 32, bottom: 64 },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          filterMode: "filter",
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          startValue: zoom.start,
          endValue: zoom.end,
        },
        {
          type: "slider",
          xAxisIndex: 0,
          filterMode: "filter",
          height: 22,
          bottom: 8,
          startValue: zoom.start,
          endValue: zoom.end,
          borderColor: split,
          backgroundColor: dark ? "#27272a" : "#f4f4f5",
          fillerColor: dark ? "rgba(161,161,170,0.28)" : "rgba(24,24,27,0.12)",
          handleStyle: { color: dark ? "#e4e4e7" : "#3f3f46" },
          textStyle: { color: axis, fontSize: 10 },
          dataBackground: {
            lineStyle: { color: "#2563eb", width: 1 },
            areaStyle: { color: "rgba(37,99,235,0.12)" },
          },
        },
      ],
      legend: { top: 0, textStyle: { color: axis, fontSize: 12 } },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line", animation: false },
        backgroundColor: dark ? "#18181b" : "#fff",
        borderColor: split,
        textStyle: { color: dark ? "#e4e4e7" : "#27272a", fontSize: 12 },
        formatter(params: unknown) {
          const rows = (Array.isArray(params) ? params : [params]) as Array<{
            dataIndex?: number
            marker?: string
            seriesName?: string
            data?: number | null
          }>
          const index = rows[0]?.dataIndex ?? 0
          const lines = [payload.points[index]?.date ?? ""]
          for (const row of rows) {
            const missing = row.data == null || Number.isNaN(Number(row.data))
            const value = missing ? "—" : `${Number(row.data).toFixed(1)}%`
            lines.push(`${row.marker ?? ""}${row.seriesName ?? ""} ${value}`)
          }
          return lines.join("<br/>")
        },
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { color: axis, fontSize: 11 },
        axisLine: { lineStyle: { color: split } },
      },
      yAxis: {
        type: "value",
        name: `${setup.span}日%`,
        scale: false,
        nameTextStyle: { color: axis, fontSize: 11 },
        axisLabel: { color: axis, fontSize: 11, formatter: (value: number) => value.toFixed(1) },
        splitLine: { lineStyle: { color: split } },
      },
      series: [
        {
          name: `近${setup.span}日收益（${payload.peerCount}）`,
          type: "line",
          showSymbol: false,
          connectNulls: false,
          data: total,
          lineStyle: { width: 2, color: "#2563eb" },
          itemStyle: { color: "#2563eb" },
          markLine: {
            silent: true,
            symbol: "none",
            label: {
              show: true,
              formatter: "0",
              position: "insideEndTop",
              color: dark ? "#d4d4d8" : "#3f3f46",
              fontSize: 11,
            },
            lineStyle: { color: dark ? "#d4d4d8" : "#3f3f46", type: "dashed", width: 1 },
            data: [{ yAxis: 0 }],
          },
        },
        {
          name: `近${setup.span}日贝塔`,
          type: "line",
          showSymbol: false,
          connectNulls: false,
          data: beta,
          lineStyle: { width: 1.5, type: "dashed", color: "#71717a" },
          itemStyle: { color: "#71717a" },
        },
      ],
    }
  }, [payload, dark, windowRange, strategyKey])

  const onDataZoom = useCallback((
    event: {
      batch?: Array<{ start?: number; end?: number }>
      start?: number
      end?: number
    },
    chart?: {
      getOption: () => {
        dataZoom?: Array<{ start?: number; end?: number; startValue?: string | number; endValue?: string | number }>
      }
    },
  ) => {
    const dates = datesRef.current
    if (!dates.length) return
    const dz = chart?.getOption().dataZoom?.[0]
    let start = dateAt(dates, dz?.startValue)
    let end = dateAt(dates, dz?.endValue)
    if (!start || !end) {
      const src = event.batch?.[0] ?? event
      const last = Math.max(dates.length - 1, 0)
      const i0 = Math.round(((src.start ?? 0) / 100) * last)
      const i1 = Math.round(((src.end ?? 100) / 100) * last)
      start = dates[Math.max(0, Math.min(last, i0))] ?? ""
      end = dates[Math.max(0, Math.min(last, i1))] ?? ""
    }
    if (!start || !end || start > end) return
    setWindowRange((current) => (current && current.start === start && current.end === end ? current : { start, end }))
  }, [])

  function addFund(hit: SearchHit) {
    setPicked((current) => {
      if (current.some((item) => item.beian_hao.toUpperCase() === hit.beian_hao.toUpperCase())) return current
      return [...current, hit].slice(0, 5)
    })
    setQueryText("")
    setHits([])
  }

  return (
    <section className="w-full rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex w-full max-w-xs items-center gap-1.5">
          <span className="shrink-0 text-xs text-zinc-500">超额基准</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="左右两张图都按这个基准拆超额和贝塔"
                className="inline-flex min-w-0 w-full items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                <span className="truncate">{benchKey ? privateFundBenchmarkLabel(benchKey) : "默认"}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-[200px] overflow-y-auto p-1">
              <DropdownMenuItem
                onClick={() => setBenchKey("")}
                className={!benchKey ? "font-medium text-zinc-900" : "text-zinc-600"}
              >
                默认
              </DropdownMenuItem>
              {PRIVATE_FUND_BENCHMARK_OPTIONS.filter((option) => option.key).map((option) => (
                <DropdownMenuItem
                  key={option.key}
                  onClick={() => setBenchKey(option.key)}
                  className={option.key === benchKey ? "font-medium text-zinc-900" : "text-zinc-600"}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <div className="mt-1 rounded-md bg-zinc-50 px-1 py-1">
                <DropdownMenuItem
                  onSelect={(event) => event.preventDefault()}
                  className="text-xs text-zinc-500 focus:text-zinc-700"
                >
                  其他业绩基准
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => window.open(COMMON_BENCHMARKS_SETTINGS_HREF, "_blank", "noopener,noreferrer")}
                  className="text-xs font-medium text-red-600 focus:bg-red-50 focus:text-red-700"
                >
                  <Settings className="size-3.5 text-red-500" />
                  管理常用基准
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex w-full max-w-xl items-center gap-3">
          <label title="滚动条左端那天，红线和黄线画在同一高度" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={alignStart}
              onChange={(event) => setAlignStart(event.target.checked)}
              className="h-3.5 w-3.5 rounded accent-zinc-700"
            />
            起点对齐
          </label>
          <div className="relative min-w-0 flex-1">
          <input
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            placeholder="搜索基金名称或备案号，最多 5 只"
            className="w-full rounded border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          {(hits.length > 0 || searching) && queryText.trim().length >= 2 && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              {searching && hits.length === 0 && <div className="px-3 py-2 text-xs text-zinc-400">搜索中</div>}
              {hits.map((hit) => (
                <button
                  key={hit.beian_hao}
                  type="button"
                  onClick={() => addFund(hit)}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {hit.short_name || hit.product_name}
                  <span className="ml-2 text-xs text-zinc-400">{hit.beian_hao}</span>
                </button>
              ))}
            </div>
          )}
          </div>
        </div>
      </div>

      {picked.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {picked.map((fund) => (
            <button
              key={fund.beian_hao}
              type="button"
              onClick={() => setPicked((current) => current.filter((item) => item.beian_hao !== fund.beian_hao))}
              className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              {fund.short_name || fund.product_name}
              <span className="ml-1 text-zinc-400">×</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-x-4 gap-y-2 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{strategyName}的分数和{chartSetup(strategyKey).noun}</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            打开时显示最近 6 个月。拖动下方滚动条可以看更早的交易日，在图上滚动鼠标可以继续缩放。红线是 α，环境分的 {chartSetup(strategyKey).score} 日平均。卡片上的大数字是合计，等于 α 加上 β。黄线是近 {chartSetup(strategyKey).span} 个交易日的{chartSetup(strategyKey).noun}，单位是百分比，前 {chartSetup(strategyKey).span} 个交易日留空。
            {payload?.peerBasis ?? ""}
            样本是{payload?.peerLabel ?? "对应策略"}里有净值的产品，共 {payload?.peerCount ?? "—"} 只。只在当天有新净值、且这一段至少 5 只有公布时，这条线才往前走。点名的基金用同一套基准，画自己的近 {chartSetup(strategyKey).span} 日{chartSetup(strategyKey).noun}。
            {alignStart ? "起点对齐打开时，滚动条左端那天红线和黄线画在同一高度。" : ""}
          </p>
        </div>
        <div>
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{strategyName}的收益和贝塔</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            实线是近 {chartSetup(strategyKey).span} 日实际涨跌，0 上面是在赚钱，下面是在亏钱。虚线是这段涨跌里跟着基准走的部分。左图黄线是超额，大约等于实线减去虚线。两张图的滚动条连在一起，用的也是同一个基准。
          </p>
        </div>
        <div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && option && (
            <ReactECharts option={option} style={{ height: 380 }} notMerge lazyUpdate={false} onEvents={{ datazoom: onDataZoom }} onChartReady={(chart) => connectCharts("alpha", chart as LinkChart)} />
          )}
          {loading && !payload && <div className="h-80 animate-pulse rounded bg-zinc-50 dark:bg-zinc-900" />}
        </div>
        <div>
          {!error && betaOption && (
            <ReactECharts option={betaOption} style={{ height: 380 }} notMerge lazyUpdate={false} onEvents={{ datazoom: onDataZoom }} onChartReady={(chart) => connectCharts("beta", chart as LinkChart)} />
          )}
          {loading && !payload && <div className="h-80 animate-pulse rounded bg-zinc-50 dark:bg-zinc-900" />}
        </div>
      </div>
    </section>
  )
}
