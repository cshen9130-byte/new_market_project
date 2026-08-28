import { isLiveSessionFor, mergeClosedMarks, validMark, weekdayClosedLast } from "@/lib/client/market-hours"

/** Yesterday's close + today's live P/L. Not initial capital + today's P/L. */
export function allWeatherLiveNav(bookEquity: number, bookDailyPnl: number, liveDailyPnl: number) {
  return bookEquity - bookDailyPnl + liveDailyPnl
}

export type AllWeatherLiveRow = {
  symbol?: string
  lots: number
  multiplier: number
  prevPrice: number
  price: number
  dailyPnl?: number
  sleeve?: string
  asset?: string
  bookDaily?: number
  bookCum?: number
}

function todayYmd(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

function asOfYmd(asOf: string) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(asOf || ""))
  return m ? m[1] : asOf
}

function tickPx(n: number | null | undefined) {
  return n != null && Number.isFinite(n) && n > 0 ? n : null
}

type LiveQuote = { last?: number | null; bid?: number | null; ask?: number | null }

function quoteOf(quotes: Record<string, LiveQuote>, symbol: string) {
  return quotes[symbol.toUpperCase()] || quotes[symbol]
}

/** Last trade, else live bid/ask, else the book's last close. Do not use 1m candles. */
export function allWeatherLiveMark(
  symbol: string | undefined,
  quotes: Record<string, LiveQuote>,
  fallback: number,
  now = new Date(),
) {
  if (!symbol) return fallback
  const tick = quoteOf(quotes, symbol)
  if (!isLiveSessionFor(symbol, now)) {
    // Weekday lunch / tea: keep this morning (or last night) last. Do not pin to settle.
    return weekdayClosedLast(symbol, tick, now) ?? fallback
  }
  const last = tickPx(tick?.last)
  if (last != null) return last
  const bid = tickPx(tick?.bid)
  const ask = tickPx(tick?.ask)
  if (bid != null && ask != null) return (bid + ask) / 2
  return bid ?? ask ?? fallback
}

/** Keep the last in-session print. After close, ignore SimNow/Sina jitter. */
export function allWeatherFrozenMarks(
  prev: Record<string, number>,
  rows: Array<{ symbol?: string; price: number }>,
  quotes: Record<string, LiveQuote>,
  now = new Date(),
) {
  const incoming: Record<string, number> = {}
  for (const row of rows) {
    if (!row.symbol) continue
    const tick = quoteOf(quotes, row.symbol)
    if (!isLiveSessionFor(row.symbol, now)) {
      const closed = weekdayClosedLast(row.symbol, tick, now)
      // Don't freeze the book fallback before a quote arrives, or lunch stays at yesterday.
      if (closed != null) incoming[row.symbol.toUpperCase()] = closed
      continue
    }
    const px = allWeatherLiveMark(row.symbol, quotes, row.price, now)
    if (validMark(px)) incoming[row.symbol.toUpperCase()] = px
  }
  return mergeClosedMarks(prev, incoming)
}

export function allWeatherAnchorRows<T extends AllWeatherLiveRow>(rows: T[], asOf: string, today = todayYmd()) {
  const stale = Boolean(asOf) && asOfYmd(asOf) < today
  return {
    stale,
    rows: rows.map((row) => ({
      ...row,
      prevPrice: stale ? (row.price > 0 ? row.price : row.prevPrice) : row.prevPrice > 0 ? row.prevPrice : row.price,
    })),
  }
}

export function allWeatherPositionDailyPnl(
  row: AllWeatherLiveRow,
  markOf: (symbol: string | undefined, fallback: number) => number,
) {
  if (!row.lots || !row.multiplier) return 0
  const prev = row.prevPrice > 0 ? row.prevPrice : row.price
  if (!(prev > 0)) return 0
  const mark = markOf(row.symbol, row.price)
  return (mark - prev) * row.lots * row.multiplier
}

export function allWeatherLiveDailyPnl(
  rows: AllWeatherLiveRow[],
  markOf: (symbol: string | undefined, fallback: number) => number,
): number {
  return rows.reduce((sum, row) => sum + allWeatherPositionDailyPnl(row, markOf), 0)
}

/**
 * Running NAV: last closed book equity, plus live marks vs the right anchor.
 * If the book is already as-of today, anchor is yesterday's settle (prevPrice).
 * If the book is still yesterday, keep that close and mark vs the book's last price.
 */
export function allWeatherMarkedEquity(opts: {
  asOf: string
  equity: number
  dailyPnl: number
  rows: AllWeatherLiveRow[]
  markOf: (symbol: string | undefined, fallback: number) => number
  today?: string
}) {
  const breakdown = allWeatherLiveBreakdown({ ...opts, initialCapital: 0 })
  return { liveDaily: breakdown.daily, equity: breakdown.equity }
}

export function allWeatherLiveBreakdown(opts: {
  asOf: string
  equity: number
  dailyPnl: number
  initialCapital?: number
  rows: AllWeatherLiveRow[]
  markOf: (symbol: string | undefined, fallback: number) => number
  today?: string
}) {
  const today = opts.today ?? todayYmd()
  const { stale, rows } = allWeatherAnchorRows(opts.rows, opts.asOf, today)
  const sleevePnl: Record<string, number> = {}
  const sleeveCum: Record<string, number> = {}
  const productPnl: Record<string, number> = {}
  const productCum: Record<string, number> = {}
  let daily = 0
  for (const row of rows) {
    const liveDaily = allWeatherPositionDailyPnl(row, opts.markOf)
    daily += liveDaily
    const bookDaily = row.bookDaily ?? row.dailyPnl ?? 0
    const bookCum = row.bookCum ?? 0
    const cum = stale ? bookCum + liveDaily : bookCum - bookDaily + liveDaily
    const productKey = row.asset || row.symbol
    if (productKey) {
      productPnl[productKey] = (productPnl[productKey] ?? 0) + liveDaily
      productCum[productKey] = (productCum[productKey] ?? 0) + cum
    }
    if (row.sleeve) {
      sleevePnl[row.sleeve] = (sleevePnl[row.sleeve] ?? 0) + liveDaily
      sleeveCum[row.sleeve] = (sleeveCum[row.sleeve] ?? 0) + cum
    }
  }
  const equity = stale ? opts.equity + daily : allWeatherLiveNav(opts.equity, opts.dailyPnl, daily)
  const initialCapital = opts.initialCapital ?? 0
  return {
    stale,
    daily,
    equity,
    cum: equity - initialCapital,
    sleevePnl,
    sleeveCum,
    productPnl,
    productCum,
  }
}
