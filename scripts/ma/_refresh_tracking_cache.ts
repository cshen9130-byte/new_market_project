/**
 * Refresh ops_tracking_funds_list_cache after period-return fix.
 * Usage (SSH tunnel):
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_refresh_tracking_cache.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { refreshTrackingFundsListCache } from "../../lib/server/tracking-funds-list-cache-pg"
import { query } from "../../lib/db"

loadProjectEnvFiles()

async function main() {
  const before = await query<{ beian_hao: string; ret_1m: string | null }>(
    `SELECT beian_hao, ret_1m::text FROM ops_tracking_funds_list_cache
     WHERE beian_hao IN ('ASX73A', 'SQU767', 'SBDW42', 'SBDF95', 'BAH99A')
     ORDER BY beian_hao`,
  )
  console.log("BEFORE sample:", before)

  const n = await refreshTrackingFundsListCache()
  console.log(`Refreshed ${n} rows`)

  const after = await query<{ beian_hao: string; unit_nav: string | null; nav_date: string | null; ret_1m: string | null; ret_3m: string | null }>(
    `SELECT beian_hao, unit_nav::text, nav_date::text, ret_1m::text, ret_3m::text
     FROM ops_tracking_funds_list_cache
     WHERE beian_hao IN ('ASX73A', 'SQU767', 'SBDW42', 'SBDF95', 'BAH99A')
     ORDER BY beian_hao`,
  )
  console.log("AFTER sample:", after)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
