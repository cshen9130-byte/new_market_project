/** Simulate private-funds detail API nav_series for Ruinai funds. */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { loadMergedFundNavRows } from "../../lib/server/fund-nav-series"
import { lookupFundNavCorrectionRule } from "../../lib/server/fund-nav-correction-rules"

loadProjectEnvFiles()

async function main() {
  const funds = [
    { beian: "SBDF95", name: "锐耐稳健对冲11号私募证券投资基金" },
    { beian: "BDF95A", name: "锐耐稳健对冲11号A类" },
  ]
  for (const f of funds) {
    const rows = await loadMergedFundNavRows(f.beian, f.name, "")
    const rule = lookupFundNavCorrectionRule(f.beian, f.name)
    console.log(f.beian, "rule", rule?.series_start_date, "rows", rows.length)
    if (rows.length) console.log("  first", rows[0].price_date, "last", rows.at(-1)?.price_date)
  }
}

main().catch(console.error)
