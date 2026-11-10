/** Weekly templates the auto scheduler can generate. 新建报告 may list more. */

export const AUTO_WEEKLY_TEMPLATE_ID = "weekly-track-curve"
export const AUTO_WEEKLY_TEMPLATE_NAME = "跟踪产品（通用曲线版）"

export const AUTO_WEEKLY_TEMPLATE_OPTIONS = [
  {
    id: "weekly-track-curve",
    name: "跟踪产品（通用曲线版）",
    variant: "curve",
    description: "显示产品指标和曲线",
  },
  {
    id: "weekly-track-holdings",
    name: "跟踪产品（持仓饼图版）",
    variant: "holdings",
    description: "无基准曲线，可填基金经理观点，展示二级策略持仓饼图",
  },
] as const

export type AutoWeeklyTemplateId = (typeof AUTO_WEEKLY_TEMPLATE_OPTIONS)[number]["id"]
export type AutoWeeklyTemplateVariant = (typeof AUTO_WEEKLY_TEMPLATE_OPTIONS)[number]["variant"]

export type AutoWeeklyTemplateOption = {
  id: AutoWeeklyTemplateId
  name: string
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
    variant: resolved.variant,
    description: resolved.description,
  }
}

export function isAutoWeeklyTemplateId(
  value: string | null | undefined,
): value is AutoWeeklyTemplateId {
  return AUTO_WEEKLY_TEMPLATE_OPTIONS.some((item) => item.id === (value || "").trim())
}
