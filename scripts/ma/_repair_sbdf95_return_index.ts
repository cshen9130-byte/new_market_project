/**
 * Remove Citics return-index rows mis-stored as unit NAV for SBDF95.
 * Safe via SSH tunnel:
 *   ssh -i "$env:USERPROFILE\.ssh\id_ed25519_george" -L 5433:127.0.0.1:5432 -N george@8.154.33.143
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_repair_sbdf95_return_index.ts
 *   npx tsx scripts/ma/_repair_sbdf95_return_index.ts --apply
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query, rawQuery } from "../../lib/db"
import {
  loadEmailNavSeries,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
} from "../../lib/server/email-nav-query"

loadProjectEnvFiles()

const BEIAN = "SBDF95"
const PRODUCT_NAME = "锐耐稳健对冲11号私募证券投资基金"
const SHORT_NAME = "锐耐稳健对冲11号"
const APPLY = process.argv.includes("--apply")

async function main() {
  const corrupt = await query<{ nav_date: string; nav: string; cumulative_nav: string | null }>(
    `SELECT nav_date::text, nav::text, cumulative_nav::text
     FROM ops_email_nav_records
     WHERE product_code = $1
       AND nav_date > '2026-07-01'
       AND nav >= 4
       AND cumulative_nav IS NOT NULL
       AND ABS(nav - cumulative_nav) / NULLIF(nav, 0) < 0.001
     ORDER BY nav_date`,
    [BEIAN],
  )

  console.log(`=== SBDF95 return-index rows to remove: ${corrupt.length} ===`)
  for (const r of corrupt) {
    console.log(`  ${r.nav_date}  unit=${r.nav}  cum=${r.cumulative_nav}`)
  }

  if (!APPLY) {
    console.log("\nDry run — pass --apply to delete.")
    return
  }

  if (corrupt.length === 0) {
    console.log("Nothing to delete.")
    return
  }

  const del = await rawQuery(
    `DELETE FROM ops_email_nav_records
     WHERE product_code = $1
       AND nav_date > '2026-07-01'
       AND nav >= 4
       AND cumulative_nav IS NOT NULL
       AND ABS(nav - cumulative_nav) / NULLIF(nav, 0) < 0.001`,
    [BEIAN],
  )
  console.log(`\nDeleted ${del.rowCount ?? 0} row(s).`)

  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, PRODUCT_NAME, SHORT_NAME)
  const email = await loadEmailNavSeries(BEIAN, PRODUCT_NAME)
  const merged = mergeNavSeriesWithEmail(legacy, email)
  const latest = merged.at(-1)
  const maxUnit = Math.max(...merged.map((r) => parseFloat(r.nav)))
  console.log("\n=== merged after repair ===")
  console.log("latest:", latest?.price_date, "unit", latest?.nav)
  console.log("max unit:", maxUnit)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
