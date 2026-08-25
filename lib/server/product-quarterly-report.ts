import { createHash, randomUUID } from "crypto"
import { execFile } from "child_process"
import { existsSync } from "fs"
import { mkdir, readFile, readdir, writeFile } from "fs/promises"
import path from "path"
import { promisify } from "util"
import { query } from "@/lib/db"
import { lookupAmacMandatorName } from "@/lib/server/amac-fund-metadata"
import { findCustomFundByName, getCustomFundByCode } from "@/lib/server/custom-funds"
import {
  buildFofWeeklyNavCsv,
  isValidReportId,
  resolveFofWeeklyProductNavRange,
  resolveProductBeianHao,
} from "@/lib/server/fof-weekly-report"
import {
  alignBenchmarkToNavDates,
  loadFofWeeklyBenchmarkPrices,
  resolveFofWeeklyBenchmark,
  type FofWeeklyBenchmarkKey,
} from "@/lib/server/fof-weekly-benchmark"
import { resolveFundNames } from "@/lib/server/fund-nav-series"
import { sinaGet } from "@/lib/server/sina-fetch"

export { isValidReportId }

const execFileAsync = promisify(execFile)
const REPORT_TMP_ROOT = path.join(process.cwd(), ".tmp", "product-quarterly-reports")
const SCRIPT_DIR = path.join(process.cwd(), "product_quarterly")
const SCRIPT_PATH = path.join(SCRIPT_DIR, "generate_product_quarterly.py")
const BUNDLED_CN_FONT = path.join(process.cwd(), "haitai_week_report", "fonts", "NotoSansSC-Regular.otf")

const SINA_INDEX_SYMBOLS: Partial<Record<FofWeeklyBenchmarkKey, string>> = {
  "000001.SH": "sh000001",
  "000300.SH": "sh000300",
}

export const PRODUCT_QUARTERLY_DEFAULT_BENCH1: FofWeeklyBenchmarkKey = "000001.SH"
export const PRODUCT_QUARTERLY_DEFAULT_BENCH2: FofWeeklyBenchmarkKey = "IF"

export type ProductQuarterlyReportRequest = {
  product_name: string
  beian_hao?: string
  period_begin: string
  period_end: string
  report_title?: string
  bench1_key?: string
  bench2_key?: string
  commentary?: string
  brand_name?: string
  watermark?: string
}

export type ProductQuarterlyReportResult = {
  reportId: string
  reportTitle: string
  periodStart: string
  periodEnd: string
  dataEnd: string
  pngFileName: string
  pdfFileName: string
}

function reportDir(reportId: string): string {
  return path.join(REPORT_TMP_ROOT, reportId)
}

function formatInceptionDate(value: string | null | undefined): string {
  if (!value) return "--"
  const m = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return value
  return `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`
}

function toDisplayShortName(shortName: string | null | undefined, productName: string): string {
  const raw = (shortName || productName || "").trim()
  const stripped = raw
    .replace(/(私募证券投资基金|私募投资基金|证券投资基金|私募基金|投资基金)$/u, "")
    .trim()
  return stripped || raw || productName
}

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0))
  return d.toISOString().slice(0, 10)
}

export function lastCompleteQuarter(asOf: string): { start: string; end: string; heading: string } {
  const [y, m] = asOf.split("-").map(Number)
  const monthIndex = m - 1
  const thisQ = Math.floor(monthIndex / 3)
  const qEndMonth = thisQ * 3 + 3
  const qEnd = lastDayOfMonth(y, qEndMonth)
  const quarterComplete = asOf >= qEnd
  const q = quarterComplete ? thisQ : thisQ - 1
  const year = q < 0 ? y - 1 : y
  const qIndex = q < 0 ? 3 : q
  const startMonth = qIndex * 3 + 1
  const endMonth = startMonth + 2
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`
  const end = lastDayOfMonth(year, endMonth)
  return {
    start,
    end,
    heading: `${year}年 第${qIndex + 1}季度 投资报告`,
  }
}

function formatQuarterHeading(start: string, end: string): string {
  const startMonth = Number(start.slice(5, 7))
  const startDay = Number(start.slice(8, 10))
  if (startDay === 1 && [1, 4, 7, 10].includes(startMonth)) {
    const q = Math.floor((startMonth - 1) / 3) + 1
    return `${start.slice(0, 4)}年 第${q}季度 投资报告`
  }
  return `${start.slice(0, 4)}年${Number(start.slice(5, 7))}月–${end.slice(0, 4)}年${Number(end.slice(5, 7))}月 持有期投资报告`
}

async function loadFundOverview(beian_hao: string, product_name: string) {
  const [pfiRows, bflRows, trackRows, strategyRows] = await Promise.all([
    query<{ manager: string | null; inception_date: string | null }>(
      `SELECT manager, inception_date::text
       FROM private_fund_info
       WHERE beian_hao = $1
       LIMIT 1`,
      [beian_hao],
    ).catch(() => [] as { manager: string | null; inception_date: string | null }[]),
    query<{
      fund_type: string | null
      custodian: string | null
      investment_advisor: string | null
      inception_date: string | null
    }>(
      `SELECT fund_type, custodian, investment_advisor, inception_date::text
       FROM private_fund_info_bfl
       WHERE beian_hao = $1
       LIMIT 1`,
      [beian_hao],
    ).catch(
      () =>
        [] as {
          fund_type: string | null
          custodian: string | null
          investment_advisor: string | null
          inception_date: string | null
        }[],
    ),
    query<{
      advisor: string | null
      mandator_name: string | null
      inception_date: string | null
    }>(
      `SELECT advisor, mandator_name, inception_date::text
       FROM basicinfo_bfl_track
       WHERE register_number = $1 OR record_key = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [beian_hao],
    ).catch(
      () =>
        [] as {
          advisor: string | null
          mandator_name: string | null
          inception_date: string | null
        }[],
    ),
    query<{ l1: string | null; l2: string | null }>(
      `SELECT NULLIF(BTRIM(company_strategy_one), '') AS l1,
              NULLIF(BTRIM(company_strategy_two), '') AS l2
       FROM type6_ops_team_full
       WHERE register_number = $1
       LIMIT 1`,
      [beian_hao],
    ).catch(() => [] as { l1: string | null; l2: string | null }[]),
  ])

  const pfi = pfiRows[0]
  const bfl = bflRows[0]
  const track = trackRows[0]
  const strategy = strategyRows[0]
  const strategyText = [strategy?.l1, strategy?.l2].filter(Boolean).join(" / ")
  const trackOrBflCustodian = (track?.mandator_name || bfl?.custodian || "").trim()
  const custodian = trackOrBflCustodian || (await lookupAmacMandatorName(beian_hao)) || "--"

  return {
    manager: (pfi?.manager || "").trim() || "--",
    investment_manager: (track?.advisor || bfl?.investment_advisor || "").trim() || "--",
    custodian,
    inception_date: formatInceptionDate(track?.inception_date || bfl?.inception_date || pfi?.inception_date),
    product_type: (bfl?.fund_type || "私募证券投资基金").trim(),
    strategy: strategyText || "—",
    product_name,
  }
}

function parseSinaDaily(text: string): Map<string, number> {
  let rows: Array<{ day?: string; close?: string | number }> = []
  try {
    rows = JSON.parse(text) as Array<{ day?: string; close?: string | number }>
  } catch {
    const open = text.indexOf("[")
    const close = text.lastIndexOf("]")
    if (open < 0 || close < open) return new Map()
    rows = JSON.parse(text.slice(open, close + 1)) as Array<{ day?: string; close?: string | number }>
  }
  const out = new Map<string, number>()
  for (const row of rows) {
    const date = String(row.day || "").slice(0, 10)
    const close = Number(row.close)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue
    out.set(date, close)
  }
  return out
}

async function loadSinaIndexPrices(key: FofWeeklyBenchmarkKey): Promise<Map<string, number>> {
  const symbol = SINA_INDEX_SYMBOLS[key]
  if (!symbol) return new Map()
  try {
    const text = await sinaGet(
      `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=1023`,
      `https://finance.sina.com.cn/realstock/company/${symbol}/nc.shtml`,
    )
    return parseSinaDaily(text)
  } catch {
    return new Map()
  }
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

async function loadQuarterlyBenchmark(key: FofWeeklyBenchmarkKey, navDates: string[]): Promise<Map<string, number>> {
  if (navDates.length === 0) return new Map()
  const from = shiftDate(navDates[0], -90)
  const to = navDates[navDates.length - 1]

  let dbPrices = new Map<string, number>()
  try {
    dbPrices = await loadFofWeeklyBenchmarkPrices(key, from, to)
  } catch {
    dbPrices = new Map()
  }

  const alignedDb = alignBenchmarkToNavDates(navDates, dbPrices)
  const missingRatio = navDates.length === 0 ? 1 : navDates.filter((d) => !alignedDb.has(d)).length / navDates.length
  if (alignedDb.size > 8 && missingRatio <= 0.15) return alignedDb

  const sinaPrices = await loadSinaIndexPrices(key)
  const merged = new Map(sinaPrices)
  for (const [date, value] of dbPrices) merged.set(date, value)
  const aligned = alignBenchmarkToNavDates(navDates, merged)
  if (aligned.size > 5) return aligned
  if (alignedDb.size > 5) return alignedDb
  throw new Error(`无法获取基准「${resolveFofWeeklyBenchmark(key).label}」数据`)
}

function parseNavCsv(csv: string): {
  header: string[]
  rows: string[][]
  dates: string[]
} {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim())
  const header = (lines[0] ?? "").split(",")
  const rows = lines.slice(1).map((line) => line.split(","))
  return { header, rows, dates: rows.map((row) => row[0]).filter(Boolean) }
}

function buildDualBenchmarkCsv(
  parsed: { header: string[]; rows: string[][] },
  bench1Label: string,
  bench1ByDate: Map<string, number>,
  bench2Label: string,
): string {
  const lines = [`日期,单位净值,累计净值,复权净值,涨跌幅,${bench1Label},${bench2Label}`]
  for (const row of parsed.rows) {
    const date = row[0]
    if (!date) continue
    const bench1 = bench1ByDate.get(date)
    const bench2 = row[5] ?? ""
    lines.push([row[0], row[1], row[2], row[3], row[4], bench1 != null ? bench1.toFixed(4) : "", bench2].join(","))
  }
  return lines.join("\n")
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
    push(path.join(cwd, "haitai_week_report", ".venv", "Scripts", "python.exe"))
    push("py", ["-3"])
  } else {
    push(path.join(cwd, ".venv", "bin", "python3"))
    push(path.join(cwd, ".venv", "bin", "python"))
    push(path.join(SCRIPT_DIR, ".venv", "bin", "python3"))
    push(path.join(SCRIPT_DIR, ".venv", "bin", "python"))
    push(path.join(cwd, "haitai_week_report", ".venv", "bin", "python"))
    push("python3")
  }

  const tried: string[] = []
  for (const candidate of candidates) {
    tried.push(candidate.executable)
    try {
      await execFileAsync(candidate.executable, [...candidate.prefixArgs, "-c", "import pandas, matplotlib, numpy"], {
        timeout: 60_000,
      })
      cachedPython = candidate
      return candidate
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const stderr = typeof (err as { stderr?: string }).stderr === "string" ? (err as { stderr: string }).stderr : ""
      console.warn(
        "[product-quarterly-report] Python deps probe failed:",
        candidate.executable,
        (stderr || msg).slice(0, 500),
      )
    }
  }

  throw new Error(
    `Python 报告依赖未安装，请执行: pip install -r product_quarterly/requirements.txt` +
      (tried.length ? `（已尝试: ${[...new Set(tried)].join(", ")}）` : ""),
  )
}

export async function resolveProductQuarterlyNavRange(product_name: string, beian_hao?: string) {
  return resolveFofWeeklyProductNavRange(product_name, beian_hao)
}

export async function generateProductQuarterlyReport(
  input: ProductQuarterlyReportRequest,
): Promise<ProductQuarterlyReportResult> {
  const product_name = input.product_name.trim()
  const period_begin = input.period_begin.trim()
  const period_end = input.period_end.trim()
  if (!product_name) throw new Error("请选择产品")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period_begin)) throw new Error("请选择有效的持有期开始日期")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period_end)) throw new Error("请选择有效的持有期结束日期")
  if (period_begin > period_end) throw new Error("持有期开始日期不能晚于结束日期")

  const bench1 = resolveFofWeeklyBenchmark(input.bench1_key || PRODUCT_QUARTERLY_DEFAULT_BENCH1)
  const bench2 = resolveFofWeeklyBenchmark(input.bench2_key || PRODUCT_QUARTERLY_DEFAULT_BENCH2)
  const beian_hao = await resolveProductBeianHao(product_name, input.beian_hao)
  const customFund = getCustomFundByCode(beian_hao) ?? findCustomFundByName(product_name)
  const names = customFund
    ? { product_name: customFund.product_name, short_name: "" }
    : await resolveFundNames(beian_hao, product_name)

  const built = await buildFofWeeklyNavCsv(beian_hao, names.product_name, names.short_name, bench2.key, {
    minNavDate: period_end,
  })
  const parsed = parseNavCsv(built.csv)
  if (parsed.dates.length < 2) throw new Error("净值数据为空")

  const earliestNavDate = parsed.dates[0]
  const latestNavDate = parsed.dates[parsed.dates.length - 1]
  if (period_end < earliestNavDate || period_end > latestNavDate) {
    throw new Error(`持有期结束日期需在 ${earliestNavDate} ~ ${latestNavDate} 之间`)
  }
  if (period_begin < earliestNavDate) {
    throw new Error(`持有期开始日期不能早于 ${earliestNavDate}`)
  }
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error("季报生成脚本不存在")
  }

  const bench1ByDate = await loadQuarterlyBenchmark(bench1.key, parsed.dates)
  const dualCsv = buildDualBenchmarkCsv(parsed, bench1.label, bench1ByDate, built.benchLabel || bench2.label)

  const overview = await loadFundOverview(beian_hao, names.product_name)
  const reportId = randomUUID()
  const outDir = reportDir(reportId)
  await mkdir(outDir, { recursive: true })

  const navFile = path.join(outDir, "nav.csv")
  await writeFile(navFile, `\uFEFF${dualCsv}`, "utf8")

  const reportTitle = (input.report_title || names.product_name).trim()
  const brandName = (
    input.brand_name ||
    overview.manager.replace(/私募基金管理有限公司|基金管理有限公司|有限公司/g, "") ||
    "内部资料"
  ).trim()

  const config = {
    product_name: names.product_name,
    short_name: toDisplayShortName(names.short_name, names.product_name),
    brand_name: brandName,
    watermark: (input.watermark || brandName).trim(),
    end_date: period_end,
    period_begin,
    inception_date: overview.inception_date,
    bench1_label: bench1.label,
    bench2_label: built.benchLabel || bench2.label,
    commentary: (input.commentary || "").trim(),
    report_heading: formatQuarterHeading(period_begin, period_end),
    overview: {
      manager: overview.manager,
      investment_manager: overview.investment_manager,
      custodian: overview.custodian,
      inception_date: overview.inception_date,
      product_type: overview.product_type,
      strategy: overview.strategy,
    },
  }

  const configFile = path.join(outDir, "config.json")
  await writeFile(configFile, JSON.stringify(config, null, 2), "utf8")

  const { executable: pythonExe, prefixArgs } = await findPython()
  const args = [...prefixArgs, "-u", SCRIPT_PATH, navFile, "--config", configFile, "-o", outDir]
  const fontEnv =
    existsSync(BUNDLED_CN_FONT) && !process.env.FOF_REPORT_FONT_PATH
      ? { FOF_REPORT_FONT_PATH: BUNDLED_CN_FONT }
      : {}

  try {
    const { stdout, stderr } = await execFileAsync(pythonExe, args, {
      cwd: SCRIPT_DIR,
      env: {
        ...process.env,
        ...fontEnv,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 180_000,
    })
    if (stdout) console.log("[product-quarterly] stdout:", stdout.slice(0, 1000))
    if (stderr) console.warn("[product-quarterly] stderr:", stderr.slice(0, 1000))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const detail = [(err as { stderr?: string }).stderr, (err as { stdout?: string }).stdout]
      .filter(Boolean)
      .join("\n")
      .trim()
    console.error("[product-quarterly] Python failed:", detail || msg)
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
    periodStart: period_begin,
    periodEnd: period_end,
    dataEnd: period_end,
    generatedAt: new Date().toISOString(),
    pngFileName: pngFile,
    pdfFileName: pdfFile,
  }
  await writeFile(path.join(outDir, "meta.json"), JSON.stringify(meta), "utf8")

  return {
    reportId,
    reportTitle,
    periodStart: period_begin,
    periodEnd: period_end,
    dataEnd: period_end,
    pngFileName: pngFile,
    pdfFileName: pdfFile,
  }
}

export async function readProductQuarterlyReportFile(
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

export async function readProductQuarterlyReportPreview(reportId: string): Promise<Buffer> {
  const { buffer } = await readProductQuarterlyReportFile(reportId, "png")
  return buffer
}

export function buildProductQuarterlyDownloadToken(reportId: string, format: "png" | "pdf"): string {
  const secret = process.env.REPORT_DOWNLOAD_SECRET || process.env.DATABASE_URL || "product-quarterly-local"
  return createHash("sha256").update(`${reportId}:${format}:${secret}`).digest("hex").slice(0, 16)
}

export function verifyProductQuarterlyDownloadToken(
  reportId: string,
  format: "png" | "pdf",
  token: string,
): boolean {
  return token === buildProductQuarterlyDownloadToken(reportId, format)
}
