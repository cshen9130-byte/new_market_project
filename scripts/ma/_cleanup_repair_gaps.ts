import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { refreshFofOverviewListCache } = await import(
    "../../lib/server/fof-overview-list-cache-pg"
  )

  // Keep only 泰来三号/四号 gap fills (Guotai TA was skipped). Drop other synthetic fills.
  const deleted = await query(
    `DELETE FROM ops_email_nav_records
     WHERE crawl_email_account = 'repair-guotai-ta-gap'
       AND product_code NOT IN ('BVC41A', 'AGT37A')
     RETURNING product_code, nav_date::text`,
  )
  console.log("deleted non-泰来 repair rows", deleted.length)

  await refreshFofOverviewListCache({ reuseResolvedIdentities: true })

  const probe = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text, return_pct::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao IN ('BVC41A','AVF39A','AGT37A','BHK26A')
        OR product_name ILIKE '%泰来%'
     ORDER BY beian_hao`,
  )
  for (const r of probe) {
    const ret = r.return_pct != null ? (parseFloat(r.return_pct) * 100).toFixed(2) + "%" : "null"
    console.log(`${r.beian_hao} ${r.product_name} ${r.nav_date} nav=${r.unit_nav} ret=${ret}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
