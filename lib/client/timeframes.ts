import type { CtpCandle } from "@/lib/client/ctp-market"

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

export function mergeHistoryAndLive(history: CtpCandle[], live1m: CtpCandle[], id: TimeframeId) {
  const live = aggregateCandles(live1m, id)
  if (!history.length) return live
  if (!live.length) return history
  const map = new Map<number, CtpCandle>()
  for (const bar of history) map.set(bar.time, bar)
  for (const bar of live) map.set(bar.time, bar)
  return [...map.values()].sort((a, b) => a.time - b.time)
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
