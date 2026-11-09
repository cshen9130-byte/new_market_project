import { execFile } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { promisify } from "util"
import { configureEtlDbTimeout, loadProjectEnvFiles } from "@/lib/server/load-project-env"

const execFileAsync = promisify(execFile)

const JOB_KEY = "__macroMarketEtl"
const US_JOB_KEY = "__usMacroEtl"
const JOB_TIMEOUT_MS = 90 * 60 * 1000
const US_JOB_TIMEOUT_MS = 15 * 60 * 1000
const MIN_RERUN_MS = 20 * 60 * 60 * 1000
const US_MIN_RERUN_MS = 6 * 60 * 60 * 1000

export type MacroMarketEtlJobStatus = {
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

function getJobMap(): Map<string, MacroMarketEtlJobStatus> {
  const g = globalThis as typeof globalThis & {
    __macroMarketEtlJobs?: Map<string, MacroMarketEtlJobStatus>
  }
  if (!g.__macroMarketEtlJobs) g.__macroMarketEtlJobs = new Map()
  return g.__macroMarketEtlJobs
}

function successMap(): Record<string, number> {
  const g = globalThis as typeof globalThis & { __macroMarketEtlLastSuccess?: Record<string, number> }
  if (!g.__macroMarketEtlLastSuccess) g.__macroMarketEtlLastSuccess = {}
  return g.__macroMarketEtlLastSuccess
}

function getLastSuccessAt(key: string): number | undefined {
  return successMap()[key]
}

function setLastSuccessAt(key: string, ts: number): void {
  successMap()[key] = ts
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

async function pythonHasMacroDeps(invocation: PythonInvocation): Promise<boolean> {
  try {
    await execFileAsync(
      invocation.executable,
      [...invocation.prefixArgs, "-c", "import joblib, sklearn, pandas, psycopg2"],
      { timeout: 15_000 },
    )
    return true
  } catch {
    return false
  }
}

async function findPython(): Promise<PythonInvocation> {
  for (const candidate of listPythonCandidates()) {
    if (await pythonHasMacroDeps(candidate)) return candidate
  }
  throw new Error(
    "Macro ETL Python deps missing (joblib, scikit-learn, pandas, psycopg2). " +
      "Run: pip install -r scripts/ma/requirements.txt",
  )
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

export function getMacroMarketEtlJobStatus(): MacroMarketEtlJobStatus | null {
  return getJobMap().get(JOB_KEY) ?? null
}

export function startMacroMarketEtlJob(options?: {
  /** Skip the 20h dedupe guard (manual / ops runs). */
  force?: boolean
  /** Only refresh the US FOMC / CPI / jobs file. Separate schedule from the full macro group. */
  usOnly?: boolean
}): { ok: true } | { ok: false; reason: "already_running" | "recently_ran" | "disabled" } {
  const jobKey = options?.usOnly ? US_JOB_KEY : JOB_KEY
  const minRerun = options?.usOnly ? US_MIN_RERUN_MS : MIN_RERUN_MS
  const timeout = options?.usOnly ? US_JOB_TIMEOUT_MS : JOB_TIMEOUT_MS
  const scriptArgs = options?.usOnly ? ["--step", "us_macro"] : ["--group", "macro"]

  if (process.env.MACRO_ETL_CRON_DISABLED === "1" && !options?.force) {
    return { ok: false, reason: "disabled" }
  }

  const jobs = getJobMap()
  const existing = jobs.get(jobKey)
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return { ok: false, reason: "already_running" }
  }

  const lastSuccess = getLastSuccessAt(jobKey)
  if (!options?.force && lastSuccess && Date.now() - lastSuccess < minRerun) {
    return { ok: false, reason: "recently_ran" }
  }

  const job: MacroMarketEtlJobStatus = {
    status: "queued",
    message: "准备更新宏观市场数据…",
    startedAt: Date.now(),
  }
  jobs.set(jobKey, job)

  void (async () => {
    job.status = "running"
    job.message = "正在运行 macro ETL…"

    try {
      const { executable, prefixArgs } = await findPython()
      const scriptPath = path.join(process.cwd(), "scripts", "ma", "nightly_etl.py")
      const args = [...prefixArgs, scriptPath, ...scriptArgs]

      console.log("[macro-market-etl] starting:", executable, args.join(" "))

      const { stdout, stderr } = await execFileAsync(executable, args, {
        cwd: process.cwd(),
        env: pythonExecEnv(),
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      })

      if (stdout.trim()) console.log("[macro-market-etl]", stdout.trim().slice(-4000))
      if (stderr.trim()) console.warn("[macro-market-etl stderr]", stderr.trim().slice(-4000))

      job.status = "done"
      job.message = "宏观市场数据已更新"
      job.finishedAt = Date.now()
      job.exitCode = 0
      setLastSuccessAt(jobKey, job.finishedAt)
      console.log("[macro-market-etl] finished OK in", ((job.finishedAt - job.startedAt) / 1000).toFixed(1), "s")
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { code?: string; killed?: boolean; signal?: string }
      job.status = "error"
      job.finishedAt = Date.now()
      job.exitCode = typeof err.code === "number" ? err.code : 1
      job.message =
        err.killed || err.signal
          ? "宏观市场 ETL 超时或被中断"
          : err.message || "宏观市场 ETL 失败"
      console.error("[macro-market-etl] failed:", job.message)
    }
  })()

  return { ok: true }
}

/** 08:15 and 22:00 Beijing. US CPI/NFP print near 21:30, FOMC near 03:00. */
export function runScheduledUsMacroEtl(): void {
  const result = startMacroMarketEtlJob({ usOnly: true })
  if (!result.ok) console.log(`[us-macro-etl] skipped: ${result.reason}`)
}

/** Called from instrumentation cron — daily macro chart refresh. */
export function runScheduledMacroMarketEtl(): void {
  const result = startMacroMarketEtlJob()
  if (!result.ok) {
    if (result.reason === "recently_ran") {
      console.log("[macro-market-etl] skipped: already ran within 20h")
    } else if (result.reason === "already_running") {
      console.log("[macro-market-etl] skipped: job already running")
    } else if (result.reason === "disabled") {
      console.log("[macro-market-etl] skipped: MACRO_ETL_CRON_DISABLED=1")
    }
  }
}
