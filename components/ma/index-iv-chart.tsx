"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Lock } from "lucide-react"

import { HelpIndexIv } from "@/components/ma/realtime-chart-help"
import { TimeframeSelect } from "@/components/ma/timeframe-select"
import { type IvLookbackDays, ivLookbackLabel } from "@/lib/client/iv-lookback"
import { IvLookbackSelect } from "@/components/ma/iv-lookback-select"
import { useQvixSeries } from "@/hooks/use-qvix-series"
import { type IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_CHART_COLOR, type IvSnapshot } from "@/lib/client/realtime-overlay"
import { formatCandleTime, getTimeframe, isIntradayTimeframe, type TimeframeId } from "@/lib/client/timeframes"
import { sessionOpenEchartsMarkLine } from "@/lib/client/session-opens"
import { CFFEX_CONTRACT_ROLES, cffexOptionMonthForRole } from "@/lib/client/cffex-expiry"

type Props = {
  title: string
  product: IndexProduct
  iv?: IvSnapshot
  variant?: "default" | "pro"
  interval?: TimeframeId
  onIntervalChange?: (id: TimeframeId) => void
  hideTimeframe?: boolean
  linked?: boolean
  /** null/undefined = QVIX default; else option month like MO2612 */
  ivMonth?: string | null
  onIvMonthChange?: (month: string | null) => void
  hideMonthSelect?: boolean
  /** X-axis session window length (trading days). Default 当日. */
  lookbackDays?: IvLookbackDays
  onLookbackDaysChange?: (days: IvLookbackDays) => void
  hideLookback?: boolean
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "--"
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
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



function sourceNote(interval: TimeframeId, mode: "intraday" | "history" | "unavailable", source?: string | null, lookbackDays: IvLookbackDays = 1, degradedToDaily = false) {
  if (degradedToDaily) {
    return `${ivLookbackLabel(lookbackDays)} · 日线收盘（分钟多日暂不可用）`
  }
  if (mode === "history") {
    return lookbackDays > 1
      ? `${ivLookbackLabel(lookbackDays)} · ${getTimeframe(interval).label}`
      : `${getTimeframe(interval).label} · 历史日线`
  }
  if (source?.startsWith("db:") || source?.startsWith("optbbs-k:")) return "日线（分钟源中断）"
  if (source?.startsWith("optbbs-pre:")) return "昨收（分钟源中断）"
  if (mode === "unavailable") return "分钟源中断"
  if (source?.startsWith("sina-atm:") || source?.startsWith("em-atm:")) {
    return `${ivLookbackLabel(lookbackDays)}${getTimeframe(interval).label} · 近月平值`
  }
  return `${ivLookbackLabel(lookbackDays)}${getTimeframe(interval).label}`
}


export function IndexIvChart({
  title,
  product,
  iv,
  variant = "default",
  interval: controlledInterval,
  onIntervalChange,
  hideTimeframe = false,
  linked = false,
  ivMonth: controlledMonth,
  onIvMonthChange,
  hideMonthSelect = false,
  lookbackDays: controlledLookback,
  onLookbackDaysChange,
  hideLookback = false,
}: Props) {
  const [localInterval, setLocalInterval] = useState<TimeframeId>("1m")
  const [localMonth, setLocalMonth] = useState<string | null>(null)
  const [localLookback, setLocalLookback] = useState<IvLookbackDays>(1)
  const interval = controlledInterval ?? localInterval
  const setInterval = onIntervalChange ?? setLocalInterval
  const ivMonth = controlledMonth !== undefined ? controlledMonth : localMonth
  const setIvMonth = onIvMonthChange ?? setLocalMonth
  const lookbackDays = controlledLookback !== undefined ? controlledLookback : localLookback
  const setLookbackDays = onLookbackDaysChange ?? setLocalLookback
  const { bars, mode, loading, error, source: seriesSource, resolution, degradedToDaily } = useQvixSeries(product, interval, iv, ivMonth, lookbackDays)
  const last = iv?.value ?? bars.at(-1)?.close ?? null
  const seriesChange = bars.length >= 2 ? bars[bars.length - 1].close - bars[bars.length - 2].close : null
  const change = interval === "1m" && mode === "intraday" ? (iv?.change ?? seriesChange) : seriesChange
  const up = change == null && last == null ? null : (change ?? 0) >= 0
  const color = INDEX_CHART_COLOR[product]
  const pro = variant === "pro"

  const option = useMemo(() => {
    const times = bars.map((p) => formatCandleTime(p.time, interval))
    const values = bars.map((p) => Number(p.close.toFixed(2)))
    const dark = variant === "pro"
    const sparse = bars.length < 8
    const lo = values.length ? Math.min(...values) : 0
    const hi = values.length ? Math.max(...values) : 1
    const { min, max, interval: yInterval } = niceRange(lo, hi)
    const sessionMarkLine =
      mode === "intraday" && isIntradayTimeframe(interval)
        ? sessionOpenEchartsMarkLine(times, bars.map((p) => p.time), dark)
        : undefined
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
      grid: { left: 48, right: 16, top: 12, bottom: lookbackDays > 1 || bars.length > 200 ? 40 : 24 },
      dataZoom:
        lookbackDays > 1 || bars.length > 200
          ? [
              {
                type: "inside",
                xAxisIndex: 0,
                filterMode: "none",
              },
              {
                type: "slider",
                xAxisIndex: 0,
                height: 14,
                bottom: 4,
                filterMode: "none",
                textStyle: { color: "#94a3b8", fontSize: 10 },
              },
            ]
          : undefined,
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
        interval: yInterval,
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
          smooth: interval === "1m" && !sparse ? 0.15 : 0,
          lineStyle: { width: 1.8, color },
          itemStyle: { color },
          areaStyle: { color: `${color}22` },
          ...(sessionMarkLine ? { markLine: sessionMarkLine } : {}),
        },
      ],
    }
  }, [bars, color, interval, lookbackDays, mode, variant])

  const emptyText = loading
    ? "加载 QVIX 日线…"
    : error
      ? error
      : mode === "unavailable"
        ? "分钟线中断，日内周期暂不可用"
        : last != null
          ? "暂无该周期数据"
          : "等待 QVIX…"

  return (
    <div className={pro ? "flex h-full min-h-0 flex-col bg-[#131722] text-[#d1d4dc]" : "flex min-h-[320px] flex-col rounded-xl border bg-card"}>
      <div className={pro ? "flex items-start justify-between gap-3 px-3 py-2" : "flex items-start justify-between gap-3 px-4 py-3"}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-semibold">
              {title} 隐含波动率
              <span className="ml-2 font-mono text-xs text-muted-foreground">{iv?.option || product}</span>
            </div>
            <HelpIndexIv product={title} />
          </div>
          {hideTimeframe ? null : (
            <div className="mt-1.5 flex items-center gap-1">
              {linked ? <Lock className="size-3 shrink-0 text-[#4c84ff]" aria-hidden /> : null}
              <TimeframeSelect value={interval} onChange={setInterval} dark={pro} />
            </div>
          )}
          {hideLookback ? null : (
            <div className="mt-1.5 flex items-center gap-1">
              <IvLookbackSelect value={lookbackDays} onChange={setLookbackDays} dark={pro} />
            </div>
          )}
          {hideMonthSelect ? null : (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <select
                value={ivMonth || ""}
                onChange={(e) => setIvMonth(e.target.value || null)}
                className={pro
                  ? "h-7 rounded border border-[#2a2e39] bg-[#1e222d] px-1.5 font-mono text-[11px] text-[#d1d4dc]"
                  : "h-7 rounded border bg-background px-1.5 font-mono text-[11px]"}
                title="IV contract month"
              >
                <option value="">QVIX默认</option>
                {CFFEX_CONTRACT_ROLES.map((role) => {
                  const month = cffexOptionMonthForRole(product, role.id)
                  if (!month) return null
                  return (
                    <option key={role.id} value={month}>
                      {role.label} {month}
                    </option>
                  )
                })}
              </select>
            </div>
          )}
          <div className={pro ? "mt-0.5 text-[11px] text-[#787b86]" : "mt-1 text-[11px] text-muted-foreground"}>
            {ivMonth ? ivMonth : (iv?.name || "QVIX")} · {sourceNote(interval, mode, seriesSource || iv?.source, lookbackDays, degradedToDaily)}
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
        {bars.length > 0 ? (
          <ReactECharts option={option} style={{ height: pro ? "100%" : 240 }} notMerge lazyUpdate />
        ) : (
          <div className={pro ? "flex h-full items-center justify-center px-3 text-center text-sm text-[#787b86]" : "flex h-[240px] items-center justify-center px-3 text-center text-sm text-muted-foreground"}>
            {emptyText}
          </div>
        )}
      </div>
    </div>
  )
}
