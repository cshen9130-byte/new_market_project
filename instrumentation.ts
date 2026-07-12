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

    // Every hour: light incremental fetch (last 1 day of mail only).
    // Upserts NAV/估值表, syncs 邮箱运维池, patches touched tracking rows +
    // rebuilds 在管产品 list cache. Skips full FOF/tracking/metrics rebuilds
    // (those stay on nightly ETL).
    cron.schedule("0 * * * *", () => {
      void (async () => {
        try {
          const { startEmailParseFetchJob } = await import("./lib/server/email-parse-fetch-job")
          const result = startEmailParseFetchJob({ days: 1, light: true })
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
