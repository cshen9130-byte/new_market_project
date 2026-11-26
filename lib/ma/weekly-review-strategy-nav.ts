/**
 * Equal-weight strategy NAV lines for 周度回顾.
 * Each point is the compounded average weekly return of every fund in the
 * selected universe that belongs to that strategy, not the tracking-pool subset
 * unless that universe is chosen.
 */

export const STRATEGY_NAV_MIN_PRINTS = 1

const STRATEGY_NAV_METHOD_NOTE =
  "同一备案号家族的 A/B/C 份额只保留净值周数更多的一条。当周涨跌超过 20%，或与上一条净值相隔超过 21 天的，不计入。某一周有产品给出可用净值时，按这些产品的平均涨跌更新，否则沿用上一周。括号里是计入过这条线的产品只数。打开时显示最近 6 个月。起点对齐打开时，窗口左端那天每条线都从 100 起。"

export const WEEKLY_REVIEW_STRATEGY_NAV_NOTE =
  `每条线是库内归入该策略的全部产品的等权累计净值，按周复合。跟踪池表格里的产品数不参与计算。${STRATEGY_NAV_METHOD_NOTE}`

export const STRATEGY_NAV_UNIVERSES = [
  { key: "market", label: "市场全部" },
  { key: "tracking", label: "跟踪池" },
  { key: "xiaohe", label: "小荷公众号" },
  { key: "ima", label: "ima点睛" },
  { key: "yt", label: "YT" },
] as const

export type WeeklyReviewStrategyNavUniverse = (typeof STRATEGY_NAV_UNIVERSES)[number]["key"]

export const STRATEGY_NAV_UNIVERSE_LABEL: Record<WeeklyReviewStrategyNavUniverse, string> = {
  market: "市场全部",
  tracking: "跟踪池",
  xiaohe: "小荷公众号",
  ima: "ima点睛",
  yt: "YT",
}

export type WeeklyReviewStrategyNavMode = "universe" | "compare"

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
  mode: WeeklyReviewStrategyNavMode
  universe: WeeklyReviewStrategyNavUniverse
  strategy?: string
  week_end?: string
  note: string
  dates: string[]
  series: WeeklyReviewStrategyNavSeries[]
}

const UNIVERSE_KEYS = new Set<string>(STRATEGY_NAV_UNIVERSES.map((row) => row.key))

/** Accept the public keys, plus a few aliases used in query strings. Never a YT expansion. */
export function parseStrategyNavUniverse(raw: string | null | undefined): WeeklyReviewStrategyNavUniverse {
  const token = (raw ?? "").trim().toLowerCase()
  if (token === "jy" || token === "tracking") return "tracking"
  if (UNIVERSE_KEYS.has(token)) return token as WeeklyReviewStrategyNavUniverse
  return "market"
}

export function parseStrategyNavMode(raw: string | null | undefined): WeeklyReviewStrategyNavMode {
  const token = (raw ?? "").trim().toLowerCase()
  return token === "compare" || token === "1" || token === "true" ? "compare" : "universe"
}

export function strategyNavNote(
  mode: WeeklyReviewStrategyNavMode,
  universe: WeeklyReviewStrategyNavUniverse = "market",
): string {
  if (mode === "compare") {
    return `每条线是同一策略在该来源中的等权累计净值，按周复合。没有可匹配产品或可用净值的来源不画线。${STRATEGY_NAV_METHOD_NOTE}`
  }
  if (universe === "tracking") {
    return `每条线是 JY跟踪池中归入该策略的产品的等权累计净值，按周复合。${STRATEGY_NAV_METHOD_NOTE}`
  }
  if (universe === "xiaohe") {
    return `每条线是本周小荷公众号榜上能匹配到备案号、且归入该策略的产品的等权累计净值，按周复合。${STRATEGY_NAV_METHOD_NOTE}`
  }
  if (universe === "ima") {
    return `每条线是本周 ima点睛榜上按管理人匹配到的产品、且归入该策略的等权累计净值，按周复合。${STRATEGY_NAV_METHOD_NOTE}`
  }
  if (universe === "yt") {
    return `每条线是 YT 来源中归入该策略的产品的等权累计净值，按周复合。${STRATEGY_NAV_METHOD_NOTE}`
  }
  return WEEKLY_REVIEW_STRATEGY_NAV_NOTE
}

export function sortStrategyNavCompareSeries(
  series: WeeklyReviewStrategyNavSeries[],
): WeeklyReviewStrategyNavSeries[] {
  const order = STRATEGY_NAV_UNIVERSES.map((row) => row.label)
  return [...series].sort((a, b) => {
    const ia = order.indexOf(a.bucket)
    const ib = order.indexOf(b.bucket)
    const sa = ia < 0 ? order.length : ia
    const sb = ib < 0 ? order.length : ib
    if (sa !== sb) return sa - sb
    return a.bucket.localeCompare(b.bucket, "zh")
  })
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
  options?: {
    mode?: WeeklyReviewStrategyNavMode
    universe?: WeeklyReviewStrategyNavUniverse
    strategy?: string
    weekEnd?: string
  },
): WeeklyReviewStrategyNav {
  const mode = options?.mode === "compare" ? "compare" : "universe"
  const universe = options?.universe ?? "market"
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
  if (mode === "compare") {
    const ordered = sortStrategyNavCompareSeries(series)
    series.length = 0
    series.push(...ordered)
  } else {
    series.sort((a, b) => a.bucket.localeCompare(b.bucket, "zh"))
  }
  return {
    variant,
    mode,
    universe,
    strategy: options?.strategy,
    week_end: options?.weekEnd,
    note: strategyNavNote(mode, universe),
    dates,
    series,
  }
}

/** Overlay one strategy from precomputed universe snapshots onto a shared week axis. */
export function assembleStrategyNavCompare(
  variant: WeeklyReviewStrategyNavVariant,
  strategy: string,
  weekEnd: string | undefined,
  sources: ReadonlyArray<{ universe: WeeklyReviewStrategyNavUniverse; body: WeeklyReviewStrategyNav }>,
): WeeklyReviewStrategyNav {
  const wanted = strategy.trim()
  const byUniverse = new Map(sources.map((row) => [row.universe, row.body]))
  const dateSet = new Set<string>()
  const picked: Array<{ label: string; count: number; byDate: Map<string, number | null> }> = []
  for (const row of STRATEGY_NAV_UNIVERSES) {
    const body = byUniverse.get(row.key)
    const series = body?.series.find((item) => item.bucket === wanted)
    if (!body || !series) continue
    const byDate = new Map<string, number | null>()
    body.dates.forEach((date, index) => {
      const value = series.values[index]
      byDate.set(date, value == null || !Number.isFinite(value) ? null : value)
      dateSet.add(date)
    })
    if (![...byDate.values()].some((value) => value != null)) continue
    picked.push({ label: row.label, count: series.count, byDate })
  }
  const dates = [...dateSet].sort()
  const series = picked
    .map((row) => ({
      bucket: row.label,
      count: row.count,
      values: dates.map((date) => {
        const value = row.byDate.get(date)
        return value == null || !Number.isFinite(value) ? null : value
      }),
    }))
    .filter((row) => row.values.some((value) => value != null))
  return {
    variant,
    mode: "compare",
    universe: "market",
    strategy: wanted,
    week_end: weekEnd,
    note: strategyNavNote("compare"),
    dates,
    series: sortStrategyNavCompareSeries(series),
  }
}
