import { getNavFieldValue, type NavRow, type BenchmarkPoint } from "./shared"
import { computeFundNavMetrics } from "@/lib/fund-nav-metrics"
import type { IntervalMetricValues } from "./IntervalMetricsTable"

export type NavChartPoint = { date: string; value: number; benchmarkValue: number | null }

export function buildAlignedBenchmarkValues(
  rows: NavRow[],
  benchmarkSeries: BenchmarkPoint[],
  chartMode: "nav" | "return",
  navType: string,
): Array<number | null> {
  if (!rows.length || !benchmarkSeries.length) return rows.map(() => null)

  let benchmarkIndex = 0
  let lastBenchmarkValue: number | null = null
  const matchedValues = rows.map((row) => {
    while (benchmarkIndex < benchmarkSeries.length && benchmarkSeries[benchmarkIndex].date <= row.price_date) {
      lastBenchmarkValue = benchmarkSeries[benchmarkIndex].value
      benchmarkIndex += 1
    }
    return lastBenchmarkValue
  })

  const baseIndex = matchedValues.findIndex((value) => value !== null)
  if (baseIndex === -1) return rows.map(() => null)

  const baseBenchmarkValue = matchedValues[baseIndex]
  const baseFundValue = getNavFieldValue(rows[baseIndex], navType)
  if (baseBenchmarkValue === null || !isFinite(baseFundValue) || baseFundValue <= 0) {
    return rows.map(() => null)
  }

  return matchedValues.map((value) => {
    if (value === null || value <= 0) return null
    if (chartMode === "return") {
      return +(((value / baseBenchmarkValue) - 1) * 100).toFixed(4)
    }
    return +((value / baseBenchmarkValue) * baseFundValue).toFixed(4)
  })
}

export function downsample(rows: NavRow[], maxPoints = 500): NavRow[] {
  if (rows.length <= maxPoints) return rows
  const step = Math.ceil(rows.length / maxPoints)
  const out: NavRow[] = []
  for (let i = 0; i < rows.length; i += step) out.push(rows[i])
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1])
  return out
}

export function chartDateSpanDays(dates: string[]): number {
  if (dates.length < 2) return 1
  const start = new Date(dates[0]).getTime()
  const end = new Date(dates[dates.length - 1]).getTime()
  return Math.max(1, Math.round((end - start) / 86400000))
}

export function pickMonthStep(spanDays: number): number {
  if (spanDays <= 45) return 1
  if (spanDays <= 150) return 1
  if (spanDays <= 450) return 2
  if (spanDays <= 900) return 3
  if (spanDays <= 1800) return 6
  return 12
}

export function formatChartAxisDateLabel(dateStr: string, spanDays: number): string {
  const year = dateStr.slice(0, 4)
  const month = parseInt(dateStr.slice(5, 7), 10)
  const day = parseInt(dateStr.slice(8, 10), 10)
  if (!year || isNaN(month)) return dateStr.slice(0, 10)

  if (spanDays <= 45 && !isNaN(day)) {
    return `${month}/${day}`
  }
  if (month === 1) return year
  return `${month}月`
}

export function nearestDateInSeries(target: Date, dates: string[]): string {
  const targetTs = target.getTime()
  let best = dates[0]
  let bestDiff = Math.abs(new Date(best).getTime() - targetTs)
  for (let i = 1; i < dates.length; i++) {
    const diff = Math.abs(new Date(dates[i]).getTime() - targetTs)
    if (diff < bestDiff) {
      bestDiff = diff
      best = dates[i]
    }
  }
  return best
}

export function formatMonthTargetLabel(year: number, month: number, spanDays: number): string {
  if (spanDays <= 45) return `${month}/${year}`
  if (month === 1) return String(year)
  return `${month}月`
}

export function dateForMonthTarget(year: number, month: number, dates: string[]): string {
  const mm = String(month).padStart(2, "0")
  const inMonth = dates.filter((d) => d.startsWith(`${year}-${mm}`))
  if (inMonth.length) return inMonth[Math.floor(inMonth.length / 2)]

  if (month === 1) {
    const inYear = dates.filter((d) => d.startsWith(String(year)))
    if (inYear.length) return inYear[0]
  }

  return nearestDateInSeries(new Date(year, month - 1, 15), dates)
}

export function buildChartDateAxisConfig(dates: string[]) {
  if (!dates.length) {
    return {
      ticks: [] as string[],
      tickFormatter: (val: string) => val,
    }
  }
  if (dates.length === 1) {
    const spanDays = 1
    return {
      ticks: dates,
      tickFormatter: (val: string) => formatChartAxisDateLabel(val, spanDays),
    }
  }

  const spanDays = chartDateSpanDays(dates)
  const monthStep = pickMonthStep(spanDays)
  const start = new Date(dates[0])
  const end = new Date(dates[dates.length - 1])

  let curYear = start.getFullYear()
  let curMonth = start.getMonth() + 1 + (start.getDate() > 15 ? 1 : 0)
  while (curMonth > 12) {
    curMonth -= 12
    curYear += 1
  }

  const endYear = end.getFullYear()
  const endMonth = end.getMonth() + 1
  const targets: Array<{ year: number; month: number }> = []
  const seenTargets = new Set<string>()

  function addTarget(year: number, month: number) {
    const key = `${year}-${month}`
    if (seenTargets.has(key)) return
    seenTargets.add(key)
    targets.push({ year, month })
  }

  while (curYear < endYear || (curYear === endYear && curMonth <= endMonth)) {
    addTarget(curYear, curMonth)
    curMonth += monthStep
    while (curMonth > 12) {
      curMonth -= 12
      curYear += 1
    }
  }

  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    const janStart = new Date(y, 0, 1)
    const janEnd = new Date(y, 0, 31)
    if (janEnd >= start && janStart <= end) addTarget(y, 1)
  }

  targets.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month))

  const tickLabels = new Map<string, string>()
  const ticks: string[] = []

  for (const target of targets) {
    const date = dateForMonthTarget(target.year, target.month, dates)
    const label = formatMonthTargetLabel(target.year, target.month, spanDays)
    if (tickLabels.has(date)) {
      if (target.month === 1) tickLabels.set(date, label)
      continue
    }
    ticks.push(date)
    tickLabels.set(date, label)
  }

  ticks.sort((a, b) => a.localeCompare(b))
  if (!ticks.length) ticks.push(dates[0])

  return {
    ticks,
    tickFormatter: (val: string) => tickLabels.get(val) ?? formatChartAxisDateLabel(val, spanDays),
  }
}

export function formatDateRange(startTs: number, endTs: number): string {
  return `${new Date(startTs).toISOString().slice(0, 10)} ~ ${new Date(endTs).toISOString().slice(0, 10)}`
}

export function buildNavChartData(
  rows: NavRow[],
  chartMode: "nav" | "return",
  navType: string,
  hasBenchmark: boolean,
  benchmarkSeries: BenchmarkPoint[],
): NavChartPoint[] {
  if (!rows.length) return []
  const sampled = downsample(rows)
  const benchmarkValues = hasBenchmark
    ? buildAlignedBenchmarkValues(sampled, benchmarkSeries, chartMode, navType)
    : sampled.map(() => null)
  const firstNav = getNavFieldValue(sampled[0], navType)

  return sampled.map((row, index) => {
    const navValue = getNavFieldValue(row, navType)
    return {
      date: row.price_date,
      value: chartMode === "return"
        ? (firstNav > 0 ? +(((navValue / firstNav) - 1) * 100).toFixed(4) : 0)
        : navValue,
      benchmarkValue: benchmarkValues[index],
    }
  })
}

export function computeNavChartYDomain(
  data: NavChartPoint[],
  chartMode: "nav" | "return",
): [number, number] | ["auto", "auto"] {
  if (!data.length) return ["auto", "auto"]
  const vals = data.flatMap((d) => {
    const out = [d.value]
    if (typeof d.benchmarkValue === "number") out.push(d.benchmarkValue)
    return out
  })
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  if (chartMode === "return") {
    min = Math.min(min, 0)
    max = Math.max(max, 0)
  }
  const span = max - min
  const pad = span > 0 ? span * 0.08 : Math.max(Math.abs(max), 1) * 0.08
  return [+(min - pad).toFixed(4), +(max + pad).toFixed(4)]
}

export type DrawdownChartPoint = {
  date: string
  fundDD: number
  benchDD: number | null
  excessDD: number | null
}

export function prepareNavRowsForChart(rows: NavRow[]): NavRow[] {
  const byDate = new Map<string, NavRow>()
  for (const row of rows) {
    const date = row.price_date.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    byDate.set(date, { ...row, price_date: date })
  }
  return [...byDate.values()].sort((a, b) => a.price_date.localeCompare(b.price_date))
}

export function computeDrawdownSeries(values: number[]): number[] {
  let peak: number | null = null
  return values.map((v) => {
    if (!Number.isFinite(v) || v <= 0) return 0
    if (peak === null || v > peak) peak = v
    return +(((v - peak) / peak) * 100).toFixed(4)
  })
}

export function buildDrawdownChartData(
  rows: NavRow[],
  navType: string,
  hasBenchmark: boolean,
  benchmarkSeries: BenchmarkPoint[],
): DrawdownChartPoint[] {
  const prepared = prepareNavRowsForChart(rows)
  if (!prepared.length) return []

  const sampled = downsample(prepared)
  const fundValues = sampled.map((r) => getNavFieldValue(r, navType))
  const fundDD = computeDrawdownSeries(fundValues)

  const benchValues = hasBenchmark && benchmarkSeries.length
    ? buildAlignedBenchmarkValues(sampled, benchmarkSeries, "nav", navType)
    : sampled.map(() => null)

  let benchPeak = NaN
  const benchDD = benchValues.map((v) => {
    if (v === null || !isFinite(v)) return null
    if (!isFinite(benchPeak) || v > benchPeak) benchPeak = v
    return benchPeak > 0 ? +(((v - benchPeak) / benchPeak) * 100).toFixed(4) : 0
  })

  const firstFund = fundValues[0] ?? 0
  const baseBenchIdx = benchValues.findIndex((v) => v !== null && isFinite(v))
  const baseBench = baseBenchIdx >= 0 ? benchValues[baseBenchIdx] : null
  const baseFundAtBench = baseBenchIdx >= 0 ? fundValues[baseBenchIdx] : firstFund

  const excessValues = sampled.map((_, i) => {
    const bench = benchValues[i]
    if (bench === null || !isFinite(bench) || bench <= 0 || baseBench === null || baseBench <= 0) return null
    const fundRet = firstFund > 0 ? fundValues[i] / firstFund : 1
    const benchRet = bench / baseBench
    return baseFundAtBench > 0 && benchRet > 0
      ? +((fundRet / benchRet) * baseFundAtBench).toFixed(6)
      : null
  })

  const excessDD = (() => {
    let peak = NaN
    return excessValues.map((v) => {
      if (v === null || !isFinite(v)) return null
      if (!isFinite(peak) || v > peak) peak = v
      return peak > 0 ? +(((v - peak) / peak) * 100).toFixed(4) : 0
    })
  })()

  return sampled.map((row, i) => ({
    date: row.price_date,
    fundDD: fundDD[i],
    benchDD: benchDD[i],
    excessDD: excessDD[i],
  }))
}

export function computeDrawdownYDomain(
  data: DrawdownChartPoint[],
  showExcess: boolean,
): [number, number] {
  if (!data.length) return [-10, 0]
  const vals = data.flatMap((d) => {
    if (showExcess) return d.excessDD !== null ? [d.excessDD] : []
    const out = [d.fundDD]
    if (d.benchDD !== null) out.push(d.benchDD)
    return out
  })
  if (!vals.length) return [-10, 0]
  const min = Math.min(...vals)
  const pad = Math.abs(min) * 0.08
  return [+(min - pad).toFixed(2), 0]
}

function normalizeDateKey(dateStr: string): string | null {
  const key = dateStr?.slice(0, 10) ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const [, y, m, d] = key.match(/^(\d{4})-(\d{2})-(\d{2})$/)!
  const month = Number(m)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const parsed = new Date(Date.UTC(Number(y), month - 1, day))
  if (Number.isNaN(parsed.getTime())) return null
  return key
}

function subtractDaysFromDateKey(dateStr: string, days: number): string | null {
  const key = normalizeDateKey(dateStr)
  if (!key) return null
  const [, y, m, d] = key.match(/^(\d{4})-(\d{2})-(\d{2})$/)!
  const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  parsed.setUTCDate(parsed.getUTCDate() - days)
  return parsed.toISOString().slice(0, 10)
}

const EMPTY_INTERVAL_METRICS: IntervalMetricValues = {
  ret_1w: null,
  ret_1m: null,
  ret_3m: null,
  ret_6m: null,
  ret_1y: null,
  sharpe_1y: null,
  calmar_1y: null,
}

function computeNavPeriodReturn(
  rows: NavRow[],
  navType: string,
  cutoff: string,
  days: number,
): number | null {
  if (!rows.length) return null
  const cutoffKey = normalizeDateKey(cutoff)
  if (!cutoffKey) return null
  const startStr = subtractDaysFromDateKey(cutoffKey, days)
  if (!startStr) return null

  const sorted = [...rows].sort((a, b) => a.price_date.localeCompare(b.price_date))
  const upToCutoff = sorted.filter((r) => r.price_date.slice(0, 10) <= cutoffKey)
  if (!upToCutoff.length) return null
  const endVal = getNavFieldValue(upToCutoff[upToCutoff.length - 1], navType)
  const upToStart = upToCutoff.filter((r) => r.price_date.slice(0, 10) <= startStr)
  if (!upToStart.length) return null
  const startVal = getNavFieldValue(upToStart[upToStart.length - 1], navType)
  if (startVal <= 0) return null
  return endVal / startVal - 1
}

export function buildFundIntervalMetricsFromNav(
  rows: NavRow[],
  navType: string,
  cutoff: string,
): IntervalMetricValues {
  const cutoffKey = normalizeDateKey(cutoff)
  if (!cutoffKey) return EMPTY_INTERVAL_METRICS

  const ret_1w = computeNavPeriodReturn(rows, navType, cutoffKey, 7)
  const ret_1m = computeNavPeriodReturn(rows, navType, cutoffKey, 30)
  const ret_3m = computeNavPeriodReturn(rows, navType, cutoffKey, 91)
  const ret_6m = computeNavPeriodReturn(rows, navType, cutoffKey, 182)
  const ret_1y = computeNavPeriodReturn(rows, navType, cutoffKey, 365)

  const startStr = subtractDaysFromDateKey(cutoffKey, 365)
  const oneYearRows = startStr
    ? [...rows]
        .filter((r) => {
          const key = r.price_date.slice(0, 10)
          return key >= startStr && key <= cutoffKey
        })
        .sort((a, b) => a.price_date.localeCompare(b.price_date))
    : []
  const oneYearMetrics = oneYearRows.length >= 2
    ? computeFundNavMetrics({
        dates: oneYearRows.map((r) => r.price_date),
        values: oneYearRows.map((r) => getNavFieldValue(r, navType)),
      })
    : null

  return {
    ret_1w,
    ret_1m,
    ret_3m,
    ret_6m,
    ret_1y,
    sharpe_1y: oneYearMetrics?.sharpe ?? null,
    calmar_1y: oneYearMetrics?.calmar ?? null,
  }
}
