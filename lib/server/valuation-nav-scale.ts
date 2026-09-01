/**
 * Detect when FOF 估值表 holdings NAV is a different series from platform/type6
 * (e.g. VN917B parent-scale type6 vs B-class 虚拟净值).
 */

export const VALUATION_SERIES_SCALE_MISMATCH_RATIO = 0.03

/** True when the latest overlapping date is a different NAV scale, not a one-day move. */
export function valuationScaleMismatchesSeries(
  series: Array<{ price_date?: string; nav?: string | number | null }>,
  valuation: Array<{ price_date?: string; nav?: string | number | null }>,
  ratio = VALUATION_SERIES_SCALE_MISMATCH_RATIO,
): boolean {
  const seriesNav = new Map<string, number>()
  for (const row of series) {
    const date = String(row.price_date ?? "").slice(0, 10)
    const nav = typeof row.nav === "number" ? row.nav : parseFloat(String(row.nav ?? ""))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(nav) || nav <= 0) continue
    seriesNav.set(date, nav)
  }
  let last: { seriesNav: number; valNav: number } | null = null
  for (const point of valuation) {
    const date = String(point.price_date ?? "").slice(0, 10)
    const nav = typeof point.nav === "number" ? point.nav : parseFloat(String(point.nav ?? ""))
    const base = seriesNav.get(date)
    if (base == null || !Number.isFinite(nav) || nav <= 0) continue
    last = { seriesNav: base, valNav: nav }
  }
  if (!last) return false
  return Math.abs(last.valNav / last.seriesNav - 1) > ratio
}
