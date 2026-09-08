/**
 * 私募基金 list 「基金类型」filter.
 * UI labels match 火富牛 / FOF99 advancedlist; AMAC stores longer official names.
 */
export const PRIVATE_FUND_TYPE_OPTIONS = [
  "私募证券基金",
  "券商资管",
  "期货资管",
  "信托产品",
  "公募专户",
  "保险资管",
  "私募资产配置基金",
] as const

export type PrivateFundTypeLabel = (typeof PRIVATE_FUND_TYPE_OPTIONS)[number]

export const PRIVATE_FUND_TYPE_AMAC_VALUES: Record<PrivateFundTypeLabel, string[]> = {
  私募证券基金: ["私募证券投资基金"],
  券商资管: ["证券公司及其子公司的资产管理计划"],
  期货资管: ["期货公司及其子公司的资产管理计划", "期货公司集合资管产品"],
  信托产品: ["信托计划"],
  公募专户: ["基金专户"],
  保险资管: ["保险公司及其子公司的资产管理计划"],
  私募资产配置基金: ["私募资产配置基金"],
}

/** Cheap name fallback while amac_private_funds.fund_type is only partly backfilled. */
export const PRIVATE_FUND_TYPE_NAME_PATTERN: Partial<Record<PrivateFundTypeLabel, string>> = {
  私募证券基金: "私募证券",
  私募资产配置基金: "资产配置",
}

export const PRIVATE_FUND_TYPES_USING_FUTURES_TABLE = new Set<PrivateFundTypeLabel>(["期货资管"])

const ALLOWED = new Set<string>(PRIVATE_FUND_TYPE_OPTIONS)

export function parsePrivateFundTypesParam(raw: string): PrivateFundTypeLabel[] {
  if (!raw.trim()) return []
  const out: PrivateFundTypeLabel[] = []
  const seen = new Set<string>()
  for (const part of raw.split(",")) {
    const label = part.trim()
    if (!ALLOWED.has(label) || seen.has(label)) continue
    seen.add(label)
    out.push(label as PrivateFundTypeLabel)
  }
  return out
}

/** UI labels from 火富牛; AMAC stores 正在运作 instead of 正常运作. */
export const PRIVATE_FUND_WORKING_STATE_OPTIONS = [
  "正常运作",
  "正常清算",
  "提前清算",
  "延期清算",
  "投顾协议已终止",
  "非正常清算",
] as const

export type PrivateFundWorkingState = (typeof PRIVATE_FUND_WORKING_STATE_OPTIONS)[number]

export const PRIVATE_FUND_WORKING_STATE_AMAC: Record<PrivateFundWorkingState, string[]> = {
  正常运作: ["正在运作", "正常运作"],
  正常清算: ["正常清算"],
  提前清算: ["提前清算"],
  延期清算: ["延期清算"],
  投顾协议已终止: ["投顾协议已终止", "已终止"],
  非正常清算: ["非正常清算", "已注销"],
}

const WORKING_STATE_ALLOWED = new Set<string>(PRIVATE_FUND_WORKING_STATE_OPTIONS)

export function parsePrivateFundWorkingStateParam(raw: string): PrivateFundWorkingState | "" {
  const label = raw.trim()
  return WORKING_STATE_ALLOWED.has(label) ? (label as PrivateFundWorkingState) : ""
}
