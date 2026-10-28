import { execFile } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { promisify } from "util"

import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
import { isoDateWeekdayUtc } from "@/lib/nav-trading-day"
import { configureEtlDbTimeout, loadProjectEnvFiles } from "@/lib/server/load-project-env"
import {
  previousWeekFridayIso,
  weekOfFridayHasOpenDay,
} from "@/lib/server/fof99-friday-afternoon-etl-job"

const execFileAsync = promisify(execFile)

const JOB_KEY = "__fof99MidweekAdvancedlistEtl"
const JOB_TIMEOUT_MS = 30 * 60 * 1000
const MIN_RERUN_MS = 6 * 60 * 60 * 1000

export type Fof99MidweekAdvancedlistEtlJobStatus = {
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

function getJobMap(): Map<string, Fof99MidweekAdvancedlistEtlJobStatus> {
  const g = globalThis as typeof globalThis & {
    __fof99MidweekAdvancedlistEtlJobs?: Map<string, Fof99MidweekAdvancedlistEtlJobStatus>
  }
  if (!g.__fof99MidweekAdvancedlistEtlJobs) g.__fof99MidweekAdvancedlistEtlJobs = new Map()
  return g.__fof99MidweekAdvancedlistEtlJobs
}

function getLastSuccessAt(): number | undefined {
  return (globalThis as typeof globalThis & { __fof99MidweekAdvancedlistEtlLastSuccessAt?: number })
    .__fof99MidweekAdvancedlistEtlLastSuccessAt
}

function setLastSuccessAt(ts: number): void {
  ;(globalThis as typeof globalThis & { __fof99MidweekAdvancedlistEtlLastSuccessAt?: number })
    .__fof99MidweekAdvancedlistEtlLastSuccessAt = ts
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
  throw new Error("FOF99 midweek ETL Python deps missing (psycopg2). Run: pip install psycopg2-binary")
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

/** True when Shanghai today is Tuesday, Wednesday, or Thursday (UTC weekday of the ISO date). */
export function isShanghaiTueToThu(todayIso: string = shanghaiTodayIsoDate()): boolean {
  const weekday = isoDateWeekdayUtc(todayIso)
  // Mon=1 … Fri=5
  return weekday === 2 || weekday === 3 || weekday === 4
}

export function startFof99MidweekAdvancedlistEtlJob(options?: {
  force?: boolean
}): {
  ok: true
} | {
  ok: false
  reason: "already_running" | "recently_ran" | "disabled" | "holiday" | "local_tunnel" | "wrong_weekday"
} {
  if (process.env.FOF99_MIDWEEK_ETL_DISABLED === "1" && !options?.force) {
    return { ok: false, reason: "disabled" }
  }
  if (process.platform === "win32" && (process.env.DATABASE_URL || "").includes(":5433/") && !options?.force) {
    console.log("[fof99-midweek-etl] skipped: Windows next against tunneled production DB")
    return { ok: false, reason: "local_tunnel" }
  }
  if (!options?.force && !isShanghaiTueToThu()) {
    console.log("[fof99-midweek-etl] skipped: not Tue–Thu in Asia/Shanghai")
    return { ok: false, reason: "wrong_weekday" }
  }
  const prevFriday = previousWeekFridayIso()
  if (!options?.force && prevFriday && !weekOfFridayHasOpenDay(prevFriday)) {
    console.log("[fof99-midweek-etl] skipped: previous week has no trading day", prevFriday)
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

  const job: Fof99MidweekAdvancedlistEtlJobStatus = {
    status: "queued",
    message: "准备抓取跟踪池 fof99 本周提示净值（advancedlist）",
    startedAt: Date.now(),
  }
  jobs.set(JOB_KEY, job)

  void (async () => {
    job.status = "running"
    job.message = "正在运行 Tue–Thu 火富牛 advancedlist ETL（无 FundMultiPrice）"
    try {
      const { executable, prefixArgs } = await findPython()
      const scriptPath = path.join(process.cwd(), "scripts", "ma", "fof99_midweek_advancedlist_etl.py")
      const args = [...prefixArgs, scriptPath, "--scheduled"]
      console.log("[fof99-midweek-etl] starting:", executable, args.join(" "))
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
      if (stdout.trim()) console.log("[fof99-midweek-etl]", stdout.trim().slice(-4000))
      if (stderr.trim()) console.warn("[fof99-midweek-etl stderr]", stderr.trim().slice(-4000))
      job.status = "done"
      job.message = "跟踪池 fof99 midweek advancedlist 已更新"
      job.finishedAt = Date.now()
      job.exitCode = 0
      setLastSuccessAt(job.finishedAt)
      console.log(
        "[fof99-midweek-etl] finished OK in",
        ((job.finishedAt - job.startedAt) / 1000).toFixed(1),
        "s",
      )
    } catch (error) {
      const err = error as { message?: string; code?: number | string; stdout?: string; stderr?: string }
      job.status = "error"
      job.message = err.message || "midweek advancedlist 火富牛 ETL failed"
      job.finishedAt = Date.now()
      job.exitCode = typeof err.code === "number" ? err.code : 1
      if (err.stdout?.trim()) console.error("[fof99-midweek-etl stdout]", err.stdout.trim().slice(-4000))
      if (err.stderr?.trim()) console.error("[fof99-midweek-etl stderr]", err.stderr.trim().slice(-4000))
      console.error("[fof99-midweek-etl] failed:", job.message)
    }
  })()

  return { ok: true }
}

