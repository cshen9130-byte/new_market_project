import { DEMO_TEMPLATE_ID, loadReportTemplates } from "@/lib/ma/report-template-types"
import { loadFofWeeklyReportPresets } from "@/lib/client/fof-weekly-report-presets"
import { loadFofMonthlyReportPresets } from "@/lib/client/fof-monthly-report-presets"

export type SavedCustomReportSource =
  | "custom_template_generate"
  | "custom_template_import"
  | "weekly_preset_import"
  | "monthly_preset_import"
  | "fof_weekly_generate"
  | "fof_monthly_generate"
  | "product_monthly_generate"
  | "fund_official_monthly_generate"
  | "product_quarterly_generate"
  | "manual"

export type SavedCustomReport = {
  id: string
  title: string
  templateId: string
  templateName: string
  inputValues: Record<string, string>
  createdAt: string
  updatedAt: string
  creator?: string
  /** Distinguishes imported templates vs generated outputs. */
  source?: SavedCustomReportSource
  typeLabel?: string
  /** When present, 我的报告 can offer downloads. */
  download?: { png?: string; pdf?: string }
  /** Stable key used to de-dupe imports (template id / preset name). */
  importKey?: string
}

export const CUSTOM_REPORTS_STORAGE_KEY = "custom_generated_reports_v1"

export function loadCustomReports(): SavedCustomReport[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(CUSTOM_REPORTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedCustomReport[]) : []
  } catch {
    return []
  }
}

/** Soft cap: localStorage is ~5MB; generated report metadata accumulates quickly. */
const MAX_STORED_CUSTOM_REPORTS = 80

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { name?: string; code?: number | string }
  return (
    e.name === "QuotaExceededError"
    || e.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || e.code === 22
    || e.code === 1014
  )
}

/** Drop heavy optional fields when fighting quota; keep enough to list/reopen. */
function slimReport(report: SavedCustomReport): SavedCustomReport {
  return {
    id: report.id,
    title: report.title,
    templateId: report.templateId,
    templateName: report.templateName,
    inputValues: report.inputValues,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    creator: report.creator,
    source: report.source,
    typeLabel: report.typeLabel,
    importKey: report.importKey,
  }
}

function writeReportsPayload(reports: SavedCustomReport[]): void {
  localStorage.setItem(CUSTOM_REPORTS_STORAGE_KEY, JSON.stringify(reports))
}

/**
 * Persist reports to localStorage without throwing on quota.
 * Caps length, then progressively slims / prunes older rows if setItem fails.
 */
export function saveCustomReports(reports: SavedCustomReport[]): void {
  if (typeof window === "undefined") return
  let next = reports.slice(0, MAX_STORED_CUSTOM_REPORTS)
  try {
    writeReportsPayload(next)
    return
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err
  }

  // Retry 1: slim download URLs (tokens) off every row.
  next = next.map(slimReport)
  try {
    writeReportsPayload(next)
    return
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err
  }

  // Retry 2: keep newest half, slim.
  next = next.slice(0, Math.max(10, Math.floor(next.length / 2)))
  try {
    writeReportsPayload(next)
    return
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err
  }

  // Last resort: clear key and keep a small newest head so generate UX does not fail.
  try {
    localStorage.removeItem(CUSTOM_REPORTS_STORAGE_KEY)
    writeReportsPayload(next.slice(0, 10).map(slimReport))
  } catch {
    try {
      localStorage.removeItem(CUSTOM_REPORTS_STORAGE_KEY)
    } catch {
      /* ignore — caller must not fail generation because of client cache */
    }
  }
}

export function upsertCustomReport(report: SavedCustomReport): SavedCustomReport[] {
  const all = loadCustomReports()
  let next: SavedCustomReport[]
  const byId = all.findIndex((r) => r.id === report.id)
  if (byId >= 0) {
    next = all.map((r, i) => (i === byId ? report : r))
  } else if (report.importKey) {
    const byKey = all.findIndex((r) => r.importKey === report.importKey)
    if (byKey >= 0) {
      const merged = { ...all[byKey], ...report, id: all[byKey].id }
      next = all.map((r, i) => (i === byKey ? merged : r))
    } else {
      next = [report, ...all]
    }
  } else {
    next = [report, ...all]
  }
  // Never throw on quota — generation dialogs call this after a successful render.
  saveCustomReports(next)
  return next
}

export function createReportId(): string {
  return `rpt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function currentCreator(): string {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    return u?.name ?? u?.email ?? ""
  } catch {
    return ""
  }
}

export type ImportSavedTemplatesResult = {
  imported: number
  skipped: number
  total: number
}

/**
 * Import into 我的报告:
 * - custom templates from 模板管理 / 新建报告「自定义报告」
 * - saved FOF weekly / monthly presets from 新建报告 dialogs
 * Idempotent via importKey.
 */
export function importSavedNewReportTemplates(): ImportSavedTemplatesResult {
  if (typeof window === "undefined") {
    return { imported: 0, skipped: 0, total: 0 }
  }

  const creator = currentCreator()
  const now = new Date().toISOString()
  let imported = 0
  let skipped = 0
  const existingKeys = new Set(
    loadCustomReports().map((r) => r.importKey).filter((k): k is string => Boolean(k)),
  )

  const templates = loadReportTemplates().filter((t) => t.id !== DEMO_TEMPLATE_ID)
  for (const tpl of templates) {
    const importKey = `tpl:${tpl.id}`
    if (existingKeys.has(importKey)) {
      skipped += 1
      continue
    }
    upsertCustomReport({
      id: createReportId(),
      title: tpl.name,
      templateId: tpl.id,
      templateName: tpl.name,
      inputValues: {},
      createdAt: tpl.updatedAt || now,
      updatedAt: now,
      creator,
      source: "custom_template_import",
      typeLabel: "已保存模板",
      importKey,
    })
    existingKeys.add(importKey)
    imported += 1
  }

  for (const preset of loadFofWeeklyReportPresets()) {
    const importKey = `weekly-preset:${preset.name}`
    if (existingKeys.has(importKey)) {
      skipped += 1
      continue
    }
    upsertCustomReport({
      id: createReportId(),
      title: preset.report_title || preset.name,
      templateId: "weekly-track-curve",
      templateName: "跟踪产品（通用曲线版）",
      inputValues: {
        preset_name: preset.name,
        product_name: preset.product_name,
        beian_hao: preset.beian_hao || "",
        week_begin: preset.week_begin,
        week_end: preset.week_end,
        benchmark_key: preset.benchmark_key,
        nav_frequency: preset.nav_frequency,
      },
      createdAt: preset.savedAt || now,
      updatedAt: now,
      creator,
      source: "weekly_preset_import",
      typeLabel: "周报配置",
      importKey,
    })
    existingKeys.add(importKey)
    imported += 1
  }

  for (const preset of loadFofMonthlyReportPresets()) {
    const importKey = `monthly-preset:${preset.name}`
    if (existingKeys.has(importKey)) {
      skipped += 1
      continue
    }
    upsertCustomReport({
      id: createReportId(),
      title: preset.report_title || preset.name,
      templateId: "monthly-track-curve",
      templateName: "跟踪产品（通用曲线版）月报",
      inputValues: {
        preset_name: preset.name,
        product_name: preset.product_name,
        beian_hao: preset.beian_hao || "",
        month_begin: preset.month_begin,
        month_end: preset.month_end,
        benchmark_key: preset.benchmark_key,
        nav_frequency: preset.nav_frequency,
      },
      createdAt: preset.savedAt || now,
      updatedAt: now,
      creator,
      source: "monthly_preset_import",
      typeLabel: "月报配置",
      importKey,
    })
    existingKeys.add(importKey)
    imported += 1
  }

  return { imported, skipped, total: imported + skipped }
}

/** Persist a successfully generated official report into 我的报告. */
export function recordGeneratedOfficialReport(input: {
  title: string
  templateId: string
  templateName: string
  source: SavedCustomReportSource
  typeLabel: string
  download?: { png?: string; pdf?: string }
  inputValues?: Record<string, string>
  reportJobId?: string
}): SavedCustomReport[] {
  const creator = currentCreator()
  const now = new Date().toISOString()
  const importKey = input.reportJobId ? `gen:${input.reportJobId}` : undefined
  return upsertCustomReport({
    id: createReportId(),
    title: input.title,
    templateId: input.templateId,
    templateName: input.templateName,
    inputValues: input.inputValues || {},
    createdAt: now,
    updatedAt: now,
    creator,
    source: input.source,
    typeLabel: input.typeLabel,
    download: input.download,
    importKey,
  })
}
