/**
 * Refresh FOF底层 list cache + managed underlying snapshot (no heavy JSONB backfills).
 *
 * Usage: npx tsx scripts/ma/_refresh_fof_cache.ts
 */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

async function main() {
  loadProjectEnvFiles()
  configureEtlDbTimeout()

  console.error("[refresh_fof_cache] backfilling custody 估值表 NAV into ops_email_nav_records…")
  try {
    const { backfillCustodyValuationNavFromRecords } = await import("@/lib/server/email-valuation-nav-backfill")
    const navBackfill = await backfillCustodyValuationNavFromRecords({ sinceDate: "2026-06-01" })
    console.error(`[refresh_fof_cache] custody NAV backfill done (rows=${navBackfill.navBackfilled})`)
  } catch (err) {
    console.warn("[refresh_fof_cache] custody NAV backfill skipped:", err)
  }

  console.error("[refresh_fof_cache] refreshing managed FOF underlying snapshot…")
  const { refreshManagedFofUnderlying } = await import("@/lib/server/managed-fof-underlying-pg")
  const managedRows = await refreshManagedFofUnderlying()
  console.error(`[refresh_fof_cache] managed FOF underlying done (${managedRows} rows)`)

  console.error("[refresh_fof_cache] rebuilding FOF overview list cache…")
  const { refreshFofOverviewListCache } = await import("@/lib/server/fof-overview-list-cache-pg")
  const cacheRows = await refreshFofOverviewListCache()
  console.error(`[refresh_fof_cache] FOF overview cache done (${cacheRows} rows)`)

  console.log(JSON.stringify({ ok: true, managedRows, cacheRows }))
}

main().catch((err) => {
  console.error("[refresh_fof_cache] failed:", err)
  process.exit(1)
})
