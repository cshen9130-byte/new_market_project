import { query } from "@/lib/db"
import { resolveFofValuationCodeAlias } from "@/lib/server/fund-holding-code"
import { canonicalizeShareClassBeianCode } from "@/lib/server/share-class-product"

/** Candidate 备案号 keys for 要素 lookup (wrong S-prefix + team register by name). */
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

  const name = String(productName ?? "").trim()
  if (name) {
    try {
      const teamRows = await query<{ register_number: string | null }>(
        `SELECT register_number
         FROM type6_ops_team_full
         WHERE fund_short_name = $1
            OR fund_name = $1
            OR fund_short_name = $2
            OR fund_name = $2
         ORDER BY
           CASE
             WHEN fund_short_name = $1 OR fund_name = $1 THEN 0
             ELSE 1
           END,
           updated_at DESC NULLS LAST,
           id DESC
         LIMIT 3`,
        [name, beianHao],
      )
      for (const row of teamRows) {
        add(canonicalizeShareClassBeianCode(row.register_number))
        add(row.register_number)
      }
    } catch {
      // team table may be unavailable
    }
  }

  add(beianHao)
  return keys
}

export async function loadBasicinfoTrackByBeianKeys<T extends Record<string, unknown>>(
  keys: string[],
  selectSql: string,
): Promise<T[]> {
  if (keys.length === 0) return []
  return query<T>(
    `${selectSql}
     WHERE register_number = ANY($1::text[]) OR record_key = ANY($1::text[])
     ORDER BY
       COALESCE(
         array_position(ARRAY(SELECT UPPER(BTRIM(x)) FROM unnest($1::text[]) AS x), UPPER(BTRIM(register_number))),
         array_position(ARRAY(SELECT UPPER(BTRIM(x)) FROM unnest($1::text[]) AS x), UPPER(BTRIM(record_key))),
         1000
       ),
       updated_at DESC NULLS LAST,
       id DESC
     LIMIT 1`,
    [keys],
  )
}
