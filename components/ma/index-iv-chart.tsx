"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"

import { formatBarTime, type IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_CHART_COLOR, type IvSnapshot } from "@/lib/client/realtime-overlay"

type Props = {
  title: string
  product: IndexProduct
  iv?: IvSnapshot
  variant?: "default" | "pro"
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "--"
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function IndexIvChart({ title, product, iv, variant = "default" }: Props) {
  const last = iv?.value ?? iv?.bars.at(-1)?.close ?? null
  const change = iv?.change ?? null
  const up = change == null && last == null ? null : (change ?? 0) >= 0
  const color = INDEX_CHART_COLOR[product]

  const option = useMemo(() => {
    const bars = iv?.bars || []
    const times = bars.map((p) => formatBarTime(p.time))
    const values = bars.map((p) => p.close)
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
      grid: { left: 48, right: 16, top: 12, bottom: 24 },
      xAxis: {
        type: "category",
        data: times,
        axisLabel: { color: "#94a3b8", fontSize: 10, hideOverlap: true },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: "#94a3b8", fontSize: 10, formatter: (v: number) => `${v}` },
        splitLine: { lineStyle: { color: variant === "pro" ? "#1e222d" : "#f1f5f9" } },
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
        },
      ],
    }
  }, [color, iv?.bars, variant])

  const pro = variant === "pro"
  return (
    <div className={pro ? "flex h-full min-h-0 flex-col bg-[#131722] text-[#d1d4dc]" : "flex min-h-[320px] flex-col rounded-xl border bg-card"}>
      <div className={pro ? "flex items-start justify-between gap-3 px-3 py-2" : "flex items-start justify-between gap-3 px-4 py-3"}>
        <div>
          <div className="text-sm font-semibold">
            {title} 隐含波动率
            <span className="ml-2 font-mono text-xs text-muted-foreground">{iv?.option || product}</span>
          </div>
          <div className={pro ? "mt-0.5 text-[11px] text-[#787b86]" : "mt-1 text-[11px] text-muted-foreground"}>
            {iv?.name || "QVIX"} · 1 分钟
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold tabular-nums ${up == null ? "text-muted-foreground" : up ? "text-red-500" : "text-emerald-600"}`}>
            {last == null ? "--" : `${fmt(last)}%`}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {change == null ? "--" : `${change >= 0 ? "+" : ""}${fmt(change)}`}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 px-1 pb-1">
        {iv?.bars && iv.bars.length > 1 ? (
          <ReactECharts option={option} style={{ height: pro ? "100%" : 240 }} lazyUpdate />
        ) : (
          <div className={pro ? "flex h-full items-center justify-center text-sm text-[#787b86]" : "flex h-[240px] items-center justify-center text-sm text-muted-foreground"}>
            等待 QVIX 分钟线…
          </div>
        )}
      </div>
    </div>
  )
}
