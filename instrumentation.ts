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

    // Every 3 hours: fetch the last 1 day of fund emails and refresh
    // 在管产品 + FOF底层 list caches so intraday NAV updates are picked up.
    cron.schedule("0 */3 * * *", () => {
      void (async () => {
        try {
          const { startEmailParseFetchJob } = await import("./lib/server/email-parse-fetch-job")
          const result = startEmailParseFetchJob({ days: 1 })
          if (!result.ok) {
            console.log("[3h-etl] skipped: an email parse job is already running")
          } else {
            console.log("[3h-etl] incremental 1-day fetch + cache refresh started")
          }
        } catch (e) {
          console.error("[3h-etl] scheduler error:", e)
        }
      })()
    })
  }
}
