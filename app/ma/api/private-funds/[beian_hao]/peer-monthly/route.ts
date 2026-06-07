import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export interface PeerMonthlyRow {
  ym:         string
  sample_n:   number
  mean_ret:   number
  median_ret: number
  fund_ret:   number | null
  rank_num:   number | null
}

// How many years of history to compute peer stats for (calendar only shows a few).
const YEARS_BACK = 6

// ── Module-level cache for peer aggregate stats, keyed by strategy ──────────────
// The per-strategy aggregate (mean/median/all peer monthly returns) is expensive
// to compute but identical for every fund in the same strategy, so we cache it.
interface PeerCacheEntry {
  ts: number
  // ym -> { sample_n, mean_ret, median_ret, sorted peer returns for ranking }
  months: Map<string, { sample_n: number; mean_ret: number; median_ret: number; rets: number[] }>
}
const _peerCache = new Map<string, PeerCacheEntry>()
const PEER_CACHE_TTL = 30 * 60 * 1000 // 30 min

declare global {
  // eslint-disable-next-line no-var
  var _peerMonthlyCache: Map<string, PeerCacheEntry> | undefined
}
const peerCache: Map<string, PeerCacheEntry> = global._peerMonthlyCache ?? (global._peerMonthlyCache = _peerCache)

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

// Compute (and cache) the per-strategy monthly peer aggregate.
async function getStrategyAggregate(strat: string, noCache = false): Promise<PeerCacheEntry["months"]> {
  const hit = peerCache.get(strat)
  if (!noCache && hit && Date.now() - hit.ts < PEER_CACHE_TTL) return hit.months

  const peerIds = await getPeerIds(strat)
  if (!peerIds.length) {
    const empty = new Map<string, { sample_n: number; mean_ret: number; median_ret: number; rets: number[] }>()
    peerCache.set(strat, { ts: Date.now(), months: empty })
    return empty
  }

  const floor = dateFloor()

  // One row per (fund, ym) = month-over-month return, limited to recent years.
  // Uses the master private_fund_nav table (indexed on beian_hao) for speed — it
  // is the comprehensive series the fund list also relies on.
  const rows = await query<{ beian_hao: string; ym: string; ret: string | null }>(
    `WITH month_ends AS (
       SELECT DISTINCT ON (beian_hao, DATE_TRUNC('month', price_date::date))
         beian_hao,
         TO_CHAR(DATE_TRUNC('month', price_date::date), 'YYYY-MM') AS ym,
         cumulative_nav::float                                       AS nav
       FROM private_fund_nav
       WHERE beian_hao = ANY($1) AND price_date >= $2
       ORDER BY beian_hao, DATE_TRUNC('month', price_date::date), price_date DESC
     )
     SELECT
       c.beian_hao,
       c.ym,
       CASE WHEN p.nav > 0 THEN (c.nav / p.nav - 1.0) * 100.0 END AS ret
     FROM month_ends c
     JOIN month_ends p
       ON p.beian_hao = c.beian_hao
      AND p.ym = TO_CHAR(((c.ym || '-01')::date - INTERVAL '1 month'), 'YYYY-MM')`,
    [peerIds, floor]
  )

  // Aggregate in JS: group returns by ym
  const byMonth = new Map<string, number[]>()
  for (const r of rows) {
    if (r.ret === null) continue
    const v = parseFloat(r.ret)
    if (!isFinite(v)) continue
    if (!byMonth.has(r.ym)) byMonth.set(r.ym, [])
    byMonth.get(r.ym)!.push(v)
  }

  const months = new Map<string, { sample_n: number; mean_ret: number; median_ret: number; rets: number[] }>()
  for (const [ym, rets] of byMonth) {
    if (rets.length < 2) continue
    const sorted = [...rets].sort((a, b) => a - b)
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    months.set(ym, { sample_n: rets.length, mean_ret: mean, median_ret: median, rets: sorted })
  }

  peerCache.set(strat, { ts: Date.now(), months })
  return months
}

// This fund's own monthly returns (small, fast — single fund).
async function getFundMonthly(beian_hao: string): Promise<Map<string, number>> {
  const floor = dateFloor()
  const rows = await query<{ ym: string; ret: string | null }>(
    `WITH month_ends AS (
       SELECT DISTINCT ON (DATE_TRUNC('month', price_date::date))
         TO_CHAR(DATE_TRUNC('month', price_date::date), 'YYYY-MM') AS ym,
         cumulative_nav::float                                       AS nav
       FROM (
         SELECT price_date, cumulative_nav FROM private_fund_nav_group    WHERE beian_hao = $1 AND price_date >= $2
         UNION ALL
         SELECT price_date, cumulative_nav FROM private_fund_nav_group_hy WHERE beian_hao = $1 AND price_date >= $2
         UNION ALL
         SELECT price_date, cumulative_nav FROM private_fund_nav          WHERE beian_hao = $1 AND price_date >= $2
       ) nav_all
       ORDER BY DATE_TRUNC('month', price_date::date), price_date DESC
     )
     SELECT
       c.ym,
       CASE WHEN p.nav > 0 THEN (c.nav / p.nav - 1.0) * 100.0 END AS ret
     FROM month_ends c
     JOIN month_ends p
       ON p.ym = TO_CHAR(((c.ym || '-01')::date - INTERVAL '1 month'), 'YYYY-MM')`,
    [beian_hao, floor]
  )
  const m = new Map<string, number>()
  for (const r of rows) {
    if (r.ret === null) continue
    const v = parseFloat(r.ret)
    if (isFinite(v)) m.set(r.ym, v)
  }
  return m
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> }
) {
  const { beian_hao } = await params
  if (!beian_hao) return NextResponse.json({ error: "Missing beian_hao" }, { status: 400 })

  const url = new URL(req.url)
  let strat = url.searchParams.get("strategy") || null
  const noCache = url.searchParams.get("nocache") === "1"

  try {
    if (!strat) strat = await resolveStrategy(beian_hao)
    if (!strat) return NextResponse.json({ monthly: [] })

    const [agg, fundMonthly] = await Promise.all([
      getStrategyAggregate(strat, noCache),
      getFundMonthly(beian_hao),
    ])

    const monthly: PeerMonthlyRow[] = []
    for (const [ym, a] of agg) {
      const fundRet = fundMonthly.has(ym) ? fundMonthly.get(ym)! : null
      let rank: number | null = null
      if (fundRet !== null) {
        // rank 1 = best (highest return); count peers strictly greater
        let greater = 0
        for (const v of a.rets) if (v > fundRet) greater++
        rank = greater + 1
      }
      monthly.push({
        ym,
        sample_n: a.sample_n,
        mean_ret: +a.mean_ret.toFixed(4),
        median_ret: +a.median_ret.toFixed(4),
        fund_ret: fundRet !== null ? +fundRet.toFixed(4) : null,
        rank_num: rank,
      })
    }
    monthly.sort((x, y) => x.ym.localeCompare(y.ym))

    return NextResponse.json({ strategy: strat, monthly })
  } catch (err) {
    console.error("[peer-monthly] error:", err)
    return NextResponse.json({ error: "Database error", detail: String(err) }, { status: 500 })
  }
}
