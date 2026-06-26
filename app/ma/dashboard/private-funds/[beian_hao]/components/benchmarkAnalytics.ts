import { getNavFieldValue, type NavRow, type BenchmarkPoint } from "./shared"

export interface ConditionalProbabilityStats {
  totalPeriods: number
  benchUpFundUp: number
  benchUpFundDown: number
  benchDownFundUp: number
  benchDownFundDown: number
}

export function computeConditionalProbabilities(
  fundReturns: number[],
  benchReturns: (number | null)[],
): ConditionalProbabilityStats | null {
  if (fundReturns.length !== benchReturns.length) return null
  let total = 0
  let benchUp = 0
  let benchDown = 0
  let uu = 0
  let ud = 0
  let du = 0
  let dd = 0

  for (let i = 0; i < fundReturns.length; i++) {
    const b = benchReturns[i]
    const f = fundReturns[i]
    if (b === null || !Number.isFinite(f) || !Number.isFinite(b)) continue
    if (b === 0 && f === 0) continue
    total += 1
    const bUp = b > 0
    const bDown = b < 0
    const fUp = f > 0
    const fDown = f < 0
    if (bUp) {
      benchUp += 1
      if (fUp) uu += 1
      else if (fDown) ud += 1
    } else if (bDown) {
      benchDown += 1
      if (fUp) du += 1
      else if (fDown) dd += 1
    }
  }

  if (total === 0) return null
  return {
    totalPeriods: total,
    benchUpFundUp: benchUp > 0 ? (uu / benchUp) * 100 : 0,
    benchUpFundDown: benchUp > 0 ? (ud / benchUp) * 100 : 0,
    benchDownFundUp: benchDown > 0 ? (du / benchDown) * 100 : 0,
    benchDownFundDown: benchDown > 0 ? (dd / benchDown) * 100 : 0,
  }
}

function alignBenchmarkToRows(rows: NavRow[], series: BenchmarkPoint[]): (number | null)[] {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date))
  let idx = 0
  let last: number | null = null
  return rows.map((row) => {
    while (idx < sorted.length && sorted[idx].date <= row.price_date) {
      last = sorted[idx].value
      idx += 1
    }
    return last
  })
}

function pearsonCorrelation(fundRets: number[], benchRets: number[]): number | null {
  if (fundRets.length < 3 || fundRets.length !== benchRets.length) return null
  const n = fundRets.length
  const mf = fundRets.reduce((s, v) => s + v, 0) / n
  const mb = benchRets.reduce((s, v) => s + v, 0) / n
  let cov = 0
  let vf = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    const df = fundRets[i] - mf
    const db = benchRets[i] - mb
    cov += df * db
    vf += df * df
    vb += db * db
  }
  const den = Math.sqrt(vf * vb)
  return den > 0 ? cov / den : null
}

export function computeReturnCorrelation(
  rows: NavRow[],
  navType: string,
  benchmarkSeries: BenchmarkPoint[],
): number | null {
  if (rows.length < 3 || !benchmarkSeries.length) return null
  const navVals = rows.map((r) => getNavFieldValue(r, navType))
  const benchVals = alignBenchmarkToRows(rows, benchmarkSeries)
  const fundRets: number[] = []
  const benchRets: number[] = []

  for (let i = 1; i < rows.length; i++) {
    const prevFund = navVals[i - 1]
    const currFund = navVals[i]
    const prevBench = benchVals[i - 1]
    const currBench = benchVals[i]
    if (prevFund <= 0 || currFund <= 0 || prevBench === null || currBench === null || prevBench <= 0 || currBench <= 0) {
      continue
    }
    fundRets.push(currFund / prevFund - 1)
    benchRets.push(currBench / prevBench - 1)
  }

  return pearsonCorrelation(fundRets, benchRets)
}

function subDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function sliceRows(rows: NavRow[], from: string, to: string): NavRow[] {
  return rows.filter((r) => r.price_date >= from && r.price_date <= to)
}

export interface CorrelationColumn {
  key: string
  label: string
  value: number | null
}

const INTERVAL_DEFS = [
  { key: "1m", label: "近一月", days: 30 },
  { key: "3m", label: "近三月", days: 90 },
  { key: "6m", label: "近六月", days: 182 },
  { key: "1y", label: "近一年", days: 365 },
  { key: "ytd", label: "今年以来", special: "ytd" as const },
  { key: "si", label: "成立以来", special: "inception" as const },
]

export function computeIntervalCorrelations(
  rows: NavRow[],
  navType: string,
  benchmarkSeries: BenchmarkPoint[],
  cutoffDate: string,
): CorrelationColumn[] {
  if (!rows.length || !cutoffDate) return INTERVAL_DEFS.map((d) => ({ key: d.key, label: d.label, value: null }))

  const inception = rows[0].price_date
  return INTERVAL_DEFS.map((def) => {
    let from = inception
    if (def.special === "ytd") from = `${cutoffDate.slice(0, 4)}-01-01`
    else if (def.special === "inception") from = inception
    else from = subDays(cutoffDate, def.days!)

    const slice = sliceRows(rows, from, cutoffDate)
    return {
      key: def.key,
      label: def.label,
      value: computeReturnCorrelation(slice, navType, benchmarkSeries),
    }
  })
}

export function computeAnnualCorrelations(
  rows: NavRow[],
  navType: string,
  benchmarkSeries: BenchmarkPoint[],
): CorrelationColumn[] {
  if (!rows.length) return []
  const years = [...new Set(rows.map((r) => r.price_date.slice(0, 4)))].sort()
  return years.map((year) => {
    const slice = rows.filter((r) => r.price_date.startsWith(year))
    const corr = computeReturnCorrelation(slice, navType, benchmarkSeries)
    return { key: year, label: `${year}年`, value: corr }
  })
}

export function correlationCellStyle(corr: number | null): { backgroundColor: string; color: string } {
  if (corr === null || !Number.isFinite(corr)) {
    return { backgroundColor: "#fafafa", color: "#a1a1aa" }
  }
  const intensity = Math.max(0, Math.min(1, Math.abs(corr)))
  const alpha = 0.12 + intensity * 0.5
  return {
    backgroundColor: `rgba(239, 68, 68, ${alpha})`,
    color: intensity > 0.35 ? "#991b1b" : "#52525b",
  }
}
