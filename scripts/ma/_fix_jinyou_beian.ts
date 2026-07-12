/**
 * Fix 金舆基石一号 → wrong page (古曲祥辰5号 / SXN097).
 *
 * Root cause: FOF virtual-NAV subjects
 *   金舆基石一号…【SXN097-古曲祥辰5号…】虚拟净值…
 * were stored as product_code=SXN097 + fund_name=金舆基石一号, so managed-product
 * beian resolution linked 金舆基石一号 to SXN097.
 *
 * Correct mapping: 金舆基石一号 = SAVW72, 古曲祥辰5号 = SXN097.
 *
 * Usage:
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_fix_jinyou_beian.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { resolveManagedProductBeian } from "../../lib/server/managed-product-beian"
import { refreshManagedProductsListCache } from "../../lib/server/managed-products-list-cache-pg"
import { EMAIL_OPS_POOL_KEY } from "../../lib/server/email-tracking-pool-sync"
import { invalidateTrackingPoolListCaches } from "../../lib/server/tracking-pool-membership"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"

loadProjectEnvFiles()

async function main() {
  console.log(
    "resolve override:",
    resolveManagedProductBeian("金舆基石一号", "SXN097"),
    resolveManagedProductBeian("古曲祥辰5号", null),
  )

  const retag = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE ops_email_nav_records
       SET fund_name = '古曲祥辰5号'
       WHERE product_code = 'SXN097'
         AND (
           fund_name ILIKE '%金舆基石%'
           OR subject ILIKE '%【SXN097-%古曲祥辰5%'
         )
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
  )
  console.log("Retagged SXN097 fund_name → 古曲祥辰5号:", retag[0]?.n)

  await query(
    `UPDATE user_custom_pool
     SET product_name = '古曲祥辰5号', updated_at = NOW()
     WHERE pool_key = $1 AND register_number = 'SXN097'
       AND product_name IS DISTINCT FROM '古曲祥辰5号'`,
    [EMAIL_OPS_POOL_KEY],
  )

  // Ensure SAVW72 pool row keeps 金舆基石一号
  await query(
    `UPDATE user_custom_pool
     SET product_name = '金舆基石一号', updated_at = NOW()
     WHERE pool_key = $1 AND register_number = 'SAVW72'
       AND product_name IS DISTINCT FROM '金舆基石一号'`,
    [EMAIL_OPS_POOL_KEY],
  )

  await upsertTrackingFundListCacheEntry("SXN097", "古曲祥辰5号")
  await upsertTrackingFundListCacheEntry("SAVW72", "金舆基石一号")

  const n = await refreshManagedProductsListCache()
  console.log("refreshed managed products cache rows:", n)
  invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY, "all"])

  const managed = await query(
    `SELECT m.product_name, cache.beian_hao, cache.nav_date::text, cache.unit_nav::text
     FROM managed_products m
     LEFT JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
     WHERE m.product_name ILIKE '%金舆基石%' OR m.product_name ILIKE '%古曲祥辰5%'`,
  )
  console.log("managed cache after:", managed)

  const pool = await query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = $1 AND register_number IN ('SXN097','SAVW72')`,
    [EMAIL_OPS_POOL_KEY],
  )
  console.log("pool:", pool)

  const nav = await query(
    `SELECT product_code, fund_name, COUNT(*)::int n
     FROM ops_email_nav_records
     WHERE product_code IN ('SXN097','SAVW72')
     GROUP BY 1,2 ORDER BY 1,2`,
  )
  console.log("nav labels:", nav)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
