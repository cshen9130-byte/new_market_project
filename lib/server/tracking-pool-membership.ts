import { createHash } from "crypto"
import { HIDDEN_TEAM_POOL_KEYS } from "@/lib/client/tracking-pools"
import { query } from "@/lib/db"
import { invalidateListResponseCache } from "@/lib/server/list-response-cache"
import { canonicalProductCode, sqlCanonicalProductCode } from "@/lib/server/fund-holding-code"
import { resolveTrackingProductName } from "@/lib/server/tracking-product-name"

/** Standard register-number pool tables keyed by pool id. */
export const REGISTER_POOL_TABLE: Record<string, string> = {
  tracking: "tracking_pool",
  jy: "tracking_pool",
  selected: "selected_pool",
  core: "core_pool",
  hy: "hy_tracking_pool",
  fof: "fof_mom_tracking",
}

function sqlHiddenTeamPoolKeys(): string {
  return [...HIDDEN_TEAM_POOL_KEYS].map((k) => `'${k.replace(/'/g, "''")}'`).join(", ")
}

/** True when `tracking_custom_pools` still has a visible team tab for this key. */
function sqlVisibleTeamPoolExists(keyPredicate: string): string {
  return `EXISTS (
      SELECT 1 FROM tracking_custom_pools c
      WHERE c.scope = 'team'
        AND ${keyPredicate}
        AND c.pool_key NOT LIKE '\\_\\_%'
        AND c.pool_key NOT IN (${sqlHiddenTeamPoolKeys()})
    )`
}

/**
 * Team 「全部」membership: union of sidebar 跟踪产品池 only.
 * Hidden BFL catalog tables (`private_fund_info_bfl`, `type6_ops_team_full`)
 * are the fund universe and must not appear on the 全部 tab.
 */
export function teamVisibleTrackingFundsUnionSql(): string {
  return `
        SELECT register_number AS beian_hao, product_name, 1 AS priority, imported_at AS added_at
          FROM tracking_pool WHERE register_number IS NOT NULL
            AND ${sqlVisibleTeamPoolExists("c.pool_key IN ('jy', 'tracking')")}
        UNION ALL SELECT register_number, product_name, 2, imported_at FROM selected_pool WHERE register_number IS NOT NULL
            AND ${sqlVisibleTeamPoolExists("c.pool_key = 'selected'")}
        UNION ALL SELECT register_number, product_name, 3, imported_at FROM core_pool WHERE register_number IS NOT NULL
            AND ${sqlVisibleTeamPoolExists("c.pool_key = 'core'")}
        UNION ALL SELECT register_number, product_name, 4, imported_at FROM hy_tracking_pool WHERE register_number IS NOT NULL
            AND ${sqlVisibleTeamPoolExists("c.pool_key = 'hy'")}
        UNION ALL SELECT register_number, product_name, 5, imported_at FROM fof_mom_tracking WHERE register_number IS NOT NULL
            AND ${sqlVisibleTeamPoolExists("c.pool_key = 'fof'")}
        UNION ALL SELECT register_number, product_name, 6, imported_at FROM user_custom_pool p
          WHERE p.register_number IS NOT NULL
            AND ${sqlVisibleTeamPoolExists("c.pool_key = p.pool_key")}
  `
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

/** Client-only 「全部」 tabs — union views, not a real membership table. */
export function isAggregateTrackingPool(pool: string): boolean {
  return pool === "all" || pool === "mine_all"
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
  beian_hao = canonicalProductCode(beian_hao) || beian_hao.trim()
  product_name = await resolveTrackingProductName(beian_hao, product_name)
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

/**
 * Remove a fund from every visible pool that feeds 「全部」 / 「我的全部」.
 * Does not touch hidden BFL catalog tables.
 */
export async function removeFundFromAggregateTrackingPool(
  pool: string,
  beian_hao: string,
): Promise<void> {
  if (pool === "mine_all") {
    await query(
      `DELETE FROM user_custom_pool
       WHERE register_number = $1
         AND (pool_key = 'mine_default' OR pool_key LIKE 'mine_custom_%')`,
      [beian_hao],
    )
    return
  }
  if (pool !== "all") {
    await removeFundFromTrackingPool(pool, beian_hao)
    return
  }

  await query(
    `DELETE FROM tracking_pool
     WHERE register_number = $1
       AND ${sqlVisibleTeamPoolExists("c.pool_key IN ('jy', 'tracking')")}`,
    [beian_hao],
  )
  await query(
    `DELETE FROM selected_pool
     WHERE register_number = $1
       AND ${sqlVisibleTeamPoolExists("c.pool_key = 'selected'")}`,
    [beian_hao],
  )
  await query(
    `DELETE FROM core_pool
     WHERE register_number = $1
       AND ${sqlVisibleTeamPoolExists("c.pool_key = 'core'")}`,
    [beian_hao],
  )
  await query(
    `DELETE FROM hy_tracking_pool
     WHERE register_number = $1
       AND ${sqlVisibleTeamPoolExists("c.pool_key = 'hy'")}`,
    [beian_hao],
  )
  await query(
    `DELETE FROM fof_mom_tracking
     WHERE register_number = $1
       AND ${sqlVisibleTeamPoolExists("c.pool_key = 'fof'")}`,
    [beian_hao],
  )
  await query(
    `DELETE FROM user_custom_pool p
     WHERE p.register_number = $1
       AND ${sqlVisibleTeamPoolExists("c.pool_key = p.pool_key")}`,
    [beian_hao],
  )
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

const VALUATION_FILENAME_IDENTITY_SQL =
  `((COALESCE(register_number, '') ~ '估值报表|估值表' AND COALESCE(register_number, '') ~ '20\\d{2}')
    OR (COALESCE(product_name, '') ~ '估值报表|估值表' AND COALESCE(product_name, '') ~ '20\\d{2}'
        AND COALESCE(register_number, '') ~ '估值报表|估值表'))`

/** Drop pool/cache rows whose 备案号 is a 估值表 filename, not a product code. */
export async function purgeValuationFilenameIdentities(): Promise<number> {
  let deleted = 0
  const poolTables = [
    "user_custom_pool",
    "tracking_pool",
    "selected_pool",
    "core_pool",
    "hy_tracking_pool",
    "fof_mom_tracking",
  ]
  try {
    for (const table of poolTables) {
      const rows = await query<{ n: string }>(
        `WITH deleted AS (
           DELETE FROM ${table}
           WHERE ${VALUATION_FILENAME_IDENTITY_SQL}
           RETURNING 1
         )
         SELECT COUNT(*)::text AS n FROM deleted`,
      )
      deleted += parseInt(rows[0]?.n ?? "0", 10)
    }
    const extras = [
      `DELETE FROM ops_tracking_funds_list_cache
        WHERE beian_hao ~ '估值报表|估值表' AND beian_hao ~ '20\\d{2}'`,
      `DELETE FROM private_fund_info_bfl
        WHERE beian_hao ~ '估值报表|估值表' AND beian_hao ~ '20\\d{2}'`,
      `DELETE FROM type6_ops_team_full
        WHERE register_number ~ '估值报表|估值表' AND register_number ~ '20\\d{2}'`,
    ]
    for (const sql of extras) {
      const rows = await query<{ n: string }>(
        `WITH deleted AS (${sql} RETURNING 1)
         SELECT COUNT(*)::text AS n FROM deleted`,
      ).catch(() => [] as { n: string }[])
      deleted += parseInt(rows[0]?.n ?? "0", 10)
    }
    if (deleted > 0) invalidateTrackingPoolListCaches([])
  } catch (err) {
    console.warn("[tracking-pool] purge valuation-filename identities failed", err)
  }
  return deleted
}

/**
 * 诚奇睿盈对冲2号A类 was tracked twice: 备案号 QH717A and custodian ticker AAEO3A.
 * Drop the ticker when QH717A is already present; otherwise rewrite it in place.
 */
export async function collapseAliasedTrackingIdentities(): Promise<number> {
  let changed = 0
  const alias = "AAEO3A"
  const memberships: { table: string; col: string; scope?: string }[] = [
    { table: "tracking_pool", col: "register_number" },
    { table: "selected_pool", col: "register_number" },
    { table: "core_pool", col: "register_number" },
    { table: "hy_tracking_pool", col: "register_number" },
    { table: "fof_mom_tracking", col: "register_number" },
    { table: "user_custom_pool", col: "register_number", scope: "pool_key" },
    { table: "type6_ops_team_full", col: "register_number" },
    { table: "ops_tracking_funds_list_cache", col: "beian_hao" },
  ]
  try {
    for (const { table, col, scope } of memberships) {
      const canon = sqlCanonicalProductCode(`a.${col}`)
      const scopeSql = scope ? `AND b.${scope} = a.${scope}` : ""
      const aliasOnly = `UPPER(BTRIM(a.${col})) = '${alias}'`
      const deleted = await query<{ n: string }>(
        `WITH deleted AS (
           DELETE FROM ${table} a
           WHERE ${aliasOnly}
             AND ${canon} <> UPPER(BTRIM(a.${col}))
             AND EXISTS (
               SELECT 1 FROM ${table} b
               WHERE UPPER(BTRIM(b.${col})) = ${canon}
               ${scopeSql}
             )
           RETURNING 1
         )
         SELECT COUNT(*)::text AS n FROM deleted`,
      ).catch(() => [] as { n: string }[])
      changed += parseInt(deleted[0]?.n ?? "0", 10)

      const updated = await query<{ n: string }>(
        `WITH updated AS (
           UPDATE ${table} a
           SET ${col} = ${canon}
           WHERE ${aliasOnly}
             AND ${canon} <> UPPER(BTRIM(a.${col}))
           RETURNING 1
         )
         SELECT COUNT(*)::text AS n FROM updated`,
      ).catch(() => [] as { n: string }[])
      changed += parseInt(updated[0]?.n ?? "0", 10)
    }

    const canonCode = sqlCanonicalProductCode("a.underlying_product_code")
    const cacheDeletes = [
      `DELETE FROM ops_private_fund_detail_nav_cache a
        WHERE UPPER(BTRIM(COALESCE(a.beian_hao, ''))) = '${alias}'
           OR UPPER(BTRIM(COALESCE(a.cache_key, ''))) = '${alias}'`,
      `UPDATE ops_managed_fof_underlying a
        SET underlying_product_code = ${canonCode}
        WHERE UPPER(BTRIM(a.underlying_product_code)) = '${alias}'
          AND ${canonCode} <> UPPER(BTRIM(a.underlying_product_code))
          AND NOT EXISTS (
            SELECT 1 FROM ops_managed_fof_underlying b
            WHERE b.managed_product_id = a.managed_product_id
              AND b.valuation_date = a.valuation_date
              AND b.underlying_name = a.underlying_name
              AND b.subject_code IS NOT DISTINCT FROM a.subject_code
              AND UPPER(BTRIM(b.underlying_product_code)) = ${canonCode}
              AND b.ctid <> a.ctid
          )`,
    ]
    for (const sql of cacheDeletes) {
      const rows = await query<{ n: string }>(
        `WITH changed AS (${sql} RETURNING 1)
         SELECT COUNT(*)::text AS n FROM changed`,
      ).catch(() => [] as { n: string }[])
      changed += parseInt(rows[0]?.n ?? "0", 10)
    }
    if (changed > 0) invalidateTrackingPoolListCaches([])
  } catch (err) {
    console.warn("[tracking-pool] collapse aliased identities failed", err)
  }
  return changed
}

export function isKnownCustomPoolKey(poolKey: string, definedPoolKeys: ReadonlySet<string>): boolean {
  if (poolKey === "mine_default" || poolKey === "jy_ops") return true
  if (poolKey.startsWith("custom_") || poolKey.startsWith("mine_custom_")) {
    return definedPoolKeys.has(poolKey)
  }
  return true
}
