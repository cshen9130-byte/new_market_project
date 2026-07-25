/**
 * Benchmark harness for the 在管产品 / FOF底层 list-cache rebuilds.
 *
 * Times each phase and prints a content hash after every pass, so a repeated run proves
 * the rebuild is idempotent (same inputs -> same cached values). Used to A/B planner,
 * index and query-shape changes without guessing which phase moved.
 *
 * as_of_date is excluded from the hash: it tracks the calendar day, not the computation.
 *
 * Usage (from the project root):
 *   npx tsx scripts/ma/_bench_list_cache.ts managed [passes]
 *   npx tsx scripts/ma/_bench_list_cache.ts fof [passes]
 *   npx tsx scripts/ma/_bench_list_cache.ts fof-skip-symbols [passes]
 *
 * Measured on the 2 vCPU host (2026-07-25, after 015/016 migrations):
 *   managed            ~85s   (77s of it resolving product identities)
 *   fof                ~3300s (dominated by backfillFundHoldingSymbols)
 */

import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()

const MANAGED_HASH_SQL = `
  SELECT count(*)::text AS rows, COALESCE(md5(string_agg(h, '' ORDER BY h)), '-') AS content_md5
  FROM (
    SELECT md5(ROW(managed_product_id, product_name, beian_hao, short_name, unit_nav, nav_date,
                   return_pct, ret_1w, ret_1m, ret_3m, ret_6m, ret_1y, sharpe_1y, calmar_1y,
                   company_strategy_l1, platform_strategy_l1, team_tags,
                   custody_balance, net_asset_value)::text) AS h
    FROM ops_managed_products_list_cache
  ) s`

const FOF_HASH_SQL = `
  SELECT count(*)::text AS rows, COALESCE(md5(string_agg(h, '' ORDER BY h)), '-') AS content_md5
  FROM (
    SELECT md5(ROW(fof_underlying_id, product_name, beian_hao, short_name, unit_nav, nav_date,
                   return_pct, ret_1w, ret_1m, ret_3m, ret_6m, ret_1y, sharpe_1y, calmar_1y,
                   company_strategy_l1, platform_strategy_l1, team_tags, market_value)::text) AS h
    FROM ops_fof_overview_list_cache
  ) s`

const elapsed = (from: number): number => +((Date.now() - from) / 1000).toFixed(1)

async function main() {
  const target = process.argv[2] ?? "managed"
  const passes = Math.max(1, parseInt(process.argv[3] ?? "1", 10))
  const isFof = target.startsWith("fof")
  const skipSymbolBackfill = target === "fof-skip-symbols"

  const { queryUnbounded } = await import("@/lib/db")
  const hashSql = isFof ? FOF_HASH_SQL : MANAGED_HASH_SQL

  const refresh = async (): Promise<number> => {
    if (isFof) {
      const { refreshManagedFofUnderlying } = await import(
        "@/lib/server/managed-fof-underlying-pg"
      )
      const t1 = Date.now()
      const under = await refreshManagedFofUnderlying({ skipSymbolBackfill })
      console.log(
        JSON.stringify({ phase: "refreshManagedFofUnderlying", seconds: elapsed(t1), rows: under }),
      )

      const { refreshFofOverviewListCache } = await import(
        "@/lib/server/fof-overview-list-cache-pg"
      )
      const t2 = Date.now()
      const overview = await refreshFofOverviewListCache()
      console.log(
        JSON.stringify({
          phase: "refreshFofOverviewListCache",
          seconds: elapsed(t2),
          rows: overview,
        }),
      )
      return under + overview
    }

    const { refreshManagedProductsListCache } = await import(
      "@/lib/server/managed-products-list-cache-pg"
    )
    return await refreshManagedProductsListCache()
  }

  for (let pass = 1; pass <= passes; pass++) {
    const t0 = Date.now()
    const rows = await refresh()
    const seconds = elapsed(t0)
    const [h] = await queryUnbounded<{ rows: string; content_md5: string }>(hashSql)
    console.log(JSON.stringify({ target, pass, rows, seconds, hash: h?.content_md5 }))
  }
  process.exit(0)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
