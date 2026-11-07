import { runYingmiPrivateFundEtl, type YingmiEtlResult } from "@/lib/server/yingmi-private-fund-etl"

type JobStatus = {
  status: "idle" | "running" | "done"
  message: string
  startedAt?: number
  finishedAt?: number
  result?: YingmiEtlResult
}

function jobState(): JobStatus {
  const g = globalThis as typeof globalThis & { __yingmiPrivateFundEtl?: JobStatus }
  if (!g.__yingmiPrivateFundEtl) g.__yingmiPrivateFundEtl = { status: "idle", message: "" }
  return g.__yingmiPrivateFundEtl
}

export function getYingmiPrivateFundEtlStatus(): JobStatus {
  return jobState()
}

export function startYingmiPrivateFundEtl(opts?: { force?: boolean }): { ok: true } | { ok: false; reason: string } {
  const current = jobState()
  if (current.status === "running") return { ok: false, reason: "已有一次拉取在进行" }
  const next = jobState()
  next.status = "running"
  next.message = "正在拉取盈米代销私募"
  next.startedAt = Date.now()
  next.finishedAt = undefined
  next.result = undefined
  void runYingmiPrivateFundEtl({ force: opts?.force === true })
    .then((result) => {
      next.status = "done"
      next.result = result
      next.message = result.reason
      next.finishedAt = Date.now()
      console.log(`[yingmi-private-fund] ${result.action} ${result.status} calls=${result.calls} ${result.reason}`)
    })
    .catch((err) => {
      next.status = "done"
      next.message = err instanceof Error ? err.message : String(err)
      next.finishedAt = Date.now()
      console.error("[yingmi-private-fund] etl error:", err)
    })
  return { ok: true }
}
