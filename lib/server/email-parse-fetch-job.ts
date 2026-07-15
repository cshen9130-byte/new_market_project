import {
  fetchEmailParseRecords,
  type EmailParseFetchResult,
} from "@/lib/server/email-parse-fetch"
import {
  refreshManagedProductsListCacheLight,
  refreshManagedProductsNavAndListCache,
} from "@/lib/server/email-nav-latest-pg"

export type EmailParseFetchJobStatus = {
  status: "queued" | "running" | "done" | "error"
  message: string
  startedAt: number
  finishedAt?: number
  days?: number
  light?: boolean
  result?: EmailParseFetchResult
}

const JOB_KEY = "__emailParseFetch"

// Hard ceiling on total job runtime. Without this, a single stuck step (slow/
// unresponsive IMAP server, a DB query blocked on a lock, etc.) leaves
// job.status stuck at "running" forever — which blocks every future cron
// tick and manual fetch (both are guarded by the "already_running" check
// below) until someone manually restarts the server. This timeout makes a
// stuck run fail after a bounded time instead of wedging indefinitely.
const JOB_TIMEOUT_MS = 10 * 60 * 1000

function getJobMap(): Map<string, EmailParseFetchJobStatus> {
  const g = globalThis as typeof globalThis & {
    __emailParseFetchJobs?: Map<string, EmailParseFetchJobStatus>
  }
  if (!g.__emailParseFetchJobs) g.__emailParseFetchJobs = new Map()
  return g.__emailParseFetchJobs
}

export function getEmailParseFetchJobStatus(): EmailParseFetchJobStatus | null {
  return getJobMap().get(JOB_KEY) ?? null
}

export function startEmailParseFetchJob(options?: {
  crawlEmailId?: string
  days?: number
  /**
   * Intraday mode (3h cron): parse + upsert only, then patch touched funds /
   * rebuild 在管产品 cache. Skips full FOF / tracking / metrics rebuilds.
   */
  light?: boolean
}): { ok: true } | { ok: false; reason: "already_running" } {
  const jobs = getJobMap()
  const existing = jobs.get(JOB_KEY)
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return { ok: false, reason: "already_running" }
  }

  const light = options?.light === true
  const job: EmailParseFetchJobStatus = {
    status: "queued",
    message: "准备扫描邮箱…",
    startedAt: Date.now(),
    days: options?.days,
    light,
  }
  jobs.set(JOB_KEY, job)

  // Watchdog: if runJob() below never settles (stuck IMAP socket, a DB query
  // blocked on a lock with no effective statement_timeout, etc.), force the
  // job slot to "error" after JOB_TIMEOUT_MS so the next cron tick / manual
  // fetch isn't blocked forever by the "already_running" guard above. The
  // original stuck call keeps running in the background and is abandoned;
  // it will eventually die on its own once its underlying I/O times out.
  let settled = false
  const watchdog = setTimeout(() => {
    if (settled) return
    settled = true
    console.error(
      `[email-parse-fetch-job] watchdog: ${light ? "light" : "full"} job exceeded ${JOB_TIMEOUT_MS / 1000}s — marking as timed out (a stuck step may still be running in the background)`,
    )
    job.status = "error"
    job.finishedAt = Date.now()
    job.message = `任务超时（超过 ${JOB_TIMEOUT_MS / 1000}s 未完成，已中止）`
    setTimeout(() => {
      if (jobs.get(JOB_KEY) === job) jobs.delete(JOB_KEY)
    }, 120_000)
  }, JOB_TIMEOUT_MS)

  void runJob().finally(() => {
    settled = true
    clearTimeout(watchdog)
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
      })

      if (light) {
        job.message = "正在同步邮箱运维池…"
        try {
          const { syncEmailTrackingPool } = await import("@/lib/server/email-tracking-pool-sync")
          await syncEmailTrackingPool()
        } catch (e) {
          result.errors.push(
            `同步邮箱运维池失败: ${e instanceof Error ? e.message : String(e)}`,
          )
        }

        job.message = "正在刷新触及产品缓存…"
        try {
          const { upsertTrackingFundListCacheEntry } = await import(
            "@/lib/server/tracking-funds-list-cache-pg"
          )
          for (const fund of result.touchedFunds) {
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
          result.errors.push(
            `刷新触及产品缓存失败: ${e instanceof Error ? e.message : String(e)}`,
          )
        }

        job.message = "正在刷新在管产品列表缓存…"
        try {
          const lightCache = await refreshManagedProductsListCacheLight()
          result.navLatestRefreshed = lightCache.listCache
        } catch (e) {
          result.errors.push(
            `刷新在管产品列表缓存失败: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      } else {
        job.message = "正在刷新在管产品指标…"
        try {
          await refreshManagedProductsNavAndListCache()
        } catch (e) {
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
      job.status = "error"
      job.finishedAt = Date.now()
      job.message = e instanceof Error ? e.message : "抓取失败"
      setTimeout(() => {
        if (jobs.get(JOB_KEY) === job) jobs.delete(JOB_KEY)
      }, 120_000)
    }
  }

  return { ok: true }
}
