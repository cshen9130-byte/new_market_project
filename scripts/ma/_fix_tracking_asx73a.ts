import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"

loadProjectEnvFiles()

async function main() {
  const beian = "ASX73A"
  const name = "六妙星豪鑫3号A类"
  const before = await query(
    `SELECT ret_1m::text, ret_3m::text, unit_nav::text, nav_date::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [beian],
  )
  console.log("BEFORE:", before[0])
  await upsertTrackingFundListCacheEntry(beian, name)
  const after = await query(
    `SELECT ret_1m::text, ret_3m::text, unit_nav::text, nav_date::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [beian],
  )
  console.log("AFTER:", after[0])
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
