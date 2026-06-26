import { getNavFieldValue, type NavRow, type BenchmarkPoint } from "./shared"

export const HOLDING_PERIOD_OPTIONS = [
  { months: 3, label: "三个月" },
  { months: 6, label: "六个月" },
  { months: 9, label: "九个月" },
  { months: 12, label: "一年" },
  { months: 24, label: "两年" },
  { months: 36, label: "三年" },
  { months: 60, label: "五年" },
] as const

export const POSITIVE_RETURN_HORIZONS = HOLDING_PERIOD_OPTIONS

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

function benchmarkAtDate(series: BenchmarkPoint[], date: string): number | null {
  let last: number | null = null
  for (const p of series) {
    if (p.date <= date) last = p.value
    else break
  }
  return last
}

function findExitIndex(rows: NavRow[], startIdx: number, targetDate: string): number {
  for (let i = startIdx + 1; i < rows.length; i++) {
    if (rows[i].price_date >= targetDate) return i
  }
  return -1
}

export interface HoldingReturnPair {
  fund: number
  bench: number | null
}

export function computeHoldingReturnPairs(
  rows: NavRow[],
  navType: string,
  benchmarkSeries: BenchmarkPoint[],
  holdMonths: number,
): HoldingReturnPair[] {
  if (rows.length < 2) return []
  const sortedBench = [...benchmarkSeries].sort((a, b) => a.date.localeCompare(b.date))
  const pairs: HoldingReturnPair[] = []

  for (let i = 0; i < rows.length; i++) {
    const targetDate = addMonths(rows[i].price_date, holdMonths)
    const exitIdx = findExitIndex(rows, i, targetDate)
    if (exitIdx < 0) continue

    const entryVal = getNavFieldValue(rows[i], navType)
    const exitVal = getNavFieldValue(rows[exitIdx], navType)
    if (entryVal <= 0 || exitVal <= 0) continue

    const fundRet = (exitVal / entryVal - 1) * 100
    const b0 = benchmarkAtDate(sortedBench, rows[i].price_date)
    const b1 = benchmarkAtDate(sortedBench, rows[exitIdx].price_date)
    const benchRet = b0 && b1 && b0 > 0 ? (b1 / b0 - 1) * 100 : null

    pairs.push({ fund: fundRet, bench: benchRet })
  }

  return pairs
}

export function positiveReturnProbability(returns: number[]): number | null {
  if (!returns.length) return null
  return (returns.filter((r) => r > 0).length / returns.length) * 100
}

export interface ReturnHistogramBin {
  label: string
  lo: number
  hi: number
  fundFreq: number
  benchFreq: number
}

export function buildReturnHistogram(
  fundReturns: number[],
  benchReturns: number[],
  binCount = 10,
): ReturnHistogramBin[] {
  const all = [...fundReturns, ...benchReturns].filter((v) => Number.isFinite(v))
  if (!all.length || binCount < 1) return []

  const min = Math.min(...all)
  const max = Math.max(...all)
  const span = max - min || 1
  const binWidth = span / binCount
  const bins: ReturnHistogramBin[] = []

  for (let i = 0; i < binCount; i++) {
    const lo = min + i * binWidth
    const hi = i === binCount - 1 ? max : lo + binWidth
    const inBin = (v: number) => v >= lo && (i === binCount - 1 ? v <= hi : v < hi)
    const fundCount = fundReturns.filter(inBin).length
    const benchCount = benchReturns.filter(inBin).length
    bins.push({
      label: `${lo.toFixed(2)}% ~ ${hi.toFixed(2)}%`,
      lo,
      hi,
      fundFreq: fundReturns.length ? (fundCount / fundReturns.length) * 100 : 0,
      benchFreq: benchReturns.length ? (benchCount / benchReturns.length) * 100 : 0,
    })
  }

  return bins
}
