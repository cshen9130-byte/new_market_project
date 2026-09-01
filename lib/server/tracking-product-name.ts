import { isCodeLikeProductName } from "@/lib/fund-display-name"
import { query } from "@/lib/db"

export { isCodeLikeProductName }

function preferDisplayName(
  full: string | null | undefined,
  short: string | null | undefined,
  fallback: string,
): string {
  const canonical = (full ?? "").trim() || fallback
  if (/[ABC]类/u.test(canonical)) return canonical
  return (short ?? "").trim() || canonical
}

/**
 * When a pool row stored the 备案号 as product_name, look up the real name
 * from BFL / type6 / private_fund_info (same sources as 团队数据).
 */
export async function resolveTrackingProductName(
  beianHao: string,
  fallback: string,
): Promise<string> {
  const code = beianHao.trim()
  const hint = fallback.trim() || code
  if (!code || !isCodeLikeProductName(hint, code)) return hint

  const rows = await query<{
    bfl_name: string | null
    bfl_short: string | null
    t6_name: string | null
    t6_short: string | null
    pi_name: string | null
  }>(
    `SELECT
       NULLIF(BTRIM(bfl.product_name), '') AS bfl_name,
       NULLIF(BTRIM(bfl.short_name), '') AS bfl_short,
       NULLIF(BTRIM(t6.fund_name), '') AS t6_name,
       NULLIF(BTRIM(t6.fund_short_name), '') AS t6_short,
       NULLIF(BTRIM(pi.product_name), '') AS pi_name
     FROM (SELECT $1::text AS beian) x
     LEFT JOIN private_fund_info_bfl bfl ON bfl.beian_hao = x.beian
     LEFT JOIN LATERAL (
       SELECT fund_name, fund_short_name
       FROM type6_ops_team_full t
       WHERE t.register_number = x.beian
       ORDER BY t.updated_at DESC NULLS LAST, t.id DESC
       LIMIT 1
     ) t6 ON true
     LEFT JOIN private_fund_info pi ON pi.beian_hao = x.beian`,
    [code],
  )
  const row = rows[0]
  const resolved = preferDisplayName(
    row?.bfl_name ?? row?.t6_name ?? row?.pi_name,
    row?.bfl_short ?? row?.t6_short,
    hint,
  )
  return isCodeLikeProductName(resolved, code) ? hint : resolved
}

/** Rewrite user_custom_pool rows whose product_name is only a 备案号. */
export async function repairCodeLikeCustomPoolProductNames(poolKey?: string): Promise<number> {
  const params: string[] = []
  const poolFilter = poolKey
    ? (params.push(poolKey), "AND p.pool_key = $1")
    : ""
  const stale = await query<{ id: number; register_number: string; product_name: string }>(
    `SELECT id, register_number, product_name
     FROM user_custom_pool p
     WHERE p.register_number IS NOT NULL
       AND (
         UPPER(BTRIM(p.product_name)) = UPPER(BTRIM(p.register_number))
         OR p.product_name ~ '^[A-Za-z0-9]{4,10}$'
       )
       ${poolFilter}`,
    params,
  )

  let updated = 0
  for (const row of stale) {
    const next = await resolveTrackingProductName(row.register_number, row.product_name)
    if (!next || next === row.product_name) continue
    await query(
      `UPDATE user_custom_pool
       SET product_name = $2, updated_at = NOW()
       WHERE id = $1 AND product_name = $3`,
      [row.id, next, row.product_name],
    )
    updated++
  }
  return updated
}
