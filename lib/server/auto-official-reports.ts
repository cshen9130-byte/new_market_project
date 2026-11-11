/**
 * Auto-generated 产品月报 / 产品季报 / 持有期报告 for 团队报告.
 * 月报 and 季报 use the same product universe as 系统周报 (在管产品 + extras),
 * with their own templates and period cadence. 持有期报告 covers the three
 * default products and refreshes daily when NAV moves.
 * Invoked from the nightly auto-weekly ETL script.
 */

import {
  generateFofMonthlyReport,
} from "@/lib/server/fof-monthly-report"
import {
  generateProductQuarterlyReport,
} from "@/lib/server/product-quarterly-report"
import {
  generateFofWeeklyReport,
  resolveFofWeeklyProductNavRange,
  resolveProductBeianHao,
} from "@/lib/server/fof-weekly-report"
import {
  listAutoWeeklyTargetProducts,
  type AutoWeeklyTargetProduct,
} from "@/lib/server/auto-weekly-reports"
import {
  getCustomFundByCode,
  listAllCustomFundRecords,
} from "@/lib/server/custom-funds"
import {
  AUTO_OFFICIAL_CREATOR,
  findOfficialSharedReport,
  fofMonthlyTmpDir,
  fofWeeklyTmpDir,
  productQuarterlyTmpDir,
  registerAutoOfficialReport,
  type OfficialSharedSection,
} from "@/lib/server/official-shared-reports"

export type AutoOfficialEtlItem = {
  section: OfficialSharedSection
  product_name: string
  beian_hao: string | null
  status: "created" | "exists" | "skipped" | "failed"
  periodStart?: string
  periodEnd?: string
  reportId?: string
  error?: string
}

export type AutoOfficialEtlResult = {
  ok: boolean
  created: number
  existed: number
  skipped: number
  failed: number
  items: AutoOfficialEtlItem[]
}

/** Default 持有期报告 products shown in 团队报告; start dates are the official holding starts. */
export const AUTO_HOLDING_PRODUCTS = [
  { product_name: "荣熙共赢同策略", beian_hao: "380004", week_begin: "2026-02-27" },
  { product_name: "荣熙恒盈2号", beian_hao: "SBAH99", week_begin: "2026-05-12" },
  { product_name: "荣熙共好", beian_hao: "SB0107", week_begin: "2025-09-19" },
] as const

const HOLDING_TEMPLATE_ID = "weekly-track-curve"
const HOLDING_TEMPLATE_NAME = "跟踪产品（超额版）"
const MONTHLY_TEMPLATE_ID = "monthly-track-curve"
const MONTHLY_TEMPLATE_NAME = "跟踪产品（超额版）"
const QUARTERLY_TEMPLATE_ID = "quarterly-institutional"
const QUARTERLY_TEMPLATE_NAME = "机构投资者持有期季报"
const HOLDING_TAGLINE = "低波动 · 稳健运作 · 策略"

const EXISTING_HOLDING_SEEDS = [
  {
    product_name: "荣熙共赢同策略",
    beian_hao: "380004",
    reportId: "1b028bb4-445c-451d-9038-145bc5995436",
    periodStart: "2026-02-27",
    periodEnd: "2026-11-09",
  },
  {
    product_name: "荣熙恒盈2号",
    beian_hao: "SBAH99",
    reportId: "11c935bb-4632-4224-af81-ce4abf2b33d3",
    periodStart: "2026-05-12",
    periodEnd: "2026-11-10",
  },
  {
    product_name: "荣熙共好",
    beian_hao: "SB0107",
    reportId: "e4fe2d11-e81d-47f0-a105-e57ce4adf6c8",
    periodStart: "2025-09-19",
    periodEnd: "2026-10-30",
  },
] as const

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function lastDayOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0))
  return `${year}-${String(month).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

export function resolveLatestCompleteMonth(
  latestNav: string,
  today = shanghaiToday(),
): { monthStart: string; monthEnd: string } | null {
  const [ty, tm] = today.split("-").map(Number)
  if (!ty || !tm) return null
  let year = ty
  let month = tm - 1
  if (month <= 0) {
    month = 12
    year -= 1
  }
  for (let i = 0; i < 24; i += 1) {
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`
    const last = lastDayOfMonth(year, month)
    if (latestNav >= monthStart) {
      const monthEnd = latestNav < last ? latestNav : last
      return { monthStart, monthEnd }
    }
    month -= 1
    if (month <= 0) {
      month = 12
      year -= 1
    }
  }
  return null
}

export function resolveLatestCompleteQuarter(
  latestNav: string,
  today = shanghaiToday(),
): { periodStart: string; periodEnd: string } | null {
  const [ty, tm] = today.split("-").map(Number)
  if (!ty || !tm) return null
  let year = ty
  let startMonth = Math.floor((tm - 1) / 3) * 3 + 1 - 3
  if (startMonth <= 0) {
    startMonth += 12
    year -= 1
  }
  for (let i = 0; i < 8; i += 1) {
    const periodStart = `${year}-${String(startMonth).padStart(2, "0")}-01`
    const endMonth = startMonth + 2
    const last = lastDayOfMonth(year, endMonth)
    if (latestNav >= periodStart) {
      const periodEnd = latestNav < last ? latestNav : last
      return { periodStart, periodEnd }
    }
    startMonth -= 3
    if (startMonth <= 0) {
      startMonth += 12
      year -= 1
    }
  }
  return null
}

function summarize(items: AutoOfficialEtlItem[]): AutoOfficialEtlResult {
  return {
    ok: items.every((item) => item.status !== "failed"),
    created: items.filter((item) => item.status === "created").length,
    existed: items.filter((item) => item.status === "exists").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    failed: items.filter((item) => item.status === "failed").length,
    items,
  }
}

async function resolveNavContext(product: AutoWeeklyTargetProduct): Promise<{
  displayName: string
  beian: string | null
  latestNav: string | null
}> {
  const product_name = product.product_name.trim()
  let beian = product.beian_hao?.trim() || null
  try {
    beian = await resolveProductBeianHao(product_name, beian || undefined)
  } catch {
    // keep the hinted code
  }
  const custom = beian
    ? getCustomFundByCode(beian)
    : (listAllCustomFundRecords().find((fund) => fund.product_name.trim() === product_name) ?? null)
  const displayName =
    product.source === "extra" ? product_name : custom?.product_name || product_name
  const range = await resolveFofWeeklyProductNavRange(displayName, beian || undefined)
  return {
    displayName,
    beian: range.beian_hao || beian,
    latestNav: range.latest_nav_date || null,
  }
}

function logItem(item: AutoOfficialEtlItem): void {
  const msg =
    `[auto-official-etl] ${item.section} ${item.status} ${item.product_name}` +
    (item.periodEnd ? ` period=${item.periodStart || ""}..${item.periodEnd}` : "") +
    (item.error ? ` err=${item.error}` : "")
  if (item.status === "failed") console.error(msg)
  else console.log(msg)
}

export function seedExistingHoldingReports(): AutoOfficialEtlItem[] {
  const items: AutoOfficialEtlItem[] = []
  for (const seed of EXISTING_HOLDING_SEEDS) {
    const existing = findOfficialSharedReport({
      section: "holding",
      product_name: seed.product_name,
      beian_hao: seed.beian_hao,
      templateId: HOLDING_TEMPLATE_ID,
      periodEnd: seed.periodEnd,
      creator: AUTO_OFFICIAL_CREATOR,
    })
    if (existing) {
      items.push({
        section: "holding",
        product_name: seed.product_name,
        beian_hao: seed.beian_hao,
        status: "exists",
        periodStart: existing.periodStart,
        periodEnd: existing.periodEnd,
        reportId: existing.reportId,
      })
      continue
    }
    try {
      const record = registerAutoOfficialReport({
        reportId: seed.reportId,
        section: "holding",
        source: "auto_etl",
        title: seed.product_name,
        templateId: HOLDING_TEMPLATE_ID,
        templateName: HOLDING_TEMPLATE_NAME,
        typeLabel: "持有期报告",
        product_name: seed.product_name,
        beian_hao: seed.beian_hao,
        periodStart: seed.periodStart,
        periodEnd: seed.periodEnd,
        tmpDir: fofWeeklyTmpDir(seed.reportId),
        replaceSameProduct: true,
      })
      items.push({
        section: "holding",
        product_name: seed.product_name,
        beian_hao: seed.beian_hao,
        status: "created",
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
        reportId: record.reportId,
      })
    } catch (err) {
      items.push({
        section: "holding",
        product_name: seed.product_name,
        beian_hao: seed.beian_hao,
        status: "failed",
        periodStart: seed.periodStart,
        periodEnd: seed.periodEnd,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return items
}

async function ensureHoldingReport(product: (typeof AUTO_HOLDING_PRODUCTS)[number]): Promise<AutoOfficialEtlItem> {
  const product_name = product.product_name
  try {
    const ctx = await resolveNavContext({
      product_name,
      beian_hao: product.beian_hao,
      source: "extra",
    })
    if (!ctx.latestNav) {
      return { section: "holding", product_name, beian_hao: ctx.beian, status: "skipped", error: "no_nav" }
    }
    if (ctx.latestNav < product.week_begin) {
      return {
        section: "holding",
        product_name,
        beian_hao: ctx.beian,
        status: "skipped",
        error: "nav_before_holding_start",
      }
    }
    const existing = findOfficialSharedReport({
      section: "holding",
      product_name,
      beian_hao: ctx.beian,
      templateId: HOLDING_TEMPLATE_ID,
      periodEnd: ctx.latestNav,
      creator: AUTO_OFFICIAL_CREATOR,
    })
    if (existing) {
      return {
        section: "holding",
        product_name,
        beian_hao: ctx.beian,
        status: "exists",
        periodStart: existing.periodStart,
        periodEnd: existing.periodEnd,
        reportId: existing.reportId,
      }
    }
    const result = await generateFofWeeklyReport({
      product_name,
      beian_hao: ctx.beian || undefined,
      week_begin: product.week_begin,
      week_end: ctx.latestNav,
      report_title: product_name,
      product_tagline: HOLDING_TAGLINE,
      benchmark_key: "IF",
      nav_frequency: "weekly",
      report_variant: "curve",
      report_kind: "holding",
    })
    const record = registerAutoOfficialReport({
      reportId: result.reportId,
      section: "holding",
      source: "auto_etl",
      title: result.reportTitle || product_name,
      templateId: HOLDING_TEMPLATE_ID,
      templateName: HOLDING_TEMPLATE_NAME,
      typeLabel: "持有期报告",
      product_name,
      beian_hao: ctx.beian,
      periodStart: result.weekStart || product.week_begin,
      periodEnd: result.weekEnd || ctx.latestNav,
      tmpDir: fofWeeklyTmpDir(result.reportId),
      replaceSameProduct: true,
    })
    return {
      section: "holding",
      product_name,
      beian_hao: ctx.beian,
      status: "created",
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      reportId: record.reportId,
    }
  } catch (err) {
    return {
      section: "holding",
      product_name,
      beian_hao: product.beian_hao,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function ensureMonthlyReport(product: AutoWeeklyTargetProduct): Promise<AutoOfficialEtlItem> {
  const product_name = product.product_name.trim()
  try {
    const ctx = await resolveNavContext(product)
    if (!ctx.latestNav) {
      return { section: "monthly", product_name: ctx.displayName, beian_hao: ctx.beian, status: "skipped", error: "no_nav" }
    }
    const month = resolveLatestCompleteMonth(ctx.latestNav)
    if (!month) {
      return { section: "monthly", product_name: ctx.displayName, beian_hao: ctx.beian, status: "skipped", error: "no_month" }
    }
    const existing = findOfficialSharedReport({
      section: "monthly",
      product_name: ctx.displayName,
      beian_hao: ctx.beian,
      templateId: MONTHLY_TEMPLATE_ID,
      periodEnd: month.monthEnd,
      creator: AUTO_OFFICIAL_CREATOR,
    })
    if (existing) {
      return {
        section: "monthly",
        product_name: ctx.displayName,
        beian_hao: ctx.beian,
        status: "exists",
        periodStart: existing.periodStart,
        periodEnd: existing.periodEnd,
        reportId: existing.reportId,
      }
    }
    const result = await generateFofMonthlyReport({
      product_name: ctx.displayName,
      beian_hao: ctx.beian || undefined,
      month_begin: month.monthStart,
      month_end: month.monthEnd,
      report_title: ctx.displayName,
      benchmark_key: "IF",
      nav_frequency: "weekly",
      report_layout: "curve",
    })
    const record = registerAutoOfficialReport({
      reportId: result.reportId,
      section: "monthly",
      source: "auto_etl",
      title: result.reportTitle || ctx.displayName,
      templateId: MONTHLY_TEMPLATE_ID,
      templateName: MONTHLY_TEMPLATE_NAME,
      typeLabel: "月报",
      product_name: ctx.displayName,
      beian_hao: ctx.beian,
      periodStart: result.monthStart || month.monthStart,
      periodEnd: result.monthEnd || month.monthEnd,
      tmpDir: fofMonthlyTmpDir(result.reportId),
    })
    return {
      section: "monthly",
      product_name: ctx.displayName,
      beian_hao: ctx.beian,
      status: "created",
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      reportId: record.reportId,
    }
  } catch (err) {
    return {
      section: "monthly",
      product_name,
      beian_hao: product.beian_hao,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function ensureQuarterlyReport(product: AutoWeeklyTargetProduct): Promise<AutoOfficialEtlItem> {
  const product_name = product.product_name.trim()
  try {
    const ctx = await resolveNavContext(product)
    if (!ctx.latestNav) {
      return { section: "quarterly", product_name: ctx.displayName, beian_hao: ctx.beian, status: "skipped", error: "no_nav" }
    }
    const quarter = resolveLatestCompleteQuarter(ctx.latestNav)
    if (!quarter) {
      return {
        section: "quarterly",
        product_name: ctx.displayName,
        beian_hao: ctx.beian,
        status: "skipped",
        error: "no_quarter",
      }
    }
    const existing = findOfficialSharedReport({
      section: "quarterly",
      product_name: ctx.displayName,
      beian_hao: ctx.beian,
      templateId: QUARTERLY_TEMPLATE_ID,
      periodEnd: quarter.periodEnd,
      creator: AUTO_OFFICIAL_CREATOR,
    })
    if (existing) {
      return {
        section: "quarterly",
        product_name: ctx.displayName,
        beian_hao: ctx.beian,
        status: "exists",
        periodStart: existing.periodStart,
        periodEnd: existing.periodEnd,
        reportId: existing.reportId,
      }
    }
    const result = await generateProductQuarterlyReport({
      product_name: ctx.displayName,
      beian_hao: ctx.beian || undefined,
      period_begin: quarter.periodStart,
      period_end: quarter.periodEnd,
      report_title: ctx.displayName,
      nav_frequency: "weekly",
    })
    const record = registerAutoOfficialReport({
      reportId: result.reportId,
      section: "quarterly",
      source: "auto_etl",
      title: result.reportTitle || ctx.displayName,
      templateId: QUARTERLY_TEMPLATE_ID,
      templateName: QUARTERLY_TEMPLATE_NAME,
      typeLabel: "季报",
      product_name: ctx.displayName,
      beian_hao: ctx.beian,
      periodStart: result.periodStart || quarter.periodStart,
      periodEnd: result.periodEnd || quarter.periodEnd,
      tmpDir: productQuarterlyTmpDir(result.reportId),
    })
    return {
      section: "quarterly",
      product_name: ctx.displayName,
      beian_hao: ctx.beian,
      status: "created",
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      reportId: record.reportId,
    }
  } catch (err) {
    return {
      section: "quarterly",
      product_name,
      beian_hao: product.beian_hao,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function runAutoHoldingReportsEtl(): Promise<AutoOfficialEtlResult> {
  const items = seedExistingHoldingReports()
  const seeded = new Set(items.map((item) => item.product_name))
  for (const product of AUTO_HOLDING_PRODUCTS) {
    const already = items.find(
      (item) => item.product_name === product.product_name && (item.status === "created" || item.status === "exists"),
    )
    // Still refresh if NAV has moved past the seeded period.
    const item = await ensureHoldingReport(product)
    if (already && item.status === "exists") {
      continue
    }
    if (already && item.status === "created") {
      items.splice(items.indexOf(already), 1, item)
      logItem(item)
      continue
    }
    if (!already || !seeded.has(product.product_name) || item.status !== "exists") {
      if (already && item.status === "failed") {
        // keep the seeded row, just log
        logItem(item)
        continue
      }
      items.push(item)
      logItem(item)
    }
  }
  return summarize(items)
}

export async function runAutoMonthlyReportsEtl(): Promise<AutoOfficialEtlResult> {
  const products = await listAutoWeeklyTargetProducts()
  const items: AutoOfficialEtlItem[] = []
  for (const product of products) {
    const item = await ensureMonthlyReport(product)
    items.push(item)
    logItem(item)
  }
  return summarize(items)
}

export async function runAutoQuarterlyReportsEtl(): Promise<AutoOfficialEtlResult> {
  const products = await listAutoWeeklyTargetProducts()
  const items: AutoOfficialEtlItem[] = []
  for (const product of products) {
    const item = await ensureQuarterlyReport(product)
    items.push(item)
    logItem(item)
  }
  return summarize(items)
}

export async function runAutoOfficialReportsEtl(): Promise<{
  holding: AutoOfficialEtlResult
  monthly: AutoOfficialEtlResult
  quarterly: AutoOfficialEtlResult
}> {
  const holding = await runAutoHoldingReportsEtl()
  const monthly = await runAutoMonthlyReportsEtl()
  const quarterly = await runAutoQuarterlyReportsEtl()
  return { holding, monthly, quarterly }
}
