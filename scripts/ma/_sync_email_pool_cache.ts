import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { syncEmailTrackingPool } from "../../lib/server/email-tracking-pool-sync"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"

loadProjectEnvFiles()

async function main() {
  const sync = await syncEmailTrackingPool()
  console.log("sync:", sync)

  const pool = await query<{ register_number: string; product_name: string }>(
    `SELECT register_number, product_name FROM user_custom_pool WHERE pool_key = 'custom_email_nav'`,
  )
  let refreshed = 0
  for (const row of pool) {
    try {
      await upsertTrackingFundListCacheEntry(row.register_number, row.product_name)
      refreshed++
    } catch (err) {
      console.warn("cache failed", row.register_number, err)
    }
  }
  console.log("cache refreshed:", refreshed)

  const bangke = pool.filter(
    (r) => r.product_name.includes("邦客") || r.register_number.includes("邦客"),
  )
  console.log("邦客 in pool:", bangke)
}

main().catch(console.error)
