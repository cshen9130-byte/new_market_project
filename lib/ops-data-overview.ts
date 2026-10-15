/**
 * Shared shapes and date buckets for 运维 → 数据维护 → 数据概览.
 * Date windows match the 团队数据 / 平台数据 list filters.
 */

export type DataOverviewScope = "all" | "team" | "platform" | "tracking"

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

export type DataOverviewResponse = {
  scope: DataOverviewScope
  scope_label: string
  description: string
  total: number
  generated_at: string
  sections: DataOverviewSection[]
}

export const DATA_OVERVIEW_SCOPES: Array<{ key: DataOverviewScope; label: string }> = [
  { key: "all", label: "全库" },
  { key: "team", label: "团队数据" },
  { key: "platform", label: "平台数据" },
  { key: "tracking", label: "跟踪池" },
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
