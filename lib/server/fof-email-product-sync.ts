/**
 * FOF底层 products with email-sourced NAV (parent 估值表 holdings / list cache)
 * must also appear in 邮箱运维池 and 团队数据. Those two lists previously only
 * discovered funds from the underlying's own NAV / valuation emails.
 */

import { createHash } from "crypto"
import { query } from "@/lib/db"
import { SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF, sqlExcludeFofUnderlyingProduct, sqlSubjectNameIsStockCostBucket } from "@/lib/server/fund-holding-code"
import { sqlStripValuationSubjectPathPrefix } from "@/lib/server/fund-name-match"
import { ensureManagedFofUnderlyingTable } from "@/lib/server/managed-fof-underlying-pg"
import { invalidateTrackingPoolListCaches } from "@/lib/server/tracking-pool-membership"
import { isValuationStockCostSubjectName } from "@/lib/valuation-holding-display-name"

const EMAIL_OPS_POOL_KEY = "custom_email_nav"
const EMAIL_OPS_POOL_LABEL = "邮箱运维池"

export type FofEmailNavFund = {
  fund_key: string
  product_code: string | null
  fund_name: string | null
  team_nav_date: string
  team_nav: string
  updated_at: string
  first_entry_date: string
}

const ENSURE_TTL_MS = 60_000
let ensureAt = 0
let ensureInFlight: Promise<number> | null = null

function rowHash(poolKey: string, beianHao: string, productName: string): string {
  return createHash("sha256").update(`${poolKey}::${beianHao}::${productName}`).digest("hex")
}

function catalogName(col: string): string {
  return sqlStripValuationSubjectPathPrefix(col)
}

/** Distinct FOF underlyings that already have a latest NAV (same tip FOF底层 shows). */
export async function loadFofUnderlyingNavFunds(): Promise<FofEmailNavFund[]> {
  await ensureManagedFofUnderlyingTable().catch(() => undefined)

  const cacheRows = await query<FofEmailNavFund>(
    `SELECT DISTINCT ON (fund_key)
       fund_key,
       product_code,
       fund_name,
       team_nav_date,
       team_nav,
       updated_at,
       first_entry_date
     FROM (
       SELECT
         COALESCE(NULLIF(UPPER(BTRIM(beian_hao)), ''), BTRIM(product_name)) AS fund_key,
         NULLIF(UPPER(BTRIM(beian_hao)), '') AS product_code,
         NULLIF(BTRIM(COALESCE(NULLIF(short_name, ''), product_name)), '') AS fund_name,
         nav_date::text AS team_nav_date,
         unit_nav::text AS team_nav,
         refreshed_at::text AS updated_at,
         refreshed_at::text AS first_entry_date
       FROM ops_fof_overview_list_cache
       WHERE unit_nav IS NOT NULL
         AND nav_date IS NOT NULL
         AND NULLIF(BTRIM(product_name), '') IS NOT NULL
         AND product_name <> '合计'
         AND ${sqlExcludeFofUnderlyingProduct("product_name", "beian_hao")}
     ) c
     WHERE fund_key IS NOT NULL
     ORDER BY fund_key, team_nav_date DESC`,
  ).catch(() => [] as FofEmailNavFund[])

  const holdingRows = await query<FofEmailNavFund>(
    `SELECT DISTINCT ON (fund_key)
       fund_key,
       product_code,
       fund_name,
       team_nav_date,
       team_nav,
       updated_at,
       first_entry_date
     FROM (
       SELECT
         COALESCE(
           NULLIF(UPPER(BTRIM(m.underlying_product_code)), ''),
           BTRIM(${catalogName("m.underlying_name")})
         ) AS fund_key,
         NULLIF(UPPER(BTRIM(m.underlying_product_code)), '') AS product_code,
         NULLIF(BTRIM(${catalogName("m.underlying_name")}), '') AS fund_name,
         COALESCE(m.nav_date, m.valuation_date)::text AS team_nav_date,
         m.unit_nav::text AS team_nav,
         m.refreshed_at::text AS updated_at,
         m.refreshed_at::text AS first_entry_date
       FROM ops_managed_fof_underlying m
       WHERE m.unit_nav IS NOT NULL
         AND COALESCE(m.nav_date, m.valuation_date) IS NOT NULL
         AND NULLIF(BTRIM(m.underlying_name), '') IS NOT NULL
         AND m.underlying_name <> '合计'
         AND NOT ${SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF}
     ) h
     WHERE fund_key IS NOT NULL
     ORDER BY fund_key, team_nav_date DESC`,
  ).catch(() => [] as FofEmailNavFund[])

  const byKey = new Map<string, FofEmailNavFund>()
  for (const row of [...cacheRows, ...holdingRows]) {
    const key = (row.product_code || row.fund_key || "").trim().toUpperCase()
    if (!key) continue
    const prev = byKey.get(key)
    if (!prev || (row.team_nav_date || "").localeCompare(prev.team_nav_date || "") > 0) {
      byKey.set(key, row)
    }
  }
  return [...byKey.values()]
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

async function insertMissingPoolFunds(
  funds: { beian_hao: string; product_name: string }[],
): Promise<number> {
  if (funds.length === 0) return 0
  await ensurePoolDefinition()

  const unique = new Map<string, { beian_hao: string; product_name: string }>()
  for (const fund of funds) {
    const key = fund.beian_hao.trim().toUpperCase()
    if (!key || unique.has(key)) continue
    unique.set(key, { beian_hao: key, product_name: fund.product_name.trim() })
  }
  const rows = [...unique.values()]
  if (rows.length === 0) return 0

  const beians = rows.map((r) => r.beian_hao)
  const names = rows.map((r) => r.product_name)
  const hashes = rows.map((r) => rowHash(EMAIL_OPS_POOL_KEY, r.beian_hao, r.product_name))

  const inserted = await query<{ register_number: string; product_name: string }>(
    `WITH incoming AS (
       SELECT
         UPPER(BTRIM(t.beian)) AS register_number,
         BTRIM(t.name) AS product_name,
         t.hash AS row_hash,
         ROW_NUMBER() OVER (ORDER BY UPPER(BTRIM(t.beian))) AS rn
       FROM UNNEST($2::text[], $3::text[], $4::text[]) AS t(beian, name, hash)
     ),
     base AS (
       SELECT COALESCE(MAX(source_row_number), 0) AS src
       FROM user_custom_pool
       WHERE pool_key = $1
     ),
     added AS (
       INSERT INTO user_custom_pool
         (pool_key, source_row_number, product_name, register_number, row_hash, source_file, imported_at, updated_at)
       SELECT
         $1,
         b.src + i.rn,
         i.product_name,
         i.register_number,
         i.row_hash,
         'email_fof_nav',
         NOW(),
         NOW()
       FROM incoming i
       CROSS JOIN base b
       WHERE NOT EXISTS (
         SELECT 1 FROM user_custom_pool p
         WHERE p.pool_key = $1
           AND UPPER(BTRIM(p.register_number)) = i.register_number
       )
       RETURNING register_number, product_name
     )
     SELECT register_number, product_name FROM added`,
    [EMAIL_OPS_POOL_KEY, beians, names, hashes],
  )

  return inserted.length
}

/** Drop 估值表 股票成本_* parent buckets that leaked into 邮箱运维池 / list cache. */
async function purgeStockCostBucketPoolRows(): Promise<number> {
  const nameIsBucket = sqlSubjectNameIsStockCostBucket("product_name")
  const poolDel = await query<{ n: string }>(
    `WITH deleted AS (
       DELETE FROM user_custom_pool
       WHERE pool_key = $1 AND ${nameIsBucket}
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM deleted`,
    [EMAIL_OPS_POOL_KEY],
  )
  await query(
    `DELETE FROM ops_tracking_funds_list_cache
     WHERE ${sqlSubjectNameIsStockCostBucket("product_name")}
        OR ${sqlSubjectNameIsStockCostBucket("COALESCE(short_name, '')")}`,
  )
  const n = parseInt(poolDel[0]?.n ?? "0", 10)
  if (n > 0) invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY])
  return n
}

/**
 * Persist FOF底层 NAV products into 邮箱运维池 so the tracking list (which
 * reads user_custom_pool) shows them. Safe to call on list requests (60s TTL).
 */
export async function ensureFofUnderlyingInEmailPool(): Promise<number> {
  if (ensureInFlight) return ensureInFlight
  if (Date.now() - ensureAt < ENSURE_TTL_MS) return 0

  ensureInFlight = (async () => {
    const purged = await purgeStockCostBucketPoolRows().catch((err) => {
      console.warn("[fof-email-product-sync] stock-cost pool purge skipped:", err)
      return 0
    })
    const funds = await loadFofUnderlyingNavFunds()
    const candidates = funds
      .map((f) => ({
        beian_hao: (f.product_code || "").trim().toUpperCase(),
        product_name: (f.fund_name || "").trim(),
      }))
      .filter((f) => f.beian_hao && f.product_name && f.product_name.length >= 3)
      .filter((f) => !isValuationStockCostSubjectName(f.product_name))

    const inserted = await insertMissingPoolFunds(candidates)
    if (inserted > 0 || purged > 0) {
      invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY])
      try {
        const { invalidateListResponseCache } = await import("@/lib/server/list-response-cache")
        invalidateListResponseCache("ops-team-data")
      } catch {
        /* ignore */
      }
      try {
        const { invalidateTeamDataListCaches } = await import("@/lib/server/team-data-query-pg")
        invalidateTeamDataListCaches()
      } catch {
        /* ignore circular import during startup */
      }
      console.log(
        `[fof-email-product-sync] added ${inserted} FOF NAV fund(s) to 邮箱运维池` +
          (purged > 0 ? `; purged ${purged} 股票成本 row(s)` : ""),
      )
    }
    ensureAt = Date.now()
    return inserted
  })()

  try {
    return await ensureInFlight
  } finally {
    ensureInFlight = null
  }
}
