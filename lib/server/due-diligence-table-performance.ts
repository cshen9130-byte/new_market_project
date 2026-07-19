import {
  BatchNavResolver,
  calcReturn,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"

export type PostDdReturnItem = {
  row_id: string
  beian_hao: string
  product_name: string
  dd_date?: string
}

function navForReturn(p: { nav: number; return_nav?: number | null } | null): number | null {
  if (!p) return null
  const v = p.return_nav ?? p.nav
  return Number.isFinite(v) && v > 0 ? v : null
}

function isIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
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

  const validItems = items.filter((item) => {
    if (!item.row_id.trim() || !item.beian_hao.trim()) return false
    if (usePeriodRange) return true
    return isIsoDate(item.dd_date)
  })
  if (validItems.length === 0) return {}

  const identities: ProductNavIdentity[] = validItems.map((item) => ({
    beian_hao: item.beian_hao.trim(),
    product_name: item.product_name.trim() || item.beian_hao.trim(),
    short_name: null,
  }))

  const resolverAsOf =
    usePeriodRange && periodEnd > asOfDate ? periodEnd : asOfDate
  const resolver = await BatchNavResolver.create(identities, resolverAsOf)
  const out: Record<string, number | null> = {}

  for (const item of validItems) {
    const identity: ProductNavIdentity = {
      beian_hao: item.beian_hao.trim(),
      product_name: item.product_name.trim() || item.beian_hao.trim(),
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
