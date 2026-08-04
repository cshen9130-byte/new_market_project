import path from "path"
import { existsSync } from "fs"
import { mkdtemp, readFile, rm, writeFile } from "fs/promises"
import { execFile } from "child_process"
import { tmpdir } from "os"
import { promisify } from "util"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const execFileAsync = promisify(execFile)

const REQUIRED_IMPORTS = "import matplotlib, pandas, numpy, docx, xlrd, reportlab"
const PYTHON_DEPS_PROBE_TIMEOUT_MS = 60_000

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

function listPythonCandidates(scriptDir: string): PythonInvocation[] {
  const cwd = process.cwd()
  const out: PythonInvocation[] = []

  for (const key of ["PYTHON_EXE", "PYTHON_EXECUTABLE"] as const) {
    pushPythonCandidate(out, process.env[key] ?? "")
  }

  if (process.platform === "win32") {
    pushPythonCandidate(out, path.join(cwd, ".venv", "Scripts", "python.exe"))
    pushPythonCandidate(out, path.join(scriptDir, ".venv", "Scripts", "python.exe"))
    pushPythonCandidate(out, path.join(cwd, "yinhe_strategy", ".venv", "Scripts", "python.exe"))
    pushPythonCandidate(out, path.join(cwd, "guoxin_strategy", ".venv", "Scripts", "python.exe"))
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
      "[ronghang-download-report] Python deps probe failed:",
      invocation.executable,
      stderr.slice(0, 400),
    )
    return false
  }
}

function pythonDepsInstallHint(): string {
  if (process.platform === "win32") {
    return "py -3 -m pip install -r ronghang_strategy/requirements.txt"
  }
  return ".venv/bin/python3 -m pip install -r ronghang_strategy/requirements.txt"
}

async function findPython(scriptDir: string): Promise<PythonInvocation> {
  if (cachedPython) return cachedPython

  const candidates = listPythonCandidates(scriptDir)
  const tried: string[] = []
  for (const candidate of candidates) {
    tried.push([candidate.executable, ...candidate.prefixArgs].join(" "))
    if (await pythonHasDeps(candidate)) {
      cachedPython = candidate
      return candidate
    }
  }

  throw new Error(
    `Python 报告依赖未安装，请执行: ${pythonDepsInstallHint()}` +
      (tried.length ? `（已尝试: ${[...new Set(tried)].join(", ")}）` : ""),
  )
}

function parseFormat(raw: string | null): "docx" | "pdf" {
  return raw?.toLowerCase() === "pdf" ? "pdf" : "docx"
}

export async function POST(request: Request) {
  const scriptDir = path.join(process.cwd(), "ronghang_strategy")
  const scriptPath = path.join(scriptDir, "generate_ronghang_report.py")

  if (!existsSync(scriptPath)) {
    return NextResponse.json({ error: "Python 报告脚本不存在" }, { status: 500 })
  }

  const url = new URL(request.url)
  const format = parseFormat(url.searchParams.get("format"))

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: "请以 multipart 上传 ZIP 文件。" }, { status: 400 })
  }

  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请先上传融航结算单 ZIP（如 data.zip）。" }, { status: 400 })
  }
  if (!/\.zip$/i.test(file.name)) {
    return NextResponse.json({ error: "仅支持 .zip 文件。" }, { status: 400 })
  }
  if (file.size > 80 * 1024 * 1024) {
    return NextResponse.json({ error: "ZIP 文件过大，请控制在 80MB 以内。" }, { status: 400 })
  }

  const advisorRaw = formData.get("advisor")
  const advisorName =
    typeof advisorRaw === "string" ? advisorRaw.trim() : advisorRaw instanceof File ? "" : ""

  let python: PythonInvocation
  try {
    python = await findPython(scriptDir)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[ronghang-download-report] No usable Python:", msg)
    cachedPython = null
    return NextResponse.json({ error: "报告生成失败", detail: msg }, { status: 500 })
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "ronghang-report-"))
  const mplConfigDir = path.join(workDir, "mplconfig")
  const zipPath = path.join(workDir, "data.zip")
  const outDir = path.join(workDir, "out")
  const reportName = format === "pdf" ? "投资报告分析.pdf" : "投资报告分析.docx"
  const reportPath = path.join(outDir, reportName)

  try {
    await writeFile(zipPath, Buffer.from(await file.arrayBuffer()))

    const scriptArgs = [
      ...python.prefixArgs,
      "-u",
      scriptPath,
      "--zip",
      zipPath,
      "--outdir",
      outDir,
      "--format",
      format,
    ]
    if (advisorName) {
      scriptArgs.push("--advisor", advisorName)
    }

    const { stdout, stderr } = await execFileAsync(
      python.executable,
      scriptArgs,
      {
        cwd: scriptDir,
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
          RONGHANG_REPORT_OUTPUT_DIR: outDir,
          MPLCONFIGDIR: mplConfigDir,
        },
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 240_000,
      },
    )
    if (stdout) console.log("[ronghang-download-report] stdout:", stdout.slice(0, 1200))
    if (stderr) console.warn("[ronghang-download-report] stderr:", stderr.slice(0, 1200))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const errStderr = (err as { stderr?: string }).stderr ?? ""
    const errStdout = (err as { stdout?: string }).stdout ?? ""
    const detail = [errStderr, errStdout].filter(Boolean).join("\n---stdout---\n") || msg
    console.error("[ronghang-download-report] Python script failed:", detail.slice(0, 2000))

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

  if (!existsSync(reportPath)) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
    return NextResponse.json({ error: "脚本执行完毕但未找到输出文件" }, { status: 500 })
  }

  try {
    const fileBuffer = await readFile(reportPath)
    const contentType =
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    const encodedName =
      format === "pdf"
        ? "%E6%8A%95%E8%B5%84%E6%8A%A5%E5%91%8A%E5%88%86%E6%9E%90.pdf"
        : "%E6%8A%95%E8%B5%84%E6%8A%A5%E5%91%8A%E5%88%86%E6%9E%90.docx"

    return new Response(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
      },
    })
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
