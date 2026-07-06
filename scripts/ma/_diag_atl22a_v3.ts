/**
 * Check ops_managed_fof_underlying historical entries for ATL22A
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")

  // All historical entries for ATL22A in ops_managed_fof_underlying
  const holdings = await query(
    `SELECT valuation_date::text, underlying_product_code, underlying_name,
            price::text, quantity::text, market_value::text
     FROM ops_managed_fof_underlying
     WHERE underlying_product_code ILIKE '%ATL22%' OR underlying_name ILIKE '%木莲安澜%'
     ORDER BY valuation_date DESC
     LIMIT 20`,
  )
  console.log("ops_managed_fof_underlying for ATL22A/木莲安澜:")
  console.log(`count: ${holdings.length}`)
  for (const r of holdings) console.log(r)

  // Also check fof_underlying_summary for latest_return_pct
  const summary = await query(
    `SELECT id::text, product_name, latest_unit_nav::text, latest_nav_date::text,
            latest_return_pct::text
     FROM fof_underlying_summary
     WHERE product_name ILIKE '%木莲安澜%'
     LIMIT 5`,
  )
  console.log("\nfof_underlying_summary (ATL22A):")
  for (const r of summary) console.log(r)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
