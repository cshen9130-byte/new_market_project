import { query } from "@/lib/db"
import { fundNameCore } from "@/lib/server/fund-picker-search"
import { sqlFundNameMatch } from "@/lib/server/fund-name-match"
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

/** Normalize Chinese digits so 一号 ≈ 1号 for matching. */
function normalizeChineseDigits(name: string): string {
  return name
    .replace(/十/g, "10")
    .replace(/一/g, "1")
    .replace(/二/g, "2")
    .replace(/三/g, "3")
    .replace(/四/g, "4")
    .replace(/五/g, "5")
    .replace(/六/g, "6")
    .replace(/七/g, "7")
    .replace(/八/g, "8")
    .replace(/九/g, "9")
}

function nameVariants(name: string): string[] {
  const base = normalizeProductName(name)
  if (!base) return []
  const core = fundNameCore(base)
  const out = new Set<string>()
  for (const candidate of [base, core, normalizeChineseDigits(base), normalizeChineseDigits(core)]) {
    const s = candidate.trim()
    if (s) out.add(s)
  }
  return [...out]
}

function parseNav(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const nav = parseFloat(raw)
  return Number.isFinite(nav) && nav > 0 ? nav : null
}

/**
 * Resolve product display names → 备案号.
 * Handles short names (务扬赤壁一号) vs full names (务扬赤壁1号私募证券投资基金).
 */
async function resolveBeianHaoBatch(productNames: string[]): Promise<Map<string, string>> {
  const names = [...new Set(productNames.map((name) => normalizeProductName(name)).filter(Boolean))]
  const resolved = new Map<string, string>()
  if (names.length === 0) return resolved

  const uncached: string[] = []
  for (const name of names) {
    const cacheKey = name.toLowerCase()
    const cached = beianCache.get(cacheKey)
    if (cached) {
      resolved.set(name, cached)
      continue
    }
    uncached.push(name)
  }
  if (uncached.length === 0) return resolved

  // Flatten to (input_name, variant) so 务扬赤壁一号 also tries 务扬赤壁1号.
  const pairs: Array<{ input_name: string; variant: string }> = []
  for (const name of uncached) {
    for (const variant of nameVariants(name)) {
      pairs.push({ input_name: name, variant })
    }
  }
  if (pairs.length === 0) return resolved

  const rows = await query<{
    input_name: string
    beian_hao: string
    product_name: string
  }>(
    `SELECT DISTINCT ON (input_name)
        input_name,
        beian_hao,
        product_name
     FROM (
       SELECT p.input_name,
              BTRIM(t.beian_hao) AS beian_hao,
              t.product_name,
              CASE
                WHEN lower(BTRIM(t.product_name)) = lower(p.variant) THEN 0
                WHEN t.product_name ILIKE p.variant || '%' THEN 1
                WHEN t.product_name ILIKE '%' || p.variant || '%' THEN 2
                ELSE 3
              END AS score,
              length(t.product_name) AS name_len
       FROM unnest($1::text[], $2::text[]) AS p(input_name, variant)
       JOIN (
         SELECT beian_hao, product_name FROM private_fund_info
         WHERE beian_hao IS NOT NULL AND product_name IS NOT NULL
         UNION ALL
         SELECT beian_hao, product_name FROM private_fund_info_bfl
         WHERE beian_hao IS NOT NULL AND product_name IS NOT NULL
         UNION ALL
         SELECT beian_hao, short_name FROM private_fund_info_bfl
         WHERE beian_hao IS NOT NULL AND short_name IS NOT NULL
         UNION ALL
         SELECT register_number, COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name)
         FROM type6_ops_team_full
         WHERE register_number IS NOT NULL
         UNION ALL
         SELECT register_number, fund_name
         FROM type6_ops_team_full
         WHERE register_number IS NOT NULL AND fund_name IS NOT NULL
       ) t ON (
         ${sqlFundNameMatch("t.product_name", "p.variant")}
         OR t.product_name ILIKE p.variant || '%'
         OR replace(replace(replace(replace(replace(
              replace(replace(replace(replace(replace(
                regexp_replace(BTRIM(t.product_name), '(私募证券投资基金|私募基金|证券投资基金|投资基金)$', ''),
                '一','1'),'二','2'),'三','3'),'四','4'),'五','5'),
              '六','6'),'七','7'),'八','8'),'九','9'),'十','10')
            ILIKE p.variant || '%'
         OR replace(replace(replace(replace(replace(
              replace(replace(replace(replace(replace(
                regexp_replace(BTRIM(t.product_name), '(私募证券投资基金|私募基金|证券投资基金|投资基金)$', ''),
                '一','1'),'二','2'),'三','3'),'四','4'),'五','5'),
              '六','6'),'七','7'),'八','8'),'九','9'),'十','10')
            = p.variant
       )
     ) matched
     WHERE beian_hao <> ''
     ORDER BY input_name, score ASC, name_len ASC`,
    [pairs.map((p) => p.input_name), pairs.map((p) => p.variant)],
  ).catch((err) => {
    console.error("[due-diligence-table-performance] resolveBeianHaoBatch", err)
    return []
  })

  for (const row of rows) {
    const name = row.input_name.trim()
    const beian = row.beian_hao.trim()
    if (!name || !beian || resolved.has(name)) continue
    resolved.set(name, beian)
    beianCache.set(name.toLowerCase(), beian)
  }

  // Do not cache misses — product databases change and short-name matching improves over time.
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
    return resolved
      ? { ...item, product_name, beian_hao: resolved }
      : { ...item, product_name }
  })
}

type NavRequest = {
  key: string
  beian_hao: string
  product_name: string
  at_date: string
}

/**
 * Load NAV on-or-before each requested date from type6 / legacy / email sources.
 * Matches by 备案号 and by product name (with 一号↔1号 normalization).
 */
async function loadNavAtOrBeforeBatch(requests: NavRequest[]): Promise<Map<string, number>> {
  const unique = new Map<string, NavRequest>()
  for (const req of requests) {
    if (!req.key || !isIsoDate(req.at_date)) continue
    if (!req.beian_hao.trim() && !req.product_name.trim()) continue
    unique.set(req.key, req)
  }
  const pairs = [...unique.values()]
  const out = new Map<string, number>()
  if (pairs.length === 0) return out

  const beians = [...new Set(pairs.map((p) => p.beian_hao.trim()).filter(Boolean))]
  const names = [...new Set(pairs.flatMap((p) => nameVariants(p.product_name)))]
  const minDate = pairs.reduce((min, p) => (p.at_date < min ? p.at_date : min), pairs[0].at_date)
  const maxDate = pairs.reduce((max, p) => (p.at_date > max ? p.at_date : max), pairs[0].at_date)

  const platformRows = await query<{
    req_key: string
    nav: string | null
  }>(
    `WITH req AS (
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::date[])
         AS t(req_key, beian_hao, product_name, at_date)
     ),
     src AS (
       SELECT BTRIM(beian_hao) AS beian_hao,
              BTRIM(product_name) AS product_name,
              price_date::date AS price_date,
              nav AS level,
              0 AS pri
       FROM private_fund_nav_group_type6
       WHERE price_date >= ($5::date - INTERVAL '400 days')
         AND price_date <= $6::date
         AND nav IS NOT NULL AND nav > 0
         AND (
           (cardinality($7::text[]) > 0 AND BTRIM(beian_hao) = ANY($7::text[]))
           OR (cardinality($8::text[]) > 0 AND (
             product_name = ANY($8::text[])
             OR product_name ILIKE ANY(SELECT v || '%' FROM unnest($8::text[]) v)
           ))
         )
       UNION ALL
       SELECT BTRIM(beian_hao),
              BTRIM(product_name),
              price_date::date,
              COALESCE(NULLIF(cum_nav_withdrawal, 0), NULLIF(cumulative_nav, 0), NULLIF(nav, 0)),
              1
       FROM private_fund_nav_group
       WHERE price_date >= ($5::date - INTERVAL '400 days')
         AND price_date <= $6::date
         AND (
           (cardinality($7::text[]) > 0 AND BTRIM(beian_hao) = ANY($7::text[]))
           OR (cardinality($8::text[]) > 0 AND (
             product_name = ANY($8::text[])
             OR product_name ILIKE ANY(SELECT v || '%' FROM unnest($8::text[]) v)
           ))
         )
       UNION ALL
       SELECT BTRIM(beian_hao),
              BTRIM(product_name),
              price_date::date,
              COALESCE(NULLIF(cum_nav_withdrawal, 0), NULLIF(cumulative_nav, 0), NULLIF(nav, 0)),
              2
       FROM private_fund_nav
       WHERE price_date >= ($5::date - INTERVAL '400 days')
         AND price_date <= $6::date
         AND (
           (cardinality($7::text[]) > 0 AND BTRIM(beian_hao) = ANY($7::text[]))
           OR (cardinality($8::text[]) > 0 AND (
             product_name = ANY($8::text[])
             OR product_name ILIKE ANY(SELECT v || '%' FROM unnest($8::text[]) v)
           ))
         )
     )
     SELECT r.req_key, hit.level::text AS nav
     FROM req r
     CROSS JOIN LATERAL (
       SELECT s.level
       FROM src s
       WHERE s.price_date <= r.at_date
         AND s.level IS NOT NULL AND s.level > 0
         AND (
           (r.beian_hao <> '' AND s.beian_hao = r.beian_hao)
           OR (r.product_name <> '' AND (
             s.product_name = r.product_name
             OR s.product_name ILIKE r.product_name || '%'
             OR replace(replace(replace(replace(replace(
                  replace(replace(replace(replace(replace(
                    regexp_replace(COALESCE(s.product_name,''), '(私募证券投资基金|私募基金|证券投资基金|投资基金)$', ''),
                    '一','1'),'二','2'),'三','3'),'四','4'),'五','5'),
                  '六','6'),'七','7'),'八','8'),'九','9'),'十','10')
                ILIKE
                replace(replace(replace(replace(replace(
                  replace(replace(replace(replace(replace(
                    r.product_name,
                    '一','1'),'二','2'),'三','3'),'四','4'),'五','5'),
                  '六','6'),'七','7'),'八','8'),'九','9'),'十','10') || '%'
           ))
         )
       ORDER BY
         CASE WHEN r.beian_hao <> '' AND s.beian_hao = r.beian_hao THEN 0 ELSE 1 END,
         s.price_date DESC,
         s.pri ASC
       LIMIT 1
     ) hit`,
    [
      pairs.map((p) => p.key),
      pairs.map((p) => p.beian_hao),
      pairs.map((p) => normalizeChineseDigits(fundNameCore(normalizeProductName(p.product_name)))),
      pairs.map((p) => p.at_date),
      minDate,
      maxDate,
      beians,
      names,
    ],
  ).catch((err) => {
    console.error("[due-diligence-table-performance] platform nav", err)
    return []
  })

  for (const row of platformRows) {
    const nav = parseNav(row.nav)
    if (nav == null) continue
    out.set(row.req_key, nav)
  }

  const missing = pairs.filter((p) => !out.has(p.key) && p.beian_hao.trim())
  if (missing.length > 0) {
    const emailRows = await query<{
      req_key: string
      nav: string | null
    }>(
      `WITH req AS (
         SELECT * FROM unnest($1::text[], $2::text[], $3::date[])
           AS t(req_key, beian_hao, at_date)
       )
       SELECT r.req_key, hit.nav::text AS nav
       FROM req r
       CROSS JOIN LATERAL (
         SELECT nav
         FROM ops_email_nav_records e
         WHERE BTRIM(e.product_code) = r.beian_hao
           AND e.nav_date <= r.at_date
           AND e.nav IS NOT NULL AND e.nav > 0
           AND e.nav_date >= (r.at_date - INTERVAL '400 days')
         ORDER BY e.nav_date DESC, e.id DESC
         LIMIT 1
       ) hit`,
      [
        missing.map((p) => p.key),
        missing.map((p) => p.beian_hao),
        missing.map((p) => p.at_date),
      ],
    ).catch((err) => {
      console.error("[due-diligence-table-performance] email nav", err)
      return []
    })

    for (const row of emailRows) {
      const nav = parseNav(row.nav)
      if (nav == null || out.has(row.req_key)) continue
      out.set(row.req_key, nav)
    }
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
    if (!item.row_id.trim()) return false
    if (!item.beian_hao?.trim() && !item.product_name.trim()) return false
    if (usePeriodRange) return true
    return isIsoDate(item.dd_date)
  })
  if (validItems.length === 0) {
    console.log(`[post-dd-returns] 0 valid of ${items.length} items in ${Date.now() - t0}ms`)
    return {}
  }

  const navRequests: NavRequest[] = []
  for (const item of validItems) {
    const beian = item.beian_hao?.trim() ?? ""
    const product_name = normalizeProductName(item.product_name)
    const baseDate = usePeriodRange ? periodStart : item.dd_date!
    let endDate = usePeriodRange ? periodEnd : asOfDate
    if (endDate > asOfDate) endDate = asOfDate
    if (baseDate > endDate) continue
    navRequests.push({
      key: `${item.row_id}|base`,
      beian_hao: beian,
      product_name,
      at_date: baseDate,
    })
    navRequests.push({
      key: `${item.row_id}|end`,
      beian_hao: beian,
      product_name,
      at_date: endDate,
    })
  }

  const navMap = await loadNavAtOrBeforeBatch(navRequests)
  const out: Record<string, number | null> = {}
  let matched = 0
  let up = 0
  let down = 0

  for (const item of validItems) {
    const baseDate = usePeriodRange ? periodStart : item.dd_date!
    let endDate = usePeriodRange ? periodEnd : asOfDate
    if (endDate > asOfDate) endDate = asOfDate
    if (baseDate > endDate) {
      out[item.row_id] = null
      continue
    }
    const baseNav = navMap.get(`${item.row_id}|base`) ?? null
    const endNav = navMap.get(`${item.row_id}|end`) ?? null
    const ret = endNav != null ? calcReturn(endNav, baseNav) : null
    out[item.row_id] = ret
    if (ret != null) {
      matched += 1
      if (ret > 0) up += 1
      else if (ret < 0) down += 1
    }
  }

  console.log(
    `[post-dd-returns] items=${validItems.length} matched=${matched} up=${up} down=${down} withBeian=${enrichedItems.filter((i) => i.beian_hao).length} ${Date.now() - t0}ms`,
  )
  return out
}
