import { query } from "@/lib/db"
import {
  formatFeePayFormula,
  parseFeePayFormulaConfig,
} from "@/lib/ma/fund-elements-extra"
import { resolveFofValuationCodeAlias } from "@/lib/server/fund-holding-code"
import {
  SHARE_CLASS_OPTIONS,
  beianFamilyKey,
  canonicalizeShareClassBeianCode,
  stripShareClassSuffix,
} from "@/lib/server/share-class-product"

export type FundElementExtraFields = {
  risk_level: string | null
  lock_period_desc: string | null
  fee_pay_formula: string | null
}

const EMPTY_EXTRA_FIELDS: FundElementExtraFields = {
  risk_level: null,
  lock_period_desc: null,
  fee_pay_formula: null,
}

/** True when a basicinfo_bfl_track row has usable 申赎要素 (same bar as FOF 无要素). */
export function sqlHasUsableFundElements(alias?: string): string {
  const col = (name: string) => (alias ? `${alias}.${name}` : name)
  return `(
    NULLIF(BTRIM(COALESCE(${col("open_day")}, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(${col("fee_purchase")}, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(${col("fee_redeem")}, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(${col("fee_manage")}, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(${col("fee_pay")}, '')), '') IS NOT NULL
    OR (${col("fee_manage_rate")} IS NOT NULL AND ${col("fee_manage_rate")} <> 0)
  )`
}

function addKey(
  keys: string[],
  seen: Set<string>,
  value: string | null | undefined,
) {
  const v = String(value ?? "").trim()
  if (!v) return
  const upper = v.toUpperCase()
  if (seen.has(upper)) return
  seen.add(upper)
  keys.push(v)
}

/** Parent / S-prefix / A-B-C share-class variants so lookups stay indexable. */
function addShareClassFamilyKeys(
  keys: string[],
  seen: Set<string>,
  code: string | null | undefined,
) {
  const family = beianFamilyKey(code)
  if (!family) return
  addKey(keys, seen, family)
  addKey(keys, seen, `S${family}`)
  for (const letter of SHARE_CLASS_OPTIONS) {
    addKey(keys, seen, `${family}${letter}`)
    addKey(keys, seen, `S${family}${letter}`)
  }
}

function expandBeianLookupKeys(input: string[]): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const key of input) {
    addKey(keys, seen, key)
    addKey(keys, seen, canonicalizeShareClassBeianCode(key))
    addKey(keys, seen, resolveFofValuationCodeAlias(key))
    addShareClassFamilyKeys(keys, seen, key)
  }
  return keys
}

/**
 * Same share-class / parent aliases only (BLE72A↔SBLE72A, SBLE72↔BLE72).
 * Never maps a parent onto an A/B/C row or the reverse.
 */
export function exactBeianWriteKeys(beianHao: string): string[] {
  const raw = String(beianHao ?? "").trim()
  if (!raw) return []
  const upper = raw.toUpperCase()
  const keys: string[] = []
  const seen = new Set<string>()
  addKey(keys, seen, raw)
  addKey(keys, seen, canonicalizeShareClassBeianCode(raw))

  if (/[ABC]$/u.test(upper)) {
    const canon = (canonicalizeShareClassBeianCode(raw) || raw).toUpperCase()
    addKey(keys, seen, canon)
    if (canon.startsWith("S")) addKey(keys, seen, canon.slice(1))
    else addKey(keys, seen, `S${canon}`)
  } else if (upper.startsWith("S") && /^S[A-Z][A-Z0-9]{4,7}$/u.test(upper)) {
    addKey(keys, seen, upper.slice(1))
  } else if (/^[A-Z][A-Z0-9]{4,7}$/u.test(upper)) {
    addKey(keys, seen, `S${upper}`)
  }
  return keys
}

export type LoadTrackByBeianOptions = {
  /** When false, do not expand to parent / A/B/C family codes. */
  expandFamily?: boolean
}

function fundElementNameTerms(productName: string): { terms: string[]; prefix: string } {
  const raw = productName.trim()
  const noClass = stripShareClassSuffix(raw)
  const noLegal = noClass
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金)$/u, "")
    .trim()
  const terms = [...new Set([raw, noClass, noLegal].filter(Boolean))]
  return { terms, prefix: noLegal || noClass || raw }
}

export function extraFieldsFromTrackRow(row: {
  risk_level?: string | null
  lock_period_desc?: string | null
  fee_pay_formula?: string | null
  fee_pay_formula_json?: unknown
} | null | undefined): FundElementExtraFields {
  if (!row) return EMPTY_EXTRA_FIELDS
  const config = parseFeePayFormulaConfig(row.fee_pay_formula_json)
  return {
    risk_level: row.risk_level || null,
    lock_period_desc: row.lock_period_desc || null,
    fee_pay_formula: row.fee_pay_formula || formatFeePayFormula(config),
  }
}

/** Extra 申赎 columns from migration 018 (risk / lock / performance-fee formula). */
export async function loadFundElementExtraFields(
  keys: string[],
  options?: LoadTrackByBeianOptions,
): Promise<FundElementExtraFields> {
  try {
    const rows = await loadBasicinfoTrackByBeianKeys<{
      risk_level: string | null
      lock_period_desc: string | null
      fee_pay_formula: string | null
      fee_pay_formula_json: unknown
    }>(
      keys,
      `SELECT risk_level, lock_period_desc, fee_pay_formula, fee_pay_formula_json
       FROM basicinfo_bfl_track`,
      options,
    )
    return extraFieldsFromTrackRow(rows[0])
  } catch {
    return EMPTY_EXTRA_FIELDS
  }
}

async function hasUsableTrackRow(keys: string[]): Promise<boolean> {
  const expanded = expandBeianLookupKeys(keys)
  if (expanded.length === 0) return false
  try {
    const rows = await query<{ ok: number }>(
      `SELECT 1 AS ok
       FROM basicinfo_bfl_track
       WHERE (register_number = ANY($1::text[]) OR record_key = ANY($1::text[]))
         AND ${sqlHasUsableFundElements()}
       LIMIT 1`,
      [expanded],
    )
    return Boolean(rows[0])
  } catch {
    return false
  }
}

/** Candidate 备案号 keys for 要素 lookup (wrong S-prefix + parent/share-class family + name). */
export async function resolveFundElementsBeianKeys(
  beianHao: string,
  productName?: string | null,
): Promise<string[]> {
  const keys: string[] = []
  const seen = new Set<string>()
  const add = (value: string | null | undefined) => addKey(keys, seen, value)

  // Prefer canonical / team keys first so mistaken SBTH74B loses to BTH74B.
  add(canonicalizeShareClassBeianCode(beianHao))
  add(resolveFofValuationCodeAlias(beianHao))
  addShareClassFamilyKeys(keys, seen, beianHao)
  add(beianHao)

  const name = String(productName ?? "").trim()
  if (!name) return keys

  // Indexed 备案号 hit is enough; skip the 250k-row fuzzy name scan.
  if (await hasUsableTrackRow(keys)) return keys

  const strippedName = stripShareClassSuffix(name)
  try {
    const teamRows = await query<{ register_number: string | null }>(
      `SELECT register_number
       FROM type6_ops_team_full
       WHERE fund_short_name = $1
          OR fund_name = $1
          OR fund_short_name = $2
          OR fund_name = $2
          OR fund_short_name = $3
          OR fund_name = $3
       ORDER BY
         CASE
           WHEN fund_short_name = $1 OR fund_name = $1 THEN 0
           WHEN fund_short_name = $3 OR fund_name = $3 THEN 1
           ELSE 2
         END,
         updated_at DESC NULLS LAST,
         id DESC
       LIMIT 3`,
      [name, beianHao, strippedName || name],
    )
    for (const row of teamRows) {
      add(canonicalizeShareClassBeianCode(row.register_number))
      add(row.register_number)
      addShareClassFamilyKeys(keys, seen, row.register_number)
    }
  } catch {
    // team table may be unavailable
  }

  if (await hasUsableTrackRow(keys)) return keys

  const { terms, prefix } = fundElementNameTerms(name)
  try {
    const nameRows = await query<{ register_number: string | null; record_key: string | null }>(
      `SELECT register_number, record_key
       FROM basicinfo_bfl_track
       WHERE fund_name = ANY($1::text[])
          OR fund_short_name = ANY($1::text[])
          OR fund_name LIKE $2 || '%'
          OR fund_short_name LIKE $2 || '%'
       ORDER BY
         CASE WHEN ${sqlHasUsableFundElements()} THEN 0 ELSE 1 END,
         updated_at DESC NULLS LAST,
         id DESC
       LIMIT 5`,
      [terms, prefix],
    )
    for (const row of nameRows) {
      add(canonicalizeShareClassBeianCode(row.register_number))
      add(row.register_number)
      add(row.record_key)
      addShareClassFamilyKeys(keys, seen, row.register_number)
      addShareClassFamilyKeys(keys, seen, row.record_key)
    }
  } catch {
    // basicinfo table may be unavailable
  }

  return keys
}

export async function loadBasicinfoTrackByBeianKeys<T extends Record<string, unknown>>(
  keys: string[],
  selectSql: string,
  options?: LoadTrackByBeianOptions,
): Promise<T[]> {
  if (keys.length === 0) return []
  const expanded = options?.expandFamily === false
    ? [...new Set(keys.flatMap((key) => exactBeianWriteKeys(key)))]
    : expandBeianLookupKeys(keys)
  if (expanded.length === 0) return []
  return query<T>(
    `${selectSql}
     WHERE register_number = ANY($1::text[])
        OR record_key = ANY($1::text[])
     ORDER BY
       CASE WHEN ${sqlHasUsableFundElements()} THEN 0 ELSE 1 END,
       COALESCE(
         array_position(ARRAY(SELECT UPPER(BTRIM(x)) FROM unnest($1::text[]) AS x), UPPER(BTRIM(register_number))),
         array_position(ARRAY(SELECT UPPER(BTRIM(x)) FROM unnest($1::text[]) AS x), UPPER(BTRIM(record_key))),
         1000
       ),
       updated_at DESC NULLS LAST,
       id DESC
     LIMIT 1`,
    [expanded],
  )
}
