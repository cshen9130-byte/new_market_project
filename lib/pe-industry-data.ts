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

/** AMAC-style private securities fund industry statistics (sample data). */
export const PE_INDUSTRY_SUMMARY: PeIndustrySummary = {
  asOf: "2026.05",
  stockScale: 79200.13,
  stockFundCount: 82775,
  stockManagerCount: 7346,
}

export const PE_INDUSTRY_MONTHLY: PeIndustryMonthRow[] = [
  { month: "2025-06", newFilingCount: 892, newFilingScale: 412.5, newManagerCount: 3, stockFundCount: 81542, stockFundScale: 77518.2, stockManagerCount: 7321, liquidationCount: 1186, deregisteredManagerCount: 24 },
  { month: "2025-07", newFilingCount: 1045, newFilingScale: 528.3, newManagerCount: 5, stockFundCount: 81886, stockFundScale: 77892.6, stockManagerCount: 7324, liquidationCount: 2482, deregisteredManagerCount: 36 },
  { month: "2025-08", newFilingCount: 978, newFilingScale: 486.7, newManagerCount: 4, stockFundCount: 82100, stockFundScale: 78156.4, stockManagerCount: 7326, liquidationCount: 2568, deregisteredManagerCount: 42 },
  { month: "2025-09", newFilingCount: 1124, newFilingScale: 612.8, newManagerCount: 6, stockFundCount: 82280, stockFundScale: 78438.9, stockManagerCount: 7330, liquidationCount: 1824, deregisteredManagerCount: 80 },
  { month: "2025-10", newFilingCount: 856, newFilingScale: 398.2, newManagerCount: 2, stockFundCount: 82460, stockFundScale: 78672.5, stockManagerCount: 7332, liquidationCount: 1546, deregisteredManagerCount: 28 },
  { month: "2025-11", newFilingCount: 934, newFilingScale: 445.6, newManagerCount: 3, stockFundCount: 82530, stockFundScale: 78856.8, stockManagerCount: 7334, liquidationCount: 1628, deregisteredManagerCount: 34 },
  { month: "2025-12", newFilingCount: 1088, newFilingScale: 556.4, newManagerCount: 5, stockFundCount: 82600, stockFundScale: 79024.3, stockManagerCount: 7337, liquidationCount: 1912, deregisteredManagerCount: 46 },
  { month: "2026-01", newFilingCount: 762, newFilingScale: 362.1, newManagerCount: 2, stockFundCount: 82650, stockFundScale: 79102.6, stockManagerCount: 7339, liquidationCount: 812, deregisteredManagerCount: 18 },
  { month: "2026-02", newFilingCount: 698, newFilingScale: 318.5, newManagerCount: 1, stockFundCount: 82700, stockFundScale: 79148.2, stockManagerCount: 7340, liquidationCount: 1426, deregisteredManagerCount: 32 },
  { month: "2026-03", newFilingCount: 912, newFilingScale: 428.9, newManagerCount: 4, stockFundCount: 82720, stockFundScale: 79172.8, stockManagerCount: 7342, liquidationCount: 1688, deregisteredManagerCount: 38 },
  { month: "2026-04", newFilingCount: 876, newFilingScale: 402.3, newManagerCount: 3, stockFundCount: 82740, stockFundScale: 79188.5, stockManagerCount: 7344, liquidationCount: 2036, deregisteredManagerCount: 76 },
  { month: "2026-05", newFilingCount: 945, newFilingScale: 468.7, newManagerCount: 2, stockFundCount: 82775, stockFundScale: 79200.13, stockManagerCount: 7346, liquidationCount: 1784, deregisteredManagerCount: 42 },
]

export const PE_INDUSTRY_MANAGER_SCALE_DIST = {
  updatedAt: "2026-06-01",
  buckets: [
    { label: "0-5亿元", count: 5826 },
    { label: "5-10亿元", count: 682 },
    { label: "10-20亿元", count: 418 },
    { label: "20-50亿元", count: 276 },
    { label: "50-100亿元", count: 98 },
    { label: "100亿元以上", count: 46 },
  ] satisfies PeIndustryManagerScaleBucket[],
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

export function peIndustryRowsForGranularity(granularity: PeIndustryGranularity): PeIndustryMonthRow[] {
  if (granularity === "month") return PE_INDUSTRY_MONTHLY
  if (granularity === "quarter") return aggregateRows(PE_INDUSTRY_MONTHLY, quarterKey)
  return aggregateRows(PE_INDUSTRY_MONTHLY, yearKey)
}

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

const SCALE_TREND_START: Record<PeIndustryScaleTrendBucket, number> = {
  "0-5亿元": 4218,
  "5-10亿元": 486,
  "10-20亿元": 312,
  "20-50亿元": 198,
  "50-100亿元": 68,
  "100亿元以上": 24,
}

const SCALE_TREND_END: Record<PeIndustryScaleTrendBucket, number> = {
  "0-5亿元": 5826,
  "5-10亿元": 682,
  "10-20亿元": 418,
  "20-50亿元": 276,
  "50-100亿元": 98,
  "100亿元以上": 46,
}

function trendMonthCursor(): string[] {
  const months: string[] = []
  const cursor = new Date("2022-01-01T12:00:00")
  const end = new Date("2026-06-01T12:00:00")
  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return months
}

function scaleTrendValue(
  bucket: PeIndustryScaleTrendBucket,
  progress: number,
  month: string,
): number {
  const start = SCALE_TREND_START[bucket]
  const end = SCALE_TREND_END[bucket]
  let seed = 0
  for (let i = 0; i < month.length; i += 1) seed = (seed * 31 + month.charCodeAt(i)) >>> 0
  const wave = Math.sin((seed % 360) * (Math.PI / 180)) * (end - start) * 0.04
  return Math.round(start + (end - start) * progress + wave)
}

export const PE_INDUSTRY_SCALE_TREND: PeIndustryScaleTrendPoint[] = (() => {
  const months = trendMonthCursor()
  const lastIndex = Math.max(months.length - 1, 1)
  return months.map((month, index) => {
    const progress = index / lastIndex
    const counts = {} as Record<PeIndustryScaleTrendBucket, number>
    for (const bucket of PE_INDUSTRY_SCALE_TREND_BUCKETS) {
      counts[bucket] = scaleTrendValue(bucket, progress, `${bucket}:${month}`)
    }
    return { month, counts }
  })
})()

export type PeIndustryManagerScaleChange = {
  managerName: string
  registrationNo: string
  inceptionDate: string
  scaleBefore: PeIndustryScaleTrendBucket
  scaleAfter: PeIndustryScaleTrendBucket
  direction: "up" | "down"
}

export const PE_INDUSTRY_MANAGER_SCALE_CHANGES = {
  updatedAt: "2026-06",
  rows: [
    { managerName: "海南金丰", registrationNo: "P1073390", inceptionDate: "2025-05-08", scaleBefore: "50-100亿元", scaleAfter: "100亿元以上", direction: "up" },
    { managerName: "上海千鸿投资", registrationNo: "P1072846", inceptionDate: "2024-11-15", scaleBefore: "20-50亿元", scaleAfter: "50-100亿元", direction: "up" },
    { managerName: "深圳前海汇信", registrationNo: "P1069823", inceptionDate: "2023-08-22", scaleBefore: "10-20亿元", scaleAfter: "20-50亿元", direction: "up" },
    { managerName: "北京恒远资本", registrationNo: "P1067541", inceptionDate: "2022-03-17", scaleBefore: "50-100亿元", scaleAfter: "20-50亿元", direction: "down" },
    { managerName: "杭州景行私募", registrationNo: "P1071128", inceptionDate: "2024-06-03", scaleBefore: "5-10亿元", scaleAfter: "10-20亿元", direction: "up" },
    { managerName: "广州瑞丰投资", registrationNo: "P1068456", inceptionDate: "2021-12-09", scaleBefore: "20-50亿元", scaleAfter: "10-20亿元", direction: "down" },
    { managerName: "成都锦程资产", registrationNo: "P1074012", inceptionDate: "2025-02-26", scaleBefore: "0-5亿元", scaleAfter: "5-10亿元", direction: "up" },
    { managerName: "南京明德私募", registrationNo: "P1066234", inceptionDate: "2020-09-14", scaleBefore: "10-20亿元", scaleAfter: "5-10亿元", direction: "down" },
    { managerName: "武汉长江资本", registrationNo: "P1070567", inceptionDate: "2023-04-28", scaleBefore: "5-10亿元", scaleAfter: "10-20亿元", direction: "up" },
    { managerName: "苏州汇智投资", registrationNo: "P1069123", inceptionDate: "2022-07-19", scaleBefore: "100亿元以上", scaleAfter: "50-100亿元", direction: "down" },
    { managerName: "厦门海翼私募", registrationNo: "P1072234", inceptionDate: "2024-01-11", scaleBefore: "0-5亿元", scaleAfter: "5-10亿元", direction: "up" },
    { managerName: "青岛港湾资本", registrationNo: "P1067012", inceptionDate: "2021-05-30", scaleBefore: "10-20亿元", scaleAfter: "20-50亿元", direction: "up" },
    { managerName: "重庆山城投资", registrationNo: "P1071890", inceptionDate: "2023-10-07", scaleBefore: "5-10亿元", scaleAfter: "0-5亿元", direction: "down" },
    { managerName: "天津滨海私募", registrationNo: "P1065678", inceptionDate: "2020-11-23", scaleBefore: "20-50亿元", scaleAfter: "50-100亿元", direction: "up" },
    { managerName: "西安长安资产", registrationNo: "P1073456", inceptionDate: "2025-01-18", scaleBefore: "0-5亿元", scaleAfter: "5-10亿元", direction: "up" },
    { managerName: "合肥科创投资", registrationNo: "P1068901", inceptionDate: "2022-09-05", scaleBefore: "10-20亿元", scaleAfter: "5-10亿元", direction: "down" },
    { managerName: "宁波甬江私募", registrationNo: "P1070789", inceptionDate: "2024-03-21", scaleBefore: "5-10亿元", scaleAfter: "10-20亿元", direction: "up" },
    { managerName: "无锡太湖资本", registrationNo: "P1067345", inceptionDate: "2021-08-12", scaleBefore: "50-100亿元", scaleAfter: "20-50亿元", direction: "down" },
    { managerName: "长沙湘江投资", registrationNo: "P1072678", inceptionDate: "2023-12-04", scaleBefore: "0-5亿元", scaleAfter: "5-10亿元", direction: "up" },
    { managerName: "郑州中原私募", registrationNo: "P1068012", inceptionDate: "2022-02-27", scaleBefore: "10-20亿元", scaleAfter: "20-50亿元", direction: "up" },
    { managerName: "福州闽江资本", registrationNo: "P1071567", inceptionDate: "2024-08-16", scaleBefore: "5-10亿元", scaleAfter: "10-20亿元", direction: "up" },
    { managerName: "济南泉城投资", registrationNo: "P1066789", inceptionDate: "2021-04-02", scaleBefore: "20-50亿元", scaleAfter: "10-20亿元", direction: "down" },
    { managerName: "大连滨海私募", registrationNo: "P1073123", inceptionDate: "2025-03-09", scaleBefore: "0-5亿元", scaleAfter: "5-10亿元", direction: "up" },
    { managerName: "沈阳东北资本", registrationNo: "P1069456", inceptionDate: "2020-06-25", scaleBefore: "10-20亿元", scaleAfter: "5-10亿元", direction: "down" },
    { managerName: "昆明春城投资", registrationNo: "P1070234", inceptionDate: "2023-07-13", scaleBefore: "5-10亿元", scaleAfter: "10-20亿元", direction: "up" },
    { managerName: "贵阳黔中私募", registrationNo: "P1068123", inceptionDate: "2022-11-08", scaleBefore: "0-5亿元", scaleAfter: "5-10亿元", direction: "up" },
    { managerName: "南宁邕江资本", registrationNo: "P1071899", inceptionDate: "2024-05-29", scaleBefore: "10-20亿元", scaleAfter: "20-50亿元", direction: "up" },
    { managerName: "石家庄冀中投资", registrationNo: "P1067567", inceptionDate: "2021-01-20", scaleBefore: "20-50亿元", scaleAfter: "10-20亿元", direction: "down" },
    { managerName: "太原晋商私募", registrationNo: "P1072345", inceptionDate: "2023-03-06", scaleBefore: "5-10亿元", scaleAfter: "0-5亿元", direction: "down" },
    { managerName: "哈尔滨冰城资本", registrationNo: "P1069012", inceptionDate: "2022-06-18", scaleBefore: "0-5亿元", scaleAfter: "5-10亿元", direction: "up" },
    { managerName: "长春一汽投资", registrationNo: "P1071456", inceptionDate: "2024-10-22", scaleBefore: "10-20亿元", scaleAfter: "20-50亿元", direction: "up" },
    { managerName: "兰州丝路私募", registrationNo: "P1068234", inceptionDate: "2021-07-07", scaleBefore: "5-10亿元", scaleAfter: "10-20亿元", direction: "up" },
    { managerName: "乌鲁木齐天山资本", registrationNo: "P1070561", inceptionDate: "2023-09-19", scaleBefore: "0-5亿元", scaleAfter: "5-10亿元", direction: "up" },
    { managerName: "呼和浩特草原投资", registrationNo: "P1067890", inceptionDate: "2022-04-14", scaleBefore: "10-20亿元", scaleAfter: "5-10亿元", direction: "down" },
    { managerName: "珠海横琴私募", registrationNo: "P1073789", inceptionDate: "2025-04-01", scaleBefore: "20-50亿元", scaleAfter: "50-100亿元", direction: "up" },
    { managerName: "东莞松山湖资本", registrationNo: "P1068567", inceptionDate: "2021-10-31", scaleBefore: "50-100亿元", scaleAfter: "20-50亿元", direction: "down" },
    { managerName: "佛山岭南投资", registrationNo: "P1072012", inceptionDate: "2024-02-08", scaleBefore: "5-10亿元", scaleAfter: "10-20亿元", direction: "up" },
    { managerName: "温州瓯江私募", registrationNo: "P1067123", inceptionDate: "2020-08-17", scaleBefore: "10-20亿元", scaleAfter: "20-50亿元", direction: "up" },
    { managerName: "嘉兴南湖资本", registrationNo: "P1072901", inceptionDate: "2023-06-26", scaleBefore: "0-5亿元", scaleAfter: "5-10亿元", direction: "up" },
    { managerName: "绍兴越城投资", registrationNo: "P1069345", inceptionDate: "2022-12-03", scaleBefore: "5-10亿元", scaleAfter: "10-20亿元", direction: "up" },
  ] satisfies PeIndustryManagerScaleChange[],
}

export type PeIndustryRegionRow = {
  region: string
  managerCount: number
  activeProductCount: number
}

export const PE_INDUSTRY_REGION_DONUT = [
  { name: "上海市", value: 1983, color: "#D93025" },
  { name: "广东省", value: 1919, color: "#1A73E8" },
  { name: "北京市", value: 1214, color: "#FBBC04" },
  { name: "浙江省", value: 608, color: "#14b8a6" },
  { name: "福建省", value: 236, color: "#84cc16" },
  { name: "其他", value: 1572, color: "#9333ea" },
] as const

export const PE_INDUSTRY_REGION_TABLE: PeIndustryRegionRow[] = [
  { region: "上海市", managerCount: 1983, activeProductCount: 4829 },
  { region: "广东省", managerCount: 1919, activeProductCount: 3024 },
  { region: "北京市", managerCount: 1214, activeProductCount: 4178 },
  { region: "浙江省", managerCount: 608, activeProductCount: 2173 },
  { region: "福建省", managerCount: 236, activeProductCount: 1744 },
  { region: "江苏省", managerCount: 226, activeProductCount: 1164 },
  { region: "山东省", managerCount: 152, activeProductCount: 1121 },
  { region: "四川省", managerCount: 147, activeProductCount: 1206 },
  { region: "湖南省", managerCount: 100, activeProductCount: 600 },
  { region: "河南省", managerCount: 94, activeProductCount: 396 },
  { region: "湖北省", managerCount: 88, activeProductCount: 412 },
  { region: "安徽省", managerCount: 82, activeProductCount: 358 },
  { region: "重庆市", managerCount: 76, activeProductCount: 445 },
  { region: "天津市", managerCount: 71, activeProductCount: 389 },
  { region: "辽宁省", managerCount: 68, activeProductCount: 312 },
  { region: "陕西省", managerCount: 62, activeProductCount: 278 },
  { region: "江西省", managerCount: 58, activeProductCount: 245 },
  { region: "云南省", managerCount: 52, activeProductCount: 198 },
  { region: "广西壮族自治区", managerCount: 48, activeProductCount: 176 },
  { region: "贵州省", managerCount: 44, activeProductCount: 162 },
  { region: "河北省", managerCount: 41, activeProductCount: 188 },
  { region: "山西省", managerCount: 38, activeProductCount: 145 },
  { region: "吉林省", managerCount: 34, activeProductCount: 128 },
  { region: "黑龙江省", managerCount: 31, activeProductCount: 112 },
  { region: "海南省", managerCount: 28, activeProductCount: 156 },
  { region: "甘肃省", managerCount: 24, activeProductCount: 98 },
  { region: "内蒙古自治区", managerCount: 22, activeProductCount: 86 },
  { region: "新疆维吾尔自治区", managerCount: 19, activeProductCount: 74 },
  { region: "宁夏回族自治区", managerCount: 16, activeProductCount: 62 },
  { region: "青海省", managerCount: 12, activeProductCount: 48 },
  { region: "西藏自治区", managerCount: 8, activeProductCount: 32 },
  { region: "香港", managerCount: 6, activeProductCount: 28 },
  { region: "澳门", managerCount: 3, activeProductCount: 12 },
  { region: "台湾", managerCount: 2, activeProductCount: 8 },
  { region: "大连市", managerCount: 18, activeProductCount: 92 },
  { region: "青岛市", managerCount: 16, activeProductCount: 88 },
  { region: "宁波市", managerCount: 14, activeProductCount: 76 },
  { region: "厦门市", managerCount: 12, activeProductCount: 68 },
  { region: "深圳市", managerCount: 11, activeProductCount: 64 },
  { region: "苏州市", managerCount: 10, activeProductCount: 58 },
]

export const PE_INDUSTRY_REGION_NOTE =
  "本页面主要统计私募证券类管理人及产品的新增、存续、清算、注销情况。其中私募证券类管理人，是指私募证券投资基金管理人和私募资产配置类基金管理人；私募证券投资基金，是指私募证券投资基金和私募资产配置类基金，不含资管产品和信托计划等。"
