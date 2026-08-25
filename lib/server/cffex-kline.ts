import type { CtpCandle } from "@/lib/client/ctp-market"
import { futuresTradeDateYmd, isNightHqPrint, isNightWallClock } from "@/lib/client/market-hours"
import { aggregateCandles, bucketTime, type TimeframeId } from "@/lib/client/timeframes"
import { chinaWallToUnix, sinaGet } from "@/lib/server/sina-fetch"
import { fetchSinaFuturesQuotes } from "@/lib/server/sina-futures-hq"

function num(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseJsonp(text: string): unknown {
  const marked = text.indexOf("_=(")
  const start = marked >= 0 ? marked + 2 : text.indexOf("(")
  const end = text.lastIndexOf(")")
  if (start < 0 || end <= start) throw new Error("unexpected sina kline jsonp")
  return JSON.parse(text.slice(start + 1, end))
}

function asRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>
    for (const key of ["data", "result", "kline", "klines"]) {
      if (Array.isArray(rec[key])) return rec[key]
    }
  }
  return []
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

function parseMinLineRow(row: unknown, fallbackDate: string, prevClose: number | null): CtpCandle | null {
  // Sina getMinLine: [hh:mm, close, avg, volume, openInterest, settlement?, date]
  if (!Array.isArray(row) || !row.length) return null
  const a = row.map((x) => String(x))
  const hhmmRaw = a[0] || ""
  const hhmm = hhmmRaw.length === 5 ? `${hhmmRaw}:00` : hhmmRaw
  const date = a.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)) || fallbackDate
  const close = num(a[1])
  if (close == null || !(close > 0)) return null
  const open = prevClose && prevClose > 0 ? prevClose : close
  return toCandle(
    chinaWallToUnix(`${date} ${hhmm}`),
    open,
    Math.max(open, close),
    Math.min(open, close),
    close,
    num(a[3]) ?? 0,
  )
}

function sanitizeIntraday(rows: CtpCandle[]) {
  const valid = rows.filter((c) => c.close > 0 && c.open > 0 && c.high > 0 && c.low > 0)
  if (valid.length < 8) return valid
  const closes = valid.map((c) => c.close).sort((a, b) => a - b)
  const median = closes[Math.floor(closes.length / 2)]
  return valid.filter((c) => c.close > median * 0.8 && c.close < median * 1.2 && c.low > median * 0.75 && c.high < median * 1.25)
}

async function fetchMinLine(symbol: string) {
  const raw = await fetchJsonp(
    `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/_=/InnerFuturesNewService.getMinLine?symbol=${symbol}`,
    symbol,
  )
  const rows = asRows(raw)
  const date = shanghaiToday()
  const candles: CtpCandle[] = []
  let prev: number | null = null
  for (const row of rows) {
    const candle = parseMinLineRow(row, date, prev)
    if (!candle) continue
    candles.push(candle)
    prev = candle.close
  }
  return sanitizeIntraday(candles)
}

async function fetchFewMin(symbol: string, type: 5 | 15 | 30 | 60) {
  const raw = await fetchJsonp(
    `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/_=/InnerFuturesNewService.getFewMinLine?symbol=${encodeURIComponent(symbol)}&type=${type}`,
    symbol,
  )
  const rows = asRows(raw)
  const date = shanghaiToday()
  return rows.map((row) => parseRow(row, date)).filter((c): c is CtpCandle => !!c)
}

async function fetchDaily(symbol: string) {
  const urls = [
    `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/_=/InnerFuturesNewService.getDailyKLine?symbol=${encodeURIComponent(symbol)}`,
    `https://stock2.finance.sina.com.cn/futures/api/json.php/IndexService.getInnerFuturesDailyKLine?symbol=${encodeURIComponent(symbol)}`,
  ]
  for (const url of urls) {
    try {
      const raw = url.includes("jsonp.php")
        ? await fetchJsonp(url, symbol)
        : JSON.parse(await sinaGet(url, `https://finance.sina.com.cn/futures/quotes/${symbol}.shtml`))
      const candles = asRows(raw)
        .map((row) => parseRow(row, shanghaiToday()))
        .filter((c): c is CtpCandle => !!c)
      if (candles.length) return candles
    } catch {
      // try the next daily source
    }
  }
  return []
}

function sortUnique(bars: CtpCandle[]) {
  const map = new Map<number, CtpCandle>()
  for (const bar of bars) map.set(bar.time, bar)
  return [...map.values()].sort((a, b) => a.time - b.time)
}

async function fetchSessionHq(symbol: string) {
  try {
    const tick = (await fetchSinaFuturesQuotes([symbol])).get(symbol.toUpperCase())
    const open = tick?.open
    const last = tick?.last
    if (open == null || last == null || !(open > 0) || !(last > 0)) return null
    const high = tick.high != null && tick.high > 0 ? tick.high : Math.max(open, last)
    const low = tick.low != null && tick.low > 0 ? tick.low : Math.min(open, last)
    if (high < last * 0.2 || low > last * 5) return null
    const nightNow = isNightWallClock(new Date(), symbol)
    const date =
      nightNow && isNightHqPrint(symbol, tick)
        ? futuresTradeDateYmd(symbol)
        : tick.trade_date || shanghaiToday()
    const time = chinaWallToUnix(`${date} 00:00:00`)
    if (time == null) return null
    return toCandle(time, open, high, low, last, tick.volume ?? 0)
  } catch {
    return null
  }
}

function dropScaleOutliers(rows: CtpCandle[]) {
  if (rows.length < 8) return rows
  const closes = rows.map((c) => c.close).sort((a, b) => a - b)
  const median = closes[Math.floor(closes.length / 2)]
  if (!(median > 0)) return rows
  return rows.filter((c) => c.close > median * 0.25 && c.close < median * 4 && c.high > 0 && c.low > 0)
}

function applySessionHq(bars: CtpCandle[], session: CtpCandle | null, interval: TimeframeId) {
  if (!session) return bars
  const time = bucketTime(session.time, interval)
  const next = bars.slice()
  const idx = next.findIndex((bar) => bar.time === time)
  if (idx < 0) {
    next.push({ ...session, time })
    return sortUnique(next)
  }
  next[idx] = {
    time,
    open: interval === "1d" ? session.open : next[idx].open || session.open,
    high: Math.max(next[idx].high, session.high),
    low: Math.min(next[idx].low, session.low),
    close: session.close,
    volume: Math.max(next[idx].volume, session.volume),
  }
  return next
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
    const session = await fetchSessionHq(symbol)
    const withToday = applySessionHq(daily, session, "1d")
    data = interval === "1d" ? withToday : aggregateCandles(withToday, interval)
  }

  data = dropScaleOutliers(sortUnique(data))
  if (data.length >= 8) cache.set(key, { at: Date.now(), data })
  else if (hit?.data.length) data = hit.data
  else if (data.length) cache.set(key, { at: Date.now(), data })
  return data
}
