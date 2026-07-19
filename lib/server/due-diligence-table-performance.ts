import { query } from "@/lib/db"
import {
  BatchNavResolver,
  calcReturn,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"

export type PostDdReturnItem = {
  row_id: string
  beian_hao?: string
  product_name: string
  dd_date?: string
}

const beianCache = new Map<string, string | null>()

function navForReturn(p: { nav: number; return_nav?: number | null } | null): number | null {
  if (!p) return null
  const v = p.return_nav ?? p.nav
  return Number.isFinite(v) && v > 0 ? v : null
}

function isIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function normalizeProductName(name: string): string {
  return name.trim().split(/[、,，(（]/)[0]?.trim() ?? ""
}

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

  const rows = await query<{
    input_name: string
    beian_hao: string
  }>(
    `SELECT input_name, beian_hao
     FROM unnest($1::text[]) AS input_name
     CROSS JOIN LATERAL (
       SELECT t.beian_hao
       FROM (
         SELECT beian_hao, product_name, NULL::text AS short_name
         FROM private_fund_info
         WHERE beian_hao IS NOT NULL AND product_name IS NOT NULL
         UNION ALL
         SELECT beian_hao, product_name, short_name
         FROM private_fund_info_bfl
         WHERE beian_hao IS NOT NULL AND product_name IS NOT NULL
         UNION ALL
         SELECT register_number AS beian_hao,
                COALESCE(NULLIF(BTRIM(fund_short_name), ''), fund_name) AS product_name,
                fund_short_name AS short_name
         FROM type6_ops_team_full
         WHERE register_number IS NOT NULL
       ) t
       WHERE lower(BTRIM(t.product_name)) = lower(BTRIM(input_name))
          OR lower(BTRIM(COALESCE(t.short_name, ''))) = lower(BTRIM(input_name))
          OR t.product_name ILIKE input_name || '%'
          OR t.product_name ILIKE '%' || input_name || '%'
          OR COALESCE(t.short_name, '') ILIKE input_name || '%'
       ORDER BY
         CASE
           WHEN lower(BTRIM(t.product_name)) = lower(BTRIM(input_name)) THEN 0
           WHEN lower(BTRIM(COALESCE(t.short_name, ''))) = lower(BTRIM(input_name)) THEN 1
           WHEN t.product_name ILIKE input_name || '%' THEN 2
           WHEN COALESCE(t.short_name, '') ILIKE input_name || '%' THEN 3
           ELSE 4
         END,
         length(t.product_name) ASC
       LIMIT 1
     ) hit
     WHERE hit.beian_hao IS NOT NULL`,
    [uncached],
  ).catch((err) => {
    console.error("[due-diligence-table-performance] resolveBeianHaoBatch", err)
    return []
  })

  const matchedInputs = new Set<string>()
  for (const row of rows) {
    const beian = row.beian_hao?.trim()
    const inputName = row.input_name?.trim()
    if (!beian || !inputName) continue
    resolved.set(inputName, beian)
    matchedInputs.add(inputName.toLowerCase())
    beianCache.set(inputName.toLowerCase(), beian)
  }

  for (const name of uncached) {
    const cacheKey = name.toLowerCase()
    if (!matchedInputs.has(cacheKey)) {
      beianCache.set(cacheKey, null)
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
    return resolved ? { ...item, product_name, beian_hao: resolved } : item
  })
}

export async function computePostDdReturns(
  items: PostDdReturnItem[],
  options?: { periodStart?: string; periodEnd?: string; asOfDate?: string },
): Promise<Record<string, number | null>> {
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
  if (validItems.length === 0) return {}

  const identities: ProductNavIdentity[] = validItems.map((item) => ({
    beian_hao: item.beian_hao!.trim(),
    product_name: item.product_name.trim() || item.beian_hao!.trim(),
    short_name: null,
  }))

  const resolverAsOf =
    usePeriodRange && periodEnd > asOfDate ? periodEnd : asOfDate
  const resolver = await BatchNavResolver.create(identities, resolverAsOf)
  const out: Record<string, number | null> = {}

  for (const item of validItems) {
    const identity: ProductNavIdentity = {
      beian_hao: item.beian_hao!.trim(),
      product_name: item.product_name.trim() || item.beian_hao!.trim(),
      short_name: null,
    }
    const baseDate = usePeriodRange ? periodStart : item.dd_date!
    let endDate = usePeriodRange ? periodEnd : asOfDate
    if (endDate > asOfDate) endDate = asOfDate
    if (baseDate > endDate) {
      out[item.row_id] = null
      continue
    }

    const basePoint = resolver.resolveAt(identity, baseDate)
    const endPoint = resolver.resolveAt(identity, endDate)
    const endNav = navForReturn(endPoint)
    const baseNav = navForReturn(basePoint)
    out[item.row_id] = endNav != null ? calcReturn(endNav, baseNav) : null
  }

  return out
}
