/**
 * Shared official reports for 产品月报 / 产品季报 / 持有期报告.
 * 团队报告 is visible to every logged-in user on any computer.
 */
import { createHash, randomUUID } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"
import { resolveAutoWeeklyTemplate } from "@/lib/ma/auto-weekly-templates"

export type OfficialSharedSection = "monthly" | "quarterly" | "holding"

export type OfficialSharedSource =
  | "fof_monthly_generate"
  | "product_monthly_generate"
  | "fund_official_monthly_generate"
  | "product_quarterly_generate"
  | "fof_weekly_generate"
  | "auto_etl"

export type OfficialSharedFormat = "png" | "pdf" | "pptx"

export type OfficialSharedRecord = {
  id: string
  reportId: string
  section: OfficialSharedSection
  source: OfficialSharedSource
  title: string
  templateId: string
  templateName: string
  typeLabel: string
  product_name: string
  beian_hao: string | null
  periodStart?: string
  periodEnd?: string
  creator: string
  ownerUserId?: string
  createdAt: string
  updatedAt: string
  formats: OfficialSharedFormat[]
}

export type OfficialSharedListItem = OfficialSharedRecord & {
  download: { png?: string; pdf?: string; pptx?: string }
  weekStart?: string
  weekEnd?: string
}

type OfficialIndex = {
  version: 1
  updatedAt: string
  reports: OfficialSharedRecord[]
}

function indexDir(): string {
  return getServerStoragePath("official-shared-reports")
}

function indexPath(): string {
  return path.join(indexDir(), "index.json")
}

function filesDir(reportId: string): string {
  return path.join(indexDir(), "files", reportId)
}

function emptyIndex(): OfficialIndex {
  return { version: 1, updatedAt: new Date().toISOString(), reports: [] }
}

function readIndex(): OfficialIndex {
  mkdirSync(indexDir(), { recursive: true })
  const file = indexPath()
  if (!existsSync(file)) return emptyIndex()
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as OfficialIndex
    if (!parsed || !Array.isArray(parsed.reports)) return emptyIndex()
    return {
      version: 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      reports: parsed.reports,
    }
  } catch {
    return emptyIndex()
  }
}

function writeIndex(index: OfficialIndex): void {
  mkdirSync(indexDir(), { recursive: true })
  index.updatedAt = new Date().toISOString()
  writeFileSync(indexPath(), JSON.stringify(index, null, 2), "utf8")
}

export function buildOfficialSharedDownloadToken(
  reportId: string,
  format: OfficialSharedFormat,
): string {
  const secret = process.env.REPORT_DOWNLOAD_SECRET || process.env.DATABASE_URL || "official-shared-local"
  return createHash("sha256").update(`official:${reportId}:${format}:${secret}`).digest("hex").slice(0, 16)
}

export function verifyOfficialSharedDownloadToken(
  reportId: string,
  format: OfficialSharedFormat,
  token: string,
): boolean {
  return token === buildOfficialSharedDownloadToken(reportId, format)
}

function detectFormats(dir: string): OfficialSharedFormat[] {
  if (!existsSync(dir)) return []
  const names = readdirSync(dir)
  const formats: OfficialSharedFormat[] = []
  if (names.some((name) => name.toLowerCase().endsWith(".png"))) formats.push("png")
  if (names.some((name) => name.toLowerCase().endsWith(".pdf") && !name.toLowerCase().endsWith(".tmp.pdf"))) {
    formats.push("pdf")
  }
  if (names.some((name) => name.toLowerCase().endsWith(".pptx"))) formats.push("pptx")
  return formats
}

function persistFiles(reportId: string, tmpDir: string): OfficialSharedFormat[] {
  if (!existsSync(tmpDir)) {
    throw new Error(`报告临时目录不存在: ${reportId}`)
  }
  const dest = filesDir(reportId)
  mkdirSync(path.dirname(dest), { recursive: true })
  cpSync(tmpDir, dest, { recursive: true })
  return detectFormats(dest)
}

export function registerOfficialSharedReport(input: {
  reportId: string
  section: OfficialSharedSection
  source: OfficialSharedSource
  title: string
  templateId: string
  templateName: string
  typeLabel: string
  product_name?: string
  beian_hao?: string | null
  periodStart?: string
  periodEnd?: string
  tmpDir: string
  ownerUserId?: string | null
  ownerName?: string | null
  formats?: OfficialSharedFormat[]
}): OfficialSharedRecord {
  const formats = persistFiles(input.reportId, input.tmpDir)
  const resolvedFormats = formats.length > 0 ? formats : input.formats || []
  const now = new Date().toISOString()
  const index = readIndex()
  const existing = index.reports.find((row) => row.reportId === input.reportId)
  const record: OfficialSharedRecord = {
    id: existing?.id || randomUUID(),
    reportId: input.reportId,
    section: input.section,
    source: input.source,
    title: (input.title || input.product_name || "未命名报告").trim(),
    templateId: input.templateId,
    templateName: input.templateName,
    typeLabel: input.typeLabel,
    product_name: (input.product_name || input.title || "").trim(),
    beian_hao: (input.beian_hao || "").trim() || null,
    periodStart: input.periodStart || undefined,
    periodEnd: input.periodEnd || input.periodStart || undefined,
    creator: (input.ownerName || existing?.creator || "用户").trim() || "用户",
    ownerUserId: input.ownerUserId || existing?.ownerUserId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    formats: resolvedFormats,
  }
  index.reports = [record, ...index.reports.filter((row) => row.reportId !== input.reportId)]
  writeIndex(index)
  return record
}

export function tryRegisterOfficialSharedReport(
  input: Parameters<typeof registerOfficialSharedReport>[0],
): OfficialSharedRecord | null {
  try {
    return registerOfficialSharedReport(input)
  } catch (err) {
    console.error("[official-shared-reports] register failed:", err)
    return null
  }
}

export function listOfficialSharedReports(
  section: OfficialSharedSection,
  ownerUserId?: string | null,
): OfficialSharedRecord[] {
  const rows = readIndex().reports.filter((row) => row.section === section)
  if (!ownerUserId) return rows
  return rows.filter((row) => row.ownerUserId === ownerUserId)
}

function downloadMap(row: OfficialSharedRecord): OfficialSharedListItem["download"] {
  const download: OfficialSharedListItem["download"] = {}
  for (const format of row.formats) {
    const token = buildOfficialSharedDownloadToken(row.reportId, format)
    download[format] =
      `/ma/api/reports/official/download?id=${encodeURIComponent(row.reportId)}&format=${format}&token=${token}`
  }
  return download
}

export function enrichOfficialSharedListItems(rows: OfficialSharedRecord[]): OfficialSharedListItem[] {
  return rows
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((row) => ({
      ...row,
      weekStart: row.periodStart,
      weekEnd: row.periodEnd,
      download: downloadMap(row),
    }))
}

export function readOfficialSharedReportFile(
  reportId: string,
  format: OfficialSharedFormat,
): { buffer: Buffer; fileName: string; contentType: string } {
  const dir = filesDir(reportId)
  if (!existsSync(dir)) {
    throw new Error("报告文件不存在")
  }
  const names = readdirSync(dir)
  const suffix = `.${format}`
  const fileName =
    names.find((name) => {
      const lower = name.toLowerCase()
      if (format === "pdf") return lower.endsWith(".pdf") && !lower.endsWith(".tmp.pdf")
      return lower.endsWith(suffix)
    }) || null
  if (!fileName) {
    throw new Error("报告文件不存在")
  }
  const contentType =
    format === "png"
      ? "image/png"
      : format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  return {
    buffer: readFileSync(path.join(dir, fileName)),
    fileName,
    contentType,
  }
}

const OWNER_HINT = "owner.json"

export function writeOfficialReportOwnerHint(
  tmpDir: string,
  owner: { userId?: string | null; name?: string | null },
): void {
  try {
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(
      path.join(tmpDir, OWNER_HINT),
      JSON.stringify({
        userId: owner.userId || "",
        name: owner.name || "",
      }),
      "utf8",
    )
  } catch (err) {
    console.error("[official-shared-reports] write owner hint failed:", err)
  }
}

export function readOfficialReportOwnerHint(tmpDir: string): { userId: string; name: string } | null {
  const file = path.join(tmpDir, OWNER_HINT)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { userId?: string; name?: string }
    return { userId: (parsed.userId || "").trim(), name: (parsed.name || "").trim() }
  } catch {
    return null
  }
}

export function fofWeeklyTmpDir(reportId: string): string {
  return path.join(process.cwd(), ".tmp", "fof-weekly-reports", reportId)
}

export function tryRegisterHoldingOfficialReport(
  reportId: string,
  input: {
    product_name?: string
    beian_hao?: string
    week_begin?: string
    week_end?: string
    report_title?: string
    report_variant?: string
    report_kind?: string
  },
  result: { reportId: string; reportTitle: string; weekStart: string; weekEnd: string },
): OfficialSharedRecord | null {
  if ((input.report_kind || "weekly") !== "holding") return null
  const variant = input.report_variant === "holdings" ? "holdings" : "curve"
  const template = resolveAutoWeeklyTemplate(variant === "holdings" ? "weekly-track-holdings" : "weekly-track-curve")
  const tmpDir = fofWeeklyTmpDir(reportId)
  const owner = readOfficialReportOwnerHint(tmpDir)
  return tryRegisterOfficialSharedReport({
    reportId,
    section: "holding",
    source: "fof_weekly_generate",
    title: result.reportTitle || input.report_title || input.product_name || "持有期报告",
    templateId: template.id,
    templateName: template.name,
    typeLabel: "持有期报告",
    product_name: input.product_name,
    beian_hao: input.beian_hao,
    periodStart: result.weekStart || input.week_begin,
    periodEnd: result.weekEnd || input.week_end,
    tmpDir,
    ownerUserId: owner?.userId || null,
    ownerName: owner?.name || null,
    formats: ["png", "pdf"],
  })
}

export const AUTO_OFFICIAL_CREATOR = "系统"

export function fofMonthlyTmpDir(reportId: string): string {
  return path.join(process.cwd(), ".tmp", "fof-monthly-reports", reportId)
}

export function productQuarterlyTmpDir(reportId: string): string {
  return path.join(process.cwd(), ".tmp", "product-quarterly-reports", reportId)
}

function sameOfficialProduct(
  aName: string,
  aBeian: string | null | undefined,
  bName: string,
  bBeian: string | null | undefined,
): boolean {
  const ac = (aBeian || "").trim().toUpperCase()
  const bc = (bBeian || "").trim().toUpperCase()
  if (ac && bc) return ac === bc
  return (aName || "").trim() === (bName || "").trim()
}

export function findOfficialSharedReport(opts: {
  section: OfficialSharedSection
  product_name: string
  beian_hao?: string | null
  templateId: string
  periodEnd?: string | null
  creator?: string
}): OfficialSharedRecord | undefined {
  return readIndex().reports.find((row) => {
    if (row.section !== opts.section) return false
    if (row.templateId !== opts.templateId) return false
    if (opts.creator && row.creator !== opts.creator) return false
    if (!sameOfficialProduct(row.product_name, row.beian_hao, opts.product_name, opts.beian_hao)) {
      return false
    }
    if (opts.periodEnd) return (row.periodEnd || "") === opts.periodEnd
    return true
  })
}

/** Persist a system-generated official report and drop stale auto duplicates. */
export function registerAutoOfficialReport(input: {
  reportId: string
  section: OfficialSharedSection
  source?: OfficialSharedSource
  title: string
  templateId: string
  templateName: string
  typeLabel: string
  product_name: string
  beian_hao?: string | null
  periodStart?: string
  periodEnd?: string
  tmpDir: string
  /** Holding reports keep one current row per product + template. */
  replaceSameProduct?: boolean
}): OfficialSharedRecord {
  const record = registerOfficialSharedReport({
    reportId: input.reportId,
    section: input.section,
    source: input.source || "auto_etl",
    title: input.title,
    templateId: input.templateId,
    templateName: input.templateName,
    typeLabel: input.typeLabel,
    product_name: input.product_name,
    beian_hao: input.beian_hao,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    tmpDir: input.tmpDir,
    ownerUserId: null,
    ownerName: AUTO_OFFICIAL_CREATOR,
    formats: ["png", "pdf"],
  })
  const index = readIndex()
  index.reports = index.reports.filter((row) => {
    if (row.reportId === record.reportId) return true
    if (row.section !== input.section || row.templateId !== input.templateId) return true
    if (row.creator !== AUTO_OFFICIAL_CREATOR) return true
    if (!sameOfficialProduct(row.product_name, row.beian_hao, input.product_name, input.beian_hao)) {
      return true
    }
    if (input.replaceSameProduct) return false
    return (row.periodEnd || "") !== (input.periodEnd || "")
  })
  writeIndex(index)
  return record
}
