export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runDueSetups } = await import("./lib/server/email-dispatch")
    const { runDueSettlementFetch } = await import("./lib/server/settlement-email")
    const cron = (await import("node-cron")).default

    // Check every minute whether any dispatch setup is due
    cron.schedule("* * * * *", () => {
      runDueSetups().catch((e) => console.error("[email-dispatch] scheduler error:", e))
      runDueSettlementFetch().catch((e) => console.error("[settlement-email] scheduler error:", e))
    })

    // Daily at 02:30: refresh macro-market chart data (PCA, regime, money-credit).
    // Frontend charts poll APIs every minute; this job updates the underlying DB.
    // Linux cron may also run nightly_etl at 01:00 ? the 20h dedupe guard avoids double work.
    cron.schedule("30 2 * * *", () => {
      void (async () => {
        try {
          const { runScheduledMacroMarketEtl } = await import("./lib/server/macro-market-etl-job")
          runScheduledMacroMarketEtl()
        } catch (e) {
          console.error("[macro-market-etl] scheduler error:", e)
        }
      })()
    })

    // Every 2 hours: light incremental fetch from per-mailbox checkpoint (plus overlap).
    // Upserts NAV/???, syncs ?????, patches touched tracking rows,
    // rebuilds ???? list cache, and refreshes ??? page cache for touched funds.
    // Full FOF/tracking/metrics rebuilds stay on nightly ETL.
    // Defers or aborts when users are browsing/uploading so the site stays responsive.
    cron.schedule("0 */2 * * *", () => {
      void (async () => {
        try {
          const { shouldYieldBackgroundWorkToUsers } = await import(
            "./lib/server/user-activity-priority"
          )
          if (shouldYieldBackgroundWorkToUsers()) {
            console.log(
              "[1h-etl] deferred: interactive users active ? will retry at next 2h slot",
            )
            return
          }
          const { startEmailParseFetchJob } = await import("./lib/server/email-parse-fetch-job")
          const result = startEmailParseFetchJob({
            light: true,
            yieldToUserTraffic: true,
          })
          if (!result.ok) {
            console.log("[1h-etl] skipped: an email parse job is already running")
          } else {
            console.log("[1h-etl] light incremental fetch started (no full FOF/tracking rebuild)")
          }
        } catch (e) {
          console.error("[1h-etl] scheduler error:", e)
        }
      })()
    })

    // Every 15 minutes: refresh ???? NAV / ?? / returns only, reusing the ??? already
    // resolved in the cache. That skips the fuzzy fund-name joins that make a full rebuild
    // cost ~85s, so newly parsed ??? data reaches the table within one cadence.
    // Runs in ~8s, so this can drop to */5 once it has proven itself in production.
    // Product add, delete and rename still trigger a full rebuild, as does the nightly ETL.
    // Yields the same way the 2h job does, and never overlaps itself or an email parse.
    let managedCacheTickRunning = false
    cron.schedule("*/15 * * * *", () => {
      if (managedCacheTickRunning) {
        console.log("[managed-cache-15m] skipped: previous tick still running")
        return
      }
      managedCacheTickRunning = true
      void (async () => {
        try {
          const { shouldYieldBackgroundWorkToUsers } = await import(
            "./lib/server/user-activity-priority"
          )
          if (shouldYieldBackgroundWorkToUsers()) {
            console.log("[managed-cache-15m] deferred: interactive users active")
            return
          }
          const { getEmailParseFetchJobStatus } = await import(
            "./lib/server/email-parse-fetch-job"
          )
          const job = getEmailParseFetchJobStatus()
          if (job?.status === "running" || job?.status === "queued") {
            console.log("[managed-cache-15m] skipped: email parse job in progress")
            return
          }
          const startedAt = Date.now()
          const { refreshManagedProductsListCacheLight } = await import(
            "./lib/server/email-nav-latest-pg"
          )
          const { listCache } = await refreshManagedProductsListCacheLight({
            reuseResolvedIdentities: true,
          })

          // FOF?? rides the same tick so the two tables never contend for the box.
          // Only the overview cache is refreshed: it recomputes NAV / ?? / returns from the
          // existing holdings snapshot. Rebuilding that snapshot needs the fuzzy joins, so it
          // stays on the nightly ETL and the add/delete paths.
          const { refreshFofOverviewListCache } = await import(
            "./lib/server/fof-overview-list-cache-pg"
          )
          const fofCache = await refreshFofOverviewListCache({ reuseResolvedIdentities: true })

          console.log(
            `[managed-cache-15m] refreshed ${listCache} ???? + ${fofCache} FOF?? rows in ${Math.round(
              (Date.now() - startedAt) / 1000,
            )}s`,
          )
        } catch (e) {
          console.error("[managed-cache-15m] scheduler error:", e)
        } finally {
          managedCacheTickRunning = false
        }
      })()
    })
  }
}
