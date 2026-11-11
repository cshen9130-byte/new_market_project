/** Weekly templates the auto scheduler can generate. 新建报告 may list more. */

export const AUTO_WEEKLY_TEMPLATE_ID = "weekly-track-curve"
export const AUTO_WEEKLY_TEMPLATE_NAME = "跟踪产品（超额版）"

export const AUTO_WEEKLY_TEMPLATE_OPTIONS = [
  {
    id: "weekly-track-curve",
    name: "跟踪产品（超额版）",
    shortName: "超额版",
    variant: "curve",
    description: "显示产品指标和曲线",
  },
  {
    id: "weekly-track-holdings",
    name: "跟踪产品（持仓版）",
    shortName: "持仓版",
    variant: "holdings",
    description: "无基准曲线，可填基金经理观点，展示二级策略持仓饼图",
  },
] as const

export type AutoWeeklyTemplateId = (typeof AUTO_WEEKLY_TEMPLATE_OPTIONS)[number]["id"]
export type AutoWeeklyTemplateVariant = (typeof AUTO_WEEKLY_TEMPLATE_OPTIONS)[number]["variant"]

export type AutoWeeklyTemplateOption = {
  id: AutoWeeklyTemplateId
  name: string
  shortName: string
  variant: AutoWeeklyTemplateVariant
  description: string
}

export function resolveAutoWeeklyTemplate(
  templateId?: string | null,
): AutoWeeklyTemplateOption {
  const id = (templateId || "").trim()
  const hit = AUTO_WEEKLY_TEMPLATE_OPTIONS.find((item) => item.id === id)
  const resolved = hit ?? AUTO_WEEKLY_TEMPLATE_OPTIONS[0]
  return {
    id: resolved.id,
    name: resolved.name,
    shortName: resolved.shortName,
    variant: resolved.variant,
    description: resolved.description,
  }
}

export function isAutoWeeklyTemplateId(
  value: string | null | undefined,
): value is AutoWeeklyTemplateId {
  return AUTO_WEEKLY_TEMPLATE_OPTIONS.some((item) => item.id === (value || "").trim())
}

const AUTO_WEEKLY_NAME_ALIASES: Record<string, AutoWeeklyTemplateId> = {
  "跟踪产品（通用曲线版）": "weekly-track-curve",
  "跟踪产品（超额版）": "weekly-track-curve",
  "超额版": "weekly-track-curve",
  "跟踪产品（持仓饼图版）": "weekly-track-holdings",
  "跟踪产品（持仓版）": "weekly-track-holdings",
  "持仓版": "weekly-track-holdings",
}

/** Resolve a weekly template from an id or a stored/legacy display name. Monthly titles are ignored. */
export function resolveAutoWeeklyTemplateLabel(
  templateId?: string | null,
  templateName?: string | null,
): AutoWeeklyTemplateOption | null {
  if (isAutoWeeklyTemplateId(templateId)) {
    return resolveAutoWeeklyTemplate(templateId)
  }
  const name = (templateName || "").trim()
  if (!name || name.includes("月报")) return null
  const aliased = AUTO_WEEKLY_NAME_ALIASES[name]
  return aliased ? resolveAutoWeeklyTemplate(aliased) : null
}

/** Short label for the reports table 模板 column: 超额版 / 持仓版. */
export function autoWeeklyTemplateShortLabel(
  templateId?: string | null,
  templateName?: string | null,
): string {
  const id = (templateId || "").trim()
  if (id && !isAutoWeeklyTemplateId(id)) {
    return (templateName || "").trim()
  }
  const resolved = resolveAutoWeeklyTemplateLabel(templateId, templateName)
  return resolved?.shortName || (templateName || "").trim()
}


/** Official 产品月报 templates shown in 新建报告. */
export const OFFICIAL_MONTHLY_TEMPLATE_OPTIONS = [
  { id: "monthly-track-curve", name: "跟踪产品（超额版）", shortName: "超额版" },
  { id: "monthly-review", name: "跟踪产品（马年版）", shortName: "马年版" },
  { id: "monthly-pe-official", name: "低中高波三产品版", shortName: "低中高波三产品版" },
  { id: "monthly-fund-official", name: "表格版", shortName: "表格版" },
  { id: "monthly-track-holdings", name: "跟踪产品（持仓版）", shortName: "持仓版" },
] as const

export type OfficialMonthlyTemplateId = (typeof OFFICIAL_MONTHLY_TEMPLATE_OPTIONS)[number]["id"]

export function isOfficialMonthlyTemplateId(
  value: string | null | undefined,
): value is OfficialMonthlyTemplateId {
  return OFFICIAL_MONTHLY_TEMPLATE_OPTIONS.some((item) => item.id === (value || "").trim())
}

const OFFICIAL_MONTHLY_NAME_ALIASES: Record<string, OfficialMonthlyTemplateId> = {
  "跟踪产品（通用曲线版）": "monthly-track-curve",
  "跟踪产品（通用曲线版）月报": "monthly-track-curve",
  "跟踪产品（超额版）": "monthly-track-curve",
  "跟踪产品（超额版）月报": "monthly-track-curve",
  "超额版": "monthly-track-curve",
  "跟踪产品（月度回顾版）": "monthly-review",
  "跟踪产品（马年版）": "monthly-review",
  "马年版": "monthly-review",
  "私募基金月报-官方": "monthly-pe-official",
  "低中高波三产品版": "monthly-pe-official",
  "单产品投资月报": "monthly-fund-official",
  "表格版": "monthly-fund-official",
  "跟踪产品（持仓版）": "monthly-track-holdings",
  "持仓版": "monthly-track-holdings",
}

/**
 * Short label for a 产品月报 template. Weekly ids are ignored so
 * monthly-track-curve is never treated as a weekly template.
 */
export function officialMonthlyTemplateShortLabel(
  templateId?: string | null,
  templateName?: string | null,
): string | null {
  const id = (templateId || "").trim()
  if (id) {
    const hit = OFFICIAL_MONTHLY_TEMPLATE_OPTIONS.find((item) => item.id === id)
    if (hit) return hit.shortName
    if (!id.startsWith("monthly-")) return null
  }
  const name = (templateName || "").trim()
  if (!name) return null
  // Ambiguous names like 超额版 / 持仓版 without a monthly id belong to weekly
  // mapping unless the stored title is clearly a monthly report.
  const aliased = OFFICIAL_MONTHLY_NAME_ALIASES[name]
  if (!aliased) return null
  if (!id && (name === "超额版" || name === "持仓版" || name === "跟踪产品（超额版）" || name === "跟踪产品（持仓版）") && !name.includes("月报")) {
    return null
  }
  return OFFICIAL_MONTHLY_TEMPLATE_OPTIONS.find((item) => item.id === aliased)?.shortName ?? null
}

/** Display label for the reports table 模板 column (weekly or monthly). */
export function officialReportTemplateShortLabel(
  templateId?: string | null,
  templateName?: string | null,
): string {
  const monthly = officialMonthlyTemplateShortLabel(templateId, templateName)
  if (monthly) return monthly
  return autoWeeklyTemplateShortLabel(templateId, templateName)
}
