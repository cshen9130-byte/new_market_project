import { computeFundNavMetrics, type FundNavMetrics } from "@/lib/fund-nav-metrics"
import type { NavPoint } from "@/lib/fund-compare-period-returns"
import cnStatutoryHolidayDates from "@/lib/cn-statutory-holiday-dates.json"
import { isWeekendIsoDate } from "@/lib/nav-trading-day"

const CN_CLOSED_DATES = new Set(cnStatutoryHolidayDates)

/** Weekends and State Council 放假/调休 rest days — not A-share trading days. */
export function isCnMarketClosedIsoDate(isoDate: string): boolean {
  const day = isoDate.slice(0, 10)
  return isWeekendIsoDate(day) || CN_CLOSED_DATES.has(day)
}

export type RollingMetricKey =
  | "periodRet"
  | "annVol"
  | "sharpe"
  | "calmar"
  | "maxDD"
  | "correlation"
  | "sortino"
  | "downsideRisk"
  | "ddRecoveryDays"
  | "longestNoNewHighDays"

export interface RollingMetricPoint {
  date: string
  value: number | null
}

export const PRIMARY_ROLLING_METRICS: RollingMetricKey[] = [
  "periodRet", "annVol", "sharpe", "calmar", "maxDD", "correlation",
]

export const EXTRA_ROLLING_METRICS: RollingMetricKey[] = [
  "sortino", "downsideRisk", "ddRecoveryDays", "longestNoNewHighDays",
]

export const ROLLING_WINDOW_OPTIONS = [
  { days: 90, label: "三个月" },
  { days: 182, label: "六个月" },
  { days: 365, label: "一年" },
  { days: 730, label: "两年" },
] as const

function sortNavPoints(points: NavPoint[]): NavPoint[] {
  return [...points].sort((a, b) => a.d.localeCompare(b.d))
}

function alignBenchmarkValues(dates: string[], benchPoints: NavPoint[]): (number | null)[] {
  const sorted = sortNavPoints(benchPoints)
  let idx = 0
  let last: number | null = null
  return dates.map((d) => {
    while (idx < sorted.length && sorted[idx].d <= d) {
      last = sorted[idx].v
      idx += 1
    }
    return last
  })
}

function windowStartIndex(dates: string[], endIdx: number, windowDays: number): number {
  const endTs = new Date(dates[endIdx]).getTime()
  const startTs = endTs - windowDays * 86_400_000
  let startIdx = endIdx
  while (startIdx > 0 && new Date(dates[startIdx - 1]).getTime() >= startTs) startIdx -= 1
  return startIdx
}

function pearsonCorrelation(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const fa = a[i] - ma
    const fb = b[i] - mb
    num += fa * fb
    da += fa * fa
    db += fb * fb
  }
  const den = Math.sqrt(da * db)
  return den > 0 ? num / den : null
}

function metricValue(metrics: FundNavMetrics, key: RollingMetricKey): number | null {
  switch (key) {
    case "periodRet":
      return metrics.periodRet * 100
    case "annVol":
      return metrics.annVol * 100
    case "maxDD":
      return -metrics.maxDD * 100
    case "downsideRisk":
      return metrics.downsideRisk * 100
    case "sharpe":
      return metrics.sharpe
    case "calmar":
      return metrics.calmar
    case "sortino":
      return metrics.sortino
    case "ddRecoveryDays":
      return metrics.ddRecoveryDays
    case "longestNoNewHighDays":
      return metrics.longestNoNewHighDays
    default:
      return null
  }
}

function computeWindowCorrelation(
  fundValues: number[],
  benchValues: (number | null)[],
  startIdx: number,
  endIdx: number,
): number | null {
  const fundRets: number[] = []
  const benchRets: number[] = []
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const prevFund = fundValues[i - 1]
    const currFund = fundValues[i]
    const prevBench = benchValues[i - 1]
    const currBench = benchValues[i]
    if (
      prevFund <= 0 || currFund <= 0
      || prevBench === null || currBench === null
      || prevBench <= 0 || currBench <= 0
    ) continue
    fundRets.push(currFund / prevFund - 1)
    benchRets.push(currBench / prevBench - 1)
  }
  return pearsonCorrelation(fundRets, benchRets)
}

export function computeRollingMetricSeriesNav(
  fundPoints: NavPoint[],
  benchPoints: NavPoint[],
  windowDays: number,
  metric: RollingMetricKey,
): RollingMetricPoint[] {
  const sorted = sortNavPoints(fundPoints)
  if (sorted.length < 2) return []

  const dates = sorted.map((p) => p.d)
  const fundValues = sorted.map((p) => p.v)
  const benchValues = alignBenchmarkValues(dates, benchPoints)
  const out: RollingMetricPoint[] = []

  for (let i = 1; i < sorted.length; i++) {
    const startIdx = windowStartIndex(dates, i, windowDays)
    if (i - startIdx < 1) {
      out.push({ date: dates[i], value: null })
      continue
    }

    if (metric === "correlation") {
      const corr = computeWindowCorrelation(fundValues, benchValues, startIdx, i)
      out.push({ date: dates[i], value: corr })
      continue
    }

    const fundMetrics = computeFundNavMetrics({
      dates: dates.slice(startIdx, i + 1),
      values: fundValues.slice(startIdx, i + 1),
    })
    out.push({
      date: dates[i],
      value: fundMetrics ? metricValue(fundMetrics, metric) : null,
    })
  }

  return out.filter((p) => p.value !== null)
}

export function computeBenchmarkRollingSeriesNav(
  benchPoints: NavPoint[],
  windowDays: number,
  metric: RollingMetricKey,
): RollingMetricPoint[] {
  if (metric === "correlation") return []
  const sorted = sortNavPoints(benchPoints)
  if (sorted.length < 2) return []

  const dates = sorted.map((p) => p.d)
  const values = sorted.map((p) => p.v)
  const out: RollingMetricPoint[] = []

  for (let i = 1; i < sorted.length; i++) {
    const startIdx = windowStartIndex(dates, i, windowDays)
    if (i - startIdx < 1) continue
    const metrics = computeFundNavMetrics({
      dates: dates.slice(startIdx, i + 1),
      values: values.slice(startIdx, i + 1),
    })
    const val = metrics ? metricValue(metrics, metric) : null
    if (val != null) out.push({ date: dates[i], value: val })
  }
  return out
}

export function downsampleDateAxis(dates: string[], maxPoints = 400): string[] {
  if (dates.length <= maxPoints) return dates
  const step = Math.ceil(dates.length / maxPoints)
  const out: string[] = []
  for (let i = 0; i < dates.length; i += step) out.push(dates[i])
  if (out.at(-1) !== dates.at(-1)) out.push(dates.at(-1)!)
  return out
}

export function mergeRollingDates(seriesList: RollingMetricPoint[][]): string[] {
  const dates = new Set<string>()
  for (const series of seriesList) {
    for (const p of series) {
      if (!isCnMarketClosedIsoDate(p.date)) dates.add(p.date)
    }
  }
  return [...dates].sort()
}

/**
 * Map a series onto a shared trading-day axis. Carry the last value across
 * missing dates (CN holidays, or NAV not published that day) so the line
 * stays continuous. Null only outside the series' own date range.
 */
export function alignRollingValuesToDates(
  dates: string[],
  points: RollingMetricPoint[],
): (number | null)[] {
  const sorted = [...points]
    .filter((p): p is RollingMetricPoint & { value: number } => p.value != null && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!sorted.length) return dates.map(() => null)

  const first = sorted[0].date
  const last = sorted[sorted.length - 1].date
  let idx = 0
  let carried: number | null = null
  return dates.map((d) => {
    while (idx < sorted.length && sorted[idx].date <= d) {
      carried = sorted[idx].value
      idx += 1
    }
    if (d < first || d > last) return null
    return carried
  })
}

export function rollingMetricLabel(key: RollingMetricKey): string {
  const map: Record<RollingMetricKey, string> = {
    periodRet: "收益率",
    annVol: "年化波动率",
    sharpe: "夏普比率",
    calmar: "卡玛比率",
    maxDD: "最大回撤",
    correlation: "相关系数",
    sortino: "索提诺比率",
    downsideRisk: "下行风险",
    ddRecoveryDays: "最大回撤修复(天)",
    longestNoNewHighDays: "最长连续不创新高天数(天)",
  }
  return map[key]
}

export function rollingMetricFormatType(key: RollingMetricKey): "pct" | "ratio" | "days" | "corr" {
  if (key === "periodRet" || key === "annVol" || key === "maxDD" || key === "downsideRisk") return "pct"
  if (key === "correlation") return "corr"
  if (key === "ddRecoveryDays" || key === "longestNoNewHighDays") return "days"
  return "ratio"
}

export function formatRollingMetricValue(value: number | null, key: RollingMetricKey): string {
  if (value === null || !Number.isFinite(value)) return "—"
  const type = rollingMetricFormatType(key)
  if (type === "pct") return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
  if (type === "corr") return value.toFixed(3)
  if (type === "days") return String(Math.round(value))
  return value.toFixed(2)
}

export function formatRollingAxisDate(dateStr: string): string {
  const year = dateStr.slice(2, 4)
  const month = parseInt(dateStr.slice(5, 7), 10)
  if (month === 1 || dateStr.endsWith("-01-01")) return year
  return `${month}月`
}

export function rollingYDomain(values: number[], metric: RollingMetricKey): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v))
  if (!finite.length) {
    return metric === "correlation" ? [-1, 1] : [0, 1]
  }
  if (metric === "correlation") return [-1, 1]
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const pad = Math.max((max - min) * 0.08, rollingMetricFormatType(metric) === "ratio" ? 0.1 : 1)
  return [+(min - pad).toFixed(2), +(max + pad).toFixed(2)]
}
