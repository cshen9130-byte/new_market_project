import path from "path"
import { existsSync } from "fs"
import { mkdtemp, mkdir, readFile, rm } from "fs/promises"
import { execFile } from "child_process"
import { tmpdir } from "os"
import { promisify } from "util"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const execFileAsync = promisify(execFile)
const REQUIRED_IMPORTS = "import matplotlib, pandas, numpy, docx, psycopg2"
const PYTHON_DEPS_PROBE_TIMEOUT_MS = 60_000
const ACCOUNT_RE = /^[a-zA-Z0-9_-]{2,40}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type PythonInvocation = {
  executable: string
  prefixArgs: string[]
}

let cachedPython: PythonInvocation | null = null

function pushPythonCandidate(out: PythonInvocation[], executable: string, prefixArgs: string[] = []) {
  if (!executable) return
  if (executable.includes("/") || executable.includes("\\") || executable.endsWith(".exe")) {
    if (!existsSync(executable)) return
  }
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
  const scriptDir = path.join(cwd, "scripts", "ma")
  if (process.platform === "win32") {
    pushPythonCandidate(out, path.join(cwd, ".venv", "Scripts", "python.exe"))
    pushPythonCandidate(out, path.join(scriptDir, ".venv", "Scripts", "python.exe"))
    pushPythonCandidate(out, path.join(cwd, "guoxin_strategy", ".venv", "Scripts", "python.exe"))
    const localAppData = process.env.LOCALAPPDATA ?? ""
    pushPythonCandidate(out, path.join(localAppData, "Programs", "Python", "Launcher", "py.exe"), ["-3"])
    pushPythonCandidate(out, path.join(process.env.SystemRoot ?? "C:\\Windows", "py.exe"), ["-3"])
  } else {
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python"))
    pushPythonCandidate(out, path.join(cwd, "guoxin_strategy", ".venv", "bin", "python3"))
    pushPythonCandidate(out, "/root/new_market_project/.venv/bin/python3")
    pushPythonCandidate(out, "python3")
    pushPythonCandidate(out, "python")
  }
  return out
}

function probeEnv(mplConfigDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    MPLCONFIGDIR: mplConfigDir,
    MPLBACKEND: "Agg",
    XDG_CACHE_HOME: mplConfigDir,
  }
}

async function pythonHasDeps(invocation: PythonInvocation, mplConfigDir: string): Promise<string | null> {
  try {
    await execFileAsync(invocation.executable, [...invocation.prefixArgs, "-c", REQUIRED_IMPORTS], {
      timeout: PYTHON_DEPS_PROBE_TIMEOUT_MS,
      env: probeEnv(mplConfigDir),
    })
    return null
  } catch (err) {
    const stderr =
      typeof (err as { stderr?: string }).stderr === "string"
        ? (err as { stderr: string }).stderr
        : err instanceof Error
          ? err.message
          : String(err)
    return stderr.slice(0, 400)
  }
}

async function findPython(mplConfigDir: string): Promise<PythonInvocation> {
  if (cachedPython) return cachedPython
  const tried: string[] = []
  const failures: string[] = []
  for (const candidate of listPythonCandidates()) {
    const label = candidate.prefixArgs.length
      ? `${candidate.executable} ${candidate.prefixArgs.join(" ")}`
      : candidate.executable
    tried.push(label)
    const fail = await pythonHasDeps(candidate, mplConfigDir)
    if (!fail) {
      cachedPython = candidate
      console.log("[trader-profile] Using Python:", label)
      return candidate
    }
    failures.push(`${label}: ${fail.replace(/\s+/g, " ").slice(0, 180)}`)
    console.warn("[trader-profile] Python deps probe failed:", label, fail.slice(0, 300))
  }
  throw new Error(
    `未找到带 matplotlib/pandas/python-docx/psycopg2 的 Python。已尝试: ${tried.join(", ")}。` +
      (failures[0] ? ` 首个失败: ${failures[0]}` : ""),
  )
}

function jsonError(error: string, status: number, detail?: string) {
  return NextResponse.json(detail ? { error, detail } : { error }, { status })
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const account = (searchParams.get("account") || "").trim().toLowerCase()
  const from = (searchParams.get("from") || "").trim()
  const to = (searchParams.get("to") || "").trim()

  if (!ACCOUNT_RE.test(account) || account === "全部") {
    return jsonError("请先选择一个账户", 400)
  }
  if (from && !DATE_RE.test(from)) {
    return jsonError("起始日期格式无效", 400)
  }
  if (to && !DATE_RE.test(to)) {
    return jsonError("截止日期格式无效", 400)
  }

  const scriptPath = path.join(process.cwd(), "scripts", "ma", "_generate_rx319_profile_word_report.py")
  if (!existsSync(scriptPath)) {
    return jsonError(`侧写脚本不存在: ${scriptPath}`, 500)
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "trader-profile-"))
  const mplConfigDir = path.join(workDir, "mplconfig")
  await mkdir(mplConfigDir, { recursive: true })
  const outputPath = path.join(workDir, `${account.toUpperCase()}_trader_profile.docx`)

  try {
    let python: PythonInvocation
    try {
      python = await findPython(mplConfigDir)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      cachedPython = null
      return jsonError(msg, 500)
    }

    const args = [
      ...python.prefixArgs,
      "-u",
      scriptPath,
      "--account",
      account,
      "--work-dir",
      workDir,
      "--output",
      outputPath,
    ]
    if (from && from !== "2020-01-01") args.push("--from-date", from)
    if (to) args.push("--to-date", to)

    try {
      const { stdout, stderr } = await execFileAsync(python.executable, args, {
        cwd: process.cwd(),
        env: {
          ...probeEnv(mplConfigDir),
          PROFILE_ACCOUNT: account,
          PROFILE_FROM: from && from !== "2020-01-01" ? from : "",
          PROFILE_TO: to,
          PROFILE_OUTPUT: outputPath,
          PROFILE_WORK_DIR: workDir,
        },
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 240_000,
      })
      if (stdout) console.log("[trader-profile] stdout:", stdout.slice(0, 1500))
      if (stderr) console.warn("[trader-profile] stderr:", stderr.slice(0, 1500))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const errStderr = (err as { stderr?: string }).stderr ?? ""
      const errStdout = (err as { stdout?: string }).stdout ?? ""
      const detail = [errStderr, errStdout].filter(Boolean).join("\n---stdout---\n") || msg
      console.error("[trader-profile] failed:", detail.slice(0, 2500))
      if (/NO_DATA/.test(detail)) {
        return jsonError(`账户 ${account.toUpperCase()} 在所选区间没有日报数据`, 404, detail.slice(0, 800))
      }
      if (/ModuleNotFoundError|No module named/.test(detail)) {
        cachedPython = null
      }
      const missingHint = /ModuleNotFoundError: No module named ['"]?(\w+)/.exec(detail)
      const firstLine = detail.split("\n").map((s) => s.trim()).filter(Boolean).at(-1) || msg
      const error = missingHint
        ? `侧写报告生成失败：Python 缺少依赖 ${missingHint[1]}`
        : `侧写报告生成失败：${firstLine.slice(0, 240)}`
      return jsonError(error, 500, detail.slice(0, 1500))
    }

    if (!existsSync(outputPath)) {
      return jsonError("脚本执行完毕但未找到输出文件", 500)
    }

    const fileBuffer = await readFile(outputPath)
    const downloadName = `${account.toUpperCase()}_盘手侧写.docx`
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${account.toUpperCase()}_profile.docx"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      },
    })
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
