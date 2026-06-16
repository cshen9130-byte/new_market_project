import {
  fetchEmailParseRecords,
  type EmailParseFetchResult,
} from "@/lib/server/email-parse-fetch"
import { refreshManagedProductsEmailNavLatest } from "@/lib/server/email-nav-latest-pg"

export type EmailParseFetchJobStatus = {
  status: "queued" | "running" | "done" | "error"
  message: string
  startedAt: number
  finishedAt?: number
  days?: number
  result?: EmailParseFetchResult
}

const JOB_KEY = "__emailParseFetch"

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
}): { ok: true } | { ok: false; reason: "already_running" } {
  const jobs = getJobMap()
  const existing = jobs.get(JOB_KEY)
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return { ok: false, reason: "already_running" }
  }

  const job: EmailParseFetchJobStatus = {
    status: "queued",
    message: "准备扫描邮箱…",
    startedAt: Date.now(),
    days: options?.days,
  }
  jobs.set(JOB_KEY, job)

  void (async () => {
    job.status = "running"
    job.message = "正在扫描并解析邮件…"
    try {
      const result = await fetchEmailParseRecords({
        crawlEmailId: options?.crawlEmailId,
        days: options?.days,
        skipNavLatestRefresh: true,
      })

      job.message = "正在刷新在管产品净值…"
      try {
        await refreshManagedProductsEmailNavLatest()
      } catch (e) {
        result.errors.push(
          `刷新在管产品邮件净值失败: ${e instanceof Error ? e.message : String(e)}`,
        )
      }

      job.status = "done"
      job.finishedAt = Date.now()
      job.result = result
      job.message = "解析完成"
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
  })()

  return { ok: true }
}
