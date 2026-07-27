/**
 * China A-share trading calendar helpers for NAV series.
 * Weekends and CN public holidays are treated as non-trading days.
 */

import Holidays from "date-holidays"

const holidayCalendar = new Holidays("CN")

/** True when `isoDate` (YYYY-MM-DD) is a China A-share trading day. */
export function isChinaTradingDay(isoDate: string): boolean {
  const [yearToken, monthToken, dayToken] = isoDate.split("-")
  const year = Number(yearToken)
  const month = Number(monthToken)
  const day = Number(dayToken)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false
  const localDate = new Date(year, month - 1, day)
  const weekday = localDate.getDay()
  if (weekday === 0 || weekday === 6) return false
  return !holidayCalendar.isHoliday(localDate)
}
