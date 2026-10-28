/**
 * Client-safe NAV trading-day helpers (no date-holidays dependency).
 * Weekends are never shown as NAV dates; CN public holidays are handled server-side.
 */

import cnStatutoryHolidayDates from "@/lib/cn-statutory-holiday-dates.json"

/** Normalize API/DB date strings to YYYY-MM-DD for `<input type="date">`, or "" if invalid. */
export function toIsoDateInputValue(value: unknown): string {
  if (value == null) return ""
  const text = String(value).trim()
  if (!text) return ""
  const isoPrefix = text.slice(0, 10)
  if (parseIsoDateParts(isoPrefix)) return isoPrefix
  const m = text.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/)
  if (m) {
    const candidate = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
    return parseIsoDateParts(candidate) ? candidate : ""
  }
  return ""
}

/** Parse YYYY-MM-DD prefix; invalid → null. */
export function parseIsoDateParts(isoDate: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? "").trim())
  if (!m) return null
  const y = Number(m[1])
  const month = Number(m[2])
  const d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(month) || !Number.isFinite(d)) return null
  if (month < 1 || month > 12 || d < 1 || d > 31) return null
  return { y, m: month, d }
}

/** Day of week for a calendar date (0=Sun…6=Sat), timezone-independent. */
export function isoDateWeekdayUtc(isoDate: string): number | null {
  const parts = parseIsoDateParts(isoDate)
  if (!parts) return null
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d, 12, 0, 0)).getUTCDay()
}

export function isWeekendIsoDate(isoDate: string): boolean {
  const wd = isoDateWeekdayUtc(isoDate)
  return wd == null || wd === 0 || wd === 6
}

/** Drop Sat/Sun rows from a NAV-like series (keeps original order). */
export function filterWeekendNavRows<T extends { price_date: string }>(rows: T[]): T[] {
  return rows.filter((row) => !isWeekendIsoDate(row.price_date))
}

const CN_STATUTORY_HOLIDAY_DATES = new Set(cnStatutoryHolidayDates as string[])

/**
 * Inclusive A-share trading-day count between two YYYY-MM-DD dates.
 * Weekends and State Council 放假/调休 rest days (from cn-statutory-holiday-dates) are skipped.
 * Client-safe (no date-holidays). Aligns with product 运作天数 for typical spans.
 */
export function countChinaTradingDaysInclusive(startIso: string, endIso: string): number {
  const start = String(startIso ?? "").slice(0, 10)
  const end = String(endIso ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
    return 0
  }
  const startParts = parseIsoDateParts(start)
  const endParts = parseIsoDateParts(end)
  if (!startParts || !endParts) return 0

  let count = 0
  const cursor = new Date(Date.UTC(startParts.y, startParts.m - 1, startParts.d, 12, 0, 0))
  const endMs = Date.UTC(endParts.y, endParts.m - 1, endParts.d, 12, 0, 0)
  while (cursor.getTime() <= endMs) {
    const iso = cursor.toISOString().slice(0, 10)
    const wd = cursor.getUTCDay()
    if (wd !== 0 && wd !== 6 && !CN_STATUTORY_HOLIDAY_DATES.has(iso)) count++
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return count
}
