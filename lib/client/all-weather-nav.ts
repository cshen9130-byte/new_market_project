/** Prior close + today's live P/L. Not initial capital + today's P/L. */
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
