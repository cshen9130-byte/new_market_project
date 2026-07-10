/**
 * Backfill SB969A 铸锋太阿3号A类 from Changjiang 虚拟净值 email + fix name-only pool row.
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { upsertEmailNavRecords } from "../../lib/server/email-nav-pg"
import {
  syncEmailTrackingPool,
  EMAIL_OPS_POOL_KEY,
} from "../../lib/server/email-tracking-pool-sync"
import { invalidateTrackingPoolListCaches } from "../../lib/server/tracking-pool-membership"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"

loadProjectEnvFiles()

async function main() {
  const existing = await query(
    `SELECT nav_date::text, nav::text FROM ops_email_nav_records
     WHERE product_code = 'SB969A' AND nav_date = '2026-07-09'`,
  )
  if (existing.length === 0) {
    const r = await upsertEmailNavRecords([
      {
        crawlEmailAccount: "cwsj@hengyifund.cn",
        emailUid: "sb969a-backfill-20260709",
        sentAt: "2026-07-10T03:09:00.000Z",
        subject:
          "虚拟净值-铸锋太阿3号私募证券投资基金A类[衡顾海岳1号私募证券投资基金]-20260709.xls",
        senderEmail: "cjtgdata@pbcjsc.com",
        navDate: "2026-07-09",
        nav: 1.0,
        cumulativeNav: 1.0,
        adjustedNav: null,
        productCode: "SB969A",
        fundName: "铸锋太阿3号私募证券投资基金A类",
        source: "body_table",
        attachmentFilename:
          "虚拟净值-铸锋太阿3号私募证券投资基金A类[衡顾海岳1号私募证券投资基金]-20260709.xls",
      },
    ])
    console.log("inserted nav rows:", r)
  } else {
    console.log("2026-07-09 row already exists:", existing)
  }

  const deleted = await query(
    `DELETE FROM user_custom_pool
     WHERE pool_key = $1 AND register_number = '铸锋太阿3号A'
     RETURNING register_number, product_name`,
    [EMAIL_OPS_POOL_KEY],
  )
  console.log("Deleted name-only pool rows:", deleted)

  await query(
    `DELETE FROM ops_tracking_funds_list_cache
     WHERE beian_hao = '铸锋太阿3号A'
     RETURNING beian_hao, product_name`,
  )

  const sync = await syncEmailTrackingPool()
  console.log("sync:", sync)

  await upsertTrackingFundListCacheEntry("SB969A", "铸锋太阿3号A类")
  invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY, "all"])

  const pool = await query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = $1 AND product_name ILIKE '%铸锋太阿%'`,
    [EMAIL_OPS_POOL_KEY],
  )
  console.log("pool:", pool)

  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = 'SB969A'`,
  )
  console.log("cache:", cache)
}

main().catch(console.error)
