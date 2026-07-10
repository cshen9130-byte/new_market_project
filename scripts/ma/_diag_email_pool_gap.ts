import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { listTeamData } from "../../lib/server/team-data-query-pg"
import { syncEmailTrackingPool, EMAIL_OPS_POOL_KEY } from "../../lib/server/email-tracking-pool-sync"

loadProjectEnvFiles()

async function main() {
  const [navKeys, poolN, teamAll] = await Promise.all([
    query<{ n: string }>(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(BTRIM(product_code),''), NULLIF(BTRIM(fund_name),'')))::text AS n
       FROM ops_email_nav_records WHERE nav IS NOT NULL`,
    ),
    query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM user_custom_pool WHERE pool_key = $1`,
      [EMAIL_OPS_POOL_KEY],
    ),
    listTeamData({
      page: 1,
      pageSize: 100_000,
      keyword: "",
      strategySource: "company",
      strategyL1: "",
      strategyL2: "",
      strategyL3: "",
      sort: "product_name",
      sortDir: "ASC",
    }),
  ])

  const emailSync = teamAll.data.filter((r) => r.product_source === "邮箱同步")
  const withBeian = emailSync.filter((r) => r.beian_hao?.trim())
  const noBeian = emailSync.filter((r) => !r.beian_hao?.trim())

  console.log("ops_email_nav_records distinct keys:", navKeys[0]?.n)
  console.log("listTeamData 邮箱同步:", emailSync.length, "with beian:", withBeian.length, "no beian:", noBeian.length)
  console.log("pool custom_email_nav:", poolN[0]?.n)

  if (noBeian.length > 0) {
    console.log("\nSample no-beian email funds:")
    console.log(noBeian.slice(0, 15).map((r) => ({ id: r.id, name: r.product_name, beian: r.beian_hao })))
  }

  const valKeys = await query<{ n: string }>(
    `SELECT COUNT(DISTINCT COALESCE(NULLIF(BTRIM(product_code),''), NULLIF(BTRIM(fund_name),'')))::text AS n
     FROM ops_email_valuation_records WHERE unit_nav IS NOT NULL`,
  )
  console.log("\nops_email_valuation_records distinct keys:", valKeys[0]?.n)

  const subjectHits = await query(
    `SELECT left(subject,120) AS subj, product_code, fund_name, nav_date::text
     FROM ops_email_nav_records
     WHERE subject ILIKE '%邦客%' OR fund_name ILIKE '%邦客%'
     LIMIT 5`,
  )
  console.log("\n邦客 in nav records:", subjectHits)

  const valHits = await query(
    `SELECT left(subject,120) AS subj, product_code, fund_name, valuation_date::text, unit_nav::text
     FROM ops_email_valuation_records
     WHERE subject ILIKE '%邦客%' OR fund_name ILIKE '%邦客%'
     LIMIT 5`,
  )
  console.log("邦客 in valuation records:", valHits)
}

main().catch(console.error)
