/**
 * Keeps the shared team pool 邮箱运维池 (custom_email_nav) in sync with funds
 * discovered from email NAV parsing and FOF底层 估值表 holdings —
 * same resolution as 运维 → 团队数据.
 *
 * Called after nightly email_nav_parse so 投资 → 跟踪池 shows every email fund
 * without manual seeding.
 */

import { createHash } from "crypto"
import { query } from "@/lib/db"
import { isPlausibleEmailProductCode } from "@/lib/server/fund-name-match"
import { invalidateTrackingPoolListCaches, purgeValuationFilenameIdentities } from "@/lib/server/tracking-pool-membership"
import { loadEmailPoolFunds } from "@/lib/server/team-data-query-pg"
import { upsertTrackingFundListCacheEntry } from "@/lib/server/tracking-funds-list-cache-pg"
import { repairCodeLikeCustomPoolProductNames, resolveTrackingProductName } from "@/lib/server/tracking-product-name"

export const EMAIL_OPS_POOL_KEY = "custom_email_nav"
export const EMAIL_OPS_POOL_LABEL = "邮箱运维池"
const EMAIL_SYNC_SOURCES = ["email_nav_seed", "email_nav_etl"] as const
/** Name-only identity (no AMAC 备案号). Must stay outside EMAIL_SYNC_SOURCES so a
 *  colliding Citics 产品代码 sync cannot delete the disclosure-name row. */
const EMAIL_NAME_SOURCE = "email_nav_name"

function emailSyncSource(beianHao: string): string {
  return isPlausibleEmailProductCode(beianHao) ? "email_nav_etl" : EMAIL_NAME_SOURCE
}

export type EmailTrackingPoolSyncResult = {
  poolKey: string
  poolLabel: string
  inserted: number
  updated: number
  removed: number
  total: number
}

function rowHash(poolKey: string, beianHao: string, productName: string): string {
  return createHash("sha256").update(`${poolKey}::${beianHao}::${productName}`).digest("hex")
}

async function ensurePoolDefinition(): Promise<void> {
  await query(
    `INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
     SELECT $1, $2, 'team', '',
            COALESCE((SELECT MAX(sort_order) FROM tracking_custom_pools WHERE scope = 'team'), 0) + 1,
            NOW()
     ON CONFLICT (pool_key)
     DO UPDATE SET updated_at = NOW()`,
    [EMAIL_OPS_POOL_KEY, EMAIL_OPS_POOL_LABEL],
  )
}

/** All funds discovered from email (NAV, valuation, parse subjects). */
async function loadEmailSyncFunds(): Promise<{ beian_hao: string; product_name: string }[]> {
  const funds = await loadEmailPoolFunds()
  return funds.map((f) => ({
    beian_hao: f.register_number,
    product_name: f.product_name,
  }))
}

/**
 * Upsert every email-sync fund into custom_email_nav and drop ETL-managed rows
 * that no longer appear in ops_email_nav_records resolution.
 */
export async function syncEmailTrackingPool(): Promise<EmailTrackingPoolSyncResult> {
  await ensurePoolDefinition()
  await purgeValuationFilenameIdentities()
  const funds = await loadEmailSyncFunds()
  const targetBeians = new Set(funds.map((f) => f.beian_hao))

  let inserted = 0
  let updated = 0

  for (const fund of funds) {
    // Guard each fund individually: with 100+ funds processed sequentially,
    // one blocked/failing query (e.g. a lock wait that hits statement_timeout)
    // would otherwise throw and abort the entire sync for every remaining fund.
    try {
      const productName = await resolveTrackingProductName(fund.beian_hao, fund.product_name)
      const hash = rowHash(EMAIL_OPS_POOL_KEY, fund.beian_hao, productName)
      const sourceFile = emailSyncSource(fund.beian_hao)
      const rows = await query<{ inserted: boolean }>(
        `INSERT INTO user_custom_pool
           (pool_key, source_row_number, product_name, register_number, row_hash, source_file, imported_at, updated_at)
         SELECT $1,
                COALESCE((SELECT MAX(source_row_number) FROM user_custom_pool WHERE pool_key = $1), 0) + 1,
                $3, $2, $4, $5, NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2
         )
         RETURNING true AS inserted`,
        [EMAIL_OPS_POOL_KEY, fund.beian_hao, productName, hash, sourceFile],
      )

      if (rows.length > 0) {
        inserted++
        try {
          await upsertTrackingFundListCacheEntry(fund.beian_hao, productName)
        } catch (err) {
          console.warn("[email-tracking-pool-sync] cache upsert failed", fund.beian_hao, err)
        }
        continue
      }

      const nameUpdate = await query<{ ok: number }>(
        `UPDATE user_custom_pool
         SET product_name = $3, row_hash = $4, source_file = $5, updated_at = NOW()
         WHERE pool_key = $1 AND register_number = $2
           AND (product_name IS DISTINCT FROM $3 OR source_file IS DISTINCT FROM $5)
         RETURNING 1 AS ok`,
        [EMAIL_OPS_POOL_KEY, fund.beian_hao, productName, hash, sourceFile],
      )
      if (nameUpdate.length > 0) {
        updated++
        try {
          await upsertTrackingFundListCacheEntry(fund.beian_hao, productName)
        } catch (err) {
          console.warn("[email-tracking-pool-sync] cache upsert failed", fund.beian_hao, err)
        }
      }
    } catch (err) {
      console.warn("[email-tracking-pool-sync] fund sync failed, skipping", fund.beian_hao, err)
    }
  }

  let removed = 0
  if (targetBeians.size === 0) {
    const del = await query<{ n: string }>(
      `WITH deleted AS (
         DELETE FROM user_custom_pool
         WHERE pool_key = $1
           AND source_file = ANY($2::text[])
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM deleted`,
      [EMAIL_OPS_POOL_KEY, EMAIL_SYNC_SOURCES],
    )
    removed = parseInt(del[0]?.n ?? "0", 10)
  } else {
    const del = await query<{ n: string }>(
      `WITH deleted AS (
         DELETE FROM user_custom_pool p
         WHERE p.pool_key = $1
           AND p.source_file = ANY($2::text[])
           AND p.register_number IS NOT NULL
           AND NOT (p.register_number = ANY($3::text[]))
           AND NOT EXISTS (
             SELECT 1 FROM ops_email_nav_records e
              WHERE BTRIM(e.fund_name) IN (BTRIM(p.register_number), BTRIM(p.product_name))
           )
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM deleted`,
      [EMAIL_OPS_POOL_KEY, EMAIL_SYNC_SOURCES, Array.from(targetBeians)],
    )
    removed = parseInt(del[0]?.n ?? "0", 10)
  }

  const codedTargets = funds
    .map((f) => f.beian_hao.trim())
    .filter((beian) => isPlausibleEmailProductCode(beian))
  if (codedTargets.length > 0) {
    const nameDupes = await query<{ register_number: string }>(
      `DELETE FROM user_custom_pool p
       WHERE p.pool_key = $1
         AND p.source_file = $2
         AND EXISTS (
           SELECT 1 FROM user_custom_pool c
           WHERE c.pool_key = p.pool_key
             AND c.register_number = ANY($3::text[])
             AND (
               BTRIM(c.product_name) IN (BTRIM(p.product_name), BTRIM(p.register_number))
               OR BTRIM(p.product_name) IN (BTRIM(c.product_name), BTRIM(c.register_number))
             )
         )
       RETURNING p.register_number`,
      [EMAIL_OPS_POOL_KEY, EMAIL_NAME_SOURCE, codedTargets],
    )
    removed += nameDupes.length
    const staleNameKeys = nameDupes.map((r) => r.register_number).filter(Boolean)
    if (staleNameKeys.length > 0) {
      await query(
        `DELETE FROM ops_tracking_funds_list_cache WHERE beian_hao = ANY($1::text[])`,
        [staleNameKeys],
      ).catch(() => undefined)
    }
  }

  const repaired = await repairCodeLikeCustomPoolProductNames(EMAIL_OPS_POOL_KEY)
  updated += repaired

  const countRows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM user_custom_pool WHERE pool_key = $1`,
    [EMAIL_OPS_POOL_KEY],
  )

  invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY])

  return {
    poolKey: EMAIL_OPS_POOL_KEY,
    poolLabel: EMAIL_OPS_POOL_LABEL,
    inserted,
    updated,
    removed,
    total: parseInt(countRows[0]?.n ?? "0", 10),
  }
}
