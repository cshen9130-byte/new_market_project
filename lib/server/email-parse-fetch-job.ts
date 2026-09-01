import fs from "fs"
import path from "path"
import {
  fetchEmailParseRecords,
  type EmailParseFetchResult,
} from "@/lib/server/email-parse-fetch"
import {
  refreshManagedAndFofListCachesIncremental,
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
/** Scheduled 5m checkpoint poll (yields to user traffic): keep short so stuck IMAP cannot block the site. */
const SCHEDULED_JOB_TIMEOUT_MS = 12 * 60 * 1000
/** Manual ops re-parse can scan several days × multiple mailboxes; needs headroom beyond IMAP + cache. */
const MANUAL_JOB_TIMEOUT_MS = 45 * 60 * 1000
const YIELD_POLL_MS = 3_000

function resolveJobTimeoutMs(yieldToUserTraffic: boolean): number {
  return yieldToUserTraffic ? SCHEDULED_JOB_TIMEOUT_MS : MANUAL_JOB_TIMEOUT_MS
}

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
      "[email-parse-fetch-job] yielding to interactive user traffic — aborting scheduled ETL (next 5m cron will retry)",
    )
    abort.abort(new DOMException("yielded to user traffic", "AbortError"))
  }, YIELD_POLL_MS)
}

function stopActiveRun(run: ActiveRun | null): void {
  if (!run) return
  if (run.yieldPoll) clearInterval(run.yieldPoll)
  setActiveRun(null)
}

function runtimeDir(): string {
  const root =
    process.env.MARKET_DASHBOARD_STORAGE_DIR || path.join(process.cwd(), "data")
  return path.join(root, "runtime")
}

function emailParseLockPath(): string {
  return path.join(runtimeDir(), "email-parse-fetch.lock")
}

function pidIsAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLockPid(): number | null {
  try {
    const raw = fs.readFileSync(emailParseLockPath(), "utf8").trim()
    const pid = parseInt(raw, 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

/** True when another OS process holds the email-parse lock (cross-PM2 single-flight). */
export function isEmailParseFetchJobLockedElsewhere(): boolean {
  const pid = readLockPid()
  if (pid == null) return false
  if (pid === process.pid) return false
  if (pidIsAlive(pid)) return true
  try {
    fs.unlinkSync(emailParseLockPath())
  } catch {
    // ignore stale cleanup races
  }
  return false
}

function tryAcquireEmailParseLock(): boolean {
  fs.mkdirSync(runtimeDir(), { recursive: true })
  const lockPath = emailParseLockPath()
  const writeLock = (): boolean => {
    try {
      const fd = fs.openSync(lockPath, "wx")
      fs.writeFileSync(fd, String(process.pid), "utf8")
      fs.closeSync(fd)
      return true
    } catch {
      return false
    }
  }
  if (writeLock()) return true
  const pid = readLockPid()
  if (pid != null && pid !== process.pid && pidIsAlive(pid)) return false
  try {
    fs.unlinkSync(lockPath)
  } catch {
    // ignore
  }
  return writeLock()
}

function releaseEmailParseLock(): void {
  try {
    const pid = readLockPid()
    if (pid != null && pid !== process.pid) return
    fs.unlinkSync(emailParseLockPath())
  } catch {
    // ignore
  }
}

export function getEmailParseFetchJobStatus(): EmailParseFetchJobStatus | null {
  return getJobMap().get(JOB_KEY) ?? null
}

export function startEmailParseFetchJob(options?: {
  crawlEmailId?: string
  days?: number
  /**
   * Intraday / 5m checkpoint poll: parse + upsert only, then incrementally refresh
   * 在管产品 + FOF底层 caches when new NAV/估值表 landed. Skips full FOF/tracking rebuilds.
   */
  light?: boolean
  /**
   * When true (scheduled 5m poll), abort promptly if users browse or upload so the
   * site keeps CPU/DB/memory. Manual ops-triggered runs leave this false.
   */
  yieldToUserTraffic?: boolean
}): { ok: true } | { ok: false; reason: "already_running" } {
  const jobs = getJobMap()
  const existing = jobs.get(JOB_KEY)
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return { ok: false, reason: "already_running" }
  }
  if (!tryAcquireEmailParseLock()) {
    return { ok: false, reason: "already_running" }
  }

  const light = options?.light === true
  const yieldToUserTraffic = options?.yieldToUserTraffic === true
  const jobTimeoutMs = resolveJobTimeoutMs(yieldToUserTraffic)
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
      `[email-parse-fetch-job] watchdog: ${light ? "light" : "full"} job exceeded ${jobTimeoutMs / 1000}s — marking as timed out (a stuck step may still be running in the background)`,
    )
    abort.abort(new DOMException("job timeout", "AbortError"))
    job.status = "error"
    job.finishedAt = Date.now()
    job.message = `任务超时（超过 ${Math.round(jobTimeoutMs / 60_000)} 分钟未完成，已中止）`
    stopActiveRun(activeRun)
    releaseEmailParseLock()
    setTimeout(() => {
      if (jobs.get(JOB_KEY) === job) jobs.delete(JOB_KEY)
    }, 120_000)
  }, jobTimeoutMs)

  void runJob().finally(() => {
    settled = true
    clearTimeout(watchdog)
    stopActiveRun(activeRun)
    releaseEmailParseLock()
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
        // Only refresh caches when parse actually wrote NAV / 估值表 rows.
        // A download that yields 0 saved rows (non-NAV fund mail) is not "new data".
        const hasNewData =
          result.navSaved > 0
          || result.valuationSaved > 0
          || result.valuationHoldingsSaved > 0

        if (!hasNewData) {
          job.message = "无新净值/估值表，跳过缓存刷新"
          console.log(
            `[email-parse-fetch-job] light idle — skipped=${result.emailsSkippedKnown}` +
              ` downloaded=${result.emailsDownloaded} (no cache refresh)`,
          )
        } else {
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
            // upsertTrackingFundListCacheEntry also refreshes ops_private_fund_detail_nav_cache
            // for each touched fund (instant product-page series).
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

          // Advance FOF底层 tip (最新净值/涨跌幅) for touched funds immediately —
          // do not wait for the full metrics rebuild below.
          if (result.touchedFunds.length > 0) {
            if (abort.signal.aborted) {
              throw abort.signal.reason ?? new DOMException("Aborted", "AbortError")
            }
            job.message = "正在同步FOF底层最新涨跌幅…"
            try {
              const { syncFofOverviewLatestFromDetail } = await import(
                "@/lib/server/fof-overview-list-cache-pg"
              )
              const tipSynced = await syncFofOverviewLatestFromDetail(
                result.touchedFunds.map((fund) => ({
                  product_name: fund.fundName || fund.productCode,
                  beian_hao: fund.productCode || null,
                  short_name: fund.fundName || null,
                })),
              )
              console.log(
                `[email-parse-fetch-job] FOF tip sync updated ${tipSynced}/${result.touchedFunds.length} touched funds`,
              )
            } catch (e) {
              if (isAbortError(e)) throw e
              result.errors.push(
                `同步FOF底层最新涨跌幅失败: ${e instanceof Error ? e.message : String(e)}`,
              )
            }
          }

          if (result.valuationSaved > 0) {
            if (abort.signal.aborted) {
              throw abort.signal.reason ?? new DOMException("Aborted", "AbortError")
            }
            job.message = "正在刷新在管产品FOF底层并补充新产品…"
            try {
              const { refreshManagedFofUnderlyingAndAutoAdd } = await import(
                "@/lib/server/fof-underlying-auto-add-pg"
              )
              const fofSync = await refreshManagedFofUnderlyingAndAutoAdd({
                skipSymbolBackfill: true,
                skipNavBackfill: true,
                productCodes: result.touchedFunds
                  .map((fund) => fund.productCode)
                  .filter(Boolean),
              })
              result.managedFofUnderlyingRefreshed = fofSync.managedRows
              result.opsFofUnderlyingAdded = fofSync.opsFofUnderlyingAdded
              result.detailFofUnderlyingAdded = fofSync.detailFofUnderlyingAdded
              console.log(
                `[email-parse-fetch-job] managed FOF underlying refresh` +
                  ` rows=${fofSync.managedRows} summary+=${fofSync.opsFofUnderlyingAdded}` +
                  ` detail+=${fofSync.detailFofUnderlyingAdded}`,
              )
              try {
                const { ensureFofUnderlyingInEmailPool } = await import(
                  "@/lib/server/fof-email-product-sync"
                )
                await ensureFofUnderlyingInEmailPool()
              } catch (syncErr) {
                console.warn("[email-parse-fetch-job] FOF→邮箱池 sync skipped:", syncErr)
              }
            } catch (e) {
              if (isAbortError(e)) throw e
              result.errors.push(
                `刷新在管产品FOF底层失败: ${e instanceof Error ? e.message : String(e)}`,
              )
            }
          }

          if (abort.signal.aborted) {
            throw abort.signal.reason ?? new DOMException("Aborted", "AbortError")
          }
          job.message = "正在增量刷新在管产品与FOF底层缓存…"
          try {
            const incr = await refreshManagedAndFofListCachesIncremental()
            result.navLatestRefreshed = incr.listCache
            console.log(
              `[email-parse-fetch-job] incremental cache refresh` +
                ` managed=${incr.listCache} fof=${incr.fofCache}`,
            )
          } catch (e) {
            if (isAbortError(e)) throw e
            result.errors.push(
              `增量刷新列表缓存失败: ${e instanceof Error ? e.message : String(e)}`,
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
        ? `增量解析完成（${elapsedSec}s，新下载 ${result.emailsDownloaded}，触及 ${result.touchedFunds.length} 只产品）`
        : "解析完成"
      console.log(
        `[email-parse-fetch-job] ${light ? "light" : "full"} done in ${elapsedSec}s` +
          ` emails=${result.emailsScanned} skipped=${result.emailsSkippedKnown}` +
          ` downloaded=${result.emailsDownloaded} nav=${result.navSaved}` +
          ` valuation=${result.valuationSaved} touched=${result.touchedFunds.length}`,
      )
      setTimeout(() => {
        if (jobs.get(JOB_KEY) === job) jobs.delete(JOB_KEY)
      }, 60_000)
    } catch (e) {
      job.finishedAt = Date.now()
      if (isAbortError(e) && yieldToUserTraffic) {
        job.status = "cancelled"
        job.message = "已让位给用户访问，将在下次 5 分钟定时任务重试"
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
