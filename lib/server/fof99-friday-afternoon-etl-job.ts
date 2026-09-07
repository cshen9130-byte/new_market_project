import { execFile } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { promisify } from "util"

import { isChinaWeekendOrPublicHoliday, shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
import { isoDateWeekdayUtc, parseIsoDateParts } from "@/lib/nav-trading-day"
import { configureEtlDbTimeout, loadProjectEnvFiles } from "@/lib/server/load-project-env"

const execFileAsync = promisify(execFile)

const JOB_KEY = "__fof99FridayAfternoonEtl"
const JOB_TIMEOUT_MS = 50 * 60 * 1000
const MIN_RERUN_MS = 20 * 60 * 60 * 1000

export type Fof99FridayAfternoonEtlJobStatus = {
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

function getJobMap(): Map<string, Fof99FridayAfternoonEtlJobStatus> {
  const g = globalThis as typeof globalThis & {
    __fof99FridayAfternoonEtlJobs?: Map<string, Fof99FridayAfternoonEtlJobStatus>
  }
  if (!g.__fof99FridayAfternoonEtlJobs) g.__fof99FridayAfternoonEtlJobs = new Map()
  return g.__fof99FridayAfternoonEtlJobs
}

function getLastSuccessAt(): number | undefined {
  return (globalThis as typeof globalThis & { __fof99FridayAfternoonEtlLastSuccessAt?: number })
    .__fof99FridayAfternoonEtlLastSuccessAt
}

function setLastSuccessAt(ts: number): void {
  ;(globalThis as typeof globalThis & { __fof99FridayAfternoonEtlLastSuccessAt?: number })
    .__fof99FridayAfternoonEtlLastSuccessAt = ts
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

async function pythonHasDeps(invocation: PythonInvocation): Promise<boolean> {
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
    if (await pythonHasDeps(candidate)) return candidate
  }
  throw new Error("FOF99 Friday ETL Python deps missing (psycopg2). Run: pip install psycopg2-binary")
}

/** Last calendar Friday strictly before Shanghai today (Friday → last week). */
export function previousWeekFridayIso(todayIso: string = shanghaiTodayIsoDate()): string | null {
  const weekday = isoDateWeekdayUtc(todayIso)
  const parts = parseIsoDateParts(todayIso)
  if (weekday == null || !parts) return null
  const daysBack = weekday === 5 ? 7 : (weekday + 2) % 7 || 7
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d - daysBack)).toISOString().slice(0, 10)
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
    TZ: "Asia/Shanghai",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  }
}

export function startFof99FridayAfternoonEtlJob(options?: {
  force?: boolean
}): { ok: true } | { ok: false; reason: "already_running" | "recently_ran" | "disabled" | "holiday" | "local_tunnel" } {
  if (process.env.FOF99_FRIDAY_ETL_DISABLED === "1" && !options?.force) {
    return { ok: false, reason: "disabled" }
  }
  if (process.platform === "win32" && (process.env.DATABASE_URL || "").includes(":5433/") && !options?.force) {
    console.log("[fof99-friday-etl] skipped: Windows next against tunneled production DB")
    return { ok: false, reason: "local_tunnel" }
  }
  const prevFriday = previousWeekFridayIso()
  if (!options?.force && prevFriday && isChinaWeekendOrPublicHoliday(prevFriday)) {
    console.log("[fof99-friday-etl] skipped: previous week Friday is a CN holiday", prevFriday)
    return { ok: false, reason: "holiday" }
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

  const job: Fof99FridayAfternoonEtlJobStatus = {
    status: "queued",
    message: "准备抓取上一交易周五火富牛净值…",
    startedAt: Date.now(),
  }
  jobs.set(JOB_KEY, job)

  void (async () => {
    job.status = "running"
    job.message = "正在运行 Friday-afternoon 火富牛 ETL（含宇宙维护）…"
    try {
      const { executable, prefixArgs } = await findPython()
      const scriptPath = path.join(process.cwd(), "scripts", "ma", "fof99_friday_afternoon_fetch.py")
      const args = [...prefixArgs, scriptPath, "--scheduled"]
      console.log("[fof99-friday-etl] starting:", executable, args.join(" "))
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
      if (stdout.trim()) console.log("[fof99-friday-etl]", stdout.trim().slice(-4000))
      if (stderr.trim()) console.warn("[fof99-friday-etl stderr]", stderr.trim().slice(-4000))
      job.status = "done"
      job.message = "上一交易周五火富牛净值已更新，宇宙已维护"
      job.finishedAt = Date.now()
      job.exitCode = 0
      setLastSuccessAt(job.finishedAt)
      console.log(
        "[fof99-friday-etl] finished OK in",
        ((job.finishedAt - job.startedAt) / 1000).toFixed(1),
        "s",
      )
    } catch (error) {
      const err = error as { message?: string; code?: number | string; stdout?: string; stderr?: string }
      job.status = "error"
      job.message = err.message || "Friday-afternoon 火富牛 ETL failed"
      job.finishedAt = Date.now()
      job.exitCode = typeof err.code === "number" ? err.code : 1
      if (err.stdout?.trim()) console.error("[fof99-friday-etl stdout]", err.stdout.trim().slice(-4000))
      if (err.stderr?.trim()) console.error("[fof99-friday-etl stderr]", err.stderr.trim().slice(-4000))
      console.error("[fof99-friday-etl] failed:", job.message)
    }
  })()

  return { ok: true }
}
