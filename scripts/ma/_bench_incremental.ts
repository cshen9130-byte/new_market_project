/**
 * A/B the intraday (identity-reusing) cache refresh against the full rebuild.
 *
 * Runs the same function twice back to back — once in full mode, once in intraday mode —
 * and hashes the cache contents after each. Identical hashes prove the intraday path
 * reproduces the full rebuild exactly, so the shortcut costs no accuracy.
 *
 * Usage (from the project root):
 *   npx tsx scripts/ma/_bench_incremental.ts managed
 *   npx tsx scripts/ma/_bench_incremental.ts fof
 */

import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()

// as_of_date and refreshed_at are excluded: they track wall-clock, not the computation.
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

const secondsSince = (from: number): number => +((Date.now() - from) / 1000).toFixed(1)

async function main() {
  const target = process.argv[2] ?? "managed"
  const isFof = target === "fof"
  const { queryUnbounded } = await import("@/lib/db")
  const hashSql = isFof ? FOF_HASH_SQL : MANAGED_HASH_SQL

  const refresh = async (reuseResolvedIdentities: boolean): Promise<number> => {
    if (isFof) {
      const { refreshFofOverviewListCache } = await import(
        "@/lib/server/fof-overview-list-cache-pg"
      )
      return await refreshFofOverviewListCache({ reuseResolvedIdentities })
    }
    const { refreshManagedProductsListCache } = await import(
      "@/lib/server/managed-products-list-cache-pg"
    )
    return await refreshManagedProductsListCache({ reuseResolvedIdentities })
  }

  const runMode = async (mode: "full" | "intraday") => {
    const t0 = Date.now()
    const rows = await refresh(mode === "intraday")
    const seconds = secondsSince(t0)
    const [h] = await queryUnbounded<{ rows: string; content_md5: string }>(hashSql)
    const result = { target, mode, rows, seconds, hash: h?.content_md5 ?? "-" }
    console.log(JSON.stringify(result))
    return result
  }

  const full = await runMode("full")
  const intraday = await runMode("intraday")

  console.log(
    JSON.stringify({
      target,
      hashes_match: full.hash === intraday.hash,
      full_seconds: full.seconds,
      intraday_seconds: intraday.seconds,
      speedup: full.seconds > 0 ? +(full.seconds / Math.max(intraday.seconds, 0.1)).toFixed(1) : null,
    }),
  )
  process.exit(0)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
