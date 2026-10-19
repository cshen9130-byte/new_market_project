import { chinaMarketOpenDaysBetween } from "@/lib/server/china-trading-calendar"

/** Flag when missing NAV points exceed this share of expected points (first→last). */
export const TEAM_NAV_INTERIOR_MISSING_RATIO = 0.1

function isoDay(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, 10)
}

function lowerMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0
}

/** One stretch between two kept NAV dates that is wider than the product's usual step. */
export type InteriorNavHole = {
  from: string
  to: string
  /** China market-open days in (from, to]. */
  openDays: number
  /** Expected NAV points absent in this stretch. */
  missing: number
}

export type InteriorNavGapStats = {
  gapped: boolean
  first: string
  last: string
  count: number
  typical: number
  missing: number
  expected: number
  ratio: number
  holes: InteriorNavHole[]
}

function datesOnOrAfter(dates: string[], fromDate?: string | null): string[] {
  const start = isoDay(fromDate)
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return dates
  return dates.filter((d) => isoDay(d) >= start)
}

/**
 * Missing-NAV share between the first and last date, measured in China A-share
 * market-open days. Weekends and 法定节假日 / 调休 rest days are not expected
 * disclosure days, so they never count as holes.
 * Cadence is the lower-median adjacent interval (weekly funds that skip two
 * weeks stay at two points).
 * When `fromDate` is set (运作日), only NAV on/after that date is scored — the
 * current strategy window, not the whole history since first NAV.
 */
export function analyzeInteriorNavGap(dates: string[], fromDate?: string | null): InteriorNavGapStats {
  const sorted = [...new Set(datesOnOrAfter(dates, fromDate).map(isoDay).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
  const empty: InteriorNavGapStats = {
    gapped: false,
    first: sorted[0] ?? "",
    last: sorted[sorted.length - 1] ?? "",
    count: sorted.length,
    typical: 0,
    missing: 0,
    expected: 0,
    ratio: 0,
    holes: [],
  }
  if (sorted.length < 2) return empty

  const steps: Array<{ openDays: number; from: string; to: string }> = []
  for (let i = 1; i < sorted.length; i++) {
    const openDays = chinaMarketOpenDaysBetween(sorted[i], sorted[i - 1])
    // A stretch with no market-open days (weekend / 节假日 only) is not a hole.
    if (openDays <= 0) continue
    steps.push({ openDays, from: sorted[i - 1], to: sorted[i] })
  }
  if (steps.length === 0) return empty
  const typical = lowerMedian(steps.map((step) => step.openDays))
  if (typical <= 0) return empty
  const span = chinaMarketOpenDaysBetween(sorted[sorted.length - 1], sorted[0])
  if (span <= 0) return empty
  // 7 is trading days, not calendar days. Weekends / 节假日 are already
  // removed from `gap`, so a 春节 week does not reach this floor.
  const holeFloor = Math.max(typical * 2, 7)
  const holes: InteriorNavHole[] = []
  let missing = 0
  for (const step of steps) {
    if (step.openDays <= holeFloor) continue
    const holeMissing = step.openDays / typical - 1
    missing += holeMissing
    holes.push({
      from: step.from,
      to: step.to,
      openDays: step.openDays,
      missing: holeMissing,
    })
  }
  const expected = 1 + span / typical
  const ratio = missing / expected
  return {
    gapped: ratio > TEAM_NAV_INTERIOR_MISSING_RATIO,
    first: sorted[0],
    last: sorted[sorted.length - 1],
    count: sorted.length,
    typical,
    missing,
    expected,
    ratio,
    holes,
  }
}

export function hasInteriorNavGap(dates: string[], fromDate?: string | null): boolean {
  return analyzeInteriorNavGap(dates, fromDate).gapped
}
