/**
 * Insert the rebased-NAV rows for BDF95A that the parser dropped from the
 * 20250808-20260710 backfill attachment (uid 211) — likely due to anomalous
 * date formatting on those rows.
 *
 * Dates were cross-checked against the parent fund's (SBDF95) confirmed daily
 * disclosure emails, since A-class and total-class NAV move almost identically:
 *   SBDF95 2026-07-09 = 4.7111  (exact match to one backfill row)
 *   SBDF95 2026-07-10 = 4.6690  (close match to the other backfill row, 4.6688)
 * The initial version of this script mislabeled these as 07-05 / 07-09 from a
 * blurry screenshot read; corrected to 07-09 / 07-10 here.
 *
 * On server:
 *   npx tsx scripts/ma/_fix_bdf95a_missing_rebase_rows.ts
 * Via SSH tunnel from local:
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_fix_bdf95a_missing_rebase_rows.ts
 */
import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()

const STALE_DATES = ["2026-07-05", "2026-07-09"] as const

const ROWS = [
  { nav_date: "2026-07-09", nav: "4.7111" },
  { nav_date: "2026-07-10", nav: "4.6688" },
] as const

const CRAWL_EMAIL_ACCOUNT = "data@jinyuasset.com"
const EMAIL_UID = "211"
const SUBJECT = "【基金净值】BDF95A(A级)_锐耐稳健对冲11号私募证券投资基金A类_20250808-20260710"
const ATTACHMENT_FILENAME = "【基金净值】锐耐稳健对冲11号私募证券投资基金A类(A级)__20250808-20260710.xlsx"
const SENDER_EMAIL = "Auto-Disclosure@citics.com"
const SOURCE = "attachment_nav_table"
const PRODUCT_CODE = "BDF95A"
const FUND_NAME = "锐耐稳健对冲11号A类"

async function main() {
  const { query } = await import("../../lib/db")
  const { ensureEmailNavTable } = await import("../../lib/server/email-nav-pg")
  await ensureEmailNavTable()

  const del = await query(
    `DELETE FROM ops_email_nav_records
     WHERE crawl_email_account = $1 AND email_uid = $2 AND attachment_filename = $3
       AND nav_date = ANY($4::date[])
     RETURNING nav_date::text, nav::text`,
    [CRAWL_EMAIL_ACCOUNT, EMAIL_UID, ATTACHMENT_FILENAME, STALE_DATES],
  )
  console.log("removed stale rows:", del)

  for (const row of ROWS) {
    const res = await query(
      `INSERT INTO ops_email_nav_records (
         crawl_email_account, email_uid, sent_at, subject, sender_email,
         attachment_filename, nav_date, nav, cumulative_nav, adjusted_nav,
         product_code, fund_name, source
       )
       VALUES (
         $1, $2, NOW(), $3, $4,
         $5, $6::date, $7::numeric, $7::numeric, $7::numeric,
         $8, $9, $10
       )
       ON CONFLICT (crawl_email_account, email_uid, nav_date, attachment_filename)
       DO UPDATE SET nav = EXCLUDED.nav, cumulative_nav = EXCLUDED.cumulative_nav, adjusted_nav = EXCLUDED.adjusted_nav
       RETURNING id, nav_date::text, nav::text`,
      [
        CRAWL_EMAIL_ACCOUNT, EMAIL_UID, SUBJECT, SENDER_EMAIL,
        ATTACHMENT_FILENAME, row.nav_date, row.nav,
        PRODUCT_CODE, FUND_NAME, SOURCE,
      ],
    )
    console.log("upserted:", res[0])
  }

  const { loadMergedFundNavRows } = await import("../../lib/server/fund-nav-series")
  const series = await loadMergedFundNavRows(PRODUCT_CODE, FUND_NAME, "")
  console.log("series len:", series.length)
  for (const r of series) console.log(r)

  const { upsertTrackingFundListCacheEntry } = await import("../../lib/server/tracking-funds-list-cache-pg")
  await upsertTrackingFundListCacheEntry(PRODUCT_CODE, FUND_NAME)
  const cache = await query(
    `SELECT beian_hao, unit_nav::text, nav_date::text, return_pct::text, ret_1w::text, ret_1m::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [PRODUCT_CODE],
  )
  console.log("cache after:", cache[0])
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
