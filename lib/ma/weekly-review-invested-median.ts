/** Group already-held FOF underlyings into weekly-review strategy medians. */

export type InvestedReturnPoint = {
  ret_1w: number | null
  ret_1m: number | null
  ret_3m: number | null
  ret_6m: number | null
  ret_1y: number | null
}

export type InvestedMedianProduct = InvestedReturnPoint & {
  code: string
  name: string
}

export type InvestedMedianMode = "excess" | "absolute"

export type InvestedMedianGroup = {
  bucket: string
  mode: InvestedMedianMode
  count: number
  median: InvestedReturnPoint
  products: InvestedMedianProduct[]
}

export type InvestedMedianInput = InvestedMedianProduct & {
  buckets: string[]
  mode: InvestedMedianMode
}

export const INVESTED_MEDIAN_ROW_LABEL = "已投产品中位数"

const RETURN_KEYS = ["ret_1w", "ret_1m", "ret_3m", "ret_6m", "ret_1y"] as const

/**
 * Share of the strategy table this return ranks in, from the top.
 * 1st of 20 → 0.05 (前 5%). Ties share the best rank. Missing values are ignored.
 */
export function weekReturnTopShare(
  value: number | null | undefined,
  peers: Array<number | null | undefined>,
): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const nums = peers.filter((peer): peer is number => peer != null && Number.isFinite(peer))
  if (nums.length === 0) return null
  const better = nums.filter((peer) => peer > value).length
  return (better + 1) / nums.length
}

export function formatWeekReturnTopShare(share: number | null): string | null {
  if (share == null || !Number.isFinite(share)) return null
  const pct = Math.max(1, Math.round(share * 100))
  return `前${pct}%`
}

/** Mark tracking-pool rows that we hold, and append held products missing from the table. */
export function mergeWeeklyReviewInvestedRows<T extends { beian_hao: string }>(
  poolRows: T[],
  investedCodes: Iterable<string>,
  investedRows: T[],
): Array<{ row: T; invested: boolean }> {
  const codes = new Set(investedCodes)
  const byCode = new Map(investedRows.map((row) => [row.beian_hao, row]))
  const seen = new Set<string>()
  const out: Array<{ row: T; invested: boolean }> = []
  for (const row of poolRows) {
    seen.add(row.beian_hao)
    out.push({ row, invested: codes.has(row.beian_hao) })
  }
  for (const code of codes) {
    if (seen.has(code)) continue
    const row = byCode.get(code)
    if (!row) continue
    out.push({ row, invested: true })
    seen.add(code)
  }
  return out
}

/**
 * Where a median sits among values already sorted from high to low.
 * Missing prints sort to the bottom. Returns null when there is no median to place.
 */
export function investedMedianInsertIndex(
  sortedDesc: Array<number | null | undefined>,
  median: number | null | undefined,
): number | null {
  if (median == null || !Number.isFinite(median)) return null
  const idx = sortedDesc.findIndex((value) => {
    const numeric = value != null && Number.isFinite(value) ? value : -Infinity
    return numeric < median
  })
  return idx === -1 ? sortedDesc.length : idx
}

export function medianOf(values: Array<number | null | undefined>): number | null {
  const nums = values
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((a, b) => a - b)
  if (nums.length === 0) return null
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 === 1 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2
}

export function medianPoint(rows: InvestedReturnPoint[]): InvestedReturnPoint {
  return {
    ret_1w: medianOf(rows.map((row) => row.ret_1w)),
    ret_1m: medianOf(rows.map((row) => row.ret_1m)),
    ret_3m: medianOf(rows.map((row) => row.ret_3m)),
    ret_6m: medianOf(rows.map((row) => row.ret_6m)),
    ret_1y: medianOf(rows.map((row) => row.ret_1y)),
  }
}

function pointOf(row: InvestedReturnPoint): InvestedReturnPoint {
  const out = {} as InvestedReturnPoint
  for (const key of RETURN_KEYS) {
    const value = row[key]
    out[key] = value != null && Number.isFinite(value) ? value : null
  }
  return out
}

/** One group per strategy that has at least one product. A product can sit in several groups. */
export function buildInvestedMedianGroups(
  rows: InvestedMedianInput[],
  bucketOrder: readonly string[],
): InvestedMedianGroup[] {
  const byBucket = new Map<string, { mode: InvestedMedianMode; products: InvestedMedianProduct[] }>()
  for (const row of rows) {
    const seen = new Set<string>()
    for (const bucket of row.buckets) {
      const name = bucket.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      const slot = byBucket.get(name) ?? { mode: row.mode, products: [] }
      if (!slot.products.some((product) => product.code === row.code)) {
        slot.products.push({ code: row.code, name: row.name, ...pointOf(row) })
      }
      byBucket.set(name, slot)
    }
  }

  const names = bucketOrder.filter((name) => byBucket.has(name))
  for (const name of byBucket.keys()) {
    if (!names.includes(name)) names.push(name)
  }

  return names.map((bucket) => {
    const slot = byBucket.get(bucket)!
    const products = [...slot.products].sort(
      (a, b) => (b.ret_1w ?? -Infinity) - (a.ret_1w ?? -Infinity) || a.name.localeCompare(b.name, "zh"),
    )
    return {
      bucket,
      mode: slot.mode,
      count: products.length,
      median: medianPoint(products),
      products,
    }
  })
}
