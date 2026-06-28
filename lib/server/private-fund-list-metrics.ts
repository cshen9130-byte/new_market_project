import { query } from "@/lib/db"
import {
  addDays,
  computeOneYearRiskMetrics,
  type NavPoint,
} from "@/lib/server/list-cache-nav-batch"

export type FundListMetricsRow = {
  beian_hao: string
  latest_nav: string | null
  latest_nav_date: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
}

const RETURN_WINDOWS = [
  { key: "ret_1w" as const, days: 7 },
  { key: "ret_1m" as const, days: 30 },
  { key: "ret_3m" as const, days: 90 },
  { key: "ret_6m" as const, days: 180 },
  { key: "ret_1y" as const, days: 365 },
]

const NAV_LOOKBACK_DAYS = 400

function metricText(v: unknown): string | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : parseFloat(String(v))
  return Number.isFinite(n) ? String(n) : null
}

function pctReturnText(current: number, base: number | null): string | null {
  if (base == null || !Number.isFinite(base) || base <= 0 || !Number.isFinite(current)) return null
  return String(Math.round((current / base - 1) * 10000) / 100)
}

function navAtOrBefore(history: NavPoint[], beforeDate: string): number | null {
  let result: number | null = null
  for (const point of history) {
    if (point.nav_date > beforeDate) break
    result = point.nav
  }
  return result
}

function asOfDateForRow(row: FundListMetricsRow, cutoffDate: string | null): string {
  const today = new Date().toISOString().slice(0, 10)
  if (cutoffDate && cutoffDate < today) return cutoffDate
  return row.latest_nav_date?.slice(0, 10) ?? cutoffDate ?? today
}

async function fetchHistoricalNavMap(
  beianHaos: string[],
  cutoffDate: string,
): Promise<Map<string, { nav: string; price_date: string }>> {
  if (beianHaos.length === 0) return new Map()

  const rows = await query<{ beian_hao: string; nav: string; price_date: string }>(
    `SELECT DISTINCT ON (beian_hao)
       beian_hao,
       nav::text AS nav,
       price_date::text AS price_date
     FROM private_fund_nav
     WHERE beian_hao = ANY($1::text[])
       AND price_date <= $2::date
       AND nav IS NOT NULL AND nav > 0
     ORDER BY beian_hao, price_date DESC`,
    [beianHaos, cutoffDate],
  )

  return new Map(rows.map((r) => [r.beian_hao, { nav: r.nav, price_date: r.price_date }]))
}

async function loadNavHistoryBatch(
  beianHaos: string[],
  minSinceDate: string,
): Promise<Map<string, NavPoint[]>> {
  if (beianHaos.length === 0) return new Map()

  const rows = await query<{ beian_hao: string; nav_date: string; nav: string }>(
    `SELECT beian_hao,
            price_date::text AS nav_date,
            nav::text AS nav
     FROM private_fund_nav
     WHERE beian_hao = ANY($1::text[])
       AND price_date >= $2::date
       AND nav IS NOT NULL
       AND nav > 0
     ORDER BY beian_hao ASC, price_date ASC`,
    [beianHaos, minSinceDate],
  )

  const out = new Map<string, NavPoint[]>()
  for (const row of rows) {
    const nav = parseFloat(row.nav)
    if (!Number.isFinite(nav) || nav <= 0) continue
    const point: NavPoint = { nav_date: row.nav_date.slice(0, 10), nav }
    const list = out.get(row.beian_hao)
    if (list) list.push(point)
    else out.set(row.beian_hao, [point])
  }
  return out
}

function rowMissingOneYearMetrics(row: FundListMetricsRow): boolean {
  return !metricText(row.ret_1y) || !metricText(row.sharpe_1y) || !metricText(row.calmar_1y)
}

function enrichRowFromNavHistory<T extends FundListMetricsRow>(
  row: T,
  history: NavPoint[],
  asOfDate: string,
  opts: {
    historical: boolean
    latest_nav?: string | null
    latest_nav_date?: string | null
  },
): T {
  const latest_nav = opts.historical ? (opts.latest_nav ?? null) : row.latest_nav
  const latest_nav_date = opts.historical ? (opts.latest_nav_date ?? null) : row.latest_nav_date
  const currentNav = latest_nav != null ? parseFloat(latest_nav) : NaN

  const next: T = opts.historical
    ? {
        ...row,
        latest_nav,
        latest_nav_date,
        ret_1w: null,
        ret_1m: null,
        ret_3m: null,
        ret_6m: null,
        ret_1y: null,
        sharpe_1y: null,
        calmar_1y: null,
      }
    : {
        ...row,
        ret_1w: metricText(row.ret_1w),
        ret_1m: metricText(row.ret_1m),
        ret_3m: metricText(row.ret_3m),
        ret_6m: metricText(row.ret_6m),
        ret_1y: metricText(row.ret_1y),
        sharpe_1y: metricText(row.sharpe_1y),
        calmar_1y: metricText(row.calmar_1y),
      }

  if (!Number.isFinite(currentNav) || currentNav <= 0 || history.length === 0) {
    return next
  }

  for (const { key, days } of RETURN_WINDOWS) {
    if (!opts.historical && key !== "ret_1y" && next[key] != null) continue
    const baseNav = navAtOrBefore(history, addDays(asOfDate, days))
    const computed = pctReturnText(currentNav, baseNav)
    if (computed != null) next[key] = computed
  }

  const needsSharpe = opts.historical || next.sharpe_1y == null
  const needsCalmar = opts.historical || next.calmar_1y == null
  if (needsSharpe || needsCalmar) {
    const risk = computeOneYearRiskMetrics(asOfDate, history)
    if (needsSharpe && risk.sharpe_1y != null) next.sharpe_1y = String(risk.sharpe_1y)
    if (needsCalmar && risk.calmar_1y != null) next.calmar_1y = String(risk.calmar_1y)
  }

  return next
}

/** Fill NAV / return / risk metrics, honoring an optional historical cutoff date. */
export async function enrichPrivateFundListMetrics<T extends FundListMetricsRow>(
  rows: T[],
  cutoffDate: string | null,
): Promise<T[]> {
  if (rows.length === 0) return rows

  const today = new Date().toISOString().slice(0, 10)
  const historical = Boolean(cutoffDate && cutoffDate < today)

  if (!historical) {
    const normalized = rows.map((row) => ({
      ...row,
      ret_1w: metricText(row.ret_1w),
      ret_1m: metricText(row.ret_1m),
      ret_3m: metricText(row.ret_3m),
      ret_6m: metricText(row.ret_6m),
      ret_1y: metricText(row.ret_1y),
      sharpe_1y: metricText(row.sharpe_1y),
      calmar_1y: metricText(row.calmar_1y),
    }))
    const rowsNeedingNav = normalized.filter(rowMissingOneYearMetrics)
    if (rowsNeedingNav.length === 0) return normalized

    const asOfByBeian = new Map(
      rowsNeedingNav.map((row) => [row.beian_hao, asOfDateForRow(row, cutoffDate)]),
    )
    const minSinceDate = [...asOfByBeian.values()]
      .map((date) => addDays(date, NAV_LOOKBACK_DAYS))
      .sort()[0]
    const historyByBeian = await loadNavHistoryBatch(
      rowsNeedingNav.map((row) => row.beian_hao),
      minSinceDate,
    )

    return normalized.map((row) => {
      if (!rowMissingOneYearMetrics(row)) return row
      const asOfDate = asOfByBeian.get(row.beian_hao) ?? asOfDateForRow(row, cutoffDate)
      const fullHistory = historyByBeian.get(row.beian_hao) ?? []
      const sinceDate = addDays(asOfDate, NAV_LOOKBACK_DAYS)
      const history = fullHistory.filter((point) => point.nav_date >= sinceDate)
      return enrichRowFromNavHistory(row, history, asOfDate, { historical: false })
    })
  }

  const asOfByBeian = new Map(
    rows.map((row) => [row.beian_hao, asOfDateForRow(row, cutoffDate)]),
  )
  const minSinceDate = [...asOfByBeian.values()]
    .map((date) => addDays(date, NAV_LOOKBACK_DAYS))
    .sort()[0]

  const [navAtCutoff, historyByBeian] = await Promise.all([
    fetchHistoricalNavMap(rows.map((row) => row.beian_hao), cutoffDate!),
    loadNavHistoryBatch(rows.map((row) => row.beian_hao), minSinceDate),
  ])

  return rows.map((row) => {
    const asOfDate = asOfByBeian.get(row.beian_hao) ?? asOfDateForRow(row, cutoffDate)
    const cutoffNav = navAtCutoff.get(row.beian_hao)
    const fullHistory = historyByBeian.get(row.beian_hao) ?? []
    const sinceDate = addDays(asOfDate, NAV_LOOKBACK_DAYS)
    const history = fullHistory.filter((point) => point.nav_date >= sinceDate)
    return enrichRowFromNavHistory(row, history, asOfDate, {
      historical: true,
      latest_nav: cutoffNav?.nav ?? null,
      latest_nav_date: cutoffNav?.price_date ?? null,
    })
  })
}
