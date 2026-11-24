/**
 * Nightly ETL: generate missing system weekly reports for 在管产品 + extras.
 * Registered from background-jobs-scheduler (PM2 worker).
 */

import {
  runAutoWeeklyReportsEtl,
  type AutoWeeklyEtlResult,
} from "@/lib/server/auto-weekly-reports"
import {
  listMineWeeklyOwnerUserIds,
  runMineWeeklyReportsEtl,
} from "@/lib/server/auto-weekly-mine-reports"
import { getUserById } from "@/lib/server/users"

const JOB_KEY = "__autoWeeklyReportsEtl"
/** Weekday catch-up slots are 3 hours apart. Stay under that so the next slot can run. */
const MIN_RERUN_MS = 2.5 * 60 * 60 * 1000

export type AutoWeeklyReportsEtlJobStatus = {
  status: "queued" | "running" | "done" | "error"
  message: string
  startedAt: number
  finishedAt?: number
  result?: AutoWeeklyEtlResult
}

function getJobMap(): Map<string, AutoWeeklyReportsEtlJobStatus> {
  const g = globalThis as typeof globalThis & {
    __autoWeeklyReportsEtlJobs?: Map<string, AutoWeeklyReportsEtlJobStatus>
  }
  if (!g.__autoWeeklyReportsEtlJobs) g.__autoWeeklyReportsEtlJobs = new Map()
  return g.__autoWeeklyReportsEtlJobs
}

function getLastSuccessAt(): number | undefined {
  return (globalThis as typeof globalThis & { __autoWeeklyReportsEtlLastSuccessAt?: number })
    .__autoWeeklyReportsEtlLastSuccessAt
}

function setLastSuccessAt(ts: number): void {
  ;(globalThis as typeof globalThis & { __autoWeeklyReportsEtlLastSuccessAt?: number })
    .__autoWeeklyReportsEtlLastSuccessAt = ts
}

export function getAutoWeeklyReportsEtlJobStatus(): AutoWeeklyReportsEtlJobStatus | null {
  return getJobMap().get(JOB_KEY) ?? null
}

export function startAutoWeeklyReportsEtlJob(options?: {
  force?: boolean
  limit?: number
  productNames?: string[]
  /** Nightly run also builds 月报 / 季报 / 持有期. Daytime catch-up leaves those alone. */
  includeOfficial?: boolean
  /** Default: refresh 我的报告 unless this call is limited to named products. */
  includeMine?: boolean
}):
  | { ok: true }
  | { ok: false; reason: "already_running" | "recently_ran" | "disabled" | "local_tunnel" } {
  if (process.env.AUTO_WEEKLY_REPORTS_ETL_DISABLED === "1" && !options?.force) {
    return { ok: false, reason: "disabled" }
  }
  // Same guard as other heavy ETLs: Windows next.dev against tunneled prod DB.
  if (
    process.platform === "win32" &&
    (process.env.DATABASE_URL || "").includes(":5433/") &&
    !options?.force
  ) {
    console.log("[auto-weekly-etl] skipped: Windows next against tunneled production DB")
    return { ok: false, reason: "local_tunnel" }
  }

  const jobs = getJobMap()
  const existing = jobs.get(JOB_KEY)
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return { ok: false, reason: "already_running" }
  }

  const lastSuccess = getLastSuccessAt()
  if (!options?.force && lastSuccess && Date.now() - lastSuccess < MIN_RERUN_MS) {
    return { ok: false, reason: "recently_ran" }
  }

  const job: AutoWeeklyReportsEtlJobStatus = {
    status: "queued",
    message: "准备生成系统周报",
    startedAt: Date.now(),
  }
  jobs.set(JOB_KEY, job)

  void (async () => {
    job.status = "running"
    job.message = "正在按产品生成缺失周报"
    jobs.set(JOB_KEY, { ...job })
    try {
      const result = await runAutoWeeklyReportsEtl({
        limit: options?.limit,
        productNames: options?.productNames,
      })
      
      // Also refresh per-user 我的报告 tracked products (best-effort).
      let mineCreated = 0
      let mineFailed = 0
      const runMine = options?.includeMine ?? !options?.productNames?.length
      if (runMine) {
        for (const ownerId of listMineWeeklyOwnerUserIds()) {
          try {
            const owner = await getUserById(ownerId)
            const creator = owner?.name || owner?.email || ownerId
            const mine = await runMineWeeklyReportsEtl(
              ownerId,
              creator,
              options?.productNames?.length ? { productNames: options.productNames } : undefined,
            )
            mineCreated += mine.created
            mineFailed += mine.failed
          } catch (err) {
            mineFailed += 1
            console.error(
              "[auto-weekly-etl] mine failed",
              ownerId,
              err instanceof Error ? err.message : err,
            )
          }
        }
      }

      // 月报 / 季报 / 持有期报告: nightly only. Daytime catch-up is weekly reports.
      let officialNote = ""
      if (options?.includeOfficial !== false) {
        try {
          const { runAutoOfficialReportsEtl } = await import("./auto-official-reports")
          const official = await runAutoOfficialReportsEtl()
          const fmt = (label: string, r: { created: number; existed: number; skipped: number; failed: number }) =>
            `${label} created=${r.created} existed=${r.existed} skipped=${r.skipped} failed=${r.failed}`
          officialNote =
            ` | ${fmt("holding", official.holding)}` +
            ` | ${fmt("monthly", official.monthly)}` +
            ` | ${fmt("quarterly", official.quarterly)}`
          console.log(`[auto-official-etl] ${officialNote.trim()}`)
        } catch (officialErr) {
          console.error(
            "[auto-official-etl] failed:",
            officialErr instanceof Error ? officialErr.message : officialErr,
          )
        }
      }

      job.status = "done"
      job.message =
        `完成 created=${result.created} existed=${result.existed} ` +
        `skipped=${result.skipped} failed=${result.failed}` +
        (mineCreated || mineFailed
          ? ` | mine created=${mineCreated} failed=${mineFailed}`
          : "") +
        officialNote
      job.finishedAt = Date.now()
      job.result = result
      jobs.set(JOB_KEY, { ...job })
      if (result.failed === 0 && mineFailed === 0) setLastSuccessAt(Date.now())
      console.log(`[auto-weekly-etl] ${job.message}`)
      void import("./system-notifications")
        .then((mod) => mod.notifyManagedSystemWeeklyIfReady("auto-weekly-etl"))
        .then((managed) => {
          console.log(
            `[managed-weekly-notify] after etl ${managed.reason} ${managed.current}/${managed.total} sent=${managed.sent}`,
          )
        })
        .catch((notifyError) => {
          console.error("[managed-weekly-notify] after etl:", notifyError)
        })
    } catch (err) {
      job.status = "error"
      job.message = err instanceof Error ? err.message : String(err)
      job.finishedAt = Date.now()
      jobs.set(JOB_KEY, { ...job })
      console.error("[auto-weekly-etl] failed:", job.message)
    }
  })()

  return { ok: true }
}

/** Cron entry: fire-and-forget with standard guards. */
export function runScheduledAutoWeeklyReportsEtl(mode: "full" | "catchup" = "full"): void {
  if (mode === "catchup") {
    void (async () => {
      try {
        const { listAutoWeeklyCatchUpProductNames } = await import("./auto-weekly-reports")
        const names = await listAutoWeeklyCatchUpProductNames()
        if (names.length === 0) {
          console.log("[auto-weekly-etl] catch-up: nav unchanged, skip")
          return
        }
        const listed = names.length <= 12 ? names.join("、") : `${names.slice(0, 12).join("、")}…`
        console.log(`[auto-weekly-etl] catch-up ${names.length} products: ${listed}`)
        const result = startAutoWeeklyReportsEtlJob({
          productNames: names,
          includeOfficial: false,
          includeMine: true,
        })
        if (!result.ok) {
          console.log(`[auto-weekly-etl] catch-up skipped: ${result.reason}`)
        } else {
          console.log("[auto-weekly-etl] catch-up started")
        }
      } catch (e) {
        console.error("[auto-weekly-etl] catch-up error:", e)
      }
    })()
    return
  }

  const result = startAutoWeeklyReportsEtlJob()
  if (!result.ok) {
    console.log(`[auto-weekly-etl] skipped: ${result.reason}`)
  } else {
    console.log("[auto-weekly-etl] started")
  }
}
