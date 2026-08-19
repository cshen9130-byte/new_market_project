import path from "path"
import { existsSync } from "fs"
import { mkdtemp, readFile, rm } from "fs/promises"
import { execFile } from "child_process"
import { tmpdir } from "os"
import { promisify } from "util"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const execFileAsync = promisify(execFile)
const REQUIRED_IMPORTS = "import matplotlib, pandas, numpy, docx, psycopg2"
const PYTHON_DEPS_PROBE_TIMEOUT_MS = 30_000
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
  if (process.platform === "win32") {
    pushPythonCandidate(out, path.join(cwd, ".venv", "Scripts", "python.exe"))
    const localAppData = process.env.LOCALAPPDATA ?? ""
    pushPythonCandidate(out, path.join(localAppData, "Programs", "Python", "Launcher", "py.exe"), ["-3"])
    pushPythonCandidate(out, path.join(process.env.SystemRoot ?? "C:\\Windows", "py.exe"), ["-3"])
  } else {
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python"))
  }
  return out
}

async function pythonHasDeps(invocation: PythonInvocation): Promise<boolean> {
  try {
    await execFileAsync(invocation.executable, [...invocation.prefixArgs, "-c", REQUIRED_IMPORTS], {
      timeout: PYTHON_DEPS_PROBE_TIMEOUT_MS,
    })
    return true
  } catch {
    return false
  }
}

async function findPython(): Promise<PythonInvocation> {
  if (cachedPython) return cachedPython
  const tried: string[] = []
  for (const candidate of listPythonCandidates()) {
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
  const fallback: PythonInvocation =
    process.platform === "win32" ? { executable: "py", prefixArgs: ["-3"] } : { executable: "python3", prefixArgs: [] }
  if (await pythonHasDeps(fallback)) {
    cachedPython = fallback
    return fallback
  }
  throw new Error(`Python 报告依赖未安装（matplotlib / pandas / python-docx / psycopg2）。已尝试: ${tried.join(", ")}`)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const account = (searchParams.get("account") || "").trim().toLowerCase()
  const from = (searchParams.get("from") || "").trim()
  const to = (searchParams.get("to") || "").trim()

  if (!ACCOUNT_RE.test(account) || account === "全部") {
    return NextResponse.json({ error: "请先选择一个账户" }, { status: 400 })
  }
  if (from && !DATE_RE.test(from)) {
    return NextResponse.json({ error: "起始日期格式无效" }, { status: 400 })
  }
  if (to && !DATE_RE.test(to)) {
    return NextResponse.json({ error: "截止日期格式无效" }, { status: 400 })
  }

  const scriptPath = path.join(process.cwd(), "scripts", "ma", "_generate_rx319_profile_word_report.py")
  if (!existsSync(scriptPath)) {
    return NextResponse.json({ error: "侧写脚本不存在" }, { status: 500 })
  }

  let python: PythonInvocation
  try {
    python = await findPython()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    cachedPython = null
    return NextResponse.json({ error: "报告生成失败", detail: msg }, { status: 500 })
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "trader-profile-"))
  const mplConfigDir = path.join(workDir, "mplconfig")
  const outputPath = path.join(workDir, `${account.toUpperCase()}_trader_profile.docx`)

  try {
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
    if (from) args.push("--from-date", from)
    if (to) args.push("--to-date", to)

    const { stdout, stderr } = await execFileAsync(python.executable, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        MPLCONFIGDIR: mplConfigDir,
        PROFILE_ACCOUNT: account,
        PROFILE_FROM: from,
        PROFILE_TO: to,
        PROFILE_OUTPUT: outputPath,
        PROFILE_WORK_DIR: workDir,
      },
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 240_000,
    })
    if (stdout) console.log("[trader-profile] stdout:", stdout.slice(0, 1200))
    if (stderr) console.warn("[trader-profile] stderr:", stderr.slice(0, 1200))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const errStderr = (err as { stderr?: string }).stderr ?? ""
    const errStdout = (err as { stdout?: string }).stdout ?? ""
    const detail = [errStderr, errStdout].filter(Boolean).join("\n---stdout---\n") || msg
    console.error("[trader-profile] failed:", detail.slice(0, 2500))
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
    if (/NO_DATA/.test(detail)) {
      return NextResponse.json({ error: `账户 ${account.toUpperCase()} 在所选区间没有日报数据` }, { status: 404 })
    }
    if (/ModuleNotFoundError|No module named/.test(detail)) {
      cachedPython = null
    }
    return NextResponse.json({ error: "侧写报告生成失败", detail: detail.slice(0, 1500) }, { status: 500 })
  }

  if (!existsSync(outputPath)) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
    return NextResponse.json({ error: "脚本执行完毕但未找到输出文件" }, { status: 500 })
  }

  try {
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
