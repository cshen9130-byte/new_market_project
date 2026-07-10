import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { listTeamData } from "../../lib/server/team-data-query-pg"

loadProjectEnvFiles()

async function main() {
  const kw = "荣熙共赢"
  const pool = await query(
    `SELECT id, register_number, product_name, source_file, source_row_number, imported_at::text
     FROM user_custom_pool
     WHERE pool_key = 'custom_email_nav'
       AND (product_name ILIKE $1 OR register_number ILIKE $1)
     ORDER BY register_number`,
    [`%${kw}%`],
  )
  console.log("pool rows:", pool)

  const nav = await query(
    `SELECT DISTINCT product_code, fund_name, nav_date::text, nav::text, left(subject,100) AS subj
     FROM ops_email_nav_records
     WHERE fund_name ILIKE $1 OR subject ILIKE $1 OR product_code ILIKE $1
     ORDER BY product_code, nav_date DESC`,
    [`%${kw}%`],
  )
  console.log("\nnav records:", nav)

  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache
     WHERE product_name ILIKE $1 OR beian_hao ILIKE $1`,
    [`%${kw}%`],
  )
  console.log("\ncache:", cache)

  const team = await listTeamData({
    page: 1,
    pageSize: 20,
    keyword: kw,
    strategySource: "company",
    strategyL1: "",
    strategyL2: "",
    strategyL3: "",
    sort: "product_name",
    sortDir: "ASC",
  })
  console.log("\nlistTeamData:", team.data)
}

main().catch(console.error)
