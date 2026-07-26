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
    // Linux cron may also run nightly_etl at 01:00 — the 20h dedupe guard avoids double work.
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

    // Every 5 minutes: checkpoint poll mailboxes for new NAV / 估值表 mail.
    // Already-processed UIDs are skipped (empty polls should finish in seconds).
    // When new mail lands, parse it and immediately refresh 在管产品 + FOF底层
    // incremental caches — do not wait for the 15m fallback tick.
    // Full FOF/tracking/metrics rebuilds stay on nightly ETL.
    // Defers or aborts when users are browsing/uploading; single-flight lock
    // skips a tick if the previous poll is still running.
    cron.schedule("*/5 * * * *", () => {
      void (async () => {
        try {
          const { shouldYieldBackgroundWorkToUsers } = await import(
            "./lib/server/user-activity-priority"
          )
          if (shouldYieldBackgroundWorkToUsers()) {
            console.log(
              "[5m-etl] deferred: interactive users active — will retry at next 5m slot",
            )
            return
          }
          const { startEmailParseFetchJob } = await import("./lib/server/email-parse-fetch-job")
          const result = startEmailParseFetchJob({
            light: true,
            yieldToUserTraffic: true,
          })
          if (!result.ok) {
            console.log("[5m-etl] skipped: an email parse job is already running")
          } else {
            console.log("[5m-etl] checkpoint poll started")
          }
        } catch (e) {
          console.error("[5m-etl] scheduler error:", e)
        }
      })()
    })

    // Every 15 minutes: fallback refresh of 在管产品 + FOF底层 from DB even if no
    // new mail arrived (catches late DB writes / missed immediate refresh).
    // Skips while an email parse job (which may already be refreshing) is running.
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
          const { refreshManagedAndFofListCachesIncremental } = await import(
            "./lib/server/email-nav-latest-pg"
          )
          const { listCache, fofCache } = await refreshManagedAndFofListCachesIncremental()
          console.log(
            `[managed-cache-15m] refreshed ${listCache} 在管产品 + ${fofCache} FOF底层 rows in ${Math.round(
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
