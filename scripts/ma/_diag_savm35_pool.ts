import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { loadEmailPoolFunds } from "../../lib/server/team-data-query-pg"
import { EMAIL_OPS_POOL_KEY } from "../../lib/server/email-tracking-pool-sync"

loadProjectEnvFiles()

async function main() {
  const pool = await query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = $1 AND (register_number = 'SAVM35' OR product_name ILIKE '%泰渊流%' OR product_name ILIKE '%笃照%' OR product_name ILIKE '%笃熙%')`,
    [EMAIL_OPS_POOL_KEY],
  )
  console.log("pool:", pool)

  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache
     WHERE beian_hao = 'SAVM35' OR product_name ILIKE '%泰渊流%'`,
  )
  console.log("cache:", cache)

  const email = await query(
    `SELECT nav_date::text, nav::text, product_code, fund_name, source, left(subject,100) AS subj
     FROM ops_email_nav_records
     WHERE product_code = 'SAVM35' OR fund_name ILIKE '%泰渊流%' OR subject ILIKE '%SAVM35%'
     ORDER BY nav_date DESC LIMIT 10`,
  )
  console.log("email nav:", email)

  const funds = await loadEmailPoolFunds()
  console.log(
    "loadEmailPoolFunds:",
    funds.filter((f) => f.register_number === "SAVM35" || f.product_name.includes("泰渊流")),
  )

  const parse = await query(
    `SELECT left(subject,120) AS subj, table_nav_status, valuation_status
     FROM ops_email_parse_records
     WHERE subject ILIKE '%SAVM35%' OR subject ILIKE '%泰渊流%'
     ORDER BY sent_at DESC LIMIT 5`,
  )
  console.log("parse records:", parse)
}

main().catch(console.error)
