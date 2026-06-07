import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import {
  ANNUAL_METRIC_COLUMNS,
  computeFundNavMetrics,
  metricMean,
  metricMedian,
  metricPercentile,
  metricRank,
  type FundNavMetrics,
  type MetricKey,
} from "@/lib/fund-nav-metrics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const YEARS_BACK = 6

type MetricStats = Record<MetricKey, number | null>
type RankStats = Record<MetricKey, number | null>
type PercentileStats = Record<MetricKey, number | null>

export interface PeerYearlyRow {
  year: number
  interval: string
  sample_n: number
  mean: MetricStats
  median: MetricStats
  rank: RankStats
  percentile: PercentileStats
}

interface PeerCacheEntry {
  ts: number
  byYear: Map<number, FundNavMetrics[]>
}

declare global {
  // eslint-disable-next-line no-var
  var _peerYearlyCache: Map<string, PeerCacheEntry> | undefined
}
const peerCache: Map<string, PeerCacheEntry> = global._peerYearlyCache ?? (global._peerYearlyCache = new Map())
const PEER_CACHE_TTL = 30 * 60 * 1000

function dateFloor(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - YEARS_BACK)
  return d.toISOString().slice(0, 10)
}

async function resolveStrategy(beian_hao: string): Promise<string | null> {
  for (const sql of [
    `SELECT COALESCE(strategy_l1, strategy_l2) AS s FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
    `SELECT COALESCE(company_strategy_one, company_strategy_two) AS s FROM type6_ops_team_full WHERE register_number = $1 LIMIT 1`,
  ]) {
    try {
      const rows = await query<{ s: string | null }>(sql, [beian_hao])
      if (rows[0]?.s) return rows[0].s
    } catch { /* table may not exist */ }
  }
  return null
}

async function getPeerIds(strat: string): Promise<string[]> {
  const seen = new Set<string>()
  for (const sql of [
    `SELECT beian_hao       AS id FROM private_fund_info   WHERE COALESCE(strategy_l1, strategy_l2) = $1 AND beian_hao IS NOT NULL`,
    `SELECT register_number AS id FROM type6_ops_team_full WHERE COALESCE(company_strategy_one, company_strategy_two) = $1 AND register_number IS NOT NULL`,
  ]) {
    try {
      const rows = await query<{ id: string }>(sql, [strat])
      rows.forEach((r) => r.id && seen.add(r.id))
    } catch { /* table may not exist */ }
  }
  return [...seen]
}

function groupByYear(
  rows: Array<{ price_date: string; nav: number }>,
): Map<number, { dates: string[]; values: number[] }> {
  const byYear = new Map<number, { dates: string[]; values: number[] }>()
  for (const r of rows) {
    const y = parseInt(r.price_date.slice(0, 4), 10)
    if (!byYear.has(y)) byYear.set(y, { dates: [], values: [] })
    const g = byYear.get(y)!
    g.dates.push(r.price_date)
    g.values.push(r.nav)
  }
  return byYear
}

async function getStrategyYearlyMetrics(strat: string, noCache = false): Promise<Map<number, FundNavMetrics[]>> {
  const hit = peerCache.get(strat)
  if (!noCache && hit && Date.now() - hit.ts < PEER_CACHE_TTL) return hit.byYear

  const peerIds = await getPeerIds(strat)
  const byYear = new Map<number, FundNavMetrics[]>()
  if (!peerIds.length) {
    peerCache.set(strat, { ts: Date.now(), byYear })
    return byYear
  }

  const floor = dateFloor()
  const rows = await query<{ beian_hao: string; price_date: string; nav: string | null }>(
    `SELECT beian_hao, price_date::text AS price_date, cumulative_nav::float AS nav
     FROM private_fund_nav
     WHERE beian_hao = ANY($1) AND price_date >= $2
     ORDER BY beian_hao, price_date`,
    [peerIds, floor],
  )

  const byFund = new Map<string, Array<{ price_date: string; nav: number }>>()
  for (const r of rows) {
    if (r.nav === null) continue
    const v = parseFloat(r.nav)
    if (!isFinite(v) || v <= 0) continue
    if (!byFund.has(r.beian_hao)) byFund.set(r.beian_hao, [])
    byFund.get(r.beian_hao)!.push({ price_date: r.price_date.slice(0, 10), nav: v })
  }

  for (const [, navRows] of byFund) {
    const yearGroups = groupByYear(navRows)
    for (const [year, slice] of yearGroups) {
      const metrics = computeFundNavMetrics(slice)
      if (!metrics) continue
      if (!byYear.has(year)) byYear.set(year, [])
      byYear.get(year)!.push(metrics)
    }
  }

  peerCache.set(strat, { ts: Date.now(), byYear })
  return byYear
}

async function getFundNavRows(beian_hao: string): Promise<Array<{ price_date: string; nav: number }>> {
  const floor = dateFloor()
  const rows = await query<{ price_date: string; nav: string | null }>(
    `SELECT price_date::text AS price_date, cumulative_nav::float AS nav
     FROM (
       SELECT price_date, cumulative_nav FROM private_fund_nav_group    WHERE beian_hao = $1 AND price_date >= $2
       UNION ALL
       SELECT price_date, cumulative_nav FROM private_fund_nav_group_hy WHERE beian_hao = $1 AND price_date >= $2
       UNION ALL
       SELECT price_date, cumulative_nav FROM private_fund_nav          WHERE beian_hao = $1 AND price_date >= $2
     ) nav_all
     ORDER BY price_date`,
    [beian_hao, floor],
  )
  const out: Array<{ price_date: string; nav: number }> = []
  for (const r of rows) {
    if (r.nav === null) continue
    const v = parseFloat(r.nav)
    if (isFinite(v) && v > 0) out.push({ price_date: r.price_date.slice(0, 10), nav: v })
  }
  return out
}

function emptyMetricStats(): MetricStats {
  return {
    periodRet: null,
    annVol: null,
    sharpe: null,
    calmar: null,
    maxDD: null,
    sortino: null,
    downsideRisk: null,
    ddRecoveryDays: null,
    longestNoNewHighDays: null,
  }
}

function aggregatePeerStats(
  year: number,
  interval: string,
  fundMetrics: FundNavMetrics,
  peerMetrics: FundNavMetrics[],
): PeerYearlyRow {
  const mean = emptyMetricStats()
  const median = emptyMetricStats()
  const rank = emptyMetricStats()
  const percentile = emptyMetricStats()

  for (const col of ANNUAL_METRIC_COLUMNS) {
    const key = col.key
    const peers = peerMetrics
      .map((m) => m[key])
      .filter((v): v is number => v !== null && v !== undefined && isFinite(v as number)) as number[]

    if (!peers.length) continue

    mean[key] = +metricMean(peers).toFixed(key === "periodRet" || key === "annVol" || key === "maxDD" || key === "downsideRisk" ? 6 : 4)
    median[key] = +metricMedian(peers).toFixed(key === "periodRet" || key === "annVol" || key === "maxDD" || key === "downsideRisk" ? 6 : 4)

    const fundVal = fundMetrics[key]
    if (fundVal === null || fundVal === undefined || !isFinite(fundVal as number)) continue

    const r = metricRank(fundVal as number, peers, col.higherIsBetter)
    rank[key] = r
    percentile[key] = metricPercentile(r, peers.length)
  }

  return {
    year,
    interval,
    sample_n: peerMetrics.length,
    mean,
    median,
    rank,
    percentile,
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  const { beian_hao } = await params
  if (!beian_hao) return NextResponse.json({ error: "Missing beian_hao" }, { status: 400 })

  const url = new URL(req.url)
  let strat = url.searchParams.get("strategy") || null
  const noCache = url.searchParams.get("nocache") === "1"

  try {
    if (!strat) strat = await resolveStrategy(beian_hao)
    if (!strat) return NextResponse.json({ yearly: [] })

    const [peerByYear, fundNavRows] = await Promise.all([
      getStrategyYearlyMetrics(strat, noCache),
      getFundNavRows(beian_hao),
    ])

    const fundByYear = groupByYear(fundNavRows)
    const yearly: PeerYearlyRow[] = []

    for (const [year, slice] of fundByYear) {
      const fundMetrics = computeFundNavMetrics(slice)
      if (!fundMetrics) continue
      const interval = `${slice.dates[0]} ~ ${slice.dates[slice.dates.length - 1]}`
      const peers = peerByYear.get(year) ?? []
      if (peers.length >= 2) {
        yearly.push(aggregatePeerStats(year, interval, fundMetrics, peers))
      } else {
        yearly.push({
          year,
          interval,
          sample_n: peers.length,
          mean: emptyMetricStats(),
          median: emptyMetricStats(),
          rank: emptyMetricStats(),
          percentile: emptyMetricStats(),
        })
      }
    }

    yearly.sort((a, b) => b.year - a.year)
    return NextResponse.json({ strategy: strat, yearly })
  } catch (err) {
    console.error("[peer-yearly] error:", err)
    return NextResponse.json({ error: "Database error", detail: String(err) }, { status: 500 })
  }
}
