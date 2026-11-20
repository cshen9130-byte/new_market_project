/** First included date: mature sample starts when n_prod first reaches 20. */
export const VAR_MCR_HISTORY_START = "2025-08-06"

export type VarMcrPayload = {
  ok: boolean
  dates: string[]
  productData: Record<string, number[]>
  sectorData: Record<string, number[]>
  maxProductShare: number[]
  maxSectorShare: number[]
  distanceProduct: number[]
  distanceSector: number[]
  productSoft?: number
  productHard?: number
  sectorSoft?: number
  sectorHard?: number
  cacheStatus?: string
}

function axisDate(v: string): string {
  return (v ?? "").slice(0, 10)
}

function asRecord(value: unknown): Record<string, number[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Record<string, number[]> = {}
  for (const [key, series] of Object.entries(value)) {
    out[key] = Array.isArray(series) ? series as number[] : []
  }
  return out
}

function asNumbers(value: unknown): number[] {
  return Array.isArray(value) ? value as number[] : []
}

/**
 * Single-account routes that have no MCR history answer `{ ok: true }`
 * without dates or series. Reading those missing fields used to throw
 * during render and blank the whole 日间风控 page.
 */
export function normalizeMcrPayload(payload: Partial<VarMcrPayload> | null | undefined): VarMcrPayload {
  return {
    ok: true,
    ...(payload ?? {}),
    dates: Array.isArray(payload?.dates) ? payload.dates.map(d => String(d ?? "")) : [],
    productData: asRecord(payload?.productData),
    sectorData: asRecord(payload?.sectorData),
    maxProductShare: asNumbers(payload?.maxProductShare),
    maxSectorShare: asNumbers(payload?.maxSectorShare),
    distanceProduct: asNumbers(payload?.distanceProduct),
    distanceSector: asNumbers(payload?.distanceSector),
  }
}

export function cropMcrHistory(payload: Partial<VarMcrPayload> | null | undefined): VarMcrPayload {
  const normalized = normalizeMcrPayload(payload)
  const startIdx = normalized.dates.findIndex(d => axisDate(d) >= VAR_MCR_HISTORY_START)
  if (startIdx <= 0) return normalized
  const cut = <T,>(arr: T[]) => arr.slice(startIdx)
  const cutMap = (obj: Record<string, number[]>) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, cut(v)]))
  return {
    ...normalized,
    dates: cut(normalized.dates),
    productData: cutMap(normalized.productData),
    sectorData: cutMap(normalized.sectorData),
    maxProductShare: cut(normalized.maxProductShare),
    maxSectorShare: cut(normalized.maxSectorShare),
    distanceProduct: cut(normalized.distanceProduct),
    distanceSector: cut(normalized.distanceSector),
  }
}
