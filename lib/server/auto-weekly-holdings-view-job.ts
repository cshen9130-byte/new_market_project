/**
 * Background refresh of the latest-week 持仓版 reports after 基金经理观点 changes.
 */
import { randomUUID } from "crypto"
import { regenerateAutoWeeklyHoldingsReports } from "@/lib/server/auto-weekly-reports"

export type ManagerViewRegenJob = {
  id: string
  status: "running" | "done" | "error"
  total: number
  done: number
  updated: number
  failed: Array<{ product_name: string; error: string }>
  error?: string
  startedAt: string
  updatedAt: string
}

const jobs = new Map<string, ManagerViewRegenJob>()

export function getManagerViewRegenJob(id: string): ManagerViewRegenJob | null {
  return jobs.get((id || "").trim()) ?? null
}

export function startManagerViewRegenJob(
  products: Array<{ product_name: string; beian_hao?: string | null }>,
): ManagerViewRegenJob {
  const now = new Date().toISOString()
  const job: ManagerViewRegenJob = {
    id: `mvr_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    status: "running",
    total: products.length,
    done: 0,
    updated: 0,
    failed: [],
    startedAt: now,
    updatedAt: now,
  }
  jobs.set(job.id, job)
  void (async () => {
    try {
      const result = await regenerateAutoWeeklyHoldingsReports(products, (done, total) => {
        job.done = done
        job.total = total
        job.updatedAt = new Date().toISOString()
      })
      job.done = job.total
      job.updated = result.updated
      job.failed = result.failed
      job.status = "done"
      job.updatedAt = new Date().toISOString()
    } catch (err) {
      job.status = "error"
      job.error = err instanceof Error ? err.message : String(err)
      job.updatedAt = new Date().toISOString()
    }
  })()
  return job
}
