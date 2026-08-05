import { execFile } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { promisify } from "util"
import { configureEtlDbTimeout, loadProjectEnvFiles } from "@/lib/server/load-project-env"

const execFileAsync = promisify(execFile)

const JOB_KEY = "__stockMarketEtl"
/** ashare_daily hist backfill can run up to ASHARE_ETL_TIMEOUT (default 7200s) per chunk. */
const JOB_TIMEOUT_MS = 3 * 60 * 60 * 1000
const MIN_RERUN_MS = 20 * 60 * 60 * 1000

export type StockMarketEtlJobStatus = {
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

function getJobMap(): Map<string, StockMarketEtlJobStatus> {
  const g = globalThis as typeof globalThis & {
    __stockMarketEtlJobs?: Map<string, StockMarketEtlJobStatus>
  }
  if (!g.__stockMarketEtlJobs) g.__stockMarketEtlJobs = new Map()
  return g.__stockMarketEtlJobs
}

function getLastSuccessAt(): number | undefined {
  return (globalThis as typeof globalThis & { __stockMarketEtlLastSuccessAt?: number })
    .__stockMarketEtlLastSuccessAt
}

function setLastSuccessAt(ts: number): void {
  ;(globalThis as typeof globalThis & { __stockMarketEtlLastSuccessAt?: number }).__stockMarketEtlLastSuccessAt =
    ts
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

async function pythonHasStockDeps(invocation: PythonInvocation): Promise<boolean> {
  try {
    await execFileAsync(
      invocation.executable,
      [...invocation.prefixArgs, "-c", "import akshare, pandas, psycopg2"],
      { timeout: 15_000 },
    )
    return true
  } catch {
    return false
  }
}

async function findPython(): Promise<PythonInvocation> {
  for (const candidate of listPythonCandidates()) {
    if (await pythonHasStockDeps(candidate)) return candidate
  }
  throw new Error(
    "Stock ETL Python deps missing (akshare, pandas, psycopg2). " +
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

export function getStockMarketEtlJobStatus(): StockMarketEtlJobStatus | null {
  return getJobMap().get(JOB_KEY) ?? null
}

export function startStockMarketEtlJob(options?: {
  /** Skip the 20h dedupe guard (manual / ops runs). */
  force?: boolean
}): { ok: true } | { ok: false; reason: "already_running" | "recently_ran" | "disabled" } {
  if (process.env.STOCK_ETL_CRON_DISABLED === "1" && !options?.force) {
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

  const job: StockMarketEtlJobStatus = {
    status: "queued",
    message: "准备更新股票市场数据…",
    startedAt: Date.now(),
  }
  jobs.set(JOB_KEY, job)

  void (async () => {
    job.status = "running"
    job.message = "正在运行 stock ETL…"

    try {
      const { executable, prefixArgs } = await findPython()
      const scriptPath = path.join(process.cwd(), "scripts", "ma", "nightly_etl.py")
      const args = [...prefixArgs, scriptPath, "--group", "stock"]

      console.log("[stock-market-etl] starting:", executable, args.join(" "))

      // Pin PYTHON_EXE so nightly_etl child fetch scripts use the same
      // interpreter that passed the akshare/pandas/psycopg2 probe — not a
      // incomplete .venv that can leave ashare_daily frozen for days.
      const env = pythonExecEnv()
      if (executable !== "py" && executable !== "python" && executable !== "python3") {
        env.PYTHON_EXE = executable
      }
      // East Money AkShare endpoints are frequently blocked; Sina is the
      // reliable path for amount + turnover used by crowding charts.
      if (!env.ASHARE_AK_PROVIDER) {
        env.ASHARE_AK_PROVIDER = "sina"
      }
      env.TQDM_DISABLE = env.TQDM_DISABLE || "1"

      const { stdout, stderr } = await execFileAsync(executable, args, {
        cwd: process.cwd(),
        env,
        timeout: JOB_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      })

      if (stdout.trim()) console.log("[stock-market-etl]", stdout.trim().slice(-4000))
      if (stderr.trim()) console.warn("[stock-market-etl stderr]", stderr.trim().slice(-4000))

      job.status = "done"
      job.message = "股票市场数据已更新"
      job.finishedAt = Date.now()
      job.exitCode = 0
      setLastSuccessAt(job.finishedAt)
      console.log("[stock-market-etl] finished OK in", ((job.finishedAt - job.startedAt) / 1000).toFixed(1), "s")
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { code?: string; killed?: boolean; signal?: string }
      job.status = "error"
      job.finishedAt = Date.now()
      job.exitCode = typeof err.code === "number" ? err.code : 1
      job.message =
        err.killed || err.signal
          ? "股票市场 ETL 超时或被中断"
          : err.message || "股票市场 ETL 失败"
      console.error("[stock-market-etl] failed:", job.message)
    }
  })()

  return { ok: true }
}

/** Called from instrumentation cron — daily stock-market chart refresh. */
export function runScheduledStockMarketEtl(): void {
  const result = startStockMarketEtlJob()
  if (!result.ok) {
    if (result.reason === "recently_ran") {
      console.log("[stock-market-etl] skipped: already ran within 20h")
    } else if (result.reason === "already_running") {
      console.log("[stock-market-etl] skipped: job already running")
    } else if (result.reason === "disabled") {
      console.log("[stock-market-etl] skipped: STOCK_ETL_CRON_DISABLED=1")
    }
  }
}
