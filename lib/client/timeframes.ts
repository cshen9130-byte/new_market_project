import type { CtpCandle } from "@/lib/client/ctp-market"
import {
  futuresTradeDateYmd,
  hasNightSession,
  isCffexProduct,
  isLiveSessionFor,
  isNightHqPrint,
  isNightWallClock,
} from "@/lib/client/market-hours"

export const TIMEFRAMES = [
  { id: "1m", label: "1分", seconds: 60 },
  { id: "5m", label: "5分", seconds: 300 },
  { id: "15m", label: "15分", seconds: 900 },
  { id: "30m", label: "30分", seconds: 1800 },
  { id: "1h", label: "1时", seconds: 3600 },
  { id: "4h", label: "4时", seconds: 14400 },
  { id: "1d", label: "日线", seconds: 86400 },
  { id: "1w", label: "周线", seconds: 604800 },
  { id: "1M", label: "月线", seconds: 0 },
] as const

export type TimeframeId = (typeof TIMEFRAMES)[number]["id"]

export function getTimeframe(id: TimeframeId) {
  return TIMEFRAMES.find((item) => item.id === id) || TIMEFRAMES[0]
}

export function isTimeframeId(value: string): value is TimeframeId {
  return TIMEFRAMES.some((item) => item.id === value)
}

export function bucketTime(unix: number, id: TimeframeId) {
  const d = new Date(unix * 1000)
  if (id === "1d") return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000)
  if (id === "1w") {
    const offset = (d.getUTCDay() + 6) % 7
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset) / 1000)
  }
  if (id === "1M") return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000)
  const seconds = getTimeframe(id).seconds
  return Math.floor(unix / seconds) * seconds
}

export function aggregateCandles(src: CtpCandle[], id: TimeframeId): CtpCandle[] {
  if (id === "1m" || !src.length) return src
  const out: CtpCandle[] = []
  let current: CtpCandle | null = null
  let bucket = Number.NaN
  for (const bar of src) {
    const nextBucket = bucketTime(bar.time, id)
    if (current && nextBucket === bucket) {
      current.high = Math.max(current.high, bar.high)
      current.low = Math.min(current.low, bar.low)
      current.close = bar.close
      current.volume += bar.volume
    } else {
      if (current) out.push(current)
      bucket = nextBucket
      current = {
        time: nextBucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      }
    }
  }
  if (current) out.push(current)
  return out
}

export function aggregateCloseSeries(
  src: { time: number; close: number }[],
  id: TimeframeId,
): { time: number; close: number }[] {
  if (id === "1m" || !src.length) return src
  const out: { time: number; close: number }[] = []
  let current: { time: number; close: number } | null = null
  let bucket = Number.NaN
  for (const bar of src) {
    const nextBucket = bucketTime(bar.time, id)
    if (current && nextBucket === bucket) {
      current = { time: nextBucket, close: bar.close }
    } else {
      if (current) out.push(current)
      bucket = nextBucket
      current = { time: nextBucket, close: bar.close }
    }
  }
  if (current) out.push(current)
  return out
}

export function shanghaiWallUnix(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  return Math.floor(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      0,
    ) / 1000,
  )
}

export function mergeHistoryAndLive(history: CtpCandle[], live1m: CtpCandle[], id: TimeframeId) {
  const live = aggregateCandles(live1m, id)
  const higherTf = id === "1d" || id === "1w" || id === "1M"
  if (!history.length) return higherTf ? [] : live
  if (!live.length) return history
  const map = new Map<number, CtpCandle>()
  for (const bar of history) map.set(bar.time, bar)
  for (const bar of live) {
    const prev = map.get(bar.time)
    if (!prev) {
      // Incomplete CTP 1m history must not invent a daily/weekly/monthly bar.
      if (!higherTf) map.set(bar.time, bar)
      continue
    }
    map.set(bar.time, {
      time: prev.time,
      open: prev.open,
      high: Math.max(prev.high, bar.high),
      low: Math.min(prev.low, bar.low),
      close: bar.close,
      volume: Math.max(prev.volume, bar.volume),
    })
  }
  return [...map.values()].sort((a, b) => a.time - b.time)
}

function tradeDateUnix(ymd: string | null | undefined) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const [year, month, date] = ymd.split("-").map(Number)
  return Math.floor(Date.UTC(year, month - 1, date, 12, 0, 0) / 1000)
}

function isWeekendUnix(unix: number) {
  const day = new Date(unix * 1000).getUTCDay()
  return day === 0 || day === 6
}

export function applySessionQuote(
  bars: CtpCandle[],
  quote:
    | {
        open?: number | null
        high?: number | null
        low?: number | null
        last?: number | null
        volume?: number | null
        trade_date?: string | null
        update_time?: string | null
      }
    | undefined,
  id: TimeframeId,
  symbol?: string | null,
) {
  if (!quote || (id !== "1d" && id !== "1w" && id !== "1M")) return bars
  const open = quote.open
  const last = quote.last
  if (open == null || last == null || !(open > 0) || !(last > 0)) return bars
  const nightNow = !!symbol && isNightWallClock(new Date(), symbol)
  const rollNight = nightNow && isNightHqPrint(symbol!, quote)
  let sessionYmd: string | null = quote.trade_date || null
  if (symbol && rollNight) sessionYmd = futuresTradeDateYmd(symbol)
  else if (symbol && nightNow && hasNightSession(symbol) && !rollNight) sessionYmd = quote.trade_date || null
  else if (symbol && !isCffexProduct(symbol) && !nightNow) sessionYmd = quote.trade_date || futuresTradeDateYmd(symbol)
  const dated = tradeDateUnix(sessionYmd)
  const raw = dated ?? (isWeekendUnix(shanghaiWallUnix()) ? null : shanghaiWallUnix())
  if (raw == null) return bars
  const time = bucketTime(raw, id)
  if (!dated && isWeekendUnix(time)) return bars
  return applySessionOhlc(bars, quote, id, time)
}

function applySessionOhlc(
  bars: CtpCandle[],
  quote: {
    open?: number | null
    high?: number | null
    low?: number | null
    last?: number | null
    volume?: number | null
  },
  id: TimeframeId,
  time: number,
) {
  const open = quote.open
  const last = quote.last
  if (open == null || last == null || !(open > 0) || !(last > 0)) return bars
  const high = quote.high != null && quote.high > 0 ? quote.high : Math.max(open, last)
  const low = quote.low != null && quote.low > 0 ? quote.low : Math.min(open, last)
  const volume = quote.volume ?? 0
  const next = bars.slice()
  const idx = next.findIndex((bar) => bar.time === time)
  if (idx < 0) {
    // A lone session print is not a daily series — charting it stretches one
    // candle across the whole pane (the 日线 "giant bar" bug).
    if (!next.length) return bars
    if (isWeekendUnix(time)) return bars
    next.push({ time, open, high, low, close: last, volume })
    return next.sort((a, b) => a.time - b.time)
  }
  next[idx] = {
    time,
    open: id === "1d" ? open : next[idx].open || open,
    high: Math.max(next[idx].high, high),
    low: Math.min(next[idx].low, low),
    close: last,
    volume: Math.max(next[idx].volume, volume),
  }
  return next
}

function quoteBarUnix(quote: { trade_date?: string | null; update_time?: string | null }) {
  const ymd = quote.trade_date
  const clock = quote.update_time
  if (!ymd || !clock || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const [hour, minute] = clock.split(":").map(Number)
  if (![hour, minute].every((n) => Number.isFinite(n))) return null
  const [year, month, date] = ymd.split("-").map(Number)
  return Math.floor(Date.UTC(year, month - 1, date, hour, minute, 0) / 1000)
}

/** Stamp last onto the current 1m/5m/… bar while the product is actually in session. */
export function applyLiveQuoteBar(
  bars: CtpCandle[],
  quote:
    | {
        last?: number | null
        volume?: number | null
        trade_date?: string | null
        update_time?: string | null
      }
    | undefined,
  id: TimeframeId,
  symbol?: string | null,
) {
  if (id === "1d" || id === "1w" || id === "1M") return applySessionQuote(bars, quote, id, symbol)
  if (!symbol || !quote || !isLiveSessionFor(symbol)) return bars
  if (isNightWallClock(new Date(), symbol) && !isNightHqPrint(symbol, quote)) return bars
  const last = quote.last
  if (last == null || !(last > 0)) return bars
  const unix = quoteBarUnix(quote)
  if (unix == null) return bars
  const time = bucketTime(unix, id)
  if (!bars.length) return bars
  const next = bars.slice()
  const idx = next.findIndex((bar) => bar.time === time)
  if (idx < 0) {
    const prev = next[next.length - 1]
    if (time <= prev.time) return bars
    next.push({
      time,
      open: prev.close,
      high: Math.max(prev.close, last),
      low: Math.min(prev.close, last),
      close: last,
      volume: quote.volume ?? 0,
    })
    return next
  }
  const cur = next[idx]
  next[idx] = {
    ...cur,
    high: Math.max(cur.high, last),
    low: Math.min(cur.low, last),
    close: last,
    volume: Math.max(cur.volume, quote.volume ?? 0),
  }
  return next
}

export function formatCandleTime(unix: number, id: TimeframeId = "1m") {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  if (id === "1d" || id === "1w" || id === "1M") {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  if (id === "1h" || id === "4h") {
    return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00`
  }
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export function klinePeriod(id: TimeframeId) {
  if (id === "1h") return { type: "hour" as const, span: 1 }
  if (id === "4h") return { type: "hour" as const, span: 4 }
  if (id === "1d") return { type: "day" as const, span: 1 }
  if (id === "1w") return { type: "week" as const, span: 1 }
  if (id === "1M") return { type: "month" as const, span: 1 }
  return { type: "minute" as const, span: Math.max(1, getTimeframe(id).seconds / 60) }
}
