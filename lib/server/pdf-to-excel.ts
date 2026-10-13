import { execFile, spawn } from "child_process"
import { randomUUID } from "crypto"
import { existsSync } from "fs"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "ma", "pdf_to_excel.py")
const STORE_DIR = path.join(os.tmpdir(), "ma-pdf-to-excel")
const STORE_TTL_MS = 60 * 60 * 1000
const PYTHON_TIMEOUT_MS = 10 * 60 * 1000
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PdfExcelMode = "auto" | "valuation" | "performance"
export type PdfExcelDetectedMode = "valuation" | "performance" | "tables"
export type PdfExcelMethod = "text" | "ocr"

export type PdfExcelSheet = {
  name: string
  columns: string[]
  rowCount: number
  preview: string[][]
}

export type PdfExcelSummary = {
  sourceFileName: string
  downloadId: string
  detectedMode: PdfExcelDetectedMode
  method: PdfExcelMethod
  pageCount: number
  meta: { field: string; value: string }[]
  sheets: PdfExcelSheet[]
  warnings: string[]
}

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
    pushPythonCandidate(out, path.join(cwd, "scripts", "ma", ".venv", "Scripts", "python.exe"))
    const localAppData = process.env.LOCALAPPDATA ?? ""
    pushPythonCandidate(out, path.join(localAppData, "Programs", "Python", "Python312", "python.exe"))
    pushPythonCandidate(out, path.join(localAppData, "Programs", "Python", "Launcher", "py.exe"), ["-3"])
    pushPythonCandidate(out, "py", ["-3"])
  } else {
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python"))
    pushPythonCandidate(out, "python3")
  }
  pushPythonCandidate(out, "python")
  return out
}

async function findPython(): Promise<PythonInvocation> {
  if (cachedPython) return cachedPython
  const tried: string[] = []
  for (const candidate of listPythonCandidates()) {
    tried.push(candidate.executable)
    try {
      await execFileAsync(candidate.executable, [...candidate.prefixArgs, "-c", "import fitz, pandas, openpyxl"], {
        timeout: 60_000,
        windowsHide: true,
      })
      cachedPython = candidate
      return candidate
    } catch (error) {
      const stderr = typeof (error as { stderr?: string }).stderr === "string" ? (error as { stderr: string }).stderr : ""
      console.warn("[pdf-to-excel] Python probe failed:", candidate.executable, stderr.slice(0, 300))
    }
  }
  throw new Error(
    `PDF 提取依赖未安装，请执行: py -3 -m pip install pymupdf pandas openpyxl rapidocr pillow numpy（已尝试: ${[...new Set(tried)].join(", ") || "无"}）`,
  )
}

function pythonFailureMessage(error: unknown): string {
  const killed = Boolean((error as { killed?: boolean }).killed)
  if (killed) {
    return "提取超时。业绩截图页数较多时请拆分 PDF 后重试。"
  }
  const stderr = typeof (error as { stderr?: string }).stderr === "string" ? (error as { stderr: string }).stderr : ""
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("PROGRESS\t") && !line.startsWith("Traceback") && !line.startsWith("File ") && !line.startsWith("During handling"))
  const message = lines.at(-1)
  if (message && message.length < 400) return message
  return "PDF 提取失败。"
}

function sanitizeBaseName(fileName: string) {
  const base = fileName.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, "_").trim()
  return (base || "pdf_extract").slice(0, 80)
}

async function sweepStore() {
  const names = await readdir(STORE_DIR).catch(() => [] as string[])
  const now = Date.now()
  await Promise.all(
    names.map(async (name) => {
      const fullPath = path.join(STORE_DIR, name)
      const info = await stat(fullPath).catch(() => null)
      if (info && now - info.mtimeMs > STORE_TTL_MS) {
        await rm(fullPath, { force: true }).catch(() => undefined)
      }
    }),
  )
}

function isSummary(value: unknown): value is Omit<PdfExcelSummary, "sourceFileName" | "downloadId"> {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    (record.detectedMode === "valuation" || record.detectedMode === "performance" || record.detectedMode === "tables") &&
    (record.method === "text" || record.method === "ocr") &&
    Array.isArray(record.sheets) &&
    Array.isArray(record.meta) &&
    Array.isArray(record.warnings)
  )
}

export function parsePdfExcelMode(value: unknown): PdfExcelMode {
  if (value === "valuation" || value === "performance" || value === "auto") return value
  return "auto"
}

export type PdfExcelProgress = {
  percent: number
  message: string
}

function runPdfScript(
  python: PythonInvocation,
  args: string[],
  onProgress?: (update: PdfExcelProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(python.executable, [...python.prefixArgs, "-u", ...args], {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    })
    const decoder = new TextDecoder("utf-8")
    let pending = ""
    let errorLog = ""
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error("提取超时。业绩截图页数较多时请拆分 PDF 后重试。"))
    }, PYTHON_TIMEOUT_MS)

    const takeLine = (line: string) => {
      if (line.startsWith("PROGRESS\t")) {
        const parts = line.split("\t")
        const percent = Number(parts[1])
        const message = parts.slice(2).join("\t").trim()
        if (Number.isFinite(percent)) onProgress?.({ percent, message })
        return
      }
      if (line.trim()) errorLog += `${line.trim()}\n`
    }

    child.stderr?.on("data", (chunk: Buffer) => {
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ""
      for (const line of lines) takeLine(line)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (pending.trim()) takeLine(pending)
      if (code === 0) {
        resolve()
        return
      }
      const message = errorLog.trim().split(/\n/).filter(Boolean).at(-1) || "PDF 提取失败。"
      reject(Object.assign(new Error(message), { stderr: errorLog }))
    })
  })
}

export async function convertUploadedPdf(
  buffer: Buffer,
  fileName: string,
  mode: PdfExcelMode,
  onProgress?: (update: PdfExcelProgress) => void,
): Promise<PdfExcelSummary> {
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error("PDF 提取脚本不存在。")
  }
  const python = await findPython()
  const workDir = await mkdtemp(path.join(os.tmpdir(), "pdf2excel-"))
  const pdfPath = path.join(workDir, "input.pdf")
  const xlsxPath = path.join(workDir, "output.xlsx")
  const summaryPath = path.join(workDir, "summary.json")
  try {
    await writeFile(pdfPath, buffer)
    onProgress?.({ percent: 6, message: "正在打开 PDF" })
    await runPdfScript(python, [SCRIPT_PATH, pdfPath, xlsxPath, summaryPath, "--mode", mode], onProgress)
    const summaryRaw = JSON.parse(await readFile(summaryPath, "utf8")) as unknown
    if (!isSummary(summaryRaw)) {
      throw new Error("提取结果无法读取。")
    }
    const xlsx = await readFile(xlsxPath)
    await mkdir(STORE_DIR, { recursive: true })
    await sweepStore()
    const downloadId = randomUUID()
    const downloadName = `${sanitizeBaseName(fileName)}.xlsx`
    await writeFile(path.join(STORE_DIR, `${downloadId}.xlsx`), xlsx)
    await writeFile(path.join(STORE_DIR, `${downloadId}.json`), JSON.stringify({ downloadName }), "utf8")
    return {
      ...summaryRaw,
      sourceFileName: fileName,
      downloadId,
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("提取结果")) throw error
    if (error instanceof Error && /PDF|提取|加密|未识别|未从|依赖|超时/.test(error.message) && !("stderr" in (error as object))) {
      throw error
    }
    const message = pythonFailureMessage(error)
    console.error("[pdf-to-excel]", message)
    throw new Error(message)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function readPdfExcelDownload(id: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  if (!ID_RE.test(id)) return null
  const xlsxPath = path.join(STORE_DIR, `${id}.xlsx`)
  if (!existsSync(xlsxPath)) return null
  const buffer = await readFile(xlsxPath)
  let fileName = "pdf_extract.xlsx"
  try {
    const meta = JSON.parse(await readFile(path.join(STORE_DIR, `${id}.json`), "utf8")) as { downloadName?: string }
    if (meta.downloadName) fileName = meta.downloadName
  } catch {
    fileName = "pdf_extract.xlsx"
  }
  return { buffer, fileName }
}
