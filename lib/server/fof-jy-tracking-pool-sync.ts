/**
 * Keep JY跟踪池 (tracking_pool) in sync with 投资 → FOF底层 私募持仓.
 *
 * Add-only: newly held private-fund underlyings are inserted so 跟踪产品 does
 * not need a manual add. Products already in JY stay there after they leave
 * FOF 持仓中 (research / tags / history must not be wiped).
 *
 * Called after FOF auto-add (email 估值表) and on JY跟踪池 list requests.
 */

import { query } from "@/lib/db"
import { canonicalProductCode } from "@/lib/server/fund-holding-code"
import {
  SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF,
  sqlExcludeFofUnderlyingProduct,
  sqlIsPrivateFofUnderlying,
} from "@/lib/server/fund-holding-code"
import { sqlStripValuationSubjectPathPrefix } from "@/lib/server/fund-name-match"
import { ensureManagedFofUnderlyingTable } from "@/lib/server/managed-fof-underlying-pg"
import {
  addFundToTrackingPool,
  invalidateTrackingPoolListCaches,
} from "@/lib/server/tracking-pool-membership"
import { upsertTrackingFundListCacheEntry } from "@/lib/server/tracking-funds-list-cache-pg"
import {
  isValuationStockCostSubjectName,
  stripValuationSubjectPathPrefix,
} from "@/lib/valuation-holding-display-name"

export const JY_TRACKING_POOL_KEY = "jy"
export const JY_TRACKING_POOL_LABEL = "JY跟踪池"

const ENSURE_TTL_MS = 60_000
let ensureAt = 0
let ensureInFlight: Promise<FofJyTrackingPoolSyncResult> | null = null

export type FofJyTrackingPoolSyncResult = {
  poolKey: string
  poolLabel: string
  inserted: number
  skipped: number
  totalCandidates: number
}

export type FofJySyncFund = {
  beian_hao: string
  product_name: string
}

function catalogName(col: string): string {
  return sqlStripValuationSubjectPathPrefix(col)
}

function fofListDisplayNameSql(): string {
  return `CASE
    WHEN cache.short_name IS NOT NULL
      AND f.product_name ~ '[ABC]类'
      AND COALESCE(cache.short_name, '') !~ '[ABC]类'
    THEN f.product_name
    ELSE COALESCE(NULLIF(BTRIM(cache.short_name), ''), BTRIM(f.product_name))
  END`
}

function normalizeFunds(rows: { beian_hao: string; product_name: string }[]): FofJySyncFund[] {
  const byBeian = new Map<string, FofJySyncFund>()
  for (const row of rows) {
    const beian = canonicalProductCode(row.beian_hao)
    const name = stripValuationSubjectPathPrefix(row.product_name || "").trim() || (row.product_name || "").trim()
    if (!beian || name.length < 2) continue
    if (isValuationStockCostSubjectName(name)) continue
    const prev = byBeian.get(beian)
    if (!prev || name.length > prev.product_name.length) {
      byBeian.set(beian, { beian_hao: beian, product_name: name })
    }
  }
  return [...byBeian.values()]
}

async function loadFofCacheJySyncFunds(): Promise<FofJySyncFund[]> {
  const cacheRows = await query<{ beian_hao: string; product_name: string }>(
    `SELECT DISTINCT ON (beian_hao)
       beian_hao,
       product_name
     FROM (
       SELECT
         NULLIF(UPPER(BTRIM(cache.beian_hao)), '') AS beian_hao,
         ${fofListDisplayNameSql()} AS product_name
       FROM fof_underlying_summary f
       LEFT JOIN ops_fof_overview_list_cache cache ON cache.fof_underlying_id = f.id
       WHERE f.product_name <> '合计'
         AND NULLIF(BTRIM(f.product_name), '') IS NOT NULL
         AND NULLIF(BTRIM(cache.beian_hao), '') IS NOT NULL
         AND COALESCE(cache.market_value, 0) > 0
         AND ${sqlExcludeFofUnderlyingProduct("f.product_name", "cache.beian_hao")}
         AND ${sqlIsPrivateFofUnderlying("f.product_name", "cache.beian_hao")}
     ) x
     WHERE beian_hao IS NOT NULL
       AND NULLIF(BTRIM(product_name), '') IS NOT NULL
     ORDER BY beian_hao, LENGTH(product_name) DESC`,
  ).catch(() => [] as { beian_hao: string; product_name: string }[])
  return normalizeFunds(cacheRows)
}

async function loadFofHoldingJySyncFunds(): Promise<FofJySyncFund[]> {
  await ensureManagedFofUnderlyingTable().catch(() => undefined)
  const holdingRows = await query<{ beian_hao: string; product_name: string }>(
    `WITH latest AS (
       SELECT DISTINCT ON (m.managed_product_id)
         m.managed_product_id, m.valuation_date
       FROM ops_managed_fof_underlying m
       ORDER BY m.managed_product_id, m.valuation_date DESC
     )
     SELECT DISTINCT ON (beian_hao)
       beian_hao,
       product_name
     FROM (
       SELECT
         NULLIF(UPPER(BTRIM(m.underlying_product_code)), '') AS beian_hao,
         ${catalogName("m.underlying_name")} AS product_name,
         SUM(COALESCE(m.market_value, 0)) OVER (
           PARTITION BY NULLIF(UPPER(BTRIM(m.underlying_product_code)), '')
         ) AS held_mv
       FROM ops_managed_fof_underlying m
       INNER JOIN latest lv
         ON lv.managed_product_id = m.managed_product_id
        AND lv.valuation_date = m.valuation_date
       WHERE NULLIF(TRIM(m.underlying_name), '') IS NOT NULL
         AND m.underlying_name <> '合计'
         AND NOT ${SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF}
     ) h
     WHERE beian_hao IS NOT NULL
       AND NULLIF(BTRIM(product_name), '') IS NOT NULL
       AND held_mv > 0
       AND ${sqlExcludeFofUnderlyingProduct("product_name", "beian_hao")}
       AND ${sqlIsPrivateFofUnderlying("product_name", "beian_hao")}
     ORDER BY beian_hao, LENGTH(product_name) DESC`,
  ).catch(() => [] as { beian_hao: string; product_name: string }[])
  return normalizeFunds(holdingRows)
}

/** 私募 FOF底层 持仓中 products that have a 备案号 — same set as the FOF底层 default view. */
export async function loadFofUnderlyingJySyncFunds(options?: {
  includeHoldings?: boolean
}): Promise<FofJySyncFund[]> {
  const includeHoldings = options?.includeHoldings !== false
  const cacheFunds = await loadFofCacheJySyncFunds()
  if (!includeHoldings) return cacheFunds

  const holdingFunds = await loadFofHoldingJySyncFunds()
  const byBeian = new Map<string, FofJySyncFund>()
  for (const row of [...holdingFunds, ...cacheFunds]) {
    const prev = byBeian.get(row.beian_hao)
    if (!prev || row.product_name.length > prev.product_name.length) {
      byBeian.set(row.beian_hao, row)
    }
  }
  return [...byBeian.values()]
}

/**
 * Insert missing FOF底层 私募持仓 into JY跟踪池. Does not delete existing rows.
 */
export async function syncFofUnderlyingToJyTrackingPool(options?: {
  includeHoldings?: boolean
}): Promise<FofJyTrackingPoolSyncResult> {
  const funds = await loadFofUnderlyingJySyncFunds(options)
  const existing = await query<{ register_number: string }>(
    `SELECT register_number FROM tracking_pool
     WHERE register_number IS NOT NULL AND BTRIM(register_number) <> ''`,
  ).catch(() => [] as { register_number: string }[])

  const existingSet = new Set(
    existing.map((r) => (r.register_number || "").trim().toUpperCase()).filter(Boolean),
  )

  let inserted = 0
  let skipped = 0

  for (const fund of funds) {
    if (existingSet.has(fund.beian_hao)) {
      skipped++
      continue
    }
    try {
      const { created } = await addFundToTrackingPool(
        JY_TRACKING_POOL_KEY,
        fund.beian_hao,
        fund.product_name,
      )
      if (!created) {
        skipped++
        existingSet.add(fund.beian_hao)
        continue
      }
      inserted++
      existingSet.add(fund.beian_hao)
      try {
        await upsertTrackingFundListCacheEntry(fund.beian_hao, fund.product_name)
      } catch (err) {
        console.warn("[fof-jy-tracking-pool-sync] cache upsert failed", fund.beian_hao, err)
      }
    } catch (err) {
      console.warn("[fof-jy-tracking-pool-sync] fund sync failed, skipping", fund.beian_hao, err)
    }
  }

  if (inserted > 0) {
    invalidateTrackingPoolListCaches([JY_TRACKING_POOL_KEY, "tracking"])
    console.log(
      `[fof-jy-tracking-pool-sync] added ${inserted} FOF底层 fund(s) to ${JY_TRACKING_POOL_LABEL}` +
        ` (candidates=${funds.length}, already=${skipped})`,
    )
  }

  return {
    poolKey: JY_TRACKING_POOL_KEY,
    poolLabel: JY_TRACKING_POOL_LABEL,
    inserted,
    skipped,
    totalCandidates: funds.length,
  }
}

/** List-request wrapper: at most one sync per 60s, cache-only so the table stays snappy. */
export async function ensureFofUnderlyingInJyTrackingPool(): Promise<FofJyTrackingPoolSyncResult> {
  if (ensureInFlight) return ensureInFlight
  if (Date.now() - ensureAt < ENSURE_TTL_MS) {
    return {
      poolKey: JY_TRACKING_POOL_KEY,
      poolLabel: JY_TRACKING_POOL_LABEL,
      inserted: 0,
      skipped: 0,
      totalCandidates: 0,
    }
  }

  ensureInFlight = (async () => {
    try {
      return await syncFofUnderlyingToJyTrackingPool({ includeHoldings: false })
    } finally {
      ensureAt = Date.now()
    }
  })()

  try {
    return await ensureInFlight
  } finally {
    ensureInFlight = null
  }
}
