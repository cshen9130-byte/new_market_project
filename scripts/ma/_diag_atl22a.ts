/**
 * Diagnose 木莲安澜1号A类 (ATL22A) empty return columns
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

const BEIAN = "ATL22A"
const PRODUCT_NAME = "木莲安澜1号A类"
const NAV_DATE = "2026-06-30"

async function main() {
  const { query } = await import("@/lib/db")
  const { BatchNavResolver } = await import("@/lib/server/list-cache-nav-batch")

  // 1. Email NAV records
  const emails = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text,
            COALESCE(product_code,'(null)') AS product_code,
            LEFT(fund_name, 80) AS fund_name, source,
            LEFT(subject, 80) AS subject,
            LEFT(attachment_filename, 80) AS attachment_filename
     FROM ops_email_nav_records
     WHERE fund_name ILIKE '%木莲安澜%' OR product_code ILIKE '%ATL22%' OR product_code ILIKE '%SATL22%'
     ORDER BY nav_date DESC, id DESC
     LIMIT 30`,
  )
  console.log("\n=== ops_email_nav_records ===")
  console.log(`count: ${emails.length}`)
  for (const r of emails) console.log(r)

  // 2. Legacy NAV tables
  const legacy = await query(
    `SELECT 'private_fund_nav_group' AS src, beian_hao, product_name, price_date::text, nav::text
     FROM private_fund_nav_group
     WHERE beian_hao ILIKE '%ATL22%' OR beian_hao ILIKE '%SATL22%' OR product_name ILIKE '%木莲安澜%'
     UNION ALL
     SELECT 'private_fund_nav_group_hy', beian_hao, product_name, price_date::text, nav::text
     FROM private_fund_nav_group_hy
     WHERE beian_hao ILIKE '%ATL22%' OR beian_hao ILIKE '%SATL22%' OR product_name ILIKE '%木莲安澜%'
     UNION ALL
     SELECT 'private_fund_nav', beian_hao, product_name, price_date::text, nav::text
     FROM private_fund_nav
     WHERE beian_hao ILIKE '%ATL22%' OR beian_hao ILIKE '%SATL22%' OR product_name ILIKE '%木莲安澜%'
     UNION ALL
     SELECT 'private_fund_nav_group_type6', beian_hao, product_name, price_date::text, nav::text
     FROM private_fund_nav_group_type6
     WHERE beian_hao ILIKE '%ATL22%' OR beian_hao ILIKE '%SATL22%' OR product_name ILIKE '%木莲安澜%'
     ORDER BY price_date DESC
     LIMIT 30`,
  )
  console.log("\n=== legacy NAV tables ===")
  console.log(`count: ${legacy.length}`)
  for (const r of legacy) console.log(r)

  // 3. Managed products cache
  const cache = await query(
    `SELECT product_name, beian_hao, unit_nav::text, nav_date::text,
            return_pct::text, ret_1w::text, ret_1m::text, ret_3m::text
     FROM ops_managed_products_list_cache
     WHERE product_name ILIKE '%木莲安澜%' OR beian_hao ILIKE '%ATL22%'`,
  )
  console.log("\n=== ops_managed_products_list_cache ===")
  for (const r of cache) console.log(r)

  // 4. managed_products table (latest_return_pct fallback)
  const mpCols = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'managed_products' ORDER BY ordinal_position LIMIT 30`,
  )
  console.log("\n=== managed_products columns ===", mpCols.map((c) => c.column_name).join(", "))

  const mp = await query(
    `SELECT id, product_name, latest_unit_nav::text, latest_nav_date::text,
            latest_return_pct::text, return_1w_pct::text, return_1m_pct::text,
            return_3m_pct::text, return_6m_pct::text
     FROM managed_products
     WHERE product_name ILIKE '%木莲安澜%'`,
  )
  console.log("\n=== managed_products ===")
  for (const r of mp) console.log(r)

  // Additional check: scan managed_products for this fund and nearby
  const mpAll = await query(
    `SELECT product_name, sequence_no, latest_unit_nav::text, latest_nav_date::text
     FROM managed_products
     WHERE product_name ILIKE $1
     LIMIT 5`,
    ['%ATL22%'],
  )
  console.log("\n=== managed_products search by ATL22 ===", mpAll)

  const mpCount = await query(`SELECT COUNT(*)::text AS n FROM managed_products`)
  console.log("managed_products total count:", mpCount[0]?.n)

  const mpSeq5 = await query(
    `SELECT product_name, sequence_no, latest_unit_nav::text, latest_nav_date::text
     FROM managed_products
     WHERE sequence_no BETWEEN 4 AND 7
     ORDER BY sequence_no`,
  )
  console.log("managed_products seq 4-7:", mpSeq5)

  // 5. BatchNavResolver diagnostic
  const identity = { beian_hao: BEIAN, product_name: PRODUCT_NAME, short_name: null }
  const resolver = await BatchNavResolver.create([identity], NAV_DATE)

  const navCurrent = resolver.resolveAt(identity, NAV_DATE)
  console.log(`\n=== BatchNavResolver.resolveAt(${NAV_DATE}) ===`)
  console.log(navCurrent)

  const navPrev = resolver.resolveAt(identity, "2026-06-27")
  console.log(`\n=== BatchNavResolver.resolveAt(2026-06-27, T-1 for previous week) ===`)
  console.log(navPrev)

  const nav30 = resolver.resolveAt(identity, "2026-05-30")
  console.log(`\n=== BatchNavResolver.resolveAt(2026-05-30, T-30) ===`)
  console.log(nav30)

  const period = resolver.calcPeriodReturns(identity, 1.102, NAV_DATE)
  console.log(`\n=== calcPeriodReturns ===`)
  console.log(period)

  const daily = resolver.calcDailyReturnPct(identity, 1.102, NAV_DATE, null)
  console.log(`\n=== calcDailyReturnPct (fallback=null) ===`)
  console.log(daily)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
