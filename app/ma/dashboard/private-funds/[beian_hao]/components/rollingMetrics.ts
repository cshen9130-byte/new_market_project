import { computeFundNavMetrics, type FundNavMetrics } from "@/lib/fund-nav-metrics"
import { getNavFieldValue, type NavRow, type BenchmarkPoint } from "./shared"

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
  fund: number | null
  bench: number | null
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

function windowStartIndex(dates: string[], endIdx: number, windowDays: number): number {
  const endTs = new Date(dates[endIdx]).getTime()
  const startTs = endTs - windowDays * 86400000
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
  dates: string[],
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
    if (prevFund <= 0 || currFund <= 0 || prevBench === null || currBench === null || prevBench <= 0 || currBench <= 0) {
      continue
    }
    fundRets.push(currFund / prevFund - 1)
    benchRets.push(currBench / prevBench - 1)
  }
  return pearsonCorrelation(fundRets, benchRets)
}

export function computeRollingMetricSeries(
  rows: NavRow[],
  navType: string,
  benchmarkSeries: BenchmarkPoint[],
  windowDays: number,
  metric: RollingMetricKey,
): RollingMetricPoint[] {
  if (rows.length < 2) return []

  const dates = rows.map((r) => r.price_date)
  const fundValues = rows.map((r) => getNavFieldValue(r, navType))
  const benchValues = alignBenchmarkToRows(rows, benchmarkSeries)
  const out: RollingMetricPoint[] = []

  for (let i = 1; i < rows.length; i++) {
    const startIdx = windowStartIndex(dates, i, windowDays)
    if (i - startIdx < 1) {
      out.push({ date: dates[i], fund: null, bench: null })
      continue
    }

    if (metric === "correlation") {
      const corr = computeWindowCorrelation(dates, fundValues, benchValues, startIdx, i)
      out.push({ date: dates[i], fund: corr, bench: null })
      continue
    }

    const fundSlice = {
      dates: dates.slice(startIdx, i + 1),
      values: fundValues.slice(startIdx, i + 1),
    }
    const fundMetrics = computeFundNavMetrics(fundSlice)
    const fundVal = fundMetrics ? metricValue(fundMetrics, metric) : null

    let benchVal: number | null = null
    const benchSliceValues: number[] = []
    const benchSliceDates: string[] = []
    for (let j = startIdx; j <= i; j++) {
      const bv = benchValues[j]
      if (bv !== null && bv > 0) {
        benchSliceDates.push(dates[j])
        benchSliceValues.push(bv)
      }
    }
    if (benchSliceValues.length >= 2) {
      const benchMetrics = computeFundNavMetrics({ dates: benchSliceDates, values: benchSliceValues })
      benchVal = benchMetrics ? metricValue(benchMetrics, metric) : null
    }

    out.push({ date: dates[i], fund: fundVal, bench: benchVal })
  }

  return out.filter((p) => p.fund !== null || p.bench !== null)
}

export function downsampleRollingSeries(series: RollingMetricPoint[], maxPoints = 400): RollingMetricPoint[] {
  if (series.length <= maxPoints) return series
  const step = Math.ceil(series.length / maxPoints)
  const out: RollingMetricPoint[] = []
  for (let i = 0; i < series.length; i += step) out.push(series[i])
  if (out[out.length - 1] !== series[series.length - 1]) out.push(series[series.length - 1])
  return out
}

export function metricLabel(key: RollingMetricKey): string {
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

export function metricFormatType(key: RollingMetricKey): "pct" | "ratio" | "days" | "corr" {
  if (key === "periodRet" || key === "annVol" || key === "maxDD" || key === "downsideRisk") return "pct"
  if (key === "correlation") return "corr"
  if (key === "ddRecoveryDays" || key === "longestNoNewHighDays") return "days"
  return "ratio"
}

export function formatMetricValue(value: number | null, key: RollingMetricKey): string {
  if (value === null || !Number.isFinite(value)) return "—"
  const type = metricFormatType(key)
  if (type === "pct") return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
  if (type === "corr") return value.toFixed(3)
  if (type === "days") return `${Math.round(value)}`
  return value.toFixed(2)
}
