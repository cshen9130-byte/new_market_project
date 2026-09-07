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
 * 2018–2024 State Council 放假安排; 2025: 国办发明电〔2024〕12号; 2026: 国办发明电〔2025〕7号.
 * Shared with the 火富牛 Friday fetch (`scripts/ma/cn_market_holidays.py`).
 */
const CN_STATUTORY_HOLIDAY_DATES = new Set(cnStatutoryHolidayDates)
const tradingDayCache = new Map<string, boolean>()
const weekendOrHolidayCache = new Map<string, boolean>()

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
  const day = isoDate.slice(0, 10)
  const cached = tradingDayCache.get(day)
  if (cached !== undefined) return cached
  let result = false
  if (!CN_STATUTORY_HOLIDAY_DATES.has(day)) {
    const parts = parseIsoDateParts(day)
    const weekday = parts ? isoDateWeekdayUtc(day) : null
    if (parts && weekday != null && weekday !== 0 && weekday !== 6) {
      // Holidays calendar uses local civil date components (not UTC instant).
      const localDate = new Date(parts.y, parts.m - 1, parts.d)
      result = !holidayCalendar.isHoliday(localDate)
    }
  }
  tradingDayCache.set(day, result)
  return result
}

/** Weekend or official PRC public-holiday / 调休 rest day (补班 weekends still count as rest). */
export function isChinaWeekendOrPublicHoliday(isoDate: string): boolean {
  const day = isoDate.slice(0, 10)
  const cached = weekendOrHolidayCache.get(day)
  if (cached !== undefined) return cached
  const result = CN_STATUTORY_HOLIDAY_DATES.has(day) || !isChinaTradingDay(day)
  weekendOrHolidayCache.set(day, result)
  return result
}

function addUtcDays(isoDate: string, days: number): string | null {
  const parts = parseIsoDateParts(isoDate)
  if (!parts) return null
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days, 12, 0, 0))
  return dt.toISOString().slice(0, 10)
}

/** Market-open days in (earlier, later]. Weekends and 法定节假日 / 调休 rest days are skipped. */
export function chinaMarketOpenDaysBetween(later: string, earlier: string): number {
  const start = earlier.slice(0, 10)
  const end = later.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) {
    return 0
  }
  let count = 0
  for (let cursor = addUtcDays(start, 1); cursor && cursor <= end; cursor = addUtcDays(cursor, 1)) {
    if (!isChinaWeekendOrPublicHoliday(cursor)) count++
  }
  return count
}
