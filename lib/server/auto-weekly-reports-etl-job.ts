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
const MIN_RERUN_MS = 6 * 60 * 60 * 1000

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
      if (!options?.productNames?.length) {
        for (const ownerId of listMineWeeklyOwnerUserIds()) {
          try {
            const owner = await getUserById(ownerId)
            const creator = owner?.name || owner?.email || ownerId
            const mine = await runMineWeeklyReportsEtl(ownerId, creator)
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

job.status = "done"
      job.message =
        `完成 created=${result.created} existed=${result.existed} ` +
        `skipped=${result.skipped} failed=${result.failed}` +
        (mineCreated || mineFailed
          ? ` | mine created=${mineCreated} failed=${mineFailed}`
          : "")
      job.finishedAt = Date.now()
      job.result = result
      jobs.set(JOB_KEY, { ...job })
      if (result.failed === 0 && mineFailed === 0) setLastSuccessAt(Date.now())
      console.log(`[auto-weekly-etl] ${job.message}`)
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
export function runScheduledAutoWeeklyReportsEtl(): void {
  const result = startAutoWeeklyReportsEtlJob()
  if (!result.ok) {
    console.log(`[auto-weekly-etl] skipped: ${result.reason}`)
  } else {
    console.log("[auto-weekly-etl] started")
  }
}
