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

export type SleeveFilter = "all" | "quant" | "subjective"

/** Accept all / quant / subjective (also 全部 / 量化 / 主观). Default all. */
export function parseSleeveParam(raw: string | null | undefined): SleeveFilter {
  const v = String(raw ?? "").trim().toLowerCase()
  if (v === "quant" || v === "量化") return "quant"
  if (v === "subjective" || v === "subj" || v === "主观") return "subjective"
  return "all"
}

// Split so the pattern is not a char-class escape hazard in some editors.
const NON_DIGIT_CLASS = "[^" + "0-9]"

/**
 * SQL CASE expression classifying an account column as 'quant' | 'subjective',
 * matching MOM quant-vs-subjective / jiaama-only partitioning.
 */
export function sleeveSql(quantIds: number[], accountCol = `"账户"`): string {
  if (!quantIds.length) return "'subjective'"
  const list = quantIds.map((id) => "'" + id + "'").join(",")
  const digits = "regexp_replace(TRIM(" + accountCol + "), '" + NON_DIGIT_CLASS + "', '', 'g')"
  const norm = "COALESCE(NULLIF(TRIM(LEADING '0' FROM " + digits + "), ''), '0')"
  return (
    "CASE WHEN " + digits + " = '' THEN 'subjective' " +
    "WHEN " + norm + " IN (" + list + ") THEN 'quant' ELSE 'subjective' END"
  )
}

/** AND-clause filtering to one sleeve, or empty string for all. */
export function sleeveFilterSql(
  sleeve: SleeveFilter,
  quantIds: number[],
  accountCol = `"账户"`,
): string {
  if (sleeve === "all") return ""
  return " AND (" + sleeveSql(quantIds, accountCol) + ") = '" + sleeve + "'"
}