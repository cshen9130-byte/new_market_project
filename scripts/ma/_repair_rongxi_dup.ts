import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { syncEmailTrackingPool, EMAIL_OPS_POOL_KEY } from "../../lib/server/email-tracking-pool-sync"
import { invalidateTrackingPoolListCaches } from "../../lib/server/tracking-pool-membership"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"

loadProjectEnvFiles()

async function main() {
  const before = await query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = $1 AND product_name ILIKE '%荣熙共赢%'`,
    [EMAIL_OPS_POOL_KEY],
  )
  console.log("BEFORE pool:", before)

  const deleted = await query(
    `DELETE FROM user_custom_pool
     WHERE pool_key = $1 AND register_number = '荣熙共赢'
     RETURNING register_number, product_name`,
    [EMAIL_OPS_POOL_KEY],
  )
  console.log("Deleted pool rows:", deleted)

  const cacheDel = await query(
    `DELETE FROM ops_tracking_funds_list_cache
     WHERE beian_hao = '荣熙共赢'
     RETURNING beian_hao, product_name`,
  )
  console.log("Deleted cache rows:", cacheDel)

  const sync = await syncEmailTrackingPool()
  console.log("sync:", sync)

  await upsertTrackingFundListCacheEntry("SBNX55", "荣熙共赢")
  invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY, "all"])

  const after = await query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = $1 AND product_name ILIKE '%荣熙共赢%'`,
    [EMAIL_OPS_POOL_KEY],
  )
  console.log("AFTER pool:", after)

  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao IN ('SBNX55', '荣熙共赢')`,
  )
  console.log("cache:", cache)
}

main().catch(console.error)
