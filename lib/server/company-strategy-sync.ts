/**
 * Keep every list/filter surface in sync after 团队策略 writes.
 *
 * Source of truth: type6_ops_team_full.company_strategy_*.
 * List APIs often read precomputed PG caches; invalidating only the in-memory
 * response cache is not enough — those PG rows must be patched too.
 */

import { query } from "@/lib/db"
import { invalidateDetailResponseMemoryCache } from "@/lib/server/fund-detail-response-memory-cache"
import { upsertTrackingFundListCacheEntry } from "@/lib/server/tracking-funds-list-cache-pg"
import { invalidateTrackingPoolListCaches } from "@/lib/server/tracking-pool-membership"

export type CompanyStrategyUpdate = {
  beian_hao: string
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  product_name?: string | null
}

function companyJsonPayload(update: CompanyStrategyUpdate): string {
  return JSON.stringify({
    strategy_one: update.strategy_l1,
    strategy_two: update.strategy_l2,
    strategy_three: update.strategy_l3,
  })
}

async function patchTrackingListCache(update: CompanyStrategyUpdate): Promise<void> {
  const companyJson = companyJsonPayload(update)
  try {
    const updated = await query<{ beian_hao: string }>(
      `UPDATE ops_tracking_funds_list_cache
       SET company_strategy_l1 = $2,
           company_strategy_l2 = $3,
           company_strategy_l3 = $4,
           raw_strategy_json = CASE
             WHEN raw_strategy_json IS NULL THEN jsonb_build_object('company', $5::jsonb)
             ELSE jsonb_set(raw_strategy_json, '{company}', $5::jsonb, true)
           END,
           refreshed_at = NOW()
       WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))
       RETURNING beian_hao`,
      [
        update.beian_hao,
        update.strategy_l1,
        update.strategy_l2,
        update.strategy_l3,
        companyJson,
      ],
    )
    if (updated.length) return

    // No cache row yet — create one from type6/NAV, then re-apply company strategy.
    const productName = (update.product_name || "").trim() || update.beian_hao
    await upsertTrackingFundListCacheEntry(update.beian_hao, productName)
    await query(
      `UPDATE ops_tracking_funds_list_cache
       SET company_strategy_l1 = $2,
           company_strategy_l2 = $3,
           company_strategy_l3 = $4,
           raw_strategy_json = CASE
             WHEN raw_strategy_json IS NULL THEN jsonb_build_object('company', $5::jsonb)
             ELSE jsonb_set(raw_strategy_json, '{company}', $5::jsonb, true)
           END,
           refreshed_at = NOW()
       WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))`,
      [
        update.beian_hao,
        update.strategy_l1,
        update.strategy_l2,
        update.strategy_l3,
        companyJson,
      ],
    )
  } catch {
    // cache table may not exist yet
  }
}

async function patchManagedListCache(update: CompanyStrategyUpdate): Promise<void> {
  await query(
    `UPDATE ops_managed_products_list_cache
     SET company_strategy_l1 = $2,
         company_strategy_l2 = $3,
         company_strategy_l3 = $4,
         refreshed_at = NOW()
     WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))`,
    [update.beian_hao, update.strategy_l1, update.strategy_l2, update.strategy_l3],
  ).catch(() => undefined)
}

async function patchFofListCache(update: CompanyStrategyUpdate): Promise<void> {
  await query(
    `UPDATE ops_fof_overview_list_cache
     SET company_strategy_l1 = $2,
         company_strategy_l2 = $3,
         company_strategy_l3 = $4,
         refreshed_at = NOW()
     WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))`,
    [update.beian_hao, update.strategy_l1, update.strategy_l2, update.strategy_l3],
  ).catch(() => undefined)
}

async function patchInvestmentOverviewCaches(update: CompanyStrategyUpdate): Promise<void> {
  await Promise.all([
    query(
      `UPDATE ops_investment_overview_product_cache
       SET company_strategy_l1 = $2,
           company_strategy_l2 = $3,
           company_strategy_l3 = $4,
           refreshed_at = NOW()
       WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))`,
      [update.beian_hao, update.strategy_l1, update.strategy_l2, update.strategy_l3],
    ).catch(() => undefined),
    query(
      `UPDATE ops_investment_overview_underlying_cache
       SET company_strategy_l1 = $2,
           company_strategy_l2 = $3,
           company_strategy_l3 = $4,
           refreshed_at = NOW()
       WHERE UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))`,
      [update.beian_hao, update.strategy_l1, update.strategy_l2, update.strategy_l3],
    ).catch(() => undefined),
  ])
}

/** Patch list caches + bust response/detail caches after type6 company strategy writes. */
export async function syncCompanyStrategyCaches(
  updates: CompanyStrategyUpdate[],
): Promise<void> {
  const normalized = updates
    .map((u) => ({
      beian_hao: (u.beian_hao || "").trim(),
      strategy_l1: u.strategy_l1,
      strategy_l2: u.strategy_l2,
      strategy_l3: u.strategy_l3,
      product_name: u.product_name ?? null,
    }))
    .filter((u) => u.beian_hao)

  if (!normalized.length) {
    invalidateTrackingPoolListCaches([])
    return
  }

  await Promise.all(
    normalized.flatMap((update) => [
      patchTrackingListCache(update),
      patchManagedListCache(update),
      patchFofListCache(update),
      patchInvestmentOverviewCaches(update),
    ]),
  )

  invalidateDetailResponseMemoryCache(normalized.map((u) => u.beian_hao))
  invalidateTrackingPoolListCaches([])
}
