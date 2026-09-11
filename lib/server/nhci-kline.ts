import type { CtpCandle, CtpTick } from "@/lib/client/ctp-market"
import { NHCI_CODE, NHCI_NAME, NHCI_SYMBOL } from "@/lib/client/nhci-market"
import { aggregateCandles, type TimeframeId } from "@/lib/client/timeframes"
import { query } from "@/lib/db"
import { chinaWallToUnix } from "@/lib/server/sina-fetch"

function num(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toCandle(
  date: string,
  open: number | null,
  high: number | null,
  low: number | null,
  close: number | null,
  volume: number | null,
): CtpCandle | null {
  const time = chinaWallToUnix(`${date} 00:00:00`)
  if (time == null || close == null || !(close > 0)) return null
  const o = open != null && open > 0 ? open : close
  const h = high != null && high > 0 ? high : Math.max(o, close)
  const l = low != null && low > 0 ? low : Math.min(o, close)
  return { time, open: o, high: h, low: l, close, volume: volume ?? 0 }
}

type DailyRow = {
  trade_date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  preclose: number | null
}

async function fetchDailyRows(): Promise<DailyRow[]> {
  try {
    const rows = await query<DailyRow>(
      `SELECT trade_date::text AS trade_date,
              CAST(open AS float8) AS open,
              CAST(high AS float8) AS high,
              CAST(low AS float8) AS low,
              CAST(close AS float8) AS close,
              CAST(COALESCE(volume, 0) AS float8) AS volume,
              CAST(preclose AS float8) AS preclose
         FROM raw_nanhua_indices_daily
        WHERE code = $1
          AND (CAST(close AS float8) > 0 OR CAST(open AS float8) > 0)
        ORDER BY trade_date`,
      [NHCI_CODE],
    )
    if (rows.length) return rows
  } catch {
    // fall through to close-only table
  }
  try {
    return await query<DailyRow>(
      `SELECT trade_date::text AS trade_date,
              CAST(close AS float8) AS open,
              CAST(close AS float8) AS high,
              CAST(close AS float8) AS low,
              CAST(close AS float8) AS close,
              0::float8 AS volume,
              NULL::float8 AS preclose
         FROM raw_nhci_daily
        WHERE close IS NOT NULL AND CAST(close AS float8) > 0
        ORDER BY trade_date`,
    )
  } catch {
    return []
  }
}

function dailyCandles(rows: DailyRow[]) {
  return rows
    .map((row) =>
      toCandle(
        String(row.trade_date).slice(0, 10),
        num(row.open),
        num(row.high),
        num(row.low),
        num(row.close),
        num(row.volume),
      ),
    )
    .filter((c): c is CtpCandle => !!c)
}

const cache = new Map<string, { at: number; data: CtpCandle[] }>()
let quoteCache: { at: number; quote: CtpTick | null } | null = null

export async function getNhciKline(interval: TimeframeId) {
  const key = `${NHCI_SYMBOL}:${interval}`
  const ttl = 60_000
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.data

  const daily = dailyCandles(await fetchDailyRows())
  const data = interval === "1w" || interval === "1M" ? aggregateCandles(daily, interval) : daily
  if (data.length) cache.set(key, { at: Date.now(), data })
  else if (hit?.data.length) return hit.data
  return data
}

export async function getNhciQuote(): Promise<CtpTick | null> {
  if (quoteCache && Date.now() - quoteCache.at < 60_000) return quoteCache.quote
  const rows = await fetchDailyRows()
  const last = rows.at(-1)
  const prev = rows.at(-2)
  if (!last) {
    quoteCache = { at: Date.now(), quote: null }
    return null
  }
  const close = num(last.close)
  const open = num(last.open)
  const high = num(last.high)
  const low = num(last.low)
  const preClose = num(last.preclose) ?? num(prev?.close)
  const quote: CtpTick = {
    symbol: NHCI_SYMBOL,
    last: close,
    bid: null,
    ask: null,
    volume: num(last.volume),
    open_interest: null,
    pre_settlement: preClose,
    pre_close: preClose,
    open: open != null && open > 0 ? open : close,
    high: high != null && high > 0 ? high : close,
    low: low != null && low > 0 ? low : close,
    update_time: null,
    update_millis: 0,
    trade_date: String(last.trade_date).slice(0, 10),
  }
  quoteCache = { at: Date.now(), quote }
  return quote
}

export const NHCI_META = { symbol: NHCI_SYMBOL, code: NHCI_CODE, name: NHCI_NAME }
