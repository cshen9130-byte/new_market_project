/**
 * Resolve the latest *available-data* week for auto weekly reports.
 *
 * Aligns with FOF weekly UI (isoWeekBegin / latestWeekRange in
 * FofWeeklyReportDialog) and CN trading calendar used elsewhere.
 *
 * Rule: a Mon–Fri week counts only when NAV covers its last trading day.
 * Example (today 2026-10-26):
 *   - latest NAV 2026-10-23 → week 2026-10-19..23
 *   - latest NAV 2026-10-22 (Fri still missing) → previous complete week 2026-10-12..16
 */

import {
  chinaMarketOpenDaysBetween,
  isChinaTradingDay,
  shanghaiTodayIsoDate,
} from "@/lib/server/china-trading-calendar"
import { mondayOfWeek } from "@/lib/server/jy-weekly-review"
import { parseIsoDateParts } from "@/lib/nav-trading-day"

function addUtcDays(isoDate: string, days: number): string | null {
  const parts = parseIsoDateParts(isoDate)
  if (!parts) return null
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days, 12, 0, 0))
    .toISOString()
    .slice(0, 10)
}

/** Last China A-share trading day in the Mon–Fri calendar week of `monday`. */
export function lastTradingDayOfIsoWeek(mondayIso: string): string | null {
  const monday = mondayIso.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday)) return null
  let last: string | null = null
  for (let i = 0; i <= 4; i++) {
    const day = addUtcDays(monday, i)
    if (!day) continue
    if (isChinaTradingDay(day)) last = day
  }
  return last
}

export type AvailableDataWeek = {
  weekStart: string
  weekEnd: string
  latestNavDate: string
}

/**
 * Pick the most recent Mon–Fri week whose last trading day is covered by `latestNavDate`.
 * Falls back to [monday(latest), latest] when no complete week is found in the lookback.
 */
export function resolveLatestAvailableDataWeek(
  latestNavDate: string,
  _today: string = shanghaiTodayIsoDate(),
): AvailableDataWeek | null {
  const latest = latestNavDate.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest)) return null

  let weekMonday = mondayOfWeek(latest)
  for (let i = 0; i < 12; i++) {
    const lastTrading = lastTradingDayOfIsoWeek(weekMonday)
    if (lastTrading && latest >= lastTrading) {
      return {
        weekStart: weekMonday,
        weekEnd: lastTrading,
        latestNavDate: latest,
      }
    }
    const prev = addUtcDays(weekMonday, -7)
    if (!prev) break
    weekMonday = prev
  }

  return {
    weekStart: mondayOfWeek(latest),
    weekEnd: latest,
    latestNavDate: latest,
  }
}

export type NextWeeklyReportGap = {
  /** Monday of the next Mon–Fri report week not yet fully covered by NAV. */
  nextWeekStart: string
  /** Last CN trading day of that next week. */
  nextWeekEnd: string
  /** Sunday (calendar weekend end) of that next week. */
  nextWeekendEnd: string
  latestNavDate: string
  /**
   * Missing CN trading days in (latestNavDate, nextWeekEnd], but only once
   * `today` has passed that week's weekend (Sunday). Until then → 0 (已最新).
   * Example (today 2026-10-26):
   *   - latest=2026-10-22, next week 10-19..23 → 1 (weekend ended Sun 10-25)
   *   - latest=2026-10-23, next week 10-26..30 → 0 (still inside that week)
   */
  daysBehind: number
}

/**
 * How many CN trading/NAV days are still missing to unlock the *next* weekly report.
 * Do not flag "behind" until the current calendar day has passed the target week's weekend.
 */
export function resolveNextWeeklyReportGap(
  latestNavDate: string,
  today: string = shanghaiTodayIsoDate(),
): NextWeeklyReportGap | null {
  const latest = latestNavDate.slice(0, 10)
  const todayIso = today.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest)) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) return null

  const complete = resolveLatestAvailableDataWeek(latest, todayIso)
  if (!complete) return null

  const nextWeekStart = addUtcDays(complete.weekStart, 7)
  if (!nextWeekStart) return null
  const nextWeekEnd = lastTradingDayOfIsoWeek(nextWeekStart)
  if (!nextWeekEnd) return null
  const nextWeekendEnd = addUtcDays(nextWeekStart, 6)
  if (!nextWeekendEnd) return null

  let daysBehind = 0
  // Only count missing NAV after the target week's weekend is over.
  if (todayIso > nextWeekendEnd && latest < nextWeekEnd) {
    daysBehind = chinaMarketOpenDaysBetween(nextWeekEnd, latest)
  }

  return {
    nextWeekStart,
    nextWeekEnd,
    nextWeekendEnd,
    latestNavDate: latest,
    daysBehind,
  }
}

/** Convenience: only the missing trading-day count (null when latest NAV unknown). */
export function daysBehindNextWeeklyReport(
  latestNavDate: string | null | undefined,
  today?: string,
): number | null {
  const raw = (latestNavDate || "").trim()
  if (!raw) return null
  const gap = resolveNextWeeklyReportGap(raw, today)
  return gap ? gap.daysBehind : null
}
