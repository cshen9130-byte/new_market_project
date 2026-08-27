import type { CtpBookLevel, CtpTick } from "@/lib/client/ctp-market"
import { sinaGet } from "@/lib/server/sina-fetch"

function num(value: string | number | undefined | null) {
  if (value == null || value === "" || value === "-" || value === "--") return null
  const n = Number(value)
  return Number.isFinite(n) && n !== 0 ? n : Number.isFinite(n) ? n : null
}

function px(value: string | number | undefined | null) {
  const n = num(value)
  return n != null && n > 0 ? n : null
}

function vol(value: string | number | undefined | null) {
  const n = num(value)
  return n != null && n > 0 ? n : null
}

function level(price: string | number | undefined | null, volume: string | number | undefined | null): CtpBookLevel | null {
  const p = px(price)
  const v = vol(volume)
  if (p == null && v == null) return null
  return { price: p, volume: v }
}

function compactBook(rows: Array<CtpBookLevel | null>) {
  return rows.filter((row): row is CtpBookLevel => row != null)
}

/** CFFEX `nf_IF2609`: 16..25 bid px/vol pairs, 26..35 ask px/vol pairs. */
function parseCffexBook(parts: string[]) {
  const bids = compactBook([0, 1, 2, 3, 4].map((i) => level(parts[16 + i * 2], parts[17 + i * 2])))
  const asks = compactBook([0, 1, 2, 3, 4].map((i) => level(parts[26 + i * 2], parts[27 + i * 2])))
  return { bids, asks }
}

/** Commodity `nf_AU2610`: only L1 in the short record. */
function parseCommodityBook(parts: string[]) {
  const bids = compactBook([level(parts[6], parts[11])])
  const asks = compactBook([level(parts[7], parts[12])])
  return { bids, asks }
}

function isCffexHq(parts: string[]) {
  return px(parts[0]) != null && px(parts[16]) != null
}

function parseHqClock(parts: string[], raw: string) {
  const date =
    raw.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || parts.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)) || null
  const colon = raw.match(/(\d{4}-\d{2}-\d{2}),(\d{2}:\d{2}:\d{2})/)
  if (colon) return { date: colon[1], time: colon[2] }
  const digits = String(parts[1] || "").replace(/\D/g, "")
  if (digits.length === 5 || digits.length === 6) {
    const s = digits.padStart(6, "0")
    const hh = Number(s.slice(0, 2))
    const mm = Number(s.slice(2, 4))
    const ss = Number(s.slice(4, 6))
    if (hh <= 23 && mm <= 59 && ss <= 59) {
      return { date, time: `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}` }
    }
  }
  return { date, time: null as string | null }
}

export function parseSinaFuturesHq(text: string) {
  const quotes = new Map<string, CtpTick>()
  const re = /var hq_str_(?:nf_|CFF_RE_)?([A-Z]{1,3}\d{3,4}|[A-Z]{1,3}0)="([^"]*)";/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (!match[2].trim()) continue
    const symbol = match[1].toUpperCase()
    const parts = match[2].split(",")
    const clock = parseHqClock(parts, match[2])
    const cffex = isCffexHq(parts)
    const book = cffex ? parseCffexBook(parts) : parseCommodityBook(parts)
    const last = cffex ? px(parts[3]) : px(parts[8])
    const preClose = cffex ? px(parts[14]) : px(parts[5])
    if (last == null && preClose == null && !book.bids.length && !book.asks.length) continue
    quotes.set(symbol, {
      symbol,
      last: last ?? book.bids[0]?.price ?? book.asks[0]?.price ?? null,
      bid: book.bids[0]?.price ?? null,
      ask: book.asks[0]?.price ?? null,
      bid_volume: book.bids[0]?.volume ?? null,
      ask_volume: book.asks[0]?.volume ?? null,
      volume: cffex ? num(parts[4]) : num(parts[14]),
      open_interest: cffex ? num(parts[6]) : num(parts[13]),
      pre_settlement: cffex ? px(parts[13]) : px(parts[10]),
      pre_close: preClose,
      open: cffex ? px(parts[0]) : px(parts[2]),
      high: cffex ? px(parts[1]) : px(parts[3]),
      low: cffex ? px(parts[2]) : px(parts[4]),
      average: px(parts.at(-2)),
      bids: book.bids,
      asks: book.asks,
      update_time: clock.time,
      update_millis: 0,
      trade_date: clock.date,
    })
  }
  return quotes
}

export function hqSymbolAliases(symbol: string) {
  const u = symbol.trim().toUpperCase()
  const m = u.match(/^([A-Z]{1,3})(\d{3,4})$/)
  if (!m) return u ? [u] : []
  if (m[2].length === 3) return [u, `${m[1]}2${m[2]}`]
  if (m[2].length === 4 && m[2].startsWith("2")) return [u, `${m[1]}${m[2].slice(1)}`]
  return [u]
}

export async function fetchSinaFuturesQuotes(symbols: string[]) {
  const requested = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)
  const unique = [...new Set(requested.flatMap(hqSymbolAliases))]
  if (!unique.length) return new Map<string, CtpTick>()
  const text = await sinaGet(
    `https://hq.sinajs.cn/list=${unique.map((symbol) => `nf_${symbol}`).join(",")}`,
    "https://finance.sina.com.cn",
  )
  const parsed = parseSinaFuturesHq(text)
  const out = new Map(parsed)
  for (const raw of requested) {
    if (out.has(raw)) continue
    for (const alt of hqSymbolAliases(raw)) {
      const quote = parsed.get(alt)
      if (quote?.last) {
        out.set(raw, { ...quote, symbol: raw })
        break
      }
    }
  }
  const { attachEastmoneyBooks } = await import("@/lib/server/eastmoney-futures-book")
  await attachEastmoneyBooks(out, requested)
  return out
}
