export type PeIndustryGranularity = "month" | "quarter" | "year"

export type PeIndustryMonthRow = {
  month: string
  newFilingCount: number
  newFilingScale: number
  newManagerCount: number
  stockFundCount: number
  stockFundScale: number
  stockManagerCount: number
  liquidationCount: number
  deregisteredManagerCount: number
}

export type PeIndustryManagerScaleBucket = {
  label: string
  count: number
}

export type PeIndustrySummary = {
  asOf: string
  stockScale: number
  stockFundCount: number
  stockManagerCount: number
}

export const PE_INDUSTRY_REGION_NOTE =
  "本页面主要统计私募证券类管理人及产品的新增、存续、清算、注销情况。其中私募证券类管理人，是指私募证券投资基金管理人和私募资产配置类基金管理人；私募证券投资基金，是指私募证券投资基金和私募资产配置类基金，不含资管产品和信托计划等。"

export function formatPeIndustryMonthLabel(month: string, granularity: PeIndustryGranularity): string {
  if (granularity === "month") return month
  return month
}

export function formatPeIndustryNumber(value: number, unit: "count" | "scale" | "manager"): string {
  if (unit === "scale") return `${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}亿`
  if (unit === "manager") return `${value.toLocaleString("zh-CN")}家`
  return `${value.toLocaleString("zh-CN")}只`
}

export const PE_INDUSTRY_SCALE_TREND_BUCKETS = [
  "0-5亿元",
  "5-10亿元",
  "10-20亿元",
  "20-50亿元",
  "50-100亿元",
  "100亿元以上",
] as const

export type PeIndustryScaleTrendBucket = (typeof PE_INDUSTRY_SCALE_TREND_BUCKETS)[number]

export type PeIndustryScaleTrendPoint = {
  month: string
  counts: Record<PeIndustryScaleTrendBucket, number>
}

export type PeIndustryManagerScaleChange = {
  managerName: string
  registrationNo: string
  inceptionDate: string
  scaleBefore: PeIndustryScaleTrendBucket
  scaleAfter: PeIndustryScaleTrendBucket
  direction: "up" | "down"
}

export type PeIndustryRegionRow = {
  region: string
  managerCount: number
  activeProductCount: number
}

export type PeIndustryStaffMetric = "full_time" | "practitioner"

export type PeIndustryStaffTrendPoint = {
  month: string
  totalStaff: number
  avgStaff: number
  managerCount: number
}

export type PeIndustryHotManagerRow = {
  managerName: string
  registrationNo: string
  mgmtScale: string
  activeFundCount: number | null
  staffCurrent: number
  staffPrevious: number | null
  staffDelta: number | null
  staffGrowthPct: number | null
}

export type PeIndustryHotManagerSeries = {
  registrationNo: string
  managerName: string
  points: Array<{ month: string; staff: number }>
}

export type PeIndustryHotManagersData = {
  updatedAt: string
  metric: PeIndustryStaffMetric
  industryTrend: PeIndustryStaffTrendPoint[]
  hotManagers: PeIndustryHotManagerRow[]
  managerSeries: PeIndustryHotManagerSeries[]
}

function quarterKey(month: string): string {
  const [y, m] = month.split("-").map(Number)
  const q = Math.ceil(m / 3)
  return `${y}-Q${q}`
}

function yearKey(month: string): string {
  return month.slice(0, 4)
}

function aggregateRows(
  rows: PeIndustryMonthRow[],
  keyFn: (month: string) => string,
): PeIndustryMonthRow[] {
  const groups = new Map<string, PeIndustryMonthRow[]>()
  for (const row of rows) {
    const key = keyFn(row.month)
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([month, items]) => {
    const last = items[items.length - 1]
    return {
      month,
      newFilingCount: items.reduce((sum, r) => sum + r.newFilingCount, 0),
      newFilingScale: Math.round(items.reduce((sum, r) => sum + r.newFilingScale, 0) * 100) / 100,
      newManagerCount: items.reduce((sum, r) => sum + r.newManagerCount, 0),
      stockFundCount: last.stockFundCount,
      stockFundScale: last.stockFundScale,
      stockManagerCount: last.stockManagerCount,
      liquidationCount: items.reduce((sum, r) => sum + r.liquidationCount, 0),
      deregisteredManagerCount: items.reduce((sum, r) => sum + r.deregisteredManagerCount, 0),
    }
  })
}

export function peIndustryRowsForGranularity(
  monthly: PeIndustryMonthRow[],
  granularity: PeIndustryGranularity,
): PeIndustryMonthRow[] {
  if (granularity === "month") return monthly
  if (granularity === "quarter") return aggregateRows(monthly, quarterKey)
  return aggregateRows(monthly, yearKey)
}

