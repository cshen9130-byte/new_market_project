/**
 * Nightly email NAV ETL — crawl fund mailboxes, parse NAV, upsert ops_email_nav_records.
 *
 * Usage:
 *   npx tsx scripts/ma/email_nav_etl.ts
 *   npx tsx scripts/ma/email_nav_etl.ts --days=31
 *   npx tsx scripts/ma/email_nav_etl.ts --parse-only --days=31
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only --fof-only
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only --managed-only
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only --tracking-only
 *
 * Loads `.env.local` / `.env` from the project root automatically (same as nightly_etl.py).
 * Prints JSON to stdout for nightly_etl.py to consume.
 */

import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

function parseDays(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--days="))
  if (flag) {
    const n = parseInt(flag.slice("--days=".length), 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  const env = parseInt(process.env.EMAIL_NAV_ETL_DAYS ?? "31", 10)
  return Number.isFinite(env) && env > 0 ? env : 31
}

async function main() {
  const argv = process.argv.slice(2)
  const refreshOnly = argv.includes("--refresh-only")
  const parseOnly = argv.includes("--parse-only")
  const fofOnly = argv.includes("--fof-only")
  const managedOnly = argv.includes("--managed-only")
  const trackingOnly = argv.includes("--tracking-only")
  const refreshManaged = !fofOnly && !trackingOnly
  const refreshFof = !managedOnly && !trackingOnly
  const refreshTracking = !managedOnly && !fofOnly

  if (refreshOnly) {
    try {
      let listCache = 0
      let fofOverviewListCache = 0
      let trackingFundsListCache = 0
      let managedProductsValuationSynced = 0
      let fofUnderlyingMarketSynced = 0
      let managedFofUnderlyingRefreshed = 0
      let opsFofUnderlyingAdded = 0
      let detailFofUnderlyingAdded = 0

      const { syncEmailValuationToProductTables } = await import(
        "@/lib/server/email-valuation-sync-pg"
      )
      console.error("[email_nav_etl] refresh-only: backfilling valuation metrics from stored records…")
      try {
        const { backfillValuationMetricsFromRecords } = await import(
          "@/lib/server/email-valuation-metrics-backfill"
        )
        const { refreshEmailValuationMetricsLatest } = await import(
          "@/lib/server/email-valuation-metrics-pg"
        )
        const metricsBackfill = await backfillValuationMetricsFromRecords()
        const metricsLatest = await refreshEmailValuationMetricsLatest()
        console.error(
          `[email_nav_etl] valuation metrics backfill done (records=${metricsBackfill.recordsUpdated}, latest=${metricsLatest.fundMetricsRefreshed})`,
        )
      } catch (err) {
        console.warn("[email_nav_etl] valuation metrics backfill skipped:", err)
      }

      try {
        const { refreshManagedFofUnderlying } = await import("@/lib/server/managed-fof-underlying-pg")
        managedFofUnderlyingRefreshed = await refreshManagedFofUnderlying()
        console.error(
          `[email_nav_etl] managed FOF underlying refreshed (${managedFofUnderlyingRefreshed} rows)`,
        )
      } catch (err) {
        console.warn("[email_nav_etl] managed FOF underlying refresh skipped:", err)
      }

      try {
        const { autoAddFofUnderlyingToTables } = await import(
          "@/lib/server/fof-underlying-auto-add-pg"
        )
        const autoAdd = await autoAddFofUnderlyingToTables()
        opsFofUnderlyingAdded = autoAdd.opsFofUnderlyingAdded
        detailFofUnderlyingAdded = autoAdd.detailFofUnderlyingAdded
        console.error(
          `[email_nav_etl] FOF底层 auto-add done (summary=${opsFofUnderlyingAdded}, detail=${detailFofUnderlyingAdded})`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes("permission denied")) {
          console.warn("[email_nav_etl] FOF底层 auto-add failed:", err)
        } else {
          console.warn("[email_nav_etl] FOF底层 auto-add skipped (no INSERT grant yet):", msg)
        }
      }

      console.error("[email_nav_etl] refresh-only: syncing valuation metrics to product tables…")
      try {
        const sync = await syncEmailValuationToProductTables()
        managedProductsValuationSynced = sync.managedProductsUpdated
        fofUnderlyingMarketSynced = sync.fofUnderlyingUpdated
        console.error(
          `[email_nav_etl] valuation sync done (managed=${managedProductsValuationSynced}, fof=${fofUnderlyingMarketSynced})`,
        )
      } catch (err) {
        console.warn("[email_nav_etl] valuation sync skipped (will enrich list caches instead):", err)
      }

      if (refreshManaged) {
        console.error("[email_nav_etl] refresh-only: rebuilding managed products list cache…")
        const { refreshManagedProductsListCache } = await import("@/lib/server/managed-products-list-cache-pg")
        listCache = await refreshManagedProductsListCache()
        console.error(`[email_nav_etl] managed products cache done (${listCache} rows)`)
      }

      if (refreshFof) {
        console.error("[email_nav_etl] refresh-only: rebuilding FOF overview list cache…")
        const { refreshFofOverviewListCache } = await import("@/lib/server/fof-overview-list-cache-pg")
        fofOverviewListCache = await refreshFofOverviewListCache()
        console.error(`[email_nav_etl] FOF overview cache done (${fofOverviewListCache} rows)`)
      }

      if (refreshTracking) {
        console.error("[email_nav_etl] refresh-only: rebuilding tracking funds list cache…")
        const { refreshTrackingFundsListCache } = await import("@/lib/server/tracking-funds-list-cache-pg")
        trackingFundsListCache = await refreshTrackingFundsListCache()
        console.error(`[email_nav_etl] tracking funds cache done (${trackingFundsListCache} rows)`)
      }

      console.log(JSON.stringify({
        ok: true,
        skipped: false,
        refreshOnly: true,
        listCacheRefreshed: listCache,
        fofOverviewListCacheRefreshed: fofOverviewListCache,
        trackingFundsListCacheRefreshed: trackingFundsListCache,
        managedProductsValuationSynced,
        fofUnderlyingMarketSynced,
        managedFofUnderlyingRefreshed,
        opsFofUnderlyingAdded,
        detailFofUnderlyingAdded,
      }))
      process.exit(0)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[email_nav_etl] refresh-only failed: ${message}`)
      console.log(JSON.stringify({ ok: false, refreshOnly: true, error: message }))
      process.exit(1)
    }
  }

  const days = parseDays(argv)

  try {
    const { fetchEmailParseRecords } = await import("@/lib/server/email-parse-fetch")
    const result = await fetchEmailParseRecords({
      days,
      skipNavLatestRefresh: parseOnly,
    })

    if (!parseOnly) {
      console.error("[email_nav_etl] backfilling normalized valuation holdings…")
    }
    try {
      const { backfillValuationHoldingsFromRecords } = await import(
        "@/lib/server/email-valuation-holdings-pg"
      )
      const backfill = await backfillValuationHoldingsFromRecords()
      console.error(
        `[email_nav_etl] holdings backfill done (records=${backfill.recordsProcessed}, rows=${backfill.holdingsSaved})`,
      )
    } catch (err) {
      console.warn("[email_nav_etl] holdings backfill skipped:", err)
    }

    console.log(
      JSON.stringify({
        ok: true,
        skipped: false,
        parseOnly,
        days,
        ...result,
      }),
    )
    process.exit(0)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const skipped =
      message.includes("抓取邮箱") ||
      message.includes("授权码")

    console.log(
      JSON.stringify({
        ok: false,
        skipped,
        days,
        emailsScanned: 0,
        recordsFound: 0,
        navSaved: 0,
        errors: [message],
        error: message,
      }),
    )
    process.exit(skipped ? 0 : 1)
  }
}

main()
