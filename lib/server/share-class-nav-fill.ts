/**
 * Share NAV across parent / A·B share classes only when overlapping dates agree.
 * Non-分红 A类 (unit ≈ cum) can fill parent gaps and inherit parent type6 history.
 * 分红 classes diverge on overlap and are left untouched.
 *
 * A C-class series is never a donor. Filling the main fund from C类 is only a
 * supplement, and unit overlap does not prove the 复权 is safe to splice in.
 * 赢仕安盈三号C类 (LQ415C) stored 复权 = 单位 through 2025-11-14; copying
 * 2024-01-05 onto SLQ415 dropped the chart 16%. A类 does the same thing:
 * AAL90A onto SAAL90 dropped 复权 about 75% on 2026-08-26. Carry the target
 * dividend gap (carryDividendGapOntoFilledRows). See docs/nav-calculation-rules.md.
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

/** Trailing C on a 备案号 is the C share class (LQ415C, SLQ415C). */
export function isCShareClassBeian(code: string | null | undefined): boolean {
  return /C$/u.test((code ?? "").trim().toUpperCase())
}

/**
 * C类 may not fill another fund. The parent may still fill C类, and A/B may
 * still fill the parent when overlapping 单位净值 agrees.
 */
export function mayUseShareClassNavDonor(
  targetCode: string | null | undefined,
  donorCode: string | null | undefined,
): boolean {
  const target = (targetCode ?? "").trim().toUpperCase()
  const donor = (donorCode ?? "").trim().toUpperCase()
  if (!target || !donor || donor === target) return false
  return !isCShareClassBeian(donor)
}

/**
 * Dates for a 缺失 chart after the same parent / A·B fill the product page uses.
 * A donor is copied only when overlapping 单位净值 agrees. A C类 series is never
 * a donor. 分红 classes fail the overlap test and keep their own holes.
 */
export function gapDatesFilledFromShareClassFamily(
  selfCode: string,
  dates: Iterable<string>,
  ownPoints: Array<{ price_date?: string; nav_date?: string; nav: string | number }>,
  donors: Array<{ code: string; points: Array<{ price_date?: string; nav_date?: string; nav: string | number }> }>,
): string[] {
  const filled = new Set<string>()
  for (const raw of dates) {
    const day = String(raw).slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) filled.add(day)
  }
  const self = selfCode.trim().toUpperCase()
  if (!self || ownPoints.length === 0) return [...filled]
  for (const donor of donors) {
    if (!mayUseShareClassNavDonor(self, donor.code)) continue
    if (!navSeriesOverlapConsistent(ownPoints, donor.points)) continue
    for (const point of donor.points) {
      const day = String(point.price_date ?? point.nav_date ?? "").slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) filled.add(day)
    }
  }
  return [...filled]
}

/**
 * A family feed may explain a 缺失 hole only when it is the same series.
 * A C类 donor never counts. Empty overlap, or a 分红 class past 0.5%, does not.
 */
export function shareClassDonorExplainsGap(
  selfCode: string,
  donorCode: string,
  ownPoints: Array<{ price_date?: string; nav_date?: string; nav: string | number }>,
  donorPoints: Array<{ price_date?: string; nav_date?: string; nav: string | number }>,
): boolean {
  if (!mayUseShareClassNavDonor(selfCode, donorCode)) return false
  if (ownPoints.length === 0 || donorPoints.length === 0) return false
  return navSeriesOverlapConsistent(ownPoints, donorPoints)
}

/** Same as {@link fillMissingNavIfOverlapConsistent}, except a C-class donor is ignored. */
export function fillMissingNavFromShareClassDonor<T extends {
  price_date?: string
  nav_date?: string
  nav: string | number
  cumulative_nav?: string | number | null
  cum_nav_withdrawal?: string | number | null
}>(targetCode: string, donorCode: string, target: T[], donor: T[]): T[] {
  if (!mayUseShareClassNavDonor(targetCode, donorCode)) return target
  if (!navSeriesOverlapConsistent(target, donor)) return target
  const filled = carryDividendGapOntoFilledRows(target, fillMissingNavIfOverlapConsistent(target, donor))
  return replaceSameDayChartSpike(filled, donor)
}

const DIVIDEND_GAP = 0.03
const COLLAPSED_TOL = 0.005
const SAME_SERIES_UNIT = 0.7

/**
 * An A类 file often stores 复权 = 单位. Pasting that date onto a parent that
 * already has a dividend gap drops the 复权 chart (SAAL90 2026-08-26, −75%).
 * Keep the donor 单位 and carry the previous 累计 gap and 复权 return.
 * A unit step of 30% or more is a different series and stays as published.
 */
function carryDividendGapOntoFilledRows<T extends {
  price_date?: string
  nav_date?: string
  nav: string | number
  cumulative_nav?: string | number | null
  cum_nav_withdrawal?: string | number | null
}>(original: T[], filled: T[]): T[] {
  void original
  const sorted = [...filled].sort((a, b) => rowDay(a).localeCompare(rowDay(b)))
  let changed = false
  // Walk forward so a multi-day hole (SLC571 2025-06-23..26) carries from the
  // already-fixed prior filled day, not the collapsed donor row still in sorted[].
  // Own dates that publish 单位=累计=复权 after a gap-bearing filled prefix
  // (LC571B after parent history) need the same carry — finalize already ran.
  const out: T[] = []
  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index]
    if (index === 0) {
      out.push(row)
      continue
    }
    const unit = positiveNav(row.nav)
    const cum = positiveNav(row.cum_nav_withdrawal) ?? positiveNav(row.cumulative_nav)
    const adj = positiveNav(row.cumulative_nav)
    if (unit == null) {
      out.push(row)
      continue
    }
    const collapsedCum = cum == null || Math.abs(cum - unit) / unit <= COLLAPSED_TOL
    const collapsedAdj = adj == null || Math.abs(adj - unit) / unit <= COLLAPSED_TOL
    if (!collapsedCum || !collapsedAdj) {
      out.push(row)
      continue
    }
    const prev = out[index - 1]
    const prevUnit = positiveNav(prev.nav)
    const prevCum = positiveNav(prev.cum_nav_withdrawal) ?? positiveNav(prev.cumulative_nav)
    const prevAdj = positiveNav(prev.cumulative_nav) ?? prevCum
    if (prevUnit == null || prevCum == null || prevAdj == null) {
      out.push(row)
      continue
    }
    if (prevCum - prevUnit <= DIVIDEND_GAP) {
      out.push(row)
      continue
    }
    const unitRatio = unit / prevUnit
    if (!(unitRatio > SAME_SERIES_UNIT && unitRatio < 1 / SAME_SERIES_UNIT)) {
      out.push(row)
      continue
    }
    const nextCum = unit + (prevCum - prevUnit)
    const nextAdj = prevAdj * unitRatio
    if (!(nextCum > 0) || !(nextAdj > 0)) {
      out.push(row)
      continue
    }
    changed = true
    out.push({
      ...row,
      cum_nav_withdrawal: String(+nextCum.toFixed(6)),
      cumulative_nav: String(+nextAdj.toFixed(6)),
    })
  }
  return changed ? out : filled
}

const SAME_DAY_SPIKE_DEVIATION = 0.05
const SAME_DAY_SPIKE_NEIGHBOR = 0.02

function rowDay(row: { price_date?: string; nav_date?: string }): string {
  return String(row.price_date ?? row.nav_date ?? "").slice(0, 10)
}

function positiveNav(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null
  const n = typeof raw === "number" ? raw : parseFloat(String(raw))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Chart level: 复权, then 累计, then 单位. Matches the detail NAV chart. */
function chartLevel(row: {
  nav: string | number
  cumulative_nav?: string | number | null
  cum_nav_withdrawal?: string | number | null
}): number | null {
  return positiveNav(row.cumulative_nav) ?? positiveNav(row.cum_nav_withdrawal) ?? positiveNav(row.nav)
}

/**
 * A unit-only 估值表 on the parent can invent a one-day 复权 dip (SBAK10
 * 2026-09-29: 1.2948 → 1.1913 → 1.2951) while the A-class mail on that date
 * already has 累计 1.2771. Overlap still matches on 单位, so the bad date is
 * kept. When the donor's chart level sits with the neighbors, use that row.
 */
function replaceSameDayChartSpike<T extends {
  price_date?: string
  nav_date?: string
  nav: string | number
  cumulative_nav?: string | number | null
  cum_nav_withdrawal?: string | number | null
}>(target: T[], donor: T[]): T[] {
  if (target.length < 3 || donor.length === 0) return target
  const donorByDate = new Map<string, T>()
  for (const row of donor) {
    const date = rowDay(row)
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) donorByDate.set(date, row)
  }
  const sorted = [...target].sort((a, b) => rowDay(a).localeCompare(rowDay(b)))
  let changed = false
  const out = sorted.map((row, index) => {
    if (index === 0 || index === sorted.length - 1) return row
    const donorRow = donorByDate.get(rowDay(row))
    if (!donorRow) return row
    const unit = positiveNav(row.nav)
    const donorUnit = positiveNav(donorRow.nav)
    if (unit == null || donorUnit == null) return row
    if (Math.abs(unit / donorUnit - 1) > SHARE_CLASS_NAV_OVERLAP_TOL) return row
    const prev = chartLevel(sorted[index - 1])
    const curr = chartLevel(row)
    const next = chartLevel(sorted[index + 1])
    const donorLevel = chartLevel(donorRow)
    if (prev == null || curr == null || next == null || donorLevel == null) return row
    const devPrev = Math.abs(curr / prev - 1)
    const devNext = Math.abs(curr / next - 1)
    const bridge = Math.abs(next / prev - 1)
    if (devPrev < SAME_DAY_SPIKE_DEVIATION || devNext < SAME_DAY_SPIKE_DEVIATION) return row
    if (bridge > SAME_DAY_SPIKE_NEIGHBOR) return row
    if (Math.abs(donorLevel / prev - 1) > SAME_DAY_SPIKE_NEIGHBOR) return row
    if (Math.abs(donorLevel / next - 1) > SAME_DAY_SPIKE_NEIGHBOR) return row
    changed = true
    return { ...donorRow }
  })
  return changed ? out : target
}
