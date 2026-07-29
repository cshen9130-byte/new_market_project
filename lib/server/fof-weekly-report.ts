import { execFile } from "child_process"
import { createHash, randomUUID } from "crypto"
import { existsSync, readFileSync, statSync } from "fs"
import { mkdir, readFile, readdir, writeFile } from "fs/promises"
import path from "path"
import { promisify } from "util"
import { query } from "@/lib/db"
import { findCustomFundByName, getCustomFundByCode } from "@/lib/server/custom-funds"
import { listCustomFundNavRows } from "@/lib/server/custom-fund-nav"
import { generateCustomFundNavFromRule } from "@/lib/server/custom-fund-nav-generate"
import { getCustomFundNavGenerationRule } from "@/lib/server/custom-fund-nav-rules"
import type { LegacyNavRow } from "@/lib/server/email-nav-query"
import {
  loadBenchmarkForNavDates,
  resolveFofWeeklyBenchmark,
  type FofWeeklyBenchmarkKey,
} from "@/lib/server/fof-weekly-benchmark"
import { loadFundNavRange, loadMergedFundNavRows, resolveFundNames } from "@/lib/server/fund-nav-series"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"
import { analyzeNavWorkbook } from "@/lib/server/nav-cleaner"

const execFileAsync = promisify(execFile)
const REPORT_TMP_ROOT = path.join(process.cwd(), ".tmp", "fof-weekly-reports")
const SCRIPT_DIR = path.join(process.cwd(), "haitai_week_report")
const SCRIPT_PATH = path.join(SCRIPT_DIR, "generate_fof_weekly_report.py")
const BUNDLED_CN_FONT = path.join(SCRIPT_DIR, "fonts", "NotoSansSC-Regular.otf")
const BUNDLED_FOF_NAV_BY_BEIAN: Record<string, string> = {
  SBPU97: "低波稳健FOF 1号合并净值.xlsx",
}

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

/** Cold matplotlib import can be slow; akshare is optional and must not gate generation. */
const PYTHON_DEPS_PROBE_TIMEOUT_MS = 30_000

let cachedPython: PythonInvocation | null = null

async function pythonHasReportDeps(invocation: PythonInvocation): Promise<boolean> {
  try {
    // Do NOT import akshare here — its cold import + optional network init often stalls
    // report generation for minutes. Benchmark data is injected from Node/DB into the CSV.
    await execFileAsync(
      invocation.executable,
      [...invocation.prefixArgs, "-c", "import pandas, matplotlib, openpyxl"],
      { timeout: PYTHON_DEPS_PROBE_TIMEOUT_MS },
    )
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stderr = typeof (err as { stderr?: string }).stderr === "string" ? (err as { stderr: string }).stderr : ""
    console.warn(
      "[fof-weekly-report] Python deps probe failed:",
      invocation.executable,
      (stderr || msg).slice(0, 500),
    )
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
  // Reuse a successful probe for this process — cold akshare imports are expensive.
  if (cachedPython) return cachedPython

  const candidates = listPythonCandidates(scriptDir)
  await appendPathPythonCandidates(candidates)

  const tried: string[] = []
  for (const candidate of candidates) {
    tried.push(candidate.executable)
    if (await pythonHasReportDeps(candidate)) {
      cachedPython = candidate
      return candidate
    }
  }

  if (process.platform !== "win32") {
    pushPythonCandidate(candidates, "python3")
  } else {
    pushPythonCandidate(candidates, "py", ["-3"])
  }
  const fallback = candidates.at(-1)
  if (fallback) {
    tried.push(fallback.executable)
    if (await pythonHasReportDeps(fallback)) {
      cachedPython = fallback
      return fallback
    }
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

/** listCustomFundNavRows is newest-first; never use .at(-1) as "latest". */
function latestCustomFundNavDate(rows: Array<{ nav_date: string }>): string | null {
  let latest: string | null = null
  for (const row of rows) {
    const date = row.nav_date?.slice(0, 10)
    if (!date) continue
    if (!latest || date > latest) latest = date
  }
  return latest
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

type NavRow = {
  date: string
  unit: string
  cum: string
  adj: string
  pct: string | null | undefined
}

/**
 * Load historical nav rows from a bundled Excel file.
 * Returns rows sorted ascending by date, or null if the file cannot be parsed.
 */
function loadBundledNavRows(bundledPath: string): NavRow[] | null {
  try {
    const analysis = analyzeNavWorkbook(readFileSync(bundledPath), path.basename(bundledPath))
    const seen = new Set<string>()
    const rows: NavRow[] = []
    for (const r of [...analysis.rows].sort((a, b) => a.date.localeCompare(b.date))) {
      if (!r.date || r.adjustedNav == null || seen.has(r.date)) continue
      seen.add(r.date)
      rows.push({
        date: r.date,
        unit: r.unitNav.toFixed(4),
        cum: r.cumulativeNav.toFixed(4),
        adj: r.adjustedNav.toFixed(4),
        pct: null,
      })
    }
    return rows.length > 0 ? rows : null
  } catch {
    return null
  }
}

/**
 * Extend a set of (bundled) nav rows with newer rows from the database,
 * applying the DB percentage-changes onto the last bundled adj_nav.
 * This preserves the original historical scale while adding new trading days.
 */
function extendNavRowsWithDatabase(
  bundledRows: NavRow[],
  dbRows: Array<{ nav_date: string; adjusted_nav: string | null | undefined; unit_nav: string }>,
): NavRow[] {
  if (bundledRows.length === 0) return bundledRows

  const bundledLastDate = bundledRows[bundledRows.length - 1].date
  const bundledLastAdj = parseFloat(bundledRows[bundledRows.length - 1].adj)
  if (!isFinite(bundledLastAdj) || bundledLastAdj <= 0) return bundledRows

  const sortedDb = [...dbRows].sort((a, b) => a.nav_date.localeCompare(b.nav_date))

  // Find anchor: the DB row at or just before bundled's last date (used as pct-change base)
  const anchorRow = sortedDb.filter((r) => r.nav_date <= bundledLastDate).at(-1)
  if (!anchorRow) return bundledRows

  const anchorAdj = parseFloat(anchorRow.adjusted_nav ?? anchorRow.unit_nav)
  if (!isFinite(anchorAdj) || anchorAdj <= 0) return bundledRows

  // Walk DB rows that are strictly after the bundled last date
  const newDbRows = sortedDb.filter((r) => r.nav_date > bundledLastDate)
  if (newDbRows.length === 0) return bundledRows

  const extensionRows: NavRow[] = []
  let prevDbAdj = anchorAdj
  let prevExtAdj = bundledLastAdj

  for (const dbRow of newDbRows) {
    const currDbAdj = parseFloat(dbRow.adjusted_nav ?? dbRow.unit_nav)
    if (!isFinite(currDbAdj) || currDbAdj <= 0 || prevDbAdj <= 0) {
      prevDbAdj = isFinite(currDbAdj) ? currDbAdj : prevDbAdj
      continue
    }
    const pctChange = currDbAdj / prevDbAdj
    const extAdj = prevExtAdj * pctChange
    const extStr = extAdj.toFixed(4)
    extensionRows.push({
      date: dbRow.nav_date,
      unit: extStr,
      cum: extStr,
      adj: extStr,
      pct: `${((pctChange - 1) * 100).toFixed(4)}%`,
    })
    prevDbAdj = currDbAdj
    prevExtAdj = extAdj
  }

  return [...bundledRows, ...extensionRows]
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

async function ensureCustomFundNavRows(
  productCode: string,
  rule: Parameters<typeof generateCustomFundNavFromRule>[1],
  minDate?: string,
) {
  const existing = listCustomFundNavRows(productCode)
  const latest = latestCustomFundNavDate(existing)
  // Skip expensive splice regeneration when we already cover the requested week end.
  if (latest && (!minDate || latest >= minDate)) {
    return existing
  }
  await generateCustomFundNavFromRule(productCode, rule)
  return listCustomFundNavRows(productCode)
}

export async function buildFofWeeklyNavCsv(
  beian_hao: string,
  product_name: string,
  short_name: string,
  benchmarkKey: FofWeeklyBenchmarkKey = "IF",
  options?: { minNavDate?: string },
): Promise<{ csv: string; benchLabel: string }> {
  const customFund = getCustomFundByCode(beian_hao) ?? findCustomFundByName(product_name)
  if (customFund) {
    const rule = getCustomFundNavGenerationRule(customFund.product_code)
    if (rule && rule.rule_type === "splice") {
      // Prefer the bundled Excel as the authoritative historical series.
      // It was carefully curated and yields the correct Sharpe / scale.
      // Only the dates AFTER the bundled file are fetched fresh from the DB.
      // Resolve by SBPU97 / product name — customFund.product_code (e.g. "380001") is not the map key.
      const bundled = resolveBundledFofWeeklyNavPath(beian_hao, product_name)
        ?? resolveBundledFofWeeklyNavPath(beian_hao, customFund.product_name)

      if (bundled) {
        const bundledRows = loadBundledNavRows(bundled.navPath)
        if (bundledRows) {
          const dbRows = await ensureCustomFundNavRows(
            customFund.product_code,
            rule,
            options?.minNavDate,
          )
          const mergedRows = extendNavRowsWithDatabase(
            bundledRows,
            dbRows.map((r) => ({
              nav_date: r.nav_date,
              adjusted_nav: r.adjusted_nav ?? r.unit_nav,
              unit_nav: r.unit_nav,
            })),
          )
          return buildNavRowsWithBenchmark(mergedRows, benchmarkKey)
        }
      }

      // No bundled file (or unreadable) – fall back to pure DB regeneration
      await ensureCustomFundNavRows(customFund.product_code, rule, options?.minNavDate)
    }
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

  // Same merge path as the fund detail page: managed seed + team/email after seed end.
  // Do not return seed-only — that caps the series at the xlsx rebuild date (e.g. SBPU97 → 2026-06-23).
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
    const rule = getCustomFundNavGenerationRule(customFund.product_code)
    if (rule && rule.rule_type === "splice") {
      const bundled = resolveBundledFofWeeklyNavPath(resolvedBeian, product_name.trim())
        ?? resolveBundledFofWeeklyNavPath(resolvedBeian, customFund.product_name)

      if (bundled) {
        const bundledRange = resolveBundledNavDateRange(bundled.navPath)
        if (bundledRange) {
          // Refresh DB so we know if there are newer trading days
          await generateCustomFundNavFromRule(customFund.product_code, rule)
          const dbRows = listCustomFundNavRows(customFund.product_code)
          const dbLatest = latestCustomFundNavDate(dbRows) ?? bundledRange.latestNavDate
          return {
            beian_hao: customFund.product_code,
            product_name: customFund.product_name,
            nav_start_date: bundledRange.earliestNavDate,
            latest_nav_date: dbLatest > bundledRange.latestNavDate ? dbLatest : bundledRange.latestNavDate,
          }
        }
      }

      // Fallback: pure DB
      await generateCustomFundNavFromRule(customFund.product_code, rule)
    }
    const rows = listCustomFundNavRows(customFund.product_code)
    const latest = latestCustomFundNavDate(rows)
    const earliest = rows.length
      ? rows.reduce((min, row) => (row.nav_date < min ? row.nav_date : min), rows[0].nav_date)
      : null
    return {
      beian_hao: customFund.product_code,
      product_name: customFund.product_name,
      nav_start_date: earliest,
      latest_nav_date: latest,
    }
  }

  const names = await resolveFundNames(resolvedBeian, product_name)
  // Match fund detail: seed + live team/email (not seed end date alone).
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

  const startedAt = Date.now()
  const benchmark = resolveFofWeeklyBenchmark(input.benchmark_key)
  const navFrequency = normalizeNavFrequency(input.nav_frequency)
  const beian_hao = await resolveProductBeianHao(product_name, input.beian_hao)
  const customFund = getCustomFundByCode(beian_hao) ?? findCustomFundByName(product_name)
  const names = customFund
    ? { product_name: customFund.product_name, short_name: "" }
    : await resolveFundNames(beian_hao, product_name)
  // Prefer cached custom-fund NAV when it already covers week_end (nav-range usually refreshed it).
  const built = await buildFofWeeklyNavCsv(
    beian_hao,
    names.product_name,
    names.short_name,
    benchmark.key,
    { minNavDate: week_end },
  )
  const navCsv = built.csv
  const benchLabel = built.benchLabel
  console.log(`[fof-weekly-report] nav csv ready in ${Date.now() - startedAt}ms`)

  const navRows = navCsv.split("\n").slice(1).map((line) => line.split(",")[0]).filter(Boolean)
  const latestNavDate = navRows.at(-1) ?? ""
  const earliestNavDate = navRows[0] ?? ""
  if (!latestNavDate || !earliestNavDate) throw new Error("净值数据为空")

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

  const navFile = path.join(outDir, "nav.csv")
  await writeFile(navFile, `\uFEFF${navCsv}`, "utf8")

  const reportTitle = (input.report_title || names.product_name).trim()
  const productTagline = (input.product_tagline || "低波动 · 稳健运作 · 强势股策略").trim()
  const pythonStartedAt = Date.now()
  const { executable: pythonExe, prefixArgs } = await findPython(SCRIPT_DIR)
  console.log(
    `[fof-weekly-report] Using Python: ${pythonExe} ${prefixArgs.join(" ")} (probe ${Date.now() - pythonStartedAt}ms)`,
  )

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

  const renderStartedAt = Date.now()
  try {
    const { stdout, stderr } = await execFileAsync(pythonExe, args, {
      cwd: SCRIPT_DIR,
      env: {
        ...process.env,
        ...resolveReportFontEnv(),
        // Benchmark is already in the CSV from DB; avoid remote akshare hangs.
        FOF_REPORT_DISABLE_AKSHARE: process.env.FOF_REPORT_DISABLE_AKSHARE ?? "1",
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 180_000,
    })
    console.log(`[fof-weekly-report] python render done in ${Date.now() - renderStartedAt}ms`)
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
