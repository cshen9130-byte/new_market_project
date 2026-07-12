/** Re-run metadata + cache refresh for SQQ26A after initial retag. */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { EMAIL_OPS_POOL_KEY } from "../../lib/server/email-tracking-pool-sync"
import { invalidateTrackingPoolListCaches } from "../../lib/server/tracking-pool-membership"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()

const BEIAN = "SQQ26A"
const PRODUCT = "笃熙禀泰文艺复兴26号"

async function main() {
  await query(
    `UPDATE ops_email_nav_records
     SET subject = REPLACE(COALESCE(subject, ''), 'SQQ300', $1),
         fund_name = REPLACE(COALESCE(fund_name, ''), 'SQQ300', $1),
         attachment_filename = REPLACE(COALESCE(attachment_filename, ''), 'SQQ300', $1)
     WHERE product_code = $1`,
    [BEIAN],
  )

  await query(
    `UPDATE user_custom_pool SET product_name = $2, updated_at = NOW()
     WHERE pool_key = $1 AND register_number = $3`,
    [EMAIL_OPS_POOL_KEY, PRODUCT, BEIAN],
  )

  await upsertTrackingFundListCacheEntry(BEIAN, PRODUCT)
  invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY, "all"])

  const asOf = new Date().toISOString().slice(0, 10)
  const identity = { beian_hao: BEIAN, product_name: PRODUCT, short_name: PRODUCT }
  const resolver = await BatchNavResolver.create([identity], asOf)
  const latest = resolver.resolveAt(identity, asOf)
  console.log("resolver latest:", latest)
  if (latest) {
    console.log("period:", resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date))
  }

  console.log(
    "cache:",
    await query(
      `SELECT beian_hao, product_name, nav_date::text, unit_nav::text, return_pct::text, ret_1m::text
       FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
      [BEIAN],
    ),
  )
  console.log(
    "pool:",
    await query(
      `SELECT register_number, product_name FROM user_custom_pool
       WHERE pool_key = $1 AND register_number = $2`,
      [EMAIL_OPS_POOL_KEY, BEIAN],
    ),
  )
}

main().catch(console.error)
