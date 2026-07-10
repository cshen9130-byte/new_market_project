/** Refresh SAVM35 cache after halved-unit rechain fix. */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"
import { loadMergedFundNavRows } from "../../lib/server/fund-nav-series"

loadProjectEnvFiles()

async function main() {
  const merged = await loadMergedFundNavRows("SAVM35", "笃熙景泰泰渊流1号", "")
  const tail = merged.filter((r) => r.price_date >= "2026-07-01").slice(-5)
  console.log("merged Jul tail:", tail)

  await upsertTrackingFundListCacheEntry("SAVM35", "笃熙景泰泰渊流1号")

  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = 'SAVM35'`,
  )
  console.log("cache:", cache)
}

main().catch(console.error)
