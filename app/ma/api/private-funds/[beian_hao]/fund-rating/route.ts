import { NextResponse } from "next/server"
import { fmtIso, n, query } from "@/lib/db"
import { resolveRouteFundId } from "@/lib/server/fof-underlying-query"
import {
  buildDefaultPeriodSpecs,
  computeFundRating,
  deriveRatingModelName,
} from "@/lib/fund-rating"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BENCHMARKS = {
  IH: { label: "上证50", source: "spot", symbol: "IH" },
  IF: { label: "沪深300", source: "spot", symbol: "IF" },
  IC: { label: "中证500", source: "spot", symbol: "IC" },
  IM: { label: "中证1000", source: "spot", symbol: "IM" },
  "511010.SH": { label: "国债ETF", source: "etf", ticker: "511010.SH" },
  "518880.SH": { label: "黄金ETF", source: "etf", ticker: "518880.SH" },
  "NHCI.NH": { label: "南华商品指数", source: "nanhua", code: "NHCI.NH" },
} as const

type BenchmarkKey = keyof typeof BENCHMARKS

const YEARS_BACK = 6

interface PeerCacheEntry {
  ts: number
  peerRowsByFund: Map<string, Array<{ price_date: string; nav: number }>>
}

declare global {
  // eslint-disable-next-line no-var
  var _fundRatingPeerCache: Map<string, PeerCacheEntry> | undefined
}
const peerCache: Map<string, PeerCacheEntry> = global._fundRatingPeerCache ?? (global._fundRatingPeerCache = new Map())
const PEER_CACHE_TTL = 30 * 60 * 1000

function dateFloor(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - YEARS_BACK)
  return d.toISOString().slice(0, 10)
}

async function resolvePlatformStrategy(beian_hao: string): Promise<string | null> {
  try {
    const rows = await query<{ s: string | null }>(
      `SELECT COALESCE(platform_strategy_one, platform_strategy_two) AS s
       FROM type6_ops_team_full WHERE register_number = $1 LIMIT 1`,
      [beian_hao],
    )
    if (rows[0]?.s) return rows[0].s
  } catch { /* table may not exist */ }
  return null
}

async function resolveCompanyStrategy(beian_hao: string): Promise<string | null> {
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

async function getPeerIds(strat: string, pool: "platform" | "company"): Promise<string[]> {
  const seen = new Set<string>()
  if (pool === "platform") {
    try {
      const rows = await query<{ id: string }>(
        `SELECT register_number AS id FROM type6_ops_team_full
         WHERE COALESCE(platform_strategy_one, platform_strategy_two) = $1 AND register_number IS NOT NULL`,
        [strat],
      )
      rows.forEach((r) => r.id && seen.add(r.id))
    } catch { /* table may not exist */ }
  } else {
    for (const sql of [
      `SELECT beian_hao AS id FROM private_fund_info WHERE COALESCE(strategy_l1, strategy_l2) = $1 AND beian_hao IS NOT NULL`,
      `SELECT register_number AS id FROM type6_ops_team_full WHERE COALESCE(company_strategy_one, company_strategy_two) = $1 AND register_number IS NOT NULL`,
    ]) {
      try {
        const rows = await query<{ id: string }>(sql, [strat])
        rows.forEach((r) => r.id && seen.add(r.id))
      } catch { /* table may not exist */ }
    }
  }
  return [...seen]
}

async function getPeerNavByFund(strat: string, pool: "platform" | "company", noCache = false) {
  const cacheKey = `${pool}:${strat}`
  const hit = peerCache.get(cacheKey)
  if (!noCache && hit && Date.now() - hit.ts < PEER_CACHE_TTL) return hit.peerRowsByFund

  const peerIds = await getPeerIds(strat, pool)
  const peerRowsByFund = new Map<string, Array<{ price_date: string; nav: number }>>()
  if (!peerIds.length) {
    peerCache.set(cacheKey, { ts: Date.now(), peerRowsByFund })
    return peerRowsByFund
  }

  const floor = dateFloor()
  const rows = await query<{ beian_hao: string; price_date: string; nav: string | null }>(
    `SELECT beian_hao, price_date::text AS price_date, cumulative_nav::float AS nav
     FROM private_fund_nav
     WHERE beian_hao = ANY($1) AND price_date >= $2
     ORDER BY beian_hao, price_date`,
    [peerIds, floor],
  )

  for (const r of rows) {
    if (r.nav === null) continue
    const v = parseFloat(r.nav)
    if (!isFinite(v) || v <= 0) continue
    if (!peerRowsByFund.has(r.beian_hao)) peerRowsByFund.set(r.beian_hao, [])
    peerRowsByFund.get(r.beian_hao)!.push({ price_date: r.price_date.slice(0, 10), nav: v })
  }

  peerCache.set(cacheKey, { ts: Date.now(), peerRowsByFund })
  return peerRowsByFund
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

async function loadBenchmarkRows(
  key: BenchmarkKey,
  from: string,
  to: string,
): Promise<Array<{ price_date: string; nav: number }>> {
  const meta = BENCHMARKS[key]
  try {
    if (meta.source === "spot") {
      const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
        `SELECT DISTINCT ON (trade_date) trade_date, close
         FROM raw_spot_daily
         WHERE symbol = $1 AND trade_date >= $2 AND trade_date <= $3
           AND close IS NOT NULL AND close > 0
         ORDER BY trade_date ASC, fetched_at DESC`,
        [meta.symbol, from, to],
      )
      return rows
        .map((row) => ({ price_date: fmtIso(row.trade_date), nav: n(row.close) }))
        .filter((row): row is { price_date: string; nav: number } => row.nav !== null)
    }
    if (meta.source === "etf") {
      const rows = await query<{ trade_date: Date | string; value: string | number | null }>(
        `SELECT trade_date, value FROM raw_etf_daily
         WHERE ticker = $1 AND field = 'ORIGINALUNIT'
           AND trade_date >= $2 AND trade_date <= $3 AND value IS NOT NULL AND value > 0
         ORDER BY trade_date ASC`,
        [meta.ticker, from, to],
      )
      return rows
        .map((row) => ({ price_date: fmtIso(row.trade_date), nav: n(row.value) }))
        .filter((row): row is { price_date: string; nav: number } => row.nav !== null)
    }
    if (meta.source === "nanhua") {
      const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
        `SELECT trade_date, close FROM raw_nanhua_indices_daily
         WHERE code = $1 AND trade_date >= $2 AND trade_date <= $3
           AND close IS NOT NULL AND close > 0
         ORDER BY trade_date ASC`,
        [meta.code, from, to],
      )
      return rows
        .map((row) => ({ price_date: fmtIso(row.trade_date), nav: n(row.close) }))
        .filter((row): row is { price_date: string; nav: number } => row.nav !== null)
    }
  } catch { /* tables may not exist */ }
  return []
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  const { beian_hao: rawId } = await params
  const beian_hao = await resolveRouteFundId(rawId)
  if (!beian_hao) return NextResponse.json({ error: "Missing beian_hao" }, { status: 400 })

  const url = new URL(req.url)
  const pool = url.searchParams.get("pool") === "company" ? "company" : "platform"
  const cutoffDate = url.searchParams.get("cutoff") || new Date().toISOString().slice(0, 10)
  const navSource = url.searchParams.get("navSource") === "platform" ? "平台数据" : "团队净值"
  const benchmarkKey = url.searchParams.get("benchmark") as BenchmarkKey | null
  const noCache = url.searchParams.get("nocache") === "1"

  try {
    const [platformStrat, companyStrat] = await Promise.all([
      resolvePlatformStrategy(beian_hao),
      resolveCompanyStrategy(beian_hao),
    ])
    const sampleGroup = pool === "platform" ? platformStrat : companyStrat
    const strat = sampleGroup ?? companyStrat ?? platformStrat
    if (!strat) {
      return NextResponse.json({
        cutoffDate,
        ratingModel: deriveRatingModelName(null),
        sampleGroup: null,
        navSource,
        rows: [],
        analyses: [],
      })
    }

    const [peerRowsByFund, fundRows] = await Promise.all([
      getPeerNavByFund(strat, pool, noCache),
      getFundNavRows(beian_hao),
    ])

    const floor = dateFloor()
    const benchMeta = benchmarkKey && benchmarkKey in BENCHMARKS ? BENCHMARKS[benchmarkKey] : null
    const benchRows = benchMeta
      ? await loadBenchmarkRows(benchmarkKey!, floor, cutoffDate)
      : null

    const result = computeFundRating(fundRows, peerRowsByFund, cutoffDate, {
      ratingModel: deriveRatingModelName(strat),
      sampleGroup: strat,
      navSource,
      benchmarkLabel: benchMeta?.label ?? null,
      benchRows,
      periodSpecs: buildDefaultPeriodSpecs(cutoffDate),
    })

    return NextResponse.json({ strategy: strat, pool, ...result })
  } catch (err) {
    console.error("[fund-rating] error:", err)
    return NextResponse.json({ error: "Database error", detail: String(err) }, { status: 500 })
  }
}
