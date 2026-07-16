/**
 * Backfill SQX078 from 【虚拟净值】email (unit 1.1130, not 虚拟单位净值 1.0945).
 * Usage: npx tsx scripts/ma/_fix_sqx078.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"

loadProjectEnvFiles()

const SUBJECT =
  "【虚拟净值】SQX078_特夫郁金香全量化私募证券投资基金_衡颐海泰1号私募证券投资基金_2026-07-15"

async function main() {
  const { query } = await import("../../lib/db")
  const { upsertEmailNavRecords } = await import("../../lib/server/email-nav-pg")

  const wrong = await query(
    `SELECT id, nav_date::text, nav::text, source
     FROM ops_email_nav_records
     WHERE UPPER(TRIM(COALESCE(product_code, ''))) = 'SQX078'
       AND nav_date >= '2026-05-30'
       AND nav::numeric < 1.10`,
  )
  if (wrong.length > 0) {
    await query(
      `DELETE FROM ops_email_nav_records WHERE id = ANY($1::bigint[])`,
      [wrong.map((r) => r.id)],
    )
    console.log("deleted wrong low-unit rows:", wrong)
  }

  const existing = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text
     FROM ops_email_nav_records
     WHERE product_code = 'SQX078' AND nav_date = '2026-07-15'`,
  )
  if (existing.length === 0) {
    const r = await upsertEmailNavRecords([
      {
        crawlEmailAccount: "ch_c7h8@163.com",
        emailUid: "sqx078-backfill-20260715",
        sentAt: "2026-07-16T04:12:00.000Z",
        subject: SUBJECT,
        senderEmail: "services@gjdf.com.cn",
        navDate: "2026-07-15",
        nav: 1.113,
        cumulativeNav: 2.2767,
        adjustedNav: null,
        productCode: "SQX078",
        fundName: "特夫郁金香全量化私募证券投资基金",
        source: "body_table",
        attachmentFilename:
          "【虚拟净值】SQX078_特夫郁金香全量化私募证券投资基金_衡颐海泰1号私募证券投资基金_2026-07-15.xlsx",
      },
    ])
    console.log("inserted nav rows:", r)
  } else {
    console.log("2026-07-15 row already exists:", existing)
  }

  const {
    loadPrivateFundLegacyNavRows,
    loadEmailNavSeries,
    mergeNavSeriesWithEmail,
  } = await import("../../lib/server/email-nav-query")
  const legacy = await loadPrivateFundLegacyNavRows(
    "SQX078",
    "特夫郁金香全量化私募证券投资基金",
    "特夫郁金香全量化",
  )
  const email = await loadEmailNavSeries(
    "SQX078",
    "特夫郁金香全量化私募证券投资基金",
    "特夫郁金香全量化",
  )
  const merged = mergeNavSeriesWithEmail(legacy, email)
  const latest = merged[merged.length - 1]
  console.log("detail merge latest:", latest)
  console.log("\nRun: npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only --fof-only")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
