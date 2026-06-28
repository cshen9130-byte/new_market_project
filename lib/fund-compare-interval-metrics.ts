export interface IntervalMetricValues {
  ret_1w: number | null
  ret_1m: number | null
  ret_3m: number | null
  ret_6m: number | null
  ret_1y: number | null
  sharpe_1y: number | null
  calmar_1y: number | null
}

export interface IntervalMetricsRow {
  key: string
  name: string
  isBenchmark: boolean
  navFrom: string | null
  navTo: string | null
  metricDate: string | null
  metrics: IntervalMetricValues
}

export function fmtIntervalPct(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—"
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`
}

export function fmtIntervalRatio(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—"
  return v.toFixed(4)
}
