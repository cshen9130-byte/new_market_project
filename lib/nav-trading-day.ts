/**
 * Client-safe NAV trading-day helpers (no date-holidays dependency).
 * Weekends are never shown as NAV dates; CN public holidays are handled server-side.
 */

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
