/**
 * Repair 尚艺量化全天候中波动版1号 2026-09-04:
 * Citics 【基金净值】 stored 累计单位净值 1.5793 as 单位净值.
 * Correct: unit 1.3358, cum 1.5793.
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const UNIT = 1.3358
const CUM = 1.5793
const DATES = ["2026-09-04"]
const CODES = ["SVM387", "SYM387", "SVM387(总)"]

async function main() {
  const { query } = await import("../../lib/db")
  const { invalidateDetailNavCache } = await import("../../lib/server/fund-detail-nav-cache-pg")

  const email = await query<{
    product_code: string
    nav_date: string
    nav: string
    cumulative_nav: string | null
    subject: string | null
    source: string | null
    fund_name: string | null
  }>(
    `SELECT product_code, nav_date::text, nav::text, cumulative_nav::text,
            subject, source, fund_name
       FROM ops_email_nav_records
      WHERE UPPER(BTRIM(product_code)) = ANY($1::text[])
         OR subject ILIKE '%SVM387%'
         OR subject ILIKE '%SYM387%'
         OR fund_name ILIKE '%尚艺量化全天候中波动%'
      ORDER BY nav_date DESC, id DESC
      LIMIT 20`,
    [CODES],
  )
  console.log("email rows:", email.length)
  for (const r of email) {
    console.log(
      `  ${r.product_code} ${r.nav_date} nav=${r.nav} cum=${r.cumulative_nav} src=${r.source} ${r.fund_name ?? ""}`,
    )
  }

  const siblings = await query<{
    product_code: string
    nav_date: string
    nav: string
    cumulative_nav: string | null
    subject: string | null
  }>(
    `SELECT product_code, nav_date::text, nav::text, cumulative_nav::text, subject
       FROM ops_email_nav_records
      WHERE nav_date = DATE '2026-09-04'
        AND source = 'attachment_nav_table'
        AND subject ILIKE '%【基金净值】%'
        AND ABS(nav - COALESCE(cumulative_nav, nav)) < 0.0002
        AND nav > 1.2
      ORDER BY product_code
      LIMIT 40`,
  )
  console.log("same-day citics nav==cum rows:", siblings.length)
  for (const r of siblings) {
    console.log(`  ${r.product_code} nav=${r.nav} ${r.subject ?? ""}`)
  }

  const platform = await query<{
    beian_hao: string
    price_date: string
    nav: string
    cumulative_nav: string | null
  }>(
    `SELECT beian_hao, price_date::text, nav::text, cumulative_nav::text
       FROM private_fund_nav
      WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])
        AND price_date = ANY($2::date[])
      ORDER BY price_date DESC`,
    [CODES, DATES],
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
        WHERE (
            UPPER(BTRIM(product_code)) = ANY($3::text[])
            OR subject ILIKE '%SVM387%'
            OR fund_name ILIKE '%尚艺量化全天候中波动%'
          )
          AND nav_date = ANY($4::date[])
          AND ABS(nav - $2) < 0.0002
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
    [UNIT, CUM, CODES, DATES],
  )
  console.log("email updated:", emailUpd[0]?.n)

  const platUpd = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE private_fund_nav
          SET nav = $1,
              cumulative_nav = $2
        WHERE UPPER(BTRIM(beian_hao)) = ANY($3::text[])
          AND price_date = ANY($4::date[])
          AND ABS(nav - $2) < 0.0002
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
    [UNIT, CUM, CODES, DATES],
  )
  console.log("platform updated:", platUpd[0]?.n)

  const cleared = await invalidateDetailNavCache(["SVM387", "SYM387"])
  console.log("detail cache cleared:", cleared)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
