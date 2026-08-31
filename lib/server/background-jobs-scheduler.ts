/**
 * Shared cron registration for background jobs.
 * Used by Next instrumentation (legacy / local) and the dedicated PM2 worker.
 */

declare global {
  // eslint-disable-next-line no-var
  var __backgroundJobsRegistered: boolean | undefined
}

export async function registerBackgroundJobs(): Promise<void> {
  if (globalThis.__backgroundJobsRegistered) {
    console.log("[background-jobs] cron schedules already registered in this process — skip")
    return
  }
  globalThis.__backgroundJobsRegistered = true

  const { runDueSetups } = await import("./email-dispatch")
  const { runDueSettlementFetch } = await import("./settlement-email")
  const { runDueAccountRiskEmailFetch, runDueCfmmcFetch } = await import("./account-risk-import")
  const { runDueAllWeatherEmails } = await import("./all-weather-email")
  const { runDueNhciIndexEmails } = await import("./nhci-index-email")
  const cron = (await import("node-cron")).default

  // Check every minute whether any dispatch setup is due
  cron.schedule("* * * * *", () => {
    runDueSetups().catch((e) => console.error("[email-dispatch] scheduler error:", e))
    runDueSettlementFetch().catch((e) => console.error("[settlement-email] scheduler error:", e))
    runDueAccountRiskEmailFetch().catch((e) => console.error("[account-risk-email] scheduler error:", e))
    runDueCfmmcFetch().catch((e) => console.error("[account-risk-cfmmc] scheduler error:", e))
    runDueAllWeatherEmails().catch((e) => console.error("[all-weather-email] scheduler error:", e))
    runDueNhciIndexEmails().catch((e) => console.error("[nhci-index-email] scheduler error:", e))
  }, { timezone: "Asia/Shanghai" })

  // Dedicated 17:00 Beijing tick so a blocked FOF/cache minute does not drop
  // the whole CFMMC window. isDue still no-ops if the minute poll already ran it.
  cron.schedule("0 17 * * 1-5", () => {
    runDueCfmmcFetch().catch((e) => console.error("[account-risk-cfmmc] 17:00 scheduler error:", e))
  }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })

  // Daily at 02:30: refresh macro-market chart data (PCA, regime, money-credit)
  // plus 期货市场 Nanhua / vol-corr / 成交额 tables. Frontend charts poll
  // APIs every minute; this job updates the underlying DB.
  // Linux cron may also run nightly_etl at 01:00 — the 20h dedupe guard avoids double work.
  cron.schedule("30 2 * * *", () => {
    void (async () => {
      try {
        const { runScheduledMacroMarketEtl } = await import("./macro-market-etl-job")
        runScheduledMacroMarketEtl()
      } catch (e) {
        console.error("[macro-market-etl] scheduler error:", e)
      }
    })()
  })

  // Daily at 04:45: AMAC private-fund list → amac_private_funds + private_fund_info.
  // Independent of the 01:00 full linux cron so newly filed products stay searchable
  // even when that launcher is missing +x / a vanished .venv / hung later steps.
  cron.schedule("45 4 * * *", () => {
    void (async () => {
      try {
        const { runScheduledAmacPrivateFundsEtl } = await import("./amac-private-funds-etl-job")
        runScheduledAmacPrivateFundsEtl()
      } catch (e) {
        console.error("[amac-private-funds-etl] scheduler error:", e)
      }
    })()
  })

  // Daily at 03:00: refresh stock-market chart data (A-share crowding, board share, top stocks).
  // Runs after macro ETL; ashare_daily incremental uses fast spot mode once caught up.
  cron.schedule("0 3 * * *", () => {
    void (async () => {
      try {
        const { runScheduledStockMarketEtl } = await import("./stock-market-etl-job")
        runScheduledStockMarketEtl()
      } catch (e) {
        console.error("[stock-market-etl] scheduler error:", e)
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
        const { shouldYieldBackgroundWorkToUsers } = await import("./user-activity-priority")
        if (shouldYieldBackgroundWorkToUsers()) {
          console.log(
            "[5m-etl] deferred: interactive users active — will retry at next 5m slot",
          )
          return
        }
        const { startEmailParseFetchJob } = await import("./email-parse-fetch-job")
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
        const { shouldYieldBackgroundWorkToUsers } = await import("./user-activity-priority")
        if (shouldYieldBackgroundWorkToUsers()) {
          console.log("[managed-cache-15m] deferred: interactive users active")
          return
        }
        const { getEmailParseFetchJobStatus, isEmailParseFetchJobLockedElsewhere } = await import(
          "./email-parse-fetch-job",
        )
        const job = getEmailParseFetchJobStatus()
        if (job?.status === "running" || job?.status === "queued") {
          console.log("[managed-cache-15m] skipped: email parse job in progress")
          return
        }
        if (isEmailParseFetchJobLockedElsewhere()) {
          console.log("[managed-cache-15m] skipped: email parse job locked by another process")
          return
        }
        const startedAt = Date.now()
        const { refreshManagedAndFofListCachesIncremental } = await import("./email-nav-latest-pg")
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

  // Every 10 minutes: drain queued contract-element extract jobs (LLM).
  // Upload API also kicks the runner; this catches leftovers when the web
  // process did not run background work (RUN_BACKGROUND_JOBS=0).
  cron.schedule("*/10 * * * *", () => {
    void (async () => {
      try {
        // Local `next dev` often tunnels to production Postgres. Contract files live on
        // the Linux server; claiming those jobs here writes ENOENT failures into prod.
        if (process.platform === "win32" && (process.env.DATABASE_URL || "").includes(":5433/")) {
          console.log("[contract-extract-10m] skipped: Windows next against tunneled production DB")
          return
        }
        const { shouldYieldBackgroundWorkToUsers } = await import("./user-activity-priority")
        if (shouldYieldBackgroundWorkToUsers()) {
          console.log("[contract-extract-10m] deferred: interactive users active")
          return
        }
        const { startContractExtractJob } = await import("./fund-contract-extract-job")
        const result = startContractExtractJob({
          yieldToUserTraffic: true,
          maxJobs: 20,
          maxMs: 8 * 60 * 1000,
        })
        if (!result.ok) {
          console.log("[contract-extract-10m] skipped: extract job already running")
        } else {
          console.log("[contract-extract-10m] drain started")
        }
      } catch (e) {
        console.error("[contract-extract-10m] scheduler error:", e)
      }
    })()
  })

  console.log("[background-jobs] cron schedules registered")
}
