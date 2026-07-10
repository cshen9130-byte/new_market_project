/**
 * One-off / manual backfill for 邮箱运维池 in 团队跟踪.
 *
 * Usage:
 *   npx tsx scripts/ma/seed_email_tracking_pool.ts
 *   npx tsx scripts/ma/seed_email_tracking_pool.ts --dry-run
 *
 * Nightly auto-sync runs inside email_nav_etl.ts after email parse.
 */

import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const { syncEmailTrackingPool, EMAIL_OPS_POOL_KEY, EMAIL_OPS_POOL_LABEL } = await import(
    "@/lib/server/email-tracking-pool-sync"
  )
  const { loadEmailPoolFunds } = await import("@/lib/server/team-data-query-pg")

  const emailFunds = await loadEmailPoolFunds()

  console.log(`Email pool fund candidates: ${emailFunds.length}`)

  if (emailFunds.length === 0) {
    console.log("Nothing to seed.")
    process.exit(0)
  }

  if (dryRun) {
    console.log(`[dry-run] Would sync pool "${EMAIL_OPS_POOL_LABEL}" (${EMAIL_OPS_POOL_KEY}) with ${emailFunds.length} funds`)
    for (const row of emailFunds.slice(0, 10)) {
      console.log(`  ${row.register_number}  ${row.product_name}`)
    }
    if (emailFunds.length > 10) console.log(`  ... and ${emailFunds.length - 10} more`)
    process.exit(0)
  }

  const result = await syncEmailTrackingPool()
  console.log(
    `Done: inserted=${result.inserted} updated=${result.updated} removed=${result.removed} total=${result.total} in "${result.poolLabel}"`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
