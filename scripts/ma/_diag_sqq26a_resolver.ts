import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"
import { query } from "../../lib/db"

loadProjectEnvFiles()

async function main() {
  const asOf = "2026-07-11"
  const cases = [
    { beian_hao: "SQQ26A", product_name: "笃熙禀泰文艺复兴26号", short_name: null },
    { beian_hao: "SQQ26A", product_name: "笃熙禀泰文艺复兴26号A类", short_name: null },
  ]

  const rows = await query(
    `SELECT nav_date::text, nav::text, product_code, left(fund_name,60) fn, source
     FROM ops_email_nav_records WHERE product_code = 'SQQ26A'
     ORDER BY nav_date DESC LIMIT 10`,
  )
  console.log("recent SQQ26A nav:", rows)

  const resolver = await BatchNavResolver.create(cases, asOf)
  for (const id of cases) {
    const latest = resolver.resolveAt(id, asOf)
    const hist = resolver.mergedHistory(id, "2026-04-01")
    console.log(`\n${id.product_name}`)
    console.log("  latest:", latest)
    console.log("  hist tail:", hist.slice(0, 5), "...", hist.slice(-3))
  }
}

main().catch(console.error)
