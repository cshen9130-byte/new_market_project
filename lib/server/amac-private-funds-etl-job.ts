import { execFile } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { promisify } from "util"
import { configureEtlDbTimeout, loadProjectEnvFiles } from "@/lib/server/load-project-env"

const execFileAsync = promisify(execFile)

const JOB_KEY = "__amacPrivateFundsEtl"
/** Sunday full AMAC list sync can take ~30–40 minutes; leave headroom. */
const JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000
const MIN_RERUN_MS = 12 * 60 * 60 * 1000

export type AmacPrivateFundsEtlJobStatus = {
  status: "queued" | "running" | "done" | "error"
  message: string
  startedAt: number
  finishedAt?: number
  exitCode?: number
}

type PythonInvocation = {
  executable: string
  prefixArgs: string[]
}

function getJobMap(): Map<string, AmacPrivateFundsEtlJobStatus> {
  const g = globalThis as typeof globalThis & {
    __amacPrivateFundsEtlJobs?: Map<string, AmacPrivateFundsEtlJobStatus>
  }
  if (!g.__amacPrivateFundsEtlJobs) g.__amacPrivateFundsEtlJobs = new Map()
  return g.__amacPrivateFundsEtlJobs
}

function getLastSuccessAt(): number | undefined {
  return (globalThis as typeof globalThis & { __amacPrivateFundsEtlLastSuccessAt?: number })
    .__amacPrivateFundsEtlLastSuccessAt
}

function setLastSuccessAt(ts: number): void {
  ;(globalThis as typeof globalThis & { __amacPrivateFundsEtlLastSuccessAt?: number })
    .__amacPrivateFundsEtlLastSuccessAt = ts
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

async function pythonHasAmacDeps(invocation: PythonInvocation): Promise<boolean> {
  try {
    await execFileAsync(
      invocation.executable,
      [...invocation.prefixArgs, "-c", "import psycopg2"],
      { timeout: 15_000 },
    )
    return true
  } catch {
    return false
  }
}

async function findPython(): Promise<PythonInvocation> {
  for (const candidate of listPythonCandidates()) {
    if (await pythonHasAmacDeps(candidate)) return candidate
  }
  throw new Error("AMAC ETL Python deps missing (psycopg2). Run: pip install psycopg2-binary")
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

export function startAmacPrivateFundsEtlJob(options?: {
  force?: boolean
}): { ok: true } | { ok: false; reason: "already_running" | "recently_ran" | "disabled" } {
  if (process.env.AMAC_ETL_CRON_DISABLED === "1" && !options?.force) {
    return { ok: false, reason: "disabled" }
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

  const job: AmacPrivateFundsEtlJobStatus = {
    status: "queued",
    message: "准备同步协会私募基金列表…",
    startedAt: Date.now(),
  }
  jobs.set(JOB_KEY, job)

  void (async () => {
    job.status = "running"
    job.message = "正在同步协会私募基金列表…"
    try {
      const { executable, prefixArgs } = await findPython()
      const scriptPath = path.join(process.cwd(), "scripts", "ma", "nightly_etl.py")
      const args = [...prefixArgs, scriptPath, "--group", "amac"]
      console.log("[amac-private-funds-etl] starting:", executable, args.join(" "))
      const env = pythonExecEnv()
      if (executable !== "py" && executable !== "python" && executable !== "python3") {
        env.PYTHON_EXE = executable
      }
      const { stdout, stderr } = await execFileAsync(executable, args, {
        cwd: process.cwd(),
        env,
        timeout: JOB_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      })
      if (stdout.trim()) console.log("[amac-private-funds-etl]", stdout.trim().slice(-4000))
      if (stderr.trim()) console.warn("[amac-private-funds-etl stderr]", stderr.trim().slice(-4000))
      job.status = "done"
      job.message = "协会私募基金列表已更新"
      job.finishedAt = Date.now()
      job.exitCode = 0
      setLastSuccessAt(job.finishedAt)
      console.log(
        "[amac-private-funds-etl] finished OK in",
        ((job.finishedAt - job.startedAt) / 1000).toFixed(1),
        "s",
      )
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { code?: string; killed?: boolean; signal?: string }
      job.status = "error"
      job.finishedAt = Date.now()
      job.exitCode = typeof err.code === "number" ? err.code : 1
      job.message =
        err.killed || err.signal
          ? "协会私募基金 ETL 超时或被中断"
          : err.message || "协会私募基金 ETL 失败"
      console.error("[amac-private-funds-etl] failed:", job.message)
    }
  })()

  return { ok: true }
}

export function runScheduledAmacPrivateFundsEtl(): void {
  const result = startAmacPrivateFundsEtlJob()
  if (!result.ok) {
    if (result.reason === "recently_ran") {
      console.log("[amac-private-funds-etl] skipped: already ran within 12h")
    } else if (result.reason === "already_running") {
      console.log("[amac-private-funds-etl] skipped: job already running")
    } else if (result.reason === "disabled") {
      console.log("[amac-private-funds-etl] skipped: AMAC_ETL_CRON_DISABLED=1")
    }
  }
}
