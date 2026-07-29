/**
 * China A-share trading calendar helpers for NAV series.
 * Weekends and CN public holidays are treated as non-trading days.
 */

import Holidays from "date-holidays"

import { isoDateWeekdayUtc, parseIsoDateParts } from "@/lib/nav-trading-day"

const holidayCalendar = new Holidays("CN")

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
