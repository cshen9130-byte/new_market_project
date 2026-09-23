/**
 * Factor-by-factor Double Machine Learning for one trader.
 *
 * Two DML scores, same cross-fit and the same nonlinear nuisance for X:
 *   linear:     Y = θ F + g(X) + ε,  F = m(X) + V
 *   dose:       Y = ψ(F) + g(X) + ε,  ψ is five quantile bins of F, not a line
 * g and m are random Fourier features (RBF kernel ridge, GCV on the training
 * fold) plus depth-2 residual trees. K=2 cross-fitting by trading date.
 * Neyman scores, date-clustered SE. A Wald test asks whether the five bin
 * effects sit on a straight line. Confounders are book risk, weekday,
 * volatility, volume, index and sector momentum, carry and open interest.
 * Lagged position is left out: it is downstream of a persistent signal.
 *
 * Timing: factor and confounders are known at the previous close; Y is the
 * next session's opening flow. Directional factors use signed net opens.
 * Volatility and volume factors use opening size.
 *
 * Causal graph: DIVOT (optimal-transport direction) decides which factors
 * have a direct edge into direction or size. PC and additive-noise HSIC
 * are not used to accept an edge. See quant-factor-divot.ts.
 *
 * Reward: one-step MaxEnt IRL recovers R(s, a). A factor is used when
 * shuffling it on held-out dates lowers the probability of the observed
 * opens. See quant-factor-irl.ts.
 */

import { discoverCausalGraph, type CausalGraph } from "@/lib/ma/quant-factor-divot"
import { emptyIrl, recoverTraderReward, type IrlReport } from "@/lib/ma/quant-factor-irl"
import { auditFactors, emptyAudit, screenDependence, type FactorAudit } from "@/lib/ma/quant-factor-screen"

export type FactorOutcome = "direction" | "intensity"

export type FactorVerdict = "pos" | "neg" | "ns" | "small" | "weak" | "skip"

export type DoseShape = "linear" | "threshold_high" | "threshold_low" | "u" | "inv_u" | "steep_high" | "steep_low" | "uneven_up" | "uneven_down" | "nonmonotone"

export type DosePoint = {
  label: string
  x: number
  effect: number
  lo: number
  hi: number
}

export type FactorDmlRow = {
  id: string
  family: string
  name: string
  blurb: string
  outcome: FactorOutcome
  theta: number | null
  se: number | null
  t: number | null
  p: number | null
  q: number | null
  ciLow: number | null
  ciHigh: number | null
  n: number
  dates: number
  strength: number | null
  verdict: FactorVerdict
  shape: DoseShape | null
  nonlinearP: number | null
  nonlinearQ: number | null
  curve: DosePoint[] | null
  detail: string
}

export type FactorDmlReport = {
  headline: string
  n: number
  dates: number
  products: number
  tested: number
  significant: number
  nonlinear: number
  causal: CausalGraph
  irl: IrlReport
  audit: FactorAudit
  rows: FactorDmlRow[]
}

export type DmlOpen = { date: string; product: string; buyOpen: number; sellOpen: number }
export type DmlPos = { date: string; product: string; buyLots: number; sellLots: number }
export type DmlPx = { product: string; date: string; close: number; volume: number }
export type DmlNh = { date: string; close: number }
export type DmlBook = { date: string; riskPct: number }
export type DmlContract = { date: string; product: string; rk: number; px: number; oi: number; doi: number }

type FactorOp =
  | "mom" | "rev" | "lag" | "ma_gap" | "ma_spread" | "ema_gap" | "macd"
  | "er" | "donchian" | "rsi" | "bb" | "mad" | "dd" | "from_low" | "accel"
  | "skew" | "kurt" | "upfrac" | "maxret" | "minret"
  | "xsec" | "sector" | "rel" | "mkt"
  | "carry" | "carry_mom" | "oi_chg" | "oi_mom" | "oi_z" | "pv"
  | "vol" | "vol_dir" | "vol_ratio" | "volume_z" | "volume_z_dir" | "vol_surge" | "vol_surge_dir"
  | "amihud" | "vov" | "vol_chg"

type FactorSpec = {
  id: string
  family: string
  name: string
  blurb: string
  outcome: FactorOutcome
  op: FactorOp
  a: number
  b: number
}

function buildCatalog(): FactorSpec[] {
  const out: FactorSpec[] = []
  const add = (spec: FactorSpec) => {
    out.push(spec)
  }
  const dir = (id: string, family: string, name: string, blurb: string, op: FactorOp, a = 0, b = 0) =>
    add({ id, family, name, blurb, outcome: "direction", op, a, b })
  const inten = (id: string, family: string, name: string, blurb: string, op: FactorOp, a = 0, b = 0) =>
    add({ id, family, name, blurb, outcome: "intensity", op, a, b })

  const MOM = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 40, 60, 90, 120, 180, 240]
  for (const n of MOM) {
    dir(`mom_${n}`, "动量", `${n}日动量`, `过去 ${n} 个交易日收益率`, "mom", n)
    dir(`rev_${n}`, "反转", `${n}日反转`, `过去 ${n} 日收益率取负，因子高=这段下跌`, "rev", n)
  }
  for (const n of [2, 3, 5, 10]) {
    dir(`lag_${n}`, "动量", `${n}日前收益`, `信号日往前第 ${n} 个交易日当天的收益率`, "lag", n)
  }
  for (const n of [5, 8, 10, 13, 20, 30, 40, 60, 90, 120, 180]) {
    dir(`magap_${n}`, "趋势", `偏离MA${n}`, `收盘 / ${n} 日均线 − 1`, "ma_gap", n)
  }
  for (const [a, b] of [[5, 10], [5, 20], [5, 60], [10, 20], [10, 40], [10, 60], [20, 40], [20, 60], [20, 120], [40, 120], [60, 120], [60, 180], [10, 120], [30, 90], [40, 180]] as const) {
    dir(`maspread_${a}_${b}`, "趋势", `MA${a}/MA${b}`, `(MA${a}−MA${b})/价格，短均线在上方为正`, "ma_spread", a, b)
  }
  for (const n of [5, 8, 10, 12, 20, 26, 30, 40, 60, 90, 120]) {
    dir(`emagap_${n}`, "趋势", `偏离EMA${n}`, `收盘 / EMA${n} − 1`, "ema_gap", n)
  }
  for (const [a, b] of [[5, 10], [5, 20], [8, 17], [10, 20], [10, 40], [12, 26], [20, 40], [20, 60], [40, 80], [60, 120]] as const) {
    dir(`macd_${a}_${b}`, "趋势", `MACD${a}-${b}`, `(EMA${a}−EMA${b})/价格`, "macd", a, b)
  }
  for (const n of [5, 10, 20, 40, 60, 120]) {
    dir(`er_${n}`, "趋势", `${n}日趋势效率`, `这段净涨跌 / 路径长度，带方向，越接近 ±1 越单边`, "er", n)
  }
  for (const n of [5, 10, 20, 40, 55, 60, 90, 120, 180]) {
    dir(`don_${n}`, "突破", `${n}日通道位置`, `收盘在近 ${n} 日收盘高低间的位置，上沿接近 +1`, "donchian", n)
  }
  for (const n of [5, 7, 9, 14, 21, 28, 42]) {
    dir(`rsi_${n}`, "反转", `RSI${n}`, `(RSI${n}−50)/50，超买为正、超卖为负`, "rsi", n)
  }
  for (const n of [10, 20, 30, 40, 60, 90]) {
    dir(`bb_${n}`, "反转", `布林${n}`, `(收盘−MA${n}) / ${n} 日波动`, "bb", n)
    dir(`mad_${n}`, "反转", `偏离MAD${n}`, `(收盘−MA${n}) / ${n} 日绝对偏差`, "mad", n)
  }
  for (const n of [10, 20, 40, 60, 90, 120, 180]) {
    dir(`dd_${n}`, "突破", `距${n}日高点`, `收盘/近 ${n} 日最高 − 1，贴近高点接近 0`, "dd", n)
    dir(`low_${n}`, "突破", `距${n}日低点`, `收盘/近 ${n} 日最低 − 1，刚离低点接近 0`, "from_low", n)
  }
  for (const [a, b] of [[5, 20], [5, 60], [10, 40], [10, 60], [20, 60], [20, 120], [40, 120], [60, 120], [60, 240], [5, 10], [20, 40], [30, 90]] as const) {
    dir(`accel_${a}_${b}`, "动量", `动量加速${a}-${b}`, `${a} 日收益率减 ${b} 日收益率，趋势在加快为正`, "accel", a, b)
  }
  for (const n of [10, 20, 40, 60, 120]) {
    dir(`skew_${n}`, "波动", `${n}日偏度`, `过去 ${n} 日收益率的偏度，右尾厚为正`, "skew", n)
  }
  for (const n of [20, 40, 60, 120]) {
    dir(`kurt_${n}`, "波动", `${n}日峰度`, `过去 ${n} 日收益率的超额峰度，尾部越厚越大`, "kurt", n)
  }
  for (const n of [5, 10, 20, 40, 60, 120]) {
    dir(`up_${n}`, "动量", `${n}日上涨占比`, `过去 ${n} 日里收涨天数的占比减 0.5`, "upfrac", n)
  }
  for (const n of [10, 20, 60]) {
    dir(`maxret_${n}`, "波动", `${n}日最大日涨幅`, `过去 ${n} 日里单日收益率的最大值`, "maxret", n)
    dir(`minret_${n}`, "波动", `${n}日最大日跌幅`, `过去 ${n} 日里单日收益率的最小值`, "minret", n)
  }
  for (const n of [5, 10, 20, 40, 60, 120]) {
    dir(`xsec_${n}`, "截面", `截面动量${n}`, `该品种 ${n} 日收益在当日截面上的 z 分数`, "xsec", n)
    dir(`sector_${n}`, "截面", `板块动量${n}`, `同板块其他品种 ${n} 日收益的均值`, "sector", n)
    dir(`rel_${n}`, "截面", `相对板块${n}`, `该品种 ${n} 日收益减去同板块其他品种`, "rel", n)
    dir(`mkt_${n}`, "市场", `南华${n}日动量`, `南华商品指数过去 ${n} 日收益率`, "mkt", n)
  }
  dir("carry", "期限", "近远月升贴水", "远月/近月 − 1，升水为正", "carry")
  for (const n of [5, 10, 20, 40, 60]) {
    dir(`carrymom_${n}`, "期限", `升贴水变化${n}`, `近远月升贴水相对 ${n} 日前的变化`, "carry_mom", n)
  }
  dir("oichg", "资金", "主力持仓变化", "主力合约持仓量日变化 / 持仓量", "oi_chg")
  for (const n of [5, 10, 20, 40, 60]) {
    dir(`oimom_${n}`, "资金", `持仓动量${n}`, `主力持仓量相对 ${n} 日前 − 1`, "oi_mom", n)
  }
  for (const n of [10, 20, 40, 60, 120]) {
    dir(`oiz_${n}`, "资金", `持仓拥挤${n}`, `主力持仓量相对自身近 ${n} 日的 z 分数`, "oi_z", n)
  }
  for (const n of [10, 20, 40, 60]) {
    dir(`pv_${n}`, "流动性", `量价相关${n}`, `过去 ${n} 日收益率和成交量的相关系数`, "pv", n)
  }
  for (const n of [5, 10, 20, 30, 40, 60, 90, 120, 180]) {
    inten(`vol_${n}`, "波动", `${n}日波动`, `过去 ${n} 日收益率标准差，看开仓手数`, "vol", n)
    dir(`voldir_${n}`, "波动", `${n}日波动看方向`, `过去 ${n} 日收益率标准差，看净开仓方向`, "vol_dir", n)
  }
  for (const [a, b] of [[5, 20], [5, 60], [10, 40], [10, 60], [20, 60], [20, 120], [40, 120], [60, 180], [10, 20], [20, 40]] as const) {
    inten(`volratio_${a}_${b}`, "波动", `波动比${a}/${b}`, `${a} 日波动 / ${b} 日波动，短波动抬升时变大`, "vol_ratio", a, b)
  }
  for (const n of [5, 10, 20, 40, 60, 120]) {
    inten(`volumez_${n}`, "流动性", `成交量异常${n}`, `成交量相对自身近 ${n} 日的 z 分数`, "volume_z", n)
  }
  for (const n of [10, 20, 60]) {
    dir(`volumezdir_${n}`, "流动性", `放量看方向${n}`, `成交量 z 分数，看净开仓方向`, "volume_z_dir", n)
  }
  for (const [a, b] of [[5, 20], [5, 60], [10, 40], [10, 60], [20, 60], [20, 120], [5, 10]] as const) {
    inten(`surge_${a}_${b}`, "流动性", `量能比${a}/${b}`, `近 ${a} 日均量 / 近 ${b} 日均量 − 1`, "vol_surge", a, b)
  }
  for (const [a, b] of [[5, 20], [10, 60]] as const) {
    dir(`surgedir_${a}_${b}`, "流动性", `放量比看方向${a}/${b}`, `近 ${a} 日均量 / 近 ${b} 日均量 − 1，看净开仓方向`, "vol_surge_dir", a, b)
  }
  for (const n of [5, 10, 20, 40, 60, 120]) {
    inten(`amihud_${n}`, "流动性", `非流动性${n}`, `过去 ${n} 日 |收益率|/成交量 的均值`, "amihud", n)
  }
  for (const n of [20, 40, 60, 120]) {
    inten(`vov_${n}`, "波动", `波动的波动${n}`, `5 日波动在过去 ${n} 日里的标准差`, "vov", n)
  }
  for (const n of [5, 10, 20, 60]) {
    inten(`volchg_${n}`, "流动性", `成交量变化${n}`, `今日成交量 / ${n} 日前 − 1`, "vol_chg", n)
  }
  return out
}

const FACTORS: FactorSpec[] = buildCatalog()
const F_INDEX = new Map(FACTORS.map((f, i) => [f.id, i]))
const N_F = FACTORS.length
const N_STATE = 4
const ENV_IDS = ["vol_20", "volratio_20_60", "volumez_20", "surge_5_20", "amihud_20", "skew_20", "mkt_20", "carry", "oichg", "oiz_20", "sector_20"]
const EMA_SPANS = [...new Set(FACTORS.flatMap((f) => (f.op === "ema_gap" ? [f.a] : f.op === "macd" ? [f.a, f.b] : [])))]
const MKT_NS = [...new Set(FACTORS.filter((f) => f.op === "mkt").map((f) => f.a))]
const XSEC_NS = [...new Set(FACTORS.filter((f) => f.op === "xsec").map((f) => f.a))]

const MIN_N = 80
const MIN_DATES = 24
const MIN_STRENGTH = 0.12
const P_CUT = 0.05
const Q_CUT = 0.1
const MIN_ABS = 0.03
const RFF = 36
const FOLDS = 2

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

function gaussian(rng: () => number): number {
  const u = Math.max(1e-12, rng())
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax)
  return sign * y
}

function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

function twoSidedP(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(1, Math.max(0, 2 * (1 - normCdf(Math.abs(z)))))
}

function bhQ(ps: number[]): number[] {
  const n = ps.length
  const q = Array(n).fill(1)
  if (!n) return q
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  let running = 1
  for (let k = n; k >= 1; k--) {
    running = Math.min(running, (order[k - 1]!.p * n) / k)
    q[order[k - 1]!.i] = running
  }
  return q
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  let m = 0
  for (const v of xs) m += v
  m /= xs.length
  let s = 0
  for (const v of xs) s += (v - m) ** 2
  return Math.sqrt(s / (xs.length - 1))
}

function sma(xs: Float64Array, i: number, n: number): number | null {
  if (i + 1 < n) return null
  let s = 0
  for (let j = i - n + 1; j <= i; j++) s += xs[j]!
  return s / n
}

function rsi14(xs: Float64Array, i: number): number | null {
  if (i < 14) return null
  let up = 0
  let dn = 0
  for (let j = i - 13; j <= i; j++) {
    const d = xs[j]! - xs[j - 1]!
    if (d > 0) up += d
    else dn -= d
  }
  const ad = dn / 14
  if (ad < 1e-12) return 100
  return 100 - 100 / (1 + up / 14 / ad)
}

function retN(xs: Float64Array, i: number, n: number): number | null {
  if (i < n) return null
  const prev = xs[i - n]!
  if (prev <= 0) return null
  return xs[i]! / prev - 1
}

function rollStd(rets: Float64Array, i: number, n: number): number | null {
  if (i < n) return null
  let m = 0
  for (let j = i - n + 1; j <= i; j++) m += rets[j]!
  m /= n
  let s = 0
  for (let j = i - n + 1; j <= i; j++) s += (rets[j]! - m) ** 2
  if (n < 2) return null
  return Math.sqrt(s / (n - 1))
}

function donchian(xs: Float64Array, i: number, n: number): number | null {
  if (i + 1 < n) return null
  let hi = -Infinity
  let lo = Infinity
  for (let j = i - n + 1; j <= i; j++) {
    const v = xs[j]!
    if (v > hi) hi = v
    if (v < lo) lo = v
  }
  const span = hi - lo
  if (span < 1e-12) return 0
  return ((xs[i]! - lo) / span) * 2 - 1
}

function efficiency(xs: Float64Array, i: number, n: number): number | null {
  if (i < n) return null
  const net = xs[i]! - xs[i - n]!
  let path = 0
  for (let j = i - n + 1; j <= i; j++) path += Math.abs(xs[j]! - xs[j - 1]!)
  if (path < 1e-12) return 0
  return net / path
}

function emaSeries(xs: Float64Array, span: number): Float64Array {
  const out = new Float64Array(xs.length)
  const a = 2 / (span + 1)
  out[0] = xs[0] ?? 0
  for (let i = 1; i < xs.length; i++) out[i] = a * xs[i]! + (1 - a) * out[i - 1]!
  return out
}

function drawdown(xs: Float64Array, i: number, n: number): number | null {
  if (i + 1 < n || xs[i]! <= 0) return null
  let hi = -Infinity
  for (let j = i - n + 1; j <= i; j++) if (xs[j]! > hi) hi = xs[j]!
  if (hi <= 0) return null
  return xs[i]! / hi - 1
}

function rollSkew(rets: Float64Array, i: number, n: number): number | null {
  if (i < n) return null
  let m = 0
  for (let j = i - n + 1; j <= i; j++) m += rets[j]!
  m /= n
  let m2 = 0
  let m3 = 0
  for (let j = i - n + 1; j <= i; j++) {
    const d = rets[j]! - m
    m2 += d * d
    m3 += d * d * d
  }
  m2 /= n
  m3 /= n
  if (m2 < 1e-16) return 0
  return m3 / (m2 ** 1.5)
}

function amihud(rets: Float64Array, vols: Float64Array, i: number, n: number): number | null {
  if (i < n) return null
  let s = 0
  let c = 0
  for (let j = i - n + 1; j <= i; j++) {
    if (vols[j]! <= 0) continue
    s += Math.abs(rets[j]!) / vols[j]!
    c++
  }
  if (c < n * 0.6) return null
  return s / c
}

function zScoreWindow(xs: Float64Array, i: number, n: number): number | null {
  if (i + 1 < n || !Number.isFinite(xs[i])) return null
  let m = 0
  let c = 0
  for (let j = i - n + 1; j <= i; j++) {
    if (!Number.isFinite(xs[j])) continue
    m += xs[j]!
    c++
  }
  if (c < n * 0.6) return null
  m /= c
  let v = 0
  for (let j = i - n + 1; j <= i; j++) {
    if (!Number.isFinite(xs[j])) continue
    v += (xs[j]! - m) ** 2
  }
  const sd = Math.sqrt(v / Math.max(1, c - 1))
  if (sd < 1e-12) return 0
  return (xs[i]! - m) / sd
}

type PxMath = {
  closes: Float64Array
  rets: Float64Array
  vols: Float64Array
  len: number
  psRet: Float64Array
  psRet2: Float64Array
  psRet3: Float64Array
  psRet4: Float64Array
  psAbsRet: Float64Array
  psUp: Float64Array
  psVol: Float64Array
  psVol2: Float64Array
  psRv: Float64Array
  psAbsDx: Float64Array
  psPos: Float64Array
  psNeg: Float64Array
  emas: Map<number, Float64Array>
  vol5: Float64Array
  psV5: Float64Array
  psV52: Float64Array
  hi: Float64Array[]
  lo: Float64Array[]
}

function prefixOf(xs: Float64Array): Float64Array {
  const p = new Float64Array(xs.length + 1)
  for (let i = 0; i < xs.length; i++) p[i + 1] = p[i]! + xs[i]!
  return p
}

function winSum(ps: Float64Array, i: number, n: number): number {
  return ps[i + 1]! - ps[(i + 1) - n]!
}

function sampleStd(sum: number, sum2: number, n: number): number | null {
  if (n < 2) return null
  const v = sum2 - (sum * sum) / n
  if (v <= 1e-18) return 0
  return Math.sqrt(v / (n - 1))
}

function sparseRange(xs: Float64Array): { hi: Float64Array[]; lo: Float64Array[] } {
  const n = xs.length
  const kMax = Math.floor(Math.log2(Math.max(1, n))) + 1
  const hi = Array.from({ length: kMax }, () => new Float64Array(n))
  const lo = Array.from({ length: kMax }, () => new Float64Array(n))
  hi[0]!.set(xs)
  lo[0]!.set(xs)
  for (let k = 1; k < kMax; k++) {
    const span = 1 << (k - 1)
    const width = 1 << k
    for (let i = 0; i + width <= n; i++) {
      hi[k]![i] = Math.max(hi[k - 1]![i]!, hi[k - 1]![i + span]!)
      lo[k]![i] = Math.min(lo[k - 1]![i]!, lo[k - 1]![i + span]!)
    }
  }
  return { hi, lo }
}

function rangeAt(px: PxMath, i: number, n: number): { hi: number; lo: number } | null {
  if (i + 1 < n || n < 1) return null
  const k = Math.floor(Math.log2(n))
  const a = i - n + 1
  const b = i - (1 << k) + 1
  return {
    hi: Math.max(px.hi[k]![a]!, px.hi[k]![b]!),
    lo: Math.min(px.lo[k]![a]!, px.lo[k]![b]!),
  }
}

function buildPx(closes: Float64Array, vols: Float64Array, rets: Float64Array): PxMath {
  const len = closes.length
  const ret2 = new Float64Array(len)
  const ret3 = new Float64Array(len)
  const ret4 = new Float64Array(len)
  const absRet = new Float64Array(len)
  const up = new Float64Array(len)
  const vol2 = new Float64Array(len)
  const rv = new Float64Array(len)
  for (let i = 0; i < len; i++) {
    const r = rets[i]!
    ret2[i] = r * r
    ret3[i] = ret2[i]! * r
    ret4[i] = ret2[i]! * ret2[i]!
    absRet[i] = Math.abs(r)
    up[i] = r > 0 ? 1 : 0
    vol2[i] = vols[i]! * vols[i]!
    rv[i] = r * vols[i]!
  }
  const psAbsDx = new Float64Array(len + 1)
  const psPos = new Float64Array(len + 1)
  const psNeg = new Float64Array(len + 1)
  for (let i = 1; i < len; i++) {
    const d = closes[i]! - closes[i - 1]!
    psAbsDx[i + 1] = psAbsDx[i]! + Math.abs(d)
    psPos[i + 1] = psPos[i]! + (d > 0 ? d : 0)
    psNeg[i + 1] = psNeg[i]! + (d < 0 ? -d : 0)
  }
  const emas = new Map<number, Float64Array>()
  for (const span of EMA_SPANS) emas.set(span, emaSeries(closes, span))
  const vol5 = new Float64Array(len)
  vol5.fill(Number.NaN)
  const psRet = prefixOf(rets)
  const psRet2 = prefixOf(ret2)
  for (let i = 4; i < len; i++) {
    const sd = sampleStd(winSum(psRet, i, 5), winSum(psRet2, i, 5), 5)
    if (sd != null) vol5[i] = sd
  }
  const v5 = new Float64Array(len)
  const v52 = new Float64Array(len)
  for (let i = 0; i < len; i++) {
    const v = Number.isFinite(vol5[i]!) ? vol5[i]! : 0
    v5[i] = v
    v52[i] = v * v
  }
  const range = sparseRange(closes)
  return {
    closes, rets, vols, len,
    psRet, psRet2, psRet3: prefixOf(ret3), psRet4: prefixOf(ret4),
    psAbsRet: prefixOf(absRet), psUp: prefixOf(up),
    psVol: prefixOf(vols), psVol2: prefixOf(vol2), psRv: prefixOf(rv),
    psAbsDx, psPos, psNeg, emas, vol5,
    psV5: prefixOf(v5), psV52: prefixOf(v52),
    hi: range.hi, lo: range.lo,
  }
}

function evalFactor(spec: FactorSpec, i: number, px: PxMath, carryAt: Float64Array, oiAt: Float64Array): number | null {
  const n = spec.a
  const ready = (k: number) => i + 1 >= k && k > 0
  switch (spec.op) {
    case "mom":
      return retN(px.closes, i, n)
    case "rev": {
      const r = retN(px.closes, i, n)
      return r == null ? null : -r
    }
    case "lag": {
      if (i < n || n < 1) return null
      return px.rets[i - n] ?? null
    }
    case "ma_gap": {
      if (!ready(n) || px.closes[i]! <= 0) return null
      const m = winSum(prefixOfHold(px.closes), i, n) / n
      return m > 0 ? px.closes[i]! / m - 1 : null
    }
    case "ma_spread": {
      if (!ready(spec.b) || px.closes[i]! <= 0) return null
      const a = winSum(prefixOfHold(px.closes), i, spec.a) / spec.a
      const b = winSum(prefixOfHold(px.closes), i, spec.b) / spec.b
      return (a - b) / px.closes[i]!
    }
    case "ema_gap": {
      const ema = px.emas.get(n)
      if (!ema || i < n || ema[i]! <= 0 || px.closes[i]! <= 0) return null
      return px.closes[i]! / ema[i]! - 1
    }
    case "macd": {
      const fast = px.emas.get(spec.a)
      const slow = px.emas.get(spec.b)
      if (!fast || !slow || i < spec.b || px.closes[i]! <= 0) return null
      return (fast[i]! - slow[i]!) / px.closes[i]!
    }
    case "er": {
      if (i < n) return null
      const path = winSum(px.psAbsDx, i, n)
      if (path < 1e-12) return 0
      return (px.closes[i]! - px.closes[i - n]!) / path
    }
    case "donchian": {
      const rg = rangeAt(px, i, n)
      if (!rg) return null
      const span = rg.hi - rg.lo
      if (span < 1e-12) return 0
      return ((px.closes[i]! - rg.lo) / span) * 2 - 1
    }
    case "rsi": {
      if (i < n) return null
      const up = winSum(px.psPos, i, n)
      const dn = winSum(px.psNeg, i, n)
      if (dn < 1e-12) return 1
      const rsi = 100 - 100 / (1 + up / dn)
      return (rsi - 50) / 50
    }
    case "bb": {
      if (!ready(n)) return null
      const sum = winSum(px.psRet, i, n)
      const sd = sampleStd(sum, winSum(px.psRet2, i, n), n)
      const m = winSum(prefixOfHold(px.closes), i, n) / n
      if (sd == null || sd < 1e-8 || m <= 0) return null
      return (px.closes[i]! / m - 1) / sd
    }
    case "mad": {
      if (!ready(n) || px.closes[i]! <= 0) return null
      const m = winSum(prefixOfHold(px.closes), i, n) / n
      if (m <= 0) return null
      let mad = 0
      for (let j = i - n + 1; j <= i; j++) mad += Math.abs(px.closes[j]! - m)
      mad /= n
      if (mad < 1e-12) return 0
      return (px.closes[i]! - m) / mad
    }
    case "dd": {
      const rg = rangeAt(px, i, n)
      if (!rg || rg.hi <= 0 || px.closes[i]! <= 0) return null
      return px.closes[i]! / rg.hi - 1
    }
    case "from_low": {
      const rg = rangeAt(px, i, n)
      if (!rg || rg.lo <= 0 || px.closes[i]! <= 0) return null
      return px.closes[i]! / rg.lo - 1
    }
    case "accel": {
      const a = retN(px.closes, i, spec.a)
      const b = retN(px.closes, i, spec.b)
      if (a == null || b == null) return null
      return a - b
    }
    case "skew": {
      if (!ready(n)) return null
      const sum = winSum(px.psRet, i, n)
      const sum2 = winSum(px.psRet2, i, n)
      const sum3 = winSum(px.psRet3, i, n)
      const m = sum / n
      const m2 = sum2 / n - m * m
      const m3 = sum3 / n - 3 * m * (sum2 / n) + 2 * m * m * m
      if (m2 < 1e-16) return 0
      return m3 / (m2 ** 1.5)
    }
    case "kurt": {
      if (!ready(n)) return null
      const sum = winSum(px.psRet, i, n)
      const sum2 = winSum(px.psRet2, i, n)
      const sum3 = winSum(px.psRet3, i, n)
      const sum4 = winSum(px.psRet4, i, n)
      const m = sum / n
      const ex2 = sum2 / n
      const m2 = ex2 - m * m
      const m4 = sum4 / n - 4 * m * (sum3 / n) + 6 * m * m * ex2 - 3 * m ** 4
      if (m2 < 1e-16) return 0
      return m4 / (m2 * m2) - 3
    }
    case "upfrac":
      return ready(n) ? winSum(px.psUp, i, n) / n - 0.5 : null
    case "maxret":
    case "minret": {
      if (!ready(n)) return null
      let v = spec.op === "maxret" ? -Infinity : Infinity
      for (let j = i - n + 1; j <= i; j++) {
        const r = px.rets[j]!
        if (spec.op === "maxret") { if (r > v) v = r }
        else if (r < v) v = r
      }
      return Number.isFinite(v) ? v : null
    }
    case "pv": {
      if (!ready(n)) return null
      const sr = winSum(px.psRet, i, n)
      const sv = winSum(px.psVol, i, n)
      const sr2 = winSum(px.psRet2, i, n)
      const sv2 = winSum(px.psVol2, i, n)
      const srv = winSum(px.psRv, i, n)
      const num = srv - (sr * sv) / n
      const dx = sr2 - (sr * sr) / n
      const dy = sv2 - (sv * sv) / n
      if (dx < 1e-18 || dy < 1e-18) return 0
      return num / Math.sqrt(dx * dy)
    }
    case "vol":
    case "vol_dir": {
      if (!ready(n)) return null
      return sampleStd(winSum(px.psRet, i, n), winSum(px.psRet2, i, n), n)
    }
    case "vol_ratio": {
      if (!ready(spec.b)) return null
      const a = sampleStd(winSum(px.psRet, i, spec.a), winSum(px.psRet2, i, spec.a), spec.a)
      const b = sampleStd(winSum(px.psRet, i, spec.b), winSum(px.psRet2, i, spec.b), spec.b)
      if (a == null || b == null || b < 1e-8) return null
      return a / b
    }
    case "volume_z":
    case "volume_z_dir": {
      if (!ready(n)) return null
      const m = winSum(px.psVol, i, n) / n
      const sd = sampleStd(winSum(px.psVol, i, n), winSum(px.psVol2, i, n), n)
      if (sd == null || sd < 1e-8) return null
      return (px.vols[i]! - m) / sd
    }
    case "vol_surge":
    case "vol_surge_dir": {
      if (!ready(spec.b)) return null
      const a = winSum(px.psVol, i, spec.a) / spec.a
      const b = winSum(px.psVol, i, spec.b) / spec.b
      if (b <= 0) return null
      return a / b - 1
    }
    case "amihud":
      return amihud(px.rets, px.vols, i, n)
    case "vov": {
      if (i < n + 4) return null
      let m = 0
      let c = 0
      for (let j = i - n + 1; j <= i; j++) {
        if (!Number.isFinite(px.vol5[j]!)) continue
        m += px.vol5[j]!
        c++
      }
      if (c < n * 0.8) return null
      m /= c
      let v = 0
      for (let j = i - n + 1; j <= i; j++) {
        if (!Number.isFinite(px.vol5[j]!)) continue
        v += (px.vol5[j]! - m) ** 2
      }
      return Math.sqrt(v / Math.max(1, c - 1))
    }
    case "vol_chg": {
      if (i < n || px.vols[i - n]! <= 0) return null
      return px.vols[i]! / px.vols[i - n]! - 1
    }
    case "carry":
      return Number.isFinite(carryAt[i]!) ? carryAt[i]! : null
    case "carry_mom": {
      if (i < n || !Number.isFinite(carryAt[i]!) || !Number.isFinite(carryAt[i - n]!)) return null
      return carryAt[i]! - carryAt[i - n]!
    }
    case "oi_chg":
      return null
    case "oi_mom": {
      if (i < n || !(oiAt[i]! > 0) || !(oiAt[i - n]! > 0)) return null
      return oiAt[i]! / oiAt[i - n]! - 1
    }
    case "oi_z":
      return zScoreWindow(oiAt, i, n)
    default:
      return null
  }
}

const closePrefix = new WeakMap<Float64Array, Float64Array>()
function prefixOfHold(xs: Float64Array): Float64Array {
  let p = closePrefix.get(xs)
  if (!p) {
    p = prefixOf(xs)
    closePrefix.set(xs, p)
  }
  return p
}

type TreeNode = { feat: number; thr: number; left: TreeNode | null; right: TreeNode | null; value: number }

function evalTree(node: TreeNode, xs: Float64Array, p: number, row: number): number {
  let cur = node
  while (cur.feat >= 0 && cur.left && cur.right) {
    cur = xs[row * p + cur.feat]! <= cur.thr ? cur.left : cur.right
  }
  return cur.value
}

function buildTree(
  xs: Float64Array,
  p: number,
  rz: Float64Array,
  idx: Int32Array,
  nIdx: number,
  rng: () => number,
  depth: number,
): TreeNode {
  let sum = 0
  for (let i = 0; i < nIdx; i++) sum += rz[idx[i]!]!
  const value = nIdx ? sum / nIdx : 0
  if (depth >= 2 || nIdx < 80) return { feat: -1, thr: 0, left: null, right: null, value }
  let bestGain = 0
  let bestFeat = -1
  let bestThr = 0
  const featPick = new Int32Array(Math.min(6, p))
  const used = new Set<number>()
  for (let k = 0; k < featPick.length; k++) {
    let f = Math.floor(rng() * p)
    let guard = 0
    while (used.has(f) && guard < 8) {
      f = Math.floor(rng() * p)
      guard++
    }
    used.add(f)
    featPick[k] = f
  }
  for (let fi = 0; fi < featPick.length; fi++) {
    const feat = featPick[fi]!
    const thrs: number[] = []
    for (let t = 0; t < 3; t++) {
      const i1 = idx[Math.floor(rng() * nIdx)]!
      const i2 = idx[Math.floor(rng() * nIdx)]!
      thrs.push((xs[i1 * p + feat]! + xs[i2 * p + feat]!) / 2)
    }
    for (const thr of thrs) {
      let sumL = 0
      let sumR = 0
      let nL = 0
      let nR = 0
      for (let i = 0; i < nIdx; i++) {
        if (xs[idx[i]! * p + feat]! <= thr) {
          sumL += rz[idx[i]!]!
          nL++
        } else {
          sumR += rz[idx[i]!]!
          nR++
        }
      }
      if (nL < 30 || nR < 30) continue
      const gain = (sumL * sumL) / nL + (sumR * sumR) / nR
      if (gain > bestGain) {
        bestGain = gain
        bestFeat = feat
        bestThr = thr
      }
    }
  }
  if (bestFeat < 0) return { feat: -1, thr: 0, left: null, right: null, value }
  const leftIdx = new Int32Array(nIdx)
  const rightIdx = new Int32Array(nIdx)
  let nl = 0
  let nr = 0
  for (let i = 0; i < nIdx; i++) {
    const row = idx[i]!
    if (xs[row * p + bestFeat]! <= bestThr) leftIdx[nl++] = row
    else rightIdx[nr++] = row
  }
  return {
    feat: bestFeat,
    thr: bestThr,
    value,
    left: buildTree(xs, p, rz, leftIdx, nl, rng, depth + 1),
    right: buildTree(xs, p, rz, rightIdx, nr, rng, depth + 1),
  }
}

function jacobiEigen(aIn: Float64Array, n: number): { s: Float64Array; q: Float64Array } {
  const a = aIn.slice()
  const q = new Float64Array(n * n)
  for (let i = 0; i < n; i++) q[i * n + i] = 1
  if (n <= 1) {
    const s = new Float64Array(n)
    if (n === 1) s[0] = a[0]!
    return { s, q }
  }
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) {
      const row = p * n
      for (let j = p + 1; j < n; j++) off += a[row + j]! ** 2
    }
    if (off < 1e-14) break
    for (let p = 0; p < n - 1; p++) {
      for (let j = p + 1; j < n; j++) {
        const apq = a[p * n + j]!
        if (Math.abs(apq) < 1e-15) continue
        const app = a[p * n + p]!
        const ajj = a[j * n + j]!
        const tau = (ajj - app) / (2 * apq)
        const tt = Math.sign(tau) || 1
        const t = tt / (Math.abs(tau) + Math.sqrt(1 + tau * tau))
        const c = 1 / Math.sqrt(1 + t * t)
        const s = t * c
        a[p * n + p] = app - t * apq
        a[j * n + j] = ajj + t * apq
        a[p * n + j] = 0
        a[j * n + p] = 0
        for (let k = 0; k < n; k++) {
          if (k === p || k === j) continue
          const aik = a[k * n + p]!
          const ajk = a[k * n + j]!
          const np = c * aik - s * ajk
          const nq = s * aik + c * ajk
          a[k * n + p] = np
          a[p * n + k] = np
          a[k * n + j] = nq
          a[j * n + k] = nq
        }
        for (let k = 0; k < n; k++) {
          const qkp = q[k * n + p]!
          const qkj = q[k * n + j]!
          q[k * n + p] = c * qkp - s * qkj
          q[k * n + j] = s * qkp + c * qkj
        }
      }
    }
  }
  const s = new Float64Array(n)
  for (let i = 0; i < n; i++) s[i] = Math.max(0, a[i * n + i]!)
  return { s, q }
}

function ridgeBeta(
  s: Float64Array,
  q: Float64Array,
  xty: Float64Array,
  yty: number,
  nTrain: number,
): Float64Array {
  const d = s.length
  const z = new Float64Array(d)
  for (let j = 0; j < d; j++) {
    let acc = 0
    for (let i = 0; i < d; i++) acc += q[i * d + j]! * xty[i]!
    z[j] = acc
  }
  const grid = [1e-4, 1e-3, 1e-2, 0.1, 1, 10]
  let bestLam = 0.1
  let bestScore = Infinity
  for (const lam of grid) {
    const pen = nTrain * lam
    let bXy = 0
    let bXb = 0
    let tr = 0
    for (let j = 0; j < d; j++) {
      const sj = s[j]!
      const denom = sj + pen
      const w = z[j]! / denom
      bXy += w * z[j]!
      bXb += sj * w * w
      tr += sj / denom
    }
    const rss = Math.max(0, yty - 2 * bXy + bXb)
    const denom = Math.max(1e-6, 1 - tr / nTrain)
    const gcv = rss / nTrain / (denom * denom)
    if (gcv < bestScore) {
      bestScore = gcv
      bestLam = lam
    }
  }
  const pen = nTrain * bestLam
  const w = new Float64Array(d)
  for (let j = 0; j < d; j++) w[j] = z[j]! / (s[j]! + pen)
  const beta = new Float64Array(d)
  for (let i = 0; i < d; i++) {
    let acc = 0
    const row = i * d
    for (let j = 0; j < d; j++) acc += q[row + j]! * w[j]!
    beta[i] = acc
  }
  return beta
}

type Design = {
  phiTrain: Float64Array
  phiTest: Float64Array
  xsTrain: Float64Array
  xsTest: Float64Array
  nTrain: number
  nTest: number
  pKept: number
  dPhi: number
}

function buildDesign(
  x: Float64Array,
  p: number,
  train: Int32Array,
  nTrain: number,
  test: Int32Array,
  nTest: number,
  seed: number,
): Design | null {
  const mean = new Float64Array(p)
  const sd = new Float64Array(p)
  const keep: number[] = []
  for (let j = 0; j < p; j++) {
    let m = 0
    for (let i = 0; i < nTrain; i++) m += x[train[i]! * p + j]!
    m /= nTrain
    let v = 0
    for (let i = 0; i < nTrain; i++) {
      const d = x[train[i]! * p + j]! - m
      v += d * d
    }
    const s = Math.sqrt(v / Math.max(1, nTrain - 1))
    mean[j] = m
    sd[j] = s
    if (s > 1e-8) keep.push(j)
  }
  if (!keep.length) return null
  const pKept = keep.length
  const rng = mulberry32(seed)
  const omega = new Float64Array(RFF * pKept)
  const bias = new Float64Array(RFF)
  const scale = 1 / Math.sqrt(pKept)
  for (let r = 0; r < RFF; r++) {
    bias[r] = rng() * 2 * Math.PI
    const row = r * pKept
    for (let j = 0; j < pKept; j++) omega[row + j] = gaussian(rng) * scale
  }
  const rffScale = Math.sqrt(2 / RFF)
  const dPhi = pKept + RFF

  const fill = (idx: Int32Array, n: number) => {
    const raw = new Float64Array(n * pKept)
    const phi = new Float64Array(n * dPhi)
    for (let i = 0; i < n; i++) {
      const src = idx[i]! * p
      const dest = i * pKept
      for (let j = 0; j < pKept; j++) {
        const col = keep[j]!
        raw[dest + j] = (x[src + col]! - mean[col]!) / sd[col]!
      }
      const prow = i * dPhi
      for (let j = 0; j < pKept; j++) phi[prow + j] = raw[dest + j]!
      for (let r = 0; r < RFF; r++) {
        let dot = bias[r]!
        const orow = r * pKept
        for (let j = 0; j < pKept; j++) dot += omega[orow + j]! * raw[dest + j]!
        phi[prow + pKept + r] = rffScale * Math.cos(dot)
      }
    }
    return { raw, phi }
  }

  const tr = fill(train, nTrain)
  const te = fill(test, nTest)
  const colMean = new Float64Array(dPhi)
  for (let i = 0; i < nTrain; i++) {
    const row = i * dPhi
    for (let j = 0; j < dPhi; j++) colMean[j]! += tr.phi[row + j]!
  }
  for (let j = 0; j < dPhi; j++) colMean[j]! /= nTrain
  for (let i = 0; i < nTrain; i++) {
    const row = i * dPhi
    for (let j = 0; j < dPhi; j++) tr.phi[row + j]! -= colMean[j]!
  }
  for (let i = 0; i < nTest; i++) {
    const row = i * dPhi
    for (let j = 0; j < dPhi; j++) te.phi[row + j]! -= colMean[j]!
  }
  return {
    phiTrain: tr.phi,
    phiTest: te.phi,
    xsTrain: tr.raw,
    xsTest: te.raw,
    nTrain,
    nTest,
    pKept,
    dPhi,
  }
}

function fitTarget(design: Design, z: Float64Array, idx: Int32Array, s: Float64Array, q: Float64Array): { pred: Float64Array; trainPred: Float64Array } {
  const { phiTrain, phiTest, nTrain, nTest, dPhi } = design
  let meanZ = 0
  for (let i = 0; i < nTrain; i++) meanZ += z[idx[i]!]!
  meanZ /= nTrain
  const xty = new Float64Array(dPhi)
  let yty = 0
  for (let i = 0; i < nTrain; i++) {
    const yc = z[idx[i]!]! - meanZ
    yty += yc * yc
    const row = i * dPhi
    for (let j = 0; j < dPhi; j++) xty[j]! += phiTrain[row + j]! * yc
  }
  const beta = ridgeBeta(s, q, xty, yty, nTrain)
  const pred = new Float64Array(nTest)
  for (let i = 0; i < nTest; i++) {
    let acc = meanZ
    const row = i * dPhi
    for (let j = 0; j < dPhi; j++) acc += phiTest[row + j]! * beta[j]!
    pred[i] = acc
  }
  const trainPred = new Float64Array(nTrain)
  for (let i = 0; i < nTrain; i++) {
    let acc = meanZ
    const row = i * dPhi
    for (let j = 0; j < dPhi; j++) acc += phiTrain[row + j]! * beta[j]!
    trainPred[i] = acc
  }
  return { pred, trainPred }
}

function boostResiduals(design: Design, residTrain: Float64Array, predTest: Float64Array, seed: number) {
  const { xsTrain, xsTest, nTrain, nTest, pKept } = design
  if (pKept < 1 || nTrain < 80) return
  const rz = residTrain.slice()
  const rng = mulberry32(seed)
  const sampleN = Math.min(nTrain, 520)
  const order = new Int32Array(nTrain)
  for (let i = 0; i < nTrain; i++) order[i] = i
  for (let i = 0; i < sampleN; i++) {
    const j = i + Math.floor(rng() * (nTrain - i))
    const tmp = order[i]!
    order[i] = order[j]!
    order[j] = tmp
  }
  const sample = order.subarray(0, sampleN)
  const shrink = 0.5
  for (let t = 0; t < 4; t++) {
    const tree = buildTree(xsTrain, pKept, rz, sample, sampleN, rng, 0)
    for (let i = 0; i < nTrain; i++) rz[i]! -= shrink * evalTree(tree, xsTrain, pKept, i)
    for (let i = 0; i < nTest; i++) predTest[i]! += shrink * evalTree(tree, xsTest, pKept, i)
  }
}

function xtxEigen(phi: Float64Array, n: number, d: number): { s: Float64Array; q: Float64Array } | null {
  const xtx = new Float64Array(d * d)
  for (let i = 0; i < n; i++) {
    const row = i * d
    for (let a = 0; a < d; a++) {
      const xa = phi[row + a]!
      const dest = a * d
      for (let b = a; b < d; b++) xtx[dest + b]! += xa * phi[row + b]!
    }
  }
  for (let a = 0; a < d; a++) {
    for (let b = 0; b < a; b++) xtx[a * d + b] = xtx[b * d + a]!
  }
  return jacobiEigen(xtx, d)
}

export type PlrDmlFit = {
  theta: number
  se: number
  t: number
  p: number
  strength: number
  n: number
  dates: number
}

function crossFitResiduals(
  series: Float64Array[],
  x: Float64Array,
  p: number,
  fold: Uint8Array,
  seed: number,
): { resid: Float64Array[]; seen: Uint8Array } | null {
  const n = series[0]?.length ?? 0
  const m = series.length
  if (n < MIN_N || m < 1 || p < 1) return null
  const hat = series.map(() => new Float64Array(n))
  const seen = new Uint8Array(n)
  for (let k = 0; k < FOLDS; k++) {
    let nTrain = 0
    let nTest = 0
    for (let i = 0; i < n; i++) {
      if (fold[i] === k) nTest++
      else nTrain++
    }
    if (nTrain < 40 || nTest < 15) return null
    const train = new Int32Array(nTrain)
    const test = new Int32Array(nTest)
    let a = 0
    let b = 0
    for (let i = 0; i < n; i++) {
      if (fold[i] === k) test[b++] = i
      else train[a++] = i
    }
    const design = buildDesign(x, p, train, nTrain, test, nTest, seed + k * 17)
    if (!design) return null
    const eig = xtxEigen(design.phiTrain, nTrain, design.dPhi)
    if (!eig) return null
    for (let s = 0; s < m; s++) {
      const src = series[s]!
      const fit = fitTarget(design, src, train, eig.s, eig.q)
      const residTrain = new Float64Array(nTrain)
      for (let i = 0; i < nTrain; i++) residTrain[i] = src[train[i]!]! - fit.trainPred[i]!
      boostResiduals(design, residTrain, fit.pred, seed + 1000 + k * 50 + s)
      const dst = hat[s]!
      for (let i = 0; i < nTest; i++) dst[test[i]!] = fit.pred[i]!
    }
    for (let i = 0; i < nTest; i++) seen[test[i]!] = 1
  }
  const resid = series.map((src, s) => {
    const r = new Float64Array(n)
    const h = hat[s]!
    for (let i = 0; i < n; i++) r[i] = seen[i] ? src[i]! - h[i]! : 0
    return r
  })
  return { resid, seen }
}

function zScore(src: Float64Array): Float64Array | null {
  const n = src.length
  let m = 0
  for (let i = 0; i < n; i++) m += src[i]!
  m /= n
  let v = 0
  for (let i = 0; i < n; i++) v += (src[i]! - m) ** 2
  const s = Math.sqrt(v / Math.max(1, n - 1))
  if (s < 1e-10) return null
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = (src[i]! - m) / s
  return out
}

function scalarDml(
  yRes: Float64Array,
  v: Float64Array,
  seen: Uint8Array,
  cluster: string[],
): PlrDmlFit | null {
  const n = yRes.length
  let denom = 0
  let numer = 0
  let vSum = 0
  let v2 = 0
  let used = 0
  for (let i = 0; i < n; i++) {
    if (!seen[i]) continue
    const vi = v[i]!
    numer += vi * yRes[i]!
    denom += vi * vi
    vSum += vi
    v2 += vi * vi
    used++
  }
  if (used < MIN_N || denom < 1e-8) return null
  const theta = numer / denom
  const byDate = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    if (!seen[i]) continue
    const psi = v[i]! * (yRes[i]! - theta * v[i]!)
    const key = cluster[i] ?? String(i)
    byDate.set(key, (byDate.get(key) ?? 0) + psi)
  }
  let meat = 0
  for (const s of byDate.values()) meat += s * s
  const c = byDate.size
  if (c < 12) return null
  const se = Math.sqrt(meat * (c / (c - 1))) / Math.abs(denom)
  if (!Number.isFinite(se) || se < 1e-12) return null
  const meanV = vSum / used
  const varV = Math.max(0, v2 / used - meanV * meanV)
  return { theta, se, t: theta / se, p: twoSidedP(theta / se), strength: Math.sqrt(varV), n: used, dates: c }
}

function invertMatrix(a: Float64Array, k: number): Float64Array | null {
  const w = k * 2
  const A = new Float64Array(k * w)
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) A[i * w + j] = a[i * k + j]!
    A[i * w + k + i] = 1
  }
  for (let col = 0; col < k; col++) {
    let piv = col
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(A[r * w + col]!) > Math.abs(A[piv * w + col]!)) piv = r
    }
    if (Math.abs(A[piv * w + col]!) < 1e-10) return null
    if (piv !== col) {
      for (let j = 0; j < w; j++) {
        const tmp = A[col * w + j]!
        A[col * w + j] = A[piv * w + j]!
        A[piv * w + j] = tmp
      }
    }
    const div = A[col * w + col]!
    for (let j = 0; j < w; j++) A[col * w + j]! /= div
    for (let r = 0; r < k; r++) {
      if (r === col) continue
      const f = A[r * w + col]!
      for (let j = 0; j < w; j++) A[r * w + j]! -= f * A[col * w + j]!
    }
  }
  const inv = new Float64Array(k * k)
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) inv[i * k + j] = A[i * w + k + j]!
  }
  return inv
}

function chi2sf3(stat: number): number {
  if (!(stat > 0)) return 1
  const u = Math.sqrt(stat / 2)
  const erfc = 1 - erf(u)
  return Math.min(1, Math.max(0, erfc + (2 * u * Math.exp(-u * u)) / Math.sqrt(Math.PI)))
}

const BIN_LABELS = ["最低", "偏低", "中等", "偏高", "最高"]

function assignQuintiles(v: Float64Array): { bin: Uint8Array; mean: number[] } | null {
  const n = v.length
  if (n < MIN_N) return null
  const order = new Float64Array(n)
  for (let i = 0; i < n; i++) order[i] = v[i]!
  order.sort()
  const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => order[Math.min(n - 1, Math.floor(q * n))]!)
  const bin = new Uint8Array(n)
  const sum = [0, 0, 0, 0, 0]
  const cnt = [0, 0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    const x = v[i]!
    let b = 0
    if (x > cuts[0]!) b = 1
    if (x > cuts[1]!) b = 2
    if (x > cuts[2]!) b = 3
    if (x > cuts[3]!) b = 4
    bin[i] = b
    sum[b]! += x
    cnt[b]! += 1
  }
  if (cnt.some((c) => c < 40)) return null
  return { bin, mean: sum.map((s, i) => s / cnt[i]!) }
}

type DoseFit = {
  shape: DoseShape
  nonlinearP: number
  curve: DosePoint[]
}

function classifyDose(
  effect: number[],
  cov: Float64Array,
  nonlinearP: number,
): DoseShape {
  const span = Math.max(...effect) - Math.min(...effect)
  const lineAt = effect.map((_, i) => effect[0]! + (effect[4]! - effect[0]!) * (i / 4))
  const maxDev = Math.max(...effect.map((e, i) => Math.abs(e - lineAt[i]!)))
  if (nonlinearP > P_CUT || span < 0.04 || maxDev < 0.04) return "linear"
  const seDiff = (i: number, j: number) => {
    if (i === 0 && j === 0) return 0
    if (j === 0) return Math.sqrt(Math.max(0, cov[(i - 1) * 4 + (i - 1)]!))
    if (i === 0) return Math.sqrt(Math.max(0, cov[(j - 1) * 4 + (j - 1)]!))
    const a = i - 1
    const b = j - 1
    return Math.sqrt(Math.max(0, cov[a * 4 + a]! + cov[b * 4 + b]! - 2 * cov[a * 4 + b]!))
  }
  const apart = (i: number, j: number) => Math.abs(effect[i]! - effect[j]!) > Math.max(0.03, 1.96 * seDiff(i, j))
  const steps = [effect[1]! - effect[0]!, effect[2]! - effect[1]!, effect[3]! - effect[2]!, effect[4]! - effect[3]!]
  const total = steps.reduce((s, v) => s + Math.abs(v), 0) || 1
  const mid = (effect[1]! + effect[2]! + effect[3]!) / 3
  const ends = (effect[0]! + effect[4]!) / 2
  const endGap = Math.abs(effect[4]! - effect[0]!)
  if (ends - mid > 0.03 && endGap < Math.abs(ends - mid) * 0.85 && apart(2, 0) && apart(2, 4)) return "u"
  if (mid - ends > 0.03 && endGap < Math.abs(mid - ends) * 0.85 && apart(2, 0) && apart(2, 4)) return "inv_u"
  if (Math.abs(steps[3]!) / total > 0.5 && apart(4, 3)) return "threshold_high"
  if (Math.abs(steps[0]!) / total > 0.5 && apart(1, 0)) return "threshold_low"
  const sign = Math.sign(effect[4]! - effect[0]!)
  const reversal = steps.some((s, i) => s * sign < -0.02 && apart(i, i + 1))
  const monotone = sign !== 0 && !reversal
  if (monotone && (Math.abs(steps[2]!) + Math.abs(steps[3]!)) / total > 0.65) return "steep_high"
  if (monotone && (Math.abs(steps[0]!) + Math.abs(steps[1]!)) / total > 0.65) return "steep_low"
  if (monotone) return sign > 0 ? "uneven_up" : "uneven_down"
  return "nonmonotone"
}

function doseFromResiduals(
  yRes: Float64Array,
  dummies: Float64Array[],
  seen: Uint8Array,
  cluster: string[],
  binMean: number[],
): DoseFit | null {
  const k = dummies.length
  const n = yRes.length
  const bread = new Float64Array(k * k)
  const xty = new Float64Array(k)
  let used = 0
  const dates = new Set<string>()
  for (let i = 0; i < n; i++) {
    if (!seen[i]) continue
    used++
    dates.add(cluster[i] ?? String(i))
    const yi = yRes[i]!
    for (let a = 0; a < k; a++) {
      const va = dummies[a]![i]!
      xty[a]! += va * yi
      for (let b = a; b < k; b++) bread[a * k + b]! += va * dummies[b]![i]!
    }
  }
  if (used < MIN_N || dates.size < 12) return null
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < a; b++) bread[a * k + b] = bread[b * k + a]!
    bread[a * k + a]! += 1e-8 * used
  }
  const inv = invertMatrix(bread, k)
  if (!inv) return null
  const theta = new Float64Array(k)
  for (let a = 0; a < k; a++) {
    let acc = 0
    for (let b = 0; b < k; b++) acc += inv[a * k + b]! * xty[b]!
    theta[a] = acc
  }
  const meat = new Float64Array(k * k)
  const acc = new Map<string, Float64Array>()
  for (let i = 0; i < n; i++) {
    if (!seen[i]) continue
    let pred = 0
    for (let a = 0; a < k; a++) pred += dummies[a]![i]! * theta[a]!
    const e = yRes[i]! - pred
    const key = cluster[i] ?? String(i)
    let s = acc.get(key)
    if (!s) {
      s = new Float64Array(k)
      acc.set(key, s)
    }
    for (let a = 0; a < k; a++) s[a]! += dummies[a]![i]! * e
  }
  const c = acc.size
  const fin = c / Math.max(1, c - 1)
  for (const s of acc.values()) {
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) meat[a * k + b]! += s[a]! * s[b]! * fin
    }
  }
  const cov = new Float64Array(k * k)
  const tmp = new Float64Array(k * k)
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      let accn = 0
      for (let t = 0; t < k; t++) accn += inv[a * k + t]! * meat[t * k + b]!
      tmp[a * k + b] = accn
    }
  }
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      let accn = 0
      for (let t = 0; t < k; t++) accn += tmp[a * k + t]! * inv[b * k + t]!
      cov[a * k + b] = accn
    }
  }
  const effect = [0, theta[0]!, theta[1]!, theta[2]!, theta[3]!]
  const centers = binMean
  const delta = [centers[1]! - centers[0]!, centers[2]! - centers[0]!, centers[3]! - centers[0]!, centers[4]! - centers[0]!]
  if (delta.some((d) => Math.abs(d) < 1e-8)) return null
  const R = [
    [-delta[1]!, delta[0]!, 0, 0],
    [-delta[2]!, 0, delta[0]!, 0],
    [-delta[3]!, 0, 0, delta[0]!],
  ]
  const rt = R.map((row) => row.reduce((s, rij, j) => s + rij * theta[j]!, 0))
  const mid = R.map((row) => {
    const out = [0, 0, 0, 0]
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let t = 0; t < 4; t++) s += row[t]! * cov[t * k + j]!
      out[j] = s
    }
    return out
  })
  const gram = [0, 1, 2].map((a) => [0, 1, 2].map((b) => {
    let s = 0
    for (let j = 0; j < 4; j++) s += mid[a]![j]! * R[b]![j]!
    return s
  }))
  for (let a = 0; a < 3; a++) gram[a]![a]! += 1e-12
  const gFlat = new Float64Array(9)
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) gFlat[a * 3 + b] = gram[a]![b]!
  const gInv = invertMatrix(gFlat, 3)
  let nonlinearP = 1
  if (gInv) {
    let stat = 0
    for (let a = 0; a < 3; a++) {
      let accn = 0
      for (let b = 0; b < 3; b++) accn += gInv[a * 3 + b]! * rt[b]!
      stat += rt[a]! * accn
    }
    nonlinearP = chi2sf3(Math.max(0, stat))
  }
  const shape = classifyDose(effect, cov, nonlinearP)
  const curve: DosePoint[] = BIN_LABELS.map((label, i) => {
    const est = effect[i]!
    const se = i === 0 ? 0 : Math.sqrt(Math.max(0, cov[(i - 1) * k + (i - 1)]!))
    return {
      label,
      x: r3(centers[i]!),
      effect: r3(est),
      lo: r3(est - 1.96 * se),
      hi: r3(est + 1.96 * se),
    }
  })
  return { shape, nonlinearP, curve }
}

/**
 * Cross-fit partially linear DML. y and d are scaled inside.
 * x is n×p row-major confounders. fold is 0..K-1. cluster labels group the score.
 */
export function estimatePlrDml(
  yIn: Float64Array,
  dIn: Float64Array,
  x: Float64Array,
  p: number,
  fold: Uint8Array,
  cluster: string[],
  seed: number,
): PlrDmlFit | null {
  const y = zScore(yIn)
  const d = zScore(dIn)
  if (!y || !d) return null
  const fit = crossFitResiduals([y, d], x, p, fold, seed)
  if (!fit) return null
  return scalarDml(fit.resid[0]!, fit.resid[1]!, fit.seen, cluster)
}

export type FactorEffectFit = { linear: PlrDmlFit; dose: DoseFit | null }

/** Linear slope and five-bin dose response from one shared cross-fit. */
export function fitFactorDml(
  yIn: Float64Array,
  dRaw: Float64Array,
  x: Float64Array,
  p: number,
  fold: Uint8Array,
  cluster: string[],
  seed: number,
): FactorEffectFit | null {
  const y = zScore(yIn)
  const z = zScore(dRaw)
  if (!y || !z) return null
  const bins = assignQuintiles(dRaw)
  const series: Float64Array[] = [y, z]
  if (bins) {
    for (let b = 1; b <= 4; b++) {
      const dummy = new Float64Array(dRaw.length)
      for (let i = 0; i < dRaw.length; i++) if (bins.bin[i] === b) dummy[i] = 1
      series.push(dummy)
    }
  }
  const crossed = crossFitResiduals(series, x, p, fold, seed)
  if (!crossed) return null
  const linear = scalarDml(crossed.resid[0]!, crossed.resid[1]!, crossed.seen, cluster)
  if (!linear) return null
  let dose: DoseFit | null = null
  if (bins && crossed.resid.length === 6) {
    dose = doseFromResiduals(
      crossed.resid[0]!,
      crossed.resid.slice(2),
      crossed.seen,
      cluster,
      bins.mean,
    )
  }
  return { linear, dose }
}

type BuiltRow = {
  product: string
  sector: string
  date: string
  yDir: number
  yInt: number
  f: Float64Array
  state: Float64Array
  ret: number
  opened: number
}

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

function weekdaySinCos(iso: string): [number, number] {
  const [y, m, d] = iso.split("-").map(Number)
  const dow = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1)).getUTCDay()
  const ang = (2 * Math.PI * dow) / 7
  return [Math.sin(ang), Math.cos(ang)]
}

function emptyCausal(headline: string): CausalGraph {
  return { headline, directCount: 0, edges: [] }
}

function emptyReport(headline: string): FactorDmlReport {
  return {
    headline,
    n: 0,
    dates: 0,
    products: 0,
    tested: 0,
    significant: 0,
    nonlinear: 0,
    causal: emptyCausal("样本不够，没有做因果图。"),
    irl: emptyIrl(),
    audit: emptyAudit(),
    rows: [],
  }
}

function meaning(spec: FactorSpec, theta: number): string {
  if (spec.outcome === "direction") {
    return theta >= 0
      ? "平均斜率是直线：因子越高，下一交易日净开仓越偏多"
      : "平均斜率是直线：因子越高，下一交易日净开仓越偏空"
  }
  return theta >= 0
    ? "平均斜率是直线：因子越高，下一交易日开仓手数越多"
    : "平均斜率是直线：因子越高，下一交易日开仓手数越少"
}

function vsLow(spec: FactorSpec, effect: number): string {
  const mag = `${effect > 0 ? "+" : ""}${r2(effect)}`
  if (spec.outcome === "direction") {
    return effect >= 0 ? `更偏多（相对最低档 ${mag}）` : `更偏空（相对最低档 ${mag}）`
  }
  return effect >= 0 ? `开得更多（相对最低档 ${mag}）` : `开得更少（相对最低档 ${mag}）`
}

export function shapeTitle(shape: DoseShape): string {
  switch (shape) {
    case "linear": return "直线"
    case "threshold_high": return "只在最高档跳变"
    case "threshold_low": return "离开最低档就变"
    case "u": return "两头才动"
    case "inv_u": return "中间才动"
    case "steep_high": return "高位变陡"
    case "steep_low": return "低位变陡"
    case "uneven_up": return "单调但不均匀"
    case "uneven_down": return "单调向下但不均匀"
    default: return "非单调"
  }
}

function shapeDetail(spec: FactorSpec, dose: DoseFit): string {
  const curve = dose.curve
  const p = dose.nonlinearP < 0.001 ? "<0.001" : dose.nonlinearP.toFixed(3)
  const hi = curve[4]!
  const mid = curve[2]!
  const lo1 = curve[1]!
  const path = curve.map((c) => `${c.label}${c.effect > 0 ? "+" : ""}${c.effect.toFixed(2)}`).join(" → ")
  switch (dose.shape) {
    case "threshold_high":
      return `不是直线。最低到偏高几乎不动，只有最高一档${vsLow(spec, hi.effect)}。像极端值或突破才动手。非线性 p=${p}。`
    case "threshold_low":
      return `不是直线。一离开最低档就${vsLow(spec, lo1.effect)}，再往上四档差不多，不是越涨越加。非线性 p=${p}。`
    case "u":
      return `不是越高越买。中间档${vsLow(spec, mid.effect)}，最高档回到 ${hi.effect > 0 ? "+" : ""}${r2(hi.effect)}：两头和中间相反。非线性 p=${p}。`
    case "inv_u":
      return `中间档反应最大，${vsLow(spec, mid.effect)}，两头收回来，不是单调的一条线。非线性 p=${p}。`
    case "steep_high":
      return `方向大体跟因子走，但不是均匀直线：变化主要堆在偏高和最高两档。${vsLow(spec, hi.effect)}。非线性 p=${p}。`
    case "steep_low":
      return `不是均匀直线。离开低位时变化最大，到了中高档变平。偏低档${vsLow(spec, lo1.effect)}。非线性 p=${p}。`
    case "uneven_up":
      return spec.outcome === "direction"
        ? `方向仍是越高越偏多，但五档不是等距直线：${path}。非线性 p=${p}。`
        : `方向仍是越高开得越多，但五档不是等距直线：${path}。非线性 p=${p}。`
    case "uneven_down":
      return spec.outcome === "direction"
        ? `方向仍是越高越偏空，但五档不是等距直线：${path}。非线性 p=${p}。`
        : `方向仍是越高开得越少，但五档不是等距直线：${path}。非线性 p=${p}。`
    case "nonmonotone":
      return `五档效应弯了，对不上「越高越偏多」：${path}。非线性 p=${p}。`
    default:
      return `五档剂量反应没有拒绝直线（非线性 p=${p}）。${meaning(spec, curve[4]!.effect - curve[0]!.effect)}。`
  }
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}
function r3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function rowKey(idx: number[]): string {
  let h = 2166136261
  let sum = 0
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i]!
    h ^= v
    h = Math.imul(h, 16777619)
    sum = (sum + v) | 0
  }
  const mid = idx[idx.length >> 1] ?? 0
  return `${idx.length}:${idx[0]}:${mid}:${idx[idx.length - 1]}:${sum}:${h >>> 0}`
}

function fitGrouped(
  built: BuiltRow[],
  foldOf: Map<string, number>,
  doseIds: Set<string>,
): Array<FactorEffectFit | null> {
  const fits: Array<FactorEffectFit | null> = FACTORS.map(() => null)
  const groups = new Map<string, { j: number; idx: number[] }[]>()
  for (let j = 0; j < N_F; j++) {
    const idx: number[] = []
    for (let i = 0; i < built.length; i++) {
      if (Number.isFinite(built[i]!.f[j]!)) idx.push(i)
    }
    if (idx.length < MIN_N) continue
    const ctrls = ENV_IDS.filter((id) => id !== FACTORS[j]!.id).join(",")
    const key = `${ctrls}|${rowKey(idx)}`
    const list = groups.get(key) ?? []
    list.push({ j, idx })
    groups.set(key, list)
  }

  for (const [key, group] of groups) {
    const idx = group[0]!.idx
    const ctrls = ENV_IDS.filter((id) => id !== FACTORS[group[0]!.j]!.id)
    const ctrlIx = ctrls.map((id) => F_INDEX.get(id)!)
    const stateUse = [1, 2, 3]
    const pConf = ctrlIx.length + stateUse.length
    const n = idx.length
    const x = new Float64Array(n * pConf)
    const fold = new Uint8Array(n)
    const cluster: string[] = []
    const medians = new Float64Array(pConf)
    const seen = new Int32Array(pConf)
    const confVal = (row: BuiltRow, c: number) => (
      c < ctrlIx.length ? row.f[ctrlIx[c]!]! : row.state[stateUse[c - ctrlIx.length]!]!
    )
    for (let c = 0; c < pConf; c++) {
      const vals: number[] = []
      for (let i = 0; i < n; i++) {
        const v = confVal(built[idx[i]!]!, c)
        if (Number.isFinite(v)) vals.push(v)
      }
      vals.sort((a, b) => a - b)
      medians[c] = vals.length ? vals[Math.floor(vals.length / 2)]! : 0
      seen[c] = vals.length
    }
    const yDir = new Float64Array(n)
    const yInt = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const row = built[idx[i]!]!
      yDir[i] = row.yDir
      yInt[i] = row.yInt
      fold[i] = foldOf.get(row.date) ?? 0
      cluster.push(row.date)
      for (let c = 0; c < pConf; c++) {
        if (seen[c]! < n * 0.45) {
          x[i * pConf + c] = 0
          continue
        }
        const v = confVal(row, c)
        x[i * pConf + c] = Number.isFinite(v) ? v : medians[c]!
      }
    }
    const useCols: number[] = []
    for (let c = 0; c < pConf; c++) if (seen[c]! >= n * 0.45) useCols.push(c)
    if (useCols.length < 2) continue
    const xUse = new Float64Array(n * useCols.length)
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < useCols.length; k++) xUse[i * useCols.length + k] = x[i * pConf + useCols[k]!]!
    }
    const yDirZ = zScore(yDir)
    const yIntZ = zScore(yInt)
    if (!yDirZ || !yIntZ) continue
    const series: Float64Array[] = [yDirZ, yIntZ]
    const owners: { j: number; at: number; doseAt: number; binMean: number[] | null }[] = []
    for (const job of group) {
      const raw = new Float64Array(n)
      for (let i = 0; i < n; i++) raw[i] = built[idx[i]!]!.f[job.j]!
      const z = zScore(raw)
      if (!z) continue
      const at = series.length
      series.push(z)
      let doseAt = -1
      let binMean: number[] | null = null
      if (doseIds.has(FACTORS[job.j]!.id)) {
        const bins = assignQuintiles(raw)
        if (bins) {
          doseAt = series.length
          binMean = bins.mean
          for (let b = 1; b <= 4; b++) {
            const dummy = new Float64Array(n)
            for (let i = 0; i < n; i++) if (bins.bin[i] === b) dummy[i] = 1
            series.push(dummy)
          }
        }
      }
      owners.push({ j: job.j, at, doseAt, binMean })
    }
    let seed = 2166136261
    for (let i = 0; i < key.length; i++) seed = Math.imul(seed ^ key.charCodeAt(i), 16777619)
    const crossed = crossFitResiduals(series, xUse, useCols.length, fold, seed >>> 0)
    if (!crossed) continue
    for (const own of owners) {
      const yRes = FACTORS[own.j]!.outcome === "direction" ? crossed.resid[0]! : crossed.resid[1]!
      const linear = scalarDml(yRes, crossed.resid[own.at]!, crossed.seen, cluster)
      if (!linear) continue
      const dose = own.doseAt >= 0 && own.binMean
        ? doseFromResiduals(yRes, crossed.resid.slice(own.doseAt, own.doseAt + 4), crossed.seen, cluster, own.binMean)
        : null
      fits[own.j] = { linear, dose }
    }
  }
  return fits
}

export function inferFactorDml(input: {
  opens: DmlOpen[]
  positions: DmlPos[]
  prices: DmlPx[]
  nhci?: DmlNh[]
  contracts?: DmlContract[]
  bookDays?: DmlBook[]
  sectorOf?: Record<string, string>
  from: string
  to: string
}): FactorDmlReport {
  const { opens, positions, prices, nhci = [], contracts = [], bookDays = [], sectorOf = {}, from, to } = input
  const openCount = new Map<string, number>()
  const openBy = new Map<string, { buy: number; sell: number }>()
  for (const o of opens) {
    const product = o.product
    const date = dayKey(o.date)
    if (!product) continue
    const buy = o.buyOpen
    const sell = o.sellOpen
    openBy.set(`${product}|${date}`, { buy, sell })
    if (buy + sell > 0) openCount.set(product, (openCount.get(product) ?? 0) + 1)
  }
  const active = [...openCount.entries()].filter(([, n]) => n >= 8).map(([p]) => p)
  if (active.length < 1) return emptyReport("开仓样本太少，因子推断没有做。")

  const posBy = new Map<string, number>()
  for (const p of positions) {
    posBy.set(`${p.product}|${dayKey(p.date)}`, p.buyLots - p.sellLots)
  }
  const riskBy = new Map<string, number>()
  for (const b of bookDays) riskBy.set(dayKey(b.date), b.riskPct)

  const front = new Map<string, { px: number; oi: number; doi: number }>()
  const backPx = new Map<string, number>()
  for (const c of contracts) {
    const key = `${c.product}|${dayKey(c.date)}`
    if (c.rk <= 1) {
      const prev = front.get(key)
      if (!prev || c.oi >= prev.oi) front.set(key, { px: c.px, oi: c.oi, doi: c.doi })
    } else if (c.rk === 2 && c.px > 0) {
      backPx.set(key, c.px)
    }
  }

  const byProd = new Map<string, DmlPx[]>()
  for (const r of prices) {
    if (!r.product || r.close <= 0) continue
    const list = byProd.get(r.product) ?? []
    list.push(r)
    byProd.set(r.product, list)
  }

  const nhSorted = [...nhci].filter((r) => r.close > 0).sort((a, b) => a.date.localeCompare(b.date))
  const nhMom = new Map<number, Map<string, number>>()
  for (const n of MKT_NS) nhMom.set(n, new Map())
  for (let i = 0; i < nhSorted.length; i++) {
    const date = dayKey(nhSorted[i]!.date)
    const px = nhSorted[i]!.close
    for (const n of MKT_NS) {
      const prev = nhSorted[i - n]?.close
      if (i >= n && prev && prev > 0) nhMom.get(n)!.set(date, px / prev - 1)
    }
  }

  type Partial = {
    product: string
    sector: string
    date: string
    signal: string
    yDir: number
    yInt: number
    f: Float64Array
    net: number
    risk: number
    dow: [number, number]
    ret: number
    opened: number
  }
  const partials: Partial[] = []

  for (const product of active) {
    const rows = byProd.get(product)
    if (!rows || rows.length < 30) continue
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    const uniq: DmlPx[] = []
    for (const r of sorted) {
      const date = dayKey(r.date)
      if (uniq.length && dayKey(uniq[uniq.length - 1]!.date) === date) uniq[uniq.length - 1] = r
      else uniq.push({ ...r, date })
    }
    const closes = new Float64Array(uniq.length)
    const vols = new Float64Array(uniq.length)
    const rets = new Float64Array(uniq.length)
    for (let i = 0; i < uniq.length; i++) {
      closes[i] = uniq[i]!.close
      vols[i] = uniq[i]!.volume
      rets[i] = i > 0 && closes[i - 1]! > 0 ? closes[i]! / closes[i - 1]! - 1 : 0
    }
    const px = buildPx(closes, vols, rets)
    const carryAt = new Float64Array(uniq.length)
    const oiAt = new Float64Array(uniq.length)
    carryAt.fill(Number.NaN)
    oiAt.fill(Number.NaN)
    const oiChgIx = F_INDEX.get("oichg")!
    const sector = sectorOf[product] || "其他"
    for (let i = 1; i < uniq.length; i++) {
      const action = uniq[i]!.date
      if (action < from || action > to) continue
      const s = i - 1
      const signal = uniq[s]!.date
      const f = new Float64Array(N_F)
      f.fill(Number.NaN)
      const ck = `${product}|${signal}`
      const fr = front.get(ck)
      const bk = backPx.get(ck)
      if (fr && fr.px > 0 && bk && bk > 0) carryAt[s] = bk / fr.px - 1
      if (fr && fr.oi > 0) {
        oiAt[s] = fr.oi
        const chg = fr.doi / fr.oi
        if (Number.isFinite(chg)) f[oiChgIx] = chg
      }
      for (let j = 0; j < N_F; j++) {
        const spec = FACTORS[j]!
        if (spec.op === "xsec" || spec.op === "sector" || spec.op === "rel" || spec.op === "mkt" || spec.op === "oi_chg") continue
        const v = evalFactor(spec, s, px, carryAt, oiAt)
        if (v != null && Number.isFinite(v)) f[j] = v
      }
      for (const n of MKT_NS) {
        const v = nhMom.get(n)?.get(signal)
        const ix = F_INDEX.get(`mkt_${n}`)
        if (v != null && ix != null) f[ix] = v
      }
      const flow = openBy.get(`${product}|${action}`)
      const buy = flow?.buy ?? 0
      const sell = flow?.sell ?? 0
      partials.push({
        product,
        sector,
        date: action,
        signal,
        yDir: buy - sell,
        yInt: buy + sell,
        f,
        net: posBy.get(ck) ?? 0,
        risk: riskBy.get(signal) ?? Number.NaN,
        dow: weekdaySinCos(action),
        ret: rets[i] ?? 0,
        opened: buy + sell > 0 ? 1 : 0,
      })
    }
  }

  if (partials.length < MIN_N) return emptyReport("行情和成交对得上的样本不够，因子推断没有做。")

  const bySignal = new Map<string, Partial[]>()
  for (const row of partials) {
    const list = bySignal.get(row.signal) ?? []
    list.push(row)
    bySignal.set(row.signal, list)
  }
  for (const n of XSEC_NS) {
    const iMom = F_INDEX.get(`mom_${n}`)!
    const iX = F_INDEX.get(`xsec_${n}`)!
    const iS = F_INDEX.get(`sector_${n}`)!
    const iRel = F_INDEX.get(`rel_${n}`)!
    for (const group of bySignal.values()) {
      const vals: number[] = []
      for (const row of group) {
        const v = row.f[iMom]!
        if (Number.isFinite(v)) vals.push(v)
      }
      const sd = stdev(vals)
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
      for (const row of group) {
        const v = row.f[iMom]!
        if (Number.isFinite(v) && sd > 1e-8) row.f[iX] = (v - mean) / sd
        let acc = 0
        let c = 0
        for (const other of group) {
          if (other.product === row.product || other.sector !== row.sector) continue
          const ov = other.f[iMom]!
          if (!Number.isFinite(ov)) continue
          acc += ov
          c++
        }
        if (c > 0) row.f[iS] = acc / c
        const sec = row.f[iS]!
        if (Number.isFinite(v) && Number.isFinite(sec)) row.f[iRel] = v - sec
      }
    }
  }

  const scaleOf = new Map<string, { dir: number; int: number; pos: number }>()
  const grouped = new Map<string, Partial[]>()
  for (const row of partials) {
    const list = grouped.get(row.product) ?? []
    list.push(row)
    grouped.set(row.product, list)
  }
  for (const [product, rows] of grouped) {
    const absDir = rows.map((r) => Math.abs(r.yDir)).filter((v) => v > 0).sort((a, b) => a - b)
    const absInt = rows.map((r) => r.yInt).filter((v) => v > 0).sort((a, b) => a - b)
    const absPos = rows.map((r) => Math.abs(r.net)).filter((v) => v > 0).sort((a, b) => a - b)
    const pct = (xs: number[]) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.9))]! : 1)
    scaleOf.set(product, {
      dir: Math.max(pct(absDir), 1e-6),
      int: Math.max(pct(absInt), 1e-6),
      pos: Math.max(pct(absPos), 1e-6),
    })
  }

  const built: BuiltRow[] = []
  for (const row of partials) {
    const sc = scaleOf.get(row.product)!
    const yDir = Math.max(-1.5, Math.min(1.5, row.yDir / sc.dir))
    const yInt = Math.max(0, Math.min(1.5, row.yInt / sc.int))
    const state = new Float64Array(N_STATE)
    state[0] = row.net / sc.pos
    state[1] = Number.isFinite(row.risk) ? row.risk : Number.NaN
    state[2] = row.dow[0]
    state[3] = row.dow[1]
    built.push({
      product: row.product,
      sector: row.sector,
      date: row.date,
      yDir,
      yInt,
      f: row.f,
      state,
      ret: row.ret,
      opened: row.opened,
    })
  }

  const demean = (pick: (row: BuiltRow) => number, write: (row: BuiltRow, v: number) => void) => {
    for (const rows of groupedRows(built)) {
      let m = 0
      let n = 0
      for (const row of rows) {
        const v = pick(row)
        if (!Number.isFinite(v)) continue
        m += v
        n++
      }
      if (!n) continue
      m /= n
      for (const row of rows) {
        const v = pick(row)
        if (Number.isFinite(v)) write(row, v - m)
      }
    }
  }
  demean((r) => r.yDir, (r, v) => { r.yDir = v })
  demean((r) => r.yInt, (r, v) => { r.yInt = v })
  for (let j = 0; j < N_F; j++) {
    demean((r) => r.f[j]!, (r, v) => { r.f[j] = v })
  }
  for (let j = 0; j < N_STATE; j++) {
    demean((r) => r.state[j]!, (r, v) => { r.state[j] = v })
  }

  const dates = [...new Set(built.map((r) => r.date))].sort()
  const foldOf = new Map<string, number>()
  dates.forEach((d, i) => foldOf.set(d, i % FOLDS))
  const products = new Set(built.map((r) => r.product))

  const factorCols = FACTORS.map((spec, j) => ({
    id: spec.id,
    outcome: spec.outcome,
    values: built.map((r) => r.f[j]!),
  }))
  const screened = built.length >= MIN_N
    ? screenDependence({
        products: built.map((r) => r.product),
        yDir: built.map((r) => r.yDir),
        yInt: built.map((r) => r.yInt),
        ret: built.map((r) => r.ret),
        opened: built.map((r) => r.opened),
        factors: factorCols,
      })
    : { placeboDcor: 0, screens: [] }
  const doseBar = Math.max(0.06, screened.placeboDcor)
  const doseIds = new Set(screened.screens.filter((s) => s.pass1 && s.dcor > doseBar).map((s) => s.id))
  const fits = fitGrouped(built, foldOf, doseIds)

  const pForQ: number[] = []
  const qIndex: number[] = []
  const npForQ: number[] = []
  const nqIndex: number[] = []
  for (let j = 0; j < N_F; j++) {
    const pack = fits[j]
    if (!pack) continue
    const fit = pack.linear
    if (fit.strength >= MIN_STRENGTH && Number.isFinite(fit.p)) {
      qIndex.push(j)
      pForQ.push(fit.p)
    }
    if (pack.dose && pack.dose.shape !== "linear" && Number.isFinite(pack.dose.nonlinearP)) {
      nqIndex.push(j)
      npForQ.push(pack.dose.nonlinearP)
    }
  }
  const qVals = bhQ(pForQ)
  const qOf = new Map<number, number>()
  qIndex.forEach((j, i) => qOf.set(j, qVals[i]!))
  const nqVals = bhQ(npForQ)
  const nqOf = new Map<number, number>()
  nqIndex.forEach((j, i) => nqOf.set(j, nqVals[i]!))

  const rows: FactorDmlRow[] = FACTORS.map((spec, j) => {
    const pack = fits[j]
    if (!pack) {
      return {
        id: spec.id, family: spec.family, name: spec.name, blurb: spec.blurb, outcome: spec.outcome,
        theta: null, se: null, t: null, p: null, q: null, ciLow: null, ciHigh: null,
        n: 0, dates: 0, strength: null, verdict: "skip" as const,
        shape: null, nonlinearP: null, nonlinearQ: null, curve: null,
        detail: "有效样本不够（因子在这一段行情里经常算不出来，或成交太少）。",
      }
    }
    const fit = pack.linear
    const q = qOf.get(j) ?? null
    const nq = nqOf.get(j) ?? null
    const bent = pack.dose != null && pack.dose.shape !== "linear" && (nq ?? 1) <= Q_CUT && pack.dose.nonlinearP <= P_CUT
    let verdict: FactorVerdict = "ns"
    if (fit.strength < MIN_STRENGTH) verdict = "weak"
    else if (fit.p <= P_CUT && (q ?? 1) <= Q_CUT && Math.abs(fit.theta) >= MIN_ABS) {
      verdict = fit.theta > 0 ? "pos" : "neg"
    } else if (fit.p <= P_CUT && (q ?? 1) <= Q_CUT) verdict = "small"
    const npText = pack.dose
      ? (pack.dose.nonlinearP < 0.001 ? "<0.001" : pack.dose.nonlinearP.toFixed(3))
      : null
    const nqText = nq == null ? null : (nq < 0.001 ? "<0.001" : nq.toFixed(2))
    let detail: string
    if (verdict === "weak") {
      detail = "这个因子几乎能被波动、成交量和市场状态解释掉，正交之后没有足够的独立波动，不能单独判断。"
    } else if (bent && pack.dose) {
      detail = shapeDetail(spec, pack.dose)
    } else if (pack.dose && pack.dose.shape !== "linear") {
      detail = `五档有弯曲的迹象（p=${npText}，校正后 q=${nqText}），多重比较后不当成非线性。${meaning(spec, fit.theta)}。`
    } else if (verdict === "small") {
      detail = `${meaning(spec, fit.theta)}，但幅度只有 ${r2(Math.abs(fit.theta))} 个标准差。五档没有拒绝直线（非线性 p=${npText ?? "—"}）。`
    } else if (pack.dose) {
      detail = `${meaning(spec, fit.theta)}。θ=${fit.theta >= 0 ? "+" : ""}${r2(fit.theta)}。五档剂量反应没有拒绝直线（非线性 p=${npText}）。`
    } else {
      detail = `${meaning(spec, fit.theta)}。θ=${fit.theta >= 0 ? "+" : ""}${r2(fit.theta)}。五档剂量反应没有做成。`
    }
    return {
      id: spec.id, family: spec.family, name: spec.name, blurb: spec.blurb, outcome: spec.outcome,
      theta: r3(fit.theta),
      se: r3(fit.se),
      t: r2(fit.t),
      p: fit.p,
      q: q == null ? null : Math.min(1, q),
      ciLow: r3(fit.theta - 1.96 * fit.se),
      ciHigh: r3(fit.theta + 1.96 * fit.se),
      n: fit.n,
      dates: fit.dates,
      strength: r2(fit.strength),
      verdict,
      shape: bent && pack.dose ? pack.dose.shape : (pack.dose ? "linear" : null),
      nonlinearP: pack.dose ? pack.dose.nonlinearP : null,
      nonlinearQ: nq == null ? null : Math.min(1, nq),
      curve: pack.dose?.curve ?? null,
      detail,
    }
  })

  const bentRows = rows.filter((r) => r.shape != null && r.shape !== "linear")
  const linearRows = rows.filter((r) => (r.verdict === "pos" || r.verdict === "neg") && (r.shape == null || r.shape === "linear"))
  const tested = rows.filter((r) => r.verdict !== "skip").length
  let headline: string
  if (!bentRows.length && !linearRows.length) {
    headline = tested
      ? `交叉拟合之后，这 ${tested} 个因子既没有弯折过线，也没有一条够大的直线斜率。`
      : "样本不够，因子推断没有做完。"
  } else if (bentRows.length) {
    const bits = bentRows.slice(0, 3).map((r) => `${r.name}（${shapeTitle(r.shape!)}）`)
    headline = `五档 DML 拒绝直线的有：${bits.join("、")}。`
    if (bentRows.length > 3) headline += ` 另外 ${bentRows.length - 3} 个也是弯的。`
    if (linearRows.length) {
      const line = linearRows.slice(0, 3).map((r) => r.name).join("、")
      headline += ` 近似直线的还有：${line}。`
    }
  } else {
    const bits = linearRows.slice(0, 4).map((r) => {
      const dir = r.outcome === "direction"
        ? (r.theta != null && r.theta > 0 ? "越高越偏多" : "越高越偏空")
        : (r.theta != null && r.theta > 0 ? "越高开得越多" : "越高开得越少")
      return `${r.name}（θ=${r.theta != null && r.theta > 0 ? "+" : ""}${r.theta?.toFixed(2)}，${dir}）`
    })
    headline = `五档剂量反应都没有拒绝直线。能看出来的是线性斜率：${bits.join("、")}。`
    if (linearRows.length > 4) headline += ` 另外还有 ${linearRows.length - 4} 个直线。`
  }

  const focusIds = new Set(
    screened.screens
      .filter((s) => s.pass1 && s.dcor > doseBar)
      .sort((a, b) => b.dcor - a.dcor)
      .slice(0, 48)
      .map((s) => s.id),
  )
  const focusFactors = FACTORS.flatMap((spec, j) => (
    focusIds.has(spec.id) ? [{ id: spec.id, name: spec.name, values: factorCols[j]!.values }] : []
  ))
  const namedFactors = FACTORS.map((spec, j) => ({
    id: spec.id,
    name: spec.name,
    outcome: spec.outcome,
    values: factorCols[j]!.values,
  }))

  const causal = built.length >= MIN_N
    ? discoverCausalGraph({
        dates: built.map((r) => r.date),
        yDir: built.map((r) => r.yDir),
        yInt: built.map((r) => r.yInt),
        factors: focusFactors,
        controls: [
          built.map((r) => r.state[1]!),
          built.map((r) => r.state[2]!),
        ],
      })
    : emptyCausal("样本不够，没有做因果图。")

  const irl = built.length >= MIN_N
    ? recoverTraderReward({
        dates: built.map((r) => r.date),
        yDir: built.map((r) => r.yDir),
        yInt: built.map((r) => r.yInt),
        factors: focusFactors,
        position: built.map((r) => r.state[0]!),
        risk: built.map((r) => r.state[1]!),
      })
    : emptyIrl()

  const audit = built.length >= MIN_N
    ? auditFactors({
        products: built.map((r) => r.product),
        yDir: built.map((r) => r.yDir),
        yInt: built.map((r) => r.yInt),
        ret: built.map((r) => r.ret),
        opened: built.map((r) => r.opened),
        factors: namedFactors,
        rows,
        irl,
        causal,
        screened,
      })
    : emptyAudit()

  return {
    headline: `候选因子 ${N_F} 个，有效检验 ${tested} 个。${audit.headline || headline}`,
    n: built.length,
    dates: dates.length,
    products: products.size,
    tested,
    significant: linearRows.length + bentRows.length,
    nonlinear: bentRows.length,
    causal,
    irl,
    audit,
    rows,
  }
}

function groupedRows(rows: BuiltRow[]): BuiltRow[][] {
  const map = new Map<string, BuiltRow[]>()
  for (const row of rows) {
    const list = map.get(row.product) ?? []
    list.push(row)
    map.set(row.product, list)
  }
  return [...map.values()]
}
