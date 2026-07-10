/**
 * Backfill SAUV26 邦客鼎成精选 from Guosen custody email + refresh tracking cache.
 * Re-run email_nav_etl --parse-only after deploy for full mailbox backfill.
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { upsertEmailNavRecords } from "../../lib/server/email-nav-pg"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"

loadProjectEnvFiles()

async function main() {
  const existing = await query(
    `SELECT nav_date::text, nav::text FROM ops_email_nav_records
     WHERE product_code = 'SAUV26' AND nav_date = '2026-07-09'`,
  )
  if (existing.length === 0) {
    const r = await upsertEmailNavRecords([
      {
        crawlEmailAccount: "ch_c7h8@163.com",
        emailUid: "sauv26-backfill-20260709",
        sentAt: "2026-07-10T00:48:00.000Z",
        subject: "SAUV26邦客鼎成精选私募证券投资基金净值2026-07-09【国信托管】",
        senderEmail: "gxtgwbhs@guosen.com.cn",
        navDate: "2026-07-09",
        nav: 1.3014,
        cumulativeNav: 1.3014,
        adjustedNav: null,
        productCode: "SAUV26",
        fundName: "邦客鼎成精选私募证券投资基金",
        source: "body_table",
        attachmentFilename: "",
      },
    ])
    console.log("inserted nav rows:", r)
  } else {
    console.log("2026-07-09 row already exists:", existing)
  }

  await upsertTrackingFundListCacheEntry("SAUV26", "邦客鼎成精选")
  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = 'SAUV26'`,
  )
  console.log("cache after refresh:", cache)
}

main().catch(console.error)
