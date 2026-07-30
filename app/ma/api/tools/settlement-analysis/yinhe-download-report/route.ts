import path from "path"
import { existsSync } from "fs"
import { mkdtemp, readFile, rm } from "fs/promises"
import { execFile } from "child_process"
import { tmpdir } from "os"
import { promisify } from "util"
import { createConnection } from "net"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const execFileAsync = promisify(execFile)

const REQUIRED_IMPORTS = "import matplotlib, pandas, numpy, docx, psycopg2"
const PYTHON_DEPS_PROBE_TIMEOUT_MS = 60_000
const REPORT_FILE_NAME = "银河期货交易策略分析报告.docx"

type PythonInvocation = {
  executable: string
  prefixArgs: string[]
}

let cachedPython: PythonInvocation | null = null

function pushPythonCandidate(
  out: PythonInvocation[],
  executable: string,
  prefixArgs: string[] = [],
) {
  if (!executable) return
  if (executable.includes("/") || executable.includes("\\") || executable.endsWith(".exe")) {
    if (!existsSync(executable)) return
  }
  if (
    out.some(
      (item) =>
        item.executable === executable && item.prefixArgs.join(" ") === prefixArgs.join(" "),
    )
  ) {
    return
  }
  out.push({ executable, prefixArgs })
}

/**
 * Same candidate order as Guosen / FOF reports:
 *   1. PYTHON_EXE / PYTHON_EXECUTABLE (ecosystem.config.js)
 *   2. Project root .venv (where matplotlib is actually installed)
 *   3. Script-local yinhe_strategy/.venv or guoxin_strategy/.venv
 * Never prefer an incomplete script-local venv over the configured interpreter.
 */
function listPythonCandidates(scriptDir: string): PythonInvocation[] {
  const cwd = process.cwd()
  const out: PythonInvocation[] = []

  for (const key of ["PYTHON_EXE", "PYTHON_EXECUTABLE"] as const) {
    pushPythonCandidate(out, process.env[key] ?? "")
  }

  if (process.platform === "win32") {
    pushPythonCandidate(out, path.join(cwd, ".venv", "Scripts", "python.exe"))
    pushPythonCandidate(out, path.join(scriptDir, ".venv", "Scripts", "python.exe"))
    pushPythonCandidate(
      out,
      path.join(cwd, "guoxin_strategy", ".venv", "Scripts", "python.exe"),
    )
    const localAppData = process.env.LOCALAPPDATA ?? ""
    pushPythonCandidate(out, path.join(localAppData, "Programs", "Python", "Launcher", "py.exe"), [
      "-3",
    ])
    pushPythonCandidate(out, path.join(process.env.SystemRoot ?? "C:\\Windows", "py.exe"), ["-3"])
  } else {
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python"))
    pushPythonCandidate(out, path.join(scriptDir, ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(scriptDir, ".venv", "bin", "python"))
    pushPythonCandidate(out, path.join(cwd, "guoxin_strategy", ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(cwd, "guoxin_strategy", ".venv", "bin", "python"))
  }

  return out
}

async function pythonHasDeps(invocation: PythonInvocation): Promise<boolean> {
  try {
    await execFileAsync(
      invocation.executable,
      [...invocation.prefixArgs, "-c", REQUIRED_IMPORTS],
      { timeout: PYTHON_DEPS_PROBE_TIMEOUT_MS },
    )
    return true
  } catch (err) {
    const stderr =
      typeof (err as { stderr?: string }).stderr === "string"
        ? (err as { stderr: string }).stderr
        : err instanceof Error
          ? err.message
          : String(err)
    console.warn(
      "[yinhe-download-report] Python deps probe failed:",
      invocation.executable,
      stderr.slice(0, 400),
    )
    return false
  }
}

function pythonDepsInstallHint(): string {
  if (process.platform === "win32") {
    return "py -3 -m pip install -r yinhe_strategy/requirements.txt"
  }
  return ".venv/bin/python3 -m pip install -r yinhe_strategy/requirements.txt"
}

async function findPython(scriptDir: string): Promise<PythonInvocation> {
  if (cachedPython) return cachedPython

  const candidates = listPythonCandidates(scriptDir)
  const tried: string[] = []

  for (const candidate of candidates) {
    tried.push(
      candidate.prefixArgs.length
        ? `${candidate.executable} ${candidate.prefixArgs.join(" ")}`
        : candidate.executable,
    )
    if (await pythonHasDeps(candidate)) {
      cachedPython = candidate
      return candidate
    }
  }

  const pathFallback: PythonInvocation =
    process.platform === "win32"
      ? { executable: "py", prefixArgs: ["-3"] }
      : { executable: "python3", prefixArgs: [] }
  tried.push(
    pathFallback.prefixArgs.length
      ? `${pathFallback.executable} ${pathFallback.prefixArgs.join(" ")}`
      : pathFallback.executable,
  )
  if (await pythonHasDeps(pathFallback)) {
    cachedPython = pathFallback
    return pathFallback
  }

  cachedPython = null
  throw new Error(
    `Python 报告依赖未安装，请执行: ${pythonDepsInstallHint()}` +
      (tried.length ? `（已尝试: ${[...new Set(tried)].join(", ")}）` : ""),
  )
}

export async function GET() {
  const scriptDir = path.join(process.cwd(), "yinhe_strategy")
  const scriptPath = path.join(scriptDir, "generate_yinhe_word_report_db.py")
  const fallbackOutputPath = path.join(scriptDir, "report_output", REPORT_FILE_NAME)

  if (!existsSync(scriptPath)) {
    return NextResponse.json({ error: "Python 报告脚本不存在" }, { status: 500 })
  }

  let dbHost = "127.0.0.1"
  let dbPort = 5433
  const dbUrl = process.env.DATABASE_URL ?? ""
  if (dbUrl) {
    try {
      const u = new URL(dbUrl)
      if (u.hostname) dbHost = u.hostname
      if (u.port) dbPort = parseInt(u.port, 10)
    } catch {
      /* ignore */
    }
  }
  const tunnelUp = await new Promise<boolean>((resolve) => {
    const sock = createConnection({ host: dbHost, port: dbPort })
    sock.setTimeout(2000)
    sock.on("connect", () => {
      sock.destroy()
      resolve(true)
    })
    sock.on("error", () => resolve(false))
    sock.on("timeout", () => {
      sock.destroy()
      resolve(false)
    })
  })
  if (!tunnelUp) {
    return NextResponse.json(
      { error: `数据库端口 ${dbHost}:${dbPort} 不可达，请确认数据库或 SSH 隧道已启动` },
      { status: 503 },
    )
  }

  let python: PythonInvocation
  try {
    python = await findPython(scriptDir)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[yinhe-download-report] No usable Python:", msg)
    cachedPython = null
    return NextResponse.json({ error: "报告生成失败", detail: msg }, { status: 500 })
  }

  console.log(
    "[yinhe-download-report] Using Python:",
    python.executable,
    python.prefixArgs.join(" "),
  )

  const workDir = await mkdtemp(path.join(tmpdir(), "yinhe-word-report-"))
  const mplConfigDir = path.join(workDir, "mplconfig")
  const workOutputPath = path.join(workDir, REPORT_FILE_NAME)

  try {
    const { stdout, stderr } = await execFileAsync(
      python.executable,
      [...python.prefixArgs, "-u", scriptPath],
      {
        cwd: scriptDir,
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
          YINHE_REPORT_OUTPUT_DIR: workDir,
          MPLCONFIGDIR: mplConfigDir,
        },
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: 180_000,
      },
    )
    if (stdout) console.log("[yinhe-download-report] stdout:", stdout.slice(0, 1000))
    if (stderr) console.warn("[yinhe-download-report] stderr:", stderr.slice(0, 1000))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const errStderr = (err as { stderr?: string }).stderr ?? ""
    const errStdout = (err as { stdout?: string }).stdout ?? ""
    const detail = [errStderr, errStdout].filter(Boolean).join("\n---stdout---\n") || msg
    console.error("[yinhe-download-report] Python script failed:", detail.slice(0, 2000))

    if (/ModuleNotFoundError|No module named/.test(detail)) {
      cachedPython = null
    }

    const missingHint = /ModuleNotFoundError: No module named ['"]?(\w+)/.exec(detail)
    const error = missingHint
      ? `报告生成失败：Python 缺少依赖 ${missingHint[1]}。请执行: ${pythonDepsInstallHint()}`
      : "报告生成失败"
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
    return NextResponse.json({ error, detail }, { status: 500 })
  }

  const resolvedOutput = existsSync(workOutputPath)
    ? workOutputPath
    : existsSync(fallbackOutputPath)
      ? fallbackOutputPath
      : null
  if (!resolvedOutput) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
    return NextResponse.json({ error: "脚本执行完毕但未找到输出文件" }, { status: 500 })
  }

  try {
    const fileBuffer = await readFile(resolvedOutput)
    return new Response(fileBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition":
          "attachment; filename*=UTF-8''%E9%93%B6%E6%B2%B3%E6%9C%9F%E8%B4%A7%E4%BA%A4%E6%98%93%E7%AD%96%E7%95%A5%E5%88%86%E6%9E%90%E6%8A%A5%E5%91%8A.docx",
      },
    })
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
