/** Repair SNG210 pool name + refresh cache (BFL says 文艺复兴16号, emails say 多资产轮动策略2号). */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  syncEmailTrackingPool,
  EMAIL_OPS_POOL_KEY,
} from "../../lib/server/email-tracking-pool-sync"
import { invalidateTrackingPoolListCaches } from "../../lib/server/tracking-pool-membership"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"
import { loadEmailPoolFunds } from "../../lib/server/team-data-query-pg"

loadProjectEnvFiles()

async function main() {
  console.log("BEFORE:")
  console.log(
    await query(
      `SELECT register_number, product_name FROM user_custom_pool
       WHERE pool_key = $1 AND register_number = 'SNG210'`,
      [EMAIL_OPS_POOL_KEY],
    ),
  )

  const funds = await loadEmailPoolFunds()
  const sng = funds.find((f) => f.register_number === "SNG210")
  console.log("loadEmailPoolFunds SNG210:", sng)

  const sync = await syncEmailTrackingPool()
  console.log("sync:", sync)

  if (sng) {
    await upsertTrackingFundListCacheEntry(sng.register_number, sng.product_name)
  }

  invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY, "all"])

  console.log("\nAFTER pool:")
  console.log(
    await query(
      `SELECT register_number, product_name FROM user_custom_pool
       WHERE pool_key = $1 AND register_number = 'SNG210'`,
      [EMAIL_OPS_POOL_KEY],
    ),
  )

  console.log("\nAFTER cache:")
  console.log(
    await query(
      `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
       FROM ops_tracking_funds_list_cache WHERE beian_hao = 'SNG210'`,
    ),
  )
}

main().catch(console.error)
