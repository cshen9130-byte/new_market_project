import { createHash, randomUUID } from "crypto"
import { execFile } from "child_process"
import { existsSync } from "fs"
import { mkdir, readFile, readdir, writeFile } from "fs/promises"
import path from "path"
import { promisify } from "util"
import { query } from "@/lib/db"
import { findCustomFundByName, getCustomFundByCode } from "@/lib/server/custom-funds"
import {
  buildFofWeeklyNavCsv,
  isValidReportId,
  resolveFofWeeklyProductNavRange,
  resolveProductBeianHao,
} from "@/lib/server/fof-weekly-report"
import { resolveFofWeeklyBenchmark } from "@/lib/server/fof-weekly-benchmark"
import { resolveFundNames } from "@/lib/server/fund-nav-series"
import { getFundValuationAllocation } from "@/lib/server/fund-valuation-allocation"

export { isValidReportId }

const execFileAsync = promisify(execFile)
const REPORT_TMP_ROOT = path.join(process.cwd(), ".tmp", "fund-official-monthly-reports")
const SCRIPT_DIR = path.join(process.cwd(), "fund_official_monthly")
const SCRIPT_PATH = path.join(SCRIPT_DIR, "generate_fund_official_monthly.py")

export type FundOfficialMonthlyReportRequest = {
  product_name: string
  beian_hao?: string
  month_begin?: string
  month_end: string
  report_title?: string
  benchmark_key?: string
  manager_bio?: string
  brand_name?: string
  watermark?: string
  logo_subtitle?: string
  product_type?: string
  strategy?: string
}

export type FundOfficialMonthlyReportResult = {
  reportId: string
  reportTitle: string
  monthStart: string
  monthEnd: string
  dataEnd: string
  pngFileName: string
  pdfFileName: string
}

type AllocItem = { name: string; pct: number }

function reportDir(reportId: string): string {
  return path.join(REPORT_TMP_ROOT, reportId)
}

function getMonthStart(dateStr: string): string {
  const [year, month] = dateStr.split("-")
  return `${year}-${month}-01`
}

function formatInceptionDate(value: string | null | undefined): string {
  if (!value) return "--"
  const m = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return value
  return `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`
}

function classifyMarketBucket(input: {
  exchange?: string | null
  asset_class?: string | null
  row_kind?: string | null
  subject_name?: string | null
  symbol?: string | null
}): string | null {
  const exchange = String(input.exchange ?? "").toUpperCase()
  const assetClass = String(input.asset_class ?? "")
  const kind = String(input.row_kind ?? "")
  const name = String(input.subject_name ?? "")
  const symbol = String(input.symbol ?? "").toUpperCase()

  if (kind === "derivative" || /期货|股指期货|商品期货/.test(assetClass + name)) return "期货"
  if (/HK|HKEX|港交所|港股/.test(exchange + assetClass + name) || /\.HK$/.test(symbol)) return "港股"
  if (/US|NASDAQ|NYSE|美股|美交所/.test(exchange + assetClass + name) || /\.(US|O|N)$/.test(symbol)) return "美股"
  if (kind === "stock" || /股票|A股|沪深|上交所|深交所|SSE|SZSE|SH|SZ/.test(exchange + assetClass + name) || /^\d{6}(\.(SH|SZ))?$/.test(symbol)) {
    return "A股"
  }
  return null
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

  return {
    manager: (pfi?.manager || "").trim() || "--",
    investment_manager: (track?.advisor || bfl?.investment_advisor || "").trim() || "--",
    custodian: (track?.mandator_name || bfl?.custodian || "").trim() || "--",
    inception_date: formatInceptionDate(track?.inception_date || bfl?.inception_date || pfi?.inception_date),
    product_type: (bfl?.fund_type || "私募证券投资基金").trim(),
    strategy: strategyText || "—",
    product_name,
  }
}

async function loadAllocation(beian_hao: string): Promise<{
  asset: AllocItem[]
  industry: AllocItem[]
  industryTitle: string
}> {
  try {
    const result = await getFundValuationAllocation(beian_hao, "major", { includeReturnCurves: false })
    const marketBuckets = new Map<string, number>()

    for (const row of result.stock_holdings ?? []) {
      const pct = Number(row.marketPct ?? 0)
      if (!(pct > 0)) continue
      const bucket = classifyMarketBucket({
        subject_name: row.assetName,
        symbol: row.valuationCode,
        asset_class: row.category,
        row_kind: "stock",
      })
      if (!bucket) continue
      marketBuckets.set(bucket, (marketBuckets.get(bucket) ?? 0) + pct)
    }

    for (const row of result.derivatives ?? []) {
      const pct = Number(row.marketPct ?? 0)
      if (!(pct > 0)) continue
      marketBuckets.set("期货", (marketBuckets.get("期货") ?? 0) + pct)
    }

    const assetFromMajor = (result.allocation ?? [])
      .filter((row) => row.pct > 0.05)
      .map((row) => ({ name: row.category, pct: Number(row.pct.toFixed(2)) }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 6)

    let asset: AllocItem[] = [...marketBuckets.entries()]
      .map(([name, pct]) => ({ name, pct: Number(pct.toFixed(2)) }))
      .sort((a, b) => b.pct - a.pct)

    if (asset.length === 0) asset = assetFromMajor

    const topHoldings = (result.stock_holdings ?? [])
      .filter((row) => Number(row.marketPct ?? 0) > 0 && row.assetName)
      .sort((a, b) => Number(b.marketPct ?? 0) - Number(a.marketPct ?? 0))
      .slice(0, 5)
      .map((row) => ({
        name: String(row.assetName).slice(0, 12),
        pct: Number(Number(row.marketPct).toFixed(2)),
      }))

    const topFunds = (result.fund_holdings ?? [])
      .filter((row) => Number(row.marketPct ?? 0) > 0 && row.fundName)
      .sort((a, b) => Number(b.marketPct ?? 0) - Number(a.marketPct ?? 0))
      .slice(0, 5)
      .map((row) => ({
        name: String(row.fundName).slice(0, 12),
        pct: Number(Number(row.marketPct).toFixed(2)),
      }))

    const sectors = (result.derivative_sector_shares ?? [])
      .filter((row) => Math.abs(row.longMarketPct) > 0.05 || Math.abs(row.shortMarketPct) > 0.05)
      .map((row) => ({
        name: row.sector,
        pct: Number(Math.max(Math.abs(row.longMarketPct), Math.abs(row.shortMarketPct)).toFixed(2)),
      }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5)

    if (topHoldings.length > 0) {
      return { asset, industry: topHoldings, industryTitle: "前五大持仓" }
    }
    if (topFunds.length > 0) {
      return { asset, industry: topFunds, industryTitle: "前五大底层持仓" }
    }
    if (sectors.length > 0) {
      return { asset, industry: sectors, industryTitle: "主要板块暴露" }
    }
    return { asset, industry: [], industryTitle: "前五大行业配置" }
  } catch {
    return { asset: [], industry: [], industryTitle: "前五大行业配置" }
  }
}

async function findPython(): Promise<{ executable: string; prefixArgs: string[] }> {
  const candidates: Array<{ executable: string; prefixArgs: string[] }> = []
  const venvPython =
    process.platform === "win32"
      ? path.join(SCRIPT_DIR, ".venv", "Scripts", "python.exe")
      : path.join(SCRIPT_DIR, ".venv", "bin", "python")
  const haitaiVenv =
    process.platform === "win32"
      ? path.join(process.cwd(), "haitai_week_report", ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), "haitai_week_report", ".venv", "bin", "python")

  if (existsSync(venvPython)) candidates.push({ executable: venvPython, prefixArgs: [] })
  if (existsSync(haitaiVenv)) candidates.push({ executable: haitaiVenv, prefixArgs: [] })
  if (process.platform === "win32") {
    candidates.push({ executable: "py", prefixArgs: ["-3"] })
  } else {
    candidates.push({ executable: "python3", prefixArgs: [] })
  }

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate.executable, [
        ...candidate.prefixArgs,
        "-c",
        "import pandas, matplotlib, numpy",
      ], { timeout: 30_000 })
      return candidate
    } catch {
      continue
    }
  }

  throw new Error("Python 报告依赖未安装，请执行: pip install -r fund_official_monthly/requirements.txt")
}

export async function resolveFundOfficialMonthlyNavRange(
  product_name: string,
  beian_hao?: string,
) {
  return resolveFofWeeklyProductNavRange(product_name, beian_hao)
}

export async function generateFundOfficialMonthlyReport(
  input: FundOfficialMonthlyReportRequest,
): Promise<FundOfficialMonthlyReportResult> {
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

  const overview = await loadFundOverview(beian_hao, names.product_name)
  if (input.product_type?.trim()) overview.product_type = input.product_type.trim()
  if (input.strategy?.trim()) overview.strategy = input.strategy.trim()

  const allocation = await loadAllocation(beian_hao)
  const reportId = randomUUID()
  const outDir = reportDir(reportId)
  await mkdir(outDir, { recursive: true })

  const navFile = path.join(outDir, "nav.csv")
  await writeFile(navFile, `\uFEFF${navCsv}`, "utf8")

  const reportTitle = (input.report_title || names.product_name).trim()
  const brandName = (input.brand_name || overview.manager.replace(/私募基金管理有限公司|基金管理有限公司|有限公司/g, "") || "内部资料").trim()
  const resolvedMonthBegin = month_begin || getMonthStart(month_end)

  const config = {
    product_name: names.product_name,
    short_name: names.short_name || names.product_name,
    brand_name: brandName,
    watermark: (input.watermark || brandName).trim(),
    logo_subtitle: (input.logo_subtitle || "").trim(),
    end_date: month_end,
    month_begin: resolvedMonthBegin,
    inception_date: overview.inception_date,
    benchmark_label: benchLabel,
    manager_bio: (input.manager_bio || "").trim(),
    overview: {
      manager: overview.manager,
      investment_manager: overview.investment_manager,
      custodian: overview.custodian,
      inception_date: overview.inception_date,
      product_type: overview.product_type,
      strategy: overview.strategy,
    },
    asset_allocation: allocation.asset,
    industry_allocation: allocation.industry,
    industry_title: allocation.industryTitle,
  }

  const configFile = path.join(outDir, "config.json")
  await writeFile(configFile, JSON.stringify(config, null, 2), "utf8")

  const { executable: pythonExe, prefixArgs } = await findPython()
  const args = [
    ...prefixArgs,
    "-u",
    SCRIPT_PATH,
    navFile,
    "--config",
    configFile,
    "-o",
    outDir,
  ]

  try {
    const { stdout, stderr } = await execFileAsync(pythonExe, args, {
      cwd: SCRIPT_DIR,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 180_000,
    })
    if (stdout) console.log("[fund-official-monthly] stdout:", stdout.slice(0, 1000))
    if (stderr) console.warn("[fund-official-monthly] stderr:", stderr.slice(0, 1000))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const detail = [(err as { stderr?: string }).stderr, (err as { stdout?: string }).stdout]
      .filter(Boolean)
      .join("\n")
      .trim()
    console.error("[fund-official-monthly] Python failed:", detail || msg)
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

export async function readFundOfficialMonthlyReportFile(
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

export async function readFundOfficialMonthlyReportPreview(reportId: string): Promise<Buffer> {
  const { buffer } = await readFundOfficialMonthlyReportFile(reportId, "png")
  return buffer
}

export function buildFundOfficialMonthlyDownloadToken(reportId: string, format: "png" | "pdf"): string {
  const secret = process.env.REPORT_DOWNLOAD_SECRET || process.env.DATABASE_URL || "fund-official-monthly-local"
  return createHash("sha256").update(`${reportId}:${format}:${secret}`).digest("hex").slice(0, 16)
}

export function verifyFundOfficialMonthlyDownloadToken(
  reportId: string,
  format: "png" | "pdf",
  token: string,
): boolean {
  return token === buildFundOfficialMonthlyDownloadToken(reportId, format)
}
