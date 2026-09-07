/**
 * Repair GM266C 2026-09-04: Citics 【基金净值】 stored 累计单位净值 1.6983 as 单位净值.
 * Correct: unit 1.3398, cum 1.6983.
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const UNIT = 1.3398
const CUM = 1.6983
const DATES = ["2026-09-04", "2024-09-04"]

async function main() {
  const { query } = await import("../../lib/db")
  const { invalidateDetailNavCache } = await import("../../lib/server/fund-detail-nav-cache-pg")

  const email = await query<{
    id: string
    product_code: string
    nav_date: string
    nav: string
    cumulative_nav: string | null
    subject: string | null
    source: string | null
  }>(
    `SELECT id::text, product_code, nav_date::text, nav::text, cumulative_nav::text,
            subject, source
       FROM ops_email_nav_records
      WHERE UPPER(BTRIM(product_code)) IN ('GM266C', 'SGN266', 'GM266C(C级)')
         OR subject ILIKE '%GM266C%'
         OR fund_name ILIKE '%尚艺阳光1号%'
      ORDER BY nav_date DESC, id DESC
      LIMIT 15`,
  )
  console.log("email rows:", email.length)
  for (const r of email) {
    console.log(
      `  ${r.product_code} ${r.nav_date} nav=${r.nav} cum=${r.cumulative_nav} src=${r.source}`,
    )
  }

  const platform = await query<{
    beian_hao: string
    price_date: string
    nav: string
    cumulative_nav: string | null
  }>(
    `SELECT beian_hao, price_date::text, nav::text, cumulative_nav::text
       FROM private_fund_nav
      WHERE UPPER(BTRIM(beian_hao)) IN ('GM266C', 'SGN266')
        AND price_date = ANY($1::date[])
      ORDER BY price_date DESC`,
    [DATES],
  )
  console.log("platform rows:", platform.length)
  for (const r of platform) {
    console.log(`  ${r.beian_hao} ${r.price_date} nav=${r.nav} cum=${r.cumulative_nav}`)
  }

  const apply = process.argv.includes("--apply")
  if (!apply) {
    console.log("dry run; pass --apply to write")
    return
  }

  const emailUpd = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE ops_email_nav_records
          SET nav = $1,
              cumulative_nav = $2
        WHERE UPPER(BTRIM(product_code)) IN ('GM266C', 'GM266C(C级)')
          AND nav_date = ANY($3::date[])
          AND ABS(nav - $2) < 0.0002
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
    [UNIT, CUM, DATES],
  )
  console.log("email updated:", emailUpd[0]?.n)

  const platUpd = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE private_fund_nav
          SET nav = $1,
              cumulative_nav = $2
        WHERE UPPER(BTRIM(beian_hao)) IN ('GM266C', 'SGN266')
          AND price_date = ANY($3::date[])
          AND ABS(nav - $2) < 0.0002
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
    [UNIT, CUM, DATES],
  )
  console.log("platform updated:", platUpd[0]?.n)

  const cleared = await invalidateDetailNavCache(["GM266C", "SGN266"])
  console.log("detail cache cleared:", cleared)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
