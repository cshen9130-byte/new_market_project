/**
 * Read-only verification after Citics unit/cum swap repair.
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")

  const check = await query<{
    product_code: string
    nav_date: string
    nav: string
    cumulative_nav: string | null
  }>(
    `SELECT product_code, nav_date::text, nav::text, cumulative_nav::text
       FROM ops_email_nav_records
      WHERE (
            UPPER(BTRIM(product_code)) IN (
              'GM266C', 'SVM387', 'SBDF95', 'BDF95A',
              'SAXX01', 'SAYS34', 'SLQ349', 'SLQ415', 'SLS963',
              'SQH214', 'SSW176', 'SVM785', 'SVV962'
            )
          )
        AND nav_date >= DATE '2026-09-01'
      ORDER BY product_code, nav_date, id`,
  )
  for (const r of check) {
    const u = parseFloat(r.nav)
    const c = parseFloat(r.cumulative_nav ?? "")
    const flag = Number.isFinite(c) && Math.abs(u - c) > 0.0003 ? "split" : "flat"
    console.log(`${r.product_code}\t${r.nav_date}\t${r.nav}/${r.cumulative_nav}\t${flag}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
