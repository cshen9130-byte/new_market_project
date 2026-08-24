import { cffexQuoteSymbolsToFetch } from "@/lib/client/cffex-expiry"
import type { CtpTick } from "@/lib/client/ctp-market"
import { getCffexKline } from "@/lib/server/cffex-kline"
import { sinaGet } from "@/lib/server/sina-fetch"
import { parseSinaFuturesHq } from "@/lib/server/sina-futures-hq"

const EM_UT = "b2884a393a59ad64002292a3e90d46a5"
const EM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function num(value: string | number | undefined) {
  if (value == null || value === "" || value === "-") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function shanghaiYmd(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

function ymdFromUnix(unix: number) {
  if (!(unix > 0)) return null
  const ms = unix < 1e12 ? unix * 1000 : unix
  return shanghaiYmd(new Date(ms))
}

function parseHq(text: string) {
  return parseSinaFuturesHq(text)
}

async function fetchHq(symbols: string[], referer: string) {
  if (!symbols.length) return new Map<string, CtpTick>()
  const text = await sinaGet(
    `https://hq.sinajs.cn/list=${symbols.map((symbol) => `nf_${symbol}`).join(",")}`,
    referer,
  )
  return parseHq(text)
}

async function fetchEastMoney(symbol: string): Promise<CtpTick | null> {
  const url =
    `https://push2.eastmoney.com/api/qt/stock/get?secid=220.${encodeURIComponent(symbol)}` +
    `&ut=${EM_UT}&invt=2&fltt=2&fields=f43,f46,f47,f57,f60,f86,f133`
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": EM_UA,
      Referer: "https://quote.eastmoney.com/",
    },
  })
  if (!res.ok) return null
  const json = (await res.json()) as { data?: Record<string, unknown> | null }
  const data = json.data
  if (!data) return null
  const last = num(data.f43 as number)
  if (last == null) return null
  const settle = num(data.f60 as number)
  return {
    symbol,
    last,
    bid: null,
    ask: null,
    volume: num(data.f47 as number),
    open_interest: num(data.f133 as number),
    pre_settlement: settle,
    pre_close: settle,
    open: num(data.f46 as number),
    update_time: null,
    update_millis: 0,
    trade_date: ymdFromUnix(Number(data.f86) || 0),
  }
}

function emptyTick(symbol: string): CtpTick {
  return {
    symbol,
    last: null,
    bid: null,
    ask: null,
    volume: null,
    open_interest: null,
    pre_close: null,
    pre_settlement: null,
    update_time: null,
    update_millis: 0,
    trade_date: null,
  }
}

async function fillFromKline(symbol: string, prev: CtpTick | undefined) {
  const bars = await getCffexKline(symbol, "1d")
  const last = bars.at(-1)
  const prior = bars.at(-2)
  if (!last) return prev
  return {
    ...(prev || emptyTick(symbol)),
    symbol,
    last: prev?.last ?? last.close,
    pre_close: prev?.pre_close ?? prior?.close ?? null,
    volume: prev?.volume ?? last.volume,
    trade_date: prev?.trade_date ?? shanghaiYmd(new Date(last.time * 1000)),
  }
}

function pickAsOf(quotes: Record<string, CtpTick>) {
  const dates = Object.values(quotes)
    .map((quote) => quote.trade_date)
    .filter((d): d is string => !!d)
    .sort()
  return dates.at(-1) ?? null
}

export type ListedQuotesBundle = {
  quotes: Record<string, CtpTick>
  asOf: string | null
}

let inflight: Promise<ListedQuotesBundle> | null = null
let cached: { at: number; data: ListedQuotesBundle } | null = null
const TTL_MS = 12_000

export async function getCffexListedQuotes() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data
  if (inflight) return inflight
  inflight = (async () => {
    const symbols = cffexQuoteSymbolsToFetch()
    const next: Record<string, CtpTick> = {}
    try {
      const batch = await fetchHq(symbols, "https://finance.sina.com.cn")
      for (const [symbol, quote] of batch) next[symbol] = quote
    } catch {
      // individual sources below
    }

    const missingHq = symbols.filter((symbol) => next[symbol]?.last == null)
    await Promise.all(
      missingHq.map(async (symbol) => {
        try {
          const one = await fetchHq([symbol], `https://finance.sina.com.cn/futures/quotes/${symbol}.shtml`)
          const quote = one.get(symbol)
          if (quote) next[symbol] = quote
        } catch {
          // EM / kline below
        }
      }),
    )

    const missingEm = symbols.filter((symbol) => next[symbol]?.last == null)
    await Promise.all(
      missingEm.map(async (symbol) => {
        try {
          const quote = await fetchEastMoney(symbol)
          if (quote) next[symbol] = quote
        } catch {
          // kline below
        }
      }),
    )

    const missingPx = symbols.filter((symbol) => next[symbol]?.last == null || next[symbol]?.pre_close == null)
    await Promise.all(
      missingPx.map(async (symbol) => {
        try {
          const filled = await fillFromKline(symbol, next[symbol])
          if (filled) next[symbol] = filled
        } catch {
          // leave blank
        }
      }),
    )
    return { quotes: next, asOf: pickAsOf(next) }
  })().finally(() => {
    inflight = null
  })
  const data = await inflight
  cached = { at: Date.now(), data }
  return data
}
