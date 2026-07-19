import { query } from "@/lib/db"
import { fundNameCore } from "@/lib/server/fund-picker-search"
import { loadFundNavSeries, resolveFundNames } from "@/lib/server/fund-nav-series"
import { addDays, calcReturn } from "@/lib/server/list-cache-nav-batch"

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

function navAtOrBefore(
  series: Array<{ price_date: string; level: string }>,
  date: string,
): number | null {
  let best: number | null = null
  for (const row of series) {
    const d = row.price_date.slice(0, 10)
    if (d > date) break
    const nav = parseFloat(row.level)
    if (Number.isFinite(nav) && nav > 0) best = nav
  }
  return best
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

/**
 * Fast 备案号 resolve: prefix match + 一号↔1号 variants.
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

  const uniqueVariants = [...new Set(uncached.flatMap((name) => nameVariants(name)))]
  if (uniqueVariants.length === 0) return resolved

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
        if (!best || score < best.score) best = { beian: c.beian_hao.trim(), score }
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

/**
 * Use the same merged NAV series as the hover chart (type6 + legacy + email + team).
 * Fast type6-only lookups miss funds like 古曲祥辰1号 whose post-DD NAV only exists in the merge.
 */
async function loadReturnsViaFundNavSeries(
  items: Array<{
    row_id: string
    beian_hao: string
    product_name: string
    base_date: string
    end_date: string
  }>,
): Promise<Record<string, number | null>> {
  // Dedupe by beian so 37 rows with ~30 unique products don't reload the same series.
  type Group = {
    beian_hao: string
    product_name: string
    from: string
    to: string
    members: Array<{ row_id: string; base_date: string; end_date: string }>
  }
  const groups = new Map<string, Group>()
  for (const item of items) {
    const key = item.beian_hao
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        beian_hao: item.beian_hao,
        product_name: item.product_name,
        from: item.base_date,
        to: item.end_date,
        members: [{ row_id: item.row_id, base_date: item.base_date, end_date: item.end_date }],
      })
      continue
    }
    if (item.base_date < existing.from) existing.from = item.base_date
    if (item.end_date > existing.to) existing.to = item.end_date
    if (!existing.product_name && item.product_name) existing.product_name = item.product_name
    existing.members.push({
      row_id: item.row_id,
      base_date: item.base_date,
      end_date: item.end_date,
    })
  }

  const out: Record<string, number | null> = {}
  const groupList = [...groups.values()]

  await mapPool(groupList, 6, async (group) => {
    try {
      const names = await resolveFundNames(group.beian_hao, group.product_name)
      // Pad lookback so "NAV on or before base date" has a nearby point.
      const from = addDays(group.from, 60)
      const to = group.to
      const series = await loadFundNavSeries(
        group.beian_hao,
        names.product_name,
        names.short_name ?? "",
        { from, to },
      )
      // series is ascending by date
      for (const member of group.members) {
        const baseNav = navAtOrBefore(series, member.base_date)
        const endNav = navAtOrBefore(series, member.end_date)
        out[member.row_id] = endNav != null ? calcReturn(endNav, baseNav) : null
      }
    } catch (err) {
      console.error(
        `[due-diligence-table-performance] nav series ${group.beian_hao}`,
        err,
      )
      for (const member of group.members) out[member.row_id] = null
    }
  })

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
  const workItems: Array<{
    row_id: string
    beian_hao: string
    product_name: string
    base_date: string
    end_date: string
  }> = []

  for (const item of enrichedItems) {
    const beian = item.beian_hao?.trim()
    if (!item.row_id.trim() || !beian) continue
    const baseDate = usePeriodRange ? periodStart : item.dd_date
    if (!isIsoDate(baseDate)) continue
    let endDate = usePeriodRange ? periodEnd : asOfDate
    if (!isIsoDate(endDate)) continue
    if (endDate > asOfDate) endDate = asOfDate
    if (baseDate > endDate) continue
    workItems.push({
      row_id: item.row_id,
      beian_hao: beian,
      product_name: normalizeProductName(item.product_name) || beian,
      base_date: baseDate,
      end_date: endDate,
    })
  }

  if (workItems.length === 0) {
    console.log(
      `[post-dd-returns] 0 valid of ${items.length} (resolved ${enrichedItems.filter((i) => i.beian_hao).length}) in ${Date.now() - t0}ms`,
    )
    return {}
  }

  const out = await loadReturnsViaFundNavSeries(workItems)
  let matched = 0
  let up = 0
  for (const ret of Object.values(out)) {
    if (ret == null) continue
    matched += 1
    if (ret > 0) up += 1
  }

  console.log(
    `[post-dd-returns] items=${workItems.length} unique=${new Set(workItems.map((i) => i.beian_hao)).size} matched=${matched} up=${up} ${Date.now() - t0}ms`,
  )
  return out
}
