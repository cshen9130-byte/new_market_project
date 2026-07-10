import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"

loadProjectEnvFiles()

async function main() {
  const name = "%豪鑫3号%A%"
  const pools = [
    "tracking_pool",
    "selected_pool",
    "core_pool",
    "hy_tracking_pool",
    "fof_mom_tracking",
    "user_custom_pool",
    "type6_ops_team_full",
    "private_fund_info_bfl",
    "private_fund_info",
    "ops_tracking_funds_list_cache",
  ]
  for (const table of pools) {
    try {
      const cols =
        table === "type6_ops_team_full"
          ? "register_number AS beian, COALESCE(fund_short_name, fund_name) AS name"
          : table === "private_fund_info_bfl" || table === "private_fund_info"
            ? "beian_hao AS beian, product_name AS name"
            : table === "ops_tracking_funds_list_cache"
              ? "beian_hao AS beian, product_name AS name, unit_nav::text, nav_date::text, ret_1m::text, sharpe_1y::text"
              : "register_number AS beian, product_name AS name, pool_key"
      const rows = await query(
        `SELECT ${cols} FROM ${table}
         WHERE ${table === "type6_ops_team_full" ? "COALESCE(fund_short_name, fund_name)" : table === "private_fund_info_bfl" || table === "private_fund_info" ? "product_name" : table === "ops_tracking_funds_list_cache" ? "product_name" : "product_name"}
           ILIKE $1
            OR ${table === "type6_ops_team_full" ? "register_number" : table === "private_fund_info_bfl" || table === "private_fund_info" ? "beian_hao" : table === "ops_tracking_funds_list_cache" ? "beian_hao" : "register_number"} ILIKE '%ASX73%'`,
        [name],
      )
      if (rows.length) console.log(`\n=== ${table} ===`, rows)
    } catch (e) {
      console.log(`skip ${table}:`, (e as Error).message)
    }
  }
}

main().catch(console.error)
