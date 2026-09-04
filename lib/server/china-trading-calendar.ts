/**
 * China A-share trading calendar helpers for NAV series.
 * Weekends and CN public holidays are treated as non-trading days.
 */

import Holidays from "date-holidays"

import cnStatutoryHolidayDates from "@/lib/cn-statutory-holiday-dates.json"
import { isoDateWeekdayUtc, parseIsoDateParts } from "@/lib/nav-trading-day"

const holidayCalendar = new Holidays("CN")

/**
 * Official State Council 放假调休 dates (including weekend days in the range).
 * `date-holidays` only has the statutory core days, so 调休 weekdays must be listed.
 * 2025: 国办发明电〔2024〕12号; 2026: 国办发明电〔2025〕7号.
 * Shared with the 火富牛 Friday fetch (`scripts/ma/cn_market_holidays.py`).
 */
const CN_STATUTORY_HOLIDAY_DATES = new Set(cnStatutoryHolidayDates)

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
