import { isNearCffexExpiry, listedCffexIndexContracts } from "@/lib/client/cffex-expiry"

export const INDEX_FUTURES = [
  { product: "IH", name: "上证50" },
  { product: "IF", name: "沪深300" },
  { product: "IC", name: "中证500" },
  { product: "IM", name: "中证1000" },
] as const

export type IndexProduct = (typeof INDEX_FUTURES)[number]["product"]

export type CtpCandle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type CtpBookLevel = {
  price: number | null
  volume: number | null
}

export type CtpTick = {
  symbol: string
  last: number | null
  bid: number | null
  ask: number | null
  bid_volume?: number | null
  ask_volume?: number | null
  volume: number | null
  open_interest: number | null
  pre_close: number | null
  pre_settlement: number | null
  pre_open_interest?: number | null
  average?: number | null
  turnover?: number | null
  open?: number | null
  high?: number | null
  low?: number | null
  update_time: string | null
  update_millis: number | null
  trade_date?: string | null
  bids?: CtpBookLevel[]
  asks?: CtpBookLevel[]
}

export type CtpStatus = {
  connected?: boolean
  logged_in?: boolean
  profile?: string
  front?: string
  message?: string
  tick_count?: number
  symbols?: string[]
  index_symbols?: string[]
  extra_symbols?: string[]
}

export function contractsForProduct(symbols: string[], product: string) {
  const re = new RegExp(`^${product}(\\d{4}|0)$`, "i")
  const listed = /^(IH|IF|IC|IM)$/i.test(product) ? listedCffexIndexContracts(product) : []
  return [...new Set([...listed, ...symbols.filter((s) => re.test(s))])].sort((a, b) => {
    const aDated = /\d{4}$/.test(a)
    const bDated = /\d{4}$/.test(b)
    if (aDated !== bDated) return aDated ? -1 : 1
    return a.localeCompare(b)
  })
}

export function pickMainContract(symbols: string[], product: string) {
  const matches = contractsForProduct(symbols, product)
  if (!matches.length) return null
  const dated = matches.filter((s) => /\d{4}$/.test(s)).sort()
  const live = dated.filter((s) => !isNearCffexExpiry(s))
  const pool = live.length ? live : dated
  if (pool.length) return pool[0]
  return matches.find((s) => /^[A-Z]+0$/i.test(s)) ?? matches[matches.length - 1]
}

export function pickMostActiveContract(
  symbols: string[],
  product: string,
  quotes: Record<string, CtpTick>,
) {
  const matches = contractsForProduct(symbols, product)
  if (!matches.length) return null
  const live = matches.filter((s) => !/\d{4}$/.test(s) || !isNearCffexExpiry(s))
  const pool = live.length ? live : matches
  const ranked = pool
    .map((symbol) => ({
      symbol,
      oi: quotes[symbol]?.open_interest || 0,
      volume: quotes[symbol]?.volume || 0,
    }))
    .sort((a, b) => b.oi - a.oi || b.volume - a.volume)
  if (ranked[0].oi > 0 || ranked[0].volume > 0) return ranked[0].symbol
  return pickMainContract(symbols, product)
}

export function upsertCandle(history: CtpCandle[] | undefined, candle: CtpCandle | null | undefined) {
  if (!candle) return history || []
  const rows = history ? history.slice() : []
  if (!rows.length) return [candle]
  const last = rows[rows.length - 1]
  if (last.time === candle.time) {
    rows[rows.length - 1] = candle
    return rows
  }
  if (candle.time > last.time) {
    rows.push(candle)
    if (rows.length > 1500) rows.splice(0, rows.length - 1500)
    return rows
  }
  return rows
}

/** Union two series by timestamp. Never drop bars the other side still has. */
export function mergeCandleSeries(prev: CtpCandle[] | undefined, incoming: CtpCandle[] | undefined): CtpCandle[] {
  if (!incoming?.length) return prev?.length ? prev : []
  if (!prev?.length) return incoming
  const map = new Map<number, CtpCandle>()
  for (const bar of prev) map.set(bar.time, bar)
  for (const bar of incoming) map.set(bar.time, bar)
  const out = [...map.values()].sort((a, b) => a.time - b.time)
  return out.length > 1500 ? out.slice(out.length - 1500) : out
}

export function bookLevelCount(levels?: CtpBookLevel[] | null) {
  return (levels || []).filter((row) => row.price != null && row.price > 0).length
}

export function pickBook(a?: CtpBookLevel[] | null, b?: CtpBookLevel[] | null) {
  return bookLevelCount(b) > bookLevelCount(a) ? b || [] : a || []
}

export function levelsFromTick(tick: CtpTick | undefined, side: "bid" | "ask"): CtpBookLevel[] {
  const book = side === "bid" ? tick?.bids : tick?.asks
  const filled = (book || []).filter((row) => row.price != null && row.price > 0)
  if (filled.length) return filled
  const price = side === "bid" ? tick?.bid : tick?.ask
  const volume = side === "bid" ? tick?.bid_volume : tick?.ask_volume
  return price != null && price > 0 ? [{ price, volume: volume ?? null }] : []
}

export function validTickPrice(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n > 0
}

export function mergeQuoteTicks(prev: CtpTick, incoming: CtpTick): CtpTick {
  return {
    ...prev,
    ...incoming,
    last: validTickPrice(incoming.last) ? incoming.last : prev.last,
    bids: pickBook(prev.bids, incoming.bids),
    asks: pickBook(prev.asks, incoming.asks),
    bid: incoming.bid ?? prev.bid,
    ask: incoming.ask ?? prev.ask,
    bid_volume: incoming.bid_volume ?? prev.bid_volume,
    ask_volume: incoming.ask_volume ?? prev.ask_volume,
    pre_settlement: incoming.pre_settlement ?? prev.pre_settlement,
    pre_close: incoming.pre_close ?? prev.pre_close,
    pre_open_interest: incoming.pre_open_interest ?? prev.pre_open_interest,
    average: incoming.average ?? prev.average,
  }
}

export function formatBarTime(unix: number) {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
