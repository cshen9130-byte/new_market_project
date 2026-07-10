/**
 * Repair 荣熙恒盈2号 pool: separate SBAH99 parent, BAH99A, BAH99C + refresh caches.
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  syncEmailTrackingPool,
  EMAIL_OPS_POOL_KEY,
} from "../../lib/server/email-tracking-pool-sync"
import { invalidateTrackingPoolListCaches } from "../../lib/server/tracking-pool-membership"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"

loadProjectEnvFiles()

async function main() {
  console.log("BEFORE pool:")
  console.log(
    await query(
      `SELECT register_number, product_name FROM user_custom_pool
       WHERE pool_key = $1 AND product_name ILIKE '%恒盈2号%'`,
      [EMAIL_OPS_POOL_KEY],
    ),
  )

  await query(
    `DELETE FROM user_custom_pool
     WHERE pool_key = $1 AND register_number = 'SBAH99' AND product_name ILIKE '%A类%'`,
    [EMAIL_OPS_POOL_KEY],
  )

  const sync = await syncEmailTrackingPool()
  console.log("sync:", sync)

  for (const [beian, name] of [
    ["SBAH99", "荣熙恒盈2号"],
    ["BAH99A", "荣熙恒盈2号A类"],
    ["BAH99C", "荣熙恒盈2号C类"],
  ] as const) {
    await upsertTrackingFundListCacheEntry(beian, name)
  }

  await query(
    `DELETE FROM ops_tracking_funds_list_cache
     WHERE beian_hao = 'SBAH99' AND product_name ILIKE '%A类%'`,
  )

  invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY, "all"])

  console.log("\nAFTER pool:")
  console.log(
    await query(
      `SELECT register_number, product_name FROM user_custom_pool
       WHERE pool_key = $1 AND product_name ILIKE '%恒盈2号%'`,
      [EMAIL_OPS_POOL_KEY],
    ),
  )

  console.log("\nAFTER cache:")
  console.log(
    await query(
      `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
       FROM ops_tracking_funds_list_cache
       WHERE beian_hao IN ('SBAH99','BAH99A','BAH99C')`,
    ),
  )
}

main().catch(console.error)
