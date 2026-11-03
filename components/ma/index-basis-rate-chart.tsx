"use client"

import { useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Lock } from "lucide-react"

import { type ChartZoomRange } from "@/components/ma/index-futures-candle-chart"
import { TimeframeSelect } from "@/components/ma/timeframe-select"
import { HelpAnnualizedBasis } from "@/components/ma/realtime-chart-help"
import { useSpotKline } from "@/hooks/use-spot-kline"
import { useSymbolKline } from "@/hooks/use-symbol-kline"
import {
  annualizedBasisPct,
  basisPoints,
  cffexRoleOfContract,
  daysForBasisBar,
  daysToCffexExpiry,
  isNearCffexExpiry,
  type CffexContractRole,
} from "@/lib/client/cffex-expiry"
import {
  type CtpCandle,
  type CtpTick,
  type IndexProduct,
} from "@/lib/client/ctp-market"
import { INDEX_CHART_COLOR, type SpotSnapshot } from "@/lib/client/realtime-overlay"
import { bucketTime, formatCandleTime, getTimeframe, isIntradayTimeframe, shanghaiWallUnix, type TimeframeId } from "@/lib/client/timeframes"
import { useOwnContractBasis, useRollingBasisRate, type BasisRatePoint } from "@/hooks/use-rolling-basis"
import { sessionOpenEchartsMarkLine } from "@/lib/client/session-opens"
import { SyncedCrosshairLayer } from "@/components/ma/use-synced-crosshair"
import { padIntradaySeries, plotOnVisibleWindow, quoteAxisEnd, STACKED_QUOTE_PLOT, type ChartVisibleWindow } from "@/lib/client/qvix-series"
import type { ChartViewportMode } from "@/components/ma/kline-pro-chart"

type Props = {
  title: string
  product: IndexProduct
  symbol: string | null
  candles: CtpCandle[]
  quote?: CtpTick
  spot?: SpotSnapshot
  variant?: "default" | "pro"
  interval?: TimeframeId
  onIntervalChange?: (id: TimeframeId) => void
  hideTimeframe?: boolean
  linked?: boolean
  zoom?: ChartZoomRange
  onZoomChange?: (zoom: ChartZoomRange) => void
  /** Pro kline window. Fixed keeps the axis through 15:00; follow ends at the current minute. */
  viewportMode?: ChartViewportMode
  /** Main-chart visible range. Pro charts on the same frequency draw this window. */
  visibleWindow?: ChartVisibleWindow | null
  /** Unix seconds of the main-chart hover, while the 联动 tool is on. */
  cursorTime?: number | null
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "--"
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function shanghaiDayKey(unix: number) {
  const d = new Date(unix * 1000)
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
}

function trimOpeningSpikes(points: { time: number; value: number }[]) {
  if (points.length < 16) return points
  const body = points.slice(8).map((p) => p.value)
  const sorted = body.slice().sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const dev = body.map((v) => Math.abs(v - median)).sort((a, b) => a - b)
  const mad = dev[Math.floor(dev.length / 2)] || 1
  const cap = Math.max(mad * 6, 8)
  return points.filter((p, i) => i >= 3 || Math.abs(p.value - median) <= cap)
}

function isContinuousSymbol(symbol: string) {
  return /0$/i.test(symbol) && !/\d{4}$/.test(symbol)
}

/** Weekly and monthly charts keep the last daily print in each bucket. */
function toIntervalPoints(points: BasisRatePoint[], interval: TimeframeId) {
  if (interval === "1d") return points
  const map = new Map<number, BasisRatePoint>()
  for (const point of points) map.set(bucketTime(point.time, interval), { time: bucketTime(point.time, interval), value: point.value })
  return [...map.values()].sort((a, b) => a.time - b.time)
}

function withLivePoint(points: BasisRatePoint[], interval: TimeframeId, live: number | null) {
  if (live == null) return points
  const time = bucketTime(shanghaiWallUnix(), interval)
  const next = points.slice()
  const idx = next.findIndex((point) => point.time === time)
  if (idx < 0) next.push({ time, value: live })
  else next[idx] = { time, value: live }
  return next.sort((a, b) => a.time - b.time)
}

function nicePercentAxis(rawMin: number, rawMax: number) {
  let min = Math.floor(rawMin)
  let max = Math.ceil(rawMax)
  if (max <= min) max = min + 1
  const span = max - min
  const interval = span <= 8 ? 2 : span <= 20 ? 5 : 10
  min = Math.floor(min / interval) * interval
  max = Math.ceil(max / interval) * interval
  return { yMin: min, yMax: max, yInterval: interval }
}

export function IndexBasisRateChart({
  title,
  product,
  symbol,
  candles,
  quote,
  spot,
  variant = "default",
  interval: controlledInterval,
  onIntervalChange,
  hideTimeframe = false,
  linked = false,
  zoom,
  onZoomChange,
  viewportMode,
  visibleWindow,
  cursorTime,
}: Props) {
  const [localInterval, setLocalInterval] = useState<TimeframeId>("1m")
  const interval = controlledInterval ?? localInterval
  const setInterval = onIntervalChange ?? setLocalInterval
  const { candles: tfCandles, error: klineError } = useSymbolKline(
    symbol,
    interval,
    candles,
    quote,
    variant === "pro" && !isIntradayTimeframe(interval) ? { history: true } : undefined,
  )
  const { bars: spotBars, error: spotError } = useSpotKline(product, interval, spot)
  const days = symbol ? daysToCffexExpiry(symbol) : null
  const nearExpiry = symbol ? isNearCffexExpiry(symbol) : false
  const lastFut = quote?.last ?? tfCandles.at(-1)?.close ?? candles.at(-1)?.close ?? null
  const lastSpot = spot?.price ?? spotBars.at(-1)?.close ?? spot?.bars.at(-1)?.close ?? null
  const lastPts = lastFut != null && lastSpot != null ? basisPoints(lastFut, lastSpot) : null
  const lastRawPct = lastPts != null && lastSpot ? (lastPts / lastSpot) * 100 : null
  const lastBasis = lastFut != null && lastSpot != null && days != null
    ? annualizedBasisPct(lastFut, lastSpot, days)
    : null
  const up = lastBasis == null ? null : lastBasis >= 0
  const sessionOnly = isIntradayTimeframe(interval)
  const higherTf = interval === "1d" || interval === "1w" || interval === "1M"
  const listedRole: CffexContractRole | null = symbol ? cffexRoleOfContract(symbol) : null
  const seriesRole: CffexContractRole | null = listedRole ?? (symbol && isContinuousSymbol(symbol) ? "near" : null)
  const rolling = useRollingBasisRate(higherTf ? product : null, interval)
  const own = useOwnContractBasis(higherTf && symbol && !seriesRole ? symbol : null, interval)

  const series = useMemo(() => {
    if (!symbol) return []
    if (higherTf) {
      const source = seriesRole ? rolling.roles?.[seriesRole] : own.points
      if (!source?.length) return []
      return withLivePoint(toIntervalPoints(source, interval), interval, lastBasis)
    }
    const sessionDay = sessionOnly && tfCandles.length ? shanghaiDayKey(tfCandles[tfCandles.length - 1].time) : null
    const spotTimes = [...spotBars]
      .filter((bar) => !sessionDay || shanghaiDayKey(bar.time) === sessionDay)
      .sort((a, b) => a.time - b.time)
    if (!spotTimes.length && lastSpot == null) return []
    const spotByTime = new Map(spotTimes.map((bar) => [bar.time, bar.close]))
    let lastKnown: number | null = null
    let lastKnownTime = 0
    let si = 0
    const points: { time: number; value: number }[] = []
    for (const candle of tfCandles) {
      if (sessionDay && shanghaiDayKey(candle.time) !== sessionDay) continue
      while (si < spotTimes.length && spotTimes[si].time <= candle.time) {
        lastKnown = spotTimes[si].close
        lastKnownTime = spotTimes[si].time
        si += 1
      }
      if (!higherTf && lastKnown != null && shanghaiDayKey(lastKnownTime) !== shanghaiDayKey(candle.time)) {
        lastKnown = null
      }
      const spotPx = spotByTime.get(candle.time) ?? lastKnown
      if (spotPx == null) continue
      const barDays = daysForBasisBar(symbol, new Date(candle.time * 1000))
      if (barDays == null) continue
      const value = annualizedBasisPct(candle.close, spotPx, barDays)
      if (value == null) continue
      points.push({ time: candle.time, value })
    }
    if (lastFut != null && lastSpot != null && lastBasis != null) {
      const t = tfCandles.at(-1)?.time ?? spotTimes.at(-1)?.time
      if (t != null && (!points.length || points[points.length - 1].time !== t)) {
        points.push({ time: t, value: lastBasis })
      } else if (points.length) {
        points[points.length - 1].value = lastBasis
      }
    }
    return interval === "1m" ? trimOpeningSpikes(points) : points
  }, [higherTf, interval, lastBasis, lastFut, lastSpot, own.points, rolling.roles, seriesRole, sessionOnly, spotBars, symbol, tfCandles])

  const color = INDEX_CHART_COLOR[product]
  const chartRef = useRef<ReactECharts>(null)
  const plottedTimesRef = useRef<number[]>([])
  const describeRef = useRef<(index: number) => string>(() => "")
  const linkedCursor = variant === "pro" && cursorTime != null
  const option = useMemo(() => {
    const alignSession = variant === "pro" && isIntradayTimeframe(interval) && series.length > 0
    const follow = variant === "pro" ? visibleWindow : null
    const extendTo = follow?.coversAll && viewportMode === "fixed-window" && isIntradayTimeframe(interval)
      ? quoteAxisEnd("fixed-window")
      : undefined
    const aligned = alignSession
      ? padIntradaySeries(
          series.map((point) => ({ time: point.time, close: point.value })),
          interval,
          1,
          quoteAxisEnd(viewportMode),
        )
      : series.map((point) => ({ time: point.time, close: point.value }))
    const plot = plotOnVisibleWindow(aligned, follow, interval, extendTo)
    plottedTimesRef.current = plot.map((p) => p.time)
    const times = plot.map((p) => formatCandleTime(p.time, interval))
    const values = plot.map((p) => (p.close == null || !Number.isFinite(p.close) ? null : Number(p.close.toFixed(2))))
    describeRef.current = (index) => {
      const when = times[index] ?? ""
      const value = values[index]
      const text = typeof value === "number" ? `${value.toFixed(2)}%` : "--"
      return `${when}  ${text}`
    }
    const numeric = values.filter((value): value is number => value != null)
    const minV = numeric.length ? Math.min(0, ...numeric) : -1
    const maxV = numeric.length ? Math.max(0, ...numeric) : 1
    const pad = Math.max(1, (maxV - minV) * 0.12)
    const { yMin, yMax, yInterval } = nicePercentAxis(minV - pad, maxV + pad)
    const dark = variant === "pro"
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        // The linked cross is drawn outside ECharts. Its pointer hides on a null
        // daily slot and flashes every time the chart redraws.
        show: !linkedCursor,
        triggerOn: linkedCursor ? "none" : "mousemove",
        axisPointer: {
          type: linkedCursor ? "none" : "cross",
          animation: false,
          lineStyle: { color: dark ? "#d1d4dc" : "#64748b", width: 1, type: "dashed" },
          crossStyle: { color: dark ? "#d1d4dc" : "#64748b", width: 1 },
          label: { backgroundColor: dark ? "#2a2e39" : "#334155" },
        },
        backgroundColor: dark ? "rgba(19,22,34,0.95)" : "rgba(255,255,255,0.95)",
        borderColor: dark ? "#2a2e39" : "#e5e7eb",
        textStyle: { color: dark ? "#d1d4dc" : "#111827", fontSize: 12 },
        valueFormatter: (v: number) => (typeof v === "number" ? `${v.toFixed(2)}%` : "--"),
      },
      grid: {
        left: STACKED_QUOTE_PLOT.left,
        right: variant === "pro" ? STACKED_QUOTE_PLOT.right : 16,
        top: 12,
        bottom: 24,
      },
      dataZoom: follow
        ? undefined
        : [
            {
              type: "inside",
              start: zoom?.start ?? 0,
              end: zoom?.end ?? 100,
              // Keep full category axis so session/zero markLine never hits filtered holes.
              filterMode: "none",
            },
          ],
      xAxis: {
        type: "category",
        data: times,
        axisLabel: { color: "#94a3b8", fontSize: 10, hideOverlap: true },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: yMin,
        max: yMax,
        interval: yInterval,
        axisLabel: {
          color: "#94a3b8",
          fontSize: 10,
          formatter: (v: number) => Math.round(Number(v)).toString(),
        },
        splitLine: { lineStyle: { color: dark ? "#1e222d" : "#f1f5f9" } },
      },
      series: [
        {
          type: "line",
          data: values,
          showSymbol: false,
          connectNulls: true,
          smooth: interval === "1m" ? 0.1 : 0,
          lineStyle: { width: 1.8, color },
          itemStyle: { color },
          areaStyle: { color: `${color}22`, origin: 0 },
          markLine: (() => {
            const zero = { yAxis: 0, label: { show: false } }
            const session =
              isIntradayTimeframe(interval)
                ? sessionOpenEchartsMarkLine(
                    times,
                    plot.map((p) => p.time),
                    dark,
                    [zero],
                  )
                : {
                    silent: true,
                    symbol: "none",
                    lineStyle: { color: "#94a3b8", type: "dashed", width: 1 },
                    data: [zero],
                    label: { show: false },
                  }
            return session
          })(),
        },
      ],
    }
  }, [color, interval, linkedCursor, series, variant, viewportMode, visibleWindow, zoom?.start, zoom?.end])

  const pro = variant === "pro"
  const continuous = !!symbol && /0$/i.test(symbol) && !/\d{4}$/.test(symbol)
  const waitText = klineError || spotError || rolling.error || own.error
    || (symbol
      ? (spot || spotBars.length
        ? `等待现货与期货 ${getTimeframe(interval).label} 对齐…`
        : "现货分钟线未返回")
      : `未订阅 ${product}`)
  return (
    <div className={pro ? "flex h-full min-h-0 flex-col bg-[#131722] text-[#d1d4dc]" : "flex min-h-[320px] flex-col rounded-xl border bg-card"}>
      <div className={pro ? "flex items-start justify-between gap-3 px-3 py-2" : "flex items-start justify-between gap-3 px-4 py-3"}>
        <div>
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-semibold">
              {title} 年化基差率
              {symbol ? <span className="ml-2 font-mono text-xs text-muted-foreground">{symbol}</span> : null}
            </div>
            <HelpAnnualizedBasis product={title} />
          </div>
          {hideTimeframe ? null : (
            <div className="mt-1.5 flex items-center gap-1">
              {linked ? <Lock className="size-3 shrink-0 text-[#4c84ff]" aria-hidden /> : null}
              <TimeframeSelect value={interval} onChange={setInterval} dark={pro} />
            </div>
          )}
          {!pro ? (
            <div className="mt-1 text-[11px] text-muted-foreground">
              (期货 − 现货) / 现货 / 剩余天数 × 365
              {days != null ? ` · 剩余 ${days} 天${continuous ? "（按主力）" : ""}` : ""}
              {nearExpiry ? " · 临近到期，年化不稳定" : ""}
              {spot?.name ? ` · 现货 ${spot.name}` : ""}
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-[#787b86]">
              {spot?.name || ""}
              {days != null ? ` · 剩余 ${days} 天${continuous ? "（主力）" : ""}` : ""}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold tabular-nums ${up == null ? "text-muted-foreground" : up ? "text-red-500" : "text-emerald-600"}`}>
            {lastBasis == null ? "--" : `${lastBasis >= 0 ? "+" : ""}${fmt(lastBasis)}%`}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            F {fmt(lastFut, 1)} / S {fmt(lastSpot, 1)}
            {lastPts != null ? ` · 基差 ${lastPts >= 0 ? "+" : ""}${fmt(lastPts, 1)}点` : ""}
            {lastRawPct != null ? ` (${lastRawPct >= 0 ? "+" : ""}${fmt(lastRawPct, 2)}%)` : ""}
          </div>
        </div>
      </div>
      <div className={pro ? "relative min-h-0 flex-1 px-1 pb-1" : "relative px-1 pb-1"} style={pro ? undefined : { height: 240 }}>
        {series.length > 0 ? (
          <>
            <ReactECharts
              ref={chartRef}
              option={option}
              style={{ position: "absolute", inset: 0, height: "100%", width: "100%" }}
              notMerge
              onEvents={
                onZoomChange
                  ? {
                      dataZoom: (params: { start?: number; end?: number; batch?: Array<{ start?: number; end?: number }> }) => {
                        const batch = params.batch?.[0] ?? params
                        if (typeof batch.start === "number" && typeof batch.end === "number") {
                          onZoomChange({ start: batch.start, end: batch.end })
                        }
                      },
                    }
                  : undefined
              }
            />
            <SyncedCrosshairLayer
              chartRef={chartRef}
              timesRef={plottedTimesRef}
              describeRef={describeRef}
              cursorTime={cursorTime}
              interval={interval}
              active={linkedCursor}
            />
          </>
        ) : (
          <div className={pro ? "flex h-full items-center justify-center text-sm text-[#787b86]" : "flex h-[240px] items-center justify-center text-sm text-muted-foreground"}>
            {waitText}
          </div>
        )}
      </div>
    </div>
  )
}
