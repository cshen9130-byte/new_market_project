/** Infer 运作日 when early NAV is a long empty stretch before regular disclosure. */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
/** ~2 months. Weekly funds that skip a few weeks stay below this. */
const LEADING_GAP_MIN_DAYS = 60
const LEADING_GAP_TYPICAL_MULT = 6
const MIN_DENSE_POINTS = 4

function isoDay(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, 10)
}

function calendarDaysBetween(later: string, earlier: string): number {
  const a = Date.parse(`${later}T00:00:00Z`)
  const b = Date.parse(`${earlier}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= b) return 0
  return Math.round((a - b) / 86_400_000)
}

function lowerMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0
}

/**
 * Start of the regular NAV window when the series is missing a long beginning
 * stretch (e.g. 成立日 1.0000 on 2020-12-23, then weekly NAV from 2024-12-20).
 *
 * Does not fire for a fund that discloses from inception and later has an
 * interior halt: only leading gaps larger than the later cadence are skipped.
 */
export function inferOperationDateFromNavSeries(
  dates: Array<string | null | undefined>,
  inceptionDate?: string | null,
): string | null {
  const sorted = [...new Set(dates.map(isoDay).filter((d) => ISO_DAY.test(d)))].sort()
  if (sorted.length === 0) return null

  const first = sorted[0]
  const inception = isoDay(inceptionDate)

  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(calendarDaysBetween(sorted[i], sorted[i - 1]))
  }

  const laterGaps = gaps.length >= 4 ? gaps.slice(Math.floor(gaps.length / 2)) : gaps
  const typical = lowerMedian(laterGaps.filter((g) => g > 0))
  const huge = Math.max((typical || 7) * LEADING_GAP_TYPICAL_MULT, LEADING_GAP_MIN_DAYS)

  let skip = 0
  while (skip < gaps.length && gaps[skip] > huge) skip += 1
  if (skip > 0 && sorted.length - skip >= MIN_DENSE_POINTS) {
    return sorted[skip]
  }

  if (ISO_DAY.test(inception) && first > inception) {
    if (calendarDaysBetween(first, inception) > LEADING_GAP_MIN_DAYS) return first
  }

  return null
}

/** Stored 运作日 wins; otherwise infer from a long leading NAV hole. */
export function resolveFundOperationDate(
  stored: string | null | undefined,
  dates: Array<string | null | undefined>,
  inceptionDate?: string | null,
): string | null {
  const day = isoDay(stored)
  if (ISO_DAY.test(day)) return day
  return inferOperationDateFromNavSeries(dates, inceptionDate)
}
