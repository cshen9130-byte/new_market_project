/**
 * Equal-weight strategy NAV lines for 周度回顾.
 * Each point is the compounded average weekly return of every fund in the
 * database that belongs to that strategy, not the tracking-pool subset.
 */

export const STRATEGY_NAV_MIN_PRINTS = 1

export const WEEKLY_REVIEW_STRATEGY_NAV_NOTE =
  "每条线是库内归入该策略的全部产品的等权累计净值，按周复合。跟踪池表格里的产品数不参与计算。同一备案号家族的 A/B/C 份额只保留净值周数更多的一条。当周涨跌超过 20%，或与上一条净值相隔超过 21 天的，不计入。某一周有产品给出可用净值时，按这些产品的平均涨跌更新，否则沿用上一周。括号里是计入过这条线的产品只数。打开时显示最近 6 个月。起点对齐打开时，窗口左端那天每条线都从 100 起。"

export type WeeklyReviewStrategyNavVariant = "equity" | "futures"

export type WeeklyReviewStrategyNavStat = {
  bucket: string
  week: string
  avgRet: number
  n: number
  funds: number
}

export type WeeklyReviewStrategyNavSeries = {
  bucket: string
  count: number
  values: Array<number | null>
}

export type WeeklyReviewStrategyNav = {
  variant: WeeklyReviewStrategyNavVariant
  note: string
  dates: string[]
  series: WeeklyReviewStrategyNavSeries[]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function compound(
  dates: readonly string[],
  byWeek: ReadonlyMap<string, { avgRet: number; n: number }>,
): Array<number | null> {
  let index = 100
  let started = false
  const out: Array<number | null> = []
  for (const week of dates) {
    const row = byWeek.get(week)
    const usable = row != null && row.n >= STRATEGY_NAV_MIN_PRINTS && Number.isFinite(row.avgRet)
    if (!started) {
      if (!usable || !row) {
        out.push(null)
        continue
      }
      started = true
      index = 100 * (1 + row.avgRet)
      out.push(round2(index))
      continue
    }
    if (usable && row) index *= 1 + row.avgRet
    out.push(round2(index))
  }
  return out
}

/** One shared weekly axis. A strategy with too few prints that week keeps its last level. */
export function buildWeeklyReviewStrategyNav(
  variant: WeeklyReviewStrategyNavVariant,
  stats: readonly WeeklyReviewStrategyNavStat[],
): WeeklyReviewStrategyNav {
  const dates = [...new Set(stats.map((row) => row.week))].filter(Boolean).sort()
  const byBucket = new Map<string, { funds: number; weeks: Map<string, { avgRet: number; n: number }> }>()
  for (const row of stats) {
    if (!row.bucket || !row.week) continue
    const group = byBucket.get(row.bucket) ?? { funds: 0, weeks: new Map() }
    group.funds = Math.max(group.funds, row.funds)
    if (Number.isFinite(row.avgRet)) group.weeks.set(row.week, { avgRet: row.avgRet, n: row.n })
    byBucket.set(row.bucket, group)
  }
  const series: WeeklyReviewStrategyNavSeries[] = []
  for (const [bucket, group] of byBucket) {
    if (group.funds < STRATEGY_NAV_MIN_PRINTS) continue
    const values = compound(dates, group.weeks)
    if (!values.some((value) => value != null)) continue
    series.push({ bucket, count: group.funds, values })
  }
  series.sort((a, b) => a.bucket.localeCompare(b.bucket, "zh"))
  return {
    variant,
    note: WEEKLY_REVIEW_STRATEGY_NAV_NOTE,
    dates,
    series,
  }
}
