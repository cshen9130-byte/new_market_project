"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"

import { type ChartZoomRange } from "@/components/ma/index-futures-candle-chart"
import { TimeframeSelect } from "@/components/ma/timeframe-select"
import { HelpAnnualizedBasis } from "@/components/ma/realtime-chart-help"
import { useSpotKline } from "@/hooks/use-spot-kline"
import { useSymbolKline } from "@/hooks/use-symbol-kline"
import {
  annualizedBasisPct,
  basisPoints,
  daysToCffexExpiry,
  isNearCffexExpiry,
} from "@/lib/client/cffex-expiry"
import {
  type CtpCandle,
  type CtpTick,
  type IndexProduct,
} from "@/lib/client/ctp-market"
import { INDEX_CHART_COLOR, type SpotSnapshot } from "@/lib/client/realtime-overlay"
import { formatCandleTime, getTimeframe, type TimeframeId } from "@/lib/client/timeframes"

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
  zoom?: ChartZoomRange
  onZoomChange?: (zoom: ChartZoomRange) => void
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
  zoom,
  onZoomChange,
}: Props) {
  const [localInterval, setLocalInterval] = useState<TimeframeId>("1m")
  const interval = controlledInterval ?? localInterval
  const setInterval = onIntervalChange ?? setLocalInterval
  const { candles: tfCandles, error: klineError } = useSymbolKline(symbol, interval, candles, quote)
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
  const sessionOnly = interval === "1m"
  const higherTf = interval === "1d" || interval === "1w" || interval === "1M"

  const series = useMemo(() => {
    if (!symbol) return []
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
      const barDays = daysToCffexExpiry(symbol, new Date(candle.time * 1000))
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
    return sessionOnly ? trimOpeningSpikes(points) : points
  }, [higherTf, lastBasis, lastFut, lastSpot, sessionOnly, spotBars, symbol, tfCandles])

  const color = INDEX_CHART_COLOR[product]
  const option = useMemo(() => {
    const times = series.map((p) => formatCandleTime(p.time, interval))
    const values = series.map((p) => Number(p.value.toFixed(2)))
    const minV = values.length ? Math.min(0, ...values) : -1
    const maxV = values.length ? Math.max(0, ...values) : 1
    const pad = Math.max(1, (maxV - minV) * 0.12)
    const { yMin, yMax, yInterval } = nicePercentAxis(minV - pad, maxV + pad)
    const dark = variant === "pro"
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: dark ? "rgba(19,22,34,0.95)" : "rgba(255,255,255,0.95)",
        borderColor: dark ? "#2a2e39" : "#e5e7eb",
        textStyle: { color: dark ? "#d1d4dc" : "#111827", fontSize: 12 },
        valueFormatter: (v: number) => (typeof v === "number" ? `${v.toFixed(2)}%` : "--"),
      },
      grid: { left: 52, right: 16, top: 12, bottom: 24 },
      dataZoom: [
        {
          type: "inside",
          start: zoom?.start ?? 0,
          end: zoom?.end ?? 100,
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
          smooth: interval === "1m" ? 0.1 : 0,
          lineStyle: { width: 1.8, color },
          itemStyle: { color },
          areaStyle: { color: `${color}22`, origin: 0 },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: "#94a3b8", type: "dashed", width: 1 },
            data: [{ yAxis: 0 }],
            label: { show: false },
          },
        },
      ],
    }
  }, [color, interval, series, variant, zoom?.start, zoom?.end])

  const pro = variant === "pro"
  const continuous = !!symbol && /0$/i.test(symbol) && !/\d{4}$/.test(symbol)
  const waitText = klineError || spotError
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
            <TimeframeSelect value={interval} onChange={setInterval} dark={pro} className="mt-1.5" />
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
      <div className="min-h-0 flex-1 px-1 pb-1">
        {series.length > 0 ? (
          <ReactECharts
            option={option}
            style={{ height: pro ? "100%" : 240 }}
            notMerge
            lazyUpdate
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
        ) : (
          <div className={pro ? "flex h-full items-center justify-center text-sm text-[#787b86]" : "flex h-[240px] items-center justify-center text-sm text-muted-foreground"}>
            {waitText}
          </div>
        )}
      </div>
    </div>
  )
}
