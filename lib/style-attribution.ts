/** Style factor definitions for commodity CTA nav attribution. */
export const STYLE_FACTOR_DEFS = [
  { key: "liquidity", name: "流动性因子" },
  { key: "ts_mom_long", name: "长期时间序列动量" },
  { key: "skew", name: "偏度因子" },
  { key: "ts_mom_short", name: "短期时间序列动量" },
  { key: "cs_mom_short", name: "短期截面动量" },
  { key: "basis_mom", name: "基差动量" },
  { key: "position_chg", name: "持仓变化因子" },
  { key: "vol_short", name: "短期波动因子" },
  { key: "term_structure", name: "期限结构因子" },
  { key: "price_breakout", name: "均价突破因子" },
  { key: "basis", name: "基差因子" },
] as const

export type StyleFactorKey = (typeof STYLE_FACTOR_DEFS)[number]["key"]

export interface FactorRegressionRow {
  index: number
  factorKey: StyleFactorKey
  factorName: string
  coefficient: number
  stdError: number
  tStat: number
  pValue: number
  correlation: number
}

export interface RegressionSummary {
  rSquared: number
  adjRSquared: number
  fStat: number
  fProb: number
  navCount: number
  method: string
}

export interface ExplainedReturnPoint {
  date: string
  productReturn: number
  factorReturn: number
  idiosyncraticReturn: number
}

export interface FactorContributionBar {
  key: string
  name: string
  contributionPct: number
}

export interface FactorContributionSeriesPoint {
  date: string
  idiosyncratic: number
  [factorKey: string]: number | string
}

export interface StyleAttributionResult {
  summary: RegressionSummary
  factors: FactorRegressionRow[]
  explainedReturns: ExplainedReturnPoint[]
  factorContributions: FactorContributionBar[]
  factorContributionSeries: FactorContributionSeriesPoint[]
  factorRiskContributions: FactorContributionBar[]
  productTotalReturn: number
  factorTotalReturn: number
  idiosyncraticTotalReturn: number
  dateFrom: string
  dateTo: string
}

export interface DailyCloseSeries {
  date: string
  close: number
}

export interface FactorSensitivityColumn {
  key: string
  label: string
  isInterval: boolean
  factors: FactorRegressionRow[]
  rSquared: number | null
}

export interface FactorSensitivityTrend {
  annualColumns: FactorSensitivityColumn[]
  quarterlyColumns: FactorSensitivityColumn[]
}

function dailyReturns(closes: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    out.push(prev > 0 ? closes[i] / prev - 1 : 0)
  }
  return out
}

function rollingMean(values: number[], window: number, endIdx: number): number {
  const start = Math.max(0, endIdx - window + 1)
  const slice = values.slice(start, endIdx + 1)
  if (!slice.length) return 0
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

function rollingStd(values: number[], window: number, endIdx: number): number {
  const start = Math.max(0, endIdx - window + 1)
  const slice = values.slice(start, endIdx + 1)
  if (slice.length < 2) return 0
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1)
  return Math.sqrt(Math.max(variance, 0))
}

function rollingSkew(values: number[], window: number, endIdx: number): number {
  const start = Math.max(0, endIdx - window + 1)
  const slice = values.slice(start, endIdx + 1)
  if (slice.length < 3) return 0
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length
  const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length)
  if (std < 1e-12) return 0
  const m3 = slice.reduce((a, b) => a + ((b - mean) / std) ** 3, 0) / slice.length
  return m3
}

function rollingReturn(closes: number[], window: number, endIdx: number): number {
  const startIdx = endIdx - window
  if (startIdx < 0) return 0
  const start = closes[startIdx]
  const end = closes[endIdx]
  return start > 0 ? end / start - 1 : 0
}

function zScoreAt(values: number[], idx: number, window: number): number {
  const start = Math.max(0, idx - window + 1)
  const slice = values.slice(start, idx + 1)
  if (slice.length < 2) return 0
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length
  const std = rollingStd(slice, slice.length, slice.length - 1)
  if (std < 1e-12) return 0
  return (values[idx] - mean) / std
}

function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  if (n < 2) return 0
  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const vx = x[i] - mx
    const vy = y[i] - my
    num += vx * vy
    dx += vx * vx
    dy += vy * vy
  }
  const den = Math.sqrt(dx * dy)
  return den > 1e-12 ? num / den : 0
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp(-x * x / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x > 0 ? 1 - p : p
}

function twoTailedP(tStat: number, df: number): number {
  if (df <= 0) return 1
  if (df > 30) return 2 * (1 - normalCdf(Math.abs(tStat)))
  const x = df / (df + tStat * tStat)
  return incompleteBeta(df / 2, 0.5, x)
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b)
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a
  let f = 1
  let c = 1
  let d = 0
  for (let i = 0; i <= 200; i++) {
    const m = Math.floor(i / 2)
    let num: number
    if (i === 0) num = 1
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
    else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))
    d = 1 + num * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    d = 1 / d
    c = 1 + num / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    f *= c * d
    if (Math.abs(c * d - 1) < 1e-8) break
  }
  return front * (f - 1)
}

function lgamma(z: number): number {
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.984369578019571e-6, 1.5056327351493116e-7,
  ]
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z)
  z -= 1
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
  const t = z + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

function invertMatrix(m: number[][]): number[][] | null {
  const n = m.length
  const aug = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row
    }
    if (Math.abs(aug[pivot][col]) < 1e-12) return null
    ;[aug[col], aug[pivot]] = [aug[pivot], aug[col]]
    const div = aug[col][col]
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= div
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j]
    }
  }
  return aug.map((row) => row.slice(n))
}

function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length
  const cols = b[0].length
  const inner = b.length
  const out = Array.from({ length: rows }, () => Array(cols).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < inner; k++) {
      for (let j = 0; j < cols; j++) out[i][j] += a[i][k] * b[k][j]
    }
  }
  return out
}

function matVec(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((sum, val, j) => sum + val * v[j], 0))
}

function transpose(m: number[][]): number[][] {
  return m[0].map((_, j) => m.map((row) => row[j]))
}

interface OlsOutput {
  coefficients: number[]
  stdErrors: number[]
  tStats: number[]
  pValues: number[]
  rSquared: number
  adjRSquared: number
  fStat: number
  fProb: number
  fitted: number[]
}

function runOls(y: number[], X: number[][]): OlsOutput | null {
  const n = y.length
  const k = X[0]?.length ?? 0
  if (n < k + 2) return null

  const Xt = transpose(X)
  const XtX = matMul(Xt, X)
  const XtXInv = invertMatrix(XtX)
  if (!XtXInv) return null

  const beta = matVec(XtXInv, matVec(Xt, y))
  const fitted = X.map((row) => row.reduce((sum, x, j) => sum + x * beta[j], 0))
  const residuals = y.map((yi, i) => yi - fitted[i])

  const yMean = y.reduce((a, b) => a + b, 0) / n
  const sst = y.reduce((a, yi) => a + (yi - yMean) ** 2, 0)
  const sse = residuals.reduce((a, r) => a + r * r, 0)
  const rSquared = sst > 1e-18 ? 1 - sse / sst : 0
  const adjRSquared = 1 - (1 - rSquared) * (n - 1) / Math.max(n - k, 1)
  const mse = sse / Math.max(n - k, 1)
  const df = n - k

  const stdErrors = XtXInv.map((row, i) => Math.sqrt(Math.max(row[i] * mse, 0)))
  const tStats = beta.map((b, i) => (stdErrors[i] > 1e-12 ? b / stdErrors[i] : 0))
  const pValues = tStats.map((t) => twoTailedP(t, df))

  const msr = (sst - sse) / Math.max(k - 1, 1)
  const fStat = sse > 1e-18 && k > 1 ? (msr / (sse / df)) : 0
  const fProb = k > 1 ? incompleteBeta((k - 1) / 2, df / 2, df / (df + (k - 1) * fStat)) : 1

  return {
    coefficients: beta,
    stdErrors,
    tStats,
    pValues,
    rSquared,
    adjRSquared,
    fStat,
    fProb,
    fitted,
  }
}

function alignSeriesByDate(
  main: DailyCloseSeries[],
  others: Record<string, DailyCloseSeries[]>,
): {
  dates: string[]
  mainCloses: number[]
  otherCloses: Record<string, number[]>
} {
  const dateSet = new Set(main.map((p) => p.date))
  for (const series of Object.values(others)) {
    for (const p of series) dateSet.add(p.date)
  }
  const dates = [...dateSet].sort()
  const mainMap = new Map(main.map((p) => [p.date, p.close]))
  const otherMaps = Object.fromEntries(
    Object.entries(others).map(([key, series]) => [key, new Map(series.map((p) => [p.date, p.close]))]),
  )

  let lastMain = main[0]?.close ?? 1
  const lastOther: Record<string, number> = {}
  for (const key of Object.keys(otherMaps)) {
    const first = others[key]?.[0]?.close
    lastOther[key] = first ?? 1
  }

  const mainCloses: number[] = []
  const otherCloses: Record<string, number[]> = Object.fromEntries(
    Object.keys(otherMaps).map((k) => [k, [] as number[]]),
  )

  for (const d of dates) {
    if (mainMap.has(d)) lastMain = mainMap.get(d)!
    mainCloses.push(lastMain)
    for (const [key, map] of Object.entries(otherMaps)) {
      if (map.has(d)) lastOther[key] = map.get(d)!
      otherCloses[key].push(lastOther[key])
    }
  }

  return { dates, mainCloses, otherCloses }
}

/** Build daily factor return matrix aligned to trading dates. */
export function buildFactorReturns(
  indexSeries: Record<string, DailyCloseSeries[]>,
  dates: string[],
): Record<StyleFactorKey, number[]> {
  const main = indexSeries["NHCI.NH"] ?? []
  const { dates: alignedDates, mainCloses, otherCloses } = alignSeriesByDate(main, {
    NHAI: indexSeries["NHAI.NH"] ?? [],
    NHECI: indexSeries["NHECI.NH"] ?? [],
    NHFI: indexSeries["NHFI.NH"] ?? [],
    NHPMI: indexSeries["NHPMI.NH"] ?? [],
    NHNFI: indexSeries["NHNFI.NH"] ?? [],
  })

  const dateIdx = new Map(alignedDates.map((d, i) => [d, i]))
  const n = dates.length
  const out = Object.fromEntries(STYLE_FACTOR_DEFS.map((f) => [f.key, Array(n).fill(0)])) as Record<
    StyleFactorKey,
    number[]
  >

  const mainRets = dailyReturns(mainCloses)
  const sectorKeys = ["NHAI", "NHECI", "NHFI", "NHPMI", "NHNFI"] as const

  for (let di = 0; di < n; di++) {
    const ai = dateIdx.get(dates[di])
    if (ai === undefined || ai < 1) continue
    const retIdx = ai - 1

    const vol20 = rollingStd(mainRets, 20, retIdx)
    const liqProxy = vol20 > 1e-8 ? -zScoreAt(mainRets.map((r) => Math.abs(r)), retIdx, 60) : 0
    out.liquidity[di] = liqProxy

    out.ts_mom_long[di] = rollingReturn(mainCloses, 60, ai)
    out.skew[di] = rollingSkew(mainRets, 20, retIdx)
    out.ts_mom_short[di] = rollingReturn(mainCloses, 20, ai)

    const csRets = sectorKeys
      .map((k) => {
        const closes = otherCloses[k]
        return closes ? rollingReturn(closes, 20, ai) : 0
      })
      .filter((v) => Number.isFinite(v))
    const csMean = csRets.length ? csRets.reduce((a, b) => a + b, 0) / csRets.length : 0
    out.cs_mom_short[di] = csMean - out.ts_mom_short[di]

    const nheci = otherCloses.NHECI
    const nhai = otherCloses.NHAI
    if (nheci && nhai) {
      const spread = nheci[ai] / Math.max(nhai[ai], 1e-8)
      const spreadPrev = nheci[ai - 1] / Math.max(nhai[ai - 1], 1e-8)
      out.basis_mom[di] = spreadPrev > 0 ? spread / spreadPrev - 1 : 0
      out.basis[di] = spread - 1
    }

    out.position_chg[di] = retIdx >= 1 ? mainRets[retIdx] - mainRets[retIdx - 1] : 0
    out.vol_short[di] = vol20

    const nhf = otherCloses.NHFI
    if (nhf) {
      out.term_structure[di] = rollingReturn(nhf, 20, ai) - out.ts_mom_short[di]
    }

    const ma60 = rollingMean(mainCloses, 60, ai)
    out.price_breakout[di] = ma60 > 0 ? mainCloses[ai] / ma60 - 1 : 0
  }

  return out
}

function cumulativeReturnPct(returns: number[]): number {
  let acc = 1
  for (const r of returns) acc *= 1 + r
  return (acc - 1) * 100
}

function cumulativeSeries(returns: number[]): number[] {
  let acc = 1
  return returns.map((r) => {
    acc *= 1 + r
    return (acc - 1) * 100
  })
}

function cumulativeSumSeries(values: number[]): number[] {
  let acc = 0
  return values.map((v) => {
    acc += v
    return acc * 100
  })
}

function sortContributionBars(bars: FactorContributionBar[]): FactorContributionBar[] {
  const positive = bars.filter((b) => b.contributionPct >= 0).sort((a, b) => b.contributionPct - a.contributionPct)
  const negative = bars.filter((b) => b.contributionPct < 0).sort((a, b) => a.contributionPct - b.contributionPct)
  return [...positive, ...negative]
}

function buildFactorContributions(
  factors: FactorRegressionRow[],
  factorReturns: Record<StyleFactorKey, number[]>,
  fundReturns: number[],
  dates: string[],
): {
  bars: FactorContributionBar[]
  series: FactorContributionSeriesPoint[]
  idiosyncraticTotalReturn: number
} {
  const n = fundReturns.length
  const dailyByFactor: Record<string, number[]> = {}

  for (const f of factors) {
    const beta = f.coefficient
    const rets = factorReturns[f.factorKey] ?? []
    dailyByFactor[f.factorKey] = rets.map((r) => beta * r)
  }

  const styleDailyTotal = Array.from({ length: n }, (_, i) =>
    factors.reduce((sum, f) => sum + (dailyByFactor[f.factorKey][i] ?? 0), 0),
  )
  const idiosyncraticDaily = fundReturns.map((r, i) => r - styleDailyTotal[i])

  const styleBars: FactorContributionBar[] = factors.map((f) => ({
    key: f.factorKey,
    name: f.factorName,
    contributionPct: (dailyByFactor[f.factorKey]?.reduce((a, b) => a + b, 0) ?? 0) * 100,
  }))

  const idiosyncraticPct = idiosyncraticDaily.reduce((a, b) => a + b, 0) * 100
  const bars = sortContributionBars([
    { key: "idiosyncratic", name: "特质因子", contributionPct: idiosyncraticPct },
    ...styleBars,
  ])

  const idiosyncraticCum = cumulativeSumSeries(idiosyncraticDaily)
  const factorCum: Record<string, number[]> = {}
  for (const f of factors) {
    factorCum[f.factorKey] = cumulativeSumSeries(dailyByFactor[f.factorKey] ?? [])
  }

  const series: FactorContributionSeriesPoint[] = dates.map((date, i) => {
    const point: FactorContributionSeriesPoint = { date, idiosyncratic: idiosyncraticCum[i] }
    for (const f of factors) point[f.factorKey] = factorCum[f.factorKey][i]
    return point
  })

  return { bars, series, idiosyncraticTotalReturn: idiosyncraticPct }
}

const TRADING_DAYS_PER_YEAR = 252

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(Math.max(variance, 0))
}

function annualizedVolPct(dailyReturns: number[]): number {
  return sampleStd(dailyReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100
}

function sortRiskContributionBars(bars: FactorContributionBar[]): FactorContributionBar[] {
  return [...bars].sort((a, b) => b.contributionPct - a.contributionPct)
}

function buildFactorRiskContributions(
  factors: FactorRegressionRow[],
  factorReturns: Record<StyleFactorKey, number[]>,
  fundReturns: number[],
): FactorContributionBar[] {
  const n = fundReturns.length
  const dailyByFactor: Record<string, number[]> = {}

  for (const f of factors) {
    const beta = f.coefficient
    const rets = factorReturns[f.factorKey] ?? []
    dailyByFactor[f.factorKey] = rets.map((r) => beta * r)
  }

  const styleDailyTotal = Array.from({ length: n }, (_, i) =>
    factors.reduce((sum, f) => sum + (dailyByFactor[f.factorKey][i] ?? 0), 0),
  )
  const idiosyncraticDaily = fundReturns.map((r, i) => r - styleDailyTotal[i])

  const styleBars: FactorContributionBar[] = factors.map((f) => ({
    key: f.factorKey,
    name: f.factorName,
    contributionPct: annualizedVolPct(dailyByFactor[f.factorKey] ?? []),
  }))

  return sortRiskContributionBars([
    { key: "idiosyncratic", name: "特质因子", contributionPct: annualizedVolPct(idiosyncraticDaily) },
    ...styleBars,
  ])
}

export function computeStyleAttribution(opts: {
  dates: string[]
  fundReturns: number[]
  factorReturns: Record<StyleFactorKey, number[]>
  includeIntercept?: boolean
}): StyleAttributionResult | null {
  const { dates, fundReturns, factorReturns, includeIntercept = true } = opts
  const n = fundReturns.length
  if (n < STYLE_FACTOR_DEFS.length + 5) return null

  const factorKeys = STYLE_FACTOR_DEFS.map((f) => f.key)
  const X: number[][] = []
  for (let i = 0; i < n; i++) {
    const row = includeIntercept ? [1] : []
    for (const key of factorKeys) row.push(factorReturns[key][i] ?? 0)
    X.push(row)
  }

  const ols = runOls(fundReturns, X)
  if (!ols) return null

  const offset = includeIntercept ? 1 : 0
  const factors: FactorRegressionRow[] = STYLE_FACTOR_DEFS.map((def, idx) => {
    const fi = idx + offset
    const factorSeries = factorReturns[def.key]
    return {
      index: idx + 1,
      factorKey: def.key,
      factorName: def.name,
      coefficient: ols.coefficients[fi],
      stdError: ols.stdErrors[fi],
      tStat: ols.tStats[fi],
      pValue: ols.pValues[fi],
      correlation: pearson(fundReturns, factorSeries),
    }
  })

  const fittedCum = cumulativeSeries(ols.fitted)
  const productCum = cumulativeSeries(fundReturns)
  const explainedReturns: ExplainedReturnPoint[] = dates.map((date, i) => ({
    date,
    productReturn: productCum[i],
    factorReturn: fittedCum[i],
    idiosyncraticReturn: productCum[i] - fittedCum[i],
  }))

  const productTotalReturn = cumulativeReturnPct(fundReturns)
  const factorTotalReturn = fittedCum[fittedCum.length - 1] ?? 0
  const { bars: factorContributions, series: factorContributionSeries, idiosyncraticTotalReturn } =
    buildFactorContributions(factors, factorReturns, fundReturns, dates)
  const factorRiskContributions = buildFactorRiskContributions(factors, factorReturns, fundReturns)

  return {
    summary: {
      rSquared: ols.rSquared,
      adjRSquared: ols.adjRSquared,
      fStat: ols.fStat,
      fProb: ols.fProb,
      navCount: n,
      method: "最小二乘法",
    },
    factors,
    explainedReturns,
    factorContributions,
    factorContributionSeries,
    factorRiskContributions,
    productTotalReturn,
    factorTotalReturn,
    idiosyncraticTotalReturn,
    dateFrom: dates[0] ?? "",
    dateTo: dates[dates.length - 1] ?? "",
  }
}

export function computeFundDailyReturns(
  navValues: number[],
): number[] {
  const out: number[] = []
  for (let i = 1; i < navValues.length; i++) {
    const prev = navValues[i - 1]
    out.push(prev > 0 ? navValues[i] / prev - 1 : 0)
  }
  return out
}

export function subtractSeries(a: number[], b: number[]): number[] {
  const n = Math.min(a.length, b.length)
  return Array.from({ length: n }, (_, i) => a[i] - b[i])
}

export function listYearsInRange(from: string, to: string): number[] {
  const y0 = parseInt(from.slice(0, 4), 10)
  const y1 = parseInt(to.slice(0, 4), 10)
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) return []
  const years: number[] = []
  for (let y = y0; y <= y1; y++) years.push(y)
  return years
}

export function listQuartersInRange(from: string, to: string): string[] {
  const start = new Date(from)
  const end = new Date(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []
  const out: string[] = []
  const seen = new Set<string>()
  const cursor = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1)
  while (cursor <= end) {
    const y = cursor.getFullYear()
    const q = Math.floor(cursor.getMonth() / 3) + 1
    const key = `${y}-Q${q}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(key)
    }
    cursor.setMonth(cursor.getMonth() + 3)
  }
  return out
}

export function quarterBounds(key: string, clipFrom: string, clipTo: string): { from: string; to: string } | null {
  const m = key.match(/^(\d{4})-Q([1-4])$/)
  if (!m) return null
  const year = parseInt(m[1], 10)
  const q = parseInt(m[2], 10)
  const startMonth = (q - 1) * 3
  const from = `${year}-${String(startMonth + 1).padStart(2, "0")}-01`
  const endMonth = startMonth + 3
  const endDay = new Date(year, endMonth, 0).getDate()
  const to = `${year}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`
  const boundedFrom = from < clipFrom ? clipFrom : from
  const boundedTo = to > clipTo ? clipTo : to
  if (boundedFrom > boundedTo) return null
  return { from: boundedFrom, to: boundedTo }
}

export function attributionToSensitivityColumn(
  result: StyleAttributionResult,
  key: string,
  label: string,
  isInterval: boolean,
): FactorSensitivityColumn {
  return {
    key,
    label,
    isInterval,
    factors: result.factors,
    rSquared: result.summary.rSquared,
  }
}
