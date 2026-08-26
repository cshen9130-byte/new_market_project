import { shanghaiYmd } from "@/lib/client/market-hours"

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
}

export function allWeatherAnchorRows<T extends AllWeatherLiveRow>(rows: T[], asOf: string, today = shanghaiYmd()) {
  const stale = Boolean(asOf) && asOf < today
  return {
    stale,
    rows: rows.map((row) => ({
      ...row,
      prevPrice: stale ? (row.price > 0 ? row.price : row.prevPrice) : row.prevPrice > 0 ? row.prevPrice : row.price,
    })),
  }
}

export function allWeatherLiveDailyPnl(
  rows: AllWeatherLiveRow[],
  markOf: (symbol: string | undefined, fallback: number) => number,
): number {
  let daily = 0
  for (const row of rows) {
    if (!row.lots || !row.multiplier) {
      daily += row.dailyPnl ?? 0
      continue
    }
    const prev = row.prevPrice > 0 ? row.prevPrice : row.price
    if (!(prev > 0)) {
      daily += row.dailyPnl ?? 0
      continue
    }
    const mark = markOf(row.symbol, row.price)
    daily += (mark - prev) * row.lots * row.multiplier
  }
  return daily
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
  const today = opts.today ?? shanghaiYmd()
  const { stale, rows } = allWeatherAnchorRows(opts.rows, opts.asOf, today)
  const liveDaily = allWeatherLiveDailyPnl(rows, opts.markOf)
  return {
    liveDaily,
    equity: stale ? opts.equity + liveDaily : allWeatherLiveNav(opts.equity, opts.dailyPnl, liveDaily),
  }
}
