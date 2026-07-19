import { query } from "@/lib/db"
import { fundNameCore } from "@/lib/server/fund-picker-search"
import { calcReturn } from "@/lib/server/list-cache-nav-batch"

export type PostDdReturnItem = {
  row_id: string
  beian_hao?: string
  product_name: string
  dd_date?: string
}

const beianCache = new Map<string, string>()
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
    if (s.length >= 2) out.add(s)
  }
  return [...out]
}

function parseNav(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const nav = parseFloat(raw)
  return Number.isFinite(nav) && nav > 0 ? nav : null
}

/**
 * Fast 备案号 resolve: prefix match only (uses indexes), with 一号↔1号 variants.
 * Avoids full-table fuzzy JOINs that hang for minutes.
 */
async function resolveBeianHaoBatch(productNames: string[]): Promise<Map<string, string>> {
  const names = [...new Set(productNames.map((name) => normalizeProductName(name)).filter(Boolean))]
  const resolved = new Map<string, string>()
  if (names.length === 0) return resolved

  const uncached: string[] = []
  for (const name of names) {
    const cached = beianCache.get(name.toLowerCase())
    if (cached) {
      resolved.set(name, cached)
      continue
    }
    uncached.push(name)
  }
  if (uncached.length === 0) return resolved

  // One row per input with its preferred search variant (digit-normalized core first).
  const inputs: Array<{ input_name: string; variant: string }> = []
  for (const name of uncached) {
    const variants = nameVariants(name)
    // Prefer digit-normalized core: 务扬赤壁一号 → 务扬赤壁1号
    const preferred =
      variants.find((v) => v === normalizeChineseDigits(fundNameCore(name)))
      ?? variants.find((v) => /[0-9]/.test(v))
      ?? variants[0]
    if (preferred) inputs.push({ input_name: name, variant: preferred })
    // Also try original short form if different
    for (const v of variants) {
      if (v !== preferred) inputs.push({ input_name: name, variant: v })
    }
  }

  const uniqueVariants = [...new Set(inputs.map((i) => i.variant))]
  if (uniqueVariants.length === 0) return resolved

  // Indexed prefix search across product tables — one query, no full scan JOIN.
  const prefixPatterns = uniqueVariants.map((v) => `${v}%`)
  const candidates = await query<{
    beian_hao: string
    product_name: string
    short_name: string | null
  }>(
    `SELECT DISTINCT ON (beian_hao) beian_hao, product_name, short_name
     FROM (
       SELECT BTRIM(beian_hao) AS beian_hao, product_name, NULL::text AS short_name
       FROM private_fund_info
       WHERE beian_hao IS NOT NULL AND product_name ILIKE ANY($1::text[])
       UNION ALL
       SELECT BTRIM(beian_hao), product_name, short_name
       FROM private_fund_info_bfl
       WHERE beian_hao IS NOT NULL AND (
         product_name ILIKE ANY($1::text[]) OR short_name ILIKE ANY($1::text[])
       )
       UNION ALL
       SELECT BTRIM(register_number),
              COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name),
              fund_short_name
       FROM type6_ops_team_full
       WHERE register_number IS NOT NULL AND (
         fund_name ILIKE ANY($1::text[]) OR fund_short_name ILIKE ANY($1::text[])
       )
     ) t
     WHERE beian_hao <> ''
     ORDER BY beian_hao, length(product_name) ASC
     LIMIT 500`,
    [prefixPatterns],
  ).catch((err) => {
    console.error("[due-diligence-table-performance] resolveBeianHaoBatch", err)
    return []
  })

  const scoreCandidate = (inputVariant: string, productName: string, shortName: string | null): number => {
    const v = normalizeChineseDigits(inputVariant).toLowerCase()
    const full = normalizeChineseDigits(fundNameCore(productName)).toLowerCase()
    const short = shortName ? normalizeChineseDigits(fundNameCore(shortName)).toLowerCase() : ""
    if (full === v || short === v) return 0
    if (full.startsWith(v) || short.startsWith(v)) return 1
    if (full.includes(v) || short.includes(v)) return 2
    return 99
  }

  for (const name of uncached) {
    if (resolved.has(name)) continue
    let best: { beian: string; score: number } | null = null
    for (const variant of nameVariants(name)) {
      for (const c of candidates) {
        const score = Math.min(
          scoreCandidate(variant, c.product_name, c.short_name),
          c.short_name ? scoreCandidate(variant, c.short_name, null) : 99,
        )
        if (score >= 99) continue
        if (!best || score < best.score) {
          best = { beian: c.beian_hao.trim(), score }
        }
      }
    }
    if (best) {
      resolved.set(name, best.beian)
      beianCache.set(name.toLowerCase(), best.beian)
    }
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
    return resolved
      ? { ...item, product_name, beian_hao: resolved }
      : { ...item, product_name }
  })
}

type NavRequest = {
  key: string
  beian_hao: string
  at_date: string
}

/** Fast NAV at-or-before date, keyed only by 备案号 (indexed). */
async function loadNavAtOrBeforeBatch(requests: NavRequest[]): Promise<Map<string, number>> {
  const unique = new Map<string, NavRequest>()
  for (const req of requests) {
    const beian = req.beian_hao.trim()
    if (!req.key || !beian || !isIsoDate(req.at_date)) continue
    unique.set(req.key, { ...req, beian_hao: beian })
  }
  const pairs = [...unique.values()]
  const out = new Map<string, number>()
  if (pairs.length === 0) return out

  const beians = [...new Set(pairs.map((p) => p.beian_hao))]
  const minDate = pairs.reduce((min, p) => (p.at_date < min ? p.at_date : min), pairs[0].at_date)
  const maxDate = pairs.reduce((max, p) => (p.at_date > max ? p.at_date : max), pairs[0].at_date)

  // Pull a compact NAV window for all 备案号 once, then pick points in JS.
  const rows = await query<{
    beian_hao: string
    price_date: string
    nav: string
    pri: number
  }>(
    // Prefer beian_hao = ANY(...) without BTRIM so indexes can be used.
    `SELECT beian_hao, price_date::text AS price_date, nav::text AS nav, pri
     FROM (
       SELECT beian_hao, price_date, nav::text AS nav, 0 AS pri
       FROM private_fund_nav_group_type6
       WHERE beian_hao = ANY($1::text[])
         AND price_date >= ($2::date - INTERVAL '400 days')
         AND price_date <= $3::date
         AND nav IS NOT NULL AND nav > 0
       UNION ALL
       SELECT beian_hao, price_date,
              COALESCE(NULLIF(cum_nav_withdrawal, 0), NULLIF(cumulative_nav, 0), NULLIF(nav, 0))::text,
              1
       FROM private_fund_nav_group
       WHERE beian_hao = ANY($1::text[])
         AND price_date >= ($2::date - INTERVAL '400 days')
         AND price_date <= $3::date
       UNION ALL
       SELECT beian_hao, price_date,
              COALESCE(NULLIF(cum_nav_withdrawal, 0), NULLIF(cumulative_nav, 0), NULLIF(nav, 0))::text,
              2
       FROM private_fund_nav
       WHERE beian_hao = ANY($1::text[])
         AND price_date >= ($2::date - INTERVAL '400 days')
         AND price_date <= $3::date
     ) t
     WHERE nav IS NOT NULL
     ORDER BY beian_hao, price_date DESC, pri ASC`,
    [beians, minDate, maxDate],
  ).catch((err) => {
    console.error("[due-diligence-table-performance] platform nav", err)
    return []
  })

  // Best NAV on-or-before each date: first matching row in DESC date order.
  const byBeian = new Map<string, Array<{ d: string; nav: number; pri: number }>>()
  for (const row of rows) {
    const nav = parseNav(row.nav)
    if (nav == null) continue
    const beian = row.beian_hao.trim()
    const d = row.price_date.slice(0, 10)
    let list = byBeian.get(beian)
    if (!list) {
      list = []
      byBeian.set(beian, list)
    }
    // Keep first (best pri) per date
    if (list.length > 0 && list[list.length - 1].d === d) continue
    list.push({ d, nav, pri: row.pri })
  }

  for (const req of pairs) {
    const series = byBeian.get(req.beian_hao)
    if (!series?.length) continue
    // series is date DESC
    for (const point of series) {
      if (point.d <= req.at_date) {
        out.set(req.key, point.nav)
        break
      }
    }
  }

  // Email fallback for still-missing keys
  const missing = pairs.filter((p) => !out.has(p.key))
  if (missing.length > 0) {
    const emailRows = await query<{
      beian_hao: string
      nav_date: string
      nav: string
    }>(
      `SELECT product_code AS beian_hao,
              nav_date::text AS nav_date,
              nav::text AS nav
       FROM ops_email_nav_records
       WHERE product_code = ANY($1::text[])
         AND nav IS NOT NULL AND nav > 0
         AND nav_date >= ($2::date - INTERVAL '400 days')
         AND nav_date <= $3::date
       ORDER BY product_code, nav_date DESC, id DESC`,
      [
        [...new Set(missing.map((m) => m.beian_hao))],
        minDate,
        maxDate,
      ],
    ).catch((err) => {
      console.error("[due-diligence-table-performance] email nav", err)
      return []
    })

    const emailByBeian = new Map<string, Array<{ d: string; nav: number }>>()
    for (const row of emailRows) {
      const nav = parseNav(row.nav)
      if (nav == null) continue
      const beian = row.beian_hao.trim()
      const d = row.nav_date.slice(0, 10)
      let list = emailByBeian.get(beian)
      if (!list) {
        list = []
        emailByBeian.set(beian, list)
      }
      if (list.length > 0 && list[list.length - 1].d === d) continue
      list.push({ d, nav })
    }

    for (const req of missing) {
      const series = emailByBeian.get(req.beian_hao)
      if (!series?.length) continue
      for (const point of series) {
        if (point.d <= req.at_date) {
          out.set(req.key, point.nav)
          break
        }
      }
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
    if (!item.row_id.trim() || !item.beian_hao?.trim()) return false
    if (usePeriodRange) return true
    return isIsoDate(item.dd_date)
  })
  if (validItems.length === 0) {
    console.log(
      `[post-dd-returns] 0 valid of ${items.length} (resolved ${enrichedItems.filter((i) => i.beian_hao).length}) in ${Date.now() - t0}ms`,
    )
    return {}
  }

  const navRequests: NavRequest[] = []
  for (const item of validItems) {
    const beian = item.beian_hao!.trim()
    const baseDate = usePeriodRange ? periodStart : item.dd_date!
    let endDate = usePeriodRange ? periodEnd : asOfDate
    if (endDate > asOfDate) endDate = asOfDate
    if (baseDate > endDate) continue
    navRequests.push({ key: `${item.row_id}|base`, beian_hao: beian, at_date: baseDate })
    navRequests.push({ key: `${item.row_id}|end`, beian_hao: beian, at_date: endDate })
  }

  const navMap = await loadNavAtOrBeforeBatch(navRequests)
  const out: Record<string, number | null> = {}
  let matched = 0
  let up = 0

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
    }
  }

  console.log(
    `[post-dd-returns] items=${validItems.length} matched=${matched} up=${up} ${Date.now() - t0}ms`,
  )
  return out
}
