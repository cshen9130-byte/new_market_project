import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()
process.env.DATABASE_URL =
  "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const { query } = await import("../../lib/db")
  const detail = await query(
    `SELECT tip_nav_date::text, tip_unit_nav::text, jsonb_array_length(nav_series) AS n,
            (nav_series->0->>'price_date') AS first_date,
            (nav_series->0->>'nav') AS first_nav,
            (nav_series->-1->>'price_date') AS last_date,
            (nav_series->-1->>'nav') AS last_nav
     FROM ops_private_fund_detail_nav_cache WHERE cache_key = 'JX860A'`,
  )
  const info = await query(
    `SELECT latest_nav_date::text, latest_nav::text, updated_at::text
     FROM private_fund_info WHERE UPPER(BTRIM(beian_hao)) = 'JX860A'`,
  )
  const tracking = await query(
    `SELECT beian_hao, nav_date::text, unit_nav::text, refreshed_at::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = 'JX860A'`,
  )
  const manual = await query(
    `SELECT COUNT(*)::text AS n, MAX(nav_date)::text AS tip, 
            (ARRAY_AGG(unit_nav::text ORDER BY nav_date DESC))[1] AS unit
     FROM ops_team_nav_manual
     WHERE UPPER(BTRIM(beian_hao)) = 'JX860A' AND nav_type = 'pre_fee'`,
  )
  console.log(JSON.stringify({ detail, info, tracking, manual }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
