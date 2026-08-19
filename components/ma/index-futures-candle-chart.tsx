"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"

import {
  type CtpCandle,
  type CtpTick,
  formatBarTime,
} from "@/lib/client/ctp-market"

type Props = {
  title: string
  product: string
  symbol: string | null
  symbols: string[]
  candles: CtpCandle[]
  quote?: CtpTick
  onSymbolChange: (symbol: string) => void
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
}: Props) {
  const lastCandle = candles.at(-1)
  const last = quote?.last ?? lastCandle?.close ?? null
  const base = quote?.pre_settlement || quote?.pre_close || null
  const diff = last != null && base ? last - base : null
  const pct = diff != null && base ? (diff / base) * 100 : null
  const up = diff == null ? null : diff >= 0
  const changeClass =
    up == null ? "text-muted-foreground" : up ? "text-red-500" : "text-emerald-600"

  const option = useMemo(() => {
    const times = candles.map((c) => formatBarTime(c.time))
    const ohlcv = candles.map((c) => [c.open, c.close, c.low, c.high])
    const volumes = candles.map((c) => ({
      value: c.volume,
      itemStyle: { color: c.close >= c.open ? "#ef4444" : "#22c55e" },
    }))
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
          gridIndex: 0,
          axisLabel: { fontSize: 10, color: "#64748b" },
          splitLine: { lineStyle: { opacity: 0.2 } },
        },
        {
          gridIndex: 1,
          axisLabel: { show: false },
          splitLine: { show: false },
          scale: true,
        },
      ],
      dataZoom: [{ type: "inside", xAxisIndex: [0, 1] }],
      series: [
        {
          name: symbol || product,
          type: "candlestick",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: ohlcv,
          itemStyle: {
            color: "#ef4444",
            color0: "#22c55e",
            borderColor: "#ef4444",
            borderColor0: "#22c55e",
          },
        },
        {
          name: "成交量",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumes,
        },
      ],
    }
  }, [candles, product, symbol])

  return (
    <div className="flex min-h-[360px] flex-col rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold">
              {title}
              <span className="ml-1.5 text-muted-foreground">({product})</span>
            </h3>
            {symbols.length > 1 ? (
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
              <span className="text-xs text-muted-foreground">{symbol} 主力连续</span>
            )}
          </div>
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
                ? formatBarTime(lastCandle.time)
                : "等待行情"}
          </div>
          {quote && (quote.volume === 0 || quote.volume == null) && quote.bid == null && quote.ask == null ? (
            <div>静态报价（无盘口）</div>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 px-1 pb-1">
        {symbol && candles.length > 0 ? (
          <ReactECharts option={option} style={{ height: 280 }} lazyUpdate />
        ) : (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            {symbol ? "等待 1 分钟 K 线…" : `未订阅 ${product}，请在 ctp_market 的 CTP_INSTRUMENTS 中加入合约`}
          </div>
        )}
      </div>
    </div>
  )
}
