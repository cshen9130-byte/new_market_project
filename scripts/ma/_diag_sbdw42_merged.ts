import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { loadManualTeamNavBatch } from "../../lib/server/team-nav-manage-pg"
import { lookupManagedProductOverride } from "../../lib/server/managed-product-beian"
import { loadMergedFundNavRows } from "../../lib/server/fund-nav-series"

loadProjectEnvFiles()

async function main() {
  const beian = "SBDW42"
  console.log("override:", lookupManagedProductOverride(beian))
  const manual = await loadManualTeamNavBatch([beian])
  console.log("manual:", manual.get(beian)?.slice(-3))
  const rows = await loadMergedFundNavRows(beian, "青钱基石1号私募证券投资基金", "青钱基石1号")
  console.log("merged fund rows Jul:")
  for (const r of rows.filter((x) => x.price_date >= "2026-07-05")) {
    console.log(r.price_date, r.nav)
  }
}

main().catch(console.error)
