/**
 * Keeps the shared team pool 邮箱运维池 (custom_email_nav) in sync with funds
 * discovered from email NAV parsing — same resolution as 运维 → 团队数据.
 *
 * Called after nightly email_nav_parse so 投资 → 跟踪池 shows every email fund
 * without manual seeding.
 */

import { createHash } from "crypto"
import { query } from "@/lib/db"
import { invalidateListResponseCache } from "@/lib/server/list-response-cache"
import { listTeamData } from "@/lib/server/team-data-query-pg"
import { upsertTrackingFundListCacheEntry } from "@/lib/server/tracking-funds-list-cache-pg"

export const EMAIL_OPS_POOL_KEY = "custom_email_nav"
export const EMAIL_OPS_POOL_LABEL = "邮箱运维池"
const EMAIL_SYNC_SOURCES = ["email_nav_seed", "email_nav_etl"] as const

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

/** All email-synced team-data rows with a resolved 备案号. */
async function loadEmailSyncFunds(): Promise<{ beian_hao: string; product_name: string }[]> {
  const { data } = await listTeamData({
    page: 1,
    pageSize: 100_000,
    keyword: "",
    strategySource: "company",
    strategyL1: "",
    strategyL2: "",
    strategyL3: "",
    sort: "product_name",
    sortDir: "ASC",
  })

  const byBeian = new Map<string, string>()
  for (const row of data) {
    if (row.product_source !== "邮箱同步") continue
    const beian = row.beian_hao?.trim()
    const name = row.product_name.trim()
    if (!beian || !name) continue
    byBeian.set(beian, name)
  }
  return Array.from(byBeian.entries()).map(([beian_hao, product_name]) => ({
    beian_hao,
    product_name,
  }))
}

/**
 * Upsert every email-sync fund into custom_email_nav and drop ETL-managed rows
 * that no longer appear in ops_email_nav_records resolution.
 */
export async function syncEmailTrackingPool(): Promise<EmailTrackingPoolSyncResult> {
  await ensurePoolDefinition()
  const funds = await loadEmailSyncFunds()
  const targetBeians = new Set(funds.map((f) => f.beian_hao))

  let inserted = 0
  let updated = 0

  for (const fund of funds) {
    const hash = rowHash(EMAIL_OPS_POOL_KEY, fund.beian_hao, fund.product_name)
    const rows = await query<{ inserted: boolean }>(
      `INSERT INTO user_custom_pool
         (pool_key, source_row_number, product_name, register_number, row_hash, source_file, imported_at, updated_at)
       SELECT $1,
              COALESCE((SELECT MAX(source_row_number) FROM user_custom_pool WHERE pool_key = $1), 0) + 1,
              $3, $2, $4, 'email_nav_etl', NOW(), NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2
       )
       RETURNING true AS inserted`,
      [EMAIL_OPS_POOL_KEY, fund.beian_hao, fund.product_name, hash],
    )

    if (rows.length > 0) {
      inserted++
      try {
        await upsertTrackingFundListCacheEntry(fund.beian_hao, fund.product_name)
      } catch (err) {
        console.warn("[email-tracking-pool-sync] cache upsert failed", fund.beian_hao, err)
      }
      continue
    }

    const nameUpdate = await query<{ ok: number }>(
      `UPDATE user_custom_pool
       SET product_name = $3, row_hash = $4, source_file = 'email_nav_etl', updated_at = NOW()
       WHERE pool_key = $1 AND register_number = $2
         AND (product_name IS DISTINCT FROM $3 OR source_file IS DISTINCT FROM 'email_nav_etl')
       RETURNING 1 AS ok`,
      [EMAIL_OPS_POOL_KEY, fund.beian_hao, fund.product_name, hash],
    )
    if (nameUpdate.length > 0) updated++
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
         DELETE FROM user_custom_pool
         WHERE pool_key = $1
           AND source_file = ANY($2::text[])
           AND register_number IS NOT NULL
           AND NOT (register_number = ANY($3::text[]))
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM deleted`,
      [EMAIL_OPS_POOL_KEY, EMAIL_SYNC_SOURCES, Array.from(targetBeians)],
    )
    removed = parseInt(del[0]?.n ?? "0", 10)
  }

  const countRows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM user_custom_pool WHERE pool_key = $1`,
    [EMAIL_OPS_POOL_KEY],
  )

  invalidateListResponseCache(EMAIL_OPS_POOL_KEY)

  return {
    poolKey: EMAIL_OPS_POOL_KEY,
    poolLabel: EMAIL_OPS_POOL_LABEL,
    inserted,
    updated,
    removed,
    total: parseInt(countRows[0]?.n ?? "0", 10),
  }
}
