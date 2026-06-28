export interface ReturnCurvePoint {
  d: string
  v: number
}

export interface CompareMetrics {
  periodReturn: number | null
  annReturn: number | null
  annVol: number | null
  sharpe: number | null
  calmar: number | null
  sortino: number | null
  downsideRisk: number | null
  maxDrawdown: number | null
  maxDdRecoveryDays: number | "未回补" | null
  longestNoNewHighDays: number | null
}

export interface CompareMetricsRow {
  key: string
  name: string
  isBenchmark: boolean
  navFrom: string | null
  navTo: string | null
  metrics: CompareMetrics
}

function mean(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function std(values: number[]) {
  if (values.length <= 1) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1))
}

function periodicReturns(points: ReturnCurvePoint[]): number[] {
  const rets: number[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = 1 + points[i - 1].v / 100
    const curr = 1 + points[i].v / 100
    if (prev > 0) rets.push(curr / prev - 1)
  }
  return rets
}

function maxDrawdownStats(points: ReturnCurvePoint[]) {
  if (points.length === 0) {
    return { maxDrawdown: null as number | null, recoveryDays: null as number | "未回补" | null, longestNoNewHigh: null as number | null }
  }

  let peak = 1 + points[0].v / 100
  let maxDd = 0
  let longestNoNewHigh = 0
  let currentNoNewHigh = 0
  let underwaterStart: number | null = null
  let recoveryDays: number | "未回补" | null = null

  points.forEach((point, idx) => {
    const level = 1 + point.v / 100
    if (level >= peak) {
      peak = level
      currentNoNewHigh = 0
      if (underwaterStart != null && recoveryDays == null) recoveryDays = idx - underwaterStart
      underwaterStart = null
    } else {
      currentNoNewHigh++
      longestNoNewHigh = Math.max(longestNoNewHigh, currentNoNewHigh)
      if (underwaterStart == null) underwaterStart = idx
      const dd = peak > 0 ? (peak - level) / peak : 0
      maxDd = Math.max(maxDd, dd)
    }
  })

  if (underwaterStart != null && recoveryDays == null) recoveryDays = "未回补"

  return {
    maxDrawdown: maxDd * 100,
    recoveryDays,
    longestNoNewHigh: longestNoNewHigh || null,
  }
}

export function computeCompareMetrics(points: ReturnCurvePoint[]): CompareMetrics {
  if (points.length < 2) {
    return {
      periodReturn: null,
      annReturn: null,
      annVol: null,
      sharpe: null,
      calmar: null,
      sortino: null,
      downsideRisk: null,
      maxDrawdown: null,
      maxDdRecoveryDays: null,
      longestNoNewHighDays: null,
    }
  }

  const rets = periodicReturns(points)
  const start = new Date(points[0].d).getTime()
  const end = new Date(points.at(-1)!.d).getTime()
  const days = Math.max(1, Math.round((end - start) / 86_400_000))
  const periodReturn = points.at(-1)!.v
  const totalRet = periodReturn / 100
  const annReturn = (Math.pow(1 + totalRet, 365 / days) - 1) * 100
  const annVol = std(rets) * Math.sqrt(252) * 100
  const downside = rets.filter((r) => r < 0)
  const downsideRisk = downside.length > 0 ? std(downside) * Math.sqrt(252) * 100 : 0
  const sharpe = annVol > 0 ? annReturn / annVol : null
  const { maxDrawdown, recoveryDays, longestNoNewHigh } = maxDrawdownStats(points)
  const calmar = maxDrawdown && maxDrawdown > 0 ? annReturn / maxDrawdown : null
  const downsideDev = downside.length > 0 ? std(downside) * Math.sqrt(252) * 100 : null
  const sortino = downsideDev && downsideDev > 0 ? annReturn / downsideDev : null

  return {
    periodReturn,
    annReturn,
    annVol,
    sharpe,
    calmar,
    sortino,
    downsideRisk,
    maxDrawdown,
    maxDdRecoveryDays: recoveryDays,
    longestNoNewHighDays: longestNoNewHigh,
  }
}

export function buildCompareMetricsRows(
  funds: Array<{ key: string; name: string; returnPoints: ReturnCurvePoint[] }>,
  benchmark?: { key: string; name: string; returnPoints: ReturnCurvePoint[] },
): CompareMetricsRow[] {
  const rows = funds.map((fund) => ({
    key: fund.key,
    name: fund.name,
    isBenchmark: false,
    navFrom: fund.returnPoints[0]?.d ?? null,
    navTo: fund.returnPoints.at(-1)?.d ?? null,
    metrics: computeCompareMetrics(fund.returnPoints),
  }))

  if (benchmark && benchmark.returnPoints.length > 0) {
    rows.push({
      key: benchmark.key,
      name: benchmark.name,
      isBenchmark: true,
      navFrom: benchmark.returnPoints[0]?.d ?? null,
      navTo: benchmark.returnPoints.at(-1)?.d ?? null,
      metrics: computeCompareMetrics(benchmark.returnPoints),
    })
  }

  return rows
}

export function fmtSignedPct(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—"
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`
}

export function fmtPct(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—"
  return `${v.toFixed(2)}%`
}

export function fmtRatio(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—"
  return v.toFixed(4)
}

export function fmtRecovery(v: number | "未回补" | null | undefined) {
  if (v == null) return "—"
  if (v === "未回补") return "未回补"
  return String(v)
}
