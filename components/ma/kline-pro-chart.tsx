"use client"

import { useEffect, useRef } from "react"
import type { Chart, KLineData } from "klinecharts"

import type { CtpCandle } from "@/lib/client/ctp-market"
import { klinePeriod, type TimeframeId } from "@/lib/client/timeframes"
import { cn } from "@/lib/utils"

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
  activeTool: string
  onTool: (id: string) => void
}

export function KlineProChart({ symbol, interval, candles, activeTool, onTool }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Chart | null>(null)
  const candlesRef = useRef(candles)
  const subRef = useRef<((bar: KLineData) => void) | null>(null)
  candlesRef.current = candles

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let disposed = false
    let chart: Chart | null = null
    let ro: ResizeObserver | null = null

    void import("klinecharts").then(({ init, dispose }) => {
      if (disposed || !hostRef.current) return
      chart = init(hostRef.current, {
        locale: "zh-CN",
        timezone: "UTC",
        styles: DARK_STYLES,
      })
      if (!chart) return
      chartRef.current = chart
      chart.setPeriod(klinePeriod(interval))
      chart.setDataLoader({
        getBars: ({ callback }) => {
          callback(candlesRef.current.map(toBar))
        },
        subscribeBar: ({ callback }) => {
          subRef.current = callback
        },
        unsubscribeBar: () => {
          subRef.current = null
        },
      })
      chart.setSymbol({ ticker: symbol, pricePrecision: 1, volumePrecision: 0 })
      chart.createIndicator({ name: "MA", calcParams: [5, 10, 20] }, true)
      chart.createIndicator("VOL")
      chart.createIndicator("MACD")
      ro = new ResizeObserver(() => chart?.resize())
      ro.observe(hostRef.current)
    })

    return () => {
      disposed = true
      ro?.disconnect()
      subRef.current = null
      if (chart) {
        void import("klinecharts").then(({ dispose }) => dispose(chart!))
      }
      chartRef.current = null
    }
    // Recreate only when the host mounts. Symbol changes use setSymbol below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const current = chart.getSymbol()?.ticker
    const period = klinePeriod(interval)
    chart.setPeriod(period)
    if (current !== symbol) {
      chart.setSymbol({ ticker: symbol, pricePrecision: 1, volumePrecision: 0 })
    }
    chart.resetData()
  }, [symbol, interval])

  useEffect(() => {
    const last = candles.at(-1)
    if (!chartRef.current) return
    if (candles.length > 1 && !chartRef.current.getDataList().length) {
      chartRef.current.resetData()
      return
    }
    if (last && subRef.current) subRef.current(toBar(last))
  }, [candles])

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-11 shrink-0 flex-col gap-0.5 border-r border-[#2a2e39] bg-[#1e222d] py-1">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            title={tool.label}
            onClick={() => {
              onTool(tool.id)
              const chart = chartRef.current
              if (tool.overlay && chart) chart.createOverlay(tool.overlay)
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
            chartRef.current?.removeOverlay()
            onTool("cross")
          }}
          className="mt-auto px-0.5 py-1.5 text-[10px] text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
        >
          清除
        </button>
      </div>
      <div ref={hostRef} className="min-h-0 min-w-0 flex-1" />
    </div>
  )
}
