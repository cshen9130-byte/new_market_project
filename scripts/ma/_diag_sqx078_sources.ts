/**
 * Compare all NAV sources for SQX078 vs reference platform (~1.1130 on 2026-07-15).
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

const BEIAN = "SQX078"
const REF = { date: "2026-07-15", unit: 1.1130, cum: 2.3787, adj: 2.3844 }

async function main() {
  const { query } = await import("@/lib/db")

  const tables = [
    ["private_fund_nav", `beian_hao = $1`],
    ["private_fund_nav_group", `beian_hao = $1`],
    ["private_fund_nav_group_hy", `beian_hao = $1`],
    ["private_fund_nav_group_type6", `beian_hao = $1`],
  ] as const

  for (const [table, where] of tables) {
    const rows = await query<{ price_date: string; nav: string; cum: string; adj: string }>(
      `SELECT price_date::text,
              nav::text,
              cum_nav_withdrawal::text AS cum,
              cumulative_nav::text AS adj
       FROM ${table}
       WHERE ${where}
         AND price_date >= '2026-05-01'
       ORDER BY price_date DESC
       LIMIT 12`,
      [BEIAN],
    )
    console.log(`\n=== ${table} (${rows.length} recent) ===`)
    for (const r of rows) console.log(r.price_date, "unit", r.nav, "cum", r.cum, "adj", r.adj)
  }

  const holdings = await query<{
    valuation_date: string
    price: string | null
    quantity: string | null
    market_value: string | null
    unit_nav: string | null
    fof: string
    name: string
  }>(
    `SELECT valuation_date::text,
            price::text, quantity::text, market_value::text, unit_nav::text,
            fof_product_name AS fof, underlying_name AS name
     FROM ops_managed_fof_underlying
     WHERE UPPER(TRIM(COALESCE(underlying_product_code, ''))) = $1
        OR underlying_name ILIKE '%郁金香%全量化%'
     ORDER BY valuation_date DESC
     LIMIT 10`,
    [BEIAN],
  )
  console.log("\n=== ops_managed_fof_underlying ===")
  for (const r of holdings) {
    console.log(r.valuation_date, "fof", r.fof, "price", r.price, "qty", r.quantity, "mv", r.market_value, "unit_nav", r.unit_nav)
  }

  const valHoldings = await query<{
    valuation_date: string
    price: string | null
    quantity: string | null
    market_value: string | null
    subject: string
    symbol: string | null
  }>(
    `SELECT r.valuation_date::text, h.price::text, h.quantity::text, h.market_value::text,
            h.subject_name AS subject, h.symbol
     FROM ops_email_valuation_holdings h
     JOIN ops_email_valuation_records r ON r.id = h.valuation_record_id
     WHERE (UPPER(TRIM(COALESCE(h.symbol, ''))) = $1 OR h.subject_name ILIKE '%郁金香%全量化%')
       AND r.valuation_date >= '2026-05-01'
     ORDER BY r.valuation_date DESC
     LIMIT 10`,
    [BEIAN],
  )
  console.log("\n=== ops_email_valuation_holdings ===")
  for (const r of valHoldings) {
    console.log(r.valuation_date, r.symbol, r.subject, "price", r.price, "qty", r.quantity, "mv", r.market_value)
  }

  const emails = await query<{ nav_date: string; nav: string; cum: string; source: string }>(
    `SELECT nav_date::text, nav::text, cumulative_nav::text AS cum, source
     FROM ops_email_nav_records
     WHERE UPPER(TRIM(COALESCE(product_code, ''))) = $1
        OR fund_name ILIKE '%郁金香%'
     ORDER BY nav_date DESC
     LIMIT 10`,
    [BEIAN],
  )
  console.log("\n=== ops_email_nav_records ===")
  for (const r of emails) console.log(r.nav_date, r.nav, r.cum, r.source)

  for (const table of ["private_fund_nav_group", "private_fund_nav_group_hy", "private_fund_nav"]) {
    const max = await query<{ max_date: string; n: string }>(
      `SELECT MAX(price_date)::text AS max_date, COUNT(*)::text AS n FROM ${table} WHERE beian_hao = $1`,
      [BEIAN],
    )
    console.log(`${table} max:`, max[0])
  }

  console.log("\n=== reference ===", REF)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
