import { execFile } from "child_process"
import { createHash, randomUUID } from "crypto"
import { existsSync } from "fs"
import { mkdir, readFile, readdir, writeFile } from "fs/promises"
import path from "path"
import { promisify } from "util"
import { query } from "@/lib/db"
import { VOLATILITY_SECTIONS, type VolatilitySection } from "@/lib/client/product-monthly-report"
import { findCustomFundByName, getCustomFundByCode } from "@/lib/server/custom-funds"
import { listCustomFundNavRows } from "@/lib/server/custom-fund-nav"
import { loadMergedFundNavRows, resolveFundNames } from "@/lib/server/fund-nav-series"
import { resolveProductBeianHao } from "@/lib/server/fof-weekly-report"

const execFileAsync = promisify(execFile)
const REPORT_TMP_ROOT = path.join(process.cwd(), ".tmp", "product-monthly-reports")
const SCRIPT_DIR = path.join(process.cwd(), "product_ppt")
const SCRIPT_PATH = path.join(SCRIPT_DIR, "generate_product_report.py")

export type ProductMonthlyFundInput = {
  product_name: string
  beian_hao?: string
}

export type ProductMonthlyReportRequest = {
  end_date: string
  funds: Partial<Record<VolatilitySection, ProductMonthlyFundInput[]>>
}

export type ProductMonthlyReportResult = {
  reportId: string
  endDate: string
  pptxFileName: string
  pdfFileName: string | null
  productCount: number
}

type PythonInvocation = {
  executable: string
  prefixArgs: string[]
}

type NavRow = {
  date: string
  unit: string
  cum: string
  adj: string
  pct: string | null | undefined
}

type ProductProfile = {
  manager: string
  inception_date: string
  fund_manager: string
  aum: string
}

function pushPythonCandidate(out: PythonInvocation[], executable: string, prefixArgs: string[] = []) {
  if (!executable || !existsSync(executable)) return
  if (out.some((item) => item.executable === executable && item.prefixArgs.join(" ") === prefixArgs.join(" "))) {
    return
  }
  out.push({ executable, prefixArgs })
}

function listPythonCandidates(scriptDir: string): PythonInvocation[] {
  const cwd = process.cwd()
  const out: PythonInvocation[] = []

  pushPythonCandidate(
    out,
    process.platform === "win32"
      ? path.join(scriptDir, ".venv", "Scripts", "python.exe")
      : path.join(scriptDir, ".venv", "bin", "python"),
  )

  for (const key of ["PYTHON_EXE", "PYTHON_EXECUTABLE"] as const) {
    pushPythonCandidate(out, process.env[key] ?? "")
  }

  if (process.platform === "win32") {
    pushPythonCandidate(out, path.join(cwd, ".venv", "Scripts", "python.exe"))
  } else {
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python3"))
    pushPythonCandidate(out, path.join(cwd, ".venv", "bin", "python"))
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? ""
    pushPythonCandidate(out, path.join(localAppData, "Programs", "Python", "Launcher", "py.exe"), ["-3"])
    pushPythonCandidate(out, path.join(process.env.SystemRoot ?? "C:\\Windows", "py.exe"), ["-3"])
  }

  return out
}

async function appendPathPythonCandidates(out: PythonInvocation[]): Promise<void> {
  if (process.platform !== "win32") return
  try {
    const { stdout } = await execFileAsync("where.exe", ["py"], { timeout: 5000 })
    for (const line of stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      pushPythonCandidate(out, line, ["-3"])
    }
  } catch {
    /* ignore */
  }
  try {
    const { stdout } = await execFileAsync("where.exe", ["python"], { timeout: 5000 })
    for (const line of stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      if (line.toLowerCase().includes("windowsapps")) continue
      pushPythonCandidate(out, line)
    }
  } catch {
    /* ignore */
  }
}

async function pythonHasReportDeps(invocation: PythonInvocation): Promise<boolean> {
  try {
    await execFileAsync(
      invocation.executable,
      [...invocation.prefixArgs, "-c", "import pandas, matplotlib, pptx, reportlab, pypdf, openpyxl"],
      { timeout: 15_000 },
    )
    return true
  } catch {
    return false
  }
}

function pythonDepsInstallHint(): string {
  if (process.platform === "win32") {
    return "py -3 -m pip install -r product_ppt/requirements.txt"
  }
  return "python3 -m pip install -r product_ppt/requirements.txt"
}

function pythonExecEnv(): NodeJS.ProcessEnv {
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

async function findPython(scriptDir: string): Promise<PythonInvocation> {
  const candidates = listPythonCandidates(scriptDir)
  await appendPathPythonCandidates(candidates)

  const tried: string[] = []
  for (const candidate of candidates) {
    tried.push(candidate.executable)
    if (await pythonHasReportDeps(candidate)) return candidate
  }

  if (process.platform !== "win32") {
    pushPythonCandidate(candidates, "python3")
  } else {
    pushPythonCandidate(candidates, "py", ["-3"])
  }
  const fallback = candidates.at(-1)
  if (fallback) {
    tried.push(fallback.executable)
    if (await pythonHasReportDeps(fallback)) return fallback
  }

  throw new Error(
    `Python 报告依赖未安装，请在项目目录执行: ${pythonDepsInstallHint()}${tried.length ? `（已尝试: ${[...new Set(tried)].join(", ")}）` : ""}`,
  )
}

function formatPct(value: string | null | undefined): string {
  const raw = (value ?? "").trim()
  if (!raw || raw === "--") return ""
  if (raw.includes("%")) return raw
  const n = parseFloat(raw.replace("+", ""))
  if (!Number.isFinite(n)) return ""
  if (Math.abs(n) <= 100) {
    const sign = n > 0 ? "+" : ""
    return `${sign}${n.toFixed(2)}%`
  }
  return `${(n * 100).toFixed(2)}%`
}

function navRowsToCsv(rows: NavRow[]): string {
  const lines = ["日期,单位净值,累计净值,复权净值,涨跌幅,基准"]
  for (const row of rows) {
    const pct = formatPct(row.pct)
    lines.push([row.date, row.unit, row.cum, row.adj, pct || "--", ""].join(","))
  }
  return lines.join("\n")
}

async function loadProductNavRows(beian_hao: string, product_name: string): Promise<NavRow[]> {
  const customFund = getCustomFundByCode(beian_hao) ?? findCustomFundByName(product_name)
  if (customFund) {
    return listCustomFundNavRows(customFund.product_code)
      .slice()
      .reverse()
      .map((row) => ({
        date: row.nav_date,
        unit: row.unit_nav,
        cum: row.cumulative_nav,
        adj: row.adjusted_nav ?? row.cumulative_nav,
        pct: row.price_change,
      }))
  }

  const names = await resolveFundNames(beian_hao, product_name)
  const legacyRows = await loadMergedFundNavRows(beian_hao, names.product_name, names.short_name)
  return legacyRows.map((row) => ({
    date: row.price_date.slice(0, 10),
    unit: row.nav,
    cum: row.cum_nav_withdrawal || row.cumulative_nav || row.nav,
    adj: row.cumulative_nav || row.cum_nav_withdrawal || row.nav,
    pct: row.price_change,
  }))
}

async function loadProductProfile(beian_hao: string): Promise<ProductProfile> {
  const [pfiRows, trackRows] = await Promise.all([
    query<{ manager: string | null; inception_date: string | null }>(
      `SELECT manager, inception_date::text
       FROM private_fund_info
       WHERE beian_hao = $1
       LIMIT 1`,
      [beian_hao],
    ).catch(() => [] as { manager: string | null; inception_date: string | null }[]),
    query<{ advisor: string | null; inception_date: string | null; mandator_name: string | null }>(
      `SELECT advisor, inception_date::text, mandator_name
       FROM basicinfo_bfl_track
       WHERE register_number = $1 OR record_key = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [beian_hao],
    ).catch(() => [] as { advisor: string | null; inception_date: string | null; mandator_name: string | null }[]),
  ])

  const pfi = pfiRows[0]
  const track = trackRows[0]
  return {
    manager: (pfi?.manager || track?.mandator_name || "").trim(),
    inception_date: (pfi?.inception_date || track?.inception_date || "").slice(0, 10),
    fund_manager: (track?.advisor || "").trim(),
    aum: "",
  }
}

function sanitizeFileToken(value: string): string {
  return value.replace(/[^\w\u4e00-\u9fff-]+/g, "_").slice(0, 40) || "fund"
}

function reportDir(reportId: string): string {
  return path.join(REPORT_TMP_ROOT, reportId)
}

export function isValidReportId(reportId: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(reportId)
}

export async function resolveProductMonthlyNavRange(
  product_name: string,
  beian_hao?: string,
): Promise<{
  beian_hao: string
  product_name: string
  nav_start_date: string | null
  latest_nav_date: string | null
}> {
  const resolvedBeian = await resolveProductBeianHao(product_name, beian_hao)
  const rows = await loadProductNavRows(resolvedBeian, product_name)
  return {
    beian_hao: resolvedBeian,
    product_name: product_name.trim(),
    nav_start_date: rows[0]?.date ?? null,
    latest_nav_date: rows.at(-1)?.date ?? null,
  }
}

export async function generateProductMonthlyReport(
  input: ProductMonthlyReportRequest,
): Promise<ProductMonthlyReportResult> {
  const end_date = input.end_date.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    throw new Error("请选择有效的报告截止日期")
  }

  const sectionOrder: Record<VolatilitySection, string[]> = {
    低波: [],
    中低波: [],
    中波: [],
  }
  const productsConfig: Record<string, Record<string, string>> = {}
  const seen = new Set<string>()

  for (const section of VOLATILITY_SECTIONS) {
    const funds = input.funds[section] ?? []
    for (const fund of funds) {
      const product_name = fund.product_name.trim()
      if (!product_name) continue
      const key = `${section}:${product_name}`
      if (seen.has(key)) continue
      seen.add(key)

      const beian_hao = await resolveProductBeianHao(product_name, fund.beian_hao)
      const rows = await loadProductNavRows(beian_hao, product_name)
      if (rows.length === 0) {
        throw new Error(`产品「${product_name}」暂无净值数据`)
      }

      const earliest = rows[0].date
      const latest = rows.at(-1)!.date
      if (end_date < earliest || end_date > latest) {
        throw new Error(`产品「${product_name}」的报告截止日期需在 ${earliest} ~ ${latest} 之间`)
      }

      const filteredRows = rows.filter((row) => row.date <= end_date)
      if (filteredRows.length < 2) {
        throw new Error(`产品「${product_name}」在 ${end_date} 之前净值数据不足`)
      }

      const profile = await loadProductProfile(beian_hao)
      const navFile = `${sanitizeFileToken(beian_hao)}_nav.csv`
      sectionOrder[section].push(product_name)
      productsConfig[product_name] = {
        volatility_type: section,
        nav_file: navFile,
        filing_no: beian_hao,
        manager: profile.manager,
        inception_date: profile.inception_date,
        aum: profile.aum,
        fund_manager: profile.fund_manager,
      }
    }
  }

  const totalProducts = VOLATILITY_SECTIONS.reduce((sum, section) => sum + sectionOrder[section].length, 0)
  if (totalProducts === 0) {
    throw new Error("请至少选择一个产品")
  }

  if (!existsSync(SCRIPT_PATH)) {
    throw new Error("月报生成脚本不存在")
  }

  const reportId = randomUUID()
  const workspace = reportDir(reportId)
  await mkdir(workspace, { recursive: true })

  for (const section of VOLATILITY_SECTIONS) {
    for (const product_name of sectionOrder[section]) {
      const cfg = productsConfig[product_name]
      const beian_hao = cfg.filing_no
      const rows = (await loadProductNavRows(beian_hao, product_name)).filter((row) => row.date <= end_date)
      const navFile = path.join(workspace, cfg.nav_file)
      await writeFile(navFile, `\uFEFF${navRowsToCsv(rows)}`, "utf8")
    }
  }

  const config = {
    end_date,
    section_order: sectionOrder,
    products: productsConfig,
  }
  await writeFile(path.join(workspace, "report_config.json"), JSON.stringify(config, null, 2), "utf8")

  const dateSuffix = end_date.replace(/-/g, "")
  const pptxName = `私募产品历史业绩_${dateSuffix}.pptx`
  const pdfName = `私募产品历史业绩_${dateSuffix}.pdf`
  const { executable: pythonExe, prefixArgs } = await findPython(SCRIPT_DIR)

  const args = [
    ...prefixArgs,
    "-u",
    SCRIPT_PATH,
    "--workspace",
    workspace,
    "-o",
    workspace,
    "--end-date",
    end_date,
    "--theme",
    "red",
    "--pptx-name",
    pptxName,
    "--pdf-name",
    pdfName,
  ]

  console.log("[product-monthly-report] Using Python:", pythonExe, prefixArgs.join(" "))

  let exitCode = 0
  try {
    const { stdout, stderr } = await execFileAsync(pythonExe, args, {
      cwd: SCRIPT_DIR,
      env: pythonExecEnv(),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 600_000,
    })
    if (stdout) console.log("[product-monthly-report] stdout:", stdout.slice(0, 2000))
    if (stderr) console.warn("[product-monthly-report] stderr:", stderr.slice(0, 2000))
  } catch (err) {
    exitCode = typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : 1
    const msg = err instanceof Error ? err.message : String(err)
    const errStderr = (err as { stderr?: string }).stderr ?? ""
    const errStdout = (err as { stdout?: string }).stdout ?? ""
    const detail = [errStderr, errStdout].filter(Boolean).join("\n").trim()
    console.error("[product-monthly-report] Python failed:", detail || msg)
    if (detail.includes("No module named") || detail.includes("ModuleNotFoundError")) {
      throw new Error(`Python 报告依赖未安装，请在项目目录执行: ${pythonDepsInstallHint()}`)
    }
    if (exitCode !== 2) {
      const userMessage = detail.replace(/^错误:\s*/m, "").trim()
      throw new Error(userMessage || msg || "报告生成失败")
    }
  }

  const files = await readdir(workspace)
  const pptxFile = files.find((f) => f.endsWith(".pptx"))
  if (!pptxFile) {
    throw new Error("脚本执行完毕但未找到 PPT 输出文件")
  }
  const pdfFile = files.find((f) => f.endsWith(".pdf") && !f.endsWith(".tmp.pdf")) ?? null

  const meta = {
    endDate: end_date,
    generatedAt: new Date().toISOString(),
    pptxFileName: pptxFile,
    pdfFileName: pdfFile,
    productCount: totalProducts,
  }
  await writeFile(path.join(workspace, "meta.json"), JSON.stringify(meta), "utf8")

  return {
    reportId,
    endDate: end_date,
    pptxFileName: pptxFile,
    pdfFileName: pdfFile,
    productCount: totalProducts,
  }
}

export async function readProductMonthlyReportFile(
  reportId: string,
  format: "pdf" | "pptx",
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
    pptxFileName?: string
    pdfFileName?: string | null
  }

  const fileName = format === "pdf" ? meta.pdfFileName : meta.pptxFileName
  if (!fileName) {
    throw new Error(format === "pdf" ? "PDF 未生成（Linux 需安装 LibreOffice，Windows 需安装 Microsoft PowerPoint）" : "报告文件不存在")
  }

  const filePath = path.join(dir, fileName)
  if (!existsSync(filePath)) throw new Error("报告文件不存在")

  const buffer = await readFile(filePath)
  const contentType =
    format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  return { buffer, fileName, contentType }
}

export async function readProductMonthlyReportPreview(reportId: string): Promise<Buffer> {
  const { buffer } = await readProductMonthlyReportFile(reportId, "pdf")
  return buffer
}

export function buildProductMonthlyDownloadToken(reportId: string, format: "pdf" | "pptx"): string {
  const secret = process.env.REPORT_DOWNLOAD_SECRET || process.env.DATABASE_URL || "product-monthly-local"
  return createHash("sha256").update(`${reportId}:${format}:${secret}`).digest("hex").slice(0, 16)
}

export function verifyProductMonthlyDownloadToken(
  reportId: string,
  format: "pdf" | "pptx",
  token: string,
): boolean {
  return token === buildProductMonthlyDownloadToken(reportId, format)
}
