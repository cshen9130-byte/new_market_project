"use client"

import { useEffect, useRef } from "react"
import type { Chart, KLineData } from "klinecharts"

import { isBuyMark, snapOrderMarks, type ChartOrderMark } from "@/lib/client/chart-order-marks"
import type { CtpCandle } from "@/lib/client/ctp-market"
import { klinePeriod, type TimeframeId } from "@/lib/client/timeframes"
import { cn } from "@/lib/utils"

const ORDER_GROUP = "strategy-orders"
const DRAW_GROUP = "drawings"
let orderOverlayRegistered = false

const TOOLS: Array<{ id: string; overlay?: string; label: string }> = [
  { id: "cross", label: "十字" },
  { id: "segment", overlay: "segment", label: "线段" },
  { id: "ray", overlay: "rayLine", label: "射线" },
  { id: "line", overlay: "straightLine", label: "直线" },
  { id: "hline", overlay: "horizontalStraightLine", label: "水平" },
  { id: "vline", overlay: "verticalStraightLine", label: "垂直" },
  { id: "price", overlay: "priceLine", label: "价格" },
  { id: "fib", overlay: "fibonacciLine", label: "斐波那契" },
  { id: "rect", overlay: "rect", label: "矩形" },
  { id: "parallel", overlay: "parallelStraightLine", label: "平行" },
]

function pricePrecisionOf(symbol: string) {
  const asset = symbol.replace(/\d+$/i, "").toUpperCase()
  if (asset === "TL" || asset === "T" || asset === "TF" || asset === "TS") return 3
  if (asset === "AU" || asset === "SC") return 2
  if (asset === "IF" || asset === "IH" || asset === "IC" || asset === "IM") return 1
  return 0
}

function toBar(c: CtpCandle): KLineData {
  return {
    timestamp: c.time * 1000,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }
}

const DARK_STYLES = {
  grid: {
    show: true,
    horizontal: { color: "#1e222d" },
    vertical: { color: "#1e222d" },
  },
  candle: {
    type: "candle_solid" as const,
    bar: {
      upColor: "#ef5350",
      downColor: "#26a69a",
      upBorderColor: "#ef5350",
      downBorderColor: "#26a69a",
      upWickColor: "#ef5350",
      downWickColor: "#26a69a",
    },
    priceMark: {
      last: {
        upColor: "#ef5350",
        downColor: "#26a69a",
      },
    },
    tooltip: { showRule: "follow_cross" as const },
  },
  indicator: {
    tooltip: { showRule: "follow_cross" as const },
  },
  xAxis: {
    axisLine: { color: "#2a2e39" },
    tickLine: { color: "#2a2e39" },
    tickText: { color: "#787b86" },
  },
  yAxis: {
    axisLine: { color: "#2a2e39" },
    tickLine: { color: "#2a2e39" },
    tickText: { color: "#787b86" },
  },
  separator: { color: "#2a2e39" },
  crosshair: {
    horizontal: { line: { color: "#758696" }, text: { backgroundColor: "#131722" } },
    vertical: { line: { color: "#758696" }, text: { backgroundColor: "#131722" } },
  },
}

type Props = {
  symbol: string
  interval: TimeframeId
  candles: CtpCandle[]
  marks?: ChartOrderMark[]
  compact?: boolean
  activeTool?: string
  onTool?: (id: string) => void
}

function registerOrderOverlay(registerOverlay: (overlay: Record<string, unknown>) => void) {
  if (orderOverlayRegistered) return
  orderOverlayRegistered = true
  registerOverlay({
    name: "orderMark",
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }: { coordinates: Array<{ x: number; y: number }>; overlay: { extendData?: ChartOrderMark } }) => {
      if (!coordinates[0]) return []
      const mark = overlay.extendData
      if (!mark) return []
      const buy = isBuyMark(mark)
      const color = buy ? "#ef5350" : "#26a69a"
      const { x, y } = coordinates[0]
      const size = 6
      const gap = 10
      const triangle = buy
        ? [
            { x, y: y + gap },
            { x: x - size, y: y + gap + size * 1.6 },
            { x: x + size, y: y + gap + size * 1.6 },
          ]
        : [
            { x, y: y - gap },
            { x: x - size, y: y - gap - size * 1.6 },
            { x: x + size, y: y - gap - size * 1.6 },
          ]
      const textY = buy ? y + gap + size * 1.6 + 11 : y - gap - size * 1.6 - 3
      return [
        {
          type: "polygon",
          attrs: { coordinates: triangle },
          styles: { style: "fill", color, borderColor: color },
          ignoreEvent: true,
        },
        {
          type: "text",
          attrs: { x, y: textY, text: mark.text, align: "center", baseline: buy ? "top" : "bottom" },
          styles: { color, size: 10, weight: "bold" },
          ignoreEvent: true,
        },
      ]
    },
    onRightClick: (event: { preventDefault?: () => void }) => {
      event.preventDefault?.()
      return true
    },
  })
}

function applyOrderMarks(
  chart: Chart,
  marks: ChartOrderMark[] | undefined,
  candles: CtpCandle[],
  interval: TimeframeId,
) {
  chart.removeOverlay({ groupId: ORDER_GROUP })
  const snapped = snapOrderMarks(marks || [], candles, interval)
  if (!snapped.length) return
  chart.createOverlay(
    snapped.map((mark) => ({
      name: "orderMark",
      id: mark.id,
      groupId: ORDER_GROUP,
      lock: true,
      points: [{ timestamp: mark.time * 1000, value: mark.price }],
      extendData: mark,
    })),
  )
}

type AppliedSeries = { first: number; last: number; len: number; fingerprint?: string }

function barFingerprint(bar: CtpCandle) {
  return `${bar.time}:${bar.open}:${bar.high}:${bar.low}:${bar.close}:${bar.volume}`
}

export function KlineProChart({ symbol, interval, candles, marks, compact, activeTool = "cross", onTool }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Chart | null>(null)
  const candlesRef = useRef(candles)
  const symbolRef = useRef(symbol)
  const intervalRef = useRef(interval)
  const subRef = useRef<((bar: KLineData) => void) | null>(null)
  const appliedRef = useRef<AppliedSeries | null>(null)
  const appliedSymbolRef = useRef<string | null>(null)
  const appliedIntervalRef = useRef<TimeframeId | null>(null)
  const marksRef = useRef(marks)
  candlesRef.current = candles
  symbolRef.current = symbol
  intervalRef.current = interval
  marksRef.current = marks

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let disposed = false
    let chart: Chart | null = null
    let ro: ResizeObserver | null = null

    void import("klinecharts").then(({ init, dispose, registerOverlay }) => {
      if (disposed || !hostRef.current) return
      registerOrderOverlay(registerOverlay as (overlay: Record<string, unknown>) => void)
      chart = init(hostRef.current, {
        locale: "zh-CN",
        timezone: "UTC",
        styles: DARK_STYLES,
      })
      if (!chart) return
      chartRef.current = chart
      chart.setPeriod(klinePeriod(intervalRef.current))
      chart.setDataLoader({
        getBars: (params: {
          type?: string
          timestamp?: number | null
          callback: (data: KLineData[], more?: boolean) => void
        }) => {
          const { type, timestamp, callback } = params
          const bars = candlesRef.current.map(toBar)
          // Always tell the chart this in-memory series is complete. Returning the
          // full list on `forward` prepends duplicates and leaves a blank left gap.
          if (type === "forward") {
            const older = timestamp != null ? bars.filter((bar) => bar.timestamp < timestamp) : []
            callback(older, false)
            return
          }
          if (type === "backward") {
            const newer = timestamp != null ? bars.filter((bar) => bar.timestamp > timestamp) : []
            callback(newer, false)
            return
          }
          callback(bars, false)
        },
        subscribeBar: ({ callback }) => {
          subRef.current = callback
        },
        unsubscribeBar: () => {
          subRef.current = null
        },
      })
      chart.setSymbol({ ticker: symbolRef.current, pricePrecision: pricePrecisionOf(symbolRef.current), volumePrecision: 0 })
      appliedSymbolRef.current = symbolRef.current
      appliedIntervalRef.current = intervalRef.current
      chart.createIndicator({ name: "MA", calcParams: compact ? [5, 20] : [5, 10, 20] }, true)
      chart.createIndicator("VOL")
      if (!compact) chart.createIndicator("MACD")
      applyOrderMarks(chart, marksRef.current, candlesRef.current, intervalRef.current)
      ro = new ResizeObserver(() => chart?.resize())
      ro.observe(hostRef.current)
    })

    return () => {
      disposed = true
      ro?.disconnect()
      subRef.current = null
      appliedRef.current = null
      if (chart) {
        void import("klinecharts").then(({ dispose }) => dispose(chart!))
      }
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    let changed = false
    if (appliedIntervalRef.current !== interval) {
      chart.setPeriod(klinePeriod(interval))
      appliedIntervalRef.current = interval
      changed = true
    }
    if (appliedSymbolRef.current !== symbol) {
      chart.setSymbol({ ticker: symbol, pricePrecision: pricePrecisionOf(symbol), volumePrecision: 0 })
      appliedSymbolRef.current = symbol
      changed = true
    }
    if (changed) appliedRef.current = null
  }, [symbol, interval])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (appliedSymbolRef.current !== symbol || appliedIntervalRef.current !== interval) return
    const last = candles.at(-1)
    if (!last) {
      if (chart.getDataList()?.length) chart.resetData()
      appliedRef.current = null
      return
    }
    const first = candles[0].time
    const prev = appliedRef.current
    const chartLen = chart.getDataList()?.length || 0
    const fingerprint = barFingerprint(last)
    const seriesReplaced = !prev || first !== prev.first || candles.length + 8 < (prev.len || 0)
    const historyExtended = !!prev && first < prev.first - 30 && candles.length > prev.len
    const needInit = chartLen === 0 && candles.length > 1
    appliedRef.current = { first, last: last.time, len: candles.length, fingerprint }
    if (needInit || historyExtended || seriesReplaced) {
      chart.resetData()
      applyOrderMarks(chart, marksRef.current, candles, interval)
      return
    }
    if (prev?.fingerprint === fingerprint) return
    if (subRef.current) subRef.current(toBar(last))
  }, [candles, symbol, interval])

  const marksKey = (marks || []).map((mark) => mark.id).join("|")
  const seriesKey = `${symbol}:${interval}:${candles[0]?.time ?? 0}:${candles.at(-1)?.time ?? 0}`

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    applyOrderMarks(chart, marksRef.current, candlesRef.current, intervalRef.current)
  }, [marksKey, seriesKey])

  return (
    <div className="flex h-full min-h-0">
      {compact ? null : (
        <div className="flex w-11 shrink-0 flex-col gap-0.5 border-r border-[#2a2e39] bg-[#1e222d] py-1">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              title={tool.label}
              onClick={() => {
                onTool?.(tool.id)
                const chart = chartRef.current
                if (tool.overlay && chart) chart.createOverlay({ name: tool.overlay, groupId: DRAW_GROUP })
              }}
              className={cn(
                "px-0.5 py-1.5 text-[10px] leading-tight text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white",
                activeTool === tool.id && "bg-[#2a2e39] text-white",
              )}
            >
              {tool.label}
            </button>
          ))}
          <button
            type="button"
            title="清除画线"
            onClick={() => {
              chartRef.current?.removeOverlay({ groupId: DRAW_GROUP })
              onTool?.("cross")
            }}
            className="mt-auto px-0.5 py-1.5 text-[10px] text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
          >
            清除
          </button>
        </div>
      )}
      <div ref={hostRef} className="min-h-0 min-w-0 flex-1" />
    </div>
  )
}
