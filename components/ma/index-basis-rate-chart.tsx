"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"

import { annualizedBasisPct, daysToCffexExpiry } from "@/lib/client/cffex-expiry"
import {
  type CtpCandle,
  type CtpTick,
  type IndexProduct,
  formatBarTime,
} from "@/lib/client/ctp-market"
import { INDEX_CHART_COLOR, type SpotSnapshot } from "@/lib/client/realtime-overlay"

type Props = {
  title: string
  product: IndexProduct
  symbol: string | null
  candles: CtpCandle[]
  quote?: CtpTick
  spot?: SpotSnapshot
  variant?: "default" | "pro"
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "--"
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function IndexBasisRateChart({ title, product, symbol, candles, quote, spot, variant = "default" }: Props) {
  const days = symbol ? daysToCffexExpiry(symbol) : null
  const lastFut = quote?.last ?? candles.at(-1)?.close ?? null
  const lastSpot = spot?.price ?? spot?.bars.at(-1)?.close ?? null
  const lastBasis = lastFut != null && lastSpot != null && days != null
    ? annualizedBasisPct(lastFut, lastSpot, days)
    : null
  const up = lastBasis == null ? null : lastBasis >= 0

  const series = useMemo(() => {
    if (!days || !spot?.bars.length) return []
    const spotByTime = new Map(spot.bars.map((bar) => [bar.time, bar.close]))
    let lastKnown: number | null = null
    const spotTimes = [...spot.bars].sort((a, b) => a.time - b.time)
    let si = 0
    const points: { time: number; value: number }[] = []
    for (const candle of candles) {
      while (si < spotTimes.length && spotTimes[si].time <= candle.time) {
        lastKnown = spotTimes[si].close
        si += 1
      }
      const spotPx = spotByTime.get(candle.time) ?? lastKnown
      if (spotPx == null) continue
      const value = annualizedBasisPct(candle.close, spotPx, days)
      if (value == null) continue
      points.push({ time: candle.time, value })
    }
    if (lastFut != null && lastSpot != null && lastBasis != null) {
      const t = candles.at(-1)?.time ?? spot.bars.at(-1)?.time
      if (t != null && (!points.length || points[points.length - 1].time !== t)) {
        points.push({ time: t, value: lastBasis })
      } else if (points.length) {
        points[points.length - 1].value = lastBasis
      }
    }
    return points
  }, [candles, days, lastBasis, lastFut, lastSpot, spot])

  const color = INDEX_CHART_COLOR[product]
  const option = useMemo(() => {
    const times = series.map((p) => formatBarTime(p.time))
    const values = series.map((p) => p.value)
    const absMax = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    const pad = Math.max(2, Math.ceil(absMax * 1.2 * 10) / 10)
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
      xAxis: {
        type: "category",
        data: times,
        axisLabel: { color: "#94a3b8", fontSize: 10, hideOverlap: true },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: -pad,
        max: pad,
        axisLabel: { color: "#94a3b8", fontSize: 10, formatter: (v: number) => `${v}` },
        splitLine: { lineStyle: { color: dark ? "#1e222d" : "#f1f5f9" } },
      },
      series: [
        {
          type: "line",
          data: values,
          showSymbol: false,
          smooth: 0.15,
          lineStyle: { width: 1.8, color },
          itemStyle: { color },
          areaStyle: { color: `${color}22` },
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
  }, [color, series, variant])

  const pro = variant === "pro"
  return (
    <div className={pro ? "flex h-full min-h-0 flex-col bg-[#131722] text-[#d1d4dc]" : "flex min-h-[320px] flex-col rounded-xl border bg-card"}>
      <div className={pro ? "flex items-start justify-between gap-3 px-3 py-2" : "flex items-start justify-between gap-3 px-4 py-3"}>
        <div>
          <div className="text-sm font-semibold">
            {title} 年化基差率
            {symbol ? <span className="ml-2 font-mono text-xs text-muted-foreground">{symbol}</span> : null}
          </div>
          {!pro ? (
            <div className="mt-1 text-[11px] text-muted-foreground">
              (期货 − 现货) / 现货 / 剩余天数 × 365
              {days != null ? ` · 剩余 ${days} 天` : ""}
              {spot?.name ? ` · 现货 ${spot.name}` : ""}
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-[#787b86]">
              {spot?.name || ""}{days != null ? ` · ${days}D` : ""}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold tabular-nums ${up == null ? "text-muted-foreground" : up ? "text-red-500" : "text-emerald-600"}`}>
            {lastBasis == null ? "--" : `${lastBasis >= 0 ? "+" : ""}${fmt(lastBasis)}%`}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            F {fmt(lastFut, 1)} / S {fmt(lastSpot, 1)}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 px-1 pb-1">
        {series.length > 0 ? (
          <ReactECharts option={option} style={{ height: pro ? "100%" : 240 }} lazyUpdate />
        ) : (
          <div className={pro ? "flex h-full items-center justify-center text-sm text-[#787b86]" : "flex h-[240px] items-center justify-center text-sm text-muted-foreground"}>
            {symbol ? "等待现货与期货 1 分钟对齐…" : `未订阅 ${product}`}
          </div>
        )}
      </div>
    </div>
  )
}
