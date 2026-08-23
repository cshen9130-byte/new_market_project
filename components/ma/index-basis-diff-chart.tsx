"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"

import { type ChartZoomRange } from "@/components/ma/index-futures-candle-chart"
import { HelpBasisTrend } from "@/components/ma/realtime-chart-help"
import { useBasisContDiffTimeseries } from "@/hooks/use-basis-cont-diff-timeseries"
import {
  basisPoints,
  cffexContractForRole,
  type CffexContractRole,
} from "@/lib/client/cffex-expiry"
import { INDEX_FUTURES, type CtpTick, type IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_CHART_COLOR, type SpotSnapshot } from "@/lib/client/realtime-overlay"

const ROLE_LEG: Record<CffexContractRole, string> = {
  near: "L",
  next: "L1",
  quarter: "L2",
  nextQuarter: "L3",
}

const ROLE_CONT_LABEL: Record<CffexContractRole, string> = {
  near: "当月连续",
  next: "次月连续",
  quarter: "当季连续",
  nextQuarter: "下季连续",
}

const WINDOW_DAYS = 90

type Props = {
  role: CffexContractRole
  quotes?: Record<string, CtpTick>
  spots?: Record<string, SpotSnapshot>
}

function toYmd(value: string | null | undefined) {
  if (!value) return null
  const digits = value.replace(/-/g, "").slice(0, 8)
  if (!/^\d{8}$/.test(digits)) return null
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return next.toISOString().slice(0, 10)
}

function niceBasisAxis(min: number, max: number) {
  let lo = Math.min(min, 0)
  let hi = Math.max(max, 0)
  const pad = Math.max(10, (hi - lo) * 0.08)
  lo -= pad
  hi += pad
  const span = hi - lo
  const interval = span <= 80 ? 20 : span <= 220 ? 50 : 100
  lo = Math.floor(lo / interval) * interval
  hi = Math.ceil(hi / interval) * interval
  if (hi <= lo) hi = lo + interval
  return { min: lo, max: hi, interval }
}

function defaultZoom(dates: string[]): ChartZoomRange {
  if (dates.length < 2) return { start: 0, end: 100 }
  const last = dates[dates.length - 1]
  const cutoff = addDays(last, -WINDOW_DAYS)
  const idx = dates.findIndex((d) => d >= cutoff)
  const startIdx = idx < 0 ? 0 : idx
  return { start: (startIdx / (dates.length - 1)) * 100, end: 100 }
}

export function IndexBasisDiffChart({ role, quotes, spots }: Props) {
  const { data, error, loading } = useBasisContDiffTimeseries()
  const [zoom, setZoom] = useState<ChartZoomRange>({ start: 0, end: 100 })
  const zoomSeed = useRef("")

  const seriesRows = useMemo(() => {
    const leg = ROLE_LEG[role]
    return INDEX_FUTURES.map((item) => {
      const hist = (data?.data?.[item.product]?.[leg] || [])
        .filter((row) => typeof row.basis_diff === "number")
        .map((row) => ({ date: row.date.slice(0, 10), value: row.basis_diff as number }))
      const lastHist = hist.at(-1)
      const symbol = cffexContractForRole(item.product, role)
      const lastPx = quotes?.[symbol]?.last ?? null
      const spotPx = spots?.[item.product]?.price ?? null
      const live = lastPx != null && spotPx != null ? basisPoints(lastPx, spotPx) : null
      const liveDate = toYmd(quotes?.[symbol]?.trade_date) || lastHist?.date || shanghaiToday()
      const points = hist.slice()
      if (live != null && liveDate) {
        if (lastHist && lastHist.date === liveDate) {
          points[points.length - 1] = { date: liveDate, value: live }
        } else if (!lastHist || lastHist.date < liveDate) {
          points.push({ date: liveDate, value: live })
        }
      }
      return {
        product: item.product as IndexProduct,
        name: `${item.product}${ROLE_CONT_LABEL[role]}`,
        color: INDEX_CHART_COLOR[item.product],
        points,
      }
    })
  }, [data, quotes, role, spots])

  const dates = useMemo(() => {
    const set = new Set<string>()
    for (const row of seriesRows) {
      for (const point of row.points) set.add(point.date)
    }
    return [...set].sort()
  }, [seriesRows])

  const datesKey = dates.length ? `${dates[0]}:${dates[dates.length - 1]}:${dates.length}` : ""
  useEffect(() => {
    if (!datesKey) return
    const key = `${role}:${datesKey}`
    if (zoomSeed.current === key) return
    zoomSeed.current = key
    setZoom(defaultZoom(dates))
  }, [dates, datesKey, role])

  const rangeLabel = useMemo(() => {
    if (dates.length < 2) return data?.start_date && data?.end_date
      ? `${data.start_date} ~ ${data.end_date}`
      : null
    const startIdx = Math.round((zoom.start / 100) * (dates.length - 1))
    const endIdx = Math.round((zoom.end / 100) * (dates.length - 1))
    const start = dates[Math.max(0, Math.min(dates.length - 1, startIdx))]
    const end = dates[Math.max(0, Math.min(dates.length - 1, endIdx))]
    return `${start} ~ ${end}`
  }, [data?.end_date, data?.start_date, dates, zoom.end, zoom.start])

  const option = useMemo(() => {
    const values = seriesRows.flatMap((row) => row.points.map((p) => p.value))
    const { min, max, interval } = niceBasisAxis(
      values.length ? Math.min(...values) : -1,
      values.length ? Math.max(...values) : 1,
    )
    return {
      animation: false,
      backgroundColor: "transparent",
      color: seriesRows.map((row) => row.color),
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
              const num = typeof v === "number" ? v.toFixed(2) : "--"
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
        name: "基差",
        nameLocation: "end" as const,
        nameGap: 18,
        nameTextStyle: { color: "#64748b", fontSize: 11, padding: [0, 0, 0, 0] },
        min,
        max,
        interval,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          formatter: (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
        },
        splitLine: { lineStyle: { color: "#f1f5f9" } },
      },
      series: seriesRows.map((row, idx) => ({
        name: row.name,
        type: "line" as const,
        data: row.points.map((p) => [p.date, Number(p.value.toFixed(2))]),
        showSymbol: false,
        symbol: "none",
        smooth: false,
        lineStyle: { width: 1.6, color: row.color },
        itemStyle: { color: row.color },
        emphasis: { focus: "series" as const },
        ...(idx === 0
          ? {
              markLine: {
                silent: true,
                symbol: "none",
                label: { show: false },
                lineStyle: { color: "#94a3b8", type: "dashed" as const, width: 1 },
                data: [{ yAxis: 0 }],
              },
            }
          : {}),
      })),
    }
  }, [seriesRows, zoom.end, zoom.start])

  const empty = seriesRows.every((row) => row.points.length === 0)
  const waitText = error || (loading ? "正在加载…" : "暂无基差数据")

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-2 px-4 pt-3">
        <div>
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-semibold">基差走势</div>
            <HelpBasisTrend />
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            统计区间：{rangeLabel || "—"}
            {` · ${ROLE_CONT_LABEL[role]}`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {seriesRows.map((row) => (
              <span key={row.name} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <span className="h-0.5 w-3.5 rounded-sm" style={{ backgroundColor: row.color }} />
                {row.name}
              </span>
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
