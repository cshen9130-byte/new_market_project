import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { BatchNavResolver, enrichTrackFundMetricsRows } = await import(
    "../../lib/server/list-cache-nav-batch"
  )
  const id = { beian_hao: "SBHK26", product_name: "六妙星豪鑫6号", short_name: null as string | null }
  const asOf = "2026-07-23"
  const r = await BatchNavResolver.create([id], asOf)
  console.log("resolveAt", r.resolveAt(id, asOf))
  const enriched = await enrichTrackFundMetricsRows(
    [{
      beian_hao: "SBHK26",
      product_name: "六妙星豪鑫6号",
      short_name: null,
      latest_nav: "1.1227",
      latest_nav_date: "2026-06-30",
      latest_price_change: "0",
      ret_1w: "0",
      ret_1m: "0",
      ret_3m: null,
      ret_6m: null,
      ret_1y: null,
      sharpe_1y: null,
      calmar_1y: null,
    }],
    asOf,
  )
  console.log("enrich", {
    d: enriched[0].latest_nav_date,
    n: enriched[0].latest_nav,
    c: enriched[0].latest_price_change,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
