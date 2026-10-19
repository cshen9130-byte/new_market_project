/**
 * Shared shapes and date buckets for 运维 → 数据维护 → 数据概览.
 * Date windows match the 团队数据 / 平台数据 list filters.
 */

export type DataOverviewScope = "all" | "nav" | "team" | "platform" | "tracking"

export type DataOverviewRow = {
  key: string
  label: string
  count: number
  /** Share of the scope total, 0–1. */
  share: number
  /** Opens the matching list with this status selected. */
  href?: string
}

export type DataOverviewSection = {
  key: string
  title: string
  hint: string
  rows: DataOverviewRow[]
}

export type NavClassCounts = {
  private_present: number
  private_absent: number
  other_present: number
  other_absent: number
  /** 私募基金 · 有净值 · 备案号在 JY跟踪池. */
  private_present_in: number
  private_present_out: number
  private_absent_in: number
  private_absent_out: number
  other_present_in: number
  other_present_out: number
  other_absent_in: number
  other_absent_out: number
}

export function emptyNavClass(): NavClassCounts {
  return {
    private_present: 0,
    private_absent: 0,
    other_present: 0,
    other_absent: 0,
    private_present_in: 0,
    private_present_out: 0,
    private_absent_in: 0,
    private_absent_out: 0,
    other_present_in: 0,
    other_present_out: 0,
    other_absent_in: 0,
    other_absent_out: 0,
  }
}

export type DataOverviewTreeNode = {
  key: string
  label: string
  count: number
  children?: DataOverviewTreeNode[]
}

/** 净值日期档 × 是否在 JY跟踪池. */
export type PoolSplit = { in: number; out: number }

export type NavAgePoolCounts = {
  m1: PoolSplit
  m1_3: PoolSplit
  m3_6: PoolSplit
  over_m6: PoolSplit
  none: PoolSplit
}

export function emptyNavAge(): NavAgePoolCounts {
  return {
    m1: { in: 0, out: 0 },
    m1_3: { in: 0, out: 0 },
    m3_6: { in: 0, out: 0 },
    over_m6: { in: 0, out: 0 },
    none: { in: 0, out: 0 },
  }
}

export type DataOverviewResponse = {
  scope: DataOverviewScope
  scope_label: string
  description: string
  total: number
  generated_at: string
  /** 产品总数 → 私募基金|其他 → 有净值|无净值 → 在跟踪池|不在跟踪池. */
  nav_class: NavClassCounts
  /** 有净值页：较新净值日期档 × 在跟踪池|不在跟踪池. */
  nav_age: NavAgePoolCounts
  sections: DataOverviewSection[]
}

function poolLeaves(inPool: number, outPool: number): DataOverviewTreeNode[] {
  return [
    { key: "in", label: "在跟踪池", count: inPool },
    { key: "out", label: "不在跟踪池", count: outPool },
  ]
}

const NAV_AGE_BUCKETS: Array<{ key: keyof NavAgePoolCounts; label: string }> = [
  { key: "m1", label: "1个月以内" },
  { key: "m1_3", label: "1-3个月" },
  { key: "m3_6", label: "3-6个月" },
  { key: "over_m6", label: "6个月以上" },
]

/** 有净值 → 1个月以内|1-3个月|3-6个月|6个月以上 → 在跟踪池|不在跟踪池. Each count is the sum of its children. */
export function navAgeTree(ages: NavAgePoolCounts): DataOverviewTreeNode {
  const buckets = [...NAV_AGE_BUCKETS]
  const undated = (ages.none?.in ?? 0) + (ages.none?.out ?? 0)
  if (undated > 0) buckets.push({ key: "none", label: "无净值日期" })
  const children = buckets.map((bucket) => {
    const split = ages[bucket.key] ?? { in: 0, out: 0 }
    const inside = split.in ?? 0
    const outside = split.out ?? 0
    return {
      key: bucket.key,
      label: bucket.label,
      count: inside + outside,
      children: poolLeaves(inside, outside),
    }
  })
  return {
    key: "present",
    label: "有净值",
    count: children.reduce((sum, node) => sum + node.count, 0),
    children,
  }
}

/** 产品总数 → 私募基金|其他 → 有净值|无净值 → 在跟踪池|不在跟踪池. Each count is the sum of its children. */
export function productTotalTree(total: number, navClass: NavClassCounts): DataOverviewTreeNode {
  const privatePresent = navClass.private_present
  const privateAbsent = navClass.private_absent
  const otherPresent = navClass.other_present
  const otherAbsent = navClass.other_absent
  return {
    key: "total",
    label: "产品总数",
    count: total,
    children: [
      {
        key: "private",
        label: "私募基金",
        count: privatePresent + privateAbsent,
        children: [
          {
            key: "present",
            label: "有净值",
            count: privatePresent,
            children: poolLeaves(navClass.private_present_in ?? 0, navClass.private_present_out ?? 0),
          },
          {
            key: "absent",
            label: "无净值",
            count: privateAbsent,
            children: poolLeaves(navClass.private_absent_in ?? 0, navClass.private_absent_out ?? 0),
          },
        ],
      },
      {
        key: "other",
        label: "其他",
        count: otherPresent + otherAbsent,
        children: [
          {
            key: "present",
            label: "有净值",
            count: otherPresent,
            children: poolLeaves(navClass.other_present_in ?? 0, navClass.other_present_out ?? 0),
          },
          {
            key: "absent",
            label: "无净值",
            count: otherAbsent,
            children: poolLeaves(navClass.other_absent_in ?? 0, navClass.other_absent_out ?? 0),
          },
        ],
      },
    ],
  }
}

export const DATA_OVERVIEW_SCOPES: Array<{ key: DataOverviewScope; label: string }> = [
  { key: "all", label: "全库" },
  { key: "nav", label: "有净值" },
  { key: "tracking", label: "跟踪池" },
  { key: "team", label: "团队数据" },
  { key: "platform", label: "平台数据" },
]

export type WeekBucket = "w0" | "w1" | "w2" | "w3" | "m1_3" | "m3_6" | "over_m6" | "none"

export const WEEK_BUCKETS: WeekBucket[] = ["w0", "w1", "w2", "w3", "m1_3", "m3_6", "over_m6", "none"]

export const WEEK_BUCKET_LABEL: Record<WeekBucket, string> = {
  w0: "最新一周",
  w1: "滞后1周",
  w2: "滞后2周",
  w3: "滞后3周",
  m1_3: "滞后1–3个月",
  m3_6: "滞后3–6个月",
  over_m6: "滞后6个月以上",
  none: "无日期",
}

/** 净值月内新鲜度 rows that open a product list. */
export const FRESHNESS_LIST_BUCKETS = ["w2", "w3"] as const

export type FreshnessListBucket = (typeof FRESHNESS_LIST_BUCKETS)[number]

export function parseFreshnessListBucket(raw: string | null): FreshnessListBucket | null {
  if (raw === "w2" || raw === "w3") return raw
  return null
}

export const FRESHNESS_LIST_HINT: Record<FreshnessListBucket, string> = {
  w2: "较新的净值日距今 15 到 21 天。",
  w3: "较新的净值日距今 22 到 28 天。",
}

export type FreshnessProduct = {
  code: string
  name: string
  nav_date: string
  lag_days: number
  in_pool: boolean
}

export type FreshnessProductList = {
  scope: DataOverviewScope
  scope_label: string
  bucket: FreshnessListBucket
  label: string
  hint: string
  as_of: string
  total: number
  products: FreshnessProduct[]
}

export type NavDateBucket = "m1" | "m1_3" | "m3_6" | "over_m6" | "none"

export type InceptionGapBucket = "w2" | "w2_m1" | "m1_3" | "m3_6" | "m6_12" | "over_y1"

export function emptyWeekCounts(): Record<WeekBucket, number> {
  return { w0: 0, w1: 0, w2: 0, w3: 0, m1_3: 0, m3_6: 0, over_m6: 0, none: 0 }
}

export function emptyInceptionGapCounts(): Record<InceptionGapBucket, number> {
  return { w2: 0, w2_m1: 0, m1_3: 0, m3_6: 0, m6_12: 0, over_y1: 0 }
}

export function shanghaiToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

export function isoDay(raw: string | null | undefined): string {
  const day = (raw ?? "").trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ""
}

/** Later of the product-page team date and the platform date. An empty side drops out. */
export function laterNavDate(a: string | null | undefined, b: string | null | undefined): string {
  const left = isoDay(a)
  const right = isoDay(b)
  if (!left) return right
  if (!right) return left
  return left >= right ? left : right
}

/** Calendar-month shift with the same end-of-month clamp as PostgreSQL `date ± interval`. */
export function addCalendarMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number)
  const cursor = new Date(Date.UTC(year, month - 1, 1))
  cursor.setUTCMonth(cursor.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate()
  const clamped = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), Math.min(day, lastDay)))
  return clamped.toISOString().slice(0, 10)
}

export function daysBetween(later: string, earlier: string): number | null {
  const a = Date.parse(`${isoDay(later)}T00:00:00Z`)
  const b = Date.parse(`${isoDay(earlier)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((a - b) / 86_400_000)
}

/**
 * Age of a NAV date against Shanghai today.
 * 最新一周 is 0–7 days, 滞后1周 is 8–14 days, then 15–21, 22–28, then calendar months.
 * A missing date is 无日期. A future date stays in 最新一周.
 */
export function weekBucket(navDate: string | null | undefined, today: string): WeekBucket {
  const day = isoDay(navDate)
  if (!day) return "none"
  const lag = daysBetween(today, day)
  if (lag == null) return "none"
  if (lag <= 7) return "w0"
  if (lag <= 14) return "w1"
  if (lag <= 21) return "w2"
  if (lag <= 28) return "w3"
  if (day >= addCalendarMonths(today, -3)) return "m1_3"
  if (day >= addCalendarMonths(today, -6)) return "m3_6"
  return "over_m6"
}

/** Same exclusive windows as the 平台数据 净值日期 filter. */
export function navDateBucket(navDate: string | null | undefined, today: string): NavDateBucket {
  const day = isoDay(navDate)
  if (!day) return "none"
  if (day >= addCalendarMonths(today, -1)) return "m1"
  if (day >= addCalendarMonths(today, -3)) return "m1_3"
  if (day >= addCalendarMonths(today, -6)) return "m3_6"
  return "over_m6"
}

/** Same 14-day window as 团队净值. A missing date counts as 滞后超2周. */
export function teamLagBucket(navDate: string | null | undefined, today: string): "within_2w" | "behind_2w" {
  const day = isoDay(navDate)
  if (!day) return "behind_2w"
  const lag = daysBetween(today, day)
  if (lag == null || lag > 14) return "behind_2w"
  return "within_2w"
}

export function overviewRows(
  total: number,
  items: Array<{ key: string; label: string; count: number; href?: string }>,
): DataOverviewRow[] {
  return items.map((item) => ({
    key: item.key,
    label: item.label,
    count: item.count,
    share: total > 0 ? item.count / total : 0,
    href: item.href,
  }))
}
