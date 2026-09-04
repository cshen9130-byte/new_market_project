/**
 * Advance 私募基金 list tips on private_fund_info from the same merged NAV
 * the product page uses (email / team / share-class + vendor).
 *
 * Does not write into private_fund_nav — unit NAV series can differ
 * (SBHK26 list 1.3335 vs product page 1.0679).
 */

import { query, queryUnbounded } from "@/lib/db"
import { isPlausibleRiskRatio } from "@/lib/fund-nav-metrics"
import {
  addDays,
  BatchNavResolver,
  calcPeriodReturnsFromHistory,
  clampPgNumeric,
  computeOneYearRiskMetrics,
  NAV_HISTORY_LOOKBACK_DAYS,
  type NavPoint,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"

const RESOLVE_CHUNK = 200
const UPDATE_CHUNK = 100

export type PrivateFundListNavSyncResult = {
  candidates: number
  resolved: number
  updated: number
}

type ListFundRow = {
  beian_hao: string
  product_name: string
  short_name: string | null
  latest_nav: string | null
  latest_nav_date: string | null
}

type ResolvedTip = {
  beian_hao: string
  latest_nav: number
  latest_nav_date: string
  ret_1w: number | null
  ret_1m: number | null
  ret_3m: number | null
  ret_6m: number | null
  ret_1y: number | null
  sharpe_1y: number | null
  calmar_1y: number | null
}

function isoDate(value: string | null | undefined): string | null {
  const d = (value ?? "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

function isStaleListDate(listDate: string | null, sourceDate: string | null): boolean {
  if (!sourceDate) return false
  if (!listDate) return true
  return listDate < sourceDate
}

/** private_fund_info stores period returns as percent (2.05 = +2.05%). */
function fractionToListPct(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return clampPgNumeric(value * 100, 16, 4)
}

async function loadOptionalSourceCodes(): Promise<Array<{ code: string; src_date: string }>> {
  const extra: Array<{ code: string; src_date: string }> = []
  try {
    extra.push(
      ...(await query<{ code: string; src_date: string }>(
        `SELECT UPPER(BTRIM(beian_hao)) AS code, MAX(price_date)::text AS src_date
         FROM private_fund_nav_group_type6
         WHERE beian_hao IS NOT NULL AND BTRIM(beian_hao) <> ''
           AND nav IS NOT NULL AND nav > 0
         GROUP BY 1`,
      )),
    )
  } catch (err) {
    console.warn("[private-fund-list-nav-sync] type6 latest skipped:", err)
  }
  try {
    extra.push(
      ...(await query<{ code: string; src_date: string }>(
        `SELECT UPPER(BTRIM(beian_hao)) AS code, MAX(nav_date)::text AS src_date
         FROM ops_team_nav_manual
         WHERE beian_hao IS NOT NULL AND BTRIM(beian_hao) <> ''
           AND unit_nav IS NOT NULL AND unit_nav > 0
         GROUP BY 1`,
      )),
    )
  } catch (err) {
    console.warn("[private-fund-list-nav-sync] manual team latest skipped:", err)
  }
  return extra
}

export async function findStalePrivateFundListCandidates(): Promise<ListFundRow[]> {
  console.error("[private-fund-list-nav-sync] finding stale list rows…")
  const rows = await queryUnbounded<ListFundRow>(
    `WITH src AS (
       SELECT UPPER(BTRIM(product_code)) AS code, nav_date AS src_date
       FROM (
         SELECT DISTINCT ON (product_code)
           product_code, nav_date
         FROM ops_email_nav_records
         WHERE product_code IS NOT NULL AND BTRIM(product_code) <> ''
           AND nav IS NOT NULL AND nav > 0
         ORDER BY product_code, nav_date DESC
       ) latest
     ),
     keys AS (
       SELECT code AS beian, src_date FROM src
       UNION ALL
       SELECT regexp_replace(code, '^S', ''), src_date FROM src WHERE code LIKE 'S%'
       UNION ALL
       SELECT 'S' || code, src_date FROM src WHERE code NOT LIKE 'S%'
       UNION ALL
       SELECT regexp_replace(code, '[ABC]$', ''), src_date FROM src WHERE code ~ '[ABC]$'
       UNION ALL
       SELECT 'S' || regexp_replace(regexp_replace(code, '^S', ''), '[ABC]$', ''), src_date
       FROM src WHERE code ~ '[ABC]$'
     ),
     best AS (
       SELECT beian, MAX(src_date) AS src_date
       FROM keys
       WHERE beian <> ''
       GROUP BY 1
     )
     SELECT DISTINCT ON (i.beian_hao)
       i.beian_hao,
       i.product_name,
       NULLIF(BTRIM(b.short_name), '') AS short_name,
       i.latest_nav::text AS latest_nav,
       i.latest_nav_date::text AS latest_nav_date
     FROM best s
     JOIN private_fund_info i ON i.beian_hao = s.beian
     LEFT JOIN private_fund_info_bfl b ON b.beian_hao = i.beian_hao
     WHERE i.latest_nav_date IS NULL OR i.latest_nav_date < s.src_date
     ORDER BY i.beian_hao`,
  )

  const extra = await loadOptionalSourceCodes()
  if (extra.length === 0) {
    console.error(`[private-fund-list-nav-sync] candidates=${rows.length}`)
    return rows
  }

  const extraCodes = [...new Set(extra.flatMap((row) => {
    const code = row.code.trim().toUpperCase()
    const noClass = code.replace(/[ABC]$/u, "")
    const withS = noClass.startsWith("S") ? noClass : `S${noClass}`
    const noS = noClass.startsWith("S") ? noClass.slice(1) : noClass
    return [code, noClass, withS, noS].filter(Boolean)
  }))]
  const extraRows = extraCodes.length === 0
    ? []
    : await query<ListFundRow>(
        `SELECT DISTINCT ON (i.beian_hao)
           i.beian_hao,
           i.product_name,
           NULLIF(BTRIM(b.short_name), '') AS short_name,
           i.latest_nav::text AS latest_nav,
           i.latest_nav_date::text AS latest_nav_date
         FROM private_fund_info i
         LEFT JOIN private_fund_info_bfl b ON b.beian_hao = i.beian_hao
         WHERE UPPER(BTRIM(i.beian_hao)) = ANY($1::text[])
         ORDER BY i.beian_hao`,
        [extraCodes],
      )
  const extraDate = new Map<string, string>()
  for (const row of extra) {
    const src = isoDate(row.src_date)
    if (!src) continue
    for (const key of [row.code, row.code.replace(/[ABC]$/u, "")]) {
      const k = key.trim().toUpperCase()
      const prev = extraDate.get(k)
      if (!prev || src > prev) extraDate.set(k, src)
    }
  }
  const seen = new Set(rows.map((r) => r.beian_hao))
  for (const row of extraRows) {
    const src = extraDate.get(row.beian_hao.trim().toUpperCase())
      ?? extraDate.get(row.beian_hao.trim().toUpperCase().replace(/[ABC]$/u, ""))
    if (!isStaleListDate(isoDate(row.latest_nav_date), src)) continue
    if (seen.has(row.beian_hao)) continue
    seen.add(row.beian_hao)
    rows.push(row)
  }
  console.error(`[private-fund-list-nav-sync] candidates=${rows.length}`)
  return rows
}

async function resolveTips(funds: ListFundRow[], asOfDate: string): Promise<ResolvedTip[]> {
  const tips: ResolvedTip[] = []
  for (let start = 0; start < funds.length; start += RESOLVE_CHUNK) {
    const chunk = funds.slice(start, start + RESOLVE_CHUNK)
    const identities: ProductNavIdentity[] = chunk.map((row) => ({
      beian_hao: row.beian_hao,
      product_name: row.product_name,
      short_name: row.short_name,
    }))
    console.error(
      `[private-fund-list-nav-sync] resolving ${start + 1}-${Math.min(start + RESOLVE_CHUNK, funds.length)}/${funds.length}`,
    )
    const resolver = await BatchNavResolver.create(identities, asOfDate)
    for (const row of chunk) {
      const identity = {
        beian_hao: row.beian_hao,
        product_name: row.product_name,
        short_name: row.short_name,
      }
      const latest = resolver.resolveAt(identity, asOfDate)
      if (!latest?.nav_date || !Number.isFinite(latest.nav) || latest.nav <= 0) continue
      if (!isStaleListDate(isoDate(row.latest_nav_date), latest.nav_date)
        && !(isoDate(row.latest_nav_date) === latest.nav_date
          && String(row.latest_nav ?? "") !== String(latest.nav))) {
        continue
      }
      const returns = resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date)
      const risk = computeOneYearRiskMetrics(
        latest.nav_date,
        resolver.mergedHistoryForRiskMetrics(
          identity,
          addDays(latest.nav_date, NAV_HISTORY_LOOKBACK_DAYS),
        ),
      )
      tips.push({
        beian_hao: row.beian_hao,
        latest_nav: latest.nav,
        latest_nav_date: latest.nav_date,
        ret_1w: fractionToListPct(returns.ret_1w),
        ret_1m: fractionToListPct(returns.ret_1m),
        ret_3m: fractionToListPct(returns.ret_3m),
        ret_6m: fractionToListPct(returns.ret_6m),
        ret_1y: fractionToListPct(returns.ret_1y),
        sharpe_1y: isPlausibleRiskRatio(risk.sharpe_1y) ? risk.sharpe_1y : null,
        calmar_1y: isPlausibleRiskRatio(risk.calmar_1y) ? risk.calmar_1y : null,
      })
    }
  }
  return tips
}

async function writeTips(tips: ResolvedTip[]): Promise<number> {
  let updated = 0
  for (let start = 0; start < tips.length; start += UPDATE_CHUNK) {
    const chunk = tips.slice(start, start + UPDATE_CHUNK)
    const rows = await query<{ beian_hao: string }>(
      `UPDATE private_fund_info AS t SET
         latest_nav = u.latest_nav,
         latest_nav_date = u.latest_nav_date,
         ret_1w = u.ret_1w,
         ret_1m = u.ret_1m,
         ret_3m = u.ret_3m,
         ret_6m = u.ret_6m,
         ret_1y = u.ret_1y,
         sharpe_1y = COALESCE(u.sharpe_1y, t.sharpe_1y),
         calmar_1y = COALESCE(u.calmar_1y, t.calmar_1y),
         updated_at = NOW()
       FROM unnest(
         $1::text[],
         $2::numeric[],
         $3::date[],
         $4::numeric[],
         $5::numeric[],
         $6::numeric[],
         $7::numeric[],
         $8::numeric[],
         $9::numeric[],
         $10::numeric[]
       ) AS u(
         beian_hao, latest_nav, latest_nav_date,
         ret_1w, ret_1m, ret_3m, ret_6m, ret_1y, sharpe_1y, calmar_1y
       )
       WHERE t.beian_hao = u.beian_hao
         AND (
           t.latest_nav_date IS NULL
           OR t.latest_nav_date < u.latest_nav_date
           OR (
             t.latest_nav_date = u.latest_nav_date
             AND t.latest_nav IS DISTINCT FROM u.latest_nav
           )
         )
       RETURNING t.beian_hao`,
      [
        chunk.map((tip) => tip.beian_hao),
        chunk.map((tip) => clampPgNumeric(tip.latest_nav, 16, 6)),
        chunk.map((tip) => tip.latest_nav_date),
        chunk.map((tip) => tip.ret_1w),
        chunk.map((tip) => tip.ret_1m),
        chunk.map((tip) => tip.ret_3m),
        chunk.map((tip) => tip.ret_6m),
        chunk.map((tip) => tip.ret_1y),
        chunk.map((tip) => clampPgNumeric(tip.sharpe_1y, 16, 6)),
        chunk.map((tip) => clampPgNumeric(tip.calmar_1y, 16, 6)),
      ],
    )
    updated += rows.length
  }
  return updated
}

/** Nightly / CLI: find stale AMAC list rows and advance them from product-page NAV. */
export async function refreshPrivateFundListNavFromProductPage(
  asOfDate = new Date().toISOString().slice(0, 10),
): Promise<PrivateFundListNavSyncResult> {
  const candidates = await findStalePrivateFundListCandidates()
  if (candidates.length === 0) {
    return { candidates: 0, resolved: 0, updated: 0 }
  }
  const tips = await resolveTips(candidates, asOfDate)
  console.error(`[private-fund-list-nav-sync] writing ${tips.length} tips`)
  const updated = await writeTips(tips)
  return { candidates: candidates.length, resolved: tips.length, updated }
}

function seriesToNavPoints(
  series: Array<{
    price_date?: string
    nav?: string
    cumulative_nav?: string
  }>,
): NavPoint[] {
  const out: NavPoint[] = []
  for (const row of series) {
    const navDate = isoDate(row.price_date)
    const nav = parseFloat(String(row.nav ?? ""))
    if (!navDate || !Number.isFinite(nav) || nav <= 0) continue
    const cum = parseFloat(String(row.cumulative_nav ?? ""))
    const point: NavPoint = { nav, nav_date: navDate }
    if (Number.isFinite(cum) && cum > 0) point.return_nav = cum
    out.push(point)
  }
  return out
}

function tipFromDetailSeries(
  series: Array<{
    price_date?: string
    nav?: string
    cumulative_nav?: string
  }>,
): ResolvedTip | null {
  if (series.length === 0) return null
  const latest = series[series.length - 1]
  const navDate = isoDate(latest.price_date)
  const unitNav = parseFloat(String(latest.nav ?? ""))
  if (!navDate || !Number.isFinite(unitNav) || unitNav <= 0) return null

  const history = seriesToNavPoints(series)
  const returns =
    history.length >= 2
      ? calcPeriodReturnsFromHistory(history, unitNav, navDate)
      : { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null }
  const risk =
    history.length >= 2
      ? computeOneYearRiskMetrics(
          navDate,
          history.filter((p) => p.nav_date >= addDays(navDate, NAV_HISTORY_LOOKBACK_DAYS)),
        )
      : { sharpe_1y: null, calmar_1y: null }

  return {
    beian_hao: "",
    latest_nav: unitNav,
    latest_nav_date: navDate,
    ret_1w: fractionToListPct(returns.ret_1w),
    ret_1m: fractionToListPct(returns.ret_1m),
    ret_3m: fractionToListPct(returns.ret_3m),
    ret_6m: fractionToListPct(returns.ret_6m),
    ret_1y: fractionToListPct(returns.ret_1y),
    sharpe_1y: isPlausibleRiskRatio(risk.sharpe_1y) ? risk.sharpe_1y : null,
    calmar_1y: isPlausibleRiskRatio(risk.calmar_1y) ? risk.calmar_1y : null,
  }
}

/**
 * Write-through from a loaded product-page series. Only advances (or fills null).
 * No-op when the fund is not in private_fund_info.
 */
export async function patchPrivateFundInfoTipFromSeries(opts: {
  product_name: string
  beian_hao?: string | null
  series: Array<{
    price_date?: string
    nav?: string
    cumulative_nav?: string
  }>
}): Promise<boolean> {
  const tip = tipFromDetailSeries(opts.series)
  if (!tip) return false
  const beian = (opts.beian_hao ?? "").trim()
  const productName = opts.product_name.trim()
  if (!beian && !productName) return false

  try {
    const rows = await query<{ beian_hao: string }>(
      `UPDATE private_fund_info AS t SET
         latest_nav = $1,
         latest_nav_date = $2::date,
         ret_1w = $3,
         ret_1m = $4,
         ret_3m = $5,
         ret_6m = $6,
         ret_1y = $7,
         sharpe_1y = COALESCE($8, t.sharpe_1y),
         calmar_1y = COALESCE($9, t.calmar_1y),
         updated_at = NOW()
       WHERE (
           ($10::text IS NOT NULL AND $10 <> '' AND UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($10)))
           OR ($11 <> '' AND product_name = $11)
         )
         AND (
           latest_nav_date IS NULL
           OR latest_nav_date < $2::date
           OR (
             latest_nav_date = $2::date
             AND latest_nav IS DISTINCT FROM $1
           )
         )
       RETURNING beian_hao`,
      [
        clampPgNumeric(tip.latest_nav, 16, 6),
        tip.latest_nav_date,
        tip.ret_1w,
        tip.ret_1m,
        tip.ret_3m,
        tip.ret_6m,
        tip.ret_1y,
        clampPgNumeric(tip.sharpe_1y, 16, 6),
        clampPgNumeric(tip.calmar_1y, 16, 6),
        beian || null,
        productName,
      ],
    )
    return rows.length > 0
  } catch (err) {
    console.warn(
      `[private-fund-list-nav-sync] tip patch failed for ${productName || beian}:`,
      err,
    )
    return false
  }
}
