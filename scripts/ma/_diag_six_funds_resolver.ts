import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()

const cases = [
  { beian_hao: "青钱基石1号B", product_name: "青钱基石1号B类", short_name: null },
  { beian_hao: "SBDW42", product_name: "青钱基石1号", short_name: "青钱基石1号" },
  { beian_hao: "SB969A", product_name: "铸锋太阿3号A类", short_name: null },
  { beian_hao: "SY2965", product_name: "聚鸣积极成长2号", short_name: null },
  { beian_hao: "笃熙禀泰文艺复兴26号", product_name: "笃熙禀泰文艺复兴26号", short_name: null },
  { beian_hao: "SQQ300", product_name: "笃熙禀泰文艺复兴26号", short_name: null },
  { beian_hao: "ST9331", product_name: "格上安盈2号私募", short_name: null },
  { beian_hao: "SCQ804", product_name: "明汯中性6号1期", short_name: null },
]

async function main() {
  const asOf = "2026-07-11"
  const resolver = await BatchNavResolver.create(cases, asOf)
  for (const id of cases) {
    const latest = resolver.resolveAt(id, asOf)
    const hist = resolver.mergedHistory(id, "2025-01-01")
    const prev = latest
      ? resolver.resolvePreviousNav(id, latest.nav_date)
      : null
    const daily =
      latest != null
        ? resolver.calcDailyReturnPct(id, latest.nav, latest.nav_date, null)
        : null
    const period =
      latest != null
        ? resolver.calcPeriodReturns(id, latest.nav, latest.nav_date)
        : null
    console.log(`\n=== ${id.product_name} (${id.beian_hao}) ===`)
    console.log("latest:", latest)
    console.log("prev:", prev)
    console.log("history_len:", hist.length, "tail:", hist.slice(-3))
    console.log("daily_return:", daily)
    console.log("period:", period)
  }
}

main().catch(console.error)
