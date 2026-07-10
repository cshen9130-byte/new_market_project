/** Refresh SBHK26 cache after custody unit-inference fix. */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"
import { loadMergedFundNavRows } from "../../lib/server/fund-nav-series"

loadProjectEnvFiles()

async function main() {
  const merged = await loadMergedFundNavRows("SBHK26", "六妙星豪鑫6号", "")
  const jun29 = merged.find((r) => r.price_date.startsWith("2026-06-29"))
  console.log("2026-06-29 merged:", jun29)

  await upsertTrackingFundListCacheEntry("SBHK26", "六妙星豪鑫6号")

  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = 'SBHK26'`,
  )
  console.log("cache:", cache)
}

main().catch(console.error)
