/** Account numbers treated as quantitative (CTA / systematic) trading sleeves. */
export const QUANT_ACCOUNT_IDS = [319, 324, 334, 339, 346, 350, 356] as const

const QUANT_ID_SET = new Set(QUANT_ACCOUNT_IDS.map(String))

/** Strip letters/punctuation so `rx319`, `RX0319`, `319` all map to `319`. `rx000` maps to `0`. */
export function accountNumericId(account: string): string {
  const digits = String(account ?? "").replace(/\D/g, "")
  if (!digits) return ""
  return digits.replace(/^0+/, "") || "0"
}

export function parseQuantIdList(raw: string | null | undefined, useDefaultIfMissing = true): number[] {
  if (raw == null) return useDefaultIfMissing ? [...QUANT_ACCOUNT_IDS] : []
  if (!raw.trim()) return []
  const ids: number[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[,\s]+/)) {
    const id = accountNumericId(part)
    if (!id || id.length > 12 || seen.has(id)) continue
    seen.add(id)
    const n = Number(id)
    if (Number.isFinite(n) && n >= 0) ids.push(n)
    if (ids.length >= 200) break
  }
  return ids
}

export function isQuantAccountIn(account: string, quantIds: Iterable<string | number>): boolean {
  const id = accountNumericId(account)
  if (!id) return false
  const set = quantIds instanceof Set ? quantIds : new Set([...quantIds].map(String))
  return set.has(id)
}

export function isQuantAccount(account: string): boolean {
  const id = accountNumericId(account)
  return id.length > 0 && QUANT_ID_SET.has(id)
}

export type SleeveGroup = "quant" | "subjective"

export function sleeveGroup(account: string): SleeveGroup {
  return isQuantAccount(account) ? "quant" : "subjective"
}
