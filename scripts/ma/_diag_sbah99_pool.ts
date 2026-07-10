import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { loadEmailPoolFunds } from "../../lib/server/team-data-query-pg"
import { EMAIL_OPS_POOL_KEY } from "../../lib/server/email-tracking-pool-sync"

loadProjectEnvFiles()

async function main() {
  const pool = await query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = $1 AND (product_name ILIKE '%恒盈2号%' OR register_number IN ('SBAH99','BAH99A','BAH99C','SBAH99A','SBAH99C'))`,
    [EMAIL_OPS_POOL_KEY],
  )
  console.log("pool rows:", pool)

  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache
     WHERE product_name ILIKE '%恒盈2号%' OR beian_hao IN ('SBAH99','BAH99A','BAH99C')`,
  )
  console.log("cache:", cache)

  const funds = await loadEmailPoolFunds()
  console.log(
    "loadEmailPoolFunds:",
    funds.filter((f) => f.product_name.includes("恒盈2号") || ["SBAH99", "BAH99A", "BAH99C"].includes(f.register_number)),
  )

  const email = await query(
    `SELECT DISTINCT product_code, fund_name, max(nav_date)::text AS latest
     FROM ops_email_nav_records
     WHERE product_code IN ('SBAH99','BAH99A','BAH99C') OR fund_name ILIKE '%恒盈2号%'
     GROUP BY product_code, fund_name ORDER BY latest DESC`,
  )
  console.log("email distinct:", email)
}

main().catch(console.error)
