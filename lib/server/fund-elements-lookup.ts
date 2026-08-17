import { query } from "@/lib/db"
import {
  formatFeePayFormula,
  parseFeePayFormulaConfig,
} from "@/lib/ma/fund-elements-extra"
import { resolveFofValuationCodeAlias } from "@/lib/server/fund-holding-code"
import { sqlFundNameMatch } from "@/lib/server/fund-name-match"
import {
  beianFamilyKey,
  canonicalizeShareClassBeianCode,
  sqlBeianFamilyKey,
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
    OR NULLIF(BTRIM(COALESCE(${col("mandator_name")}, '')), '') IS NOT NULL
    OR ${col("fee_manage_rate")} IS NOT NULL
  )`
}

function addParentFamilyKeys(
  add: (value: string | null | undefined) => void,
  code: string | null | undefined,
) {
  const family = beianFamilyKey(code)
  if (!family) return
  add(family)
  add(`S${family}`)
}

/** Extra 申赎 columns from migration 018 (risk / lock / performance-fee formula). */
export async function loadFundElementExtraFields(keys: string[]): Promise<FundElementExtraFields> {
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
    )
    const row = rows[0]
    if (!row) return EMPTY_EXTRA_FIELDS
    const config = parseFeePayFormulaConfig(row.fee_pay_formula_json)
    return {
      risk_level: row.risk_level || null,
      lock_period_desc: row.lock_period_desc || null,
      fee_pay_formula: row.fee_pay_formula || formatFeePayFormula(config),
    }
  } catch {
    return EMPTY_EXTRA_FIELDS
  }
}

/** Candidate 备案号 keys for 要素 lookup (wrong S-prefix + parent/share-class family + name). */
export async function resolveFundElementsBeianKeys(
  beianHao: string,
  productName?: string | null,
): Promise<string[]> {
  const keys: string[] = []
  const seen = new Set<string>()
  const add = (value: string | null | undefined) => {
    const v = String(value ?? "").trim()
    if (!v) return
    const upper = v.toUpperCase()
    // Keep original casing of first-seen key for DB match (codes are stored uppercase-ish)
    if (seen.has(upper)) return
    seen.add(upper)
    keys.push(v)
  }

  // Prefer canonical / team keys first so mistaken SBTH74B loses to BTH74B.
  add(canonicalizeShareClassBeianCode(beianHao))
  add(resolveFofValuationCodeAlias(beianHao))
  addParentFamilyKeys(add, beianHao)

  const name = String(productName ?? "").trim()
  const strippedName = name ? stripShareClassSuffix(name) : ""
  if (name) {
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
        addParentFamilyKeys(add, row.register_number)
      }
    } catch {
      // team table may be unavailable
    }

    try {
      const nameRows = await query<{ register_number: string | null; record_key: string | null }>(
        `SELECT register_number, record_key
         FROM basicinfo_bfl_track
         WHERE (
           ${sqlFundNameMatch("fund_name", "$1")}
           OR ${sqlFundNameMatch("fund_short_name", "$1")}
         )
         ORDER BY
           CASE WHEN ${sqlHasUsableFundElements()} THEN 0 ELSE 1 END,
           updated_at DESC NULLS LAST,
           id DESC
         LIMIT 5`,
        [name],
      )
      for (const row of nameRows) {
        add(canonicalizeShareClassBeianCode(row.register_number))
        add(row.register_number)
        add(row.record_key)
        addParentFamilyKeys(add, row.register_number)
        addParentFamilyKeys(add, row.record_key)
      }
    } catch {
      // basicinfo table may be unavailable
    }
  }

  add(beianHao)
  addParentFamilyKeys(add, beianHao)
  return keys
}

export async function loadBasicinfoTrackByBeianKeys<T extends Record<string, unknown>>(
  keys: string[],
  selectSql: string,
): Promise<T[]> {
  if (keys.length === 0) return []
  const familyKeys = [...new Set(
    keys.map((key) => beianFamilyKey(key)).filter((key): key is string => Boolean(key)),
  )]
  return query<T>(
    `${selectSql}
     WHERE register_number = ANY($1::text[])
        OR record_key = ANY($1::text[])
        OR (
          CARDINALITY($2::text[]) > 0
          AND (
            ${sqlBeianFamilyKey("register_number")} = ANY($2::text[])
            OR ${sqlBeianFamilyKey("record_key")} = ANY($2::text[])
          )
        )
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
    [keys, familyKeys],
  )
}
