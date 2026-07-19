import { query } from "@/lib/db"
import { calcReturn } from "@/lib/server/list-cache-nav-batch"

export type PostDdReturnItem = {
  row_id: string
  beian_hao?: string
  product_name: string
  dd_date?: string
}

const beianCache = new Map<string, string | null>()
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isIsoDate(value: string | undefined): value is string {
  return Boolean(value && ISO_DATE.test(value))
}

function normalizeProductName(name: string): string {
  return name.trim().split(/[、,，(（]/)[0]?.trim() ?? ""
}

function parseNav(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const nav = parseFloat(raw)
  return Number.isFinite(nav) && nav > 0 ? nav : null
}

/** Fast exact/prefix name → 备案号 lookup (no per-name sequential searches). */
async function resolveBeianHaoBatch(productNames: string[]): Promise<Map<string, string>> {
  const names = [...new Set(productNames.map((name) => normalizeProductName(name)).filter(Boolean))]
  const resolved = new Map<string, string>()
  if (names.length === 0) return resolved

  const uncached: string[] = []
  for (const name of names) {
    const cacheKey = name.toLowerCase()
    if (beianCache.has(cacheKey)) {
      const cached = beianCache.get(cacheKey)
      if (cached) resolved.set(name, cached)
      continue
    }
    uncached.push(name)
  }
  if (uncached.length === 0) return resolved

  const lowerNames = uncached.map((n) => n.toLowerCase())

  const exactRows = await query<{
    lookup_key: string
    beian_hao: string
  }>(
    `SELECT DISTINCT ON (lookup_key) lookup_key, beian_hao
     FROM (
       SELECT lower(BTRIM(product_name)) AS lookup_key, BTRIM(beian_hao) AS beian_hao
       FROM private_fund_info
       WHERE beian_hao IS NOT NULL AND lower(BTRIM(product_name)) = ANY($1::text[])
       UNION ALL
       SELECT lower(BTRIM(product_name)), BTRIM(beian_hao)
       FROM private_fund_info_bfl
       WHERE beian_hao IS NOT NULL AND (
         lower(BTRIM(product_name)) = ANY($1::text[])
         OR lower(BTRIM(COALESCE(short_name, ''))) = ANY($1::text[])
       )
       UNION ALL
       SELECT lower(BTRIM(COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name))),
              BTRIM(register_number)
       FROM type6_ops_team_full
       WHERE register_number IS NOT NULL AND (
         lower(BTRIM(COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name))) = ANY($1::text[])
         OR lower(BTRIM(COALESCE(fund_name, ''))) = ANY($1::text[])
         OR lower(BTRIM(COALESCE(fund_short_name, ''))) = ANY($1::text[])
       )
     ) t
     WHERE beian_hao <> ''
     ORDER BY lookup_key, beian_hao`,
    [lowerNames],
  ).catch((err) => {
    console.error("[due-diligence-table-performance] exact beian resolve", err)
    return []
  })

  for (const row of exactRows) {
    const key = row.lookup_key
    const beian = row.beian_hao.trim()
    if (!key || !beian) continue
    for (const name of uncached) {
      if (name.toLowerCase() === key && !resolved.has(name)) {
        resolved.set(name, beian)
        beianCache.set(name.toLowerCase(), beian)
      }
    }
  }

  const stillMissing = uncached.filter((name) => !resolved.has(name))
  if (stillMissing.length > 0) {
    const prefixRows = await query<{
      input_name: string
      beian_hao: string
    }>(
      `SELECT input_name, beian_hao
       FROM unnest($1::text[]) AS input_name
       CROSS JOIN LATERAL (
         SELECT BTRIM(beian_hao) AS beian_hao
         FROM (
           SELECT beian_hao, product_name FROM private_fund_info
           WHERE beian_hao IS NOT NULL AND product_name ILIKE input_name || '%'
           UNION ALL
           SELECT beian_hao, product_name FROM private_fund_info_bfl
           WHERE beian_hao IS NOT NULL AND (
             product_name ILIKE input_name || '%' OR short_name ILIKE input_name || '%'
           )
           UNION ALL
           SELECT register_number, COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name)
           FROM type6_ops_team_full
           WHERE register_number IS NOT NULL AND (
             fund_name ILIKE input_name || '%' OR fund_short_name ILIKE input_name || '%'
           )
         ) t
         ORDER BY length(product_name) ASC
         LIMIT 1
       ) hit
       WHERE hit.beian_hao IS NOT NULL AND hit.beian_hao <> ''`,
      [stillMissing],
    ).catch((err) => {
      console.error("[due-diligence-table-performance] prefix beian resolve", err)
      return []
    })

    for (const row of prefixRows) {
      const name = row.input_name.trim()
      const beian = row.beian_hao.trim()
      if (!name || !beian || resolved.has(name)) continue
      resolved.set(name, beian)
      beianCache.set(name.toLowerCase(), beian)
    }
  }

  for (const name of uncached) {
    if (!resolved.has(name)) beianCache.set(name.toLowerCase(), null)
  }

  return resolved
}

async function enrichItemsWithBeianHao(items: PostDdReturnItem[]): Promise<PostDdReturnItem[]> {
  const unresolvedNames = items
    .filter((item) => !item.beian_hao?.trim() && item.product_name.trim())
    .map((item) => normalizeProductName(item.product_name))
  const beianByName = await resolveBeianHaoBatch(unresolvedNames)

  return items.map((item) => {
    const beian_hao = item.beian_hao?.trim()
    if (beian_hao) return { ...item, beian_hao }
    const product_name = normalizeProductName(item.product_name)
    const resolved = beianByName.get(product_name)
    return resolved ? { ...item, product_name, beian_hao: resolved } : item
  })
}

/**
 * Load unit/cumulative NAV on-or-before each requested date.
 * Avoids BatchNavResolver's 400-day multi-source history load.
 */
async function loadNavAtOrBeforeBatch(
  requests: Array<{ beian_hao: string; at_date: string }>,
): Promise<Map<string, number>> {
  const unique = new Map<string, { beian_hao: string; at_date: string }>()
  for (const req of requests) {
    const beian = req.beian_hao.trim()
    const at = req.at_date.trim()
    if (!beian || !isIsoDate(at)) continue
    unique.set(`${beian}|${at}`, { beian_hao: beian, at_date: at })
  }
  const pairs = [...unique.values()]
  const out = new Map<string, number>()
  if (pairs.length === 0) return out

  const beians = [...new Set(pairs.map((p) => p.beian_hao))]
  const minDate = pairs.reduce((min, p) => (p.at_date < min ? p.at_date : min), pairs[0].at_date)
  const maxDate = pairs.reduce((max, p) => (p.at_date > max ? p.at_date : max), pairs[0].at_date)

  const rows = await query<{
    beian_hao: string
    at_date: string
    nav: string | null
  }>(
    `WITH req AS (
       SELECT * FROM unnest($1::text[], $2::date[]) AS t(beian_hao, at_date)
     ),
     src AS (
       SELECT BTRIM(beian_hao) AS beian_hao,
              price_date::date AS price_date,
              nav AS level,
              0 AS pri
       FROM private_fund_nav_group_type6
       WHERE BTRIM(beian_hao) = ANY($3::text[])
         AND price_date >= ($4::date - INTERVAL '90 days')
         AND price_date <= $5::date
         AND nav IS NOT NULL AND nav > 0
       UNION ALL
       SELECT BTRIM(beian_hao),
              price_date::date,
              COALESCE(NULLIF(cum_nav_withdrawal, 0), NULLIF(cumulative_nav, 0), NULLIF(nav, 0)),
              1
       FROM private_fund_nav_group
       WHERE BTRIM(beian_hao) = ANY($3::text[])
         AND price_date >= ($4::date - INTERVAL '90 days')
         AND price_date <= $5::date
       UNION ALL
       SELECT BTRIM(beian_hao),
              price_date::date,
              COALESCE(NULLIF(cum_nav_withdrawal, 0), NULLIF(cumulative_nav, 0), NULLIF(nav, 0)),
              2
       FROM private_fund_nav
       WHERE BTRIM(beian_hao) = ANY($3::text[])
         AND price_date >= ($4::date - INTERVAL '90 days')
         AND price_date <= $5::date
     )
     SELECT r.beian_hao, r.at_date::text AS at_date, hit.level::text AS nav
     FROM req r
     CROSS JOIN LATERAL (
       SELECT s.level
       FROM src s
       WHERE s.beian_hao = r.beian_hao
         AND s.price_date <= r.at_date
         AND s.level IS NOT NULL AND s.level > 0
       ORDER BY s.price_date DESC, s.pri ASC
       LIMIT 1
     ) hit`,
    [
      pairs.map((p) => p.beian_hao),
      pairs.map((p) => p.at_date),
      beians,
      minDate,
      maxDate,
    ],
  ).catch(async (err) => {
    console.error("[due-diligence-table-performance] loadNavAtOrBeforeBatch", err)
    return query<{ beian_hao: string; at_date: string; nav: string | null }>(
      `WITH req AS (
         SELECT * FROM unnest($1::text[], $2::date[]) AS t(beian_hao, at_date)
       )
       SELECT r.beian_hao, r.at_date::text AS at_date, hit.nav::text AS nav
       FROM req r
       CROSS JOIN LATERAL (
         SELECT nav
         FROM private_fund_nav_group_type6
         WHERE BTRIM(beian_hao) = r.beian_hao
           AND price_date <= r.at_date
           AND nav IS NOT NULL AND nav > 0
         ORDER BY price_date DESC
         LIMIT 1
       ) hit`,
      [pairs.map((p) => p.beian_hao), pairs.map((p) => p.at_date)],
    ).catch((err2) => {
      console.error("[due-diligence-table-performance] nav type6-only fallback", err2)
      return []
    })
  })

  for (const row of rows) {
    const nav = parseNav(row.nav)
    if (nav == null) continue
    out.set(`${row.beian_hao.trim()}|${row.at_date.slice(0, 10)}`, nav)
  }

  return out
}

export async function computePostDdReturns(
  items: PostDdReturnItem[],
  options?: { periodStart?: string; periodEnd?: string; asOfDate?: string },
): Promise<Record<string, number | null>> {
  const t0 = Date.now()
  const asOfDate = options?.asOfDate ?? new Date().toISOString().slice(0, 10)
  const periodStart = options?.periodStart
  const periodEnd = options?.periodEnd
  const usePeriodRange =
    isIsoDate(periodStart)
    && isIsoDate(periodEnd)
    && periodStart <= periodEnd

  const enrichedItems = await enrichItemsWithBeianHao(items)
  const validItems = enrichedItems.filter((item) => {
    if (!item.row_id.trim() || !item.beian_hao?.trim()) return false
    if (usePeriodRange) return true
    return isIsoDate(item.dd_date)
  })
  if (validItems.length === 0) {
    console.log(`[post-dd-returns] 0 valid of ${items.length} items in ${Date.now() - t0}ms`)
    return {}
  }

  const navRequests: Array<{ beian_hao: string; at_date: string }> = []
  for (const item of validItems) {
    const beian = item.beian_hao!.trim()
    const baseDate = usePeriodRange ? periodStart : item.dd_date!
    let endDate = usePeriodRange ? periodEnd : asOfDate
    if (endDate > asOfDate) endDate = asOfDate
    if (baseDate > endDate) continue
    navRequests.push({ beian_hao: beian, at_date: baseDate })
    navRequests.push({ beian_hao: beian, at_date: endDate })
  }

  const navMap = await loadNavAtOrBeforeBatch(navRequests)
  const out: Record<string, number | null> = {}

  for (const item of validItems) {
    const beian = item.beian_hao!.trim()
    const baseDate = usePeriodRange ? periodStart : item.dd_date!
    let endDate = usePeriodRange ? periodEnd : asOfDate
    if (endDate > asOfDate) endDate = asOfDate
    if (baseDate > endDate) {
      out[item.row_id] = null
      continue
    }
    const baseNav = navMap.get(`${beian}|${baseDate}`) ?? null
    const endNav = navMap.get(`${beian}|${endDate}`) ?? null
    out[item.row_id] = endNav != null ? calcReturn(endNav, baseNav) : null
  }

  console.log(
    `[post-dd-returns] ${validItems.length} products, ${navMap.size} nav points, ${Date.now() - t0}ms`,
  )
  return out
}
