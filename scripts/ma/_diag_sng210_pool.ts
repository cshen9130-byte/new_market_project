import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { loadEmailPoolFunds } from "../../lib/server/team-data-query-pg"
import { EMAIL_OPS_POOL_KEY } from "../../lib/server/email-tracking-pool-sync"
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()

async function main() {
  const pool = await query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = $1
       AND (register_number = 'SNG210' OR product_name ILIKE '%多资产轮动策略2号%' OR product_name ILIKE '%多资产轮动策略3号%')`,
    [EMAIL_OPS_POOL_KEY],
  )
  console.log("pool rows:", pool)

  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache
     WHERE beian_hao = 'SNG210' OR product_name ILIKE '%多资产轮动策略2号%' OR product_name ILIKE '%多资产轮动策略3号%'`,
  )
  console.log("cache:", cache)

  const email = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, product_code, fund_name, source, subject
     FROM ops_email_nav_records
     WHERE product_code = 'SNG210' OR subject ILIKE '%SNG210%' OR fund_name ILIKE '%多资产轮动策略2号%'
     ORDER BY nav_date DESC LIMIT 10`,
  )
  console.log("email nav:", email)

  const funds = await loadEmailPoolFunds()
  console.log(
    "loadEmailPoolFunds:",
    funds.filter(
      (f) =>
        f.register_number === "SNG210"
        || f.product_name.includes("多资产轮动策略2号")
        || f.product_name.includes("多资产轮动策略3号"),
    ),
  )

  const bfl = await query(
    `SELECT beian_hao, product_name, short_name FROM private_fund_info_bfl
     WHERE beian_hao = 'SNG210' OR product_name ILIKE '%多资产轮动策略2号%' OR product_name ILIKE '%多资产轮动策略3号%'`,
  )
  console.log("bfl:", bfl)

  const asOfDate = new Date().toISOString().slice(0, 10)
  for (const [beian, name] of [
    ["SNG210", "笃熙禀泰多资产轮动策略2号"],
    ["SNG210", "笃照泰多资产轮动策略2号"],
    ["SQQ300", "笃熙禀泰多资产轮动策略3号"],
  ] as const) {
    const resolver = await BatchNavResolver.create(
      [{ beian_hao: beian, product_name: name, short_name: null }],
      asOfDate,
    )
    console.log(
      `resolver ${beian} / ${name}:`,
      resolver.resolveAt({ beian_hao: beian, product_name: name, short_name: null }, asOfDate),
    )
  }
}

main().catch(console.error)
