import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"

loadProjectEnvFiles()

async function main() {
  const rows = await query(
    `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text, product_name
     FROM private_fund_nav_group
     WHERE beian_hao = 'SAVM35' AND price_date >= '2026-02-01'
     ORDER BY price_date`,
  )
  const low = await query(
    `SELECT price_date::text, nav::text, cum_nav_withdrawal::text, cumulative_nav::text
     FROM private_fund_nav_group
     WHERE beian_hao = 'SAVM35' AND nav::numeric < 0.85
     ORDER BY price_date`,
  )
  console.log("nav_group unit<0.85:", low)

  const hy = await query(
    `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
     FROM private_fund_nav_group_hy
     WHERE beian_hao = 'SAVM35' AND price_date >= '2026-06-01'
     ORDER BY price_date DESC LIMIT 15`,
  )
  console.log("nav_group_hy tail:", hy)
}

main().catch(console.error)
