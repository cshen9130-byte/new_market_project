import { getNavFieldValue, filterNavRowsByFrequency, type NavRow, type BenchmarkPoint } from "./shared"
import { computeFundNavMetrics } from "@/lib/fund-nav-metrics"
import type { IntervalMetricValues } from "./IntervalMetricsTable"

export type ReturnLabelMode = "cumulative" | "period"

export function formatReturnTooltipLabel(
  seriesName: string | undefined,
  returnLabelMode: ReturnLabelMode,
  isBenchmark: boolean,
): string {
  const kind = returnLabelMode === "period" ? "当日涨跌幅" : "累计收益"
  if (isBenchmark && seriesName) return `${seriesName}${kind}`
  return kind
}

export type NavChartPoint = {
  date: string
  ts: number
  value: number
  benchmarkValue: number | null
  periodReturn: number | null
  benchmarkPeriodReturn: number | null
}

function matchBenchmarkRawValues(
  rows: NavRow[],
  benchmarkSeries: BenchmarkPoint[],
): Array<number | null> {
  if (!rows.length || !benchmarkSeries.length) return rows.map(() => null)

  let benchmarkIndex = 0
  let lastBenchmarkValue: number | null = null
  return rows.map((row) => {
    while (benchmarkIndex < benchmarkSeries.length && benchmarkSeries[benchmarkIndex].date <= row.price_date) {
      lastBenchmarkValue = benchmarkSeries[benchmarkIndex].value
      benchmarkIndex += 1
    }
    return lastBenchmarkValue
  })
}

function computePctChangeSeries(values: number[]): Array<number | null> {
  return values.map((value, index) => {
    if (index === 0) return null
    const prev = values[index - 1]
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(value)) return null
    return +(((value / prev) - 1) * 100).toFixed(4)
  })
}

function computeNullablePctChangeSeries(values: Array<number | null>): Array<number | null> {
  return values.map((value, index) => {
    if (index === 0) return null
    const prev = values[index - 1]
    if (prev === null || value === null || prev <= 0) return null
    return +(((value / prev) - 1) * 100).toFixed(4)
  })
}

/** Period-over-period benchmark 涨跌幅 keyed by nav row date (ascending series order). */
export function buildBenchmarkPctChangesByDate(
  rows: NavRow[],
  benchmarkSeries: BenchmarkPoint[],
): Map<string, number | null> {
  const rawValues = matchBenchmarkRawValues(rows, benchmarkSeries)
  const changes = computeNullablePctChangeSeries(rawValues)
  const out = new Map<string, number | null>()
  rows.forEach((row, index) => {
    out.set(row.price_date, changes[index] ?? null)
  })
  return out
}

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

/** Keep ~even calendar spacing so daily years do not dominate mixed-frequency NAV. */
export function downsampleByTime(rows: NavRow[], maxPoints = 720): NavRow[] {
  if (rows.length <= maxPoints) return rows
  const start = dateToUtcTs(rows[0].price_date)
  const end = dateToUtcTs(rows[rows.length - 1].price_date)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return downsample(rows, maxPoints)
  }
  const step = (end - start) / (maxPoints - 1)
  const out: NavRow[] = [rows[0]]
  let nextTs = start + step
  for (let i = 1; i < rows.length - 1; i++) {
    const ts = dateToUtcTs(rows[i].price_date)
    if (!Number.isFinite(ts) || ts < nextTs) continue
    out.push(rows[i])
    nextTs += step
  }
  const last = rows[rows.length - 1]
  if (out[out.length - 1]?.price_date !== last.price_date) out.push(last)
  return out
}

const MS_DAY = 86400000

/** Calendar gap large enough to treat a NAV point as isolated (still draw the line). */
const ISOLATED_GAP_FLOOR_MS = 45 * MS_DAY

/**
 * Long mixed daily/weekly NAV looks like a scribble if every observation is plotted.
 * For spans over ~5 months, chart the last point in each week (table still uses raw rows).
 */
export function resampleNavRowsForChart(
  rows: NavRow[],
  options?: { forceDaily?: boolean },
): NavRow[] {
  const prepared = prepareNavRowsForChart(rows)
  if (prepared.length <= 2) return prepared
  const span = chartDateSpanDays(prepared.map((row) => row.price_date))
  const sampled = !options?.forceDaily && span > 150
    ? filterNavRowsByFrequency(prepared, "周频")
    : prepared
  return downsampleByTime(sampled)
}

export function chartGapBreakMs(timestamps: number[]): number {
  const gaps: number[] = []
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1]
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap)
  }
  if (!gaps.length) return ISOLATED_GAP_FLOOR_MS
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  return Math.max(ISOLATED_GAP_FLOOR_MS, median * 6)
}

export type GappedLinePoint = {
  value: [number, number | null]
  date?: string
  periodReturn?: number | null
  showDot?: boolean
}

/** Map NAV points onto a time axis. Connect across missing reports; mark isolated observations. */
export function toGappedLinePoints(
  points: Array<{ ts: number; y: number | null; date?: string; periodReturn?: number | null }>,
  showDots: boolean,
): GappedLinePoint[] {
  if (!points.length) return []
  const breakMs = chartGapBreakMs(points.map((point) => point.ts))
  return points.map((point, i) => {
    const prevGap = i > 0 && point.ts - points[i - 1].ts > breakMs
    const nextGap = i < points.length - 1 && points[i + 1].ts - point.ts > breakMs
    return {
      value: [point.ts, point.y],
      date: point.date,
      periodReturn: point.periodReturn,
      showDot: showDots || prevGap || nextGap,
    }
  })
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

/** Parse `YYYY-MM-DD` as UTC midnight so the NAV chart can use a real time scale. */
export function dateToUtcTs(dateStr: string): number {
  const key = dateStr.slice(0, 10)
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(5, 7))
  const d = Number(key.slice(8, 10))
  if (!y || !m || !d) return NaN
  return Date.UTC(y, m - 1, d)
}

export function formatIsoDateFromTs(ts: number): string {
  if (!Number.isFinite(ts)) return ""
  return new Date(ts).toISOString().slice(0, 10)
}

export function chartTooltipDateLabel(
  payloadDate: string | undefined,
  label: string | number | undefined,
): string {
  if (payloadDate) return payloadDate.slice(0, 10)
  if (typeof label === "number") return formatIsoDateFromTs(label)
  if (typeof label === "string" && /^\d+$/.test(label)) return formatIsoDateFromTs(Number(label))
  return label ? String(label).slice(0, 10) : ""
}

export type TimeAxisConfig = {
  ticks: number[]
  domain: [number, number]
  tickFormatter: (ts: number) => string
}

/**
 * Calendar-spaced ticks for a time-scale x-axis.
 * Ticks sit on actual dates (year/month starts), not on NAV observation indices,
 * so mixed daily/weekly series keep real calendar width.
 */
export function buildTimeAxisConfig(dates: string[]): TimeAxisConfig {
  const tsList = dates
    .map(dateToUtcTs)
    .filter((ts) => Number.isFinite(ts))
    .sort((a, b) => a - b)
  if (!tsList.length) {
    return {
      ticks: [],
      domain: [0, 1],
      tickFormatter: () => "",
    }
  }

  const minTs = tsList[0]
  const maxTs = tsList[tsList.length - 1]
  const spanDays = Math.max(1, Math.round((maxTs - minTs) / 86400000))
  const monthStep = pickMonthStep(spanDays)
  const tickLabels = new Map<number, string>()
  const ticks: number[] = []

  function addTick(ts: number, label: string) {
    if (!Number.isFinite(ts) || ts < minTs || ts > maxTs) return
    if (tickLabels.has(ts)) {
      if (/^\d{4}$/.test(label)) tickLabels.set(ts, label)
      return
    }
    ticks.push(ts)
    tickLabels.set(ts, label)
  }

  const startYear = new Date(minTs).getUTCFullYear()
  const endYear = new Date(maxTs).getUTCFullYear()
  const startMonth = new Date(minTs).getUTCMonth() + 1
  const endMonth = new Date(maxTs).getUTCMonth() + 1

  if (monthStep >= 12) {
    for (let y = startYear; y <= endYear; y++) {
      const jan = Date.UTC(y, 0, 1)
      if (jan < minTs) addTick(minTs, String(y))
      else addTick(jan, String(y))
    }
  } else {
    let y = startYear
    let m = startMonth
    while (y < endYear || (y === endYear && m <= endMonth)) {
      const ts = Date.UTC(y, m - 1, 1)
      const label = m === 1 ? String(y) : formatMonthTargetLabel(y, m, spanDays)
      if (ts < minTs) addTick(minTs, label)
      else addTick(ts, label)
      m += monthStep
      while (m > 12) {
        m -= 12
        y += 1
      }
    }
  }

  // monthStep can skip the last month (e.g. 8/27 after a 7月 tick). Keep a tail label
  // so the chart does not look like it stopped a month early.
  const lastMonthTs = Date.UTC(endYear, endMonth - 1, 1)
  addTick(
    lastMonthTs < minTs ? minTs : lastMonthTs,
    endMonth === 1 ? String(endYear) : formatMonthTargetLabel(endYear, endMonth, spanDays),
  )

  ticks.sort((a, b) => a - b)
  return {
    ticks,
    domain: [minTs, maxTs],
    tickFormatter: (ts: number) =>
      tickLabels.get(ts) ?? formatChartAxisDateLabel(formatIsoDateFromTs(ts), spanDays),
  }
}

/**
 * Shared NAV x-axis.
 * Long ranges use a value axis + calendar ticks: ECharts 6.0.0 time-axis
 * `customValues` + function formatter throws (`tick.time.level`) and paints a blank chart,
 * and `minInterval` + `showMaxLabel: false` hid the last month (e.g. 8/27 labeled as 7月).
 */
export function echartsTimeXAxis(dates: string[]): Record<string, unknown> {
  const axis = buildTimeAxisConfig(dates)
  const spanDays = chartDateSpanDays(dates)
  const monthTicks = spanDays > 45
  const minTs = axis.domain[0]
  const lastTs = axis.domain[1]
  // One extra day so the last NAV point is inside the plot, not on the clip edge.
  const maxTs = Number.isFinite(lastTs) ? lastTs + MS_DAY : lastTs
  const labelStyle = {
    fontSize: 11,
    color: "#71717a",
    hideOverlap: true,
    showMinLabel: true,
  }
  if (!monthTicks) {
    return {
      type: "time",
      min: minTs,
      max: maxTs,
      boundaryGap: false,
      axisLabel: {
        ...labelStyle,
        showMaxLabel: true,
        formatter: (value: number) => {
          const iso = formatIsoDateFromTs(value)
          if (!iso) return ""
          const month = parseInt(iso.slice(5, 7), 10)
          const day = parseInt(iso.slice(8, 10), 10)
          return `${month}/${day}`
        },
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
    }
  }
  return {
    type: "value",
    min: minTs,
    max: maxTs,
    boundaryGap: false,
    axisLabel: {
      ...labelStyle,
      showMaxLabel: false,
      customValues: axis.ticks,
      formatter: (value: number) => axis.tickFormatter(value),
    },
    axisTick: { show: false },
    axisLine: { show: false },
    splitLine: { show: false },
  }
}

export function buildNavChartData(
  rows: NavRow[],
  chartMode: "nav" | "return",
  navType: string,
  hasBenchmark: boolean,
  benchmarkSeries: BenchmarkPoint[],
): NavChartPoint[] {
  if (!rows.length) return []
  const sampled = resampleNavRowsForChart(rows)
  const benchmarkValues = hasBenchmark
    ? buildAlignedBenchmarkValues(sampled, benchmarkSeries, chartMode, navType)
    : sampled.map(() => null)
  const firstNav = getNavFieldValue(sampled[0], navType)
  const fundNavValues = sampled.map((row) => getNavFieldValue(row, navType))
  const periodReturns = computePctChangeSeries(fundNavValues)
  const rawBenchmarkValues = hasBenchmark
    ? matchBenchmarkRawValues(sampled, benchmarkSeries)
    : sampled.map(() => null)
  const benchmarkPeriodReturns = computeNullablePctChangeSeries(rawBenchmarkValues)

  return sampled.map((row, index) => {
    const navValue = fundNavValues[index]
    return {
      date: row.price_date,
      ts: dateToUtcTs(row.price_date),
      value: chartMode === "return"
        ? (firstNav > 0 ? +(((navValue / firstNav) - 1) * 100).toFixed(4) : 0)
        : navValue,
      benchmarkValue: benchmarkValues[index],
      periodReturn: periodReturns[index],
      benchmarkPeriodReturn: benchmarkPeriodReturns[index],
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
  }).filter((v) => Number.isFinite(v))
  if (!vals.length) return ["auto", "auto"]
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
  ts: number
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

/** Downsample drawdown points after HWM math. Keep each bucket's deepest trough. */
export function downsampleDrawdownChartPoints(
  points: DrawdownChartPoint[],
  maxPoints = 720,
): DrawdownChartPoint[] {
  if (points.length <= maxPoints) return points
  const start = points[0].ts
  const end = points[points.length - 1].ts
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return points

  const step = (end - start) / (maxPoints - 1)
  const out: DrawdownChartPoint[] = [points[0]]
  let nextTs = start + step
  let best: DrawdownChartPoint | null = null
  const flush = () => {
    if (!best) return
    if (out[out.length - 1]?.date !== best.date) out.push(best)
    best = null
  }
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    if (!Number.isFinite(p.ts)) continue
    if (p.ts < nextTs) {
      if (!best || p.fundDD < best.fundDD) best = p
      continue
    }
    flush()
    best = p
    nextTs += step
    while (p.ts >= nextTs) nextTs += step
  }
  flush()
  const last = points[points.length - 1]
  if (out[out.length - 1]?.date !== last.date) out.push(last)
  return out
}

/** Running HWM on full NAV. Do not weekly-resample NAV before this — that misses mid-week peaks and understates MDD. */
export function buildDrawdownChartData(
  rows: NavRow[],
  navType: string,
  hasBenchmark: boolean,
  benchmarkSeries: BenchmarkPoint[],
): DrawdownChartPoint[] {
  const prepared = prepareNavRowsForChart(rows)
  if (!prepared.length) return []

  const fundValues = prepared.map((r) => getNavFieldValue(r, navType))
  const fundDD = computeDrawdownSeries(fundValues)

  const benchValues = hasBenchmark && benchmarkSeries.length
    ? buildAlignedBenchmarkValues(prepared, benchmarkSeries, "nav", navType)
    : prepared.map(() => null)

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

  const excessValues = prepared.map((_, i) => {
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

  const points = prepared.map((row, i) => ({
    date: row.price_date,
    ts: dateToUtcTs(row.price_date),
    fundDD: fundDD[i],
    benchDD: benchDD[i],
    excessDD: excessDD[i],
  }))
  return downsampleDrawdownChartPoints(points)
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
