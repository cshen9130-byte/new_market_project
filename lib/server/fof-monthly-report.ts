import { createHash, randomUUID } from "crypto"
import { execFile } from "child_process"
import { existsSync } from "fs"
import { mkdir, readFile, readdir, writeFile } from "fs/promises"
import path from "path"
import { promisify } from "util"
import { findCustomFundByName, getCustomFundByCode } from "@/lib/server/custom-funds"
import {
  buildFofWeeklyNavCsv,
  resolveFofWeeklyProductNavRange,
  resolveProductBeianHao,
  type FofWeeklyNavFrequency,
} from "@/lib/server/fof-weekly-report"

export { isValidReportId } from "@/lib/server/fof-weekly-report"
import { resolveFofWeeklyBenchmark } from "@/lib/server/fof-weekly-benchmark"
import { resolveFundNames } from "@/lib/server/fund-nav-series"

const execFileAsync = promisify(execFile)
const REPORT_TMP_ROOT = path.join(process.cwd(), ".tmp", "fof-monthly-reports")
const SCRIPT_DIR = path.join(process.cwd(), "haitai_week_report")
const SCRIPT_PATH = path.join(SCRIPT_DIR, "generate_fof_weekly_report.py")

export type FofMonthlyNavFrequency = FofWeeklyNavFrequency

export type FofMonthlyReportLayout = "curve" | "review"

export type FofMonthlyReportRequest = {
  product_name: string
  beian_hao?: string
  month_begin?: string
  month_end: string
  report_title?: string
  product_tagline?: string
  benchmark_key?: string
  nav_frequency?: FofMonthlyNavFrequency
  report_layout?: FofMonthlyReportLayout
}

export type FofMonthlyReportResult = {
  reportId: string
  reportTitle: string
  monthStart: string
  monthEnd: string
  dataEnd: string
  pngFileName: string
  pdfFileName: string
}

function normalizeNavFrequency(value: string | undefined): FofMonthlyNavFrequency {
  const freq = (value ?? "monthly").trim().toLowerCase()
  if (freq === "daily" || freq === "weekly") return freq
  return "monthly"
}

function reportDir(reportId: string): string {
  return path.join(REPORT_TMP_ROOT, reportId)
}

function getMonthStart(dateStr: string): string {
  const [year, month] = dateStr.split("-")
  return `${year}-${month}-01`
}

let cachedPython: { executable: string; prefixArgs: string[] } | null = null

async function findPython(): Promise<{ executable: string; prefixArgs: string[] }> {
  if (cachedPython) return cachedPython

  const candidates: Array<{ executable: string; prefixArgs: string[] }> = []
  const cwd = process.cwd()
  const push = (executable: string, prefixArgs: string[] = []) => {
    if (!executable) return
    if (executable.includes("/") || executable.includes("\\") || executable.endsWith(".exe")) {
      if (!existsSync(executable)) return
    }
    if (candidates.some((c) => c.executable === executable && c.prefixArgs.join(" ") === prefixArgs.join(" "))) {
      return
    }
    candidates.push({ executable, prefixArgs })
  }

  for (const key of ["PYTHON_EXE", "PYTHON_EXECUTABLE"] as const) {
    push(process.env[key] ?? "")
  }
  if (process.platform === "win32") {
    push(path.join(cwd, ".venv", "Scripts", "python.exe"))
    push(path.join(SCRIPT_DIR, ".venv", "Scripts", "python.exe"))
    push("py", ["-3"])
  } else {
    push(path.join(cwd, ".venv", "bin", "python3"))
    push(path.join(cwd, ".venv", "bin", "python"))
    push(path.join(SCRIPT_DIR, ".venv", "bin", "python3"))
    push(path.join(SCRIPT_DIR, ".venv", "bin", "python"))
    push("python3")
  }

  const tried: string[] = []
  for (const candidate of candidates) {
    tried.push(candidate.executable)
    try {
      await execFileAsync(
        candidate.executable,
        [...candidate.prefixArgs, "-c", "import pandas, matplotlib, openpyxl"],
        { timeout: 60_000 },
      )
      cachedPython = candidate
      return candidate
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const stderr = typeof (err as { stderr?: string }).stderr === "string" ? (err as { stderr: string }).stderr : ""
      console.warn(
        "[fof-monthly-report] Python deps probe failed:",
        candidate.executable,
        (stderr || msg).slice(0, 500),
      )
    }
  }

  throw new Error(
    `Python 报告依赖未安装，请在项目目录执行部署脚本安装 haitai_week_report 依赖` +
      (tried.length ? `（已尝试: ${[...new Set(tried)].join(", ")}）` : ""),
  )
}

export async function resolveFofMonthlyProductNavRange(
  product_name: string,
  beian_hao?: string,
) {
  return resolveFofWeeklyProductNavRange(product_name, beian_hao)
}

export async function generateFofMonthlyReport(
  input: FofMonthlyReportRequest,
): Promise<FofMonthlyReportResult> {
  const product_name = input.product_name.trim()
  const month_end = input.month_end.trim()
  const month_begin = input.month_begin?.trim() ?? ""
  if (!product_name) throw new Error("请选择产品")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(month_end)) throw new Error("请选择有效的报告月结束日期")
  if (month_begin && !/^\d{4}-\d{2}-\d{2}$/.test(month_begin)) {
    throw new Error("请选择有效的报告月开始日期")
  }
  if (month_begin && month_begin > month_end) {
    throw new Error("报告月开始日期不能晚于结束日期")
  }

  const benchmark = resolveFofWeeklyBenchmark(input.benchmark_key)
  const navFrequency = normalizeNavFrequency(input.nav_frequency)
  const beian_hao = await resolveProductBeianHao(product_name, input.beian_hao)
  const customFund = getCustomFundByCode(beian_hao) ?? findCustomFundByName(product_name)
  const names = customFund
    ? { product_name: customFund.product_name, short_name: "" }
    : await resolveFundNames(beian_hao, product_name)

  const built = await buildFofWeeklyNavCsv(
    beian_hao,
    names.product_name,
    names.short_name,
    benchmark.key,
    { minNavDate: month_end },
  )
  const navCsv = built.csv
  const benchLabel = built.benchLabel

  const navRows = navCsv.split("\n").slice(1).map((line) => line.split(",")[0]).filter(Boolean)
  const latestNavDate = navRows.at(-1) ?? ""
  const earliestNavDate = navRows[0] ?? ""
  if (!latestNavDate || !earliestNavDate) throw new Error("净值数据为空")

  if (month_end < earliestNavDate || month_end > latestNavDate) {
    throw new Error(`报告月日期需在 ${earliestNavDate} ~ ${latestNavDate} 之间`)
  }
  if (month_begin && month_begin < earliestNavDate) {
    throw new Error(`报告月开始日期不能早于 ${earliestNavDate}`)
  }

  if (!existsSync(SCRIPT_PATH)) {
    throw new Error("月报生成脚本不存在")
  }

  const reportId = randomUUID()
  const outDir = reportDir(reportId)
  await mkdir(outDir, { recursive: true })

  const navFile = path.join(outDir, "nav.csv")
  await writeFile(navFile, `\uFEFF${navCsv}`, "utf8")

  const reportTitle = (input.report_title || names.product_name).trim()
  const productTagline = (input.product_tagline || "低波动 · 稳健运作 · 强势股策略").trim()
  const { executable: pythonExe, prefixArgs } = await findPython()
  const resolvedMonthBegin = month_begin || getMonthStart(month_end)
  const reportLayout = input.report_layout === "curve" ? "curve" : "review"

  const args = [
    ...prefixArgs,
    "-u",
    SCRIPT_PATH,
    navFile,
    "-o",
    outDir,
    "--week-end",
    month_end,
    "--week-begin",
    resolvedMonthBegin,
    "--product-name",
    names.short_name || names.product_name,
    "--report-title",
    reportTitle,
    "--product-tagline",
    productTagline,
    "--benchmark-label",
    benchLabel,
    "--nav-frequency",
    navFrequency,
    "--report-kind",
    "monthly",
    "--report-layout",
    reportLayout,
  ]

  try {
    const { stdout, stderr } = await execFileAsync(pythonExe, args, {
      cwd: SCRIPT_DIR,
      env: {
        ...process.env,
        FOF_REPORT_DISABLE_AKSHARE: process.env.FOF_REPORT_DISABLE_AKSHARE ?? "1",
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 180_000,
    })
    if (stdout) console.log("[fof-monthly-report] stdout:", stdout.slice(0, 1000))
    if (stderr) console.warn("[fof-monthly-report] stderr:", stderr.slice(0, 1000))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const detail = [(err as { stderr?: string }).stderr, (err as { stdout?: string }).stdout]
      .filter(Boolean)
      .join("\n")
      .trim()
    console.error("[fof-monthly-report] Python failed:", detail || msg)
    const userMessage = detail.replace(/^错误:\s*/m, "").trim()
    throw new Error(userMessage || msg || "报告生成失败")
  }

  const files = await readdir(outDir)
  const pngFile = files.find((f) => f.endsWith(".png"))
  const pdfFile = files.find((f) => f.endsWith(".pdf"))
  if (!pngFile || !pdfFile) {
    throw new Error("脚本执行完毕但未找到输出文件")
  }

  const meta = {
    reportTitle,
    monthEnd: month_end,
    dataEnd: month_end,
    generatedAt: new Date().toISOString(),
    pngFileName: pngFile,
    pdfFileName: pdfFile,
  }
  await writeFile(path.join(outDir, "meta.json"), JSON.stringify(meta), "utf8")

  return {
    reportId,
    reportTitle,
    monthStart: resolvedMonthBegin,
    monthEnd: month_end,
    dataEnd: month_end,
    pngFileName: pngFile,
    pdfFileName: pdfFile,
  }
}

export async function readFofMonthlyReportFile(
  reportId: string,
  format: "png" | "pdf",
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  if (!isValidReportId(reportId)) {
    throw new Error("无效的报告 ID")
  }

  const dir = reportDir(reportId)
  const metaPath = path.join(dir, "meta.json")
  if (!existsSync(metaPath)) {
    throw new Error("报告不存在或已过期")
  }

  const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
    pngFileName?: string
    pdfFileName?: string
  }

  const fileName = format === "png" ? meta.pngFileName : meta.pdfFileName
  if (!fileName) throw new Error("报告文件不存在")

  const filePath = path.join(dir, fileName)
  if (!existsSync(filePath)) throw new Error("报告文件不存在")

  const buffer = await readFile(filePath)
  return {
    buffer,
    fileName,
    contentType: format === "png" ? "image/png" : "application/pdf",
  }
}

export async function readFofMonthlyReportPreview(reportId: string): Promise<Buffer> {
  const { buffer } = await readFofMonthlyReportFile(reportId, "png")
  return buffer
}

export function buildMonthlyReportDownloadToken(reportId: string, format: "png" | "pdf"): string {
  const secret = process.env.REPORT_DOWNLOAD_SECRET || process.env.DATABASE_URL || "fof-monthly-local"
  return createHash("sha256").update(`${reportId}:${format}:${secret}`).digest("hex").slice(0, 16)
}

export function verifyMonthlyReportDownloadToken(
  reportId: string,
  format: "png" | "pdf",
  token: string,
): boolean {
  return token === buildMonthlyReportDownloadToken(reportId, format)
}
