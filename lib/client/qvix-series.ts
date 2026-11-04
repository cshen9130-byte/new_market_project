import { isDailyOverlayBars, type IvSnapshot, type OverlayPoint } from "@/lib/client/realtime-overlay"
import { aggregateCloseSeries, bucketTime, getTimeframe, isIntradayTimeframe, shanghaiWallUnix, type TimeframeId } from "@/lib/client/timeframes"

export type QvixSeriesMode = "intraday" | "history" | "unavailable"

export function qvixBarsForTimeframe(
  interval: TimeframeId,
  iv: Pick<IvSnapshot, "bars" | "source" | "value"> | undefined,
  daily: OverlayPoint[],
): { bars: OverlayPoint[]; mode: QvixSeriesMode } {
  if (isIntradayTimeframe(interval)) {
    if (!iv?.bars.length || isDailyOverlayBars(iv.bars, iv.source)) {
      return { bars: [], mode: "unavailable" }
    }
    return { bars: aggregateCloseSeries(iv.bars, interval), mode: "intraday" }
  }
  const history = stampLiveDaily(daily, iv)
  if (history.length) return { bars: aggregateCloseSeries(history, interval), mode: "history" }
  if (iv && isDailyOverlayBars(iv.bars, iv.source) && iv.bars.length) {
    return { bars: aggregateCloseSeries(iv.bars, interval), mode: "history" }
  }
  return { bars: [], mode: "history" }
}

function stampLiveDaily(
  daily: OverlayPoint[],
  iv: Pick<IvSnapshot, "bars" | "source" | "value"> | undefined,
) {
  const value = iv?.value
  const liveTime = iv?.bars.at(-1)?.time
  if (value == null || !(value > 0) || liveTime == null) return daily
  if (!iv || isDailyOverlayBars(iv.bars, iv.source)) return daily
  const day = bucketTime(liveTime, "1d")
  const next = daily.slice()
  const idx = next.findIndex((bar) => bucketTime(bar.time, "1d") === day)
  if (idx >= 0) {
    next[idx] = { time: next[idx].time, close: value }
    return next
  }
  next.push({ time: liveTime, close: value })
  next.sort((a, b) => a.time - b.time)
  return next
}

/** Keep the last N Shanghai calendar trading days present in the series (by distinct day keys). */
export function sliceOverlayByLookbackDays(bars: OverlayPoint[], days: number): OverlayPoint[] {
  if (!bars.length || !(days > 0)) return bars
  if (days <= 1) {
    const last = bars[bars.length - 1]
    const day = shanghaiDayKey(last.time)
    return bars.filter((bar) => shanghaiDayKey(bar.time) === day)
  }
  const dayKeys: string[] = []
  const seen = new Set<string>()
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const key = shanghaiDayKey(bars[i].time)
    if (seen.has(key)) continue
    seen.add(key)
    dayKeys.push(key)
    if (dayKeys.length >= days) break
  }
  const keep = new Set(dayKeys)
  return bars.filter((bar) => keep.has(shanghaiDayKey(bar.time)))
}

function shanghaiDayKey(unix: number) {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function previousTradingDay(day: string) {
  const [year, month, date] = day.split("-").map(Number)
  let cursor = Date.UTC(year, month - 1, date)
  do {
    cursor -= 86400_000
  } while (new Date(cursor).getUTCDay() === 0 || new Date(cursor).getUTCDay() === 6)
  const next = new Date(cursor)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

function lookbackSessions(endDay: string, days: number) {
  const sessions = [endDay]
  let cursor = endDay
  while (sessions.length < days) {
    cursor = previousTradingDay(cursor)
    sessions.unshift(cursor)
  }
  return sessions
}

function sessionClock() {
  const minutes: string[] = []
  const push = (start: number, end: number) => {
    for (let minute = start; minute <= end; minute += 1) {
      const hh = String(Math.floor(minute / 60)).padStart(2, "0")
      const mm = String(minute % 60).padStart(2, "0")
      minutes.push(`${hh}:${mm}`)
    }
  }
  push(9 * 60 + 30, 11 * 60 + 30)
  push(13 * 60, 15 * 60)
  return minutes
}

const SESSION_CLOCK = sessionClock()

function wallUnix(day: string, hhmm: string) {
  const [year, month, date] = day.split("-").map(Number)
  const [hour, minute] = hhmm.split(":").map(Number)
  return Math.floor(Date.UTC(year, month - 1, date, hour, minute, 0) / 1000)
}

/** Stay on the session the bars actually cover. A clock on the next morning must not draw an empty grid. */
function axisEnd(bars: Array<{ time: number }>, endAt?: number) {
  const last = bars[bars.length - 1]!.time
  if (endAt == null) return last
  const endDay = shanghaiDayKey(endAt)
  if (endDay === shanghaiDayKey(last)) return endAt
  return bars.some((bar) => shanghaiDayKey(bar.time) === endDay) ? endAt : last
}

/**
 * Shanghai session minute the 1-minute charts should share.
 * Every chart ends on this clock, so 13:00 lands on the same slot.
 * Undefined before the open and on weekends, when there is no shared session.
 */
export function intradayAxisEnd(now = new Date()): number | undefined {
  const raw = shanghaiWallUnix(now)
  const clock = new Date(raw * 1000)
  if (clock.getUTCDay() === 0 || clock.getUTCDay() === 6) return undefined
  const minutes = clock.getUTCHours() * 60 + clock.getUTCMinutes()
  if (minutes < 9 * 60 + 30) return undefined
  const clamped =
    minutes > 15 * 60 ? 15 * 60 : minutes > 11 * 60 + 30 && minutes < 13 * 60 ? 11 * 60 + 30 : minutes
  if (clamped === minutes) return raw
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0")
  const mm = String(clamped % 60).padStart(2, "0")
  return wallUnix(shanghaiDayKey(raw), `${hh}:${mm}`)
}

/** 15:00 of the current Shanghai weekday. The fixed-window charts share this end. */
export function sessionCloseAxisEnd(now = new Date()): number | undefined {
  const raw = shanghaiWallUnix(now)
  const clock = new Date(raw * 1000)
  if (clock.getUTCDay() === 0 || clock.getUTCDay() === 6) return undefined
  return wallUnix(shanghaiDayKey(raw), "15:00")
}

/** Follow ends at the current session minute. Fixed window ends at the close. */
export function quoteAxisEnd(mode?: "auto-scale" | "fixed-window" | null, now = new Date()) {
  if (mode === "fixed-window") return sessionCloseAxisEnd(now) ?? intradayAxisEnd(now)
  return intradayAxisEnd(now)
}

/**
 * Keep a 1-minute axis across the whole lookback. Minutes we have not stored
 * stay empty instead of being replaced by a daily close.
 * `endAt` extends the last session to a shared clock so session lines match.
 */
export function padIntradayLookback(
  bars: OverlayPoint[],
  days: number,
  endAt?: number,
): Array<{ time: number; close: number | null }> {
  if (days < 1 || bars.length < 1) return bars
  const end = axisEnd(bars, endAt)
  const sessions = lookbackSessions(shanghaiDayKey(end), days)
  const byTime = new Map(bars.map((bar) => [bar.time, bar.close]))
  const out: Array<{ time: number; close: number | null }> = []
  for (const day of sessions) {
    let stop = false
    for (const hhmm of SESSION_CLOCK) {
      const time = wallUnix(day, hhmm)
      if (time > end) {
        stop = true
        break
      }
      out.push({ time, close: byTime.get(time) ?? null })
    }
    if (stop) break
  }
  return out.length ? out : bars
}

/** Session bucket starts, in seconds from Shanghai midnight. 09:30 stays on the grid for 5/15/30. */
function sessionBucketOffsets(step: number) {
  const ranges: Array<[number, number]> = [
    [9 * 3600 + 30 * 60, 11 * 3600 + 30 * 60],
    [13 * 3600, 15 * 3600],
  ]
  const offsets: number[] = []
  for (const [start, end] of ranges) {
    let t = Math.floor(start / step) * step
    if (t + step <= start) t += step
    for (; t <= end; t += step) offsets.push(t)
  }
  return offsets
}

function offsetHhmm(offset: number) {
  const hh = String(Math.floor(offset / 3600)).padStart(2, "0")
  const mm = String(Math.floor((offset % 3600) / 60)).padStart(2, "0")
  return `${hh}:${mm}`
}

/**
 * Same clock window as the 1-minute session axis, aggregated to `interval`.
 * A 5-minute chart of 固定窗口 still runs 09:30–15:00; 跟随 ends at the current bucket.
 */
export function padIntradaySeries(
  bars: OverlayPoint[],
  interval: TimeframeId,
  days: number,
  endAt?: number,
): Array<{ time: number; close: number | null }> {
  const step = getTimeframe(interval).seconds
  if (!isIntradayTimeframe(interval) || step <= 60) return padIntradayLookback(bars, days, endAt)
  if (days < 1 || bars.length < 1) return bars
  const end = axisEnd(bars, endAt)
  const sessions = lookbackSessions(shanghaiDayKey(end), days)
  const byTime = new Map<number, number>()
  for (const bar of bars) {
    if (bar.close == null || !Number.isFinite(bar.close)) continue
    byTime.set(bucketTime(bar.time, interval), bar.close)
  }
  const out: Array<{ time: number; close: number | null }> = []
  for (const day of sessions) {
    let stop = false
    for (const offset of sessionBucketOffsets(step)) {
      const time = wallUnix(day, offsetHhmm(offset))
      if (time > end) {
        stop = true
        break
      }
      out.push({ time, close: byTime.get(time) ?? null })
    }
    if (stop) break
  }
  return out.length ? out : bars
}

/** Same count the daily/weekly/monthly fixed window keeps on screen. */
export const DAILY_FIXED_BARS = 120

/** The time span the main chart shows before the user scrolls it. */
export function chartWindowForSeries(
  bars: Array<{ time: number }>,
  interval: TimeframeId,
  mode?: "auto-scale" | "fixed-window" | null,
): ChartVisibleWindow | null {
  if (!bars.length) return null
  const fixed = mode === "fixed-window" && !isIntradayTimeframe(interval)
  const fromIdx = fixed ? Math.max(0, bars.length - DAILY_FIXED_BARS) : 0
  const slice = bars.slice(fromIdx)
  return {
    from: slice[0]!.time,
    to: slice[slice.length - 1]!.time,
    coversAll: fromIdx === 0,
    interval,
    times: slice.map((bar) => bar.time),
  }
}

export type ChartVisibleWindow = {
  from: number
  to: number
  /** Every loaded main-chart bar is on screen. */
  coversAll: boolean
  interval: TimeframeId
  /** Main-chart bars on screen. Side charts use this grid so one date stays at one x. */
  times?: number[]
}

/**
 * Keep the points that sit inside the main chart's visible time range.
 * Daily and higher bars match by their bucket, so a midnight candle and a 15:00 close share a day.
 * `extendTo` keeps a fixed intraday window open through the close when the whole session is on screen.
 */
export function sliceSeriesToWindow<T extends { time: number }>(
  points: T[],
  window: ChartVisibleWindow | null | undefined,
  interval: TimeframeId,
  extendTo?: number,
): T[] {
  if (!window || window.interval !== interval || !points.length) return points
  let from = Math.min(window.from, window.to)
  let to = Math.max(window.from, window.to)
  if (extendTo != null) to = Math.max(to, extendTo)
  if (!isIntradayTimeframe(interval)) {
    from = bucketTime(from, interval)
    to = bucketTime(to, interval)
    return points.filter((point) => {
      const bucket = bucketTime(point.time, interval)
      return bucket >= from && bucket <= to
    })
  }
  return points.filter((point) => point.time >= from && point.time <= to)
}

/**
 * Draw `points` on the main chart's visible bars.
 * A shorter series keeps the same dates at the same x instead of stretching to fill the panel.
 * The fixed intraday tail (through the close) stays on its own clock when it runs past the last bar.
 */
export function plotOnVisibleWindow<T extends { time: number; close: number | null }>(
  points: T[],
  window: ChartVisibleWindow | null | undefined,
  interval: TimeframeId,
  extendTo?: number,
): T[] {
  const sliced = sliceSeriesToWindow(points, window, interval, extendTo)
  const times = window?.times
  if (!times?.length || !window || window.interval !== interval) return sliced
  if (extendTo != null && extendTo > Math.max(window.from, window.to)) return sliced
  const byTime = new Map<number, T>()
  for (const point of sliced) {
    if (point.close == null || !Number.isFinite(point.close)) continue
    byTime.set(bucketTime(point.time, interval), point)
  }
  const plotted = times.map((time) => {
    const hit = byTime.get(bucketTime(time, interval))
    if (hit) return { ...hit, time }
    return { time, close: null } as T
  })
  if (plotted.every((point) => point.close == null) && sliced.some((point) => point.close != null)) return sliced
  return plotted
}

/** Plot insets shared by the stacked basis and implied-volatility charts. */
export const STACKED_QUOTE_PLOT = { left: 52, right: 58 } as const

function previousSessionMark(bars: Array<{ time: number; close: number | null }>): { close: number; day: string } | null {
  let latestDay: string | null = null
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const close = bars[i]!.close
    if (close == null || !Number.isFinite(close)) continue
    const day = shanghaiDayKey(bars[i]!.time)
    if (latestDay == null) {
      latestDay = day
      continue
    }
    if (day !== latestDay) return { close, day }
  }
  return null
}

/** Last close of the session before the latest one. Null when the series is a single session. */
export function previousSessionClose(bars: Array<{ time: number; close: number | null }>): number | null {
  return previousSessionMark(bars)?.close ?? null
}

/**
 * Baseline for the intraday return. A prior day inside the plotted bars counts only when
 * it is the previous trading day. An older day that leaked into the series is ignored.
 */
export function returnBaseline(
  bars: Array<{ time: number; close: number | null }>,
  fallback: number | null,
): number | null {
  const prior = previousSessionMark(bars)
  if (!prior) return fallback
  let latest: string | null = null
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const close = bars[i]!.close
    if (close == null || !Number.isFinite(close)) continue
    latest = shanghaiDayKey(bars[i]!.time)
    break
  }
  if (latest && prior.day === previousTradingDay(latest)) return prior.close
  return fallback
}

export type IvReturnScale = {
  prev: number
  leftMin: number
  leftMax: number
  leftInterval: number
  rightMin: number
  rightMax: number
  rightInterval: number
}

function nicePctStep(span: number) {
  const raw = Math.max(span, 0.5) / 6
  const pow = 10 ** Math.floor(Math.log10(raw))
  const err = raw / pow
  const step = err <= 1 ? 1 : err <= 2 ? 2 : err <= 2.5 ? 2.5 : err <= 5 ? 5 : 10
  return step * pow
}

/**
 * Right-axis percent change from the previous close, aligned with the left IV scale.
 * Zero is the midpoint, including when the whole session sits on one side of yesterday.
 */
export function ivReturnScale(lo: number, hi: number, prev: number): IvReturnScale | null {
  if (!(prev > 0) || !Number.isFinite(lo) || !Number.isFinite(hi)) return null
  const pad = Math.max((hi - lo) * 0.08, prev * 0.004)
  const pLo = ((Math.min(lo, hi) - pad - prev) / prev) * 100
  const pHi = ((Math.max(lo, hi) + pad - prev) / prev) * 100
  const reach = Math.max(Math.abs(pLo), Math.abs(pHi), 0.5)
  const step = nicePctStep(reach * 2)
  const snapped = Math.ceil(reach / step) * step
  const rightMin = -snapped
  const rightMax = snapped
  return {
    prev,
    leftMin: prev * (1 + rightMin / 100),
    leftMax: prev * (1 + rightMax / 100),
    leftInterval: prev * (step / 100),
    rightMin,
    rightMax,
    rightInterval: step,
  }
}

/** Drop a one-minute hole between two prints so the session line does not split the area. Longer gaps stay empty. */
export function omitIsolatedNulls<T extends { close: number | null }>(plot: T[]): T[] {
  if (plot.length < 3) return plot
  const drop = new Set<number>()
  for (let i = 0; i < plot.length; i += 1) {
    if (plot[i]!.close != null) continue
    const prev = i > 0 ? plot[i - 1]!.close : null
    const next = i + 1 < plot.length ? plot[i + 1]!.close : null
    if (prev != null && next != null) drop.add(i)
  }
  if (!drop.size) return plot
  return plot.filter((_, index) => !drop.has(index))
}
