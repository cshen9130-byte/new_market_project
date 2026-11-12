import { execFile } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { promisify } from "util"
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
import { isChinaTradingDay, shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
import {
  readRebuildIndexLevelsCsv,
  readRebuildModelName,
  refreshHs300RebuildCache,
  resolveAllWeatherDir,
  resolveRebuildCsvPath,
  upsertCi011001RebuildPoints,
} from "@/lib/server/ci011001-rebuild"

const execFileAsync = promisify(execFile)

const JOB_KEY = "__ci011001RebuildEtl"
const JOB_TIMEOUT_MS = 45 * 60 * 1000
const MIN_RERUN_MS = 4 * 60 * 60 * 1000

export type Ci011001RebuildEtlJobStatus = {
  status: "queued" | "running" | "done" | "error" | "skipped"
  message: string
  startedAt: number
  finishedAt?: number
  exitCode?: number
  upserted?: number
  startDate?: string
  endDate?: string
  hs300Latest?: string | null
}

type PythonInvocation = {
  executable: string
  prefixArgs: string[]
}

function getJobMap(): Map<string, Ci011001RebuildEtlJobStatus> {
  const g = globalThis as typeof globalThis & {
    __ci011001RebuildEtlJobs?: Map<string, Ci011001RebuildEtlJobStatus>
  }
  if (!g.__ci011001RebuildEtlJobs) g.__ci011001RebuildEtlJobs = new Map()
  return g.__ci011001RebuildEtlJobs
}

function getLastSuccessAt(): number | undefined {
  return (globalThis as typeof globalThis & { __ci011001RebuildEtlLastSuccessAt?: number })
    .__ci011001RebuildEtlLastSuccessAt
}

function setLastSuccessAt(ts: number): void {
  ;(globalThis as typeof globalThis & { __ci011001RebuildEtlLastSuccessAt?: number })
    .__ci011001RebuildEtlLastSuccessAt = ts
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
    pushPythonCandidate(
      out,
      "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe",
    )
    pushPythonCandidate(out, "py", ["-3"])
  } else {
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python"))
    pushPythonCandidate(out, "python3")
  }
  return out
}

function pythonExecEnv(): NodeJS.ProcessEnv {
  loadProjectEnvFiles()
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

export function getCi011001RebuildEtlJobStatus(): Ci011001RebuildEtlJobStatus | null {
  return getJobMap().get(JOB_KEY) ?? null
}

export async function runCi011001RebuildEtl(options?: {
  force?: boolean
  skipRebuild?: boolean
}): Promise<Ci011001RebuildEtlJobStatus> {
  const jobs = getJobMap()
  const existing = jobs.get(JOB_KEY)
  if (existing?.status === "running" || existing?.status === "queued") {
    return existing
  }

  const today = shanghaiTodayIsoDate()
  if (!options?.force && !isChinaTradingDay(today)) {
    const skipped: Ci011001RebuildEtlJobStatus = {
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
    const skipped: Ci011001RebuildEtlJobStatus = {
      status: "skipped",
      message: "skip: rebuilt recently",
      startedAt: Date.now(),
      finishedAt: Date.now(),
    }
    jobs.set(JOB_KEY, skipped)
    return skipped
  }

  if (process.env.CI011001_REBUILD_ETL_DISABLED === "1" && !options?.force) {
    const skipped: Ci011001RebuildEtlJobStatus = {
      status: "skipped",
      message: "skip: CI011001_REBUILD_ETL_DISABLED=1",
      startedAt: Date.now(),
      finishedAt: Date.now(),
    }
    jobs.set(JOB_KEY, skipped)
    return skipped
  }

  const startedAt = Date.now()
  const running: Ci011001RebuildEtlJobStatus = {
    status: "running",
    message: "starting CI011001 rebuild ETL",
    startedAt,
  }
  jobs.set(JOB_KEY, running)

  try {
    loadProjectEnvFiles()
    const allWeatherDir = resolveAllWeatherDir()
    if (!allWeatherDir) {
      throw new Error("ALL_WEATHER_DIR not found (expected run_ci011001.py)")
    }

    let hs300Latest: string | null = null
    try {
      const hs300 = await refreshHs300RebuildCache(allWeatherDir)
      hs300Latest = hs300.latest
      console.log(`[ci011001-rebuild-etl] refreshed 000300.SH cache rows=${hs300.rows} latest=${hs300.latest}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[ci011001-rebuild-etl] 000300.SH cache refresh failed: ${message}`)
    }

    if (!options?.skipRebuild) {
      const candidates = listPythonCandidates()
      if (!candidates.length) throw new Error("No Python executable found for CI011001 rebuild")
      const python = candidates[0]!
      const script = path.join(allWeatherDir, "run_ci011001.py")
      const { stdout, stderr } = await execFileAsync(
        python.executable,
        [...python.prefixArgs, script],
        {
          cwd: allWeatherDir,
          env: pythonExecEnv(),
          timeout: JOB_TIMEOUT_MS,
          maxBuffer: 20 * 1024 * 1024,
        },
      )
      if (stdout?.trim()) console.log(stdout.trim())
      if (stderr?.trim()) console.warn(stderr.trim())
    }

    const csvPath = resolveRebuildCsvPath()
    const points = readRebuildIndexLevelsCsv(csvPath)
    if (!points.length) {
      throw new Error(`rebuild CSV is empty or missing: ${csvPath ?? "(none)"}`)
    }
    const model = readRebuildModelName(allWeatherDir)
    const upserted = await upsertCi011001RebuildPoints(points, model)
    const startDate = points[0]?.date
    const endDate = points[points.length - 1]?.date
    const done: Ci011001RebuildEtlJobStatus = {
      status: "done",
      message: `upserted ${upserted} daily levels through ${endDate}`,
      startedAt,
      finishedAt: Date.now(),
      exitCode: 0,
      upserted,
      startDate,
      endDate,
      hs300Latest,
    }
    setLastSuccessAt(done.finishedAt!)
    jobs.set(JOB_KEY, done)
    console.log(`[ci011001-rebuild-etl] ${done.message}`)
    return done
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const failed: Ci011001RebuildEtlJobStatus = {
      status: "error",
      message,
      startedAt,
      finishedAt: Date.now(),
      exitCode: 1,
    }
    jobs.set(JOB_KEY, failed)
    console.error(`[ci011001-rebuild-etl] ${message}`)
    return failed
  }
}

export function runScheduledCi011001RebuildEtl(): void {
  void runCi011001RebuildEtl().catch((error) => {
    console.error("[ci011001-rebuild-etl] scheduled run failed:", error)
  })
}
