import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { backfillFundHoldingSymbols } = await import("@/lib/server/fund-holding-code")
  const { refreshManagedFofUnderlying } = await import("@/lib/server/managed-fof-underlying-pg")
  const { refreshFofOverviewListCache } = await import("@/lib/server/fof-overview-list-cache-pg")
  const { listUnderlyingHoldings } = await import("@/lib/server/managed-fof-underlying-pg")

  const patched = await backfillFundHoldingSymbols()
  console.log(`Backfilled ${patched} valuation holding symbol(s)`)

  const rows = await refreshManagedFofUnderlying()
  console.log(`Refreshed ${rows} managed FOF underlying row(s)`)

  await refreshFofOverviewListCache()
  console.log("FOF overview cache refreshed")

  for (const name of ["棕榈滩泰来A类", "棕榈滩泰来三号A类"]) {
    const holdings = await listUnderlyingHoldings({ productName: name })
    console.log(`\nHoldings for ${name}:`)
    for (const r of holdings.rows) {
      console.log(`  ${r.fof_product_name}  mv=${r.market_value}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
