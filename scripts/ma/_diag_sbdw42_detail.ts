import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import {
  loadEmailNavSeries,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
  loadEmailNavManagePoints,
} from "../../lib/server/email-nav-query"
import { loadFundNavSeries } from "../../lib/server/fund-nav-series"
import { loadManagedProductNavSeed } from "../../lib/server/managed-product-nav-seed"

loadProjectEnvFiles()

const BEIAN = "SBDW42"
const PRODUCT = "青钱基石1号私募证券投资基金"
const SHORT = "青钱基石1号"

async function main() {
  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, PRODUCT, SHORT)
  const email = await loadEmailNavSeries(BEIAN, PRODUCT, SHORT)
  const merged = mergeNavSeriesWithEmail(legacy, email)
  const manage = await loadEmailNavManagePoints(BEIAN, PRODUCT, SHORT, "pre_fee")
  const seed = loadManagedProductNavSeed(BEIAN)
  const fundSeries = await loadFundNavSeries(BEIAN, PRODUCT, SHORT, { days: 30 })

  console.log("seed rows:", seed.length, seed.slice(-3))
  console.log("\nemail tail:", email.slice(-5))
  console.log("\nmanage tail:", manage.slice(-5))
  console.log("\nmerged tail:")
  for (const r of merged.filter((x) => x.price_date >= "2026-07-05")) {
    console.log(r.price_date, r.nav, r.price_change?.slice(0, 12))
  }
  console.log("\nfundSeries tail:", fundSeries.slice(-5))
}

main().catch(console.error)
