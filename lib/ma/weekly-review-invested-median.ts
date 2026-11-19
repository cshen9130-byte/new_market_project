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
