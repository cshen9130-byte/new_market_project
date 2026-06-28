import { query, fmtIso, n } from "@/lib/db"
import type { IntervalMetricsRow } from "@/lib/fund-compare-interval-metrics"

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

export async function loadFundIntervalMetrics(beianHaos: string[]): Promise<IntervalMetricsRow[]> {
  if (beianHaos.length === 0) return []

  const rows = await query<{
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
  )

  const byId = new Map(rows.map((r) => [r.beian_hao, r]))

  return beianHaos.map((beian_hao) => {
    const row = byId.get(beian_hao)
    return {
      key: beian_hao,
      name: row?.product_name ?? beian_hao,
      isBenchmark: false,
      navFrom: null,
      navTo: row?.latest_nav_date?.slice(0, 10) ?? null,
      metricDate: row?.latest_nav_date?.slice(0, 10) ?? null,
      metrics: {
        ret_1w: parseMetric(row?.ret_1w),
        ret_1m: parseMetric(row?.ret_1m),
        ret_3m: parseMetric(row?.ret_3m),
        ret_6m: parseMetric(row?.ret_6m),
        ret_1y: parseMetric(row?.ret_1y),
        sharpe_1y: parseMetric(row?.sharpe_1y),
        calmar_1y: parseMetric(row?.calmar_1y),
      },
    }
  })
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
