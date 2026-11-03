"use client"

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import { createPortal } from "react-dom"
import type { Chart, KLineData } from "klinecharts"

import { isBuyMark, snapOrderMarks, type ChartOrderMark } from "@/lib/client/chart-order-marks"
import type { CtpCandle } from "@/lib/client/ctp-market"
import {
  barsOnLastTradeDay,
  countBarsOnTradeDay,
  intradaySessionSlots,
  isIntradayTimeframe,
  klinePeriod,
  type TimeframeId,
} from "@/lib/client/timeframes"
import type { ChartVisibleWindow } from "@/lib/client/qvix-series"
import { formatWindowInput, lockAfterCommit, parseWindowInput, type InputLock } from "@/lib/client/window-input"
import { rollingGarmanKlass, rollingLogVolatility, type OhlcBar } from "@/lib/client/rolling-volatility"
import { CFFEX_SESSION_OPENS, sessionOpenIndices } from "@/lib/client/session-opens"
import { cn } from "@/lib/utils"

const DEFAULT_BAR_SPACE = 6
const ZOOM_IN_SCALE = 1.25
const ZOOM_OUT_SCALE = 0.8
const Y_AXIS_RESERVE_PX = 56
/** Keeps the last candle fully inside the plot, clear of the price-axis border. */
const RIGHT_GAP_PX = 28
const FIXED_WINDOW_BARS = 120
const AUTO_SCALE_MAX_BAR_SPACE = 160
const VIEWPORT_MODE_STORAGE_KEY = "ma.kline.viewportMode"

export type ChartViewportMode = "auto-scale" | "fixed-window"

export const CHART_VIEWPORT_MODES: Array<{ id: ChartViewportMode; label: string; title: string }> = [
  {
    id: "auto-scale",
    label: "跟随K线",
    title: "从当日起始画到最新K线，右侧留一点空隙。新K线出现时右边界跟着走。",
  },
  {
    id: "fixed-window",
    label: "固定窗口",
    title: "日内横轴固定为今日完整交易时段，K线从左向右填满，右侧留给还没走完的时间。日线及以上固定最近120根。",
  },
]

export type { ChartVisibleWindow }

export type KlineChartHandle = {
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setViewportMode: (mode: ChartViewportMode) => void
  getViewportMode: () => ChartViewportMode
  /** Lock the plot to these unix edges. Returns false until the series is on the chart. */
  showWindow: (fromUnix: number, toUnix: number) => boolean
  /** Drop a locked window and use the current viewport mode. */
  clearWindow: () => void
}

function isChartViewportMode(value: unknown): value is ChartViewportMode {
  return value === "auto-scale" || value === "fixed-window"
}

export function readStoredViewportMode(): ChartViewportMode {
  if (typeof window === "undefined") return "auto-scale"
  try {
    const raw = window.localStorage.getItem(VIEWPORT_MODE_STORAGE_KEY)
    if (raw === "follow-right") return "auto-scale"
    if (isChartViewportMode(raw)) return raw
  } catch {
    /* ignore */
  }
  return "auto-scale"
}

function writeStoredViewportMode(mode: ChartViewportMode) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(VIEWPORT_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

function chartContentWidth(host: HTMLElement | null) {
  const width = host?.clientWidth ?? 0
  return Math.max(80, width - Y_AXIS_RESERVE_PX)
}

function plotWidth(chart: Chart, host: HTMLElement | null) {
  const pane = chart.getSize("candle_pane", "main")
  if (pane && pane.width > 80) return pane.width
  return chartContentWidth(host)
}

function clampBarSpace(space: number) {
  return Math.min(AUTO_SCALE_MAX_BAR_SPACE, Math.max(1, space))
}

/**
 * Follow: today's bars stretch from the left edge to the latest candle, with a
 * small right gap so the last body is not cut by the axis.
 * Fixed: the plot width is one full session. Printed candles occupy the left
 * portion and the unfinished session stays empty on the right.
 */
function applyViewportMode(
  chart: Chart | null,
  host: HTMLElement | null,
  mode: ChartViewportMode,
  symbol: string,
  interval: TimeframeId,
) {
  if (!chart) return
  const data = chart.getDataList()
  const count = data?.length ?? 0
  if (count <= 0) return
  const width = plotWidth(chart, host)
  const intraday = isIntradayTimeframe(interval)
  const todayCount = intraday
    ? countBarsOnTradeDay(
        data.map((bar) => ({ time: Math.floor(bar.timestamp / 1000) })),
        symbol,
      )
    : count
  const sessionSlots = intraday ? intradaySessionSlots(symbol, interval) : FIXED_WINDOW_BARS

  let windowBars: number
  let filled: number
  if (mode === "fixed-window") {
    if (intraday) {
      windowBars = Math.max(sessionSlots, todayCount)
      filled = todayCount
    } else {
      windowBars = FIXED_WINDOW_BARS
      filled = Math.min(count, windowBars)
    }
  } else {
    windowBars = intraday ? Math.max(1, todayCount) : count
    filled = windowBars
  }

  const provisional = clampBarSpace(width / Math.max(1, windowBars))
  const gapBars = Math.max(1.35, RIGHT_GAP_PX / provisional)
  const space = clampBarSpace(width / (windowBars + gapBars))
  const offsetPx = (Math.max(0, windowBars - filled) + gapBars) * space

  chart.setLeftMinVisibleBarCount(0)
  chart.setRightMinVisibleBarCount(0)
  chart.setOffsetRightDistance(offsetPx)
  chart.setBarSpace(space)
  chart.scrollToRealTime(0)
}

function dayStartUnix(unix: number) {
  const d = new Date(unix * 1000)
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000)
}

function edgeIndex(data: Array<{ timestamp: number }>, unix: number, edge: "start" | "end", hasTime: boolean) {
  const dayStart = dayStartUnix(unix)
  const target = (hasTime ? unix : edge === "start" ? dayStart : dayStart + 86400 - 1) * 1000
  if (!data.length) return 0
  if (edge === "start") {
    const idx = data.findIndex((bar) => bar.timestamp >= target)
    return idx < 0 ? data.length - 1 : idx
  }
  for (let i = data.length - 1; i >= 0; i -= 1) {
    if (data[i]!.timestamp <= target) return i
  }
  return 0
}

/** Show exactly the locked dates. The bar count changes so neither edge is pushed off. */
function fitInputWindow(chart: Chart, host: HTMLElement | null, lock: InputLock) {
  const data = chart.getDataList()
  if (!data?.length) return null
  let fromIdx = edgeIndex(data, lock.fromUnix, "start", lock.fromHasTime)
  let toIdx = edgeIndex(data, lock.toUnix, "end", lock.toHasTime)
  if (toIdx < fromIdx) toIdx = fromIdx
  const span = Math.max(1, toIdx - fromIdx + 1)
  const space = clampBarSpace(plotWidth(chart, host) / span)
  const range = chart.getVisibleRange()
  const left = data[Math.max(0, range.realFrom)]
  const rightIndex = Math.min(data.length - 1, Math.max(0, range.realTo - 1))
  const leftOk = left != null && Math.floor(left.timestamp / 1000) === Math.floor(data[fromIdx]!.timestamp / 1000)
  const rightOk = rightIndex === toIdx || rightIndex === Math.min(data.length - 1, toIdx + 1)
  const already = Math.abs(chart.getBarSpace().bar - space) < 0.05 && leftOk && rightOk
  if (!already) {
    chart.setLeftMinVisibleBarCount(0)
    chart.setRightMinVisibleBarCount(0)
    if (Math.abs(chart.getBarSpace().bar - space) >= 0.05) chart.setBarSpace(space)
    chart.scrollToDataIndex(toIdx, 0)
  }
  return {
    from: Math.floor(data[fromIdx]!.timestamp / 1000),
    to: Math.floor(data[toIdx]!.timestamp / 1000),
  }
}

function formatBound(unix: number, hasTime: boolean, interval: TimeframeId) {
  if (hasTime) return formatWindowInput(unix, interval)
  const d = new Date(unix * 1000)
  return `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`
}

function zoomKline(chart: Chart | null, direction: "in" | "out") {
  if (!chart) return
  const data = chart.getDataList()
  const last = Math.max(0, (data?.length || 1) - 1)
  chart.zoomAtDataIndex(direction === "in" ? ZOOM_IN_SCALE : ZOOM_OUT_SCALE, last)
}

const ORDER_GROUP = "strategy-orders"
const DRAW_GROUP = "drawings"
const SESSION_GROUP = "session-opens"
const SUB_PANE_ID = "bottom-tech"
let orderOverlayRegistered = false

const SUB_INDICATORS: Array<{ name: string; label: string; title?: string }> = [
  { name: "MACD", label: "MACD" },
  { name: "KDJ", label: "KDJ" },
  { name: "RSI", label: "RSI" },
  { name: "WR", label: "WR 威廉" },
  { name: "CCI", label: "CCI" },
  { name: "BIAS", label: "BIAS 乖离" },
  { name: "ROC", label: "ROC" },
  { name: "MTM", label: "MTM 动量" },
  { name: "DMI", label: "DMI" },
  { name: "OBV", label: "OBV" },
  { name: "TRIX", label: "TRIX" },
  { name: "PSY", label: "PSY 心理线" },
  { name: "HV", label: "波动率20", title: "最近20根K线收盘价对数收益率的标准差，单位 %" },
  { name: "GK", label: "区间波动20", title: "最近20根K线的 Garman-Klass 波动率，用开高低收，单位 %（与波动率20相同，不年化）。同样长度下比收盘价波动率更接近隐含波动率。" },
]

let priceVolReady: Promise<void> | null = null

function ensureRollingVolatility() {
  if (!priceVolReady) {
    priceVolReady = import("klinecharts").then(({ registerIndicator }) => {
      registerRollingVolatility(registerIndicator as (indicator: Record<string, unknown>) => void)
    })
  }
  return priceVolReady
}

const HV_COLOR = "#f5a623"
const GK_COLOR = "#2dd4bf"

function registerRollingVolatility(registerIndicator: (indicator: Record<string, unknown>) => void) {
  registerIndicator({
    name: "HV",
    shortName: "波动率",
    calcParams: [20],
    precision: 3,
    figures: [{ key: "hv", title: "HV20%: ", type: "line" }],
    styles: { lines: [{ color: HV_COLOR }] },
    calc: (dataList: Array<{ close: number }>, indicator: { calcParams?: number[] }) => {
      const period = Number(indicator.calcParams?.[0]) || 20
      return rollingLogVolatility(
        dataList.map((bar) => bar.close),
        period,
      ).map((hv) => (hv == null ? {} : { hv }))
    },
  })
  registerIndicator({
    name: "GK",
    shortName: "区间波动",
    calcParams: [20],
    precision: 3,
    figures: [{ key: "gk", title: "GK20%: ", type: "line" }],
    styles: { lines: [{ color: GK_COLOR }] },
    calc: (dataList: OhlcBar[], indicator: { calcParams?: number[] }) => {
      const period = Number(indicator.calcParams?.[0]) || 20
      return rollingGarmanKlass(dataList, period).map((gk) => (gk == null ? {} : { gk }))
    },
  })
}

function priceVolStyle(name: string) {
  if (name === "HV") return { lines: [{ color: HV_COLOR }] }
  if (name === "GK") return { lines: [{ color: GK_COLOR }] }
  return null
}

function containsClientPoint(el: HTMLElement, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect()
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
}

/** The lowest indicator pane. Volume sits above it, so a right-click there is left alone. */
function bottomIndicatorPane(chart: Chart): { id: string; el: HTMLElement } | null {
  const ids = new Set<string>()
  for (const indicator of chart.getIndicators()) {
    const id = indicator.paneId
    if (!id || id === "candle_pane" || id === "x_axis_pane") continue
    ids.add(id)
  }
  let best: { id: string; el: HTMLElement; top: number } | null = null
  for (const id of ids) {
    const el = chart.getDom(id, "root")
    if (!el) continue
    const top = el.getBoundingClientRect().top
    if (!best || top >= best.top) best = { id, el, top }
  }
  return best ? { id: best.id, el: best.el } : null
}

const TOOLS: Array<{ id: string; overlay?: string; label: string; title?: string }> = [
  { id: "cross", label: "十字" },
  { id: "link-cross", label: "联动", title: "主图十字光标同步到右侧基差率和隐含波动率，指向同一日期" },
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
  if (asset === "NHCI") return 2
  return 0
}

/** Intraday charts stay on the latest session. 5分 changes bar size, not how many days are on screen. */
function plottedCandles(candles: CtpCandle[], symbol: string, interval: TimeframeId) {
  if (!isIntradayTimeframe(interval)) return candles
  return barsOnLastTradeDay(candles, symbol)
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
  viewportMode?: ChartViewportMode
  onViewportModeChange?: (mode: ChartViewportMode) => void
  /** Visible bars on the main chart. The basis and volatility charts follow this range. */
  onVisibleWindow?: (window: ChartVisibleWindow) => void
  /** Unix seconds of the hovered bar while the 联动 tool is on. Null when the pointer leaves. */
  onCursorTime?: (time: number | null) => void
  ref?: Ref<KlineChartHandle | null>
}

function cursorUnixFromCrosshair(chart: Chart, raw: unknown): number | null {
  const rec = raw as { x?: number; timestamp?: number; kLineData?: { timestamp?: number } } | null
  let ms = rec?.kLineData?.timestamp ?? rec?.timestamp
  if ((ms == null || !Number.isFinite(ms)) && rec?.x != null && Number.isFinite(rec.x)) {
    const converted = chart.convertFromPixel([{ x: rec.x }])
    const point = Array.isArray(converted) ? converted[0] : converted
    const list = chart.getDataList()
    const idx = point?.dataIndex
    if (list?.length && idx != null && Number.isFinite(idx)) {
      const clamped = Math.max(0, Math.min(list.length - 1, Math.round(idx)))
      ms = list[clamped]?.timestamp
    } else {
      ms = point?.timestamp
    }
  }
  if (ms == null || !Number.isFinite(ms)) return null
  return ms > 1e11 ? Math.floor(ms / 1000) : Math.floor(ms)
}

function readVisibleWindow(chart: Chart, interval: TimeframeId): ChartVisibleWindow | null {
  const data = chart.getDataList()
  if (!data?.length) return null
  const range = chart.getVisibleRange()
  const last = data.length - 1
  const fromIdx = Math.max(0, Math.min(last, Math.floor(range.realFrom)))
  const toIdx = Math.max(fromIdx, Math.min(last, Math.ceil(range.realTo) - 1))
  const fromTs = data[fromIdx]?.timestamp
  const toTs = data[toIdx]?.timestamp
  if (fromTs == null || toTs == null) return null
  const times: number[] = []
  for (let i = fromIdx; i <= toIdx; i += 1) {
    const ts = data[i]?.timestamp
    if (ts != null) times.push(Math.floor(ts / 1000))
  }
  return {
    from: Math.floor(Math.min(fromTs, toTs) / 1000),
    to: Math.floor(Math.max(fromTs, toTs) / 1000),
    coversAll: fromIdx === 0 && toIdx === last,
    interval,
    times,
  }
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


function applySessionMarks(chart: Chart, candles: CtpCandle[], interval: TimeframeId) {
  chart.removeOverlay({ groupId: SESSION_GROUP })
  if (!isIntradayTimeframe(interval) || candles.length < 2) return
  const times = candles.map((c) => c.time)
  for (const mark of CFFEX_SESSION_OPENS) {
    for (const idx of sessionOpenIndices(times, mark.hhmm)) {
      if (idx < 0 || idx >= candles.length) continue
      const bar = candles[idx]
      const ts = bar.time * 1000
      const mid = (bar.high + bar.low) / 2
      chart.createOverlay({
        name: "verticalStraightLine",
        id: `session-${mark.label}-${bar.time}`,
        groupId: SESSION_GROUP,
        lock: true,
        visible: true,
        zLevel: 0,
        points: [{ timestamp: ts, value: mid }],
        styles: {
          line: { color: "#4a5568", style: "dashed", size: 1 },
        },
      })
    }
  }
}

type AppliedSeries = { first: number; last: number; len: number; fingerprint?: string }

function barFingerprint(bar: CtpCandle) {
  return `${bar.time}:${bar.open}:${bar.high}:${bar.low}:${bar.close}:${bar.volume}`
}

export function KlineProChart({
  symbol,
  interval,
  candles,
  marks,
  compact,
  activeTool = "cross",
  onTool,
  viewportMode: viewportModeProp,
  onViewportModeChange,
  onVisibleWindow,
  onCursorTime,
  ref,
}: Props) {
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
  const defaultBarSpaceRef = useRef(DEFAULT_BAR_SPACE)
  const [viewportModeState, setViewportModeState] = useState<ChartViewportMode>(() => readStoredViewportMode())
  const [subIndicator, setSubIndicator] = useState("MACD")
  const [subMenu, setSubMenu] = useState<{ x: number; y: number } | null>(null)
  const subIndicatorRef = useRef("MACD")
  const viewportMode = viewportModeProp ?? viewportModeState
  const viewportModeRef = useRef(viewportMode)
  const onVisibleWindowRef = useRef(onVisibleWindow)
  const onCursorTimeRef = useRef(onCursorTime)
  const activeToolRef = useRef(activeTool)
  const lastCursorRef = useRef<number | null>(null)
  const publishedWindowRef = useRef<ChartVisibleWindow | null>(null)
  const rangeRafRef = useRef(0)
  const inputLockRef = useRef<InputLock | null>(null)
  const fittingRef = useRef(false)
  // True only while the pointer or wheel is moving the chart. A data reload
  // also fires a range event, and that one must keep the locked window.
  const userAdjustRef = useRef(false)
  const adjustTimerRef = useRef<number | null>(null)
  const [inputMode, setInputMode] = useState(false)
  const shownWindowRef = useRef<ChartVisibleWindow | null>(null)
  const editingRef = useRef<"from" | "to" | null>(null)
  const [fromText, setFromText] = useState("")
  const [toText, setToText] = useState("")
  candlesRef.current = candles
  symbolRef.current = symbol
  intervalRef.current = interval
  marksRef.current = marks
  viewportModeRef.current = viewportMode
  onVisibleWindowRef.current = onVisibleWindow
  onCursorTimeRef.current = onCursorTime
  activeToolRef.current = activeTool

  const syncWindowText = useCallback((window: ChartVisibleWindow) => {
    shownWindowRef.current = window
    if (editingRef.current !== "from") setFromText(formatWindowInput(window.from, window.interval))
    if (editingRef.current !== "to") setToText(formatWindowInput(window.to, window.interval))
  }, [])
  const syncWindowRef = useRef(syncWindowText)
  syncWindowRef.current = syncWindowText

  const publishLockedWindow = useCallback((chart: Chart) => {
    const lock = inputLockRef.current
    if (!lock || fittingRef.current) return false
    fittingRef.current = true
    try {
      const fitted = fitInputWindow(chart, hostRef.current, lock)
      if (!fitted) return false
      const read = readVisibleWindow(chart, intervalRef.current)
      const next: ChartVisibleWindow = {
        from: read?.from ?? fitted.from,
        to: read?.to ?? fitted.to,
        coversAll: false,
        interval: intervalRef.current,
        times: read?.times,
      }
      const prev = publishedWindowRef.current
      publishedWindowRef.current = next
      if (!prev || prev.from !== next.from || prev.to !== next.to || prev.interval !== next.interval) {
        onVisibleWindowRef.current?.(next)
      }
      return true
    } finally {
      fittingRef.current = false
    }
  }, [])
  const publishLockedRef = useRef(publishLockedWindow)
  publishLockedRef.current = publishLockedWindow

  const publishVisibleWindow = useCallback(() => {
    if (rangeRafRef.current) window.clearTimeout(rangeRafRef.current)
    rangeRafRef.current = window.setTimeout(() => {
      rangeRafRef.current = 0
      if (inputLockRef.current) return
      const chart = chartRef.current
      if (!chart) return
      const next = readVisibleWindow(chart, intervalRef.current)
      if (!next) return
      syncWindowRef.current(next)
      const prev = publishedWindowRef.current
      if (
        prev &&
        prev.from === next.from &&
        prev.to === next.to &&
        prev.coversAll === next.coversAll &&
        prev.interval === next.interval
      ) {
        return
      }
      publishedWindowRef.current = next
      onVisibleWindowRef.current?.(next)
    }, 40)
  }, [])

  const armUserAdjust = useCallback((hold: boolean) => {
    userAdjustRef.current = true
    if (adjustTimerRef.current != null) window.clearTimeout(adjustTimerRef.current)
    if (hold) return
    adjustTimerRef.current = window.setTimeout(() => {
      userAdjustRef.current = false
    }, 250)
  }, [])

  const noteUserAdjust = useCallback(() => {
    armUserAdjust(false)
    publishVisibleWindow()
  }, [armUserAdjust, publishVisibleWindow])

  useEffect(() => {
    const release = () => {
      if (userAdjustRef.current) armUserAdjust(false)
    }
    window.addEventListener("pointerup", release)
    return () => window.removeEventListener("pointerup", release)
  }, [armUserAdjust])
  const publishVisibleWindowRef = useRef(publishVisibleWindow)
  publishVisibleWindowRef.current = publishVisibleWindow

  const setViewportMode = useCallback(
    (mode: ChartViewportMode) => {
      writeStoredViewportMode(mode)
      if (viewportModeProp == null) setViewportModeState(mode)
      onViewportModeChange?.(mode)
      viewportModeRef.current = mode
      inputLockRef.current = null
      setInputMode(false)
      applyViewportMode(chartRef.current, hostRef.current, mode, symbolRef.current, intervalRef.current)
    },
    [onViewportModeChange, viewportModeProp],
  )

  const clearWindow = useCallback(() => {
    inputLockRef.current = null
    setInputMode(false)
    const chart = chartRef.current
    applyViewportMode(chart, hostRef.current, viewportModeRef.current, symbolRef.current, intervalRef.current)
    if (!chart) return
    const next = readVisibleWindow(chart, intervalRef.current)
    if (!next) return
    publishedWindowRef.current = next
    onVisibleWindowRef.current?.(next)
    syncWindowText(next)
  }, [syncWindowText])

  const showWindow = useCallback((fromUnix: number, toUnix: number) => {
    inputLockRef.current = {
      fromUnix,
      toUnix,
      fromHasTime: false,
      toHasTime: false,
      fromUser: true,
      toUser: true,
    }
    setInputMode(true)
    setFromText(formatBound(fromUnix, false, intervalRef.current))
    setToText(formatBound(toUnix, false, intervalRef.current))
    const attempt = () => {
      const lock = inputLockRef.current
      const chart = chartRef.current
      if (!lock || lock.fromUnix !== fromUnix || lock.toUnix !== toUnix) return
      if (!chart?.getDataList()?.length) return
      publishLockedWindow(chart)
    }
    attempt()
    requestAnimationFrame(attempt)
    return true
  }, [publishLockedWindow])

  const zoomIn = useCallback(() => {
    armUserAdjust(false)
    zoomKline(chartRef.current, "in")
  }, [armUserAdjust])
  const zoomOut = useCallback(() => {
    armUserAdjust(false)
    zoomKline(chartRef.current, "out")
  }, [armUserAdjust])
  const resetZoom = useCallback(() => {
    inputLockRef.current = null
    setInputMode(false)
    applyViewportMode(
      chartRef.current,
      hostRef.current,
      viewportModeRef.current,
      symbolRef.current,
      intervalRef.current,
    )
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      zoomIn,
      zoomOut,
      resetZoom,
      setViewportMode,
      getViewportMode: () => viewportModeRef.current,
      showWindow,
      clearWindow,
    }),
    [zoomIn, zoomOut, resetZoom, setViewportMode, showWindow, clearWindow],
  )

  useEffect(() => {
    if (viewportModeProp != null) {
      viewportModeRef.current = viewportModeProp
      inputLockRef.current = null
      setInputMode(false)
      applyViewportMode(
        chartRef.current,
        hostRef.current,
        viewportModeProp,
        symbolRef.current,
        intervalRef.current,
      )
      publishVisibleWindowRef.current()
    }
  }, [viewportModeProp])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let disposed = false
    let chart: Chart | null = null
    let ro: ResizeObserver | null = null

    void import("klinecharts").then(({ init, dispose, registerOverlay, registerIndicator }) => {
      if (disposed || !hostRef.current) return
      registerOrderOverlay(registerOverlay as (overlay: Record<string, unknown>) => void)
      registerRollingVolatility(registerIndicator as (indicator: Record<string, unknown>) => void)
      chart = init(hostRef.current, {
        locale: "zh-CN",
        timezone: "UTC",
        styles: DARK_STYLES,
        layout: {
          barSpaceLimit: { min: 1, max: AUTO_SCALE_MAX_BAR_SPACE },
        },
      })
      if (!chart) return
      chartRef.current = chart
      defaultBarSpaceRef.current = chart.getBarSpace()?.bar || DEFAULT_BAR_SPACE
      chart.setPeriod(klinePeriod(intervalRef.current))
      chart.setDataLoader({
        getBars: (params: {
          type?: string
          timestamp?: number | null
          callback: (data: KLineData[], more?: boolean) => void
        }) => {
          const { type, timestamp, callback } = params
          const bars = plottedCandles(candlesRef.current, symbolRef.current, intervalRef.current).map(toBar)
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
      if (!compact) {
        chart.createIndicator({ name: subIndicatorRef.current, paneId: SUB_PANE_ID }, false)
      }
      applyOrderMarks(chart, marksRef.current, plottedCandles(candlesRef.current, symbolRef.current, intervalRef.current), intervalRef.current)
      const onRange = () => {
        const current = chartRef.current
        if (!current || fittingRef.current) return
        const next = readVisibleWindow(current, intervalRef.current)
        if (!next) return
        if (inputLockRef.current && !userAdjustRef.current) {
          publishLockedRef.current(current)
          return
        }
        // A scroll or zoom moves the window. Keep those edges so a later quote
        // refresh does not jump back to the range 当季 first opened.
        if (inputLockRef.current) {
          const intraday = isIntradayTimeframe(intervalRef.current)
          inputLockRef.current = {
            fromUnix: next.from,
            toUnix: next.to,
            fromHasTime: intraday,
            toHasTime: intraday,
            fromUser: true,
            toUser: true,
          }
        }
        syncWindowRef.current(next)
        const prev = publishedWindowRef.current
        if (
          prev &&
          prev.from === next.from &&
          prev.to === next.to &&
          prev.coversAll === next.coversAll &&
          prev.interval === next.interval
        ) {
          return
        }
        publishedWindowRef.current = next
        onVisibleWindowRef.current?.(next)
      }
      const onCrosshair = (raw?: unknown) => {
        if (activeToolRef.current !== "link-cross") return
        const current = chartRef.current
        if (!current) return
        const unix = cursorUnixFromCrosshair(current, raw)
        if (unix == null || lastCursorRef.current === unix) return
        lastCursorRef.current = unix
        onCursorTimeRef.current?.(unix)
      }
      chart.subscribeAction("onVisibleRangeChange", onRange)
      chart.subscribeAction("onCrosshairChange", onCrosshair)
      // After first layout, apply preferred viewport (default auto-scale).
      requestAnimationFrame(() => {
        applyViewportMode(chart, hostRef.current, viewportModeRef.current, symbolRef.current, intervalRef.current)
        publishVisibleWindowRef.current()
      })
      ro = new ResizeObserver(() => {
        chart?.resize()
        if (inputLockRef.current && chart) {
          publishLockedRef.current(chart)
          return
        }
        if (viewportModeRef.current === "auto-scale" || viewportModeRef.current === "fixed-window") {
          applyViewportMode(chart, hostRef.current, viewportModeRef.current, symbolRef.current, intervalRef.current)
        }
      })
      ro.observe(hostRef.current)
    })

    return () => {
      disposed = true
      ro?.disconnect()
      subRef.current = null
      appliedRef.current = null
      if (rangeRafRef.current) window.clearTimeout(rangeRafRef.current)
      if (lastCursorRef.current != null) {
        lastCursorRef.current = null
        onCursorTimeRef.current?.(null)
      }
      if (chart) {
        chart.unsubscribeAction("onVisibleRangeChange")
        chart.unsubscribeAction("onCrosshairChange")
        void import("klinecharts").then(({ dispose }) => dispose(chart!))
      }
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (activeTool === "link-cross") return
    if (lastCursorRef.current == null) return
    lastCursorRef.current = null
    onCursorTimeRef.current?.(null)
  }, [activeTool])

  useEffect(() => {
    if (!subMenu) return
    const close = () => setSubMenu(null)
    let armed = false
    const arm = window.setTimeout(() => {
      armed = true
    }, 0)
    const onPointer = (event: PointerEvent) => {
      if (!armed || event.button === 2) return
      const target = event.target
      if (target instanceof Element && target.closest("[data-sub-indicator-menu]")) return
      close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("pointerdown", onPointer)
    window.addEventListener("keydown", onKey)
    window.addEventListener("scroll", close, true)
    return () => {
      window.clearTimeout(arm)
      window.removeEventListener("pointerdown", onPointer)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", close, true)
    }
  }, [subMenu])

  const openSubMenu = useCallback((event: { clientX: number; clientY: number; preventDefault: () => void }) => {
    if (compact) return
    const chart = chartRef.current
    const pane = chart ? bottomIndicatorPane(chart) : null
    if (!chart || !pane || !containsClientPoint(pane.el, event.clientX, event.clientY)) {
      setSubMenu(null)
      return
    }
    event.preventDefault()
    const shown = chart.getIndicators({ paneId: pane.id })[0]?.name
    if (shown) {
      subIndicatorRef.current = shown
      setSubIndicator(shown)
    }
    const width = 168
    const height = Math.min(window.innerHeight * 0.7, 28 + SUB_INDICATORS.length * 28)
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))
    const y = event.clientY + height > window.innerHeight - 8 ? Math.max(8, event.clientY - height) : event.clientY
    setSubMenu({ x, y })
  }, [compact])

  const openSubMenuRef = useRef(openSubMenu)
  openSubMenuRef.current = openSubMenu

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const onRightPointer = (event: Event) => {
      if (!(event instanceof MouseEvent) || event.button !== 2) return
      openSubMenuRef.current(event)
    }
    el.addEventListener("pointerdown", onRightPointer, true)
    el.addEventListener("mousedown", onRightPointer, true)
    return () => {
      el.removeEventListener("pointerdown", onRightPointer, true)
      el.removeEventListener("mousedown", onRightPointer, true)
    }
  }, [])

  const applySubIndicator = useCallback((name: string) => {
    setSubMenu(null)
    const chart = chartRef.current
    if (!chart) return
    const paneId = bottomIndicatorPane(chart)?.id ?? SUB_PANE_ID
    if (chart.getIndicators({ paneId }).some((indicator) => indicator.name === name)) return
    const place = () => {
      const current = chartRef.current
      if (!current) return
      const styles = priceVolStyle(name)
      const created = current.createIndicator(styles ? { name, paneId, styles } : { name, paneId }, false)
      if (!created) return
      subIndicatorRef.current = name
      setSubIndicator(name)
    }
    if (name === "HV" || name === "GK") {
      void ensureRollingVolatility().then(place)
      return
    }
    place()
  }, [])

  const commitWindow = useCallback((edge: "start" | "end", text: string) => {
    const chart = chartRef.current
    const parsed = parseWindowInput(text)
    const data = chart?.getDataList()
    if (!chart || !parsed || !data?.length) return
    const prev = inputLockRef.current
    const shown = shownWindowRef.current
    const lastUnix = Math.floor(data[data.length - 1]!.timestamp / 1000)
    const lock = lockAfterCommit(edge, parsed, prev, shown?.from ?? null, lastUnix)
    inputLockRef.current = lock
    setInputMode(true)
    publishLockedWindow(chart)
    editingRef.current = null
    setFromText(formatBound(lock.fromUnix, lock.fromHasTime, intervalRef.current))
    setToText(formatBound(lock.toUnix, lock.toHasTime, intervalRef.current))
  }, [publishLockedWindow])

  const useFollowMode = clearWindow

  const useInputMode = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    if (!inputLockRef.current) {
      const shown = shownWindowRef.current ?? readVisibleWindow(chart, intervalRef.current)
      if (!shown) return
      const intraday = isIntradayTimeframe(intervalRef.current)
      inputLockRef.current = {
        fromUnix: shown.from,
        toUnix: shown.to,
        fromHasTime: intraday,
        toHasTime: intraday,
        fromUser: false,
        toUser: false,
      }
    }
    setInputMode(true)
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    let changed = false
    if (appliedIntervalRef.current !== interval) {
      // A new period is a manual change, so the previous date lock does not carry over.
      publishedWindowRef.current = null
      inputLockRef.current = null
      setInputMode(false)
      chart.setPeriod(klinePeriod(interval))
      appliedIntervalRef.current = interval
      changed = true
    }
    if (appliedSymbolRef.current !== symbol) {
      // Keep the date lock. Switching IH/IF/IC/IM should stay on the same 当季 window.
      publishedWindowRef.current = null
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
    const lenGrew = !!prev && candles.length > prev.len
    appliedRef.current = { first, last: last.time, len: candles.length, fingerprint }
    if (needInit || historyExtended || seriesReplaced) {
      chart.resetData()
      const plotted = plottedCandles(candles, symbol, interval)
      applyOrderMarks(chart, marksRef.current, plotted, interval)
      applySessionMarks(chart, plotted, interval)
      const fit = () => {
        if (inputLockRef.current) {
          publishLockedRef.current(chart)
          return
        }
        applyViewportMode(chart, hostRef.current, viewportModeRef.current, symbolRef.current, intervalRef.current)
        publishVisibleWindowRef.current()
      }
      fit()
      requestAnimationFrame(fit)
      // The chart applies its own default range after resetData. Fit again once that settles.
      if (inputLockRef.current) {
        window.setTimeout(fit, 60)
        window.setTimeout(fit, 280)
      }
      return
    }
    if (prev?.fingerprint === fingerprint) return
    if (subRef.current) subRef.current(toBar(last))
    // Follow refits on every tick so the right gap stays put as the last candle moves.
    // Fixed window only refits when a new bar prints, so earlier candles keep their width
    // and the unfinished session stays empty on the right.
    if (inputLockRef.current) {
      publishLockedRef.current(chart)
    } else if (viewportModeRef.current === "auto-scale" || (viewportModeRef.current === "fixed-window" && lenGrew)) {
      applyViewportMode(chart, hostRef.current, viewportModeRef.current, symbolRef.current, intervalRef.current)
      publishVisibleWindowRef.current()
    }
  }, [candles, symbol, interval])

  const marksKey = (marks || []).map((mark) => mark.id).join("|")
  const seriesKey = `${symbol}:${interval}:${candles[0]?.time ?? 0}:${candles.at(-1)?.time ?? 0}`

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const plotted = plottedCandles(candlesRef.current, symbolRef.current, intervalRef.current)
    applyOrderMarks(chart, marksRef.current, plotted, intervalRef.current)
    applySessionMarks(chart, plotted, intervalRef.current)
  }, [marksKey, seriesKey])

  const modeSelect = (
    <label className="flex flex-col gap-0.5 px-0.5 py-1" title="图表视窗设置">
      <span className="text-center text-[9px] leading-none text-[#787b86]">视窗</span>
      <select
        value={viewportMode}
        onChange={(e) => {
          const next = e.target.value
          if (isChartViewportMode(next)) setViewportMode(next)
        }}
        className="w-full cursor-pointer rounded border border-[#2a2e39] bg-[#131722] px-0.5 py-1 text-[10px] text-[#adb3bd] outline-none hover:border-[#4c84ff] hover:text-white"
        aria-label="图表视窗设置"
      >
        {CHART_VIEWPORT_MODES.map((mode) => (
          <option key={mode.id} value={mode.id} title={mode.title}>
            {mode.label}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="flex h-full min-h-0">
      {compact ? null : (
        <div className="flex min-h-0 w-14 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[#2a2e39] bg-[#1e222d] py-1">
          {modeSelect}
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              title={tool.title ?? tool.label}
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
            title="放大"
            onClick={zoomIn}
            className="px-0.5 py-1.5 text-[10px] leading-tight text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
          >
            放大
          </button>
          <button
            type="button"
            title="缩小"
            onClick={zoomOut}
            className="px-0.5 py-1.5 text-[10px] leading-tight text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
          >
            缩小
          </button>
          <button
            type="button"
            title="复位"
            onClick={resetZoom}
            className="px-0.5 py-1.5 text-[10px] leading-tight text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
          >
            复位
          </button>
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
      <div className="relative min-h-0 min-w-0 flex-1">
        <div
          ref={hostRef}
          className="h-full min-h-0 min-w-0"
          onWheel={noteUserAdjust}
          onPointerDown={(event) => {
            armUserAdjust(true)
            if (event.button === 2) openSubMenu(event)
          }}
          onPointerUp={() => armUserAdjust(false)}
          onContextMenu={(event) => {
            event.preventDefault()
            openSubMenu(event)
          }}
          onMouseLeave={() => {
            if (activeToolRef.current !== "link-cross") return
            if (lastCursorRef.current == null) return
            lastCursorRef.current = null
            onCursorTimeRef.current?.(null)
          }}
        />
        {compact ? null : (
          <div
            className="absolute right-[4.75rem] top-1 z-20 flex items-center gap-1"
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <span className="flex items-center text-[10px] leading-none text-[#3e4451]">
              <button
                type="button"
                title="跟随K线滚动和周期"
                onClick={useFollowMode}
                className={cn("hover:text-[#8b919c]", inputMode ? "text-[#3e4451]" : "text-[#6b7280]")}
              >
                跟随
              </button>
              <span className="px-0.5">/</span>
              <button
                type="button"
                title="用输入的开始和结束日期固定窗口，互不影响"
                onClick={useInputMode}
                className={cn("hover:text-[#8b919c]", inputMode ? "text-[#6b7280]" : "text-[#3e4451]")}
              >
                输入
              </button>
            </span>
            <input
              value={fromText}
              aria-label="窗口开始"
              title="开始日期。点一下清空，输入 2024.9.24 后回车。结束停在最新一天；如果已经输入过结束日期，结束保持不变"
              placeholder="2026.10.16"
              onChange={(event) => setFromText(event.target.value)}
              onMouseDown={(event) => {
                if (event.button !== 0 || editingRef.current === "from") return
                editingRef.current = "from"
                setFromText("")
              }}
              onBlur={() => {
                if (editingRef.current === "from") editingRef.current = null
                const lock = inputLockRef.current
                if (lock) {
                  setFromText(formatBound(lock.fromUnix, lock.fromHasTime, intervalRef.current))
                  return
                }
                const shown = shownWindowRef.current
                if (shown) setFromText(formatWindowInput(shown.from, shown.interval))
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.blur()
                  return
                }
                if (event.key !== "Enter") return
                event.preventDefault()
                commitWindow("start", fromText)
                event.currentTarget.blur()
              }}
              className="h-6 w-[9.25rem] rounded border border-[#2a2e39] bg-[#131722]/95 px-1.5 font-mono text-[11px] text-[#d1d4dc] outline-none placeholder:text-[#787b86] focus:border-[#4c84ff]"
            />
            <span className="text-[10px] text-[#787b86]">–</span>
            <input
              value={toText}
              aria-label="窗口结束"
              title="结束日期。点一下清空，输入后回车。开始日期保持你输入的那一天"
              placeholder="2026.10.16"
              onChange={(event) => setToText(event.target.value)}
              onMouseDown={(event) => {
                if (event.button !== 0 || editingRef.current === "to") return
                editingRef.current = "to"
                setToText("")
              }}
              onBlur={() => {
                if (editingRef.current === "to") editingRef.current = null
                const lock = inputLockRef.current
                if (lock) {
                  setToText(formatBound(lock.toUnix, lock.toHasTime, intervalRef.current))
                  return
                }
                const shown = shownWindowRef.current
                if (shown) setToText(formatWindowInput(shown.to, shown.interval))
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.blur()
                  return
                }
                if (event.key !== "Enter") return
                event.preventDefault()
                commitWindow("end", toText)
                event.currentTarget.blur()
              }}
              className="h-6 w-[9.25rem] rounded border border-[#2a2e39] bg-[#131722]/95 px-1.5 font-mono text-[11px] text-[#d1d4dc] outline-none placeholder:text-[#787b86] focus:border-[#4c84ff]"
            />
          </div>
        )}
        {compact ? (
          <div className="absolute right-1 top-1 z-10 flex overflow-hidden rounded border border-[#2a2e39] bg-[#1e222d]/90">
            <button
              type="button"
              title="放大"
              onClick={(e) => {
                e.stopPropagation()
                zoomIn()
              }}
              className="px-1.5 py-0.5 text-[10px] text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
            >
              +
            </button>
            <button
              type="button"
              title="缩小"
              onClick={(e) => {
                e.stopPropagation()
                zoomOut()
              }}
              className="border-l border-[#2a2e39] px-1.5 py-0.5 text-[10px] text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
            >
              −
            </button>
          </div>
        ) : null}
      </div>
      {subMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              data-sub-indicator-menu
              className="fixed z-[80] w-[168px] overflow-y-auto rounded border border-[#2a2e39] bg-[#1e222d] py-1 shadow-lg"
              style={{ left: subMenu.x, top: subMenu.y, maxHeight: "70vh" }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="px-3 py-1 text-[10px] text-[#787b86]">切换指标</div>
              {SUB_INDICATORS.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  title={item.title ?? item.label}
                  onClick={() => applySubIndicator(item.name)}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-xs text-[#d1d4dc] hover:bg-[#2a2e39]",
                    subIndicator === item.name && "text-[#4c84ff]",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
