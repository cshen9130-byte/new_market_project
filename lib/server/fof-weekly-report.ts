import { execFile } from "child_process"
import { createHash, randomUUID } from "crypto"
import { existsSync, readFileSync, statSync } from "fs"
import { mkdir, readFile, readdir, writeFile } from "fs/promises"
import path from "path"
import { promisify } from "util"
import { query } from "@/lib/db"
import { findCustomFundByName, getCustomFundByCode } from "@/lib/server/custom-funds"
import { listCustomFundNavRows } from "@/lib/server/custom-fund-nav"
import type { LegacyNavRow } from "@/lib/server/email-nav-query"
import {
  loadBenchmarkForNavDates,
  resolveFofWeeklyBenchmark,
  type FofWeeklyBenchmarkKey,
} from "@/lib/server/fof-weekly-benchmark"
import { loadFundNavRange, loadMergedFundNavRows, resolveFundNames } from "@/lib/server/fund-nav-series"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"
import { loadManagedProductNavSeed } from "@/lib/server/managed-product-nav-seed"
import { analyzeNavWorkbook } from "@/lib/server/nav-cleaner"

const execFileAsync = promisify(execFile)
const REPORT_TMP_ROOT = path.join(process.cwd(), ".tmp", "fof-weekly-reports")
const SCRIPT_DIR = path.join(process.cwd(), "haitai_week_report")
const SCRIPT_PATH = path.join(SCRIPT_DIR, "generate_fof_weekly_report.py")
const BUNDLED_CN_FONT = path.join(SCRIPT_DIR, "fonts", "NotoSansSC-Regular.otf")
const BUNDLED_FOF_NAV_BY_BEIAN: Record<string, string> = {
  SBPU97: "低波稳健FOF 1号合并净值.xlsx",
}
const MANAGED_NAV_SEED_DIR = path.join(process.cwd(), "data", "managed-product-nav")

function isLikelyValidFontFile(filePath: string): boolean {
  try {
    const stat = statSync(filePath)
    return stat.isFile() && stat.size >= 100_000
  } catch {
    return false
  }
}

function resolveReportFontEnv(): Record<string, string> {
  const configured = process.env.FOF_REPORT_FONT_PATH?.trim()
  if (configured && isLikelyValidFontFile(configured)) {
    return { FOF_REPORT_FONT_PATH: configured }
  }
  if (isLikelyValidFontFile(BUNDLED_CN_FONT)) {
    return { FOF_REPORT_FONT_PATH: BUNDLED_CN_FONT }
  }
  return {}
}

export type FofWeeklyNavFrequency = "daily" | "weekly" | "monthly"

export const FOF_WEEKLY_NAV_FREQUENCY_OPTIONS: Array<{ value: FofWeeklyNavFrequency; label: string }> = [
  { value: "weekly", label: "周频" },
  { value: "daily", label: "日频" },
  { value: "monthly", label: "月频" },
]

export type FofWeeklyReportRequest = {
  product_name: string
  beian_hao?: string
  week_begin?: string
  week_end: string
  report_title?: string
  product_tagline?: string
  benchmark_key?: string
  nav_frequency?: FofWeeklyNavFrequency
}

function normalizeNavFrequency(value: string | undefined): FofWeeklyNavFrequency {
  const freq = (value ?? "weekly").trim().toLowerCase()
  if (freq === "daily" || freq === "monthly") return freq
  return "weekly"
}

export type FofWeeklyReportResult = {
  reportId: string
  reportTitle: string
  weekStart: string
  weekEnd: string
  dataEnd: string
  pngFileName: string
  pdfFileName: string
}

type PythonInvocation = {
  executable: string
  prefixArgs: string[]
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
      [...invocation.prefixArgs, "-c", "import pandas, matplotlib, akshare, openpyxl"],
      { timeout: 15_000 },
    )
    return true
  } catch {
    return false
  }
}

function pythonDepsInstallHint(): string {
  if (process.platform === "win32") {
    return "py -3 -m pip install -r haitai_week_report/requirements.txt"
  }
  return "bash scripts/deploy/setup-haitai-week-report.sh"
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

export async function resolveProductBeianHao(product_name: string, beian_hao?: string): Promise<string> {
  const code = beian_hao?.trim()
  if (code) {
    if (getCustomFundByCode(code)) return code
    return code
  }

  const customFund = findCustomFundByName(product_name.trim())
  if (customFund) return customFund.product_code

  const managed = await query<{ beian_hao: string | null }>(
    `SELECT cache.beian_hao
     FROM managed_products m
     LEFT JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
     WHERE m.product_name = $1
     LIMIT 1`,
    [product_name.trim()],
  ).catch(() => [] as { beian_hao: string | null }[])

  if (managed[0]?.beian_hao) return managed[0].beian_hao

  const info = await query<{ beian_hao: string }>(
    `SELECT beian_hao
     FROM private_fund_info
     WHERE product_name = $1
     LIMIT 1`,
    [product_name.trim()],
  ).catch(() => [] as { beian_hao: string }[])

  if (info[0]?.beian_hao) return info[0].beian_hao

  throw new Error(`未找到产品「${product_name}」的备案号`)
}

function resolveBundledFofWeeklyNavPath(
  beian_hao: string,
  product_name: string,
): { navPath: string; seedCode: string } | null {
  const override = lookupManagedProductOverride(beian_hao) ?? lookupManagedProductOverride(product_name)
  const codes = new Set<string>()
  const normalized = beian_hao.trim().toUpperCase()
  if (normalized) codes.add(normalized)
  if (override?.beian_hao) codes.add(override.beian_hao.toUpperCase())

  for (const code of codes) {
    const filename = BUNDLED_FOF_NAV_BY_BEIAN[code]
    if (!filename) continue
    const candidate = path.join(SCRIPT_DIR, filename)
    if (existsSync(candidate)) return { navPath: candidate, seedCode: code }
  }

  if (/低波稳健FOF\s*1号/u.test(product_name.trim())) {
    const candidate = path.join(SCRIPT_DIR, "低波稳健FOF 1号合并净值.xlsx")
    if (existsSync(candidate)) {
      const canonicalCode = Object.entries(BUNDLED_FOF_NAV_BY_BEIAN).find(
        ([, fname]) => fname === "低波稳健FOF 1号合并净值.xlsx",
      )?.[0] ?? normalized
      return { navPath: candidate, seedCode: canonicalCode }
    }
  }

  return null
}

function loadFullManagedSeedRows(beian_hao: string): LegacyNavRow[] | null {
  const key = (beian_hao ?? "").trim().toUpperCase()
  if (!key) return null

  const seedPath = path.join(MANAGED_NAV_SEED_DIR, `${key}.json`)
  if (!existsSync(seedPath)) return null

  try {
    const raw = JSON.parse(readFileSync(seedPath, "utf8")) as { before_date?: string | null }
    if (raw.before_date != null) return null
  } catch {
    return null
  }

  const rows = loadManagedProductNavSeed(key)
  return rows.length > 0 ? rows : null
}

function legacyRowsToNavCsvInput(rows: LegacyNavRow[]): Array<{
  date: string
  unit: string
  cum: string
  adj: string
  pct: string | null | undefined
}> {
  return rows.map((row) => ({
    date: row.price_date.slice(0, 10),
    unit: row.nav,
    cum: row.cum_nav_withdrawal || row.cumulative_nav || row.nav,
    adj: row.cumulative_nav || row.cum_nav_withdrawal || row.nav,
    pct: row.price_change,
  }))
}

function resolveNavDateRangeFromRows(rows: Array<{ date: string }>): {
  earliestNavDate: string
  latestNavDate: string
} | null {
  const earliestNavDate = rows[0]?.date
  const latestNavDate = rows.at(-1)?.date
  if (!earliestNavDate || !latestNavDate) return null
  return { earliestNavDate, latestNavDate }
}

/** Date span from a bundled FOF weekly xlsx (merged portfolio NAV, not product seed). */
function resolveBundledNavDateRange(navPath: string): {
  earliestNavDate: string
  latestNavDate: string
} | null {
  try {
    const analysis = analyzeNavWorkbook(readFileSync(navPath), path.basename(navPath))
    const sorted = [...analysis.rows].sort((a, b) => a.date.localeCompare(b.date))
    return resolveNavDateRangeFromRows(sorted.map((row) => ({ date: row.date })))
  } catch {
    return null
  }
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

function navRowsToCsv(
  rows: Array<{
    date: string
    unit: string
    cum: string
    adj: string
    pct: string | null | undefined
  }>,
  benchLabel: string,
  benchByNavDate: Map<string, number>,
): string {
  const lines = [`日期,单位净值,累计净值,复权净值,涨跌幅,${benchLabel}`]
  for (const row of rows) {
    const pct = formatPct(row.pct)
    const bench = benchByNavDate.get(row.date)
    lines.push([
      row.date,
      row.unit,
      row.cum,
      row.adj,
      pct || "--",
      bench != null ? bench.toFixed(4) : "",
    ].join(","))
  }
  return lines.join("\n")
}

async function buildNavRowsWithBenchmark(
  rows: Array<{
    date: string
    unit: string
    cum: string
    adj: string
    pct: string | null | undefined
  }>,
  benchmarkKey: FofWeeklyBenchmarkKey,
): Promise<{ csv: string; benchLabel: string }> {
  if (rows.length === 0) {
    throw new Error("该产品暂无净值数据")
  }

  const benchMeta = resolveFofWeeklyBenchmark(benchmarkKey)
  const navDates = rows.map((row) => row.date)
  const benchByNavDate = await loadBenchmarkForNavDates(benchMeta.key, navDates)
  const missing = navDates.filter((date) => !benchByNavDate.has(date))
  if (missing.length > 0) {
    throw new Error(`无法获取基准「${benchMeta.label}」数据，缺失日期: ${missing.slice(0, 3).join(", ")}`)
  }

  return {
    csv: navRowsToCsv(rows, benchMeta.label, benchByNavDate),
    benchLabel: benchMeta.label,
  }
}

export async function buildFofWeeklyNavCsv(
  beian_hao: string,
  product_name: string,
  short_name: string,
  benchmarkKey: FofWeeklyBenchmarkKey = "IF",
): Promise<{ csv: string; benchLabel: string }> {
  const customFund = getCustomFundByCode(beian_hao) ?? findCustomFundByName(product_name)
  if (customFund) {
    const rows = listCustomFundNavRows(customFund.product_code).slice().reverse()
    return buildNavRowsWithBenchmark(
      rows.map((row) => ({
        date: row.nav_date,
        unit: row.unit_nav,
        cum: row.cumulative_nav,
        adj: row.adjusted_nav ?? row.cumulative_nav,
        pct: row.price_change,
      })),
      benchmarkKey,
    )
  }

  const seedRows = loadFullManagedSeedRows(beian_hao)
  if (seedRows) {
    return buildNavRowsWithBenchmark(legacyRowsToNavCsvInput(seedRows), benchmarkKey)
  }

  const legacyRows = await loadMergedFundNavRows(beian_hao, product_name, short_name)
  return buildNavRowsWithBenchmark(legacyRowsToNavCsvInput(legacyRows), benchmarkKey)
}

export async function resolveFofWeeklyProductNavRange(
  product_name: string,
  beian_hao?: string,
): Promise<{
  beian_hao: string
  product_name: string
  nav_start_date: string | null
  latest_nav_date: string | null
}> {
  const resolvedBeian = await resolveProductBeianHao(product_name, beian_hao)
  const customFund = getCustomFundByCode(resolvedBeian) ?? findCustomFundByName(product_name.trim())
  if (customFund) {
    const rows = listCustomFundNavRows(customFund.product_code).slice().reverse()
    return {
      beian_hao: customFund.product_code,
      product_name: customFund.product_name,
      nav_start_date: rows[0]?.nav_date ?? null,
      latest_nav_date: rows.at(-1)?.nav_date ?? null,
    }
  }

  const names = await resolveFundNames(resolvedBeian, product_name)
  const seedRows = loadFullManagedSeedRows(resolvedBeian)
  if (seedRows) {
    return {
      beian_hao: resolvedBeian,
      product_name: names.product_name,
      nav_start_date: seedRows[0].price_date.slice(0, 10),
      latest_nav_date: seedRows.at(-1)!.price_date.slice(0, 10),
    }
  }

  const range = await loadFundNavRange(resolvedBeian, names.product_name, names.short_name)
  return {
    beian_hao: resolvedBeian,
    product_name: names.product_name,
    nav_start_date: range.nav_start_date,
    latest_nav_date: range.latest_nav_date,
  }
}

function reportDir(reportId: string): string {
  return path.join(REPORT_TMP_ROOT, reportId)
}

export function isValidReportId(reportId: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(reportId)
}

export async function generateFofWeeklyReport(
  input: FofWeeklyReportRequest,
): Promise<FofWeeklyReportResult> {
  const product_name = input.product_name.trim()
  const week_end = input.week_end.trim()
  const week_begin = input.week_begin?.trim() ?? ""
  if (!product_name) throw new Error("请选择产品")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_end)) throw new Error("请选择有效的报告周日期")
  if (week_begin && !/^\d{4}-\d{2}-\d{2}$/.test(week_begin)) {
    throw new Error("请选择有效的报告周开始日期")
  }
  if (week_begin && week_begin > week_end) {
    throw new Error("报告周开始日期不能晚于结束日期")
  }

  const benchmark = resolveFofWeeklyBenchmark(input.benchmark_key)
  const navFrequency = normalizeNavFrequency(input.nav_frequency)
  const beian_hao = await resolveProductBeianHao(product_name, input.beian_hao)
  const customFund = getCustomFundByCode(beian_hao) ?? findCustomFundByName(product_name)
  const names = customFund
    ? { product_name: customFund.product_name, short_name: "" }
    : await resolveFundNames(beian_hao, product_name)
  const bundledResult = resolveBundledFofWeeklyNavPath(beian_hao, names.product_name)
  let navFile: string
  let benchLabel: string
  let earliestNavDate: string
  let latestNavDate: string
  let navCsv = ""

  if (bundledResult) {
    navFile = bundledResult.navPath
    benchLabel = benchmark.label
    const range =
      resolveBundledNavDateRange(bundledResult.navPath)
      ?? (() => {
        const seedRows = loadFullManagedSeedRows(bundledResult.seedCode)
        return resolveNavDateRangeFromRows(
          seedRows ? legacyRowsToNavCsvInput(seedRows) : [],
        )
      })()
    if (!range) {
      throw new Error("无法读取 bundled 净值文件的日期范围")
    }
    earliestNavDate = range.earliestNavDate
    latestNavDate = range.latestNavDate
  } else {
    const built = await buildFofWeeklyNavCsv(
      beian_hao,
      names.product_name,
      names.short_name,
      benchmark.key,
    )
    navCsv = built.csv
    benchLabel = built.benchLabel

    const navRows = navCsv.split("\n").slice(1).map((line) => line.split(",")[0]).filter(Boolean)
    latestNavDate = navRows.at(-1) ?? ""
    earliestNavDate = navRows[0] ?? ""
    if (!latestNavDate || !earliestNavDate) throw new Error("净值数据为空")
    navFile = ""
  }

  if (week_end < earliestNavDate || week_end > latestNavDate) {
    throw new Error(`报告周日期需在 ${earliestNavDate} ~ ${latestNavDate} 之间`)
  }
  if (week_begin && week_begin < earliestNavDate) {
    throw new Error(`报告周开始日期不能早于 ${earliestNavDate}`)
  }

  if (!existsSync(SCRIPT_PATH)) {
    throw new Error("周报生成脚本不存在")
  }

  const reportId = randomUUID()
  const outDir = reportDir(reportId)
  await mkdir(outDir, { recursive: true })

  if (!bundledResult) {
    navFile = path.join(outDir, "nav.csv")
    await writeFile(navFile, `\uFEFF${navCsv}`, "utf8")
  }

  const reportTitle = (input.report_title || names.product_name).trim()
  const productTagline = (input.product_tagline || "低波动 · 稳健运作 · 强势股策略").trim()
  const { executable: pythonExe, prefixArgs } = await findPython(SCRIPT_DIR)

  const args = [
    ...prefixArgs,
    "-u",
    SCRIPT_PATH,
    navFile,
    "-o",
    outDir,
    "--week-end",
    week_end,
    ...(week_begin ? ["--week-begin", week_begin] : []),
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
  ]

  console.log("[fof-weekly-report] Using Python:", pythonExe, prefixArgs.join(" "))

  try {
    const { stdout, stderr } = await execFileAsync(pythonExe, args, {
      cwd: SCRIPT_DIR,
      env: {
        ...process.env,
        ...resolveReportFontEnv(),
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 300_000,
    })
    if (stdout) console.log("[fof-weekly-report] stdout:", stdout.slice(0, 1000))
    if (stderr) console.warn("[fof-weekly-report] stderr:", stderr.slice(0, 1000))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const errStderr = (err as { stderr?: string }).stderr ?? ""
    const errStdout = (err as { stdout?: string }).stdout ?? ""
    const detail = [errStderr, errStdout].filter(Boolean).join("\n").trim()
    console.error("[fof-weekly-report] Python failed:", detail || msg)
    if (detail.includes("No module named") || detail.includes("ModuleNotFoundError")) {
      throw new Error(`Python 报告依赖未安装，请在项目目录执行: ${pythonDepsInstallHint()}`)
    }
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
    weekEnd: week_end,
    dataEnd: week_end,
    generatedAt: new Date().toISOString(),
    pngFileName: pngFile,
    pdfFileName: pdfFile,
  }
  await writeFile(path.join(outDir, "meta.json"), JSON.stringify(meta), "utf8")

  const weekStart = week_begin || getIsoWeekStart(week_end)
  return {
    reportId,
    reportTitle,
    weekStart,
    weekEnd: week_end,
    dataEnd: week_end,
    pngFileName: pngFile,
    pdfFileName: pdfFile,
  }
}

function getIsoWeekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d.toISOString().slice(0, 10)
}

export async function readFofWeeklyReportFile(
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

export async function readFofWeeklyReportPreview(reportId: string): Promise<Buffer> {
  const { buffer } = await readFofWeeklyReportFile(reportId, "png")
  return buffer
}

export function buildReportDownloadToken(reportId: string, format: "png" | "pdf"): string {
  const secret = process.env.REPORT_DOWNLOAD_SECRET || process.env.DATABASE_URL || "fof-weekly-local"
  return createHash("sha256").update(`${reportId}:${format}:${secret}`).digest("hex").slice(0, 16)
}

export function verifyReportDownloadToken(
  reportId: string,
  format: "png" | "pdf",
  token: string,
): boolean {
  return token === buildReportDownloadToken(reportId, format)
}
