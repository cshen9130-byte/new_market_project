import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { loadMergedFundNavRows } from "../../lib/server/fund-nav-series"

loadProjectEnvFiles()

async function main() {
  const merged = await loadMergedFundNavRows("SAVM35", "笃熙景泰泰渊流1号", "")
  const window = merged.filter((r) => r.price_date >= "2026-01-28" && r.price_date <= "2026-07-10")
  for (const r of window) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav)
  }
  const bad = merged.filter((r) => parseFloat(r.nav) < 0.8 && parseFloat(r.cum_nav_withdrawal) > 1.2)
  console.log("\nrows with unit<0.8 and cum>1.2:", bad.length)
  for (const r of bad.slice(0, 5)) console.log(r)
  for (const r of bad.slice(-5)) console.log(r)
}

main().catch(console.error)
