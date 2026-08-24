import { allListedCffexIndexContracts } from "@/lib/client/cffex-expiry"
import { INDEX_FUTURES, type CtpCandle, type CtpTick } from "@/lib/client/ctp-market"
import { parseSinaFuturesHq } from "@/lib/server/sina-futures-hq"

const SINA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

type ProductCode = (typeof INDEX_FUTURES)[number]["product"]

export type CffexProductSnapshot = {
  product: ProductCode
  name: string
  symbol: string
  candles: CtpCandle[]
  quote: CtpTick
}

const SINA_SYMBOL: Record<ProductCode, string> = {
  IH: "IH0",
  IF: "IF0",
  IC: "IC0",
  IM: "IM0",
}

function num(value: string | undefined) {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function barUnix(dateStr: string, hhmm: string) {
  const [year, month, day] = dateStr.split("-").map(Number)
  const [hour, minute] = hhmm.split(":").map(Number)
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute, 0) / 1000)
}

function parseJsonp(text: string) {
  const start = text.indexOf("_=(")
  if (start < 0) throw new Error("unexpected sina jsonp")
  const end = text.lastIndexOf(")")
  return JSON.parse(text.slice(start + 3, end)) as string[][]
}

async function sinaGet(url: string, referer: string) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": SINA_UA,
      Referer: referer,
    },
  })
  if (!res.ok) throw new Error(`sina ${res.status}`)
  return res.text()
}

function parseHq(text: string) {
  return parseSinaFuturesHq(text)
}

function candlesFromMinLine(rows: string[][], fallbackDate: string) {
  const date = rows[0]?.[6] || fallbackDate
  const candles: CtpCandle[] = []
  let prevClose: number | null = null
  for (const row of rows) {
    const hhmm = row[0]
    const close = num(row[1])
    if (!hhmm || close == null) continue
    const open = prevClose ?? close
    candles.push({
      time: barUnix(date, hhmm),
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: num(row[3]) ?? 0,
    })
    prevClose = close
  }
  return candles
}

function mergeLiveBar(candles: CtpCandle[], quote: CtpTick, date: string | null) {
  if (quote.last == null || !quote.update_time || !date) return candles
  const hhmm = quote.update_time.slice(0, 5)
  const time = barUnix(date, hhmm)
  const last = quote.last
  if (!candles.length) {
    return [{ time, open: last, high: last, low: last, close: last, volume: quote.volume ?? 0 }]
  }
  const next = candles.slice()
  const current = next[next.length - 1]
  if (current.time === time) {
    next[next.length - 1] = {
      ...current,
      high: Math.max(current.high, last),
      low: Math.min(current.low, last),
      close: last,
    }
    return next
  }
  if (time > current.time) {
    next.push({
      time,
      open: current.close,
      high: Math.max(current.close, last),
      low: Math.min(current.close, last),
      close: last,
      volume: 0,
    })
  }
  return next
}

async function fetchProduct(product: ProductCode, name: string, quotes: ReturnType<typeof parseHq>) {
  const symbol = SINA_SYMBOL[product]
  const quote = quotes.get(symbol)
  const text = await sinaGet(
    `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/_=/InnerFuturesNewService.getMinLine?symbol=${symbol}`,
    `https://finance.sina.com.cn/futures/quotes/${symbol}.shtml`,
  )
  const rows = parseJsonp(text)
  const date = quote?.trade_date || rows[0]?.[6] || new Date().toISOString().slice(0, 10)
  let candles = candlesFromMinLine(rows, date)
  const tick: CtpTick = quote
    ? {
        ...quote,
        symbol,
        update_millis: quote.update_millis ?? 0,
        trade_date: quote.trade_date,
      }
    : {
        symbol,
        last: candles.at(-1)?.close ?? null,
        bid: null,
        ask: null,
        volume: null,
        open_interest: null,
        pre_close: null,
        pre_settlement: num(rows[0]?.[5]),
        update_time: null,
        update_millis: 0,
      }
  if (quote) candles = mergeLiveBar(candles, tick, quote.trade_date ?? null)
  return { product, name, symbol, candles, quote: tick }
}

function toTick(quote: CtpTick): CtpTick {
  return {
    ...quote,
    update_millis: quote.update_millis ?? 0,
    trade_date: quote.trade_date ?? null,
  }
}

export type CffexRealtimeBundle = {
  products: CffexProductSnapshot[]
  quotes: Record<string, CtpTick>
}

let inflight: Promise<CffexRealtimeBundle> | null = null
let cached: { at: number; data: CffexRealtimeBundle } | null = null
const TTL_MS = 1500

export async function getCffexIndexRealtime() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data
  if (inflight) return inflight
  inflight = (async () => {
    const listed = allListedCffexIndexContracts()
    const hqIds = [
      ...INDEX_FUTURES.map((item) => `nf_${SINA_SYMBOL[item.product]}`),
      ...listed.map((symbol) => `nf_${symbol}`),
    ]
    const hqText = await sinaGet(`https://hq.sinajs.cn/list=${hqIds.join(",")}`, "https://finance.sina.com.cn")
    const quotes = parseHq(hqText)
    const products = await Promise.all(INDEX_FUTURES.map((item) => fetchProduct(item.product, item.name, quotes)))
    const extra: Record<string, CtpTick> = {}
    for (const [symbol, quote] of quotes) extra[symbol] = toTick(quote)
    return { products, quotes: extra }
  })().finally(() => {
    inflight = null
  })
  const data = await inflight
  cached = { at: Date.now(), data }
  return data
}
