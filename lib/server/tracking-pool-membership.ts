import { createHash } from "crypto"
import { query } from "@/lib/db"
import { invalidateListResponseCache } from "@/lib/server/list-response-cache"

/** Standard register-number pool tables keyed by pool id. */
export const REGISTER_POOL_TABLE: Record<string, string> = {
  tracking: "tracking_pool",
  jy: "tracking_pool",
  selected: "selected_pool",
  core: "core_pool",
  hy: "hy_tracking_pool",
  fof: "fof_mom_tracking",
}

export function isCustomTrackingPool(pool: string): boolean {
  return (
    pool.startsWith("custom_")
    || pool.startsWith("mine_custom_")
    || pool === "mine_default"
    || pool === "jy_ops"
  )
}

export function isWritableTrackingPool(pool: string): boolean {
  return (
    isCustomTrackingPool(pool)
    || pool === "bfl_ops"
    || pool === "bfl"
    || pool in REGISTER_POOL_TABLE
  )
}

function rowHash(pool: string, beian_hao: string, product_name: string): string {
  return createHash("sha256").update(`${pool}::${beian_hao}::${product_name}`).digest("hex")
}

/** Insert fund membership into the backing store for a pool. Returns whether a new row was created. */
export async function addFundToTrackingPool(
  pool: string,
  beian_hao: string,
  product_name: string,
): Promise<{ created: boolean }> {
  if (isCustomTrackingPool(pool)) {
    const hash = rowHash(pool, beian_hao, product_name)
    const rows = await query<{ id: number }>(
      `INSERT INTO user_custom_pool
         (pool_key, source_row_number, product_name, register_number, row_hash, source_file, imported_at, updated_at)
       SELECT $1,
              COALESCE((SELECT MAX(source_row_number) FROM user_custom_pool WHERE pool_key = $1), 0) + 1,
              $3, $2, $4, 'manual_add', NOW(), NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2
       )
       RETURNING id`,
      [pool, beian_hao, product_name, hash],
    )
    return { created: rows.length > 0 }
  }

  if (pool === "bfl_ops") {
    // SELECT first — market_user may lack INSERT on type6_ops_team_full, and
    // Postgres still requires INSERT privilege even when WHERE NOT EXISTS yields 0 rows.
    // Pre-selected membership in the add dialog would otherwise fail as db_error.
    const existing = await query<{ id: number }>(
      `SELECT id FROM type6_ops_team_full WHERE register_number = $1 LIMIT 1`,
      [beian_hao],
    )
    if (existing.length > 0) return { created: false }

    const hash = rowHash(pool, beian_hao, product_name)
    const rows = await query<{ id: number }>(
      `INSERT INTO type6_ops_team_full (
         source_row_number, fund_name, fund_short_name, register_number,
         row_hash, source_file, imported_at, updated_at
       )
       SELECT
         COALESCE((SELECT MAX(source_row_number) FROM type6_ops_team_full), 0) + 1,
         $2, $2, $1, $3, 'manual_add', NOW(), NOW()
       RETURNING id`,
      [beian_hao, product_name, hash],
    )
    return { created: rows.length > 0 }
  }

  if (pool === "bfl") {
    const rows = await query<{ beian_hao: string }>(
      `INSERT INTO private_fund_info_bfl (beian_hao, product_name, updated_at)
       SELECT $1, $2, NOW()
       WHERE NOT EXISTS (SELECT 1 FROM private_fund_info_bfl WHERE beian_hao = $1)
       RETURNING beian_hao`,
      [beian_hao, product_name],
    )
    return { created: rows.length > 0 }
  }

  const table = REGISTER_POOL_TABLE[pool]
  if (!table) throw new Error(`unknown_pool:${pool}`)

  const hash = rowHash(pool, beian_hao, product_name)
  const rows = await query<{ id: number }>(
    `WITH next_seq AS (SELECT COALESCE(MAX(source_row_number), 0) + 1 AS n FROM ${table})
     INSERT INTO ${table} (source_row_number, product_name, register_number, row_hash)
     SELECT ns.n, $2, $1, $3 FROM next_seq ns
     WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE register_number = $1)
     RETURNING id`,
    [beian_hao, product_name, hash],
  )
  return { created: rows.length > 0 }
}

export async function removeFundFromTrackingPool(pool: string, beian_hao: string): Promise<void> {
  if (isCustomTrackingPool(pool)) {
    await query(
      `DELETE FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2`,
      [pool, beian_hao],
    )
    return
  }

  if (pool === "bfl_ops") {
    await query(`DELETE FROM type6_ops_team_full WHERE register_number = $1`, [beian_hao])
    return
  }

  if (pool === "bfl") {
    await query(`DELETE FROM private_fund_info_bfl WHERE beian_hao = $1`, [beian_hao])
    return
  }

  const table = REGISTER_POOL_TABLE[pool]
  if (!table) throw new Error(`unknown_pool:${pool}`)
  await query(`DELETE FROM ${table} WHERE register_number = $1`, [beian_hao])
}

/** Bust list caches for affected pools plus the aggregated "all" tab. Pass [] to clear all. */
export function invalidateTrackingPoolListCaches(poolKeys: string[]): void {
  if (poolKeys.length === 0) {
    invalidateListResponseCache()
    return
  }
  for (const key of new Set([...poolKeys, "all"])) {
    invalidateListResponseCache(key)
  }
}

/** Remove fund memberships for custom pools that no longer exist in tracking_custom_pools. */
export async function purgeOrphanedCustomPoolMemberships(): Promise<number> {
  try {
    const rows = await query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM user_custom_pool u
         WHERE (u.pool_key LIKE 'custom\_%' OR u.pool_key LIKE 'mine_custom\_%')
           AND NOT EXISTS (
             SELECT 1 FROM tracking_custom_pools p WHERE p.pool_key = u.pool_key
           )
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM deleted`,
    )
    return Number(rows[0]?.count ?? 0)
  } catch {
    return 0
  }
}

export function isKnownCustomPoolKey(poolKey: string, definedPoolKeys: ReadonlySet<string>): boolean {
  if (poolKey === "mine_default" || poolKey === "jy_ops") return true
  if (poolKey.startsWith("custom_") || poolKey.startsWith("mine_custom_")) {
    return definedPoolKeys.has(poolKey)
  }
  return true
}
