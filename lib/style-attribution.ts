import { FUTURES_STYLE_PAGE_FACTORS } from "@/lib/futures-style-page-factors"

/** Commodity CTA nav attribution uses the 期货风格因子 page's default nine books. */
export const STYLE_FACTOR_DEFS = FUTURES_STYLE_PAGE_FACTORS

export type StyleFactorKey = (typeof STYLE_FACTOR_DEFS)[number]["key"]

/** Asset-class factors for FOF / multi-asset NAV attribution (index/ETF daily returns). */
export const MULTI_ASSET_FACTOR_DEFS = [
  { key: "if", name: "大盘权益(沪深300)", code: "IF" },
  { key: "ic", name: "中盘权益(中证500)", code: "IC" },
  { key: "im", name: "小盘权益(中证1000)", code: "IM" },
  { key: "ih", name: "蓝筹权益(上证50)", code: "IH" },
  { key: "bond", name: "利率债(国债ETF)", code: "511010.SH" },
  { key: "gold", name: "黄金(黄金ETF)", code: "518880.SH" },
  { key: "commodity", name: "商品(南华商品)", code: "NHCI.NH" },
] as const

export type MultiAssetFactorKey = (typeof MULTI_ASSET_FACTOR_DEFS)[number]["key"]

export type AttributionFactorModel = "multi-asset" | "commodity-cta"

export interface FactorDef {
  key: string
  name: string
}

export interface FactorRegressionRow {
  index: number
  factorKey: string
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
  intercept: FactorRegressionRow | null
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

/**
 * Compound each factor's daily portfolio return over (navDates[i-1], navDates[i]].
 * Daily NAVs pick up that day's factor return; weekly NAVs span the days in between.
 * Null days are skipped, matching how 期货风格因子 compounds its cumulative charts.
 */
export function compoundFactorReturnsToNavDates(
  factorDates: string[],
  series: Record<string, Array<number | null>>,
  navDates: string[],
): Record<string, number[]> {
  const n = Math.max(0, navDates.length - 1)
  const keys = Object.keys(series)
  const out: Record<string, number[]> = Object.fromEntries(keys.map((k) => [k, Array(n).fill(0)]))
  if (n === 0 || factorDates.length === 0) return out

  let cursor = 0
  for (let i = 1; i < navDates.length; i++) {
    const prev = navDates[i - 1]
    const cur = navDates[i]
    while (cursor < factorDates.length && factorDates[cursor] <= prev) cursor++
    let end = cursor
    while (end < factorDates.length && factorDates[end] <= cur) end++
    for (const key of keys) {
      const arr = series[key]
      let acc = 1
      let any = false
      for (let j = cursor; j < end; j++) {
        const v = arr?.[j]
        if (v != null && Number.isFinite(v)) {
          acc *= 1 + v
          any = true
        }
      }
      out[key][i - 1] = any ? acc - 1 : 0
    }
    cursor = end
  }
  return out
}

/** Build asset-class factor returns matched to product NAV return dates. */
export function buildMultiAssetFactorReturns(
  indexSeries: Record<string, DailyCloseSeries[]>,
  returnDates: string[],
  startDate: string,
): Record<string, number[]> {
  const n = returnDates.length
  const out: Record<string, number[]> = {}

  for (const def of MULTI_ASSET_FACTOR_DEFS) {
    const series = indexSeries[def.code] ?? []
    const map = new Map(series.map((p) => [p.date, p.close]))
    const rets = Array(n).fill(0) as number[]

    const ffillClose = (date: string, fallback: number): number => {
      if (map.has(date)) return map.get(date)!
      let close = fallback
      for (const p of series) {
        if (p.date <= date) close = p.close
        else break
      }
      return close > 0 ? close : fallback
    }

    let prevClose = ffillClose(startDate, series[0]?.close ?? 1)
    for (let i = 0; i < n; i++) {
      const close = ffillClose(returnDates[i], prevClose)
      rets[i] = prevClose > 0 ? close / prevClose - 1 : 0
      prevClose = close
    }
    out[def.key] = rets
  }

  return out
}

export function factorDefsForModel(model: AttributionFactorModel): FactorDef[] {
  if (model === "multi-asset") {
    return MULTI_ASSET_FACTOR_DEFS.map((f) => ({ key: f.key, name: f.name }))
  }
  return STYLE_FACTOR_DEFS.map((f) => ({ key: f.key, name: f.name }))
}

export function marketCodesForModel(model: AttributionFactorModel): string[] {
  if (model === "multi-asset") {
    return MULTI_ASSET_FACTOR_DEFS.map((f) => f.code)
  }
  return []
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
  factorReturns: Record<string, number[]>,
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
  factorReturns: Record<string, number[]>,
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
  factorReturns: Record<string, number[]>
  factorDefs?: FactorDef[]
  includeIntercept?: boolean
}): StyleAttributionResult | null {
  const {
    dates,
    fundReturns,
    factorReturns,
    factorDefs = STYLE_FACTOR_DEFS.map((f) => ({ key: f.key, name: f.name })),
    includeIntercept = true,
  } = opts
  const n = fundReturns.length
  if (n < factorDefs.length + 5) return null

  const factorKeys = factorDefs.map((f) => f.key)
  const X: number[][] = []
  for (let i = 0; i < n; i++) {
    const row = includeIntercept ? [1] : []
    for (const key of factorKeys) row.push(factorReturns[key]?.[i] ?? 0)
    X.push(row)
  }

  const ols = runOls(fundReturns, X)
  if (!ols) return null

  const offset = includeIntercept ? 1 : 0
  const intercept: FactorRegressionRow | null = includeIntercept
    ? {
        index: 0,
        factorKey: "alpha",
        factorName: "截距(周频α)",
        coefficient: ols.coefficients[0],
        stdError: ols.stdErrors[0],
        tStat: ols.tStats[0],
        pValue: ols.pValues[0],
        correlation: 0,
      }
    : null
  const factors: FactorRegressionRow[] = factorDefs.map((def, idx) => {
    const fi = idx + offset
    const factorSeries = factorReturns[def.key] ?? []
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
    intercept,
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
