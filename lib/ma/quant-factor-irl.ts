/**
 * One-step Maximum Entropy IRL for a trader's opening flow.
 *
 * Each product-day is a decision. The state is known at the previous close
 * (candidate factors, lagged net position, book risk). The action is the next
 * session's net open, or the number of lots opened. The market's next move is
 * not chosen by the trader, so there is no market simulator to roll out.
 * MaxEnt IRL (Ziebart 2008) with a quadratic action cost gives a Gaussian
 * policy around the preferred open μ(s). Adversarial IRL recovers the same
 * reward for this one-step decision.
 *
 * R is a quadratic cost of missing the preferred open: R(s, a) = −(a − μ(s))².
 * The MaxEnt policy is then Gaussian around μ(s). μ is nonlinear in the state
 * (random Fourier features on top of the raw factors). A factor is in the
 * recovered reward when shuffling it on held-out dates lowers the probability
 * of the observed opens. The coefficient is the average derivative of the
 * preferred open with respect to that factor. The five-bin curve is the
 * preferred open against the factor's own quintiles.
 */

export type IrlOutcome = "direction" | "intensity"

export type IrlShape = "linear" | "threshold_high" | "threshold_low" | "u" | "inv_u" | "uneven_up" | "uneven_down" | "nonmonotone"

export type IrlFactor = {
  id: string
  name: string
  outcome: IrlOutcome
  coef: number
  drop: number
  shape: IrlShape
  curve: number[]
  detail: string
}

export type IrlReport = {
  headline: string
  rewardGap: number
  factors: IrlFactor[]
}

const RFF = 12
const RIDGE = 0.08
const CAP = 1600
const DROP_MIN = 0.015
const SHUFFLES = 4

type FactorIn = { id: string; name: string; values: number[] }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng())
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function stride<T>(xs: T[], cap: number): T[] {
  if (xs.length <= cap) return xs
  const out: T[] = []
  const step = xs.length / cap
  for (let i = 0; i < cap; i++) out.push(xs[Math.floor(i * step)]!)
  return out
}

function solve(A: Float64Array[], b: Float64Array): Float64Array | null {
  const n = b.length
  const M = A.map((row, i) => {
    const r = new Float64Array(n + 1)
    r.set(row)
    r[n] = b[i]!
    return r
  })
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r
    const tmp = M[c]!
    M[c] = M[piv]!
    M[piv] = tmp
    const div = M[c]![c]!
    if (Math.abs(div) < 1e-8) return null
    for (let k = c; k <= n; k++) M[c]![k]! /= div
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r]![c]!
      if (f === 0) continue
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!
    }
  }
  return Float64Array.from(M, (r) => r[n]!)
}

function dot(w: Float64Array, x: number[]): number {
  let s = 0
  for (let i = 0; i < w.length; i++) s += w[i]! * x[i]!
  return s
}

type FoldFit = {
  test: number[]
  mean: number[]
  sd: number[]
  omega: number[][]
  w: Float64Array
  z: number[][]
  yTest: number[]
  sigma2: number
  yBar: number
}

function zOf(raw: number[][], idx: number[], mean: number[], sd: number[]): number[][] {
  return idx.map((i) => raw[i]!.map((v, j) => (Number.isFinite(v) ? (v - mean[j]!) / sd[j]! : 0)))
}

function phiOf(z: number[], omega: number[][]): number[] {
  const m = omega.length
  const phi = new Array<number>(1 + z.length + 2 * m)
  phi[0] = 1
  for (let j = 0; j < z.length; j++) phi[1 + j] = z[j]!
  for (let k = 0; k < m; k++) {
    let t = 0
    const om = omega[k]!
    for (let j = 0; j < z.length; j++) t += om[j]! * z[j]!
    phi[1 + z.length + k] = Math.cos(t)
    phi[1 + z.length + m + k] = Math.sin(t)
  }
  return phi
}

function meanGaussLl(y: number[], pred: number[], sigma2: number): number {
  const c = -0.5 * Math.log(2 * Math.PI * sigma2)
  let s = 0
  for (let i = 0; i < y.length; i++) {
    const e = y[i]! - pred[i]!
    s += c - (e * e) / (2 * sigma2)
  }
  return s / Math.max(1, y.length)
}

function fitMu(phis: number[][], y: number[]): Float64Array | null {
  const n = phis.length
  const p = phis[0]!.length
  const G = Array.from({ length: p }, () => new Float64Array(p))
  const b = new Float64Array(p)
  for (let i = 0; i < n; i++) {
    const phi = phis[i]!
    const yi = y[i]!
    for (let j = 0; j < p; j++) {
      b[j]! += phi[j]! * yi
      const pj = phi[j]!
      for (let k = 0; k < p; k++) G[j]![k]! += pj * phi[k]!
    }
  }
  const ridge = RIDGE * n
  for (let j = 0; j < p; j++) G[j]![j]! += ridge
  return solve(G, b)
}

function advantageGrad(z: number[], wHi: Float64Array, omega: number[][], j: number): number {
  const d = z.length
  const m = omega.length
  let g = wHi[1 + j]!
  for (let k = 0; k < m; k++) {
    let t = 0
    const om = omega[k]!
    for (let c = 0; c < d; c++) t += om[c]! * z[c]!
    const sin = Math.sin(t)
    const cos = Math.cos(t)
    g += (-sin * wHi[1 + d + k]! + cos * wHi[1 + d + m + k]!) * om[j]!
  }
  return g
}

function quintileMeans(x: number[], score: number[]): number[] {
  const order = x.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = [0, 0, 0, 0, 0]
  const n = order.length
  for (let b = 0; b < 5; b++) {
    const a = Math.floor(n * b / 5)
    const c = Math.floor(n * (b + 1) / 5)
    if (c <= a) continue
    let s = 0
    for (let i = a; i < c; i++) s += score[order[i]!.i]!
    out[b] = s / (c - a)
  }
  return out
}

export function classifyAdvantage(raw: number[]): IrlShape {
  const y = raw.map((v) => v - raw[0]!)
  const span = y[4]!
  let maxDev = 0
  for (let i = 1; i < 4; i++) maxDev = Math.max(maxDev, Math.abs(y[i]! - (span * i) / 4))
  const steps = [1, 2, 3, 4].map((i) => y[i]! - y[i - 1]!)
  const early = Math.max(...steps.slice(0, 3).map((v) => Math.abs(v)))
  if (steps[3]! > 0.1 && early <= Math.abs(steps[3]!) * 0.75 && y[4]! >= Math.max(...y) - 1e-9) return "threshold_high"
  if (steps[0]! < -0.1 && Math.max(...steps.slice(1).map((v) => Math.abs(v))) <= Math.abs(steps[0]!) * 0.75 && y[0]! >= Math.max(...y) - 1e-9) return "threshold_low"
  const mid = (y[1]! + y[2]! + y[3]!) / 3
  if (y[2]! < -0.12 && y[4]! > y[2]! + 0.12 && y[0]! > y[2]! + 0.08 && mid < -0.08) return "u"
  if (y[2]! > 0.12 && y[4]! < y[2]! - 0.12 && mid > 0.08) return "inv_u"
  if (maxDev < 0.06 || (Math.abs(span) > 0.2 && maxDev < Math.abs(span) * 0.08)) return "linear"
  if (span > 0.05) return "uneven_up"
  if (span < -0.05) return "uneven_down"
  return "nonmonotone"
}

export function shapeTitle(shape: IrlShape): string {
  switch (shape) {
    case "linear": return "接近线性"
    case "threshold_high": return "只在最高档才奖"
    case "threshold_low": return "离开最低档就奖"
    case "u": return "两头才奖"
    case "inv_u": return "中间才奖"
    case "uneven_up": return "单调但不均匀"
    case "uneven_down": return "单调向下但不均匀"
    default: return "非单调"
  }
}

function shuffleCol(z: number[][], j: number, rng: () => number): void {
  for (let i = z.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1))
    const tmp = z[i]![j]!
    z[i]![j] = z[k]![j]!
    z[k]![j] = tmp
  }
}

type Task = {
  outcome: IrlOutcome
  y: number[]
  factors: FactorIn[]
  extras: number[][]
  dates: string[]
}

function recoverOne(task: Task): { factors: IrlFactor[]; gap: number } {
  const n = task.dates.length
  const dFactor = task.factors.length
  const d = dFactor + task.extras.length
  const ys: number[] = []
  const raw: number[][] = []
  const kept: number[] = []
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(task.y[i])) continue
    const row = new Array<number>(d)
    for (let j = 0; j < dFactor; j++) row[j] = task.factors[j]!.values[i]!
    for (let j = 0; j < task.extras.length; j++) row[dFactor + j] = task.extras[j]![i]!
    raw.push(row)
    ys.push(task.y[i]!)
    kept.push(i)
  }
  if (kept.length < 80) return { factors: [], gap: 0 }
  const dates = kept.map((i) => task.dates[i]!)
  const uniq = [...new Set(dates)].sort()
  const foldOf = new Map(uniq.map((d, i) => [d, i % 2]))
  const folds = [0, 1].map((f) => {
    const idx = raw.map((_, i) => i).filter((i) => foldOf.get(dates[i]!) === f)
    return stride(idx, CAP)
  })

  const fits: FoldFit[] = []
  for (let f = 0; f < 2; f++) {
    const train = folds[1 - f]!
    const test = folds[f]!
    if (train.length < 40 || test.length < 30) continue
    const mean = new Array<number>(d).fill(0)
    const sd = new Array<number>(d).fill(1)
    const cnt = new Array<number>(d).fill(0)
    for (const i of train) {
      for (let j = 0; j < d; j++) {
        const v = raw[i]![j]!
        if (!Number.isFinite(v)) continue
        mean[j]! += v
        cnt[j]!++
      }
    }
    for (let j = 0; j < d; j++) mean[j] = cnt[j]! > 0 ? mean[j]! / cnt[j]! : 0
    const ss = new Array<number>(d).fill(0)
    for (const i of train) {
      for (let j = 0; j < d; j++) {
        const v = raw[i]![j]!
        if (!Number.isFinite(v)) continue
        ss[j]! += (v - mean[j]!) ** 2
      }
    }
    for (let j = 0; j < d; j++) {
      const s = Math.sqrt(ss[j]! / Math.max(1, cnt[j]! - 1))
      sd[j] = s > 1e-8 ? s : 1
    }
    const rng = mulberry32(1100 + f * 17 + (task.outcome === "intensity" ? 3 : 0))
    const scale = 1 / Math.sqrt(d)
    const omega = Array.from({ length: RFF }, () => Array.from({ length: d }, () => gauss(rng) * scale))
    const zTrain = zOf(raw, train, mean, sd)
    const phis = zTrain.map((z) => phiOf(z, omega))
    const yTrain = train.map((i) => ys[i]!)
    const w = fitMu(phis, yTrain)
    if (!w) continue
    let yBar = 0
    let sse = 0
    for (let i = 0; i < yTrain.length; i++) {
      yBar += yTrain[i]!
      const e = yTrain[i]! - dot(w, phis[i]!)
      sse += e * e
    }
    yBar /= yTrain.length
    const sigma2 = Math.max(1e-4, sse / yTrain.length)
    const zTest = zOf(raw, test, mean, sd)
    const yTest = test.map((i) => ys[i]!)
    fits.push({ test, mean, sd, omega, w, z: zTest, yTest, sigma2, yBar })
  }
  if (!fits.length) return { factors: [], gap: 0 }

  let gapSum = 0
  let gapW = 0
  for (const fit of fits) {
    const pred = fit.z.map((z) => dot(fit.w, phiOf(z, fit.omega)))
    const ll = meanGaussLl(fit.yTest, pred, fit.sigma2)
    const nullPred = fit.yTest.map(() => fit.yBar)
    gapSum += ll - meanGaussLl(fit.yTest, nullPred, fit.sigma2)
    gapW++
  }
  const gap = gapW ? gapSum / gapW : 0

  const factors: IrlFactor[] = []
  for (let j = 0; j < dFactor; j++) {
    let drop = 0
    let coef = 0
    const curves: number[][] = []
    let weight = 0
    for (const fit of fits) {
      const basePred = fit.z.map((z) => dot(fit.w, phiOf(z, fit.omega)))
      const base = meanGaussLl(fit.yTest, basePred, fit.sigma2)
      let dsum = 0
      for (let rep = 0; rep < SHUFFLES; rep++) {
        const zed = fit.z.map((row) => row.slice())
        shuffleCol(zed, j, mulberry32(5000 + j * 19 + rep * 13 + (task.outcome === "intensity" ? 4 : 0)))
        const pred = zed.map((z) => dot(fit.w, phiOf(z, fit.omega)))
        dsum += base - meanGaussLl(fit.yTest, pred, fit.sigma2)
      }
      drop += dsum / SHUFFLES
      let g = 0
      const adv: number[] = []
      const xRaw: number[] = []
      for (let t = 0; t < fit.z.length; t++) {
        const z = fit.z[t]!
        g += advantageGrad(z, fit.w, fit.omega, j)
        adv.push(basePred[t]!)
        const src = kept[fit.test[t]!]!
        const xv = task.factors[j]!.values[src]!
        xRaw.push(Number.isFinite(xv) ? xv : 0)
      }
      coef += g / fit.z.length
      curves.push(quintileMeans(xRaw, adv))
      weight++
    }
    if (!weight) continue
    drop /= weight
    coef /= weight
    const curve = [0, 1, 2, 3, 4].map((b) => curves.reduce((s, c) => s + c[b]!, 0) / curves.length)
    const shape = classifyAdvantage(curve)
    const rel = curve.map((v) => Math.round((v - curve[0]!) * 100) / 100)
    if (drop < DROP_MIN) continue
    factors.push({
      id: task.factors[j]!.id,
      name: task.factors[j]!.name,
      outcome: task.outcome,
      coef: Math.round(coef * 100) / 100,
      drop: Math.round(drop * 1000) / 1000,
      shape,
      curve: rel,
      detail: detailOf(task.outcome, task.factors[j]!.name, coef, drop, shape),
    })
  }
  factors.sort((a, b) => b.drop - a.drop)
  return { factors, gap }
}

function detailOf(outcome: IrlOutcome, name: string, coef: number, drop: number, shape: IrlShape): string {
  const mag = `${coef > 0 ? "+" : ""}${coef.toFixed(2)}`
  const use = outcome === "direction"
    ? (coef >= 0 ? `${name}越高，奖励最高的净开仓越偏多` : `${name}越高，奖励最高的净开仓越偏空`)
    : (coef >= 0 ? `${name}越高，奖励最高的开仓手数越多` : `${name}越高，奖励最高的开仓手数越少`)
  const bend = shape === "linear" ? "这份贡献接近一条直线。" : `五档上这份贡献是弯的（${shapeTitle(shape)}）。`
  return `${use}（局部斜率 ${mag}）。${bend}打乱该因子后，留出交易日上真实开仓的对数概率平均下降 ${drop.toFixed(3)}。`
}

export function emptyIrl(headline = "样本不够，没有恢复奖励函数。"): IrlReport {
  return { headline, rewardGap: 0, factors: [] }
}

export function recoverTraderReward(input: {
  dates: string[]
  yDir: number[]
  yInt: number[]
  factors: FactorIn[]
  position: number[]
  risk: number[]
}): IrlReport {
  const extras = [input.position, input.risk]
  const dir = recoverOne({ outcome: "direction", y: input.yDir, factors: input.factors, extras, dates: input.dates })
  const size = recoverOne({ outcome: "intensity", y: input.yInt, factors: input.factors, extras, dates: input.dates })
  const factors = [...dir.factors, ...size.factors]
  const rewardGap = Math.round(((dir.gap + size.gap) / 2) * 100) / 100
  return { headline: headlineOf(dir.factors, size.factors, dir.gap, size.gap), rewardGap, factors }
}

function headlineOf(dir: IrlFactor[], size: IrlFactor[], gapDir: number, gapSize: number): string {
  const piece = (xs: IrlFactor[], label: string) => {
    if (!xs.length) return `${label}的奖励里，没有因子在打乱之后还站得住`
    const bits = xs.slice(0, 3).map((f) => `${f.name}（${shapeTitle(f.shape)}）`)
    return `${label}的奖励用到 ${bits.join("、")}${xs.length > 3 ? `，另外 ${xs.length - 3} 个` : ""}`
  }
  const gap = `留出样本上，恢复出的奖励比随机开仓更偏向真实开仓（净开仓 ${gapDir >= 0 ? "+" : ""}${gapDir.toFixed(2)}，开仓手数 ${gapSize >= 0 ? "+" : ""}${gapSize.toFixed(2)}）`
  return `最大熵 IRL：${gap}。${piece(dir, "净开仓")}。${piece(size, "开仓手数")}。`
}
