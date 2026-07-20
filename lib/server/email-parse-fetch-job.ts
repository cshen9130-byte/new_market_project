import {
  fetchEmailParseRecords,
  type EmailParseFetchResult,
} from "@/lib/server/email-parse-fetch"
import {
  refreshManagedProductsListCacheLight,
  refreshManagedProductsNavAndListCache,
} from "@/lib/server/email-nav-latest-pg"
import { shouldYieldBackgroundWorkToUsers } from "@/lib/server/user-activity-priority"
import {
  clearScheduledEmailParseYield,
  registerScheduledEmailParseYield,
} from "@/lib/server/scheduled-job-yield-registry"

export type EmailParseFetchJobStatus = {
  status: "queued" | "running" | "done" | "error" | "cancelled"
  message: string
  startedAt: number
  finishedAt?: number
  days?: number
  light?: boolean
  result?: EmailParseFetchResult
}

const JOB_KEY = "__emailParseFetch"
const JOB_TIMEOUT_MS = 10 * 60 * 1000
const YIELD_POLL_MS = 3_000

function getJobMap(): Map<string, EmailParseFetchJobStatus> {
  const g = globalThis as typeof globalThis & {
    __emailParseFetchJobs?: Map<string, EmailParseFetchJobStatus>
  }
  if (!g.__emailParseFetchJobs) g.__emailParseFetchJobs = new Map()
  return g.__emailParseFetchJobs
}

type ActiveRun = {
  abort: AbortController
  yieldPoll: ReturnType<typeof setInterval> | null
  yieldToUserTraffic: boolean
}

declare global {
  // eslint-disable-next-line no-var
  var __emailParseFetchActiveRun: ActiveRun | undefined
}

function setActiveRun(run: ActiveRun | null): void {
  globalThis.__emailParseFetchActiveRun = run ?? undefined
  if (run) {
    registerScheduledEmailParseYield(run.abort, run.yieldToUserTraffic)
  } else {
    clearScheduledEmailParseYield()
  }
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true
  if (e instanceof Error && e.name === "AbortError") return true
  return false
}

function startYieldPoll(abort: AbortController, yieldToUserTraffic: boolean): ReturnType<typeof setInterval> | null {
  if (!yieldToUserTraffic) return null
  return setInterval(() => {
    if (!shouldYieldBackgroundWorkToUsers()) return
    console.log(
      "[email-parse-fetch-job] yielding to interactive user traffic — aborting scheduled ETL (next 2h cron will retry)",
    )
    abort.abort(new DOMException("yielded to user traffic", "AbortError"))
  }, YIELD_POLL_MS)
}

function stopActiveRun(run: ActiveRun | null): void {
  if (!run) return
  if (run.yieldPoll) clearInterval(run.yieldPoll)
  setActiveRun(null)
}

export function getEmailParseFetchJobStatus(): EmailParseFetchJobStatus | null {
  return getJobMap().get(JOB_KEY) ?? null
}

export function startEmailParseFetchJob(options?: {
  crawlEmailId?: string
  days?: number
  /**
   * Intraday mode (3h cron): parse + upsert only, then patch touched funds /
   * rebuild 在管产品 cache. Skips full FOF/tracking/metrics rebuilds.
   */
  light?: boolean
  /**
   * When true (2h cron only), abort promptly if users browse or upload so the
   * site keeps CPU/DB/memory. Manual ops-triggered runs leave this false.
   */
  yieldToUserTraffic?: boolean
}): { ok: true } | { ok: false; reason: "already_running" } {
  const jobs = getJobMap()
  const existing = jobs.get(JOB_KEY)
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return { ok: false, reason: "already_running" }
  }

  const light = options?.light === true
  const yieldToUserTraffic = options?.yieldToUserTraffic === true
  const job: EmailParseFetchJobStatus = {
    status: "queued",
    message: "准备扫描邮箱…",
    startedAt: Date.now(),
    days: options?.days,
    light,
  }
  jobs.set(JOB_KEY, job)

  const abort = new AbortController()
  const yieldPoll = startYieldPoll(abort, yieldToUserTraffic)
  const activeRun: ActiveRun = { abort, yieldPoll, yieldToUserTraffic }
  setActiveRun(activeRun)

  let settled = false
  const watchdog = setTimeout(() => {
    if (settled) return
    settled = true
    console.error(
      `[email-parse-fetch-job] watchdog: ${light ? "light" : "full"} job exceeded ${JOB_TIMEOUT_MS / 1000}s — marking as timed out (a stuck step may still be running in the background)`,
    )
    abort.abort(new DOMException("job timeout", "AbortError"))
    job.status = "error"
    job.finishedAt = Date.now()
    job.message = `任务超时（超过 ${JOB_TIMEOUT_MS / 1000}s 未完成，已中止）`
    stopActiveRun(activeRun)
    setTimeout(() => {
      if (jobs.get(JOB_KEY) === job) jobs.delete(JOB_KEY)
    }, 120_000)
  }, JOB_TIMEOUT_MS)

  void runJob().finally(() => {
    settled = true
    clearTimeout(watchdog)
    stopActiveRun(activeRun)
  })

  async function runJob() {
    job.status = "running"
    job.message = light ? "正在增量扫描并解析邮件…" : "正在扫描并解析邮件…"
    try {
      const result = await fetchEmailParseRecords({
        crawlEmailId: options?.crawlEmailId,
        days: options?.days,
        skipNavLatestRefresh: true,
        light,
        signal: abort.signal,
      })

      if (abort.signal.aborted) {
        throw abort.signal.reason ?? new DOMException("Aborted", "AbortError")
      }

      if (light) {
        if (abort.signal.aborted) {
          throw abort.signal.reason ?? new DOMException("Aborted", "AbortError")
        }
        job.message = "正在同步邮箱运维池…"
        try {
          const { syncEmailTrackingPool } = await import("@/lib/server/email-tracking-pool-sync")
          await syncEmailTrackingPool()
        } catch (e) {
          if (isAbortError(e)) throw e
          result.errors.push(
            `同步邮箱运维池失败: ${e instanceof Error ? e.message : String(e)}`,
          )
        }

        if (abort.signal.aborted) {
          throw abort.signal.reason ?? new DOMException("Aborted", "AbortError")
        }
        job.message = "正在刷新触及产品缓存…"
        try {
          const { upsertTrackingFundListCacheEntry } = await import(
            "@/lib/server/tracking-funds-list-cache-pg"
          )
          for (const fund of result.touchedFunds) {
            if (abort.signal.aborted) {
              throw abort.signal.reason ?? new DOMException("Aborted", "AbortError")
            }
            if (!fund.productCode) continue
            try {
              await upsertTrackingFundListCacheEntry(
                fund.productCode,
                fund.fundName || fund.productCode,
              )
            } catch (err) {
              console.warn(
                "[email-parse-fetch-job] touched fund cache upsert failed",
                fund.productCode,
                err,
              )
            }
          }
        } catch (e) {
          if (isAbortError(e)) throw e
          result.errors.push(
            `刷新触及产品缓存失败: ${e instanceof Error ? e.message : String(e)}`,
          )
        }

        if (abort.signal.aborted) {
          throw abort.signal.reason ?? new DOMException("Aborted", "AbortError")
        }
        job.message = "正在刷新在管产品列表缓存…"
        try {
          const lightCache = await refreshManagedProductsListCacheLight()
          result.navLatestRefreshed = lightCache.listCache
        } catch (e) {
          if (isAbortError(e)) throw e
          result.errors.push(
            `刷新在管产品列表缓存失败: ${e instanceof Error ? e.message : String(e)}`,
          )
        }

        if (result.valuationSaved > 0 && result.touchedFunds.length > 0) {
          if (abort.signal.aborted) {
            throw abort.signal.reason ?? new DOMException("Aborted", "AbortError")
          }
          job.message = "正在同步估值表页面缓存…"
          try {
            const { refreshValuationPipelineForTouchedFunds } = await import(
              "@/lib/server/valuation-cache-refresh"
            )
            const valuationSync = await refreshValuationPipelineForTouchedFunds(result.touchedFunds)
            console.log(
              `[email-parse-fetch-job] valuation cache sync touched=${valuationSync.cacheInvalidated}` +
                ` metrics=${valuationSync.metricsUpserted}`,
            )
          } catch (e) {
            if (isAbortError(e)) throw e
            result.errors.push(
              `同步估值表页面缓存失败: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
        }
      } else {
        job.message = "正在刷新在管产品指标…"
        try {
          await refreshManagedProductsNavAndListCache()
        } catch (e) {
          if (isAbortError(e)) throw e
          result.errors.push(
            `刷新在管产品邮件净值失败: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }

      job.status = "done"
      job.finishedAt = Date.now()
      job.result = result
      const elapsedSec = ((job.finishedAt - job.startedAt) / 1000).toFixed(1)
      job.message = light
        ? `增量解析完成（${elapsedSec}s，触及 ${result.touchedFunds.length} 只产品）`
        : "解析完成"
      console.log(
        `[email-parse-fetch-job] ${light ? "light" : "full"} done in ${elapsedSec}s` +
          ` emails=${result.emailsScanned} nav=${result.navSaved}` +
          ` valuation=${result.valuationSaved} touched=${result.touchedFunds.length}`,
      )
      setTimeout(() => {
        if (jobs.get(JOB_KEY) === job) jobs.delete(JOB_KEY)
      }, 60_000)
    } catch (e) {
      job.finishedAt = Date.now()
      if (isAbortError(e) && yieldToUserTraffic) {
        job.status = "cancelled"
        job.message = "已让位给用户访问，将在下次 2 小时定时任务重试"
        console.log(
          `[email-parse-fetch-job] scheduled run cancelled after ${((job.finishedAt - job.startedAt) / 1000).toFixed(1)}s — users active`,
        )
      } else if (isAbortError(e)) {
        job.status = "error"
        job.message = "任务已中止"
      } else {
        job.status = "error"
        job.message = e instanceof Error ? e.message : "抓取失败"
      }
      setTimeout(() => {
        if (jobs.get(JOB_KEY) === job) jobs.delete(JOB_KEY)
      }, 120_000)
    }
  }

  return { ok: true }
}
