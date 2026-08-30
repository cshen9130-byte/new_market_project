/**
 * China A-share trading calendar helpers for NAV series.
 * Weekends and CN public holidays are treated as non-trading days.
 */

import Holidays from "date-holidays"

import { isoDateWeekdayUtc, parseIsoDateParts } from "@/lib/nav-trading-day"

const holidayCalendar = new Holidays("CN")

/**
 * Official State Council 放假调休 dates (including weekend days in the range).
 * `date-holidays` only has the statutory core days, so 调休 weekdays must be listed.
 * 2025: 国办发明电〔2024〕12号; 2026: 国办发明电〔2025〕7号.
 */
const CN_STATUTORY_HOLIDAY_DATES = new Set([
  // 2025
  "2025-01-01",
  "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31",
  "2025-02-01", "2025-02-02", "2025-02-03", "2025-02-04",
  "2025-04-04", "2025-04-05", "2025-04-06",
  "2025-05-01", "2025-05-02", "2025-05-03", "2025-05-04", "2025-05-05",
  "2025-05-31", "2025-06-01", "2025-06-02",
  "2025-10-01", "2025-10-02", "2025-10-03", "2025-10-04",
  "2025-10-05", "2025-10-06", "2025-10-07", "2025-10-08",
  // 2026
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19",
  "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
  "2026-10-05", "2026-10-06", "2026-10-07",
])

/** Calendar date YYYY-MM-DD in Asia/Shanghai (not UTC). */
export function shanghaiTodayIsoDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

/** True when `isoDate` (YYYY-MM-DD) is a China A-share trading day. */
export function isChinaTradingDay(isoDate: string): boolean {
  const parts = parseIsoDateParts(isoDate)
  if (!parts) return false
  const weekday = isoDateWeekdayUtc(isoDate)
  if (weekday == null || weekday === 0 || weekday === 6) return false
  // Holidays calendar uses local civil date components (not UTC instant).
  const localDate = new Date(parts.y, parts.m - 1, parts.d)
  return !holidayCalendar.isHoliday(localDate)
}

/** Weekend or official PRC public-holiday / 调休 rest day (补班 weekends still count as rest). */
export function isChinaWeekendOrPublicHoliday(isoDate: string): boolean {
  if (CN_STATUTORY_HOLIDAY_DATES.has(isoDate)) return true
  return !isChinaTradingDay(isoDate)
}
