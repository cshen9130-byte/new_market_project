import { fmtIso, n, query } from "@/lib/db"

export const FOF_WEEKLY_BENCHMARKS = {
  IF: { label: "沪深300", source: "spot", symbol: "IF" },
  IC: { label: "中证500", source: "spot", symbol: "IC" },
  IM: { label: "中证1000", source: "spot", symbol: "IM" },
  IH: { label: "上证50", source: "spot", symbol: "IH" },
  "000001.SH": { label: "上证指数", source: "ashare", tsCode: "000001.SH" },
  "000300.SH": { label: "沪深300指数", source: "ashare", tsCode: "000300.SH" },
  "511010.SH": { label: "国债ETF", source: "etf", ticker: "511010.SH" },
  "518880.SH": { label: "黄金ETF", source: "etf", ticker: "518880.SH" },
  "510300.SH": { label: "沪深300ETF", source: "etf", ticker: "510300.SH" },
  "NHCI.NH": { label: "南华商品指数", source: "nanhua", code: "NHCI.NH" },
} as const

export type FofWeeklyBenchmarkKey = keyof typeof FOF_WEEKLY_BENCHMARKS

export function listFofWeeklyBenchmarkOptions(): Array<{ key: FofWeeklyBenchmarkKey; label: string }> {
  return Object.entries(FOF_WEEKLY_BENCHMARKS)
    .filter(([, meta]) => meta.source !== "ashare")
    .map(([key, meta]) => ({
      key: key as FofWeeklyBenchmarkKey,
      label: meta.label,
    }))
}

export function resolveFofWeeklyBenchmark(
  key?: string,
): { key: FofWeeklyBenchmarkKey; label: string } {
  const fallback = { key: "IF" as const, label: FOF_WEEKLY_BENCHMARKS.IF.label }
  if (!key || !(key in FOF_WEEKLY_BENCHMARKS)) return fallback
  const meta = FOF_WEEKLY_BENCHMARKS[key as FofWeeklyBenchmarkKey]
  return { key: key as FofWeeklyBenchmarkKey, label: meta.label }
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function loadFofWeeklyBenchmarkPrices(
  key: FofWeeklyBenchmarkKey,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const meta = FOF_WEEKLY_BENCHMARKS[key]
  const out = new Map<string, number>()

  if (meta.source === "spot") {
    const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
      `SELECT DISTINCT ON (trade_date) trade_date, close
       FROM raw_spot_daily
       WHERE symbol = $1
         AND trade_date >= $2::date
         AND trade_date <= $3::date
         AND close IS NOT NULL
         AND close > 0
       ORDER BY trade_date ASC, fetched_at DESC`,
      [meta.symbol, from, to],
    )
    for (const row of rows) {
      const value = n(row.close)
      if (value != null) out.set(fmtIso(row.trade_date), value)
    }
    return out
  }

  if (meta.source === "etf") {
    const rows = await query<{ trade_date: Date | string; value: string | number | null }>(
      `SELECT trade_date, value
       FROM raw_etf_daily
       WHERE ticker = $1
         AND field = 'ORIGINALUNIT'
         AND trade_date >= $2::date
         AND trade_date <= $3::date
         AND value IS NOT NULL
         AND value > 0
       ORDER BY trade_date ASC`,
      [meta.ticker, from, to],
    )
    for (const row of rows) {
      const value = n(row.value)
      if (value != null) out.set(fmtIso(row.trade_date), value)
    }
    return out
  }

  if (meta.source === "ashare") {
    const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
      `SELECT trade_date, close
       FROM raw_ashare_index_daily
       WHERE ts_code = $1
         AND trade_date >= $2::date
         AND trade_date <= $3::date
         AND close IS NOT NULL
         AND close > 0
       ORDER BY trade_date ASC`,
      [meta.tsCode, from, to],
    )
    for (const row of rows) {
      const value = n(row.close)
      if (value != null) out.set(fmtIso(row.trade_date), value)
    }
    return out
  }

  const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
    `SELECT trade_date, close
     FROM raw_nanhua_indices_daily
     WHERE code = $1
       AND trade_date >= $2::date
       AND trade_date <= $3::date
       AND close IS NOT NULL
       AND close > 0
     ORDER BY trade_date ASC`,
    [meta.code, from, to],
  )
  for (const row of rows) {
    const value = n(row.close)
    if (value != null) out.set(fmtIso(row.trade_date), value)
  }
  return out
}

export function alignBenchmarkToNavDates(
  navDates: string[],
  benchByDate: Map<string, number>,
): Map<string, number> {
  const sortedBenchDates = [...benchByDate.keys()].sort()
  const out = new Map<string, number>()
  if (sortedBenchDates.length === 0) return out

  let benchIdx = 0
  let lastVal: number | null = null

  for (const navDate of navDates) {
    while (benchIdx < sortedBenchDates.length && sortedBenchDates[benchIdx] <= navDate) {
      lastVal = benchByDate.get(sortedBenchDates[benchIdx]) ?? lastVal
      benchIdx++
    }
    if (lastVal != null) out.set(navDate, lastVal)
  }
  return out
}

export async function loadBenchmarkForNavDates(
  key: FofWeeklyBenchmarkKey,
  navDates: string[],
): Promise<Map<string, number>> {
  if (navDates.length === 0) return new Map()
  const from = shiftDate(navDates[0], -90)
  const to = navDates[navDates.length - 1]
  const benchByDate = await loadFofWeeklyBenchmarkPrices(key, from, to)
  return alignBenchmarkToNavDates(navDates, benchByDate)
}
