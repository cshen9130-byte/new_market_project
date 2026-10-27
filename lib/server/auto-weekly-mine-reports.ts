/**
 * Per-user auto weekly reports for 报告 → 我的报告.
 * Same generation / week / NAV / gap logic as team 系统周报; storage is user-scoped.
 */

import { randomUUID } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs"
import path from "path"
import {
  AUTO_WEEKLY_TEMPLATE_ID,
  AUTO_WEEKLY_TEMPLATE_NAME,
  autoWeeklyProductKey,
  enrichAutoWeeklyListItem,
  lookupAutoWeeklyTitleNames,
  lookupProductLatestNavDate,
  persistAutoWeeklyReportFiles,
  type AutoWeeklyEtlItem,
  type AutoWeeklyEtlResult,
  type AutoWeeklyListItem,
  type AutoWeeklyReportRecord,
  type AutoWeeklyTargetProduct,
} from "@/lib/server/auto-weekly-reports"
import { resolveLatestAvailableDataWeek } from "@/lib/server/auto-weekly-report-week"
import {
  generateFofWeeklyReport,
  resolveFofWeeklyProductNavRange,
  resolveProductBeianHao,
} from "@/lib/server/fof-weekly-report"
import { getCustomFundByCode, listAllCustomFundRecords } from "@/lib/server/custom-funds"
import { getServerStoragePath } from "@/lib/server/storage"

export const MINE_WEEKLY_TYPE_LABEL = "我的周报"

export type MineWeeklyProduct = {
  product_name: string
  beian_hao: string | null
  addedAt: string
}

type MineProductsFile = {
  version: 1
  updatedAt: string
  products: MineWeeklyProduct[]
}

type MineIndex = {
  version: 1
  updatedAt: string
  reports: AutoWeeklyReportRecord[]
}

function sanitizeUserId(userId: string): string {
  const id = (userId || "").trim()
  if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) {
    throw new Error("无效的用户 ID")
  }
  return id
}

function mineRoot(userId: string): string {
  return getServerStoragePath("auto-weekly-reports", "mine", sanitizeUserId(userId))
}

function productsPath(userId: string): string {
  return path.join(mineRoot(userId), "products.json")
}

function indexPath(userId: string): string {
  return path.join(mineRoot(userId), "index.json")
}

function emptyProducts(): MineProductsFile {
  return { version: 1, updatedAt: new Date().toISOString(), products: [] }
}

function emptyIndex(): MineIndex {
  return { version: 1, updatedAt: new Date().toISOString(), reports: [] }
}

function readProducts(userId: string): MineProductsFile {
  mkdirSync(mineRoot(userId), { recursive: true })
  const file = productsPath(userId)
  if (!existsSync(file)) return emptyProducts()
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as MineProductsFile
    if (!parsed || !Array.isArray(parsed.products)) return emptyProducts()
    return {
      version: 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      products: parsed.products,
    }
  } catch {
    return emptyProducts()
  }
}

function writeProducts(userId: string, data: MineProductsFile): void {
  mkdirSync(mineRoot(userId), { recursive: true })
  data.updatedAt = new Date().toISOString()
  writeFileSync(productsPath(userId), JSON.stringify(data, null, 2), "utf8")
}

function readIndex(userId: string): MineIndex {
  mkdirSync(mineRoot(userId), { recursive: true })
  const file = indexPath(userId)
  if (!existsSync(file)) return emptyIndex()
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as MineIndex
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

function writeIndex(userId: string, index: MineIndex): void {
  mkdirSync(mineRoot(userId), { recursive: true })
  index.updatedAt = new Date().toISOString()
  writeFileSync(indexPath(userId), JSON.stringify(index, null, 2), "utf8")
}

function dedupeKey(product_name: string, beian_hao: string | null | undefined, weekEnd: string): string {
  return `${autoWeeklyProductKey(product_name, beian_hao)}::${weekEnd}`
}

function upsertRecord(userId: string, record: AutoWeeklyReportRecord): void {
  const index = readIndex(userId)
  const key = dedupeKey(record.product_name, record.beian_hao, record.weekEnd)
  const next = index.reports.filter(
    (r) => dedupeKey(r.product_name, r.beian_hao, r.weekEnd) !== key,
  )
  next.unshift(record)
  writeIndex(userId, { version: 1, updatedAt: new Date().toISOString(), reports: next })
}

export function listMineWeeklyProducts(userId: string): MineWeeklyProduct[] {
  return readProducts(userId).products.slice().sort((a, b) =>
    a.product_name.localeCompare(b.product_name, "zh"),
  )
}

export function addMineWeeklyProduct(
  userId: string,
  product: { product_name: string; beian_hao?: string | null },
): MineWeeklyProduct {
  const product_name = (product.product_name || "").trim()
  if (!product_name) throw new Error("产品名称不能为空")
  const beian_hao = (product.beian_hao || "").trim() || null
  const data = readProducts(userId)
  const key = autoWeeklyProductKey(product_name, beian_hao)
  const existing = data.products.find(
    (p) => autoWeeklyProductKey(p.product_name, p.beian_hao) === key,
  )
  if (existing) return existing
  const row: MineWeeklyProduct = {
    product_name,
    beian_hao,
    addedAt: new Date().toISOString(),
  }
  data.products.push(row)
  writeProducts(userId, data)
  return row
}

export function removeMineWeeklyProduct(
  userId: string,
  product: { product_name: string; beian_hao?: string | null },
): boolean {
  const product_name = (product.product_name || "").trim()
  const beian_hao = (product.beian_hao || "").trim() || null
  const key = autoWeeklyProductKey(product_name, beian_hao)
  const data = readProducts(userId)
  const before = data.products.length
  data.products = data.products.filter(
    (p) => autoWeeklyProductKey(p.product_name, p.beian_hao) !== key,
  )
  if (data.products.length === before) return false
  writeProducts(userId, data)
  return true
}

export function listMineWeeklyReports(userId: string): AutoWeeklyReportRecord[] {
  return readIndex(userId).reports.slice().sort((a, b) => {
    if (a.weekEnd !== b.weekEnd) return b.weekEnd.localeCompare(a.weekEnd)
    return a.product_name.localeCompare(b.product_name, "zh")
  })
}

export async function enrichMineWeeklyListItems(
  userId: string,
): Promise<AutoWeeklyListItem[]> {
  const rows = listMineWeeklyReports(userId)
  const nameMap = await lookupAutoWeeklyTitleNames(rows)
  return Promise.all(
    rows.map(async (row) => {
      const live = await lookupProductLatestNavDate(row.product_name, row.beian_hao)
      const code = (row.beian_hao || "").trim().toUpperCase()
      const key = code ? `beian:${code}` : `name:${(row.product_name || "").trim()}`
      return enrichAutoWeeklyListItem(row, live, nameMap.get(key) ?? null)
    }),
  )
}

export async function ensureMineWeeklyReportForProduct(
  userId: string,
  product: AutoWeeklyTargetProduct,
  creatorName: string,
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
    const displayName = custom?.product_name || product_name

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

    const existing = readIndex(userId).reports.find(
      (r) =>
        dedupeKey(r.product_name, r.beian_hao, r.weekEnd) ===
        dedupeKey(displayName, range.beian_hao || beian, week.weekEnd),
    )
    if (existing) {
      const liveNav = range.latest_nav_date || null
      if (liveNav && liveNav !== existing.latestNavDate) {
        upsertRecord(userId, {
          ...existing,
          latestNavDate: liveNav,
          updatedAt: new Date().toISOString(),
        })
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

    persistAutoWeeklyReportFiles(result.reportId)

    const now = new Date().toISOString()
    const record: AutoWeeklyReportRecord = {
      id: `mwr_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      reportId: result.reportId,
      product_name: displayName,
      beian_hao: range.beian_hao || beian,
      weekStart: result.weekStart || week.weekStart,
      weekEnd: result.weekEnd || week.weekEnd,
      latestNavDate: range.latest_nav_date || null,
      title: result.reportTitle || title,
      templateId: AUTO_WEEKLY_TEMPLATE_ID,
      templateName: AUTO_WEEKLY_TEMPLATE_NAME,
      creator: creatorName || "我",
      type: "mine_weekly",
      typeLabel: MINE_WEEKLY_TYPE_LABEL,
      createdAt: now,
      updatedAt: now,
      source: "mine",
      ownerUserId: sanitizeUserId(userId),
    }
    upsertRecord(userId, record)

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

export async function runMineWeeklyReportsEtl(
  userId: string,
  creatorName: string,
  options?: { productNames?: string[] },
): Promise<AutoWeeklyEtlResult> {
  let products = listMineWeeklyProducts(userId).map(
    (p): AutoWeeklyTargetProduct => ({
      product_name: p.product_name,
      beian_hao: p.beian_hao,
      source: "mine",
    }),
  )
  if (options?.productNames?.length) {
    const want = new Set(options.productNames.map((n) => n.trim()).filter(Boolean))
    products = products.filter((p) => want.has(p.product_name))
  }

  const items: AutoWeeklyEtlItem[] = []
  for (const product of products) {
    const item = await ensureMineWeeklyReportForProduct(userId, product, creatorName)
    items.push(item)
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

/** Add product and immediately try to generate its latest available week report. */
export async function addMineWeeklyProductAndGenerate(
  userId: string,
  creatorName: string,
  product: { product_name: string; beian_hao?: string | null },
): Promise<{ product: MineWeeklyProduct; etl: AutoWeeklyEtlItem }> {
  const row = addMineWeeklyProduct(userId, product)
  const etl = await ensureMineWeeklyReportForProduct(
    userId,
    { product_name: row.product_name, beian_hao: row.beian_hao, source: "mine" },
    creatorName,
  )
  return { product: row, etl }
}

export function listMineWeeklyOwnerUserIds(): string[] {
  const root = getServerStoragePath("auto-weekly-reports", "mine")
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-zA-Z0-9_-]{1,80}$/.test(d.name))
    .map((d) => d.name)
}
