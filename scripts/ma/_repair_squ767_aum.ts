/**
 * Delete SQU767 email rows where 基金资产净值 (AUM) was stored in nav (>1000).
 * Usage (SSH tunnel):
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_repair_squ767_aum.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"

loadProjectEnvFiles()

const BEIAN = "SQU767"

async function main() {
  const bad = await query<{ id: string; nav_date: string; nav: string; cumulative_nav: string | null }>(
    `SELECT id, nav_date::text, nav::text, cumulative_nav::text
     FROM ops_email_nav_records
     WHERE product_code = $1
       AND nav::numeric > 1000
     ORDER BY nav_date, id`,
    [BEIAN],
  )
  console.log("Corrupt AUM rows to delete:", bad.length)
  for (const row of bad) {
    console.log(`  ${row.nav_date} id=${row.id} nav=${row.nav} cum=${row.cumulative_nav}`)
  }
  if (bad.length === 0) {
    console.log("Nothing to delete.")
    return
  }

  const ids = bad.map((r) => r.id)
  const deleted = await query(
    `DELETE FROM ops_email_nav_records WHERE id = ANY($1::bigint[]) RETURNING id`,
    [ids],
  )
  console.log("Deleted:", deleted.length)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
