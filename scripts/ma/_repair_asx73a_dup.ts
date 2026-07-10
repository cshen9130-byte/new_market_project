/**
 * Remove mislabeled parent SASX73 duplicate of ASX73A from custom_email_nav pool.
 * Usage (SSH tunnel):
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_repair_asx73a_dup.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { syncEmailTrackingPool } from "../../lib/server/email-tracking-pool-sync"
import { invalidateTrackingPoolListCaches } from "../../lib/server/tracking-pool-membership"
import { EMAIL_OPS_POOL_KEY } from "../../lib/server/email-tracking-pool-sync"

loadProjectEnvFiles()

async function main() {
  const before = await query(
    `SELECT register_number, product_name, pool_key
     FROM user_custom_pool
     WHERE register_number IN ('ASX73A', 'SASX73')
        OR product_name ILIKE '%豪鑫3号%A%'`,
  )
  console.log("BEFORE user_custom_pool:", before)

  const deleted = await query(
    `DELETE FROM user_custom_pool
     WHERE register_number = 'SASX73'
       AND product_name ILIKE '%A类%'
     RETURNING register_number, product_name, pool_key`,
  )
  console.log("Deleted:", deleted)

  const sync = await syncEmailTrackingPool()
  console.log("syncEmailTrackingPool:", sync)

  invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY, "all"])

  await query(
    `UPDATE ops_tracking_funds_list_cache
     SET product_name = '六妙星豪鑫3号'
     WHERE beian_hao = 'SASX73'`,
  )
  const { upsertTrackingFundListCacheEntry } = await import(
    "../../lib/server/tracking-funds-list-cache-pg"
  )
  await upsertTrackingFundListCacheEntry("ASX73A", "六妙星豪鑫3号A类")

  const after = await query(
    `SELECT register_number, product_name, pool_key
     FROM user_custom_pool
     WHERE register_number IN ('ASX73A', 'SASX73')
        OR product_name ILIKE '%豪鑫3号%A%'`,
  )
  console.log("AFTER user_custom_pool:", after)

  const cache = await query(
    `SELECT beian_hao, product_name, unit_nav::text, ret_1m::text
     FROM ops_tracking_funds_list_cache
     WHERE beian_hao IN ('ASX73A', 'SASX73')`,
  )
  console.log("cache:", cache)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
