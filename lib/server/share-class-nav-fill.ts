/**
 * Share NAV across parent / A·B·C share classes only when overlapping dates agree.
 * Non-分红 A类 (unit ≈ cum) can fill parent gaps and inherit parent type6 history.
 * 分红 classes diverge on overlap and are left untouched.
 */

export const SHARE_CLASS_NAV_OVERLAP_TOL = 0.005

type DatedNav = { date: string; nav: number }

function toDatedNav(
  row: { price_date?: string; nav_date?: string; nav: string | number },
): DatedNav | null {
  const date = String(row.price_date ?? row.nav_date ?? "").slice(0, 10)
  const nav = typeof row.nav === "number" ? row.nav : parseFloat(row.nav)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(nav > 0)) return null
  return { date, nav }
}

/** True when series share ≥1 date and every overlap is within 0.5% (same product, not 分红). */
export function navSeriesOverlapConsistent(
  left: Array<{ price_date?: string; nav_date?: string; nav: string | number }>,
  right: Array<{ price_date?: string; nav_date?: string; nav: string | number }>,
): boolean {
  const rightByDate = new Map<string, number>()
  for (const row of right) {
    const point = toDatedNav(row)
    if (point) rightByDate.set(point.date, point.nav)
  }
  let overlap = 0
  for (const row of left) {
    const point = toDatedNav(row)
    if (!point) continue
    const other = rightByDate.get(point.date)
    if (other == null) continue
    overlap++
    if (Math.abs(point.nav / other - 1) > SHARE_CLASS_NAV_OVERLAP_TOL) return false
  }
  return overlap >= 1
}

export function fillMissingRowsByDate<T extends { price_date?: string; nav_date?: string }>(
  target: T[],
  donor: T[],
): T[] {
  if (donor.length === 0) return target
  const have = new Set(
    target.map((row) => String(row.price_date ?? row.nav_date ?? "").slice(0, 10)),
  )
  const extra: T[] = []
  for (const row of donor) {
    const date = String(row.price_date ?? row.nav_date ?? "").slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || have.has(date)) continue
    have.add(date)
    extra.push(row)
  }
  if (extra.length === 0) return target
  return [...target, ...extra].sort((a, b) =>
    String(a.price_date ?? a.nav_date ?? "").localeCompare(String(b.price_date ?? b.nav_date ?? "")),
  )
}

/** Copy donor dates onto target when overlap proves they are the same NAV series. */
export function fillMissingNavIfOverlapConsistent<T extends {
  price_date?: string
  nav_date?: string
  nav: string | number
}>(target: T[], donor: T[]): T[] {
  if (donor.length === 0) return target
  if (target.length === 0) return target
  if (!navSeriesOverlapConsistent(target, donor)) return target
  return fillMissingRowsByDate(target, donor)
}
