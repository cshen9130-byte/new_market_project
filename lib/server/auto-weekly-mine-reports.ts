/**
 * Per-user auto weekly reports for 报告 → 我的报告.
 * Same generation / week / NAV / gap logic as team 系统周报; storage is user-scoped.
 */

import { randomUUID } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs"
import path from "path"
import {
  autoWeeklyProductKey,
  autoWeeklyReportDedupeKey,
  enrichAutoWeeklyListItem,
  listAutoWeeklyReports,
  listAutoWeeklyTargetProducts,
  lookupAutoWeeklyTitleNames,
  persistAutoWeeklyReportFiles,
  pickPreferredAutoWeeklyReports,
  type AutoWeeklyEtlItem,
  type AutoWeeklyEtlResult,
  type AutoWeeklyListItem,
  type AutoWeeklyReportRecord,
  type AutoWeeklyTargetProduct,
} from "@/lib/server/auto-weekly-reports"
import {
  AUTO_WEEKLY_TEMPLATE_OPTIONS,
  isAutoWeeklyTemplateId,
  resolveAutoWeeklyTemplate,
} from "@/lib/ma/auto-weekly-templates"
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
  /** Weekly template used for future auto-generated 我的报告. Defaults to curve. */
  templateId?: string
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

function dedupeKey(
  product_name: string,
  beian_hao: string | null | undefined,
  weekEnd: string,
  templateId?: string | null,
): string {
  return autoWeeklyReportDedupeKey(product_name, beian_hao, weekEnd, templateId)
}

function upsertRecord(userId: string, record: AutoWeeklyReportRecord): void {
  const index = readIndex(userId)
  const key = dedupeKey(record.product_name, record.beian_hao, record.weekEnd, record.templateId)
  const next = index.reports.filter(
    (r) => dedupeKey(r.product_name, r.beian_hao, r.weekEnd, r.templateId) !== key,
  )
  next.unshift(record)
  writeIndex(userId, { version: 1, updatedAt: new Date().toISOString(), reports: next })
}

export function listMineWeeklyProducts(userId: string): MineWeeklyProduct[] {
  return readProducts(userId)
    .products.map((row) => {
      const template = resolveAutoWeeklyTemplate(row.templateId)
      return {
        ...row,
        templateId: template.id,
      }
    })
    .slice()
    .sort((a, b) => a.product_name.localeCompare(b.product_name, "zh"))
}

export function addMineWeeklyProduct(
  userId: string,
  product: { product_name: string; beian_hao?: string | null; templateId?: string | null },
): MineWeeklyProduct {
  const product_name = (product.product_name || "").trim()
  if (!product_name) throw new Error("产品名称不能为空")
  const beian_hao = (product.beian_hao || "").trim() || null
  const template = resolveAutoWeeklyTemplate(product.templateId)
  const data = readProducts(userId)
  const key = autoWeeklyProductKey(product_name, beian_hao)
  const existing = data.products.find(
    (p) => autoWeeklyProductKey(p.product_name, p.beian_hao) === key,
  )
  if (existing) {
    if (product.templateId && existing.templateId !== template.id) {
      existing.templateId = template.id
      writeProducts(userId, data)
    }
    return {
      ...existing,
      templateId: resolveAutoWeeklyTemplate(existing.templateId).id,
    }
  }
  const row: MineWeeklyProduct = {
    product_name,
    beian_hao,
    addedAt: new Date().toISOString(),
    templateId: template.id,
  }
  data.products.push(row)
  writeProducts(userId, data)
  return row
}

export function setMineWeeklyProductTemplates(
  userId: string,
  products: Array<{ product_name: string; beian_hao?: string | null }>,
  templateId: string,
): { products: MineWeeklyProduct[]; updated: number } {
  if (!isAutoWeeklyTemplateId(templateId)) {
    throw new Error("不支持的周报模板")
  }
  const data = readProducts(userId)
  let updated = 0
  const missing: string[] = []
  for (const product of products) {
    const product_name = (product.product_name || "").trim()
    if (!product_name) continue
    const beian_hao = (product.beian_hao || "").trim() || null
    const key = autoWeeklyProductKey(product_name, beian_hao)
    const existing = data.products.find(
      (row) => autoWeeklyProductKey(row.product_name, row.beian_hao) === key,
    )
    if (!existing) {
      missing.push(product_name)
      continue
    }
    existing.templateId = templateId
    updated += 1
  }
  if (updated === 0) {
    throw new Error(missing.length ? "产品未加入我的报告" : "请选择要设置的产品")
  }
  writeProducts(userId, data)
  return { products: listMineWeeklyProducts(userId), updated }
}

export function setMineWeeklyProductTemplate(
  userId: string,
  product: { product_name: string; beian_hao?: string | null },
  templateId: string,
): MineWeeklyProduct {
  const result = setMineWeeklyProductTemplates(userId, [product], templateId)
  const product_name = (product.product_name || "").trim()
  const beian_hao = (product.beian_hao || "").trim() || null
  const key = autoWeeklyProductKey(product_name, beian_hao)
  const row = result.products.find(
    (item) => autoWeeklyProductKey(item.product_name, item.beian_hao) === key,
  )
  if (!row) throw new Error("产品未加入我的报告")
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

export function listMineWeeklyReportsForDisplay(userId: string): AutoWeeklyReportRecord[] {
  const products = listMineWeeklyProducts(userId)
  const prefByKey = new Map(
    products.map((row) => [
      autoWeeklyProductKey(row.product_name, row.beian_hao),
      resolveAutoWeeklyTemplate(row.templateId).id,
    ]),
  )
  return pickPreferredAutoWeeklyReports(listMineWeeklyReports(userId), (row) => {
    const key = autoWeeklyProductKey(row.product_name, row.beian_hao)
    return prefByKey.get(key)
  })
}

export async function enrichMineWeeklyListItems(
  userId: string,
): Promise<AutoWeeklyListItem[]> {
  const rows = listMineWeeklyReportsForDisplay(userId)
  const nameMap = await lookupAutoWeeklyTitleNames(rows)
  return rows.map((row) => {
    const code = (row.beian_hao || "").trim().toUpperCase()
    const key = code ? `beian:${code}` : `name:${(row.product_name || "").trim()}`
    return enrichAutoWeeklyListItem(row, row.latestNavDate, nameMap.get(key) ?? null)
  })
}

function summarizeMineVariantEtlItems(
  product_name: string,
  beian_hao: string | null,
  items: AutoWeeklyEtlItem[],
): AutoWeeklyEtlItem {
  const created = items.find((item) => item.status === "created")
  const exists = items.find((item) => item.status === "exists")
  const failed = items.find((item) => item.status === "failed")
  const skipped = items.find((item) => item.status === "skipped")
  const hit = created || (failed && !exists ? failed : null) || exists || skipped || items[0]
  const status = created
    ? "created"
    : failed && !exists
      ? "failed"
      : exists
        ? "exists"
        : hit?.status || "skipped"
  return {
    product_name,
    beian_hao,
    status,
    weekStart: hit?.weekStart,
    weekEnd: hit?.weekEnd,
    reportId: hit?.reportId,
    error: status === "failed" ? failed?.error : undefined,
  }
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

    const title = displayName
    const resolvedBeian = range.beian_hao || beian
    const liveNav = range.latest_nav_date || null
    const variantItems: AutoWeeklyEtlItem[] = []

    // Night job always builds both templates. 订阅模板 is only a display switch.
    for (const template of AUTO_WEEKLY_TEMPLATE_OPTIONS) {
      const existing = readIndex(userId).reports.find(
        (r) =>
          dedupeKey(r.product_name, r.beian_hao, r.weekEnd, r.templateId) ===
          dedupeKey(displayName, resolvedBeian, week.weekEnd, template.id),
      )
      if (existing) {
        if (liveNav && liveNav !== existing.latestNavDate) {
          upsertRecord(userId, {
            ...existing,
            latestNavDate: liveNav,
            updatedAt: new Date().toISOString(),
          })
        }
        variantItems.push({
          product_name: displayName,
          beian_hao: resolvedBeian,
          status: "exists",
          weekStart: existing.weekStart,
          weekEnd: existing.weekEnd,
          reportId: existing.reportId,
        })
        continue
      }

      const result = await generateFofWeeklyReport({
        product_name: displayName,
        beian_hao: resolvedBeian || undefined,
        week_begin: week.weekStart,
        week_end: week.weekEnd,
        report_title: title,
        benchmark_key: "IF",
        nav_frequency: "weekly",
        report_variant: template.variant,
      })

      persistAutoWeeklyReportFiles(result.reportId)

      const now = new Date().toISOString()
      const record: AutoWeeklyReportRecord = {
        id: `mwr_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        reportId: result.reportId,
        product_name: displayName,
        beian_hao: resolvedBeian,
        weekStart: result.weekStart || week.weekStart,
        weekEnd: result.weekEnd || week.weekEnd,
        latestNavDate: liveNav,
        title: result.reportTitle || title,
        templateId: template.id,
        templateName: template.name,
        creator: creatorName || "我",
        type: "mine_weekly",
        typeLabel: MINE_WEEKLY_TYPE_LABEL,
        createdAt: now,
        updatedAt: now,
        source: "mine",
        ownerUserId: sanitizeUserId(userId),
      }
      upsertRecord(userId, record)
      variantItems.push({
        product_name: displayName,
        beian_hao: record.beian_hao,
        status: "created",
        weekStart: record.weekStart,
        weekEnd: record.weekEnd,
        reportId: record.reportId,
      })
    }

    return summarizeMineVariantEtlItems(displayName, resolvedBeian, variantItems)
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
  product: { product_name: string; beian_hao?: string | null; templateId?: string | null },
): Promise<{ product: MineWeeklyProduct; etl: AutoWeeklyEtlItem }> {
  const row = addMineWeeklyProduct(userId, product)
  const etl = await ensureMineWeeklyReportForProduct(
    userId,
    { product_name: row.product_name, beian_hao: row.beian_hao, source: "mine" },
    creatorName,
  )
  return { product: row, etl }
}


/**
 * Subscribe this user to every team auto-weekly product.
 * Does not generate reports. Copies already-stored team report records
 * (same files) into the mine index so the list can show them immediately.
 */
export async function subscribeMineWeeklyToAllTeamProducts(
  userId: string,
): Promise<{
  added: number
  existed: number
  total: number
  attachedReports: number
  products: MineWeeklyProduct[]
}> {
  const team = await listAutoWeeklyTargetProducts()
  let added = 0
  let existed = 0
  const beforeKeys = new Set(
    listMineWeeklyProducts(userId).map((row) => autoWeeklyProductKey(row.product_name, row.beian_hao)),
  )
  for (const product of team) {
    const key = autoWeeklyProductKey(product.product_name, product.beian_hao)
    const already = beforeKeys.has(key)
    addMineWeeklyProduct(userId, {
      product_name: product.product_name,
      beian_hao: product.beian_hao,
    })
    if (already) existed += 1
    else {
      added += 1
      beforeKeys.add(key)
    }
  }
  const attachedReports = attachExistingTeamReportsToMine(userId)
  return {
    added,
    existed,
    total: team.length,
    attachedReports,
    products: listMineWeeklyProducts(userId),
  }
}

function attachExistingTeamReportsToMine(userId: string): number {
  const ownerUserId = sanitizeUserId(userId)
  const subscribed = new Set(
    listMineWeeklyProducts(userId).map((row) => autoWeeklyProductKey(row.product_name, row.beian_hao)),
  )
  const index = readIndex(userId)
  const existing = new Set(
    index.reports.map((row) =>
      autoWeeklyReportDedupeKey(row.product_name, row.beian_hao, row.weekEnd, row.templateId),
    ),
  )
  const next = index.reports.slice()
  let attached = 0
  const now = new Date().toISOString()
  for (const report of listAutoWeeklyReports()) {
    if (!subscribed.has(autoWeeklyProductKey(report.product_name, report.beian_hao))) continue
    const key = autoWeeklyReportDedupeKey(
      report.product_name,
      report.beian_hao,
      report.weekEnd,
      report.templateId,
    )
    if (existing.has(key)) continue
    next.unshift({
      ...report,
      id: `mwr_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      type: "mine_weekly",
      typeLabel: MINE_WEEKLY_TYPE_LABEL,
      source: "mine",
      ownerUserId,
      updatedAt: now,
    })
    existing.add(key)
    attached += 1
  }
  if (attached > 0) {
    writeIndex(userId, { version: 1, updatedAt: now, reports: next })
  }
  return attached
}

export function listMineWeeklyOwnerUserIds(): string[] {
  const root = getServerStoragePath("auto-weekly-reports", "mine")
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-zA-Z0-9_-]{1,80}$/.test(d.name))
    .map((d) => d.name)
}
