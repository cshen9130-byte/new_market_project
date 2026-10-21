/**
 * JY跟踪池周度回顾 · 近三周净值是否齐。
 * A week counts as present when the weekly-review series has a print on
 * Monday–Friday of that week — the same rule that fills 近一周 in the workbook.
 * Source is the 数据概览 update channel: newest date, then 手动 > 邮箱 > fof99.
 */

export type WeeklyReviewStatusVariant = "equity" | "futures"

export type WeeklyReviewSource = "email" | "manual" | "fof99" | "none"

export type WeekWindow = {
  week_start: string
  week_end: string
}

export type SourceHit = {
  source: Exclude<WeeklyReviewSource, "none">
  date: string
}

export const WEEKLY_REVIEW_SOURCE_ORDER: WeeklyReviewSource[] = ["email", "manual", "fof99", "none"]

export const WEEKLY_REVIEW_SOURCE_LABEL: Record<WeeklyReviewSource, string> = {
  email: "邮箱抓取",
  manual: "手动更新",
  fof99: "fof99",
  none: "无团队更新",
}

const SOURCE_RANK: Record<Exclude<WeeklyReviewSource, "none">, number> = {
  manual: 3,
  email: 2,
  fof99: 1,
}

export type WeeklyReviewSourceCounts = Record<WeeklyReviewSource, number>

export function emptySourceCounts(): WeeklyReviewSourceCounts {
  return { email: 0, manual: 0, fof99: 0, none: 0 }
}

export type WeeklyReviewWeekCell = {
  week_start: string
  week_end: string
  missing: number
  by_source: WeeklyReviewSourceCounts
}

export type WeeklyReviewMissingFund = {
  beian_hao: string
  name: string
  source: WeeklyReviewSource
  source_date: string | null
  /** Latest print the weekly review would use, on or before the newest week end. */
  nav_date: string | null
  /** True when that week has a print. Keyed by week_end. */
  weeks: Record<string, boolean>
  /** Week ends where the update channel has a print but the weekly-review series does not. */
  unused_weeks: string[]
}

export type WeeklyReviewMetricMode = "excess" | "absolute"

export function weeklyReviewMetricLabel(mode: WeeklyReviewMetricMode | null | undefined): string {
  if (mode === "excess") return "超额收益 / 超额最大回撤"
  if (mode === "absolute") return "收益 / 夏普 / 卡玛"
  return "—"
}

export type WeeklyReviewCategoryStatus = {
  bucket: string
  mode: WeeklyReviewMetricMode
  total: number
  weeks: WeeklyReviewWeekCell[]
  missing_funds: WeeklyReviewMissingFund[]
}

export type WeeklyReviewDataStatus = {
  variant: WeeklyReviewStatusVariant
  weeks: WeekWindow[]
  fund_count: number
  categories: WeeklyReviewCategoryStatus[]
  generated_at: string
}

export type StatusFundInput = {
  beian_hao: string
  name: string
  bucket: string
  nav_dates: readonly string[]
  source: WeeklyReviewSource
  source_date: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function coversWeek(navDates: readonly string[], week: WeekWindow): boolean {
  for (const date of navDates) {
    if (date >= week.week_start && date <= week.week_end) return true
  }
  return false
}

export function latestNavOnOrBefore(navDates: readonly string[], asOf: string): string | null {
  let best: string | null = null
  for (const date of navDates) {
    if (!ISO_DATE.test(date) || date > asOf) continue
    if (best == null || date > best) best = date
  }
  return best
}

/** Newest channel date wins. The same day prefers 手动, then 邮箱, then fof99. */
export function pickBestSource(hits: readonly SourceHit[]): { source: WeeklyReviewSource; date: string | null } {
  let best: SourceHit | null = null
  for (const hit of hits) {
    if (!ISO_DATE.test(hit.date)) continue
    if (
      !best
      || hit.date > best.date
      || (hit.date === best.date && SOURCE_RANK[hit.source] > SOURCE_RANK[best.source])
    ) {
      best = hit
    }
  }
  return best ? { source: best.source, date: best.date } : { source: "none", date: null }
}

function sourceInWeek(sourceDate: string | null, week: WeekWindow): boolean {
  return sourceDate != null && sourceDate >= week.week_start && sourceDate <= week.week_end
}

export function buildWeeklyReviewDataStatus(args: {
  variant: WeeklyReviewStatusVariant
  weeks: WeekWindow[]
  bucketOrder: readonly string[]
  funds: readonly StatusFundInput[]
  generatedAt: string
  modeFor?: (bucket: string) => WeeklyReviewMetricMode
}): WeeklyReviewDataStatus {
  const byBucket = new Map<string, StatusFundInput[]>()
  for (const fund of args.funds) {
    const list = byBucket.get(fund.bucket) ?? []
    list.push(fund)
    byBucket.set(fund.bucket, list)
  }
  const names = [...args.bucketOrder]
  for (const name of [...byBucket.keys()].sort((a, b) => a.localeCompare(b, "zh"))) {
    if (!names.includes(name)) names.push(name)
  }
  const asOf = args.weeks[0]?.week_end ?? ""
  const modeFor = args.modeFor ?? (() => "absolute" as const)

  const categories: WeeklyReviewCategoryStatus[] = names.map((bucket) => {
    const funds = byBucket.get(bucket) ?? []
    const weeks: WeeklyReviewWeekCell[] = args.weeks.map((week) => ({
      week_start: week.week_start,
      week_end: week.week_end,
      missing: 0,
      by_source: emptySourceCounts(),
    }))
    const missingFunds: WeeklyReviewMissingFund[] = []
    for (const fund of funds) {
      const covered = args.weeks.map((week) => coversWeek(fund.nav_dates, week))
      const weekMap: Record<string, boolean> = {}
      const unused: string[] = []
      covered.forEach((present, index) => {
        const week = args.weeks[index]
        weekMap[week.week_end] = present
        if (present) return
        weeks[index].missing += 1
        weeks[index].by_source[fund.source] += 1
        if (sourceInWeek(fund.source_date, week)) unused.push(week.week_end)
      })
      if (covered.every(Boolean)) continue
      missingFunds.push({
        beian_hao: fund.beian_hao,
        name: fund.name,
        source: fund.source,
        source_date: fund.source_date,
        nav_date: asOf ? latestNavOnOrBefore(fund.nav_dates, asOf) : null,
        weeks: weekMap,
        unused_weeks: unused,
      })
    }
    missingFunds.sort((a, b) => {
      const sourceDelta = WEEKLY_REVIEW_SOURCE_ORDER.indexOf(a.source) - WEEKLY_REVIEW_SOURCE_ORDER.indexOf(b.source)
      if (sourceDelta !== 0) return sourceDelta
      return a.name.localeCompare(b.name, "zh")
    })
    return { bucket, mode: modeFor(bucket), total: funds.length, weeks, missing_funds: missingFunds }
  })

  return {
    variant: args.variant,
    weeks: args.weeks.map((week) => ({ week_start: week.week_start, week_end: week.week_end })),
    fund_count: new Set(args.funds.map((fund) => fund.beian_hao)).size,
    categories,
    generated_at: args.generatedAt,
  }
}
