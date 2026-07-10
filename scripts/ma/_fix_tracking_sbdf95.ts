/**
 * Refresh SBDF95 row in ops_tracking_funds_list_cache after email NAV repair.
 * Usage (SSH tunnel):
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_fix_tracking_sbdf95.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"

loadProjectEnvFiles()

const BEIAN = "SBDF95"
const PRODUCT_NAME = "锐耐稳健对冲11号私募证券投资基金"

async function main() {
  const before = await query<{
    unit_nav: string | null
    nav_date: string | null
    return_pct: string | null
    ret_1w: string | null
    ret_1m: string | null
    ret_3m: string | null
    sharpe_1y: string | null
  }>(
    `SELECT unit_nav::text, nav_date::text, return_pct::text,
            ret_1w::text, ret_1m::text, ret_3m::text, sharpe_1y::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [BEIAN],
  )
  console.log("BEFORE:", before[0] ?? "(none)")

  await upsertTrackingFundListCacheEntry(BEIAN, PRODUCT_NAME)

  const after = await query<{
    unit_nav: string | null
    nav_date: string | null
    return_pct: string | null
    ret_1w: string | null
    ret_1m: string | null
    ret_3m: string | null
    sharpe_1y: string | null
  }>(
    `SELECT unit_nav::text, nav_date::text, return_pct::text,
            ret_1w::text, ret_1m::text, ret_3m::text, sharpe_1y::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [BEIAN],
  )
  console.log("AFTER:", after[0] ?? "(none)")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
