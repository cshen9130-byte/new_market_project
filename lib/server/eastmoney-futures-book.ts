import {
  applyDeeperBook,
  bookLevelCount,
  type CtpBookLevel,
  type CtpTick,
} from "@/lib/client/ctp-market"

const EM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

/** Eastmoney futsse market id: SHFE 113 / DCE 114 / CZCE 115 / CFFEX 220 / INE 142 / GFEX 225 */
const MARKET_ID: Record<string, number> = {
  SHFE: 113,
  DCE: 114,
  CZCE: 115,
  CFFEX: 220,
  INE: 142,
  GFEX: 225,
}

const PRODUCT_MARKET: Record<string, keyof typeof MARKET_ID> = {
  A: "DCE", B: "DCE", BB: "DCE", BZ: "DCE", C: "DCE", CS: "DCE", EB: "DCE", EG: "DCE",
  FB: "DCE", I: "DCE", J: "DCE", JD: "DCE", JM: "DCE", L: "DCE", LG: "DCE", LH: "DCE",
  M: "DCE", P: "DCE", PG: "DCE", PP: "DCE", RR: "DCE", V: "DCE", Y: "DCE",
  AD: "SHFE", AG: "SHFE", AL: "SHFE", AO: "SHFE", AU: "SHFE", BR: "SHFE", BU: "SHFE",
  CU: "SHFE", FU: "SHFE", HC: "SHFE", NI: "SHFE", NR: "SHFE", OP: "SHFE", PB: "SHFE",
  PD: "SHFE", PT: "SHFE", RB: "SHFE", RU: "SHFE", SN: "SHFE", SP: "SHFE", SS: "SHFE",
  WR: "SHFE", ZN: "SHFE",
  BC: "INE", EC: "INE", LU: "INE", SC: "INE",
  AP: "CZCE", CF: "CZCE", CJ: "CZCE", CY: "CZCE", FG: "CZCE", MA: "CZCE", OI: "CZCE",
  PF: "CZCE", PK: "CZCE", PM: "CZCE", PR: "CZCE", PX: "CZCE", RM: "CZCE", RS: "CZCE",
  SA: "CZCE", SF: "CZCE", SH: "CZCE", SM: "CZCE", SR: "CZCE", TA: "CZCE", UR: "CZCE",
  WH: "CZCE", ZC: "CZCE",
  LC: "GFEX", PS: "GFEX", SI: "GFEX",
  IC: "CFFEX", IF: "CFFEX", IH: "CFFEX", IM: "CFFEX",
  T: "CFFEX", TF: "CFFEX", TL: "CFFEX", TS: "CFFEX",
}

const PRODUCTS = Object.keys(PRODUCT_MARKET).sort((a, b) => b.length - a.length)
const PRIORITY = new Set(["AU", "AG", "SC", "CU", "AL", "NI", "SN", "RB", "HC", "BU", "SP"])
const CACHE_MS = 4_000
const FETCH_TIMEOUT_MS = 2_500
const MAX_ENRICH = 10

type CacheEntry = { at: number; tick: CtpTick | null }
const cache = new Map<string, CacheEntry>()

type EmQt = {
  dm?: string
  p?: number | string
  mrj?: number | string
  mrl?: number | string
  mcj?: number | string
  mcl?: number | string
  bpgs?: number
  spgs?: number
  mmpjg?: Array<number | string>
  mmpl?: Array<number | string>
  jysj?: number | string
  o?: number | string
  h?: number | string
  l?: number | string
  ccl?: number | string
  np?: number | string
  fzjsj?: number | string
  rzjsj?: number | string
  j?: number | string
}

function px(value: number | string | undefined | null): number | null {
  if (value == null || value === "" || value === "-") return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function vol(value: number | string | undefined | null): number | null {
  if (value == null || value === "" || value === "-") return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function productOf(symbol: string) {
  const u = symbol.trim().toUpperCase()
  return PRODUCTS.find((product) => u.startsWith(product) && /^\d/.test(u.slice(product.length))) || ""
}

export function eastmoneyMarketOf(symbol: string) {
  const product = productOf(symbol)
  const exchange = product ? PRODUCT_MARKET[product] : null
  return exchange ? MARKET_ID[exchange] : null
}

function clockFromJysj(raw: number | string | undefined) {
  const digits = String(raw ?? "").replace(/\D/g, "")
  if (digits.length < 5 || digits.length > 6) return null
  const s = digits.padStart(6, "0")
  const hh = Number(s.slice(0, 2))
  const mm = Number(s.slice(2, 4))
  const ss = Number(s.slice(4, 6))
  if (hh > 23 || mm > 59 || ss > 59) return null
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`
}

function compact(rows: Array<CtpBookLevel | null>) {
  return rows.filter((row): row is CtpBookLevel => row != null && row.price != null && row.price > 0)
}

function level(price: number | string | undefined, volume: number | string | undefined): CtpBookLevel | null {
  const p = px(price)
  const v = vol(volume)
  if (p == null) return null
  return { price: p, volume: v }
}

/** futsse `mmpjg`: 卖五→卖一 then 买一→买五. Stored here as ask1..ask5 / bid1..bid5. */
export function parseEastmoneyFuturesQt(qt: EmQt, symbol: string): CtpTick | null {
  const prices = Array.isArray(qt.mmpjg) ? qt.mmpjg : []
  const volumes = Array.isArray(qt.mmpl) ? qt.mmpl : []
  // Always 10 slots: 卖五→卖一 then 买一→买五. bpgs/spgs is fill count, not stride.
  const askFarToNear = compact(Array.from({ length: 5 }, (_, i) => level(prices[i], volumes[i])))
  const bids = compact(Array.from({ length: 5 }, (_, i) => level(prices[5 + i], volumes[5 + i])))
  const asks = askFarToNear.slice().reverse()
  if (!asks.length) {
    const ask1 = level(qt.mcj, qt.mcl)
    if (ask1) asks.push(ask1)
  }
  if (!bids.length) {
    const bid1 = level(qt.mrj, qt.mrl)
    if (bid1) bids.push(bid1)
  }
  if (!bids.length && !asks.length && px(qt.p) == null) return null
  return {
    symbol: symbol.toUpperCase(),
    last: px(qt.p),
    bid: bids[0]?.price ?? null,
    ask: asks[0]?.price ?? null,
    bid_volume: bids[0]?.volume ?? null,
    ask_volume: asks[0]?.volume ?? null,
    volume: null,
    open_interest: vol(qt.ccl) ?? px(qt.ccl),
    pre_settlement: px(qt.fzjsj) ?? px(qt.rzjsj),
    pre_close: px(qt.fzjsj) ?? px(qt.rzjsj),
    open: px(qt.o),
    high: px(qt.h),
    low: px(qt.l),
    average: px(qt.j),
    bids,
    asks,
    update_time: clockFromJysj(qt.jysj),
    update_millis: 0,
  }
}

function instrumentIds(symbol: string) {
  const u = symbol.trim().toUpperCase()
  const m = u.match(/^([A-Z]{1,3})(\d{3,4})$/)
  const aliases = m
    ? m[2].length === 3
      ? [u, `${m[1]}2${m[2]}`]
      : m[2].length === 4 && m[2].startsWith("2")
        ? [u, `${m[1]}${m[2].slice(1)}`]
        : [u]
    : u
      ? [u]
      : []
  const out: string[] = []
  for (const alias of aliases) {
    const lower = alias.toLowerCase()
    if (!out.includes(lower)) out.push(lower)
  }
  return out
}

async function fetchQt(market: number, instrument: string) {
  const url = `https://futsseapi.eastmoney.com/static/${market}_${instrument}_qt`
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": EM_UA,
      Referer: "https://quote.eastmoney.com/",
    },
  })
  if (!res.ok) return null
  const json = (await res.json()) as { qt?: EmQt; result?: string }
  return json.qt || null
}

export async function fetchEastmoneyFuturesBook(symbol: string): Promise<CtpTick | null> {
  const key = symbol.trim().toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tick
  const market = eastmoneyMarketOf(key)
  if (!market || market === MARKET_ID.CFFEX) {
    cache.set(key, { at: Date.now(), tick: null })
    return null
  }
  let tick: CtpTick | null = null
  try {
    for (const id of instrumentIds(key)) {
      const qt = await fetchQt(market, id)
      if (!qt) continue
      tick = parseEastmoneyFuturesQt(qt, key)
      if (tick && (bookLevelCount(tick.bids) > 0 || bookLevelCount(tick.asks) > 0)) break
      tick = null
    }
  } catch {
    tick = null
  }
  cache.set(key, { at: Date.now(), tick })
  return tick
}

function needsBook(tick: CtpTick) {
  return Math.min(bookLevelCount(tick.bids), bookLevelCount(tick.asks)) < 5
}

function rankSymbol(symbol: string, watched: Set<string>) {
  if (watched.has(symbol)) return 0
  const product = productOf(symbol)
  if (PRIORITY.has(product)) return 1
  return 2
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()))
}

/** Fill 买二–买五 for commodity ticks. Sina/SimNow usually only have 买一/卖一. */
export async function attachEastmoneyBooks<T extends Map<string, CtpTick> | Record<string, CtpTick>>(
  quotes: T,
  prefer: string[] = [],
): Promise<T> {
  const watched = new Set(prefer.map((s) => s.trim().toUpperCase()).filter(Boolean))
  const entries: Array<[string, CtpTick]> =
    quotes instanceof Map ? [...quotes.entries()] : Object.entries(quotes)
  const targets = entries
    .filter(([symbol, tick]) => {
      const market = eastmoneyMarketOf(symbol)
      return !!market && market !== MARKET_ID.CFFEX && needsBook(tick)
    })
    .sort((a, b) => rankSymbol(a[0], watched) - rankSymbol(b[0], watched) || a[0].localeCompare(b[0]))
    .slice(0, MAX_ENRICH)

  if (!targets.length) return quotes

  await mapPool(targets, 5, async ([symbol, tick]) => {
    const book = await fetchEastmoneyFuturesBook(symbol)
    if (!book) return
    const merged = applyDeeperBook(tick, book)
    if (quotes instanceof Map) quotes.set(symbol, merged)
    else (quotes as Record<string, CtpTick>)[symbol] = merged
  })
  return quotes
}
