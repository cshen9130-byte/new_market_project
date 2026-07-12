import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"
import { query } from "../../lib/db"

loadProjectEnvFiles()

async function main() {
  const asOf = "2026-07-11"
  const cases = [
    { beian_hao: "笃熙禀泰文艺复兴26号", product_name: "笃熙禀泰文艺复兴26号", short_name: null },
    { beian_hao: "SQQ300", product_name: "笃熙禀泰文艺复兴26号", short_name: "笃熙禀泰文艺复兴26号" },
    { beian_hao: "SQQ300", product_name: "笃熙禀泰多资产轮动策略3号", short_name: null },
  ]

  const resolver = await BatchNavResolver.create(cases, asOf)
  for (const id of cases) {
    const latest = resolver.resolveAt(id, asOf)
    const hist = resolver.mergedHistory(id, "2026-04-01")
    console.log(`\n${id.beian_hao} / ${id.product_name}`)
    console.log("  latest:", latest)
    console.log("  hist:", hist.length, hist.slice(-3))
    if (latest) {
      console.log("  daily:", resolver.calcDailyReturnPct(id, latest.nav, latest.nav_date, null))
      console.log("  period:", resolver.calcPeriodReturns(id, latest.nav, latest.nav_date))
    }
  }

  const funds = await query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = 'custom_email_nav' AND (register_number ILIKE '%文艺复兴26%' OR register_number = 'SQQ300')`,
  )
  console.log("\npool:", funds)
}

main().catch(console.error)
