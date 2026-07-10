import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { listTeamData } from "../../lib/server/team-data-query-pg"

loadProjectEnvFiles()

async function main() {
  const kw = process.argv[2] ?? "邦客"

  const emailRows = await query(
    `SELECT DISTINCT ON (COALESCE(NULLIF(BTRIM(product_code),''), NULLIF(BTRIM(fund_name),'')))
       product_code, fund_name, nav_date::text, nav::text, source, left(subject,100) AS subj
     FROM ops_email_nav_records
     WHERE fund_name ILIKE $1 OR subject ILIKE $1 OR product_code ILIKE $1
     ORDER BY COALESCE(NULLIF(BTRIM(product_code),''), NULLIF(BTRIM(fund_name),'')),
              nav_date DESC, id DESC`,
    [`%${kw}%`],
  )
  console.log("\nops_email_nav_records:", emailRows)

  const pool = await query(
    `SELECT register_number, product_name, pool_key, source_file
     FROM user_custom_pool
     WHERE pool_key = 'custom_email_nav'
       AND (product_name ILIKE $1 OR register_number ILIKE $1)`,
    [`%${kw}%`],
  )
  console.log("\nuser_custom_pool:", pool)

  const team = await listTeamData({
    page: 1,
    pageSize: 100,
    keyword: kw,
    strategySource: "company",
    strategyL1: "",
    strategyL2: "",
    strategyL3: "",
    sort: "product_name",
    sortDir: "ASC",
  })
  console.log("\nlistTeamData:", team.data)

  const poolTotal = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM user_custom_pool WHERE pool_key = 'custom_email_nav'`,
  )
  const emailSyncCount = team.data.filter((r) => r.product_source === "邮箱同步").length
  console.log("\npool total:", poolTotal[0]?.n, "team keyword matches:", team.total, "邮箱同步:", emailSyncCount)

  const noBeian = await query<{ n: string }>(
    `SELECT COUNT(DISTINCT COALESCE(NULLIF(BTRIM(product_code),''), NULLIF(BTRIM(fund_name),'')))::text AS n
     FROM ops_email_nav_records
     WHERE nav IS NOT NULL`,
  )
  console.log("distinct email fund keys:", noBeian[0]?.n)
}

main().catch(console.error)
