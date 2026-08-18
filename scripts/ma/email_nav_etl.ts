/**
 * Nightly email NAV ETL — crawl fund mailboxes, parse NAV, upsert ops_email_nav_records.
 *
 * Usage:
 *   npx tsx scripts/ma/email_nav_etl.ts
 *   npx tsx scripts/ma/email_nav_etl.ts --parse-only
 *   npx tsx scripts/ma/email_nav_etl.ts --parse-only --days=400
 *   npx tsx scripts/ma/email_nav_etl.ts --parse-only --full-backfill
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only --cache-only
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only --fof-only
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only --managed-only
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only --tracking-only
 *
 * `--cache-only` skips valuation/holdings JSONB backfills and rebuilds list caches.
 * It still syncs latest 估值表 资产净值 into managed_products so the list does not
 * keep stale AUM (COALESCE to managed_products). `--managed-only` skips the
 * investment-overview rebuild (that query can statement-timeout after the list
 * cache already succeeded).
 *
 * Loads `.env.local` / `.env` from the project root automatically (same as nightly_etl.py).
 * Prints JSON to stdout for nightly_etl.py to consume.
 */

import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()

function parseDays(argv: string[]): number | undefined {
  if (argv.includes("--full-backfill")) {
    const env = parseInt(process.env.EMAIL_NAV_ETL_INITIAL_DAYS ?? process.env.EMAIL_NAV_ETL_DAYS ?? "400", 10)
    return Number.isFinite(env) && env > 0 ? Math.min(env, 730) : 400
  }
  const flag = argv.find((a) => a.startsWith("--days="))
  if (flag) {
    const n = parseInt(flag.slice("--days=".length), 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  // Default: incremental scan from per-mailbox checkpoint (nightly ETL).
  return undefined
}

async function main() {
  const argv = process.argv.slice(2)
  const refreshOnly = argv.includes("--refresh-only")
  const cacheOnly = argv.includes("--cache-only")
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
      let investmentOverviewCache = { products: 0, navRows: 0, underlyingRows: 0 }

      if (cacheOnly) {
        console.error("[email_nav_etl] --cache-only: skipping valuation/holdings backfills")
        // Still heal CMS/招商 day-shift: header 单位净值 vs ops_email_nav_records
        // can diverge when nightly never runs full backfill (see nav-calculation-rules).
        try {
          const { healCmsNavDayShiftFromRecords } = await import(
            "@/lib/server/email-valuation-nav-backfill"
          )
          const healed = await healCmsNavDayShiftFromRecords({ sinceDate: "2026-06-01" })
          console.error(
            `[email_nav_etl] CMS NAV day-shift heal done (products=${healed.products}, mismatches=${healed.mismatches}, navUpserted=${healed.navUpserted})`,
          )
        } catch (err) {
          console.warn("[email_nav_etl] CMS NAV day-shift heal skipped:", err)
        }
      } else {
      console.error("[email_nav_etl] refresh-only: backfilling custody 估值表 NAV into ops_email_nav_records…")
      try {
        const { backfillCustodyValuationNavFromRecords } = await import(
          "@/lib/server/email-valuation-nav-backfill"
        )
        const navBackfill = await backfillCustodyValuationNavFromRecords()
        console.error(
          `[email_nav_etl] custody 估值表 NAV backfill done (rows=${navBackfill.navBackfilled})`,
        )
      } catch (err) {
        console.warn("[email_nav_etl] custody 估值表 NAV backfill skipped:", err)
      }

      if (!fofOnly) {
        console.error(
          "[email_nav_etl] re-extracting valuation metrics from stored holdings JSONB (may take several minutes, one UPDATE per record)…",
        )
        try {
          const { backfillValuationMetricsFromRecords } = await import(
            "@/lib/server/email-valuation-metrics-backfill"
          )
          const { refreshEmailValuationMetricsLatest } = await import(
            "@/lib/server/email-valuation-metrics-pg"
          )
          const metricsBackfill = await backfillValuationMetricsFromRecords()
          console.error(
            `[email_nav_etl] valuation metrics JSONB backfill done (records=${metricsBackfill.recordsUpdated}) — rebuilding latest metrics tables…`,
          )
          const metricsLatest = await refreshEmailValuationMetricsLatest()
          console.error(
            `[email_nav_etl] valuation metrics latest tables done (fund=${metricsLatest.fundMetricsRefreshed}, fof=${metricsLatest.fofUnderlyingRefreshed})`,
          )
        } catch (err) {
          console.warn("[email_nav_etl] valuation metrics backfill skipped:", err)
        }
      } else {
        console.error("[email_nav_etl] --fof-only: skipping valuation metrics JSONB backfill (use full refresh-only for 在管产品 metrics)")
      }

      if (refreshFof) {
        console.error("[email_nav_etl] refresh-only: backfilling normalized valuation holdings from JSONB…")
        try {
          const { backfillValuationHoldingsFromRecords } = await import(
            "@/lib/server/email-valuation-holdings-pg"
          )
          const hb = await backfillValuationHoldingsFromRecords()
          console.error(
            `[email_nav_etl] valuation holdings backfill done (records=${hb.recordsProcessed}, rows=${hb.holdingsSaved})`,
          )
        } catch (err) {
          console.warn("[email_nav_etl] valuation holdings backfill skipped:", err)
        }
      }

      console.error("[email_nav_etl] refresh-only: refreshing managed FOF underlying snapshot…")
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

      }

      if (refreshManaged) {
        console.error("[email_nav_etl] syncing valuation metrics to product tables…")
        try {
          const { syncEmailValuationToProductTables } = await import(
            "@/lib/server/email-valuation-sync-pg"
          )
          const sync = await syncEmailValuationToProductTables()
          managedProductsValuationSynced = sync.managedProductsUpdated
          fofUnderlyingMarketSynced = sync.fofUnderlyingUpdated
          console.error(
            `[email_nav_etl] valuation sync done (managed=${managedProductsValuationSynced}, fof=${fofUnderlyingMarketSynced})`,
          )
        } catch (err) {
          console.warn("[email_nav_etl] valuation sync skipped (will enrich list caches instead):", err)
        }
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

      if (refreshManaged && !managedOnly) {
        console.error("[email_nav_etl] refresh-only: rebuilding investment overview cache…")
        try {
          const { refreshInvestmentOverviewCache } = await import("@/lib/server/investment-overview-cache-pg")
          investmentOverviewCache = await refreshInvestmentOverviewCache()
          console.error(
            `[email_nav_etl] investment overview cache done (products=${investmentOverviewCache.products}, nav=${investmentOverviewCache.navRows}, underlying=${investmentOverviewCache.underlyingRows})`,
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.warn(
            `[email_nav_etl] investment overview cache skipped after list cache succeeded: ${message}`,
          )
        }
      } else if (managedOnly) {
        console.error("[email_nav_etl] --managed-only: skipping investment overview cache")
      }

      console.log(JSON.stringify({
        ok: true,
        skipped: false,
        refreshOnly: true,
        cacheOnly,
        listCacheRefreshed: listCache,
        fofOverviewListCacheRefreshed: fofOverviewListCache,
        trackingFundsListCacheRefreshed: trackingFundsListCache,
        managedProductsValuationSynced,
        fofUnderlyingMarketSynced,
        managedFofUnderlyingRefreshed,
        opsFofUnderlyingAdded,
        detailFofUnderlyingAdded,
        investmentOverviewProducts: investmentOverviewCache.products,
        investmentOverviewNavRows: investmentOverviewCache.navRows,
        investmentOverviewUnderlyingRows: investmentOverviewCache.underlyingRows,
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

    let emailPoolSync: Record<string, unknown> | null = null
    try {
      const { syncEmailTrackingPool } = await import("@/lib/server/email-tracking-pool-sync")
      const poolSync = await syncEmailTrackingPool()
      emailPoolSync = poolSync
      console.error(
        `[email_nav_etl] email ops pool synced (inserted=${poolSync.inserted}, removed=${poolSync.removed}, total=${poolSync.total})`,
      )
    } catch (err) {
      console.warn("[email_nav_etl] email ops pool sync skipped:", err)
    }

    console.log(
      JSON.stringify({
        ok: true,
        skipped: false,
        parseOnly,
        incremental: days == null,
        days: days ?? null,
        emailPoolSync,
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
