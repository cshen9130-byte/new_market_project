"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"

import { TimeframeSelect } from "@/components/ma/timeframe-select"
import { useSymbolKline } from "@/hooks/use-symbol-kline"
import {
  type CtpCandle,
  type CtpTick,
} from "@/lib/client/ctp-market"
import { formatCandleTime, type TimeframeId } from "@/lib/client/timeframes"

export type ChartZoomRange = { start: number; end: number }

/** Bars kept on screen so each candle stays wider than ECharts' 1.3px wick-only mode. */
export const DEFAULT_VISIBLE_BARS: Record<TimeframeId, number> = {
  "1m": 80,
  "5m": 90,
  "15m": 80,
  "30m": 70,
  "1h": 60,
  "4h": 48,
  "1d": 140,
  "1w": 100,
  "1M": 60,
}

const LINE_WHEN_BARS_ABOVE = 150

export function defaultVisibleBars(interval: TimeframeId) {
  return DEFAULT_VISIBLE_BARS[interval]
}

export function candleWindow(count: number, visible: number): ChartZoomRange {
  if (count < 2 || count <= visible) return { start: 0, end: 100 }
  return { start: ((count - visible) / count) * 100, end: 100 }
}

type Props = {
  title: string
  product: string
  symbol: string | null
  symbols: string[]
  candles: CtpCandle[]
  quote?: CtpTick
  onSymbolChange: (symbol: string) => void
  interval?: TimeframeId
  onIntervalChange?: (id: TimeframeId) => void
  hideTimeframe?: boolean
  hideSymbolSelect?: boolean
  zoom?: ChartZoomRange | null
  /** Latest bars to show when `zoom` is unset. Defaults to a readable window for the timeframe. */
  maxBars?: number | null
  onZoomChange?: (zoom: ChartZoomRange) => void
}

function zoomSlice<T>(items: T[], zoom: ChartZoomRange) {
  const n = items.length
  if (!n) return items
  const start = Math.min(n - 1, Math.max(0, Math.floor((zoom.start / 100) * n)))
  const end = Math.min(n, Math.max(start + 1, Math.ceil((zoom.end / 100) * n)))
  return items.slice(start, end)
}

function priceExtent(rows: CtpCandle[]) {
  let lo = Infinity
  let hi = -Infinity
  for (const c of rows) {
    const low = Math.min(c.open, c.close, c.low, c.high)
    const high = Math.max(c.open, c.close, c.low, c.high)
    if (low > 0) lo = Math.min(lo, low)
    if (high > 0) hi = Math.max(hi, high)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1 }
  const pad = Math.max((hi - lo) * 0.08, hi * 0.001, 1)
  const min = Math.floor(lo - pad)
  const max = Math.max(min + 1, Math.ceil(hi + pad))
  return { min, max }
}

function fmt(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "--"
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function IndexFuturesCandleChart({
  title,
  product,
  symbol,
  symbols,
  candles,
  quote,
  onSymbolChange,
  interval: controlledInterval,
  onIntervalChange,
  hideTimeframe = false,
  hideSymbolSelect = false,
  zoom,
  maxBars,
  onZoomChange,
}: Props) {
  const [localInterval, setLocalInterval] = useState<TimeframeId>("1m")
  const interval = controlledInterval ?? localInterval
  const setInterval = onIntervalChange ?? setLocalInterval
  const { candles: tfCandles, error: klineError, loading } = useSymbolKline(symbol, interval, candles, quote)
  const lastCandle = tfCandles.at(-1)
  const last = quote?.last ?? lastCandle?.close ?? null
  const base = quote?.pre_settlement || quote?.pre_close || null
  const diff = last != null && base ? last - base : null
  const pct = diff != null && base ? (diff / base) * 100 : null
  const up = diff == null ? null : diff >= 0
  const changeClass =
    up == null ? "text-muted-foreground" : up ? "text-red-500" : "text-emerald-600"

  const effectiveZoom =
    zoom ?? candleWindow(tfCandles.length, maxBars ?? defaultVisibleBars(interval))

  const option = useMemo(() => {
    const times = tfCandles.map((c) => formatCandleTime(c.time, interval))
    const ohlcv = tfCandles.map((c) => {
      const low = Math.min(c.open, c.close, c.low, c.high)
      const high = Math.max(c.open, c.close, c.low, c.high)
      return [c.open, c.close, low, high]
    })
    const volumes = tfCandles.map((c) => ({
      value: c.volume,
      itemStyle: { color: c.close >= c.open ? "#ef4444" : "#22c55e" },
    }))
    const shown = zoomSlice(tfCandles, effectiveZoom)
    // Packed thinner than ~1.3px, ECharts drops the candle body and draws only
    // the high-low wick, so a multi-day 1m history becomes a sawtooth.
    const dense = shown.length > LINE_WHEN_BARS_ABOVE
    const { min: priceMin, max: priceMax } = priceExtent(shown)
    const firstClose = shown[0]?.close ?? 0
    const lastClose = shown[shown.length - 1]?.close ?? firstClose
    const priceSeries = dense
      ? {
          name: symbol || product,
          type: "line" as const,
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: tfCandles.map((c) => c.close),
          showSymbol: false,
          smooth: false,
          lineStyle: { width: 1.25, color: lastClose >= firstClose ? "#ef4444" : "#22c55e" },
          emphasis: { disabled: true },
        }
      : {
          name: symbol || product,
          type: "candlestick" as const,
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: ohlcv,
          barMaxWidth: 10,
          large: false,
          itemStyle: {
            color: "#ef4444",
            color0: "#22c55e",
            borderColor: "#ef4444",
            borderColor0: "#22c55e",
          },
        }
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(255,255,255,0.95)",
        borderColor: "#e5e7eb",
        textStyle: { color: "#111827", fontSize: 12 },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 56, right: 16, top: 16, height: "62%" },
        { left: 56, right: 16, top: "78%", height: "16%" },
      ],
      xAxis: [
        {
          type: "category",
          data: times,
          gridIndex: 0,
          boundaryGap: true,
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
        {
          type: "category",
          data: times,
          gridIndex: 1,
          boundaryGap: true,
          axisLabel: { fontSize: 10, hideOverlap: true, color: "#94a3b8" },
          axisTick: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true,
          min: priceMin,
          max: priceMax,
          gridIndex: 0,
          axisLabel: {
            fontSize: 10,
            color: "#64748b",
            formatter: (v: number) =>
              Math.round(v).toLocaleString("zh-CN", { maximumFractionDigits: 0 }),
          },
          splitLine: { lineStyle: { opacity: 0.2 } },
        },
        {
          gridIndex: 1,
          axisLabel: { show: false },
          splitLine: { show: false },
          scale: true,
        },
      ],
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0, 1],
          start: effectiveZoom.start,
          end: effectiveZoom.end,
          filterMode: "filter",
        },
      ],
      series: [
        priceSeries,
        {
          name: "成交量",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumes,
          barMaxWidth: 10,
        },
      ],
    }
  }, [tfCandles, product, symbol, interval, effectiveZoom.start, effectiveZoom.end])

  return (
    <div className="flex min-h-[360px] flex-col rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold">
              {title}
              <span className="ml-1.5 text-muted-foreground">({product})</span>
            </h3>
            {hideSymbolSelect ? (
              <span className="font-mono text-xs text-muted-foreground">{symbol}</span>
            ) : symbols.length > 1 ? (
              <select
                className="rounded-md border bg-background px-1.5 py-0.5 text-xs"
                value={symbol || ""}
                onChange={(e) => onSymbolChange(e.target.value)}
              >
                {symbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-muted-foreground">{symbol}</span>
            )}
          </div>
          {hideTimeframe ? null : (
            <TimeframeSelect value={interval} onChange={setInterval} className="mt-1.5" />
          )}
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className={`text-2xl font-semibold tabular-nums ${changeClass}`}>
              {fmt(last)}
            </span>
            <span className={`text-xs tabular-nums ${changeClass}`}>
              {diff == null
                ? "--"
                : `${diff >= 0 ? "+" : ""}${fmt(diff)}  ${pct != null ? `${pct >= 0 ? "+" : ""}${fmt(pct, 2)}%` : ""}`}
            </span>
          </div>
        </div>
        <div className="text-right text-[11px] leading-5 text-muted-foreground tabular-nums">
          <div>Bid {fmt(quote?.bid)} / Ask {fmt(quote?.ask)}</div>
          <div>Vol {fmt(quote?.volume, 0)} · OI {fmt(quote?.open_interest, 0)}</div>
          <div>
            {quote?.update_time
              ? `${quote.update_time}.${String(quote.update_millis || 0).padStart(3, "0")}`
              : lastCandle
                ? formatCandleTime(lastCandle.time, interval)
                : "等待行情"}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 px-1 pb-1">
        {symbol && tfCandles.length > 0 ? (
          <ReactECharts
            option={option}
            style={{ height: 280 }}
            notMerge
            lazyUpdate={false}
            onEvents={
              onZoomChange
                ? {
                    dataZoom: (params: { start?: number; end?: number; batch?: Array<{ start?: number; end?: number }> }) => {
                      const batch = params.batch?.[0] ?? params
                      if (typeof batch.start !== "number" || typeof batch.end !== "number") return
                      const same =
                        Math.abs(batch.start - effectiveZoom.start) < 0.25 &&
                        Math.abs(batch.end - effectiveZoom.end) < 0.25
                      if (!same) onZoomChange({ start: batch.start, end: batch.end })
                    },
                  }
                : undefined
            }
          />
        ) : (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            {symbol
              ? loading
                ? "加载 K 线…"
                : klineError || "暂无 K 线数据"
              : `未订阅 ${product}，请在 ctp_market 的 CTP_INSTRUMENTS 中加入合约`}
          </div>
        )}
      </div>
    </div>
  )
}
