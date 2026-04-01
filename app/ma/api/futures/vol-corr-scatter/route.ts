import { NextRequest, NextResponse } from "next/server"
import { fmtIso, n, query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WINDOW_MAP: Record<string, number> = {
  "5d": 5, "10d": 10, "20d": 20, "1m": 22, "6m": 132, "1y": 252, "5y": 1260, "10y": 2520,
}
const DEFAULT_WINDOW = "20d"

type NhciRow = {
  trade_date: string | Date
  close: string | number | null
}

type FuturesRow = {
  trade_date: string | Date
  code: string
  close: string | number | null
}

type RolloverRow = {
  product: string
  rollover_date: string | Date
}

function normalizeAkshareCode(code: string): string {
  return code.split(".")[0]?.replace(/(0|M)$/, "") || code
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return NaN
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function pearson(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) return NaN
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index] - meanB), 0)
  const denominatorA = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0))
  const denominatorB = Math.sqrt(b.reduce((sum, value) => sum + (value - meanB) ** 2, 0))
  return denominatorA === 0 || denominatorB === 0 ? NaN : numerator / (denominatorA * denominatorB)
}

function buildReturnSeries(rows: Array<{ date: string; close: number }>) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const returns: Array<{ date: string; value: number }> = []
  for (let index = 1; index < sorted.length; index++) {
    const prev = sorted[index - 1]
    const curr = sorted[index]
    if (prev.close > 0 && curr.close > 0) {
      returns.push({ date: curr.date, value: curr.close / prev.close - 1 })
    }
  }
  return returns
}

/**
 * Fallback rollover detector using rolling 40-day MAD statistics.
 * Used for products not in raw_futures_rollover_dates (DCE, GFEX).
 *
 * Superior to global 4σ because:
 *  - Threshold adapts to local volatility (high-vol periods raise the bar)
 *  - Minimum 6% floor is above Chinese futures circuit breaker (4–5%),
 *    so genuine extreme market moves are never mistakenly flagged
 *  - K=12 × MAD is far more selective than 4σ for isolated spike detection
 */
function detectRolloverDatesFallback(
  returns: Array<{ date: string; value: number }>,
): Set<string> {
  if (returns.length < 20) return new Set()
  const values = returns.map((r) => r.value)
  const MIN_THRESHOLD = 0.06   // 6% floor — above circuit breaker limits
  const K = 12                 // MAD multiplier (very selective)
  const LOOKBACK = 40          // rolling window length
  const flagged = new Set<string>()

  for (let i = LOOKBACK; i < values.length; i++) {
    const window = values.slice(i - LOOKBACK, i)
    // MAD of absolute returns in the rolling window
    const absWindow = window.map(Math.abs).sort((a, b) => a - b)
    const medianAbs = absWindow[Math.floor(absWindow.length / 2)]
    const deviations = absWindow.map((v) => Math.abs(v - medianAbs)).sort((a, b) => a - b)
    const mad = deviations[Math.floor(deviations.length / 2)]
    // 1.4826 makes MAD consistent with σ under normality
    const threshold = Math.max(MIN_THRESHOLD, medianAbs + K * mad * 1.4826)
    if (Math.abs(values[i]) > threshold) {
      flagged.add(returns[i].date)
    }
  }
  return flagged
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const volKey =
      (searchParams.get("volWindow") ?? DEFAULT_WINDOW) in WINDOW_MAP
        ? (searchParams.get("volWindow") as string)
        : DEFAULT_WINDOW
    const corrKey =
      (searchParams.get("corrWindow") ?? DEFAULT_WINDOW) in WINDOW_MAP
        ? (searchParams.get("corrWindow") as string)
        : DEFAULT_WINDOW
    const volWin = WINDOW_MAP[volKey]
    const corrWin = WINDOW_MAP[corrKey]
    const maxWin = Math.max(volWin, corrWin)
    const lookbackDays = Math.ceil(maxWin * 2) + 60

    const since = new Date()
    since.setDate(since.getDate() - lookbackDays)
    const sinceIso = since.toISOString().slice(0, 10)

    // Fetch benchmark, futures prices, and DB-sourced rollover dates in parallel
    const [benchmarkRows, futuresRows, rolloverRows] = await Promise.all([
      query<NhciRow>(
        `SELECT trade_date, close
         FROM raw_nhci_daily
         WHERE trade_date >= $1
           AND close IS NOT NULL AND close > 0
         ORDER BY trade_date ASC`,
        [sinceIso],
      ),
      query<FuturesRow>(
        `SELECT trade_date, code, close
         FROM raw_akshare_futures_daily
         WHERE trade_date >= $1
           AND close IS NOT NULL AND close > 0
         ORDER BY code ASC, trade_date ASC`,
        [sinceIso],
      ),
      // Load rollover dates from the nightly-ETL table.
      // raw_futures_rollover_dates is populated by fetch_futures_rollover_dates.py
      // which tracks the dominant-OI contract per product per day.
      // Products not in this table (e.g. GFEX) fall back to the 4σ heuristic.
      query<RolloverRow>(
        `SELECT product, rollover_date
         FROM raw_futures_rollover_dates
         WHERE rollover_date >= $1
         ORDER BY product, rollover_date ASC`,
        [sinceIso],
      ).catch(() => [] as RolloverRow[]), // graceful: table may not exist yet on first deploy
    ])

    // Build Map<product, Set<isoDate>> of DB-sourced rollover dates
    const dbRolloverMap = new Map<string, Set<string>>()
    for (const row of rolloverRows) {
      const product = (row.product ?? "").toUpperCase()
      const dateStr = fmtIso(row.rollover_date)
      if (!product || !dateStr) continue
      if (!dbRolloverMap.has(product)) dbRolloverMap.set(product, new Set())
      dbRolloverMap.get(product)!.add(dateStr)
    }

    const benchmarkSeries = benchmarkRows
      .map((row) => ({ date: fmtIso(row.trade_date), close: n(row.close) }))
      .filter((row): row is { date: string; close: number } => row.close != null)

    const benchmarkReturns = buildReturnSeries(benchmarkSeries)
    const benchmarkReturnMap = new Map(benchmarkReturns.map((row) => [row.date, row.value]))

    if (benchmarkReturns.length < Math.max(volWin, corrWin)) {
      return NextResponse.json({ error: "Benchmark data not available" }, { status: 404 })
    }

    const grouped = new Map<string, Array<{ date: string; close: number }>>()
    for (const row of futuresRows) {
      const close = n(row.close)
      if (close == null) continue
      const product = normalizeAkshareCode(row.code)
      if (!grouped.has(product)) grouped.set(product, [])
      grouped.get(product)?.push({ date: fmtIso(row.trade_date), close })
    }

    const points = Array.from(grouped.entries())
      .map(([code, rows]) => {
        const returns = buildReturnSeries(rows)
        if (returns.length < Math.max(volWin, corrWin)) return null

        // Choose rollover dates:
        //  1. DB table (from OI-dominant-contract tracking via AkShare) — preferred,
        //     avoids false positives on genuine large market moves.
        //  2. 4σ heuristic fallback — used for GFEX products and any product whose
        //     rollover dates haven't been fetched yet (e.g. right after first deploy).
        let rolloverDates: Set<string>
        let rolloverSource: "db" | "heuristic"
        if (dbRolloverMap.has(code)) {
          rolloverDates = dbRolloverMap.get(code)!
          rolloverSource = "db"
        } else {
          rolloverDates = detectRolloverDatesFallback(returns)
          rolloverSource = "heuristic"
        }

        const cleanReturns =
          rolloverDates.size > 0
            ? returns.filter((r) => !rolloverDates.has(r.date))
            : returns

        if (cleanReturns.length < Math.max(volWin, corrWin)) return null

        const latestVolWindow = cleanReturns.slice(-volWin)
        const volatility = standardDeviation(latestVolWindow.map((row) => row.value)) * 100

        const returnMap = new Map(cleanReturns.map((row) => [row.date, row.value]))
        const overlapDates = cleanReturns
          .map((row) => row.date)
          .filter((date) => benchmarkReturnMap.has(date))
          .slice(-corrWin)

        if (overlapDates.length < corrWin) return null

        const productWindow = overlapDates.map((date) => returnMap.get(date) as number)
        const benchmarkWindow = overlapDates.map(
          (date) => benchmarkReturnMap.get(date) as number,
        )
        const correlation = pearson(productWindow, benchmarkWindow)

        if (!Number.isFinite(volatility) || !Number.isFinite(correlation)) return null

        return {
          code,
          label: code,
          volatility: +volatility.toFixed(4),
          correlation: +correlation.toFixed(4),
          observations: overlapDates.length,
          rollover_excluded: rolloverDates.size,
          rollover_source: rolloverSource,
          latest_date: overlapDates[overlapDates.length - 1],
        }
      })
      .filter((point): point is NonNullable<typeof point> => point != null)
      .sort((a, b) => b.volatility - a.volatility)

    if (!points.length) {
      return NextResponse.json({ error: "No data" }, { status: 404 })
    }

    return NextResponse.json({
      as_of: points.reduce(
        (latest, point) =>
          point.latest_date > latest ? point.latest_date : latest,
        points[0].latest_date,
      ),
      volWindow: volKey,
      corrWindow: corrKey,
      benchmark: "南华商品指数",
      points,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}