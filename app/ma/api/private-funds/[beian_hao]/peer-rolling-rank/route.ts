import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { resolveRouteFundId } from "@/lib/server/fof-underlying-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const YEARS_BACK = 6

export interface PeerRollingRankPoint {
  date: string
  pct: number
  rank: number
  sample_n: number
  fund_ret: number | null
}

interface PeerCacheEntry {
  ts: number
  // ym -> sorted rolling returns for all peers
  months: Map<string, { sample_n: number; rets: Array<{ id: string; ret: number }> }>
}

declare global {
  // eslint-disable-next-line no-var
  var _peerRollingRankCache: Map<string, PeerCacheEntry> | undefined
}
const peerCache: Map<string, PeerCacheEntry> = global._peerRollingRankCache ?? (global._peerRollingRankCache = new Map())
const PEER_CACHE_TTL = 30 * 60 * 1000

function dateFloor(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - YEARS_BACK - 1)
  return d.toISOString().slice(0, 10)
}

function cacheKey(strat: string, pool: string, windowMonths: number): string {
  return `${pool}:${windowMonths}:${strat}`
}

async function resolveStrategy(beian_hao: string, pool: "company" | "platform"): Promise<string | null> {
  if (pool === "platform") {
    try {
      const rows = await query<{ s: string | null }>(
        `SELECT COALESCE(platform_strategy_one, platform_strategy_two) AS s
         FROM type6_ops_team_full WHERE register_number = $1 LIMIT 1`,
        [beian_hao],
      )
      if (rows[0]?.s) return rows[0].s
    } catch { /* table may not exist */ }
  }
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

async function getPeerIds(strat: string, pool: "company" | "platform"): Promise<string[]> {
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

function ymOffset(ym: string, deltaMonths: number): string {
  const d = new Date(`${ym}-01`)
  d.setMonth(d.getMonth() + deltaMonths)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

async function getStrategyRollingAggregate(
  strat: string,
  pool: "company" | "platform",
  windowMonths: number,
  noCache = false,
): Promise<PeerCacheEntry["months"]> {
  const key = cacheKey(strat, pool, windowMonths)
  const hit = peerCache.get(key)
  if (!noCache && hit && Date.now() - hit.ts < PEER_CACHE_TTL) return hit.months

  const peerIds = await getPeerIds(strat, pool)
  if (!peerIds.length) {
    const empty = new Map<string, { sample_n: number; rets: Array<{ id: string; ret: number }> }>()
    peerCache.set(key, { ts: Date.now(), months: empty })
    return empty
  }

  const floor = dateFloor()
  const rows = await query<{ beian_hao: string; ym: string; nav: string | null }>(
    `WITH month_ends AS (
       SELECT DISTINCT ON (beian_hao, DATE_TRUNC('month', price_date::date))
         beian_hao,
         TO_CHAR(DATE_TRUNC('month', price_date::date), 'YYYY-MM') AS ym,
         cumulative_nav::float AS nav
       FROM private_fund_nav
       WHERE beian_hao = ANY($1) AND price_date >= $2
       ORDER BY beian_hao, DATE_TRUNC('month', price_date::date), price_date DESC
     )
     SELECT beian_hao, ym, nav::text AS nav FROM month_ends WHERE nav IS NOT NULL`,
    [peerIds, floor],
  )

  const byFund = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const nav = parseFloat(r.nav ?? "")
    if (!isFinite(nav) || nav <= 0) continue
    if (!byFund.has(r.beian_hao)) byFund.set(r.beian_hao, new Map())
    byFund.get(r.beian_hao)!.set(r.ym, nav)
  }

  const allYms = new Set<string>()
  for (const fundMap of byFund.values()) {
    for (const ym of fundMap.keys()) allYms.add(ym)
  }
  const sortedYms = [...allYms].sort()

  const months = new Map<string, { sample_n: number; rets: Array<{ id: string; ret: number }> }>()
  for (const ym of sortedYms) {
    const baseYm = ymOffset(ym, -windowMonths)
    const rets: Array<{ id: string; ret: number }> = []
    for (const [id, navMap] of byFund) {
      const endNav = navMap.get(ym)
      const baseNav = navMap.get(baseYm)
      if (endNav === undefined || baseNav === undefined || baseNav <= 0) continue
      rets.push({ id, ret: (endNav / baseNav - 1) * 100 })
    }
    if (rets.length >= 2) {
      months.set(ym, { sample_n: rets.length, rets })
    }
  }

  peerCache.set(key, { ts: Date.now(), months })
  return months
}

async function getFundMonthNav(beian_hao: string): Promise<Map<string, number>> {
  const floor = dateFloor()
  const rows = await query<{ ym: string; nav: string | null }>(
    `WITH month_ends AS (
       SELECT DISTINCT ON (DATE_TRUNC('month', price_date::date))
         TO_CHAR(DATE_TRUNC('month', price_date::date), 'YYYY-MM') AS ym,
         cumulative_nav::float AS nav
       FROM (
         SELECT price_date, cumulative_nav FROM private_fund_nav_group    WHERE beian_hao = $1 AND price_date >= $2
         UNION ALL
         SELECT price_date, cumulative_nav FROM private_fund_nav_group_hy WHERE beian_hao = $1 AND price_date >= $2
         UNION ALL
         SELECT price_date, cumulative_nav FROM private_fund_nav          WHERE beian_hao = $1 AND price_date >= $2
       ) nav_all
       ORDER BY DATE_TRUNC('month', price_date::date), price_date DESC
     )
     SELECT ym, nav::text AS nav FROM month_ends WHERE nav IS NOT NULL`,
    [beian_hao, floor],
  )
  const m = new Map<string, number>()
  for (const r of rows) {
    const nav = parseFloat(r.nav ?? "")
    if (isFinite(nav) && nav > 0) m.set(r.ym, nav)
  }
  return m
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
  const windowMonths = Math.max(1, parseInt(url.searchParams.get("windowMonths") || "12", 10) || 12)
  const noCache = url.searchParams.get("nocache") === "1"
  let strat = url.searchParams.get("strategy") || null

  try {
    if (!strat) strat = await resolveStrategy(beian_hao, pool)
    if (!strat) return NextResponse.json({ strategy: null, pool, windowMonths, points: [] })

    const [agg, fundNav] = await Promise.all([
      getStrategyRollingAggregate(strat, pool, windowMonths, noCache),
      getFundMonthNav(beian_hao),
    ])

    const points: PeerRollingRankPoint[] = []
    for (const [ym, a] of agg) {
      const baseYm = ymOffset(ym, -windowMonths)
      const endNav = fundNav.get(ym)
      const baseNav = fundNav.get(baseYm)
      let fundRet: number | null = null
      let rank: number | null = null
      if (endNav !== undefined && baseNav !== undefined && baseNav > 0) {
        fundRet = (endNav / baseNav - 1) * 100
        let greater = 0
        for (const { ret } of a.rets) if (ret > fundRet) greater++
        rank = greater + 1
      }
      if (rank === null) continue
      points.push({
        date: ym,
        pct: +(((rank - 1) / a.sample_n) * 100).toFixed(2),
        rank,
        sample_n: a.sample_n,
        fund_ret: fundRet !== null ? +fundRet.toFixed(4) : null,
      })
    }
    points.sort((x, y) => x.date.localeCompare(y.date))

    return NextResponse.json({ strategy: strat, pool, windowMonths, points })
  } catch (err) {
    console.error("[peer-rolling-rank] error:", err)
    return NextResponse.json({ error: "Database error", detail: String(err) }, { status: 500 })
  }
}
