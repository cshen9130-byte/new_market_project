import { chinaMarketOpenDaysBetween } from "@/lib/server/china-trading-calendar"

/**
 * How often a product publishes NAV, judged from recent adjacent gaps.
 * Gaps are China market-open days, so a Friday-to-Monday step is one day
 * and a holiday week does not by itself turn a weekly fund into a monthly one.
 * 混合 means the recent window really does contain two different cadences.
 */

export const NAV_FREQUENCY_OPTIONS = ["日频", "周频", "双周", "月频", "季频", "混合", "其他", "无净值"] as const

export type NavFrequencyLabel = (typeof NAV_FREQUENCY_OPTIONS)[number]

export type NavFrequencyFilter = "all" | NavFrequencyLabel

const RECENT_GAPS = 24
const MIXED_MIN_GAPS = 4

const FAMILIES = ["日频", "周频", "双周", "月频", "季频", "其他"] as const
type NavFrequencyFamily = (typeof FAMILIES)[number]

const FAMILY_RANK: Record<NavFrequencyFamily, number> = {
  日频: 0,
  周频: 1,
  双周: 2,
  月频: 3,
  季频: 4,
  其他: 5,
}

export function isNavFrequencyLabel(value: string): value is NavFrequencyLabel {
  return (NAV_FREQUENCY_OPTIONS as readonly string[]).includes(value)
}

export function parseNavFrequencyFilter(value: string): NavFrequencyFilter {
  const text = value.trim()
  return isNavFrequencyLabel(text) ? text : "all"
}

function isoDay(raw: string): string {
  return raw.trim().slice(0, 10)
}

function lowerMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0
}

/** Open-day gap → cadence. 1–2 is the next session or one skipped session. */
export function navFrequencyFamily(openDays: number): NavFrequencyFamily {
  if (openDays <= 2) return "日频"
  if (openDays <= 7) return "周频"
  if (openDays <= 12) return "双周"
  if (openDays <= 25) return "月频"
  if (openDays <= 70) return "季频"
  return "其他"
}

/**
 * Classify a list of positive open-day gaps. Fewer than four gaps cannot be
 * 混合: one odd step is not a second cadence.
 */
export function classifyNavGaps(gaps: number[]): NavFrequencyLabel {
  const usable = gaps.filter((gap) => gap > 0)
  if (usable.length === 0) return "无净值"

  const counts = new Map<NavFrequencyFamily, number>()
  for (const gap of usable) {
    const family = navFrequencyFamily(gap)
    counts.set(family, (counts.get(family) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || FAMILY_RANK[a[0]] - FAMILY_RANK[b[0]])
  const top = ranked[0]
  const second = ranked[1]
  if (!top) return "无净值"
  const share = top[1] / usable.length
  if (
    usable.length >= MIXED_MIN_GAPS
    && second
    && share < 0.6
    && second[1] / usable.length >= 0.25
  ) {
    return "混合"
  }
  if (share >= 0.6) return top[0]
  return navFrequencyFamily(lowerMedian(usable))
}

/** Recent cadence of a NAV date list. Empty or a single point is 无净值. */
export function classifyNavFrequency(dates: string[]): NavFrequencyLabel {
  const sorted = [...new Set(dates.map(isoDay).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))].sort()
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const openDays = chinaMarketOpenDaysBetween(sorted[i], sorted[i - 1])
    if (openDays > 0) gaps.push(openDays)
  }
  if (gaps.length === 0) return "无净值"
  const recent = gaps.length > RECENT_GAPS ? gaps.slice(gaps.length - RECENT_GAPS) : gaps
  return classifyNavGaps(recent)
}
