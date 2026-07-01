export interface NavMetricSlice {
  dates: string[]
  values: number[]
}

export interface FundNavMetrics {
  periodRet: number
  annVol: number
  sharpe: number
  calmar: number
  maxDD: number
  sortino: number
  downsideRisk: number
  ddRecoveryDays: number | null
  longestNoNewHighDays: number
}

const RF = 0.02

/** Calmar below ~0.01% drawdown is numerically unstable and not meaningful. */
export const MIN_CALMAR_DRAWDOWN = 1e-4

export const MAX_PLAUSIBLE_RISK_RATIO = 50

export function isPlausibleRiskRatio(
  value: number | null | undefined,
  maxAbs = MAX_PLAUSIBLE_RISK_RATIO,
): value is number {
  return value != null && Number.isFinite(value) && Math.abs(value) <= maxAbs
}

export function sanitizeRiskMetricText(value: string | null | undefined): string | null {
  if (value == null || value === "") return null
  const n = parseFloat(String(value))
  return isPlausibleRiskRatio(n) ? String(n) : null
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function std(arr: number[], ddof = 1): number {
  if (arr.length <= ddof) return NaN
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - ddof))
}

export function computeFundNavMetrics(slice: NavMetricSlice): FundNavMetrics | null {
  const { dates, values } = slice
  if (dates.length < 2 || values.length < 2) return null

  const dateTs = dates.map((d) => new Date(d).getTime())
  const totalDays = (dateTs[dateTs.length - 1] - dateTs[0]) / 86400000
  const years = Math.max(totalDays / 365.25, 1 / 365)

  const gaps: number[] = []
  for (let i = 1; i < dateTs.length; i++) gaps.push((dateTs[i] - dateTs[i - 1]) / 86400000)
  gaps.sort((a, b) => a - b)
  const medGap = gaps[Math.floor(gaps.length / 2)] || 1
  const ppy = medGap <= 2 ? 252 : medGap <= 10 ? 52 : medGap <= 20 ? 26 : medGap <= 45 ? 12 : 4

  const rets: number[] = []
  for (let i = 1; i < values.length; i++) {
    rets.push(values[i - 1] > 0 ? values[i] / values[i - 1] - 1 : 0)
  }
  if (rets.length < 1) return null

  const periodRet = values[values.length - 1] / values[0] - 1
  const annRet = Math.pow(1 + periodRet, 1 / years) - 1
  const annVol = rets.length > 1 ? std(rets) * Math.sqrt(ppy) : NaN
  const sharpe = isFinite(annVol) && annVol > 0 ? (annRet - RF) / annVol : NaN

  let peak = values[0]
  let peakTs = dateTs[0]
  let maxDD = 0
  let troughTs = dateTs[0]
  let maxDDPeakVal = values[0]
  let longestNoNewHigh = 0
  let curHighTs = dateTs[0]

  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i]
      peakTs = dateTs[i]
      curHighTs = dateTs[i]
    } else {
      const d = (dateTs[i] - curHighTs) / 86400000
      if (d > longestNoNewHigh) longestNoNewHigh = d
    }
    const dd = peak > 0 ? (peak - values[i]) / peak : 0
    if (dd > maxDD) {
      maxDD = dd
      troughTs = dateTs[i]
      maxDDPeakVal = peak
    }
  }

  let ddRecoveryDays: number | null = null
  for (let i = 0; i < values.length; i++) {
    if (dateTs[i] > troughTs && values[i] >= maxDDPeakVal) {
      ddRecoveryDays = Math.round((dateTs[i] - troughTs) / 86400000)
      break
    }
  }

  const calmar = maxDD >= MIN_CALMAR_DRAWDOWN ? annRet / maxDD : NaN
  const downRets = rets.filter((r) => r < 0)
  const downsideRisk =
    downRets.length > 0
      ? Math.sqrt(downRets.reduce((s, r) => s + r * r, 0) / downRets.length) * Math.sqrt(ppy)
      : 0
  const sortino = downsideRisk > 0 ? (annRet - RF) / downsideRisk : NaN

  if (!isFinite(periodRet)) return null

  return {
    periodRet,
    annVol: isFinite(annVol) ? annVol : NaN,
    sharpe: isFinite(sharpe) ? sharpe : NaN,
    calmar: isFinite(calmar) ? calmar : NaN,
    maxDD,
    sortino: isFinite(sortino) ? sortino : NaN,
    downsideRisk,
    ddRecoveryDays,
    longestNoNewHighDays: Math.round(longestNoNewHigh),
  }
}

export type MetricKey = keyof FundNavMetrics

export const ANNUAL_METRIC_COLUMNS: Array<{
  key: MetricKey
  label: string
  type: "pct" | "ratio" | "days"
  higherIsBetter: boolean
}> = [
  { key: "periodRet", label: "区间收益", type: "pct", higherIsBetter: true },
  { key: "annVol", label: "年化波动率", type: "pct", higherIsBetter: false },
  { key: "sharpe", label: "夏普比率", type: "ratio", higherIsBetter: true },
  { key: "calmar", label: "卡玛比率", type: "ratio", higherIsBetter: true },
  { key: "maxDD", label: "最大回撤", type: "pct", higherIsBetter: false },
  { key: "sortino", label: "索提诺比率", type: "ratio", higherIsBetter: true },
  { key: "downsideRisk", label: "下行风险", type: "pct", higherIsBetter: false },
  { key: "ddRecoveryDays", label: "最大回撤修复(天)", type: "days", higherIsBetter: false },
  { key: "longestNoNewHighDays", label: "最长连续不创新高天数(天)", type: "days", higherIsBetter: false },
]

export function metricMean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length
}

export function metricMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function metricRank(value: number, peers: number[], higherIsBetter: boolean): number {
  let better = 0
  for (const v of peers) {
    if (higherIsBetter ? v > value : v < value) better++
  }
  return better + 1
}

export function metricPercentile(rank: number, sampleN: number): number {
  if (sampleN <= 0) return 0
  return +(((rank - 1) / sampleN) * 100).toFixed(2)
}
