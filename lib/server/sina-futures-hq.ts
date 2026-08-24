import type { CtpBookLevel, CtpTick } from "@/lib/client/ctp-market"

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

export function parseSinaFuturesHq(text: string) {
  const quotes = new Map<string, CtpTick>()
  const re = /var hq_str_(?:nf_|CFF_RE_)?([A-Z]{1,3}\d{3,4}|[A-Z]{1,3}0)="([^"]*)";/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (!match[2].trim()) continue
    const symbol = match[1].toUpperCase()
    const parts = match[2].split(",")
    const dateMatch = match[2].match(/(\d{4}-\d{2}-\d{2}),(\d{2}:\d{2}:\d{2})/)
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
      update_time: dateMatch?.[2] ?? null,
      update_millis: 0,
      trade_date: dateMatch?.[1] ?? null,
    })
  }
  return quotes
}
