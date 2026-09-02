import { computeFundNavMetrics, type FundNavMetrics } from "@/lib/fund-nav-metrics"

export type CompareNavPoint = { d: string; v: number }

export type AlignedPair = {
  date: string
  fundNav: number
  accountNav: number
  fundRet: number | null
  accountRet: number | null
}

export type OverlayPoint = {
  date: string
  fundPct: number
  accountPct: number
  excessPct: number
  fundDd: number
  accountDd: number
}

export type DifferenceStats = {
  overlapStart: string
  overlapEnd: string
  pairCount: number
  correlation: number | null
  trackingError: number | null
  informationRatio: number | null
  hitRate: number | null
  avgDailyExcess: number | null
  maxDailyExcess: number | null
  minDailyExcess: number | null
}

export type MonthlyCompareRow = {
  ym: string
  fundRet: number
  accountRet: number
  excess: number
}

export type AccountCompareAnalysis = {
  overlay: OverlayPoint[]
  fundMetrics: FundNavMetrics | null
  accountMetrics: FundNavMetrics | null
  difference: DifferenceStats | null
  monthly: MonthlyCompareRow[]
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    cov += da * db
    va += da * da
    vb += db * db
  }
  const den = Math.sqrt(va * vb)
  return den > 0 ? cov / den : null
}

function stdSample(values: number[]): number | null {
  if (values.length < 2) return null
  const m = values.reduce((s, v) => s + v, 0) / values.length
  const varSum = values.reduce((s, v) => s + (v - m) ** 2, 0)
  return Math.sqrt(varSum / (values.length - 1))
}

function periodsPerYear(dates: string[]): number {
  if (dates.length < 2) return 252
  const start = new Date(`${dates[0]}T00:00:00`).getTime()
  const end = new Date(`${dates[dates.length - 1]}T00:00:00`).getTime()
  const days = Math.max((end - start) / 86_400_000, 1)
  const gaps = dates.length - 1
  const medGap = days / gaps
  return medGap <= 2 ? 252 : medGap <= 10 ? 52 : medGap <= 20 ? 26 : 12
}

function lastOnOrBefore(sorted: CompareNavPoint[], date: string): CompareNavPoint | null {
  let lo = 0
  let hi = sorted.length - 1
  let found: CompareNavPoint | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].d <= date) {
      found = sorted[mid]
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** Pair each fund observation with the latest account NAV on or before that date. */
export function alignAccountOntoFund(
  fund: CompareNavPoint[],
  account: CompareNavPoint[],
): AlignedPair[] {
  const fundSorted = [...fund].filter((p) => p.v > 0).sort((a, b) => a.d.localeCompare(b.d))
  const accSorted = [...account].filter((p) => p.v > 0).sort((a, b) => a.d.localeCompare(b.d))
  if (!fundSorted.length || !accSorted.length) return []

  const pairs: AlignedPair[] = []
  for (const fp of fundSorted) {
    const ap = lastOnOrBefore(accSorted, fp.d)
    if (!ap) continue
    pairs.push({
      date: fp.d,
      fundNav: fp.v,
      accountNav: ap.v,
      fundRet: null,
      accountRet: null,
    })
  }

  for (let i = 1; i < pairs.length; i++) {
    const prev = pairs[i - 1]
    const cur = pairs[i]
    pairs[i].fundRet = prev.fundNav > 0 ? cur.fundNav / prev.fundNav - 1 : null
    pairs[i].accountRet = prev.accountNav > 0 ? cur.accountNav / prev.accountNav - 1 : null
  }
  return pairs
}

function locfSeries(dates: string[], points: CompareNavPoint[]): Array<number | null> {
  const sorted = [...points].filter((p) => p.v > 0).sort((a, b) => a.d.localeCompare(b.d))
  let idx = 0
  let last: number | null = null
  return dates.map((date) => {
    while (idx < sorted.length && sorted[idx].d <= date) {
      last = sorted[idx].v
      idx += 1
    }
    return last
  })
}

function drawdownPct(values: number[]): number[] {
  let peak = values[0]
  return values.map((v) => {
    if (v > peak) peak = v
    return peak > 0 ? (v / peak - 1) * 100 : 0
  })
}

export function buildAccountCompareAnalysis(
  fund: CompareNavPoint[],
  account: CompareNavPoint[],
): AccountCompareAnalysis {
  const fundSorted = [...fund].filter((p) => p.v > 0).sort((a, b) => a.d.localeCompare(b.d))
  const accSorted = [...account].filter((p) => p.v > 0).sort((a, b) => a.d.localeCompare(b.d))
  const pairs = alignAccountOntoFund(fundSorted, accSorted)

  const dateSet = new Set<string>()
  for (const p of fundSorted) dateSet.add(p.d)
  for (const p of accSorted) dateSet.add(p.d)
  const dates = [...dateSet].sort()

  const fundLocf = locfSeries(dates, fundSorted)
  const accLocf = locfSeries(dates, accSorted)
  const startIdx = dates.findIndex((_, i) => fundLocf[i] != null && accLocf[i] != null)
  const overlay: OverlayPoint[] = []

  if (startIdx >= 0) {
    const fundBase = fundLocf[startIdx]!
    const accBase = accLocf[startIdx]!
    const fundReb: number[] = []
    const accReb: number[] = []
    const overlayDates: string[] = []
    for (let i = startIdx; i < dates.length; i++) {
      const fv = fundLocf[i]
      const av = accLocf[i]
      if (fv == null || av == null || fundBase <= 0 || accBase <= 0) continue
      overlayDates.push(dates[i])
      fundReb.push(fv / fundBase)
      accReb.push(av / accBase)
    }
    const fundDd = drawdownPct(fundReb)
    const accDd = drawdownPct(accReb)
    for (let i = 0; i < overlayDates.length; i++) {
      overlay.push({
        date: overlayDates[i],
        fundPct: (fundReb[i] - 1) * 100,
        accountPct: (accReb[i] - 1) * 100,
        excessPct: (fundReb[i] - accReb[i]) * 100,
        fundDd: fundDd[i],
        accountDd: accDd[i],
      })
    }
  }

  const overlapPairs = pairs.filter((p) => p.date >= (overlay[0]?.date ?? "") && p.date <= (overlay[overlay.length - 1]?.date ?? "\uffff"))
  const fundMetrics = overlapPairs.length >= 2
    ? computeFundNavMetrics({
        dates: overlapPairs.map((p) => p.date),
        values: overlapPairs.map((p) => p.fundNav),
      })
    : null
  const accountMetrics = overlapPairs.length >= 2
    ? computeFundNavMetrics({
        dates: overlapPairs.map((p) => p.date),
        values: overlapPairs.map((p) => p.accountNav),
      })
    : null

  const fundRets: number[] = []
  const accRets: number[] = []
  const excessRets: number[] = []
  const retDates: string[] = []
  for (const p of overlapPairs) {
    if (p.fundRet == null || p.accountRet == null) continue
    if (!Number.isFinite(p.fundRet) || !Number.isFinite(p.accountRet)) continue
    fundRets.push(p.fundRet)
    accRets.push(p.accountRet)
    excessRets.push(p.fundRet - p.accountRet)
    retDates.push(p.date)
  }

  let difference: DifferenceStats | null = null
  if (overlay.length >= 2 && excessRets.length >= 2) {
    const ppy = periodsPerYear(retDates)
    const te = stdSample(excessRets)
    const meanEx = excessRets.reduce((s, v) => s + v, 0) / excessRets.length
    const trackingError = te != null ? te * Math.sqrt(ppy) : null
    difference = {
      overlapStart: overlay[0].date,
      overlapEnd: overlay[overlay.length - 1].date,
      pairCount: excessRets.length,
      correlation: pearson(fundRets, accRets),
      trackingError,
      informationRatio: trackingError && trackingError > 0 ? (meanEx * ppy) / trackingError : null,
      hitRate: excessRets.filter((v) => v > 0).length / excessRets.length,
      avgDailyExcess: meanEx,
      maxDailyExcess: Math.max(...excessRets),
      minDailyExcess: Math.min(...excessRets),
    }
  }

  const monthly: MonthlyCompareRow[] = []
  const byMonth = new Map<string, AlignedPair>()
  for (const p of overlapPairs) byMonth.set(p.date.slice(0, 7), p)
  const months = [...byMonth.keys()].sort()
  for (let i = 1; i < months.length; i++) {
    const prev = byMonth.get(months[i - 1])!
    const cur = byMonth.get(months[i])!
    if (prev.fundNav <= 0 || prev.accountNav <= 0) continue
    const fundRet = cur.fundNav / prev.fundNav - 1
    const accountRet = cur.accountNav / prev.accountNav - 1
    monthly.push({
      ym: months[i],
      fundRet,
      accountRet,
      excess: fundRet - accountRet,
    })
  }

  return { overlay, fundMetrics, accountMetrics, difference, monthly }
}
