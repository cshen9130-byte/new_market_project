"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import {
  STRATEGY_NAV_UNIVERSES,
  type WeeklyReviewStrategyNav,
  type WeeklyReviewStrategyNavUniverse,
  type WeeklyReviewStrategyNavVariant,
} from "@/lib/ma/weekly-review-strategy-nav"

const LINE_COLORS = [
  "#e11d48", "#2563eb", "#d97706", "#059669", "#7c3aed",
  "#0891b2", "#be123c", "#4f46e5", "#65a30d", "#c026d3",
  "#ea580c", "#0f766e", "#1d4ed8", "#a16207", "#db2777",
  "#4338ca", "#15803d", "#b45309",
]

function monthsBefore(ymd: string, months: number): string {
  const [year, month, day] = ymd.split("-").map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 - months, day))
  return shifted.toISOString().slice(0, 10)
}

function latestZoom(dates: string[], months: number): { start: string; end: string } {
  const end = dates[dates.length - 1] ?? ""
  const cutoff = end ? monthsBefore(end, months) : ""
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

function firstFinite(values: Array<number | null>, i0: number, i1: number): number {
  for (let i = i0; i <= i1; i++) {
    const value = values[i]
    if (value != null && value > 0 && Number.isFinite(value)) return i
  }
  return -1
}

function rebase(values: Array<number | null>, anchor: number): Array<number | null> {
  const base = values[anchor]
  if (base == null || !(base > 0)) return values.map(() => null)
  return values.map((value) => (value == null || !Number.isFinite(value) ? null : Math.round((value / base) * 1000) / 10))
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

type LegendItem = {
  key: string
  name: string
  title: string
  color: string
}

/** Sheet titles may carry a hint in （...）; legend chips keep only the official short name. */
function shortStrategyNavLabel(bucket: string): string {
  const short = bucket.replace(/（[^（）]+）$/, "").trim()
  return short || bucket
}

function strategyNavLegendName(bucket: string, count: number): string {
  return `${shortStrategyNavLabel(bucket)}（${count}）`
}

function chipClass(active: boolean, disabled = false): string {
  return [
    "rounded px-2 py-1 text-xs",
    disabled ? "cursor-not-allowed opacity-40" : "",
    active
      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
      : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900",
  ].filter(Boolean).join(" ")
}

function emptyUniverseMessage(universe: WeeklyReviewStrategyNavUniverse, hasBuckets: boolean): string {
  if (!hasBuckets) return "这个周报里暂无策略"
  if (universe === "tracking") return "JY跟踪池里这些策略还没有足够的净值来画平均线"
  if (universe === "xiaohe") return "本周小荷公众号榜上还没有可匹配净值的产品来画平均线"
  if (universe === "ima") return "本周 ima点睛榜上还没有可匹配净值的产品来画平均线"
  if (universe === "yt") return "YT 来源中这些策略还没有足够的净值来画平均线"
  return "这些策略在库里还没有足够的净值来画平均线"
}

export function WeeklyReviewStrategyNavChart({
  variant,
  buckets,
  bucketsReady,
  weekEnd = "",
}: {
  variant: WeeklyReviewStrategyNavVariant
  buckets: string[]
  bucketsReady: boolean
  weekEnd?: string
}) {
  const dark = useDark()
  const [payload, setPayload] = useState<WeeklyReviewStrategyNav | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [alignStart, setAlignStart] = useState(true)
  const [months, setMonths] = useState<6 | 12 | 36>(6)
  const [windowRange, setWindowRange] = useState<{ start: string; end: string } | null>(null)
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [universe, setUniverse] = useState<WeeklyReviewStrategyNavUniverse>("market")
  const [compare, setCompare] = useState(false)
  const [compareStrategy, setCompareStrategy] = useState("")
  const datesRef = useRef<string[]>([])
  const bucketKey = buckets.join("\0")
  const waitingCompare = compare && !compareStrategy

  useEffect(() => {
    if (!compare) return
    if (compareStrategy && buckets.includes(compareStrategy)) return
    setCompareStrategy("")
  }, [bucketKey, buckets, compare, compareStrategy])

  useEffect(() => {
    if (waitingCompare) {
      setPayload(null)
      setError("")
      setLoading(false)
      setWindowRange(null)
      setSelected(null)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    setError("")
    const params = new URLSearchParams({ variant })
    if (weekEnd) params.set("week_end", weekEnd)
    if (compare) {
      params.set("mode", "compare")
      params.set("strategy", compareStrategy)
    } else {
      params.set("universe", universe)
    }
    fetch(`/ma/api/tracking-funds/weekly-review/strategy-nav?${params}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "策略平均净值加载失败")
        setPayload(json as WeeklyReviewStrategyNav)
        setWindowRange(null)
        setSelected(null)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setPayload(null)
        setError(err instanceof Error ? err.message : "策略平均净值加载失败")
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [variant, universe, compare, compareStrategy, weekEnd, waitingCompare])

  const shown = useMemo(() => {
    if (!payload) return []
    if (compare) return payload.series
    const byName = new Map(payload.series.map((row) => [row.bucket, row]))
    const wanted = bucketKey ? bucketKey.split("\0") : []
    return wanted.flatMap((name) => {
      const row = byName.get(name)
      return row ? [row] : []
    })
  }, [payload, bucketKey, compare])

  const legendItems = useMemo<LegendItem[]>(
    () => shown.map((item, index) => ({
      key: item.bucket,
      name: strategyNavLegendName(item.bucket, item.count),
      title: `${item.bucket}（${item.count}）`,
      color: LINE_COLORS[index % LINE_COLORS.length],
    })),
    [shown],
  )

  const legendKeys = useMemo(() => legendItems.map((item) => item.key).join("\0"), [legendItems])

  useEffect(() => {
    if (!legendKeys) {
      setSelected(null)
      return
    }
    setSelected(new Set(legendKeys.split("\0")))
  }, [legendKeys])

  const active = selected ?? new Set(legendItems.map((item) => item.key))
  const allOn = legendItems.length > 0 && legendItems.every((item) => active.has(item.key))

  const option = useMemo(() => {
    if (!payload || shown.length === 0) return null
    const axis = dark ? "#a1a1aa" : "#71717a"
    const split = dark ? "#3f3f46" : "#e4e4e7"
    const dates = payload.dates
    datesRef.current = dates
    const zoom = windowRange ?? latestZoom(dates, months)
    const [i0, i1] = sliceBounds(dates, zoom.start, zoom.end)
    const on = selected ?? new Set(shown.map((item) => item.bucket))
    const series = shown.flatMap((item, index) => {
      if (!on.has(item.bucket)) return []
      const anchor = alignStart ? firstFinite(item.values, i0, i1) : -1
      const color = LINE_COLORS[index % LINE_COLORS.length]
      return [{
        name: strategyNavLegendName(item.bucket, item.count),
        type: "line" as const,
        showSymbol: false,
        connectNulls: false,
        data: anchor >= 0 ? rebase(item.values, anchor) : item.values,
        z: 2,
        lineStyle: { width: 1.6, color },
        itemStyle: { color },
      }]
    })
    return {
      animation: false,
      grid: { left: 48, right: 16, top: 16, bottom: 64 },
      legend: { show: false },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          filterMode: "none",
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          startValue: zoom.start,
          endValue: zoom.end,
        },
        {
          type: "slider",
          xAxisIndex: 0,
          filterMode: "none",
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
            areaStyle: { color: "rgba(225,29,72,0.12)" },
          },
        },
      ],
      tooltip: {
        trigger: "axis",
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
  }, [payload, shown, dark, alignStart, windowRange, months, selected])

  const onDataZoom = useCallback((
    event: { batch?: Array<{ start?: number; end?: number }>; start?: number; end?: number },
    chart?: { getOption: () => { dataZoom?: Array<{ startValue?: string | number; endValue?: string | number }> } },
  ) => {
    const dates = datesRef.current
    if (!dates.length) return
    const zoom = chart?.getOption().dataZoom?.[0]
    let start = dateAt(dates, zoom?.startValue)
    let end = dateAt(dates, zoom?.endValue)
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

  const preset = (next: 6 | 12 | 36) => {
    setMonths(next)
    setWindowRange(null)
  }
  const presetOn = (next: 6 | 12 | 36) => !windowRange && months === next

  function toggleAll() {
    if (allOn) setSelected(new Set())
    else setSelected(new Set(legendItems.map((item) => item.key)))
  }

  function toggleOne(key: string) {
    setSelected((current) => {
      const next = new Set(current ?? legendItems.map((item) => item.key))
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const omittedSources = compare && payload
    ? STRATEGY_NAV_UNIVERSES.filter((row) => !payload.series.some((item) => item.bucket === row.label)).map((row) => row.label)
    : []

  return (
    <section className="rounded-xl border bg-background shadow-sm p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-foreground">策略平均净值</h3>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-zinc-400">
            {payload?.note ?? (compare
              ? "先选择一个策略，再比较它在各来源中的等权累计净值。"
              : "按所选来源中归入各策略的产品计算等权累计净值。")}
            {variant === "futures"
              ? " 图例为策略简称，括号内为计入只数。时序/截面占比和按频率、规模、品种、因子、方法论等分组口径见上方说明。"
              : " 图例为策略简称，括号内为计入只数。"}
            {compare && omittedSources.length > 0 ? ` 未显示：${omittedSources.join("、")}（该策略没有可画的净值）。` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            [6, "近6月"],
            [12, "近1年"],
            [36, "近3年"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => preset(value)}
              className={chipClass(presetOn(value))}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={toggleAll}
            disabled={legendItems.length === 0}
            className="ml-1 inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-600 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            <span
              className={[
                "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
                allOn ? "border-red-500 bg-red-500" : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900",
              ].join(" ")}
            >
              {allOn && (
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              )}
            </span>
            {allOn ? "全不选" : "全选"}
          </button>
          <label className="ml-1 inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-300">
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

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {STRATEGY_NAV_UNIVERSES.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={!compare && universe === item.key}
            aria-label={item.label}
            title={item.label}
            disabled={compare}
            onClick={() => {
              setCompare(false)
              setUniverse(item.key)
            }}
            className={chipClass(!compare && universe === item.key, compare)}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={compare}
          aria-label="对比"
          title="对比：先选一个策略，再比较各来源"
          onClick={() => setCompare((current) => !current)}
          className={["ml-1", chipClass(compare)].join(" ")}
        >
          对比
        </button>
        {compare && (
          <>
            <span className="ml-2 text-xs text-zinc-400">策略</span>
            {buckets.map((bucket) => {
              const label = shortStrategyNavLabel(bucket)
              const on = compareStrategy === bucket
              return (
                <button
                  key={bucket}
                  type="button"
                  aria-pressed={on}
                  aria-label={label}
                  title={label}
                  onClick={() => setCompareStrategy(bucket)}
                  className={chipClass(on)}
                >
                  {label}
                </button>
              )
            })}
          </>
        )}
      </div>

      {legendItems.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {legendItems.map((item) => {
            const on = active.has(item.key)
            const hint = on ? "点击隐藏" : "点击显示"
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleOne(item.key)}
                title={`${item.title}。${hint}`}
                aria-label={`${item.title}，${hint}`}
                className={[
                  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-left text-xs leading-4 transition-opacity",
                  on ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 opacity-50 dark:text-zinc-500",
                ].join(" ")}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: on ? item.color : "transparent", boxShadow: on ? undefined : `inset 0 0 0 1.5px ${item.color}` }}
                />
                <span className="whitespace-nowrap">{item.name}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="relative mt-3">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && waitingCompare && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {buckets.length === 0 ? "这个周报里暂无策略" : "请先选择一个策略，再比较各来源的平均净值"}
          </div>
        )}
        {!error && !waitingCompare && option && bucketsReady && (
          <ReactECharts option={option} style={{ height: 380 }} notMerge lazyUpdate={false} onEvents={{ datazoom: onDataZoom }} />
        )}
        {!error && !waitingCompare && bucketsReady && option && legendItems.length > 0 && active.size === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            已全部隐藏，点「全选」或点图例再显示
          </div>
        )}
        {!error && !waitingCompare && bucketsReady && !loading && payload && shown.length === 0 && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {compare
              ? "这个策略在各来源中都没有可画的净值"
              : emptyUniverseMessage(universe, buckets.length > 0)}
          </div>
        )}
        {!error && !waitingCompare && (!bucketsReady || (loading && !option)) && (
          <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
            {compare ? "正在计算该策略在各来源中的平均净值…" : "正在计算各策略平均净值…"}
          </div>
        )}
      </div>
    </section>
  )
}
