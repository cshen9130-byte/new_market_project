/** Best 公募指增 rows appended to a matching 周度回顾(股票) strategy sheet. */

export const PUBLIC_CATEGORY_BEST_COUNT = 5

export function meanOf(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (nums.length === 0) return null
  return nums.reduce((sum, value) => sum + value, 0) / nums.length
}

/**
 * Highest weekly values first. Rows without a finite week value are left out.
 * Equal values keep the incoming order, so sort by name first when ties should be stable.
 */
export function takeBestByWeek<T>(
  rows: readonly T[],
  weekOf: (row: T) => number | null | undefined,
  limit = PUBLIC_CATEGORY_BEST_COUNT,
): T[] {
  return [...rows]
    .filter((row) => {
      const week = weekOf(row)
      return week != null && Number.isFinite(week)
    })
    .sort((a, b) => (weekOf(b) ?? 0) - (weekOf(a) ?? 0))
    .slice(0, Math.max(0, limit))
}
