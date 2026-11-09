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

  // Local `next dev` on Windows tunnels to production Postgres (:5433). Those
  // crons already run in the PM2 worker; a second copy from this machine was
  // re-scanning every FOF 估值表 and pinning the server.
  if (process.platform === "win32" && (process.env.DATABASE_URL || "").includes(":5433/")) {
    globalThis.__backgroundJobsRegistered = true
    console.log("[background-jobs] skipped: Windows next against tunneled production DB")
    return
  }

  globalThis.__backgroundJobsRegistered = true

  const { runDueSetups } = await import("./email-dispatch")
  const { runDueSettlementFetch } = await import("./settlement-email")
  const { runDueAccountRiskEmailFetch, runDueCfmmcFetch } = await import("./account-risk-import")
  const { runDueProductSettlementCfmmcFetch } = await import("./product-settlement")
  const { runDueAllWeatherEmails } = await import("./all-weather-email")
  const { runDueNhciIndexEmails } = await import("./nhci-index-email")
  const { refreshAllWeatherBooksIfStale } = await import("./all-weather-book")
  const cron = (await import("node-cron")).default

  // Check every minute whether any dispatch setup is due
  cron.schedule("* * * * *", () => {
    runDueSetups().catch((e) => console.error("[email-dispatch] scheduler error:", e))
    runDueSettlementFetch().catch((e) => console.error("[settlement-email] scheduler error:", e))
    runDueAccountRiskEmailFetch().catch((e) => console.error("[account-risk-email] scheduler error:", e))
    runDueCfmmcFetch().catch((e) => console.error("[account-risk-cfmmc] scheduler error:", e))
    runDueProductSettlementCfmmcFetch().catch((e) => console.error("[product-settlement-cfmmc] scheduler error:", e))
    runDueAllWeatherEmails().catch((e) => console.error("[all-weather-email] scheduler error:", e))
    runDueNhciIndexEmails().catch((e) => console.error("[nhci-index-email] scheduler error:", e))
  }, { timezone: "Asia/Shanghai" })

  // 09:35 Beijing weekdays: ensure 全天候 paper-book is updated even when auto-email
  // is disabled or SMTP fails. Each variant refreshes only if its asOf < today.
  // recoverMissedExecutions keeps the book current after a server restart.
  cron.schedule("35 9 * * 1-5", () => {
    refreshAllWeatherBooksIfStale().catch((e) => console.error("[all-weather-book] daily refresh error:", e))
  }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })

  // Dedicated 17:00 Beijing tick so a blocked FOF/cache minute does not drop
  // the whole CFMMC window. isDue still no-ops if the minute poll already ran it.
  cron.schedule("0 17 * * 1-5", () => {
    runDueCfmmcFetch().catch((e) => console.error("[account-risk-cfmmc] 17:00 scheduler error:", e))
    runDueProductSettlementCfmmcFetch().catch((e) => console.error("[product-settlement-cfmmc] 17:00 scheduler error:", e))
  }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })

  // 18:30 Beijing weekdays: incremental 单账户 ETL (picks up late 监控中心 /
  // 邮箱结算文件) then copy NAV into 直投产品. Sync is also run at the end of
  // every ETL; this tick is the daily catch-up if 17:00 fetch/ETL was skipped.
  
  // Afternoon NHCI / Nanhua catch-up (positions often ahead of EmQuant same-day).
  // Overnight 01:00/02:30 often finishes before EmQuant publishes; a single 17:45
  // tick still missed publish and a false success suppressed retries for 4h.
  for (const expr of ["35 15 * * 1-5", "30 16 * * 1-5", "45 17 * * 1-5", "0 19 * * 1-5"] as const) {
    cron.schedule(expr, () => {
      void (async () => {
        try {
          const { runScheduledNanhuaPostcloseEtl } = await import("./nanhua-postclose-etl-job")
          runScheduledNanhuaPostcloseEtl()
        } catch (e) {
          console.error("[nanhua-postclose-etl] scheduler error:", e)
        }
      })()
    }, { timezone: "Asia/Shanghai" })
  }


cron.schedule("30 18 * * 1-5", () => {
    void (async () => {
      try {
        if (process.platform === "win32" && (process.env.DATABASE_URL || "").includes(":5433/")) {
          console.log("[account-risk-direct-nav] skipped: Windows next against tunneled production DB")
          return
        }
        const { runCfmmcETL } = await import("./cfmmc-etl")
        const etl = await runCfmmcETL("incremental")
        console.log(
          `[account-risk-direct-nav] etl processed=${etl.processed} inserted=${etl.inserted} updated=${etl.updated} skipped=${etl.skipped}`,
        )
      } catch (e) {
        console.error("[account-risk-direct-nav] scheduler error:", e)
      }
    })()
  }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })

  // Daily at 02:30: refresh macro-market chart data (PCA, regime, money-credit,
  // and the US FOMC/CPI file) plus 期货市场 Nanhua / vol-corr / 成交额 tables.
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

  // US macro prints: CPI and payrolls around 21:30 Beijing, FOMC around 03:00.
  // The 02:30 full macro group can still be inside earlier futures steps at 03:00,
  // so these two ticks refresh only the US file.
  for (const expr of ["0 22 * * *", "15 8 * * *"] as const) {
    cron.schedule(expr, () => {
      void (async () => {
        try {
          const { runScheduledUsMacroEtl } = await import("./macro-market-etl-job")
          runScheduledUsMacroEtl()
        } catch (e) {
          console.error("[us-macro-etl] scheduler error:", e)
        }
      })()
    }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })
  }

  // Sunday and Monday 08:10 Beijing. Yingmi's daily MCP credit resets at 00:00.
  // Sunday starts or resumes the weekly 代销私募 crawl; if that day's credit stops
  // the run, Monday continues the same queue. The refresh token lives in
  // Postgres, so this worker does not need a browser or a localhost callback.
  for (const expr of ["10 8 * * 0", "10 8 * * 1"] as const) {
    cron.schedule(expr, () => {
      void (async () => {
        try {
          const { startYingmiPrivateFundEtl } = await import("./yingmi-private-fund-etl-job")
          const started = startYingmiPrivateFundEtl()
          if (!started.ok) console.log(`[yingmi-private-fund] skipped: ${started.reason}`)
        } catch (e) {
          console.error("[yingmi-private-fund] scheduler error:", e)
        }
      })()
    }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })
  }

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

  // 10:00 and 18:00 Beijing: rebuild 自建基金 NAV from saved splice / fixed-income
  // rules so files like 380001.json follow source 团队净值 after email ingest.
  cron.schedule("0 10,18 * * *", () => {
    void (async () => {
      try {
        const { refreshAllCustomFundNavFromRules } = await import("./custom-fund-nav-daily-refresh")
        const result = await refreshAllCustomFundNavFromRules()
        console.log(
          `[custom-fund-nav-daily] refreshed=${result.refreshed} skipped=${result.skipped} failed=${result.failed}`,
        )
        for (const item of result.items) {
          if (item.status === "failed") {
            console.error(
              `[custom-fund-nav-daily] ${item.product_code} ${item.product_name}: ${item.error}`,
            )
          }
        }
      } catch (e) {
        console.error("[custom-fund-nav-daily] scheduler error:", e)
      }
    })()
  }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })

  // Friday 16:00 Beijing: 火富牛 previous-Friday NAV (list-first, then
  // skip/update_slow with a list NAV in the last month → weekly + FundPrice history,
  // then FundMultiPrice, then late retry of last week's no_data only for funds
  // that arrived this Friday, then universe maintain: 3-week empty → update_slow,
  // new ≤2-month funds → weekly). Just-revived funds are not downgraded the same run.
  // Still runs if *this* Friday is a CN holiday (fetch last week). A holiday
  // Friday uses the last open day of that week (2026-10-02 → 2026-09-30).
  // Skips only when that whole Mon–Fri has no trading day.
  // Tue-Thu 14:00 Beijing: cheap FundAdvancedList (<=2 pages / credits) for
  // tracking_pool x fof99-channel products. Stamps previous-Friday week tips
  // when the list already shows them; leftover rows on the same pages backfill
  // prioritized holes (default 2026-10-09) then other missing tips. No
  // FundMultiPrice, no universe maintain, no skip-revival. Distinct from
  // Friday 16:00 (list+FundMultiPrice+maintain). Pause with
  // FOF99_MIDWEEK_ETL_DISABLED=1.
  cron.schedule("0 14 * * 2-4", () => {
    void (async () => {
      try {
        const { startFof99MidweekAdvancedlistEtlJob } = await import(
          "./fof99-midweek-advancedlist-etl-job"
        )
        const result = startFof99MidweekAdvancedlistEtlJob()
        if (!result.ok) {
          console.log(`[fof99-midweek-etl] skipped: ${result.reason}`)
        } else {
          console.log("[fof99-midweek-etl] started")
        }
      } catch (e) {
        console.error("[fof99-midweek-etl] scheduler error:", e)
      }
    })()
  }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })

  cron.schedule("0 16 * * 5", () => {
    void (async () => {
      try {
        const { startFof99FridayAfternoonEtlJob } = await import("./fof99-friday-afternoon-etl-job")
        const result = startFof99FridayAfternoonEtlJob()
        if (!result.ok) {
          console.log(`[fof99-friday-etl] skipped: ${result.reason}`)
        } else {
          console.log("[fof99-friday-etl] started")
        }
      } catch (e) {
        console.error("[fof99-friday-etl] scheduler error:", e)
      }
    })()
  }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })

  // Once the latest complete 周度回顾 week has NAV, tell every account.
  // Mon–Thu 16:30 covers the week the page is showing (last Friday), after the
  // Tue–Thu 14:00 火富牛 list. Friday evening covers the week the 16:00 job
  // just filled, because that Friday's own week is usually still thin.
  // A week already sent returns before rebuilding the status.
  for (const expr of ["30 16 * * 1-4", "30 18 * * 5", "30 21 * * 5"] as const) {
    cron.schedule(expr, () => {
      void (async () => {
        try {
          const { notifyManagedSystemWeeklyIfReady, notifyWeeklyStrategyExcelIfReady } = await import(
            "./system-notifications"
          )
          const result = await notifyWeeklyStrategyExcelIfReady("friday-cron")
          console.log(`[weekly-excel-notify] ${expr} ${result.reason} sent=${result.sent}`)
          const managed = await notifyManagedSystemWeeklyIfReady("weekday-cron")
          console.log(
            `[managed-weekly-notify] ${expr} ${managed.reason} ${managed.current}/${managed.total} sent=${managed.sent}`,
          )
        } catch (e) {
          console.error("[weekly-excel-notify] scheduler error:", e)
        }
      })()
    }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })
  }

  // 08:00 Beijing: US CPI and non-farm payrolls, on the Beijing day of the
  // release. An 21:30 print is already in the bell that morning. Fed meetings
  // are not included. A quiet day sends nothing.
  cron.schedule("0 8 * * *", () => {
    void (async () => {
      try {
        const { notifyFeatureLaunches, notifyUsMacroBellForBeijingDay } = await import("./system-notifications")
        const result = await notifyUsMacroBellForBeijingDay("morning")
        console.log(`[us-macro-bell] ${result.reason} events=${result.events} sent=${result.sent}`)
        const launches = await notifyFeatureLaunches("morning")
        console.log(`[feature-launch] ${launches.reason} pending=${launches.pending} sent=${launches.sent}`)
        const { notifyMomDecisionSignals, notifyMomVarBudget, notifyMomVarConcentration } = await import("./system-notifications")
        const momVar = await notifyMomVarConcentration("morning")
        console.log(`[mom-var-bell] ${momVar.reason} ${momVar.date} sent=${momVar.sent}`)
        const momBudget = await notifyMomVarBudget("morning")
        console.log(`[mom-var-budget] ${momBudget.reason} ${momBudget.date} sent=${momBudget.sent}`)
        const momDecision = await notifyMomDecisionSignals("morning")
        console.log(`[mom-decision-bell] ${momDecision.reason} ${momDecision.date} sent=${momDecision.sent}`)
        const { notifyMacroRecovery } = await import("./system-notifications")
        const recovery = await notifyMacroRecovery("morning")
        console.log(`[macro-recovery-bell] ${recovery.reason} ${recovery.date} cluster=${recovery.cluster} sent=${recovery.sent}`)
        const { notifyIndexQuarterBasis } = await import("./system-notifications")
        const quarterBasis = await notifyIndexQuarterBasis("morning")
        console.log(`[index-quarter-basis] ${quarterBasis.reason} ${quarterBasis.date} sent=${quarterBasis.sent}`)
        const { notifyIndexAtmIvSpikes } = await import("./system-notifications")
        const ivSpike = await notifyIndexAtmIvSpikes("morning")
        console.log(`[index-atm-iv-spike] ${ivSpike.reason} products=${ivSpike.products.join(",") || "-"} sent=${ivSpike.sent}`)
        const { notifyFuturesTopSector } = await import("./system-notifications")
        const topSector = await notifyFuturesTopSector("morning")
        console.log(`[futures-top-sector] ${topSector.reason} ${topSector.date} sent=${topSector.sent}`)
      } catch (e) {
        console.error("[us-macro-bell] scheduler error:", e)
      }
    })()
  }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })

  // 18:30 Beijing weekdays: the latest MOM book is usually in by then.
  // Variety share above the account's limit, or sector share above its limit.
  cron.schedule("30 18 * * 1-5", () => {
    void (async () => {
      try {
        const { notifyMomDecisionSignals, notifyMomVarBudget, notifyMomVarConcentration } = await import("./system-notifications")
        const momVar = await notifyMomVarConcentration("evening")
        console.log(`[mom-var-bell] ${momVar.reason} ${momVar.date} sent=${momVar.sent}`)
        const momBudget = await notifyMomVarBudget("evening")
        console.log(`[mom-var-budget] ${momBudget.reason} ${momBudget.date} sent=${momBudget.sent}`)
        const momDecision = await notifyMomDecisionSignals("evening")
        console.log(`[mom-decision-bell] ${momDecision.reason} ${momDecision.date} sent=${momDecision.sent}`)
        const { notifyMacroRecovery } = await import("./system-notifications")
        const recovery = await notifyMacroRecovery("evening")
        console.log(`[macro-recovery-bell] ${recovery.reason} ${recovery.date} cluster=${recovery.cluster} sent=${recovery.sent}`)
        const { notifyIndexQuarterBasis } = await import("./system-notifications")
        const quarterBasis = await notifyIndexQuarterBasis("evening")
        console.log(`[index-quarter-basis] ${quarterBasis.reason} ${quarterBasis.date} sent=${quarterBasis.sent}`)
        const { notifyIndexAtmIvSpikes } = await import("./system-notifications")
        const ivSpike = await notifyIndexAtmIvSpikes("evening")
        console.log(`[index-atm-iv-spike] ${ivSpike.reason} products=${ivSpike.products.join(",") || "-"} sent=${ivSpike.sent}`)
        const { notifyFuturesTopSector } = await import("./system-notifications")
        const topSector = await notifyFuturesTopSector("evening")
        console.log(`[futures-top-sector] ${topSector.reason} ${topSector.date} sent=${topSector.sent}`)
      } catch (e) {
        console.error("[mom-var-bell] scheduler error:", e)
      }
    })()
  }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })

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
  // When new mail lands, patch touched 在管产品 list rows. FOF list metrics
  // stay on the 15-minute tick — do not re-scan every underlying 估值表 here.
  // Only defers for uploads/saves (not FOF list browsing). Single-flight lock
  // skips a tick if the previous poll is still running.
  cron.schedule("*/5 * * * *", () => {
    void (async () => {
      try {
        const { shouldYieldBackgroundWorkToUsers } = await import("./user-activity-priority")
        if (shouldYieldBackgroundWorkToUsers({ mutatingOnly: true })) {
          console.log(
            "[5m-etl] deferred: users uploading — will retry at next 5m slot",
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

  // Nightly 22:30 Beijing: system weekly reports for managed products + strategy extras.
  // Idempotent: skips products that already have the latest available-data week.
  // Skipped on Windows->:5433 tunnel unless forced (same as other heavy ETLs).
  cron.schedule("30 22 * * *", () => {
    void (async () => {
      try {
        const { runScheduledAutoWeeklyReportsEtl } = await import("./auto-weekly-reports-etl-job")
        runScheduledAutoWeeklyReportsEtl()
      } catch (e) {
        console.error("[auto-weekly-etl] scheduler error:", e)
      }
    })()
  }, { timezone: "Asia/Shanghai", recoverMissedExecutions: true })

  registerDefaultIvMinuteCapture()

  console.log("[background-jobs] cron schedules registered")
}

declare global {
  // eslint-disable-next-line no-var
  var __defaultIvCaptureRegistered: boolean | undefined
}

/** Keep the four default IV charts current. Other strikes stay on demand. */
export function registerDefaultIvMinuteCapture() {
  if (globalThis.__defaultIvCaptureRegistered) return
  globalThis.__defaultIvCaptureRegistered = true
  void import("node-cron")
    .then((mod) => {
      const cron = mod.default
      cron.schedule("* 9-15 * * 1-5", () => {
        void import("./option-minute-archive")
          .then((archive) => archive.kickOptionMinuteCapture())
          .catch((e) => console.error("[option-minute] scheduler error:", e))
      }, { timezone: "Asia/Shanghai" })
      cron.schedule("10 8 * * 1-5", () => {
        void import("./option-minute-archive")
          .then((archive) => archive.kickOptionMinuteCapture())
          .catch((e) => console.error("[option-minute] history scheduler error:", e))
      }, { timezone: "Asia/Shanghai" })
      cron.schedule("6 15 * * 1-5", () => {
        void import("./option-minute-archive")
          .then((archive) => archive.kickOptionMinuteCapture({ flush: true }))
          .catch((e) => console.error("[option-minute] close scheduler error:", e))
      }, { timezone: "Asia/Shanghai" })
      console.log("[option-minute] default IV capture scheduled")
    })
    .catch((e) => {
      globalThis.__defaultIvCaptureRegistered = false
      console.error("[option-minute] schedule failed:", e)
    })
}
