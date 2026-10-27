import { execFile } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { promisify } from "util"
import { configureEtlDbTimeout, loadProjectEnvFiles } from "@/lib/server/load-project-env"
import { clearTodayMomCache } from "@/lib/server/mom-cache"
import { loadMomNhciAsOf, nhciLagsPosition } from "@/lib/server/mom-nhci-freshness"
import { isChinaTradingDay, shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"

const execFileAsync = promisify(execFile)

const JOB_KEY = "__nanhuaPostcloseEtl"
/** NHCI + NHECI + nanhua_indices only — keep well under an hour. */
const JOB_TIMEOUT_MS = 45 * 60 * 1000
/** Allow afternoon catch-up after the 01:00/02:30 overnight runs. */
const MIN_RERUN_MS = 4 * 60 * 60 * 1000

export type NanhuaPostcloseEtlJobStatus = {
  status: "queued" | "running" | "done" | "error" | "skipped"
  message: string
  startedAt: number
  finishedAt?: number
  exitCode?: number
}

type PythonInvocation = {
  executable: string
  prefixArgs: string[]
}

function getJobMap(): Map<string, NanhuaPostcloseEtlJobStatus> {
  const g = globalThis as typeof globalThis & {
    __nanhuaPostcloseEtlJobs?: Map<string, NanhuaPostcloseEtlJobStatus>
  }
  if (!g.__nanhuaPostcloseEtlJobs) g.__nanhuaPostcloseEtlJobs = new Map()
  return g.__nanhuaPostcloseEtlJobs
}

function getLastSuccessAt(): number | undefined {
  return (globalThis as typeof globalThis & { __nanhuaPostcloseEtlLastSuccessAt?: number })
    .__nanhuaPostcloseEtlLastSuccessAt
}

function setLastSuccessAt(ts: number): void {
  ;(globalThis as typeof globalThis & { __nanhuaPostcloseEtlLastSuccessAt?: number })
    .__nanhuaPostcloseEtlLastSuccessAt = ts
}

function pushPythonCandidate(out: PythonInvocation[], executable: string, prefixArgs: string[] = []) {
  if (!executable || (executable.includes(path.sep) && !existsSync(executable))) return
  if (out.some((item) => item.executable === executable && item.prefixArgs.join(" ") === prefixArgs.join(" "))) {
    return
  }
  out.push({ executable, prefixArgs })
}

function listPythonCandidates(): PythonInvocation[] {
  const cwd = process.cwd()
  const out: PythonInvocation[] = []
  for (const key of ["PYTHON_EXE", "PYTHON_EXECUTABLE"] as const) {
    pushPythonCandidate(out, process.env[key] ?? "")
  }
  if (process.platform === "win32") {
    pushPythonCandidate(out, path.join(cwd, ".venv", "Scripts", "python.exe"))
    pushPythonCandidate(out, "py", ["-3"])
  } else {
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python"))
    pushPythonCandidate(out, "python3")
  }
  return out
}

async function findPython(): Promise<PythonInvocation> {
  const candidates = listPythonCandidates()
  if (!candidates.length) throw new Error("No Python executable found for Nanhua post-close ETL")
  // Prefer venv / env override; EmQuant deps are validated by the child script.
  return candidates[0]!
}

function pythonExecEnv(): NodeJS.ProcessEnv {
  loadProjectEnvFiles()
  configureEtlDbTimeout()
  const pathKey = process.platform === "win32" ? "Path" : "PATH"
  const existing = process.env[pathKey] ?? ""
  const augmentedPath =
    process.platform === "win32" || existing.includes("/usr/bin")
      ? existing
      : `${existing}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
  return {
    ...process.env,
    [pathKey]: augmentedPath,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  }
}

export function getNanhuaPostcloseEtlJobStatus(): NanhuaPostcloseEtlJobStatus | null {
  return getJobMap().get(JOB_KEY) ?? null
}

export async function runNanhuaPostcloseEtl(options?: { force?: boolean }): Promise<NanhuaPostcloseEtlJobStatus> {
  const jobs = getJobMap()
  const existing = jobs.get(JOB_KEY)
  if (existing?.status === "running" || existing?.status === "queued") {
    return existing
  }

  const today = shanghaiTodayIsoDate()
  if (!options?.force && !isChinaTradingDay(today)) {
    const skipped: NanhuaPostcloseEtlJobStatus = {
      status: "skipped",
      message: `skip: ${today} is not a China trading day`,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    }
    jobs.set(JOB_KEY, skipped)
    return skipped
  }

  const lastSuccess = getLastSuccessAt()
  if (!options?.force && lastSuccess && Date.now() - lastSuccess < MIN_RERUN_MS) {
    // Re-check DB: a prior "success" may have been recorded before this lag-aware
    // gate, or positions may have advanced after NHCI aligned.
    let stillLagging = false
    try {
      const asOf = await loadMomNhciAsOf()
      stillLagging = nhciLagsPosition(asOf)
    } catch {
      stillLagging = false
    }
    if (!stillLagging) {
      const skipped: NanhuaPostcloseEtlJobStatus = {
        status: "skipped",
        message: "skip: already ran within 4h and NHCI aligned",
        startedAt: Date.now(),
        finishedAt: Date.now(),
      }
      jobs.set(JOB_KEY, skipped)
      return skipped
    }
    console.log("[nanhua-postclose-etl] retrying within 4h because NHCI still lags positions")
  }

  if (process.env.NANHUA_POSTCLOSE_ETL_DISABLED === "1" && !options?.force) {
    const skipped: NanhuaPostcloseEtlJobStatus = {
      status: "skipped",
      message: "skip: NANHUA_POSTCLOSE_ETL_DISABLED=1",
      startedAt: Date.now(),
      finishedAt: Date.now(),
    }
    jobs.set(JOB_KEY, skipped)
    return skipped
  }

  const job: NanhuaPostcloseEtlJobStatus = {
    status: "running",
    message: "running nightly_etl --group nanhua",
    startedAt: Date.now(),
  }
  jobs.set(JOB_KEY, job)

  try {
    const { executable, prefixArgs } = await findPython()
    const scriptPath = path.join(process.cwd(), "scripts", "ma", "nightly_etl.py")
    if (!existsSync(scriptPath)) {
      throw new Error(`missing ${scriptPath}`)
    }
    const args = [...prefixArgs, scriptPath, "--group", "nanhua"]
    if (options?.force) args.push("--force")
    const { stdout, stderr } = await execFileAsync(executable, args, {
      timeout: JOB_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: pythonExecEnv(),
      cwd: process.cwd(),
    })
    if (stdout?.trim()) console.log("[nanhua-postclose-etl]", stdout.slice(-2000))
    if (stderr?.trim()) console.warn("[nanhua-postclose-etl]", stderr.slice(-2000))

    // Drop stale MOM briefing / signal caches so 持仓截面 tracks new NHCI+positions.
    clearTodayMomCache("quant-vs-subjective")
    clearTodayMomCache("warm-cache")
    // Rolling-vol chart reads these; omitting them left NHCI truncated after ETL.
    clearTodayMomCache("benchmark")
    clearTodayMomCache("product-nav")

    job.status = "done"
    job.finishedAt = Date.now()
    job.exitCode = 0
    // Only mark success when NHCI has caught position as-of (or no positions yet).
    // Otherwise afternoon retries (15:35/16:30/17:45/19:00) must keep running —
    // EmQuant often publishes after the first post-close attempt.
    try {
      const asOf = await loadMomNhciAsOf()
      if (nhciLagsPosition(asOf)) {
        job.message = `partial: NHCI ${asOf.nhciAsOf || "null"} lags positions ${asOf.positionAsOf || "null"}`
        // Do NOT setLastSuccessAt — allow next cron tick to retry within 4h.
        console.warn(`[nanhua-postclose-etl] ${job.message}`)
      } else {
        job.message = `ok: NHCI ${asOf.nhciAsOf || "null"} aligned with positions ${asOf.positionAsOf || "null"}`
        setLastSuccessAt(job.finishedAt)
      }
    } catch (e) {
      job.message = "ok (as-of check failed)"
      setLastSuccessAt(job.finishedAt)
      console.warn("[nanhua-postclose-etl] as-of check failed:", e)
    }
    return job
  } catch (err) {
    const e = err as { message?: string; code?: number; killed?: boolean; stdout?: string; stderr?: string }
    job.status = "error"
    job.message = e?.message || String(err)
    job.finishedAt = Date.now()
    job.exitCode = typeof e?.code === "number" ? e.code : 1
    if (e?.stderr) console.error("[nanhua-postclose-etl]", String(e.stderr).slice(-2000))
    return job
  }
}

/** Called from instrumentation cron — weekday post-close NHCI / Nanhua catch-up. */
export function runScheduledNanhuaPostcloseEtl(): void {
  if (process.env.NANHUA_POSTCLOSE_ETL_CRON_DISABLED === "1") {
    console.log("[nanhua-postclose-etl] skipped: NANHUA_POSTCLOSE_ETL_CRON_DISABLED=1")
    return
  }
  const existing = getNanhuaPostcloseEtlJobStatus()
  if (existing?.status === "running" || existing?.status === "queued") {
    console.log("[nanhua-postclose-etl] skipped: job already running")
    return
  }
  runNanhuaPostcloseEtl().then((job) => {
    console.log(`[nanhua-postclose-etl] ${job.status}: ${job.message}`)
  }).catch((e) => {
    console.error("[nanhua-postclose-etl] scheduler error:", e)
  })
}
