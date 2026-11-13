/** MOM sleeves treated as quantitative (CTA / systematic). Also used by 量化vs主观. */
export const QUANT_ACCOUNT_IDS = [319, 324, 334, 339, 346, 350, 356, 387] as const

export type QuantStrategySource = "mom" | "cfmmc"

export type QuantStrategyAccount = {
  id: string
  label: string
  source: QuantStrategySource
}

/**
 * Accounts shown on 量化策略分析.
 * MOM sleeves read public.mom_*. Broker books read public.cfmmc_* only.
 */
export const QUANT_STRATEGY_ACCOUNTS: readonly QuantStrategyAccount[] = [
  ...QUANT_ACCOUNT_IDS.map((id) => ({ id: String(id), label: `rx${id}`, source: "mom" as const })),
  { id: "10800677", label: "正信期货", source: "cfmmc" },
  { id: "85121150", label: "国泰君安期货", source: "cfmmc" },
]

const QUANT_STRATEGY_BY_ID = new Map(QUANT_STRATEGY_ACCOUNTS.map((a) => [a.id, a]))

const QUANT_ID_SET = new Set(QUANT_ACCOUNT_IDS.map(String))

/** Strip letters/punctuation so `rx319`, `RX0319`, `319` all map to `319`. `rx000` maps to `0`. */
export function accountNumericId(account: string): string {
  const digits = String(account ?? "").replace(/\D/g, "")
  if (!digits) return ""
  return digits.replace(/^0+/, "") || "0"
}

/** True when `ids` is the same set as QUANT_ACCOUNT_IDS (order ignored). */
export function isDefaultQuantIds(ids: Iterable<number>): boolean {
  const a = [...ids].sort((x, y) => x - y)
  if (a.length !== QUANT_ACCOUNT_IDS.length) return false
  const b = [...QUANT_ACCOUNT_IDS].sort((x, y) => x - y)
  return a.every((n, i) => n === b[i])
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

export function quantStrategyAccount(account: string): QuantStrategyAccount | undefined {
  const id = accountNumericId(account)
  return id ? QUANT_STRATEGY_BY_ID.get(id) : undefined
}

/** Chip / chart name. MOM sleeves stay `rx319`; broker books use the futures company. */
export function quantStrategyLabel(account: string): string {
  const spec = quantStrategyAccount(account)
  if (spec) return spec.label
  const id = accountNumericId(account)
  return id ? `rx${id}` : "—"
}

/** Detail subtitle. Broker books keep the account number next to the company. */
export function quantStrategyTitle(account: string): string {
  const spec = quantStrategyAccount(account)
  if (spec?.source === "cfmmc") return `${spec.label} ${spec.id}`
  return quantStrategyLabel(account)
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