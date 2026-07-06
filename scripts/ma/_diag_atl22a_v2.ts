/**
 * Quick check: ATL22A in FOF overview cache and fof_underlying_summary
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")

  // 1. fof_underlying_summary (simple, no big joins)
  const fofSummary = await query(
    `SELECT id::text, product_name FROM fof_underlying_summary
     WHERE product_name ILIKE '%木莲安澜%'
     LIMIT 10`,
  )
  console.log("fof_underlying_summary:", fofSummary)

  // 2. FOF overview cache - check if ATL22A has a row
  const fofCache = await query(
    `SELECT fof_underlying_id::text, beian_hao,
            unit_nav::text, nav_date::text,
            return_pct::text, ret_1w::text, ret_1m::text, ret_3m::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao ILIKE '%ATL22%'
     LIMIT 5`,
  )
  console.log("fof_overview_list_cache ATL22:", fofCache)

  // 3. fof_underlying_detail for ATL22
  const detail = await query(
    `SELECT id::text, product_name, beian_hao
     FROM fof_underlying_detail
     WHERE beian_hao ILIKE '%ATL22%' OR product_name ILIKE '%木莲安澜%'
     LIMIT 10`,
  )
  console.log("fof_underlying_detail:", detail)

  // 4. private_fund_nav_group for SATL22 most recent
  const pnav = await query(
    `SELECT beian_hao, product_name, price_date::text, nav::text
     FROM private_fund_nav_group
     WHERE beian_hao = 'SATL22' OR product_name ILIKE '%木莲安澜1号A%'
     ORDER BY price_date DESC LIMIT 5`,
  )
  console.log("private_fund_nav_group SATL22 recent:", pnav)

  // 5. What does the slow-path SQL actually find for the ATL22A underlying?
  const slowPathNav = await query(
    `SELECT f.product_name,
       (SELECT ngc.nav::numeric FROM private_fund_nav_group ngc
        WHERE ngc.beian_hao = 'ATL22A'
        ORDER BY ngc.price_date DESC LIMIT 1) AS nav_by_atl22a,
       (SELECT ngc.nav::numeric FROM private_fund_nav_group ngc
        WHERE ngc.beian_hao = 'SATL22'
        ORDER BY ngc.price_date DESC LIMIT 1) AS nav_by_satl22,
       (SELECT ngc.nav::numeric FROM private_fund_nav_group ngc
        WHERE ngc.product_name = f.product_name
        ORDER BY ngc.price_date DESC LIMIT 1) AS nav_by_name
     FROM fof_underlying_summary f
     WHERE f.product_name ILIKE '%木莲安澜%'
     LIMIT 5`,
  )
  console.log("slow-path nav lookup:", slowPathNav)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
