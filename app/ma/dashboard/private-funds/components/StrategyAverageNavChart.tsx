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
import type { StrategyNavOverlay } from "@/lib/server/strategy-environment-compare"

const COMMON_BENCHMARKS_SETTINGS_HREF = "/ma/dashboard/settings?tab=common-benchmarks"

const LINE_COLORS = ["#2563eb", "#e11d48", "#d97706", "#7c3aed", "#0891b2", "#be123c", "#059669"]

function monthsBefore(ymd: string, months: number): string {
  const [year, month, day] = ymd.split("-").map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 - months, day))
  return shifted.toISOString().slice(0, 10)
}

function monthWindow(dates: string[], year: number, month: number): { start: string; end: string } | null {
  const prefix = `${year}-${String(month).padStart(2, "0")}`
  let start = ""
  let end = ""
  for (const date of dates) {
    if (!date.startsWith(prefix)) continue
    if (!start) start = date
    end = date
  }
  return start && end ? { start, end } : null
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

function rebase(values: Array<number | null>, anchor: number): Array<number | null> {
  const base = values[anchor]
  if (base == null || !(base > 0)) return values.map(() => null)
  return values.map((value) => (value == null || !Number.isFinite(value) ? null : Math.round((value / base) * 1000) / 10))
}

function alignBenchmark(dates: string[], points: Array<{ date: string; value: number }>): Array<number | null> {
  let index = 0
  let last: number | null = null
  return dates.map((date) => {
    while (index < points.length && points[index].date <= date) {
      const value = points[index].value
      if (value > 0 && Number.isFinite(value)) last = value
      index += 1
    }
    return last
  })
}

function firstFinite(values: Array<number | null>, i0: number, i1: number): number {
  for (let i = i0; i <= i1; i++) {
    const value = values[i]
    if (value != null && value > 0 && Number.isFinite(value)) return i
  }
  return -1
}

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

export function StrategyAverageNavChart({ activeKey }: { activeKey: string }) {
  const dark = useDark()
  const [payload, setPayload] = useState<StrategyNavOverlay | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [alignStart, setAlignStart] = useState(true)
  const [windowRange, setWindowRange] = useState<{ start: string; end: string } | null>(null)
  const [benchKey, setBenchKey] = useState("")
  const [benchSeries, setBenchSeries] = useState<{ label: string; points: Array<{ date: string; value: number }> } | null>(null)
  const datesRef = useRef<string[]>([])

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    fetch("/ma/api/private-funds/market/strategy-environment/nav", { signal: ctrl.signal })
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
  }, [])

  useEffect(() => {
    if (!benchKey || !payload?.dates.length) {
      setBenchSeries(null)
      return
    }
    const ctrl = new AbortController()
    const params = new URLSearchParams({
      key: benchKey,
      from: payload.dates[0],
      to: payload.dates[payload.dates.length - 1],
    })
    fetch(`/ma/api/private-funds/benchmark?${params}`, { signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error || "基准加载失败")
        const points = (Array.isArray(json.data) ? json.data : []).flatMap((row: { date?: unknown; value?: unknown }) => {
          const date = typeof row?.date === "string" ? row.date.slice(0, 10) : ""
          const value = typeof row?.value === "number" ? row.value : Number(row?.value)
          return date && Number.isFinite(value) ? [{ date, value }] : []
        })
        setBenchSeries({ label: typeof json.label === "string" && json.label ? json.label : privateFundBenchmarkLabel(benchKey), points })
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setBenchSeries(null)
      })
    return () => ctrl.abort()
  }, [benchKey, payload])

  const option = useMemo(() => {
    if (!payload) return null
    const axis = dark ? "#a1a1aa" : "#71717a"
    const split = dark ? "#3f3f46" : "#e4e4e7"
    const dates = payload.dates
    datesRef.current = dates
    const zoom = windowRange ?? latestZoom(dates)
    const [i0, i1] = sliceBounds(dates, zoom.start, zoom.end)
    const active = activeKey === "intraday" || activeKey === "swing" ? "long-short" : activeKey
    const series = payload.series.map((item, index) => {
      const anchor = alignStart ? firstFinite(item.values, i0, i1) : -1
      const data = anchor >= 0 ? rebase(item.values, anchor) : item.values
      const on = item.key === active
      const color = LINE_COLORS[index % LINE_COLORS.length]
      return {
        name: `${item.name}（${item.count}）`,
        type: "line",
        showSymbol: false,
        connectNulls: false,
        data,
        z: on ? 4 : 2,
        lineStyle: { width: on ? 2.5 : 1.4, color, type: "solid" as "solid" | "dashed" },
        itemStyle: { color },
      }
    })
    if (benchSeries && benchSeries.points.length) {
      const raw = alignBenchmark(dates, benchSeries.points)
      const anchor = alignStart ? firstFinite(raw, i0, i1) : firstFinite(raw, 0, raw.length - 1)
      const benchColor = dark ? "#e4e4e7" : "#3f3f46"
      series.push({
        name: benchSeries.label,
        type: "line",
        showSymbol: false,
        connectNulls: false,
        data: anchor >= 0 ? rebase(raw, anchor) : raw.map(() => null),
        z: 3,
        lineStyle: { width: 1.6, color: benchColor, type: "dashed" },
        itemStyle: { color: benchColor },
      })
    }
    return {
      animation: false,
      grid: { left: 48, right: 24, top: 32, bottom: 64 },
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
      legend: { type: "scroll", top: 0, textStyle: { color: axis, fontSize: 12 } },
      tooltip: {
        trigger: "axis",
        order: "valueDesc",
        backgroundColor: dark ? "#18181b" : "#fff",
        borderColor: split,
        textStyle: { color: dark ? "#e4e4e7" : "#27272a", fontSize: 12 },
        formatter(params: unknown) {
          const rows = (Array.isArray(params) ? params : [params]) as Array<{
            marker?: string
            seriesName?: string
            data?: number | null
            axisValue?: string
          }>
          const ranked = [...rows].sort((a, b) => {
            const av = a.data == null || Number.isNaN(Number(a.data)) ? -Infinity : Number(a.data)
            const bv = b.data == null || Number.isNaN(Number(b.data)) ? -Infinity : Number(b.data)
            return bv - av
          })
          const lines = [ranked[0]?.axisValue ?? rows[0]?.axisValue ?? ""]
          for (const row of ranked) {
            const missing = row.data == null || Number.isNaN(Number(row.data))
            lines.push(`${row.marker ?? ""}${row.seriesName ?? ""} ${missing ? "—" : Number(row.data).toFixed(1)}`)
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
        name: "净值",
        scale: true,
        nameTextStyle: { color: axis, fontSize: 11 },
        axisLabel: { color: axis, fontSize: 11 },
        splitLine: { lineStyle: { color: split } },
      },
      series,
    }
  }, [payload, dark, alignStart, windowRange, activeKey, benchSeries])

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

  return (
    <section className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">策略平均净值</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            打开时显示最近 6 个月。点下面的月份看今年那一个月，拖动下方滚动条可以看更早的交易日。{payload?.note ?? ""}
            当前选中的策略线条更粗。
            {alignStart ? "起点对齐打开时，滚动条左端那天每条线，包括选中的业绩基准，都从 100 起。" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="whitespace-nowrap text-xs text-zinc-500">业绩基准：</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex min-w-[140px] items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  <span className="truncate">{privateFundBenchmarkLabel(benchKey, "不显示")}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-[200px] overflow-y-auto p-1">
                {PRIVATE_FUND_BENCHMARK_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.key || "none"}
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
          <label title="滚动条左端那天，每条线都从 100 起" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={alignStart}
              onChange={(event) => setAlignStart(event.target.checked)}
              className="accent-zinc-800 dark:accent-zinc-200"
            />
            起点对齐
          </label>
        </div>
      </div>
      {payload && (
        <div className="mt-3 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setWindowRange(null)}
            className={[
              "rounded px-2 py-1 text-xs",
              !windowRange || (windowRange.start === latestZoom(payload.dates).start && windowRange.end === latestZoom(payload.dates).end)
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900",
            ].join(" ")}
          >
            近6月
          </button>
          {Array.from({ length: 12 }, (_, index) => {
            const month = index + 1
            const year = Number(payload.dates[payload.dates.length - 1]?.slice(0, 4))
            const range = Number.isFinite(year) ? monthWindow(payload.dates, year, month) : null
            const on = !!range && windowRange?.start === range.start && windowRange?.end === range.end
            return (
              <button
                key={month}
                type="button"
                disabled={!range}
                onClick={() => range && setWindowRange(range)}
                className={[
                  "rounded px-2 py-1 text-xs",
                  on
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:cursor-default disabled:text-zinc-300 disabled:hover:bg-transparent dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:disabled:text-zinc-600",
                ].join(" ")}
              >
                {month}月
              </button>
            )
          })}
        </div>
      )}
      <div className="mt-3">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && option && (
          <ReactECharts option={option} style={{ height: 380 }} notMerge lazyUpdate={false} onEvents={{ datazoom: onDataZoom }} />
        )}
        {loading && !payload && <div className="h-80 animate-pulse rounded bg-zinc-50 dark:bg-zinc-900" />}
      </div>
    </section>
  )
}
