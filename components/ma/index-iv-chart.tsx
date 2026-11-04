"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Lock } from "lucide-react"

import { HelpIndexIv } from "@/components/ma/realtime-chart-help"
import { TimeframeSelect } from "@/components/ma/timeframe-select"
import { type IvLookbackDays, ivLookbackLabel } from "@/lib/client/iv-lookback"
import { IvLookbackSelect } from "@/components/ma/iv-lookback-select"
import { useQvixSeries } from "@/hooks/use-qvix-series"
import { useSymbolKline } from "@/hooks/use-symbol-kline"
import type { CtpCandle } from "@/lib/client/ctp-market"
import { annualizedGarmanKlassByTime, levelScaleFactor, volPeriodsPerYear } from "@/lib/client/rolling-volatility"
import { ivReturnScale, omitIsolatedNulls, padIntradaySeries, plotOnVisibleWindow, quoteAxisEnd, returnBaseline, STACKED_QUOTE_PLOT, type ChartVisibleWindow } from "@/lib/client/qvix-series"
import type { ChartViewportMode } from "@/components/ma/kline-pro-chart"
import { useIvContracts } from "@/hooks/use-iv-contracts"
import { type IndexProduct } from "@/lib/client/ctp-market"
import { INDEX_CHART_COLOR, type IvSnapshot } from "@/lib/client/realtime-overlay"
import { bucketTime, formatCandleTime, getTimeframe, intradaySessionSlots, isIntradayTimeframe, type TimeframeId } from "@/lib/client/timeframes"
import { sessionOpenEchartsMarkLine } from "@/lib/client/session-opens"
import { ChartPointerCapture } from "@/components/ma/use-synced-crosshair"
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
  /** Pro kline window. Fixed keeps the axis through 15:00; follow ends at the current minute. */
  viewportMode?: ChartViewportMode
  /** Main-chart visible range. Pro charts on the same frequency draw this window. */
  visibleWindow?: ChartVisibleWindow | null
  /** Unix seconds of the main-chart hover, while the 联动 tool is on. */
  cursorTime?: number | null
  /** Main-chart contract. Enables the 区间波动20 overlay. */
  symbol?: string | null
  /** Candles for `priceInterval`. Reused when that interval matches this chart. */
  priceCandles?: CtpCandle[]
  priceInterval?: TimeframeId
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



function seriesUsesContractPair(source?: string | null) {
  if (!source) return false
  return (
    source.startsWith("sina-atm:") ||
    source.startsWith("em-atm:") ||
    source.startsWith("qvix-sina:") ||
    source.startsWith("qvix-cffex:") ||
    source.startsWith("archive:")
  )
}

function contractLine(mode: "intraday" | "history" | "unavailable", source: string | null | undefined, contract: string | null | undefined, degradedToDaily: boolean) {
  if (!contract) return null
  if (mode === "intraday" && !degradedToDaily && seriesUsesContractPair(source)) return `计算合约 ${contract}`
  return `QVIX近月平值 ${contract}`
}

const UP_COLOR = "#ef4444"
const DOWN_COLOR = "#059669"

function latestClose(values: Array<number | null>) {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i]
    if (value != null && Number.isFinite(value)) return value
  }
  return null
}

function ivLine(
  data: Array<number | null>,
  stroke: string,
  area: string,
  sparse: boolean,
  interval: TimeframeId,
  connectNulls: boolean,
  markLine?: Record<string, unknown>,
  name?: string,
) {
  return {
    name,
    type: "line" as const,
    yAxisIndex: 0,
    data,
    showSymbol: sparse,
    symbolSize: sparse ? 8 : 4,
    connectNulls,
    smooth: interval === "1m" && !sparse ? 0.15 : 0,
    lineStyle: { width: 1.8, color: stroke },
    itemStyle: { color: stroke },
    areaStyle: { color: area },
    ...(markLine ? { markLine } : {}),
  }
}

function ivLineSeries(
  values: Array<number | null>,
  color: string,
  prev: number | null,
  sparse: boolean,
  interval: TimeframeId,
  markLine?: Record<string, unknown>,
  joinGaps?: boolean,
) {
  const last = latestClose(values)
  const stroke = prev != null && last != null ? (last >= prev ? UP_COLOR : DOWN_COLOR) : color
  return [ivLine(values, stroke, `${stroke}22`, sparse, interval, joinGaps ?? !hasInternalGap(values, 20), markLine, "隐含波动率")]
}

/** A long empty stretch between two prints stays open. A missing minute still joins. */
function hasInternalGap(values: Array<number | null>, limit = 5) {
  let start = 0
  while (start < values.length && values[start] == null) start += 1
  let end = values.length - 1
  while (end >= start && values[end] == null) end -= 1
  let run = 0
  for (let i = start; i <= end; i += 1) {
    if (values[i] == null) {
      run += 1
      if (run >= limit) return true
    } else {
      run = 0
    }
  }
  return false
}

function dataSourceLabel(source?: string | null) {
  if (!source) return null
  if (source.startsWith("optbbs:")) return "期权论坛分钟"
  if (source === "sina") return "新浪QVIX分钟"
  if (source.startsWith("qvix-sina:") || source.startsWith("sina-atm:")) return "新浪ETF期权"
  if (source.endsWith("1000index") && (source.startsWith("qvix-cffex:") || source.startsWith("em-atm:"))) {
    return "新浪实时+东财分钟"
  }
  if (source.startsWith("qvix-cffex:") || source.startsWith("em-atm:")) return "东财期权"
  if (source.startsWith("optbbs-k:")) return "期权论坛日线"
  if (source.startsWith("archive:")) return "库内期权分钟"
  if (source.startsWith("db:")) return "库内QVIX日线"
  if (source.startsWith("optbbs-pre:")) return "期权论坛昨收"
  if (source.startsWith("optbbs-daily:")) return "期权论坛日线"
  return source.split(":")[0] || source
}

function sourceNote(interval: TimeframeId, mode: "intraday" | "history" | "unavailable", source?: string | null, lookbackDays: IvLookbackDays = 1, degradedToDaily = false, specificStrike = false) {
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
  if (!specificStrike && (source?.startsWith("sina-atm:") || source?.startsWith("em-atm:"))) {
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
  viewportMode,
  visibleWindow,
  cursorTime,
  symbol = null,
  priceCandles,
  priceInterval,
}: Props) {
  const [localInterval, setLocalInterval] = useState<TimeframeId>("1m")
  const [localMonth, setLocalMonth] = useState<string | null>(null)
  const [localLookback, setLocalLookback] = useState<IvLookbackDays>(1)
  const [ivStrike, setIvStrike] = useState<string | null>(null)
  const [compareGk, setCompareGk] = useState(false)
  const interval = controlledInterval ?? localInterval
  const setInterval = onIntervalChange ?? setLocalInterval
  const ivMonth = controlledMonth !== undefined ? controlledMonth : localMonth
  const setIvMonth = onIvMonthChange ?? setLocalMonth
  const lookbackDays = controlledLookback !== undefined ? controlledLookback : localLookback
  const setLookbackDays = onLookbackDaysChange ?? setLocalLookback
  const contracts = useIvContracts(product, ivMonth)
  const strikeNum = ivStrike ? Number(ivStrike) : null
  const { bars, mode, loading, error, source: seriesSource, degradedToDaily, contract: seriesContract } = useQvixSeries(product, interval, iv, ivMonth, lookbackDays, strikeNum)
  const pinnedSeries = strikeNum != null || !!ivMonth || lookbackDays > 1
  const last = pinnedSeries ? (bars.at(-1)?.close ?? null) : (iv?.value ?? bars.at(-1)?.close ?? null)
  const prevClose = returnBaseline(bars, !ivMonth && strikeNum == null ? (iv?.prevClose ?? null) : null)
  const dayReturn = last != null && prevClose != null && prevClose > 0 ? ((last - prevClose) / prevClose) * 100 : null
  const up = dayReturn == null ? null : dayReturn >= 0
  const color = INDEX_CHART_COLOR[product]
  const shownContract = pinnedSeries ? seriesContract : (seriesContract || iv?.contract)
  const activeSource = seriesSource || (pinnedSeries ? null : iv?.source)
  const contractText = contractLine(mode, activeSource, shownContract, degradedToDaily)
  const sourceText = dataSourceLabel(activeSource)
  const pro = variant === "pro"
  const monthToken = ivMonth || ""
  const prevMonth = useRef(monthToken)
  const prevProduct = useRef(product)
  useEffect(() => {
    if (prevProduct.current === product) return
    prevProduct.current = product
    setIvStrike(null)
  }, [product])
  useEffect(() => {
    if (prevMonth.current === monthToken) return
    prevMonth.current = monthToken
    setIvStrike(null)
  }, [monthToken])
  useEffect(() => {
    if (!ivStrike || !contracts.length) return
    if (!contracts.some((item) => item.id === ivStrike)) setIvStrike(null)
  }, [contracts, ivStrike])
  const selectedContract = contracts.find((item) => item.id === ivStrike) || null
  const selectClass = pro
    ? "h-6 max-w-[9rem] rounded border border-[#2a2e39] bg-[#1e222d] px-1.5 font-mono text-[11px] text-[#d1d4dc]"
    : "h-6 max-w-[9rem] rounded border bg-background px-1.5 font-mono text-[11px]"
  const reusePrice = compareGk && priceInterval === interval && (priceCandles?.length ?? 0) > 0
  const gkKline = useSymbolKline(compareGk && !reusePrice ? symbol : null, interval, [], undefined, { history: true })
  const gkCandles = reusePrice ? priceCandles! : gkKline.candles
  const gkPeriods = volPeriodsPerYear(interval, isIntradayTimeframe(interval) ? intradaySessionSlots(symbol, interval) : 0)
  const gkByTime = useMemo(() => {
    if (!compareGk || !gkCandles.length) return new Map<number, number>()
    return annualizedGarmanKlassByTime(gkCandles, 20, gkPeriods, (time) => bucketTime(time, interval))
  }, [compareGk, gkCandles, gkPeriods, interval])

  const chartRef = useRef<ReactECharts>(null)
  const plottedTimesRef = useRef<number[]>([])
  const describeRef = useRef<(index: number) => string>(() => "")
  const driven = variant === "pro" && cursorTime != null
  const chartModel = useMemo(() => {
    const padded =
      mode === "intraday" && isIntradayTimeframe(interval)
        ? padIntradaySeries(bars, interval, Math.max(lookbackDays, 1), quoteAxisEnd(variant === "pro" ? viewportMode : undefined))
        : null
    // 当日 stays on the main chart's window. 2日 / 5日 / 10日 own this chart's axis.
    const follow = variant === "pro" && lookbackDays <= 1 ? visibleWindow : null
    const extendTo = follow?.coversAll && viewportMode === "fixed-window" && isIntradayTimeframe(interval)
      ? quoteAxisEnd("fixed-window")
      : undefined
    const aligned = padded ? (variant === "pro" ? padded : omitIsolatedNulls(padded)) : bars
    const plot = plotOnVisibleWindow(aligned, follow, interval, extendTo)
    plottedTimesRef.current = plot.map((p) => p.time)
    const times = plot.map((p) => formatCandleTime(p.time, interval))
    const values = plot.map((p) => (p.close == null || !Number.isFinite(p.close) ? null : Number(p.close.toFixed(2))))
    const gkRaw = compareGk
      ? plot.map((p) => {
          const value = gkByTime.get(bucketTime(p.time, interval))
          return value == null || !Number.isFinite(value) ? null : value
        })
      : null
    const gkScale = gkRaw ? levelScaleFactor(values, gkRaw) : null
    const gkValues = gkRaw?.map((value) => (value == null || gkScale == null ? null : Number((value * gkScale).toFixed(2)))) ?? null
    const ivNumeric = values.filter((value): value is number => value != null)
    const numeric = [
      ...ivNumeric,
      ...(gkValues?.filter((value): value is number => value != null) ?? []),
    ]
    const dark = variant === "pro"
    const sparse = ivNumeric.length < 8
    const lo = numeric.length ? Math.min(...numeric) : 0
    const hi = numeric.length ? Math.max(...numeric) : 1
    const returnScale = !compareGk && mode === "intraday" && prevClose != null && ivNumeric.length > 0
      ? ivReturnScale(lo, hi, prevClose)
      : null
    const { min, max, interval: yInterval } = returnScale
      ? { min: returnScale.leftMin, max: returnScale.leftMax, interval: returnScale.leftInterval }
      : niceRange(lo, hi)
    const zeroLine = returnScale
      ? [{
          yAxis: returnScale.prev,
          label: {
            formatter: "昨收",
            show: true,
            color: dark ? "#787b86" : "#64748b",
            fontSize: 10,
            position: "insideStartTop",
          },
          lineStyle: { color: dark ? "#363a45" : "#cbd5e1", type: "dashed" as const, width: 1 },
        }]
      : []
    const sessionMarkLine =
      mode === "intraday" && isIntradayTimeframe(interval)
        ? sessionOpenEchartsMarkLine(times, plot.map((p) => p.time), dark, zeroLine)
        : undefined
    describeRef.current = (index) => {
      const when = times[index] ?? ""
      const value = values[index]
      const text = typeof value === "number" ? `${value.toFixed(2)}%` : "--"
      if (!returnScale || typeof value !== "number") return `${when}\n隐含波动率 ${text}`
      const ret = ((value - returnScale.prev) / returnScale.prev) * 100
      const retText = `${ret > 0 ? "+" : ""}${ret.toFixed(2)}%`
      return `${when}\n隐含波动率 ${text}\n涨跌 ${retText}`
    }
    const option = {
      animation: false,
      backgroundColor: "transparent",
      tooltip: { show: false },
      grid: {
        left: STACKED_QUOTE_PLOT.left,
        right: variant === "pro" || returnScale ? STACKED_QUOTE_PLOT.right : 16,
        top: 12,
        bottom: lookbackDays > 1 ? 40 : 24,
      },
      dataZoom:
        follow
          ? undefined
          : lookbackDays > 1
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
      yAxis: [
        {
          type: "value",
          min,
          max,
          interval: yInterval,
          scale: !returnScale,
          axisLabel: {
            color: "#94a3b8",
            fontSize: 10,
            formatter: (v: number) => Number(v).toFixed(returnScale ? 2 : 1),
          },
          splitLine: { lineStyle: { color: variant === "pro" ? "#1e222d" : "#f1f5f9" } },
          axisPointer: { show: false },
        },
        returnScale
          ? {
              type: "value",
              position: "right",
              min: returnScale.rightMin,
              max: returnScale.rightMax,
              interval: returnScale.rightInterval,
              // A second crosshair on the return axis fights the level axis and the line flickers.
              axisPointer: { show: false },
              axisLabel: {
                fontSize: 10,
                color: "#94a3b8",
                formatter: (v: number) => `${Math.abs(Number(v)) < 0.005 ? "0.00" : Number(v).toFixed(2)}%`,
              },
              splitLine: { show: false },
            }
          : null,
      ].filter(Boolean),
      series: [
        ...ivLineSeries(values, color, returnScale?.prev ?? null, sparse, interval, sessionMarkLine, variant === "pro"),
        ...(gkValues
          ? [{
              name: "区间波动20",
              type: "line" as const,
              yAxisIndex: 0,
              data: gkValues,
              showSymbol: false,
              connectNulls: !hasInternalGap(gkValues, 20),
              lineStyle: { width: 1.4, color: "#2dd4bf" },
              itemStyle: { color: "#2dd4bf" },
              z: 4,
            }]
          : []),
      ],
    }
    return { option, gkScale }
  }, [bars, color, compareGk, gkByTime, interval, lookbackDays, mode, prevClose, variant, viewportMode, visibleWindow])
  const option = chartModel.option
  const gkScale = chartModel.gkScale
  const linkedPointer = driven ? cursorTime ?? null : null

  const emptyText = loading
    ? (ivStrike || ivMonth ? "加载该合约…" : "加载 QVIX 日线…")
    : error
      ? error
      : mode === "unavailable"
        ? (ivStrike ? "该行权价暂无分钟线" : "分钟线中断，日内周期暂不可用")
        : last != null
          ? "暂无该周期数据"
          : "等待 QVIX…"

  return (
    <div className={pro ? "flex h-full min-h-0 flex-col bg-[#131722] text-[#d1d4dc]" : "flex min-h-[320px] flex-col rounded-xl border bg-card"}>
      <div className={pro ? "flex items-start justify-between gap-3 px-3 py-2" : "flex items-start justify-between gap-3 px-4 py-3"}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="text-sm font-semibold">
              {title} 隐含波动率
              <span className="ml-2 font-mono text-xs text-muted-foreground">{iv?.option || product}</span>
            </div>
            <HelpIndexIv product={title} />
            {hideMonthSelect ? null : (
              <select
                value={ivMonth || ""}
                onChange={(e) => setIvMonth(e.target.value || null)}
                className={pro
                  ? "h-6 rounded border border-[#2a2e39] bg-[#1e222d] px-1.5 font-mono text-[11px] text-[#d1d4dc]"
                  : "h-6 rounded border bg-background px-1.5 font-mono text-[11px]"}
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
            )}
            <select
              value={ivStrike || ""}
              onChange={(e) => setIvStrike(e.target.value || null)}
              className={selectClass}
              title={selectedContract?.label || "选择行权价。图为该档认购与认沽隐含波动率的均值"}
            >
              <option value="">平值自动</option>
              {contracts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}{item.atm ? " 平值" : ""}
                </option>
              ))}
            </select>
          </div>
          {hideTimeframe && hideLookback ? null : (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {hideTimeframe ? null : (
                <div className="flex items-center gap-1">
                  {linked ? <Lock className="size-3 shrink-0 text-[#4c84ff]" aria-hidden /> : null}
                  <TimeframeSelect value={interval} onChange={setInterval} dark={pro} />
                </div>
              )}
              {hideLookback ? null : (
                <IvLookbackSelect value={lookbackDays} onChange={setLookbackDays} dark={pro} />
              )}
              {symbol ? (
                <button
                  type="button"
                  title="把区间波动20按本窗口的中位水平对齐到隐含波动率，两条线共用一个坐标"
                  onClick={() => setCompareGk((on) => !on)}
                  className={compareGk
                    ? "h-6 rounded border border-[#2dd4bf] bg-[#2dd4bf]/15 px-1.5 text-[11px] text-[#2dd4bf]"
                    : pro
                      ? "h-6 rounded border border-[#2a2e39] bg-[#1e222d] px-1.5 text-[11px] text-[#adb3bd] hover:text-white"
                      : "h-6 rounded border bg-background px-1.5 text-[11px] text-muted-foreground hover:text-foreground"}
                >
                  {compareGk && gkKline.loading && !reusePrice ? "区间波动…" : "区间波动"}
                </button>
              ) : null}
            </div>
          )}
          <div className={pro
            ? "mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px] text-[#787b86]"
            : "mt-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted-foreground"}>
            <span>
              {ivMonth ? ivMonth : (iv?.name || "QVIX")} · {sourceNote(interval, mode, activeSource, lookbackDays, degradedToDaily, !!ivStrike)}
            </span>
            {sourceText ? <span>数据源 {sourceText}</span> : null}
            {contractText ? (
              <span className={pro ? "font-mono text-[#d1d4dc]" : "font-mono text-foreground"}>{contractText}</span>
            ) : null}
            {compareGk ? (
              <span className="text-[#2dd4bf]">
                {gkScale == null ? "区间波动20 · 样本不足" : `区间波动20 · 对齐×${gkScale.toFixed(2)}`}
              </span>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold tabular-nums ${last == null ? "text-muted-foreground" : up == null ? "" : up ? "text-red-500" : "text-emerald-600"}`}>
            {last == null ? "--" : `${fmt(last)}%`}
          </div>
          <div className={`text-[11px] tabular-nums ${up == null ? "text-muted-foreground" : up ? "text-red-500" : "text-emerald-600"}`}>
            {dayReturn == null ? "--" : `${dayReturn > 0 ? "+" : ""}${fmt(dayReturn)}%`}
          </div>
        </div>
      </div>
      <div className={pro ? "relative min-h-0 flex-1 px-1 pb-1" : "relative px-1 pb-1"} style={pro ? undefined : { height: 240 }}>
        {bars.length > 0 ? (
          <>
            <ReactECharts ref={chartRef} option={option} style={{ position: "absolute", inset: 0, height: "100%", width: "100%" }} notMerge />
            <ChartPointerCapture
              chartRef={chartRef}
              timesRef={plottedTimesRef}
              describeRef={describeRef}
              interval={interval}
              linkedTime={linkedPointer}
            />
          </>
        ) : (
          <div className={pro ? "flex h-full items-center justify-center px-3 text-center text-sm text-[#787b86]" : "flex h-[240px] items-center justify-center px-3 text-center text-sm text-muted-foreground"}>
            {emptyText}
          </div>
        )}
      </div>
    </div>
  )
}
