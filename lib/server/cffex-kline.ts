import type { CtpCandle } from "@/lib/client/ctp-market"
import { aggregateCandles, type TimeframeId } from "@/lib/client/timeframes"
import { chinaWallToUnix, sinaGet } from "@/lib/server/sina-fetch"

function num(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseJsonp(text: string): unknown {
  const start = text.indexOf("(")
  const end = text.lastIndexOf(")")
  if (start < 0 || end <= start) throw new Error("unexpected sina kline jsonp")
  return JSON.parse(text.slice(start + 1, end))
}

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function toCandle(time: number | null, open: number | null, high: number | null, low: number | null, close: number | null, volume: number | null): CtpCandle | null {
  if (time == null || close == null) return null
  const o = open ?? close
  return {
    time,
    open: o,
    high: high ?? Math.max(o, close),
    low: low ?? Math.min(o, close),
    close,
    volume: volume ?? 0,
  }
}

function parseRow(row: unknown, fallbackDate: string): CtpCandle | null {
  if (Array.isArray(row)) {
    const a = row.map((x) => String(x))
    if (a[0]?.includes("-") && a[0].includes(" ")) {
      return toCandle(chinaWallToUnix(a[0]), num(a[1]), num(a[2]), num(a[3]), num(a[4]), num(a[5]))
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(a[0] || "")) {
      return toCandle(chinaWallToUnix(`${a[0]} 00:00:00`), num(a[1]), num(a[2]), num(a[3]), num(a[4]), num(a[5]))
    }
    const hhmm = (a[0] || "").length === 5 ? `${a[0]}:00` : a[0]
    const date = a.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)) || fallbackDate
    if (a.length <= 5 || num(a[4]) == null) {
      const close = num(a[1])
      return toCandle(chinaWallToUnix(`${date} ${hhmm}`), close, close, close, close, num(a[3]) ?? num(a[2]))
    }
    return toCandle(chinaWallToUnix(`${date} ${hhmm}`), num(a[1]), num(a[2]), num(a[3]), num(a[4]), num(a[5]))
  }
  if (row && typeof row === "object") {
    const rec = row as Record<string, unknown>
    const stamp = String(rec.d || rec.day || rec.datetime || rec.date || "")
    const time = chinaWallToUnix(stamp.includes(" ") ? stamp : `${stamp} 00:00:00`)
    return toCandle(time, num(rec.o ?? rec.open), num(rec.h ?? rec.high), num(rec.l ?? rec.low), num(rec.c ?? rec.close), num(rec.v ?? rec.volume))
  }
  return null
}

async function fetchJsonp(url: string, symbol: string) {
  const text = await sinaGet(url, `https://finance.sina.com.cn/futures/quotes/${symbol}.shtml`)
  return parseJsonp(text)
}

async function fetchMinLine(symbol: string) {
  const raw = await fetchJsonp(
    `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/_=/InnerFuturesNewService.getMinLine?symbol=${symbol}`,
    symbol,
  )
  const rows = Array.isArray(raw) ? raw : []
  const date = shanghaiToday()
  return rows.map((row) => parseRow(row, date)).filter((c): c is CtpCandle => !!c)
}

async function fetchFewMin(symbol: string, type: 5 | 15 | 30 | 60) {
  const raw = await fetchJsonp(
    `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/_=/InnerFuturesNewService.getFewMinLine?symbol=${encodeURIComponent(symbol)}&type=${type}`,
    symbol,
  )
  const rows = Array.isArray(raw) ? raw : []
  const date = shanghaiToday()
  return rows.map((row) => parseRow(row, date)).filter((c): c is CtpCandle => !!c)
}

async function fetchDaily(symbol: string) {
  const raw = await fetchJsonp(
    `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/_=/InnerFuturesNewService.getDailyKLine?symbol=${encodeURIComponent(symbol)}`,
    symbol,
  )
  const rows = Array.isArray(raw) ? raw : []
  return rows.map((row) => parseRow(row, shanghaiToday())).filter((c): c is CtpCandle => !!c)
}

function sortUnique(bars: CtpCandle[]) {
  const map = new Map<number, CtpCandle>()
  for (const bar of bars) map.set(bar.time, bar)
  return [...map.values()].sort((a, b) => a.time - b.time)
}

const cache = new Map<string, { at: number; data: CtpCandle[] }>()

export async function getCffexKline(symbol: string, interval: TimeframeId) {
  const key = `${symbol}:${interval}`
  const ttl = interval === "1d" || interval === "1w" || interval === "1M" ? 60_000 : 12_000
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.data

  let data: CtpCandle[] = []
  if (interval === "1m") {
    data = await fetchMinLine(symbol)
  } else if (interval === "5m" || interval === "15m" || interval === "30m") {
    data = await fetchFewMin(symbol, Number(interval.replace("m", "")) as 5 | 15 | 30)
    if (data.length < 8) data = aggregateCandles(await fetchMinLine(symbol), interval)
  } else if (interval === "1h") {
    data = await fetchFewMin(symbol, 60)
    if (data.length < 8) data = aggregateCandles(await fetchMinLine(symbol), interval)
  } else if (interval === "4h") {
    const hourly = await fetchFewMin(symbol, 60)
    data = aggregateCandles(hourly.length ? hourly : await fetchDaily(symbol), "4h")
  } else {
    const daily = await fetchDaily(symbol)
    data = interval === "1d" ? daily : aggregateCandles(daily, interval)
  }

  data = sortUnique(data)
  cache.set(key, { at: Date.now(), data })
  return data
}
