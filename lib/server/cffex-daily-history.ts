import type { CtpCandle } from "@/lib/client/ctp-market"
import { query } from "@/lib/db"
import { chinaWallToUnix } from "@/lib/server/sina-fetch"

function num(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function dayUnix(value: unknown) {
  const day = String(value || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return chinaWallToUnix(`${day} 00:00:00`)
}

function candle(
  time: number | null,
  open: number | null,
  high: number | null,
  low: number | null,
  close: number | null,
  volume: number | null,
): CtpCandle | null {
  if (time == null || close == null || !(close > 0)) return null
  const o = open != null && open > 0 ? open : close
  const h = high != null && high > 0 ? high : Math.max(o, close)
  const l = low != null && low > 0 ? low : Math.min(o, close)
  return {
    time,
    open: o,
    high: Math.max(h, o, close),
    low: Math.min(l, o, close),
    close,
    volume: volume != null && volume > 0 ? volume : 0,
  }
}

function productOf(symbol: string) {
  return symbol.toUpperCase().match(/^([A-Z]+)/)?.[1] || symbol.toUpperCase()
}

/** Bars strictly before `newer` stay in front. The listed contract's own prints are unchanged. */
export function prependOlderDaily(older: CtpCandle[], newer: CtpCandle[]): CtpCandle[] {
  if (!newer.length) return older
  if (!older.length) return newer
  const start = newer[0]!.time
  return [...older.filter((bar) => bar.time < start), ...newer]
}

type OhlcRow = {
  trade_date: string
  open: unknown
  high: unknown
  low: unknown
  close: unknown
  volume: unknown
}

function rowsToCandles(rows: OhlcRow[], seen = new Set<number>()) {
  const out: CtpCandle[] = []
  for (const row of rows) {
    const bar = candle(dayUnix(row.trade_date), num(row.open), num(row.high), num(row.low), num(row.close), num(row.volume))
    if (!bar || seen.has(bar.time)) continue
    seen.add(bar.time)
    out.push(bar)
  }
  return out
}

/**
 * Daily bars for a futures contract.
 * The contract's own rows in raw_futures_contracts_daily start at listing
 * (IF2612 is 2026-04-20). Older sessions come from the continuous series:
 * raw_akshare_futures_daily OHLC from 2023, then raw_futures_daily closes before that.
 */
export async function fetchStoredDaily(symbol: string): Promise<CtpCandle[]> {
  const contract = symbol.toUpperCase()
  const product = productOf(contract)
  try {
    const [contractRows, contRows, closeRows] = await Promise.all([
      query<OhlcRow & { contract: string }>(
        `SELECT trade_date::text AS trade_date, contract, open, high, low, close, volume
           FROM public.raw_futures_contracts_daily
          WHERE upper(contract) IN ($1, $1 || '.CFE')
            AND close IS NOT NULL
          ORDER BY trade_date, CASE WHEN upper(contract) = $1 THEN 0 ELSE 1 END`,
        [contract],
      ),
      query<OhlcRow>(
        `SELECT trade_date::text AS trade_date, open, high, low, close, volume
           FROM public.raw_akshare_futures_daily
          WHERE code ILIKE $1 || '0.%'
            AND close IS NOT NULL
          ORDER BY trade_date`,
        [product],
      ),
      query<{ trade_date: string; close: unknown }>(
        `SELECT trade_date::text AS trade_date, close
           FROM public.raw_futures_daily
          WHERE upper(symbol) = $1
            AND upper(ts_code) = $1 || 'L.CFX'
            AND close IS NOT NULL
          ORDER BY trade_date`,
        [product],
      ),
    ])
    const listed = rowsToCandles(contractRows)
    const continuous = rowsToCandles(contRows)
    const closes = rowsToCandles(
      closeRows.map((row) => ({
        trade_date: row.trade_date,
        open: row.close,
        high: row.close,
        low: row.close,
        close: row.close,
        volume: null,
      })),
    )
    return prependOlderDaily(prependOlderDaily(closes, continuous), listed)
  } catch (err) {
    console.error("[cffex-daily] stored history failed", symbol, err)
    return []
  }
}
