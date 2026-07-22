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

    // Every 2 hours: light incremental fetch (last 1 day of mail only).
    // Upserts NAV/估值表, syncs 邮箱运维池, patches touched tracking rows,
    // rebuilds 在管产品 list cache, and refreshes 估值表 page cache for touched funds.
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
              "[1h-etl] deferred: interactive users active — will retry at next 2h slot",
            )
            return
          }
          const { startEmailParseFetchJob } = await import("./lib/server/email-parse-fetch-job")
          const result = startEmailParseFetchJob({
            days: 1,
            light: true,
            yieldToUserTraffic: true,
          })
          if (!result.ok) {
            console.log("[1h-etl] skipped: an email parse job is already running")
          } else {
            console.log("[1h-etl] light 1-day fetch started (no full FOF/tracking rebuild)")
          }
        } catch (e) {
          console.error("[1h-etl] scheduler error:", e)
        }
      })()
    })
  }
}
