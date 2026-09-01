import { query, fmtIso, n } from "@/lib/db"
import type { IntervalMetricsRow } from "@/lib/fund-compare-interval-metrics"
import {
  addDays,
  BatchNavResolver,
  computeOneYearRiskMetrics,
  NAV_HISTORY_LOOKBACK_DAYS,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"
import { ensureTrackingFundsListCacheTable } from "@/lib/server/tracking-funds-list-cache-pg"

const BENCHMARKS = {
  IF: { label: "沪深300", source: "spot" as const, symbol: "IF" },
  IC: { label: "中证500", source: "spot" as const, symbol: "IC" },
  IM: { label: "中证1000", source: "spot" as const, symbol: "IM" },
}

type BenchmarkKey = keyof typeof BENCHMARKS

function parseMetric(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const num = typeof v === "number" ? v : parseFloat(String(v).replace(/[%+,]/g, ""))
  return Number.isFinite(num) ? num : null
}

function mean(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function std(values: number[]) {
  if (values.length <= 1) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1))
}

function computeWindowReturn(prices: { date: string; value: number }[], days: number): number | null {
  if (prices.length < 2) return null
  const last = prices.at(-1)!
  const cutoff = new Date(last.date)
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  let base = prices[0]
  for (const p of prices) {
    if (p.date <= cutoffStr) base = p
    else break
  }
  if (base.value <= 0) return null
  return parseFloat((((last.value / base.value) - 1) * 100).toFixed(2))
}

function computeRiskMetrics(prices: { date: string; value: number }[]): { sharpe_1y: number | null; calmar_1y: number | null } {
  if (prices.length < 10) return { sharpe_1y: null, calmar_1y: null }
  const oneYearCutoff = new Date(prices.at(-1)!.date)
  oneYearCutoff.setFullYear(oneYearCutoff.getFullYear() - 1)
  const cutoffStr = oneYearCutoff.toISOString().slice(0, 10)
  const window = prices.filter((p) => p.date >= cutoffStr)
  if (window.length < 10) return { sharpe_1y: null, calmar_1y: null }

  const rets: number[] = []
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1].value
    const curr = window[i].value
    if (prev > 0) rets.push(curr / prev - 1)
  }
  if (rets.length < 2) return { sharpe_1y: null, calmar_1y: null }

  const annReturn = (Math.pow(window.at(-1)!.value / window[0].value, 365 / Math.max(1, (
    (new Date(window.at(-1)!.date).getTime() - new Date(window[0].date).getTime()) / 86_400_000
  ))) - 1) * 100
  const annVol = std(rets) * Math.sqrt(252) * 100
  const sharpe = annVol > 0 ? annReturn / annVol : null

  let peak = window[0].value
  let maxDd = 0
  for (const p of window) {
    if (p.value > peak) peak = p.value
    const dd = peak > 0 ? (peak - p.value) / peak : 0
    if (dd > maxDd) maxDd = dd
  }
  const calmar = maxDd > 0 ? annReturn / (maxDd * 100) : null

  return {
    sharpe_1y: sharpe != null ? parseFloat(sharpe.toFixed(4)) : null,
    calmar_1y: calmar != null ? parseFloat(calmar.toFixed(4)) : null,
  }
}

async function loadBenchmarkPrices(key: BenchmarkKey): Promise<{ date: string; value: number }[]> {
  const meta = BENCHMARKS[key]
  const from = new Date()
  from.setFullYear(from.getFullYear() - 2)
  const fromStr = from.toISOString().slice(0, 10)
  const toStr = new Date().toISOString().slice(0, 10)

  const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
    `SELECT DISTINCT ON (trade_date) trade_date, close
     FROM raw_spot_daily
     WHERE symbol = $1
       AND trade_date >= $2
       AND trade_date <= $3
       AND close IS NOT NULL AND close > 0
     ORDER BY trade_date ASC, fetched_at DESC`,
    [meta.symbol, fromStr, toStr],
  )

  return rows
    .map((row) => ({ date: fmtIso(row.trade_date), value: n(row.close) }))
    .filter((row): row is { date: string; value: number } => row.value != null)
}

function fractionToPct(v: number | null): number | null {
  if (v == null || Number.isNaN(v)) return null
  return parseFloat((v * 100).toFixed(2))
}

function pfiReturnToPct(v: number | null): number | null {
  if (v == null || Number.isNaN(v)) return null
  // private_fund_info sometimes stores fractions (0.02) and sometimes percent points (2.00).
  return Math.abs(v) <= 1 ? fractionToPct(v) : parseFloat(v.toFixed(2))
}

export async function loadFundIntervalMetrics(
  beianHaos: string[],
  nameById?: Map<string, string>,
): Promise<IntervalMetricsRow[]> {
  if (beianHaos.length === 0) return []

  await ensureTrackingFundsListCacheTable()

  const [pfiRows, cacheRows] = await Promise.all([
    query<{
      beian_hao: string
      product_name: string | null
      ret_1w: string | null
      ret_1m: string | null
      ret_3m: string | null
      ret_6m: string | null
      ret_1y: string | null
      sharpe_1y: string | null
      calmar_1y: string | null
      latest_nav_date: string | null
    }>(
      `SELECT
         beian_hao,
         product_name,
         ret_1w::text,
         ret_1m::text,
         ret_3m::text,
         ret_6m::text,
         ret_1y::text,
         sharpe_1y::text,
         calmar_1y::text,
         latest_nav_date::text
       FROM private_fund_info
       WHERE beian_hao = ANY($1::text[])`,
      [beianHaos],
    ).catch(() => []),
    query<{
      beian_hao: string
      product_name: string | null
      short_name: string | null
      ret_1w: string | null
      ret_1m: string | null
      ret_3m: string | null
      ret_6m: string | null
      ret_1y: string | null
      sharpe_1y: string | null
      calmar_1y: string | null
      nav_date: string | null
    }>(
      `SELECT
         beian_hao,
         product_name,
         short_name,
         ret_1w::text,
         ret_1m::text,
         ret_3m::text,
         ret_6m::text,
         ret_1y::text,
         sharpe_1y::text,
         calmar_1y::text,
         nav_date::text
       FROM ops_tracking_funds_list_cache
       WHERE beian_hao = ANY($1::text[])`,
      [beianHaos],
    ).catch(() => []),
  ])

  const pfiById = new Map(pfiRows.map((r) => [r.beian_hao, r]))
  const cacheById = new Map(cacheRows.map((r) => [r.beian_hao, r]))

  const rows: IntervalMetricsRow[] = beianHaos.map((beian_hao) => {
    const cache = cacheById.get(beian_hao)
    const pfi = pfiById.get(beian_hao)
    return {
      key: beian_hao,
      name: nameById?.get(beian_hao) || cache?.product_name || pfi?.product_name || beian_hao,
      isBenchmark: false,
      navFrom: null,
      navTo: (cache?.nav_date ?? pfi?.latest_nav_date)?.slice(0, 10) ?? null,
      metricDate: (cache?.nav_date ?? pfi?.latest_nav_date)?.slice(0, 10) ?? null,
      metrics: {
        ret_1w: fractionToPct(parseMetric(cache?.ret_1w)) ?? pfiReturnToPct(parseMetric(pfi?.ret_1w)),
        ret_1m: fractionToPct(parseMetric(cache?.ret_1m)) ?? pfiReturnToPct(parseMetric(pfi?.ret_1m)),
        ret_3m: fractionToPct(parseMetric(cache?.ret_3m)) ?? pfiReturnToPct(parseMetric(pfi?.ret_3m)),
        ret_6m: fractionToPct(parseMetric(cache?.ret_6m)) ?? pfiReturnToPct(parseMetric(pfi?.ret_6m)),
        ret_1y: fractionToPct(parseMetric(cache?.ret_1y)) ?? pfiReturnToPct(parseMetric(pfi?.ret_1y)),
        sharpe_1y: parseMetric(cache?.sharpe_1y) ?? parseMetric(pfi?.sharpe_1y),
        calmar_1y: parseMetric(cache?.calmar_1y) ?? parseMetric(pfi?.calmar_1y),
      },
    }
  })

  const missing = rows.filter((row) =>
    row.metrics.ret_1w == null
    || row.metrics.ret_1m == null
    || row.metrics.ret_3m == null
    || row.metrics.ret_6m == null
    || row.metrics.ret_1y == null
    || row.metrics.sharpe_1y == null
    || row.metrics.calmar_1y == null
  )
  if (missing.length === 0) return rows

  const asOf = new Date().toISOString().slice(0, 10)
  const identities: ProductNavIdentity[] = missing.map((row) => {
    const cache = cacheById.get(row.key)
    return {
      beian_hao: row.key,
      product_name: nameById?.get(row.key) || cache?.product_name || row.name,
      short_name: cache?.short_name ?? null,
    }
  })
  const resolver = await BatchNavResolver.create(identities, asOf)

  for (let i = 0; i < missing.length; i++) {
    const row = missing[i]
    const identity = identities[i]
    const latest = resolver.resolveAt(identity, asOf)
    if (!latest) continue
    row.navTo = latest.nav_date
    row.metricDate = latest.nav_date
    const returns = resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date)
    if (row.metrics.ret_1w == null) row.metrics.ret_1w = fractionToPct(returns.ret_1w)
    if (row.metrics.ret_1m == null) row.metrics.ret_1m = fractionToPct(returns.ret_1m)
    if (row.metrics.ret_3m == null) row.metrics.ret_3m = fractionToPct(returns.ret_3m)
    if (row.metrics.ret_6m == null) row.metrics.ret_6m = fractionToPct(returns.ret_6m)
    if (row.metrics.ret_1y == null) row.metrics.ret_1y = fractionToPct(returns.ret_1y)
    if (row.metrics.sharpe_1y == null || row.metrics.calmar_1y == null) {
      const risk = computeOneYearRiskMetrics(
        latest.nav_date,
        resolver.mergedHistoryForRiskMetrics(identity, addDays(latest.nav_date, NAV_HISTORY_LOOKBACK_DAYS)),
      )
      if (row.metrics.sharpe_1y == null) row.metrics.sharpe_1y = risk.sharpe_1y
      if (row.metrics.calmar_1y == null) row.metrics.calmar_1y = risk.calmar_1y
    }
  }

  return rows
}

export async function loadBenchmarkIntervalMetrics(key: BenchmarkKey): Promise<IntervalMetricsRow | null> {
  if (!(key in BENCHMARKS)) return null
  const prices = await loadBenchmarkPrices(key)
  if (prices.length === 0) return null

  const risk = computeRiskMetrics(prices)
  const meta = BENCHMARKS[key]

  return {
    key,
    name: meta.label,
    isBenchmark: true,
    navFrom: prices[0]?.date ?? null,
    navTo: prices.at(-1)?.date ?? null,
    metricDate: prices.at(-1)?.date ?? null,
    metrics: {
      ret_1w: computeWindowReturn(prices, 7),
      ret_1m: computeWindowReturn(prices, 30),
      ret_3m: computeWindowReturn(prices, 91),
      ret_6m: computeWindowReturn(prices, 182),
      ret_1y: computeWindowReturn(prices, 365),
      sharpe_1y: risk.sharpe_1y,
      calmar_1y: risk.calmar_1y,
    },
  }
}
