/** Add SVN917 天戈钻选CTA1号 back to pool (junk row SVN917/号 was removed). */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { addFundToTrackingPool, invalidateTrackingPoolListCaches } from "../../lib/server/tracking-pool-membership"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"
import { EMAIL_OPS_POOL_KEY } from "../../lib/server/email-tracking-pool-sync"

loadProjectEnvFiles()

async function main() {
  const beian = "SVN917"
  const name = "天戈钻选CTA1号"

  const exists = await query(
    `SELECT 1 FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2 LIMIT 1`,
    [EMAIL_OPS_POOL_KEY, beian],
  )
  if (exists.length) {
    console.log("Already in pool:", beian)
    return
  }

  const { created } = await addFundToTrackingPool(EMAIL_OPS_POOL_KEY, beian, name)
  console.log("created:", created)
  await upsertTrackingFundListCacheEntry(beian, name)
  invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY])

  const count = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM user_custom_pool WHERE pool_key = $1`,
    [EMAIL_OPS_POOL_KEY],
  )
  console.log("pool total:", count[0]?.n)
  console.log(
    "cache:",
    await query(
      `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
       FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
      [beian],
    ),
  )
}

main().catch(console.error)
