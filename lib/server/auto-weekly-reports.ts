/**
 * System-generated weekly product reports shown in 报告 → 我的报告.
 * Reuses FOF weekly generator; persists an index + file copies for download.
 */

import { randomUUID } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "fs"
import path from "path"
import { query } from "@/lib/db"
import {
  buildReportDownloadToken,
  generateFofWeeklyReport,
  resolveFofWeeklyProductNavRange,
  resolveProductBeianHao,
} from "@/lib/server/fof-weekly-report"
import {
  daysBehindNextWeeklyReport,
  resolveLatestAvailableDataWeek,
} from "@/lib/server/auto-weekly-report-week"
import {
  findCustomFundByName,
  getCustomFundByCode,
  listAllCustomFundRecords,
} from "@/lib/server/custom-funds"
import { getServerStoragePath } from "@/lib/server/storage"

export const AUTO_WEEKLY_TEMPLATE_ID = "weekly-track-curve"
export const AUTO_WEEKLY_TEMPLATE_NAME = "跟踪产品（通用曲线版）"
export const AUTO_WEEKLY_CREATOR = "系统"
export const AUTO_WEEKLY_TYPE_LABEL = "系统周报"

/** Extra products beyond 在管产品 (custom / strategy history series). */
export const AUTO_WEEKLY_EXTRA_PRODUCT_NAMES = [
  "荣熙共赢同策略",
  "金舆追风同策略历史净值",
  "金舆锡泰同策略历史净值",
] as const

export type AutoWeeklyReportRecord = {
  id: string
  /** FOF weekly report job / file id (uuid). */
  reportId: string
  product_name: string
  beian_hao: string | null
  weekStart: string
  weekEnd: string
  /** Latest product NAV date in Postgres (may be after report weekEnd). */
  latestNavDate?: string | null
  title: string
  templateId: string
  templateName: string
  creator: string
  type: "system_weekly" | "mine_weekly"
  typeLabel: string
  createdAt: string
  updatedAt: string
  source: "managed" | "extra" | "mine"
  /** Set for 我的报告 rows. */
  ownerUserId?: string
}

export type AutoWeeklyListItem = AutoWeeklyReportRecord & {
  /** CN trading days still needed to unlock the next week report. */
  navDaysBehindNextWeek: number | null
  download: { png: string; pdf: string }
  /** True for 自建基金 / extra strategy series (not 在管产品). */
  isCustomFund: boolean
  /**
   * Metadata short / display name when present (e.g. private_fund_info_bfl.short_name).
   * Null when only one name form exists in metadata.
   */
  short_name: string | null
  /**
   * Metadata full / legal fund name when present (e.g. AMAC fund_name / product_name).
   * Null when only one name form exists in metadata.
   */
  full_name: string | null
}

type AutoWeeklyIndex = {
  version: 1
  updatedAt: string
  reports: AutoWeeklyReportRecord[]
}

export type AutoWeeklyTargetProduct = {
  product_name: string
  beian_hao: string | null
  source: "managed" | "extra" | "mine"
}

export type AutoWeeklyEtlItem = {
  product_name: string
  beian_hao: string | null
  status: "created" | "exists" | "skipped" | "failed"
  weekStart?: string
  weekEnd?: string
  reportId?: string
  error?: string
}

export type AutoWeeklyEtlResult = {
  ok: boolean
  created: number
  existed: number
  skipped: number
  failed: number
  items: AutoWeeklyEtlItem[]
}

function indexDir(): string {
  return getServerStoragePath("auto-weekly-reports")
}

function indexPath(): string {
  return path.join(indexDir(), "index.json")
}

function filesDir(reportId: string): string {
  return path.join(indexDir(), "files", reportId)
}

function fofWeeklyTmpDir(reportId: string): string {
  return path.join(process.cwd(), ".tmp", "fof-weekly-reports", reportId)
}

function emptyIndex(): AutoWeeklyIndex {
  return { version: 1, updatedAt: new Date().toISOString(), reports: [] }
}

function readIndex(): AutoWeeklyIndex {
  mkdirSync(indexDir(), { recursive: true })
  const file = indexPath()
  if (!existsSync(file)) return emptyIndex()
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as AutoWeeklyIndex
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

function writeIndex(index: AutoWeeklyIndex): void {
  mkdirSync(indexDir(), { recursive: true })
  index.updatedAt = new Date().toISOString()
  writeFileSync(indexPath(), JSON.stringify(index, null, 2), "utf8")
}

export function autoWeeklyProductKey(product_name: string, beian_hao: string | null | undefined): string {
  return productKey(product_name, beian_hao)
}

function productKey(product_name: string, beian_hao: string | null | undefined): string {
  const code = (beian_hao || "").trim().toUpperCase()
  if (code) return `code:${code}`
  return `name:${product_name.trim()}`
}

function dedupeKey(product_name: string, beian_hao: string | null | undefined, weekEnd: string): string {
  return `${productKey(product_name, beian_hao)}::${weekEnd}`
}

export function persistAutoWeeklyReportFiles(reportId: string): void {
  persistReportFiles(reportId)
}

function persistReportFiles(reportId: string): void {
  const src = fofWeeklyTmpDir(reportId)
  if (!existsSync(src)) {
    throw new Error(`报告临时目录不存在: ${reportId}`)
  }
  const dest = filesDir(reportId)
  mkdirSync(path.dirname(dest), { recursive: true })
  cpSync(src, dest, { recursive: true })
}

export function listAutoWeeklyReports(): AutoWeeklyReportRecord[] {
  return readIndex().reports.slice().sort((a, b) => {
    if (a.weekEnd !== b.weekEnd) return b.weekEnd.localeCompare(a.weekEnd)
    return a.product_name.localeCompare(b.product_name, "zh")
  })
}

export function findAutoWeeklyReport(id: string): AutoWeeklyReportRecord | null {
  return readIndex().reports.find((r) => r.id === id || r.reportId === id) ?? null
}

/**
 * Latest NAV date from Postgres for the product — not report weekEnd.
 * May be after weekEnd when the next Mon–Fri week is still incomplete.
 */
export async function lookupProductLatestNavDate(
  product_name: string,
  beian_hao?: string | null,
): Promise<string | null> {
  try {
    const range = await resolveFofWeeklyProductNavRange(product_name, beian_hao || undefined)
    return range.latest_nav_date?.trim() || null
  } catch {
    return null
  }
}


/** 自建基金 / 系统周报 extras（相对在管产品）. */
export function isAutoWeeklyCustomFund(
  row: Pick<AutoWeeklyReportRecord, "source" | "beian_hao" | "product_name">,
): boolean {
  if (row.source === "extra") return true
  const name = (row.product_name || "").trim()
  if (
    name &&
    (AUTO_WEEKLY_EXTRA_PRODUCT_NAMES as readonly string[]).includes(name)
  ) {
    return true
  }
  const code = (row.beian_hao || "").trim()
  if (code && getCustomFundByCode(code)) return true
  if (name && findCustomFundByName(name)) return true
  return false
}

function reportNameLookupKey(row: {
  product_name: string
  beian_hao: string | null
}): string {
  const code = (row.beian_hao || "").trim().toUpperCase()
  if (code) return `beian:${code}`
  return `name:${(row.product_name || "").trim()}`
}

/**
 * Batch-load short vs full fund names from existing product metadata.
 * Does not invent names by stripping legal suffixes — only reuses stored fields.
 */
export async function lookupAutoWeeklyTitleNames(
  rows: Array<{ product_name: string; beian_hao: string | null }>,
): Promise<Map<string, { short_name: string | null; full_name: string | null }>> {
  const out = new Map<string, { short_name: string | null; full_name: string | null }>()
  const codes = [
    ...new Set(
      rows
        .map((r) => (r.beian_hao || "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ]
  if (codes.length === 0) return out

  type NameRow = {
    code: string
    product_name: string | null
    short_name: string | null
    pri: number
  }

  const meta = await query<NameRow>(
    `SELECT code, product_name, short_name, pri FROM (
       SELECT UPPER(BTRIM(beian_hao)) AS code,
              NULLIF(BTRIM(product_name), '') AS product_name,
              NULLIF(BTRIM(short_name), '') AS short_name,
              0 AS pri
       FROM private_fund_info_bfl
       WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])
       UNION ALL
       SELECT UPPER(BTRIM(beian_hao)),
              NULLIF(BTRIM(product_name), ''),
              NULLIF(BTRIM(short_name), ''),
              1
       FROM ops_managed_products_list_cache
       WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])
       UNION ALL
       SELECT UPPER(BTRIM(register_number)),
              NULLIF(BTRIM(fund_name), ''),
              NULLIF(BTRIM(fund_short_name), ''),
              2
       FROM type6_ops_team_full
       WHERE UPPER(BTRIM(register_number)) = ANY($1::text[])
       UNION ALL
       SELECT UPPER(BTRIM(beian_hao)),
              NULLIF(BTRIM(product_name), ''),
              NULL,
              3
       FROM private_fund_info
       WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])
       UNION ALL
       SELECT UPPER(BTRIM(fund_no)),
              NULLIF(BTRIM(fund_name), ''),
              NULL,
              4
       FROM amac_private_funds
       WHERE UPPER(BTRIM(fund_no)) = ANY($1::text[])
     ) t
     ORDER BY pri ASC`,
    [codes],
  ).catch(() => [] as NameRow[])

  const byCode = new Map<string, { short_name: string | null; full_name: string | null }>()
  for (const row of meta) {
    const code = (row.code || "").trim().toUpperCase()
    if (!code) continue
    const prev = byCode.get(code) ?? { short_name: null, full_name: null }
    const product = (row.product_name || "").trim() || null
    const short = (row.short_name || "").trim() || null
    // short_name: prefer earlier sources (bfl / cache / type6).
    if (!prev.short_name && short && short !== product) prev.short_name = short
    if (!prev.short_name && short) prev.short_name = short
    // full_name: prefer later official sources (private_fund_info / AMAC) over catalog labels.
    // pri 3-4 overwrite; pri 0-2 only fill when empty.
    if (product) {
      if (row.pri >= 3 || !prev.full_name) prev.full_name = product
    }
    byCode.set(code, prev)
  }

  for (const row of rows) {
    const key = reportNameLookupKey(row)
    const code = (row.beian_hao || "").trim().toUpperCase()
    if (!code) continue
    const names = byCode.get(code)
    if (!names) continue
    let short_name = names.short_name
    let full_name = names.full_name
    // If metadata only has one form, leave the other null so UI shows the same for both modes.
    if (short_name && full_name && short_name === full_name) {
      short_name = null
    }
    out.set(key, { short_name, full_name })
  }
  return out
}

export function enrichAutoWeeklyListItem(
  row: AutoWeeklyReportRecord,
  latestNavDate?: string | null,
  names?: { short_name: string | null; full_name: string | null } | null,
): AutoWeeklyListItem {
  const liveNav = (latestNavDate ?? row.latestNavDate ?? null) || null
  return {
    ...row,
    latestNavDate: liveNav,
    navDaysBehindNextWeek: daysBehindNextWeeklyReport(liveNav),
    isCustomFund: isAutoWeeklyCustomFund(row),
    short_name: names?.short_name ?? null,
    full_name: names?.full_name ?? null,
    download: {
      png: `/ma/api/reports/auto-weekly/download?id=${encodeURIComponent(row.reportId)}&format=png&token=${buildReportDownloadToken(row.reportId, "png")}`,
      pdf: `/ma/api/reports/auto-weekly/download?id=${encodeURIComponent(row.reportId)}&format=pdf&token=${buildReportDownloadToken(row.reportId, "pdf")}`,
    },
  }
}

/** Attach live Postgres latest NAV dates + short/full title names for list responses. */
export async function enrichAutoWeeklyListItems(
  rows: AutoWeeklyReportRecord[],
): Promise<AutoWeeklyListItem[]> {
  const nameMap = await lookupAutoWeeklyTitleNames(rows)
  return Promise.all(
    rows.map(async (row) => {
      const live = await lookupProductLatestNavDate(row.product_name, row.beian_hao)
      return enrichAutoWeeklyListItem(row, live, nameMap.get(reportNameLookupKey(row)) ?? null)
    }),
  )
}


export async function listManagedProductsForAutoWeekly(): Promise<AutoWeeklyTargetProduct[]> {
  const rows = await query<{ product_name: string; beian_hao: string | null }>(
    `SELECT m.product_name,
            NULLIF(BTRIM(cache.beian_hao), '') AS beian_hao
     FROM managed_products m
     LEFT JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
     WHERE m.product_name <> '合计'
     ORDER BY m.sequence_no ASC NULLS LAST, m.product_name ASC`,
  ).catch(() => [] as { product_name: string; beian_hao: string | null }[])

  return rows
    .filter((r) => r.product_name?.trim())
    .map((r) => ({
      product_name: r.product_name.trim(),
      beian_hao: r.beian_hao?.trim() || null,
      source: "managed" as const,
    }))
}

/** Fixed product_code for extras when custom-fund display names diverge. */
const AUTO_WEEKLY_EXTRA_PRODUCT_CODES: Readonly<Record<string, string>> = {
  荣熙共赢同策略: "380004",
  金舆追风同策略历史净值: "380003",
  金舆锡泰同策略历史净值: "380001",
}

function resolveExtraProduct(name: string): AutoWeeklyTargetProduct | null {
  const trimmed = name.trim()
  if (!trimmed) return null

  const mappedCode = AUTO_WEEKLY_EXTRA_PRODUCT_CODES[trimmed]
  if (mappedCode) {
    const byCode = getCustomFundByCode(mappedCode)
    return {
      product_name: trimmed,
      beian_hao: byCode?.product_code || mappedCode,
      source: "extra",
    }
  }

  const byName = findCustomFundByName(trimmed)
  if (byName) {
    return {
      product_name: byName.product_name,
      beian_hao: byName.product_code,
      source: "extra",
    }
  }
  // Soft match: custom fund whose name contains the requested label.
  const soft = listAllCustomFundRecords().find(
    (f) => f.product_name.includes(trimmed) || trimmed.includes(f.product_name),
  )
  if (soft) {
    return {
      product_name: soft.product_name,
      beian_hao: soft.product_code,
      source: "extra",
    }
  }
  return {
    product_name: trimmed,
    beian_hao: null,
    source: "extra",
  }
}

export async function listAutoWeeklyTargetProducts(): Promise<AutoWeeklyTargetProduct[]> {
  const managed = await listManagedProductsForAutoWeekly()
  const byKey = new Map<string, AutoWeeklyTargetProduct>()
  for (const row of managed) {
    byKey.set(productKey(row.product_name, row.beian_hao), row)
  }
  for (const name of AUTO_WEEKLY_EXTRA_PRODUCT_NAMES) {
    const extra = resolveExtraProduct(name)
    if (!extra) continue
    const key = productKey(extra.product_name, extra.beian_hao)
    if (!byKey.has(key)) byKey.set(key, extra)
  }
  return [...byKey.values()]
}

function upsertRecord(record: AutoWeeklyReportRecord): void {
  const index = readIndex()
  const key = dedupeKey(record.product_name, record.beian_hao, record.weekEnd)
  const next = index.reports.filter(
    (r) => dedupeKey(r.product_name, r.beian_hao, r.weekEnd) !== key,
  )
  next.unshift(record)
  writeIndex({ version: 1, updatedAt: new Date().toISOString(), reports: next })
}

export async function ensureAutoWeeklyReportForProduct(
  product: AutoWeeklyTargetProduct,
): Promise<AutoWeeklyEtlItem> {
  const product_name = product.product_name.trim()
  if (!product_name) {
    return { product_name: "", beian_hao: null, status: "skipped", error: "empty_name" }
  }

  try {
    let beian = product.beian_hao?.trim() || null
    try {
      beian = await resolveProductBeianHao(product_name, beian || undefined)
    } catch (err) {
      return {
        product_name,
        beian_hao: beian,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }
    }

    const custom = beian
      ? getCustomFundByCode(beian)
      : listAllCustomFundRecords().find((f) => f.product_name.trim() === product_name) ?? null
    // Extras keep the requested label (custom rows may have placeholder names like "test").
    const displayName =
      product.source === "extra"
        ? product_name
        : (custom?.product_name || product_name)

    const range = await resolveFofWeeklyProductNavRange(displayName, beian || undefined)
    if (!range.latest_nav_date) {
      return {
        product_name: displayName,
        beian_hao: range.beian_hao || beian,
        status: "skipped",
        error: "no_nav",
      }
    }

    const week = resolveLatestAvailableDataWeek(range.latest_nav_date)
    if (!week) {
      return {
        product_name: displayName,
        beian_hao: range.beian_hao || beian,
        status: "skipped",
        error: "no_week",
      }
    }

    const existing = readIndex().reports.find(
      (r) => dedupeKey(r.product_name, r.beian_hao, r.weekEnd) ===
        dedupeKey(displayName, range.beian_hao || beian, week.weekEnd),
    )
    if (existing) {
      const liveNav = range.latest_nav_date || null
      if (liveNav && liveNav !== existing.latestNavDate) {
        upsertRecord({ ...existing, latestNavDate: liveNav, updatedAt: new Date().toISOString() })
      }
      return {
        product_name: displayName,
        beian_hao: range.beian_hao || beian,
        status: "exists",
        weekStart: existing.weekStart,
        weekEnd: existing.weekEnd,
        reportId: existing.reportId,
      }
    }

    const title = displayName
    const result = await generateFofWeeklyReport({
      product_name: displayName,
      beian_hao: range.beian_hao || beian || undefined,
      week_begin: week.weekStart,
      week_end: week.weekEnd,
      report_title: title,
      benchmark_key: "IF",
      nav_frequency: "weekly",
    })

    persistReportFiles(result.reportId)

    const now = new Date().toISOString()
    const record: AutoWeeklyReportRecord = {
      id: `awr_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      reportId: result.reportId,
      product_name: displayName,
      beian_hao: range.beian_hao || beian,
      weekStart: result.weekStart || week.weekStart,
      weekEnd: result.weekEnd || week.weekEnd,
      latestNavDate: range.latest_nav_date || null,
      title: result.reportTitle || title,
      templateId: AUTO_WEEKLY_TEMPLATE_ID,
      templateName: AUTO_WEEKLY_TEMPLATE_NAME,
      creator: AUTO_WEEKLY_CREATOR,
      type: "system_weekly",
      typeLabel: AUTO_WEEKLY_TYPE_LABEL,
      createdAt: now,
      updatedAt: now,
      source: product.source,
    }
    upsertRecord(record)

    return {
      product_name: displayName,
      beian_hao: record.beian_hao,
      status: "created",
      weekStart: record.weekStart,
      weekEnd: record.weekEnd,
      reportId: record.reportId,
    }
  } catch (err) {
    return {
      product_name,
      beian_hao: product.beian_hao,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function runAutoWeeklyReportsEtl(options?: {
  limit?: number
  productNames?: string[]
}): Promise<AutoWeeklyEtlResult> {
  let products = await listAutoWeeklyTargetProducts()
  if (options?.productNames?.length) {
    const want = new Set(options.productNames.map((n) => n.trim()).filter(Boolean))
    products = products.filter((p) => want.has(p.product_name))
  }
  if (options?.limit && options.limit > 0) {
    products = products.slice(0, options.limit)
  }

  const items: AutoWeeklyEtlItem[] = []
  for (const product of products) {
    const item = await ensureAutoWeeklyReportForProduct(product)
    items.push(item)
    const tag = item.status === "failed" ? "error" : "log"
    const msg =
      `[auto-weekly-etl] ${item.status} ${item.product_name}` +
      (item.weekEnd ? ` week=${item.weekStart}..${item.weekEnd}` : "") +
      (item.error ? ` err=${item.error}` : "")
    if (tag === "error") console.error(msg)
    else console.log(msg)
  }

  return {
    ok: items.every((i) => i.status !== "failed"),
    created: items.filter((i) => i.status === "created").length,
    existed: items.filter((i) => i.status === "exists").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    failed: items.filter((i) => i.status === "failed").length,
    items,
  }
}

export function readAutoWeeklyReportFile(
  reportId: string,
  format: "png" | "pdf",
): { buffer: Buffer; fileName: string; contentType: string } {
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) {
    throw new Error("无效的报告 ID")
  }

  const candidates = [filesDir(reportId), fofWeeklyTmpDir(reportId)]
  let dir: string | null = null
  for (const c of candidates) {
    if (existsSync(path.join(c, "meta.json"))) {
      dir = c
      break
    }
  }
  if (!dir) throw new Error("报告不存在或已过期")

  const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as {
    pngFileName?: string
    pdfFileName?: string
  }
  const fileName = format === "png" ? meta.pngFileName : meta.pdfFileName
  if (!fileName) throw new Error("报告文件不存在")
  const filePath = path.join(dir, fileName)
  if (!existsSync(filePath)) throw new Error("报告文件不存在")

  return {
    buffer: readFileSync(filePath),
    fileName,
    contentType: format === "png" ? "image/png" : "application/pdf",
  }
}
