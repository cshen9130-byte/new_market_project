import { runImaDianjingRankEtl, type ImaDianjingRankResult } from "@/lib/server/ima-dianjing-rank"

type JobStatus = {
  status: "idle" | "running" | "done"
  message: string
  startedAt?: number
  finishedAt?: number
  result?: ImaDianjingRankResult
}

function jobState(): JobStatus {
  const g = globalThis as typeof globalThis & { __imaDianjingRankEtl?: JobStatus }
  if (!g.__imaDianjingRankEtl) g.__imaDianjingRankEtl = { status: "idle", message: "" }
  return g.__imaDianjingRankEtl
}

export function startImaDianjingRankEtl(): { ok: true } | { ok: false; reason: string } {
  const current = jobState()
  if (current.status === "running") return { ok: false, reason: "已有一次 ima 点睛拉取在进行" }
  current.status = "running"
  current.message = "正在从 ima 点睛拉取最新周度业绩"
  current.startedAt = Date.now()
  current.finishedAt = undefined
  current.result = undefined
  void runImaDianjingRankEtl()
    .then((result) => {
      current.status = "done"
      current.result = result
      current.message = `${result.folder}，${result.saved.length} 个文件`
      current.finishedAt = Date.now()
      console.log(`[ima-dianjing] saved ${result.folder} files=${result.saved.length} bytes=${result.bytes}`)
    })
    .catch((err) => {
      current.status = "done"
      current.message = err instanceof Error ? err.message : String(err)
      current.finishedAt = Date.now()
      console.error("[ima-dianjing] etl error:", err)
    })
  return { ok: true }
}
