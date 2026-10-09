export const FIT_METHODS = ["normal", "t", "laplace", "logistic", "kde"] as const

export type FitMethod = (typeof FIT_METHODS)[number]

export type FitChoice = "auto" | "frequency" | FitMethod

export type ParametricMethod = Exclude<FitMethod, "kde">

export type ParametricFit = {
  method: ParametricMethod
  aic: number
  logLik: number
  mean: number
  scale: number
  nu?: number
}

const METHOD_LABEL: Record<FitMethod, string> = {
  normal: "正态",
  t: "t 分布",
  laplace: "拉普拉斯",
  logistic: "Logistic",
  kde: "核密度",
}

const PREFERENCE: Record<ParametricMethod, number> = {
  normal: 0,
  logistic: 1,
  laplace: 2,
  t: 3,
}

const T_DF = [2.5, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50, 80]

export function fitMethodLabel(method: FitMethod): string {
  return METHOD_LABEL[method]
}

function logGamma(z: number): number {
  const g = 7
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ]
  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.abs(Math.sin(Math.PI * z))) - logGamma(1 - z)
  }
  let zz = z - 1
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (zz + i)
  const t = zz + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x)
}

function moments(values: number[]): { n: number; mean: number; sigma: number } | null {
  const n = values.length
  if (n < 2) return null
  let sum = 0
  for (const value of values) sum += value
  const mean = sum / n
  let ss = 0
  for (const value of values) {
    const d = value - mean
    ss += d * d
  }
  const sigma = Math.sqrt(ss / n)
  if (!(sigma > 1e-8)) return null
  return { n, mean, sigma }
}

function sampleMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function normalFit(values: number[]): ParametricFit | null {
  const mom = moments(values)
  if (!mom) return null
  const { n, mean, sigma } = mom
  const logLik = -0.5 * n * (Math.log(2 * Math.PI) + 2 * Math.log(sigma) + 1)
  return { method: "normal", mean, scale: sigma, logLik, aic: 4 - 2 * logLik }
}

function laplaceFit(values: number[]): ParametricFit | null {
  const n = values.length
  if (n < 2) return null
  const mean = sampleMedian(values)
  let abs = 0
  for (const value of values) abs += Math.abs(value - mean)
  const scale = abs / n
  if (!(scale > 1e-8)) return null
  const logLik = -n * Math.log(2 * scale) - n
  return { method: "laplace", mean, scale, logLik, aic: 4 - 2 * logLik }
}

function logisticLogLik(values: number[], mean: number, scale: number): number {
  if (!(scale > 1e-8)) return Number.NEGATIVE_INFINITY
  const logScale = Math.log(scale)
  let logLik = 0
  for (const value of values) {
    const z = (value - mean) / scale
    const log1pe = z >= 0 ? Math.log1p(Math.exp(-z)) : -z + Math.log1p(Math.exp(z))
    logLik += -z - logScale - 2 * log1pe
  }
  return logLik
}

function logisticFit(values: number[]): ParametricFit | null {
  const mom = moments(values)
  if (!mom) return null
  const base = mom.sigma * Math.sqrt(3) / Math.PI
  let bestScale = base
  let bestLogLik = Number.NEGATIVE_INFINITY
  for (let i = 0; i <= 40; i++) {
    const scale = base * (0.5 + (i / 40) * 1.5)
    const logLik = logisticLogLik(values, mom.mean, scale)
    if (logLik > bestLogLik) {
      bestLogLik = logLik
      bestScale = scale
    }
  }
  if (!Number.isFinite(bestLogLik)) return null
  return {
    method: "logistic",
    mean: mom.mean,
    scale: bestScale,
    logLik: bestLogLik,
    aic: 4 - 2 * bestLogLik,
  }
}

function studentTFit(values: number[]): ParametricFit | null {
  const mom = moments(values)
  if (!mom) return null
  let best: ParametricFit | null = null
  for (const nu of T_DF) {
    const scale = mom.sigma * Math.sqrt((nu - 2) / nu)
    if (!(scale > 1e-8)) continue
    const logC = logGamma((nu + 1) / 2) - 0.5 * Math.log(nu * Math.PI) - logGamma(nu / 2) - Math.log(scale)
    let logLik = 0
    for (const value of values) {
      const z = (value - mom.mean) / scale
      logLik += logC - ((nu + 1) / 2) * Math.log(1 + (z * z) / nu)
    }
    const fit: ParametricFit = {
      method: "t",
      mean: mom.mean,
      scale,
      nu,
      logLik,
      aic: 6 - 2 * logLik,
    }
    if (!best || fit.aic < best.aic) best = fit
  }
  return best
}

export function rankParametricFits(values: number[]): ParametricFit[] {
  const fits = [normalFit(values), logisticFit(values), laplaceFit(values), studentTFit(values)]
    .filter((fit): fit is ParametricFit => fit != null && Number.isFinite(fit.aic))
  fits.sort((a, b) => {
    if (Math.abs(a.aic - b.aic) < 1) return PREFERENCE[a.method] - PREFERENCE[b.method]
    return a.aic - b.aic
  })
  return fits
}

export function bestParametricFit(values: number[]): ParametricFit {
  const ranked = rankParametricFits(values)
  if (ranked.length) return ranked[0]
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  return { method: "normal", mean, scale: 1.2, logLik: Number.NEGATIVE_INFINITY, aic: Number.POSITIVE_INFINITY }
}

export function resolveFitMethod(
  values: number[] | undefined,
  choice: Exclude<FitChoice, "frequency">,
): FitMethod {
  if (choice !== "auto") return choice
  if (!values || values.length < 8) return "normal"
  return bestParametricFit(values).method
}

function kdeBandwidth(values: number[]): number {
  const mom = moments(values)
  if (!mom) return 0.4
  return Math.max(1.06 * mom.sigma * Math.pow(mom.n, -0.2), 1e-4)
}

function normalPdf(x: number, mean: number, scale: number): number {
  if (!(scale > 0)) return 0
  const z = (x - mean) / scale
  return Math.exp(-0.5 * z * z) / (scale * Math.sqrt(2 * Math.PI))
}

function fitPdf(fit: ParametricFit, x: number): number {
  if (fit.method === "normal") return normalPdf(x, fit.mean, fit.scale)
  if (fit.method === "laplace") {
    if (!(fit.scale > 0)) return 0
    return Math.exp(-Math.abs(x - fit.mean) / fit.scale) / (2 * fit.scale)
  }
  if (fit.method === "logistic") {
    if (!(fit.scale > 0)) return 0
    const z = (x - fit.mean) / fit.scale
    const e = Math.exp(-z)
    return e / (fit.scale * (1 + e) * (1 + e))
  }
  const nu = fit.nu ?? 8
  if (!(fit.scale > 0) || !(nu > 0)) return 0
  const z = (x - fit.mean) / fit.scale
  const logC = logGamma((nu + 1) / 2) - 0.5 * Math.log(nu * Math.PI) - logGamma(nu / 2)
  return Math.exp(logC - ((nu + 1) / 2) * Math.log(1 + (z * z) / nu)) / fit.scale
}

function kdePdf(values: number[], bandwidth: number, x: number): number {
  const n = values.length
  if (!n || !(bandwidth > 0)) return 0
  const inv = 1 / (n * bandwidth * Math.sqrt(2 * Math.PI))
  const h2 = bandwidth * bandwidth
  let sum = 0
  for (const value of values) {
    const d = x - value
    sum += Math.exp(-0.5 * (d * d) / h2)
  }
  return sum * inv
}

export type FrequencyBin = {
  left: number
  right: number
  count: number
  pct: number
}

function niceBinWidth(span: number): number {
  const raw = span / 16
  if (!(raw > 0)) return 1
  const pow = 10 ** Math.floor(Math.log10(raw))
  for (const step of [1, 2, 2.5, 5, 10]) {
    const width = step * pow
    if (span / width <= 22) return width
  }
  return 10 * pow
}

/** Share of the sample in each bin. Values outside [xMin, xMax] stay in the denominator and are not drawn. */
export function frequencyHistogram(
  values: number[] | undefined,
  xMin: number,
  xMax: number,
): FrequencyBin[] {
  const sample = values ?? []
  const span = xMax - xMin
  if (!(span > 0)) return []
  const width = niceBinWidth(span)
  const start = Math.floor(xMin / width) * width
  const end = Math.ceil(xMax / width) * width
  const nBins = Math.max(1, Math.round((end - start) / width))
  const bins: FrequencyBin[] = Array.from({ length: nBins }, (_, index) => ({
    left: start + index * width,
    right: start + (index + 1) * width,
    count: 0,
    pct: 0,
  }))
  for (const value of sample) {
    if (value < start || value > end) continue
    let index = Math.floor((value - start) / width)
    if (index === nBins) index = nBins - 1
    if (index >= 0 && index < nBins) bins[index].count += 1
  }
  const n = sample.length
  for (const bin of bins) bin.pct = n ? (bin.count / n) * 100 : 0
  return bins
}

export function frequencyStepPoints(bins: FrequencyBin[]): [number, number][] {
  if (!bins.length) return []
  const points: [number, number][] = [[bins[0].left, 0]]
  for (const bin of bins) {
    points.push([bin.left, bin.pct], [bin.right, bin.pct])
  }
  points.push([bins[bins.length - 1].right, 0])
  return points
}

export function densityPoints(
  values: number[] | undefined,
  choice: Exclude<FitChoice, "frequency">,
  xMin: number,
  xMax: number,
  fallback: { mean: number; std: number } = { mean: 0, std: 1.2 },
  steps = 80,
): { method: FitMethod; points: [number, number][] } {
  const method = resolveFitMethod(values, choice)
  const sample = values ?? []
  const parametric = method === "kde" ? null : (sample.length >= 2 ? (
    method === "normal" ? normalFit(sample)
      : method === "laplace" ? laplaceFit(sample)
        : method === "logistic" ? logisticFit(sample)
          : studentTFit(sample)
  ) : null)
  const bandwidth = method === "kde" ? kdeBandwidth(sample) : 0
  const points: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const x = xMin + ((xMax - xMin) * i) / steps
    let density = 0
    if (method === "kde" && sample.length >= 2) density = kdePdf(sample, bandwidth, x)
    else if (parametric) density = fitPdf(parametric, x)
    else density = normalPdf(x, fallback.mean, fallback.std > 0 ? fallback.std : 1.2)
    points.push([x, density * 100])
  }
  return { method, points }
}
