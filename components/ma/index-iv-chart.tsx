"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"

import { formatBarTime, type IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_CHART_COLOR, type IvSnapshot } from "@/lib/client/realtime-overlay"
import { HelpIndexIv } from "@/components/ma/realtime-chart-help"

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

function isDailyIv(bars: { time: number }[]) {
  if (bars.length < 2) return false
  return bars[bars.length - 1].time - bars[0].time > 36 * 3600
}

function formatIvAxisTime(unix: number, daily: boolean) {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  if (daily) return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return formatBarTime(unix)
}

function niceRange(lo: number, hi: number) {
  const pad = Math.max((hi - lo) * 0.08, 0.4)
  let min = Math.floor(lo - pad)
  let max = Math.ceil(hi + pad)
  if (max <= min) max = min + 1
  const span = max - min
  const interval = span <= 6 ? 1 : span <= 12 ? 2 : 5
  min = Math.floor(min / interval) * interval
  max = Math.ceil(max / interval) * interval
  return { min, max, interval }
}

export function IndexIvChart({ title, product, iv, variant = "default" }: Props) {
  const last = iv?.value ?? iv?.bars.at(-1)?.close ?? null
  const change = iv?.change ?? null
  const up = change == null && last == null ? null : (change ?? 0) >= 0
  const color = INDEX_CHART_COLOR[product]

  const option = useMemo(() => {
    const bars = iv?.bars || []
    const daily = isDailyIv(bars) || !!iv?.source?.startsWith("db:")
    const times = bars.map((p) => formatIvAxisTime(p.time, daily))
    const values = bars.map((p) => Number(p.close.toFixed(2)))
    const dark = variant === "pro"
    const sparse = bars.length < 8
    const lo = values.length ? Math.min(...values) : 0
    const hi = values.length ? Math.max(...values) : 1
    const { min, max, interval } = niceRange(lo, hi)
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
        min,
        max,
        interval,
        scale: true,
        axisLabel: { color: "#94a3b8", fontSize: 10, formatter: (v: number) => Number(v).toFixed(1) },
        splitLine: { lineStyle: { color: variant === "pro" ? "#1e222d" : "#f1f5f9" } },
      },
      series: [
        {
          type: "line",
          data: values,
          showSymbol: sparse,
          symbolSize: sparse ? 8 : 4,
          connectNulls: true,
          smooth: daily || sparse ? 0 : 0.15,
          lineStyle: { width: 1.8, color },
          itemStyle: { color },
          areaStyle: { color: `${color}22` },
        },
      ],
    }
  }, [color, iv?.bars, iv?.source, variant])

  const pro = variant === "pro"
  return (
    <div className={pro ? "flex h-full min-h-0 flex-col bg-[#131722] text-[#d1d4dc]" : "flex min-h-[320px] flex-col rounded-xl border bg-card"}>
      <div className={pro ? "flex items-start justify-between gap-3 px-3 py-2" : "flex items-start justify-between gap-3 px-4 py-3"}>
        <div>
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-semibold">
              {title} 隐含波动率
              <span className="ml-2 font-mono text-xs text-muted-foreground">{iv?.option || product}</span>
            </div>
            <HelpIndexIv product={title} />
          </div>
          <div className={pro ? "mt-0.5 text-[11px] text-[#787b86]" : "mt-1 text-[11px] text-muted-foreground"}>
            {iv?.name || "QVIX"} ·{" "}
            {iv?.source?.startsWith("db:")
              ? "日线（分钟源中断）"
              : iv?.source?.startsWith("optbbs-pre:")
                ? "昨收（分钟源中断）"
                : "1 分钟"}
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
        {iv?.bars && iv.bars.length > 0 ? (
          <ReactECharts option={option} style={{ height: pro ? "100%" : 240 }} notMerge lazyUpdate />
        ) : (
          <div className={pro ? "flex h-full items-center justify-center text-sm text-[#787b86]" : "flex h-[240px] items-center justify-center text-sm text-muted-foreground"}>
            {last != null ? "暂无分钟线，仅有最新值" : "等待 QVIX 分钟线…"}
          </div>
        )}
      </div>
    </div>
  )
}
