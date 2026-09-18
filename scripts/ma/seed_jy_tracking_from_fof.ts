/**
 * One-off / manual backfill: copy 投资 → FOF底层 私募持仓 into JY跟踪池.
 *
 * Usage:
 *   npx tsx scripts/ma/seed_jy_tracking_from_fof.ts
 *   npx tsx scripts/ma/seed_jy_tracking_from_fof.ts --dry-run
 *
 * Automatic sync runs after FOF auto-add (email 估值表) and when opening JY跟踪池.
 */

import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const {
    loadFofUnderlyingJySyncFunds,
    syncFofUnderlyingToJyTrackingPool,
    JY_TRACKING_POOL_LABEL,
  } = await import("@/lib/server/fof-jy-tracking-pool-sync")

  const funds = await loadFofUnderlyingJySyncFunds()
  console.log(`FOF底层 私募持仓 candidates: ${funds.length}`)

  if (funds.length === 0) {
    console.log("Nothing to seed.")
    process.exit(0)
  }

  if (dryRun) {
    console.log(`[dry-run] Would sync into "${JY_TRACKING_POOL_LABEL}"`)
    for (const row of funds.slice(0, 20)) {
      console.log(`  ${row.beian_hao}  ${row.product_name}`)
    }
    if (funds.length > 20) console.log(`  ... and ${funds.length - 20} more`)
    process.exit(0)
  }

  const result = await syncFofUnderlyingToJyTrackingPool()
  console.log(
    `Done: inserted=${result.inserted} skipped=${result.skipped} candidates=${result.totalCandidates} in "${result.poolLabel}"`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
