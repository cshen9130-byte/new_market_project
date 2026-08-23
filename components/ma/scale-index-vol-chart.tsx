"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"

import { type ChartZoomRange } from "@/components/ma/index-futures-candle-chart"
import { HelpScaleIndexVol } from "@/components/ma/realtime-chart-help"
import { useScaleIndexDaily } from "@/hooks/use-scale-index-daily"
import {
  SCALE_INDEX_WINDOWS,
  type ScaleIndexPoint,
  type ScaleIndexWindow,
} from "@/lib/client/scale-indices"
import { cn } from "@/lib/utils"

const WINDOW_DAYS = 90
const QUANTILE_LOOKBACK = 250

type ViewMode = "trend" | "quantile"

function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function defaultZoom(dates: string[]): ChartZoomRange {
  if (dates.length < 2) return { start: 0, end: 100 }
  const last = dates[dates.length - 1]
  const cutoff = addDays(last, -WINDOW_DAYS)
  const idx = dates.findIndex((d) => d >= cutoff)
  const startIdx = idx < 0 ? 0 : idx
  return { start: (startIdx / (dates.length - 1)) * 100, end: 100 }
}

function rollingAnnVol(points: ScaleIndexPoint[], window: number) {
  const out: Array<{ date: string; value: number }> = []
  for (let i = window; i < points.length; i++) {
    const slice = points.slice(i - window, i + 1)
    const rets: number[] = []
    for (let j = 1; j < slice.length; j++) {
      const prev = slice[j - 1].close
      const next = slice[j].close
      if (prev > 0 && next > 0) rets.push(Math.log(next / prev))
    }
    if (rets.length < Math.max(8, Math.floor(window * 0.7))) continue
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length
    const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length - 1)
    if (!(variance >= 0)) continue
    out.push({ date: points[i].date, value: Math.sqrt(variance * 252) * 100 })
  }
  return out
}

function historicalQuantile(values: Array<{ date: string; value: number }>) {
  return values.map((row, i) => {
    const start = Math.max(0, i - QUANTILE_LOOKBACK + 1)
    const hist = values.slice(start, i + 1)
    if (hist.length < 40) return { date: row.date, value: null as number | null }
    const rank = hist.filter((item) => item.value <= row.value).length
    return { date: row.date, value: (rank / hist.length) * 100 }
  }).filter((row): row is { date: string; value: number } => row.value != null)
}

function nicePctAxis(min: number, max: number, floorZero: boolean) {
  let lo = floorZero ? Math.min(min, 0) : min
  let hi = max
  const pad = Math.max(2, (hi - lo) * 0.08)
  if (!floorZero) lo -= pad
  hi += pad
  const span = hi - lo
  const interval = span <= 20 ? 5 : span <= 60 ? 10 : 20
  lo = Math.floor(lo / interval) * interval
  hi = Math.ceil(hi / interval) * interval
  if (floorZero) lo = Math.max(0, lo)
  if (hi <= lo) hi = lo + interval
  return { min: lo, max: hi, interval }
}

export function ScaleIndexVolChart() {
  const { series, error, loading } = useScaleIndexDaily()
  const [volWindow, setVolWindow] = useState<ScaleIndexWindow>(20)
  const [view, setView] = useState<ViewMode>("trend")
  const [zoom, setZoom] = useState<ChartZoomRange>({ start: 0, end: 100 })
  const zoomSeed = useRef("")

  const plotted = useMemo(() => {
    return series.map((row) => {
      const vol = rollingAnnVol(row.points, volWindow)
      const points = view === "trend" ? vol : historicalQuantile(vol)
      return { ...row, points }
    })
  }, [series, view, volWindow])

  const dates = useMemo(() => {
    const set = new Set<string>()
    for (const row of plotted) {
      for (const point of row.points) set.add(point.date)
    }
    return [...set].sort()
  }, [plotted])

  const datesKey = dates.length ? `${dates[0]}:${dates[dates.length - 1]}:${dates.length}` : ""
  useEffect(() => {
    if (!datesKey) return
    const key = `${view}:${volWindow}:${datesKey}`
    if (zoomSeed.current === key) return
    zoomSeed.current = key
    setZoom(defaultZoom(dates))
  }, [dates, datesKey, view, volWindow])

  const rangeLabel = useMemo(() => {
    if (dates.length < 2) return null
    const startIdx = Math.round((zoom.start / 100) * (dates.length - 1))
    const endIdx = Math.round((zoom.end / 100) * (dates.length - 1))
    const start = dates[Math.max(0, Math.min(dates.length - 1, startIdx))]
    const end = dates[Math.max(0, Math.min(dates.length - 1, endIdx))]
    return `${start} ~ ${end}`
  }, [dates, zoom.end, zoom.start])

  const option = useMemo(() => {
    const values = plotted.flatMap((row) => row.points.map((p) => p.value))
    const axis = nicePctAxis(
      values.length ? Math.min(...values) : 0,
      values.length ? Math.max(...values) : 1,
      view === "trend",
    )
    const yName = view === "trend" ? "波动率(%)" : "分位数(%)"
    return {
      animation: false,
      backgroundColor: "transparent",
      color: plotted.map((row) => row.color),
      tooltip: {
        trigger: "axis" as const,
        axisPointer: {
          type: "cross" as const,
          crossStyle: { color: "#94a3b8" },
          lineStyle: { color: "#94a3b8", type: "dashed" as const },
        },
        backgroundColor: "rgba(255,255,255,0.96)",
        borderColor: "#e5e7eb",
        textStyle: { color: "#111827", fontSize: 12 },
        formatter: (params: unknown) => {
          const rows = Array.isArray(params) ? params : [params]
          if (!rows.length) return ""
          const first = rows[0] as { axisValue?: string; axisValueLabel?: string }
          const raw = String(first.axisValueLabel ?? first.axisValue ?? "").slice(0, 10)
          const body = rows
            .map((item) => {
              const row = item as { marker?: string; seriesName?: string; value?: [string, number] | number }
              const v = Array.isArray(row.value) ? row.value[1] : row.value
              const num = typeof v === "number" ? `${v.toFixed(2)}%` : "--"
              return `${row.marker || ""}<span>${row.seriesName}</span>&nbsp;&nbsp;<b style="float:right;margin-left:16px">${num}</b>`
            })
            .join("<br/>")
          return `<div style="margin-bottom:6px;color:#64748b;font-size:11px">${raw}</div>${body}`
        },
      },
      legend: { show: false },
      grid: { left: 12, right: 16, top: 32, bottom: 8, containLabel: true },
      dataZoom: [
        {
          type: "inside" as const,
          start: zoom.start,
          end: zoom.end,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
        },
      ],
      xAxis: {
        type: "time" as const,
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#e2e8f0" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          hideOverlap: true,
          formatter: (value: number) => {
            const d = new Date(value)
            const day = d.getUTCDate()
            const month = d.getUTCMonth() + 1
            return day <= 7 ? `${month}月` : String(day)
          },
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: yName,
        nameLocation: "end" as const,
        nameGap: 18,
        nameTextStyle: { color: "#64748b", fontSize: 11 },
        min: axis.min,
        max: axis.max,
        interval: axis.interval,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          formatter: (v: number) => `${Math.round(v)}`,
        },
        splitLine: { lineStyle: { color: "#f1f5f9" } },
      },
      series: plotted.map((row) => ({
        name: row.name,
        type: "line" as const,
        data: row.points.map((p) => [p.date, Number(p.value.toFixed(2))]),
        showSymbol: false,
        symbol: "none",
        smooth: false,
        lineStyle: { width: 1.6, color: row.color },
        itemStyle: { color: row.color },
        emphasis: { focus: "series" as const },
      })),
    }
  }, [plotted, view, zoom.end, zoom.start])

  const empty = plotted.every((row) => row.points.length === 0)
  const waitText = error || (loading ? "正在加载…" : "暂无指数数据")

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3">
        <div>
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-semibold">规模指数滚动年化波动率</div>
            <HelpScaleIndexVol />
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            统计区间：{rangeLabel || "—"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {plotted.map((row) => (
              <span key={row.id} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <span className="h-0.5 w-3.5 rounded-sm" style={{ backgroundColor: row.color }} />
                {row.name}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            滚动周期
            <select
              className="h-7 rounded-md border bg-background px-2 text-[11px] text-foreground"
              value={volWindow}
              onChange={(e) => setVolWindow(Number(e.target.value) as ScaleIndexWindow)}
            >
              {SCALE_INDEX_WINDOWS.map((days) => (
                <option key={days} value={days}>
                  {days}日
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-0.5">
            {(
              [
                ["trend", "波动率趋势"],
                ["quantile", "历史分位数"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px]",
                  view === id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="px-2 pb-2 pt-1">
        {empty ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
            {waitText}
          </div>
        ) : (
          <ReactECharts
            option={option}
            style={{ height: 360 }}
            notMerge
            lazyUpdate
            onEvents={{
              dataZoom: (params: { start?: number; end?: number; batch?: Array<{ start?: number; end?: number }> }) => {
                const batch = params.batch?.[0] ?? params
                if (typeof batch.start !== "number" || typeof batch.end !== "number") return
                setZoom((prev) => {
                  if (Math.abs(prev.start - batch.start!) < 0.05 && Math.abs(prev.end - batch.end!) < 0.05) {
                    return prev
                  }
                  return { start: batch.start!, end: batch.end! }
                })
              },
            }}
          />
        )}
      </div>
    </div>
  )
}
