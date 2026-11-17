/** Strategy-environment scoreboard: how tradable each sleeve is, not how it performed. */

export type EnvTone = "good" | "mid" | "weak" | "empty"

export type EnvFactor = {
  key: string
  label: string
  /** 0–100. Higher means this input currently helps the strategy. */
  score: number
  /** Share of the composite. Weights are renormalized when an input is missing. */
  weight?: number
  detail: string
}

export type EnvStrategy = {
  key: string
  name: string
  group: string
  asOf: string | null
  score: number | null
  rating: string
  tone: EnvTone
  delta5: number | null
  compareDate: string | null
  history: { date: string; score: number }[]
  headline: string
  factors: EnvFactor[]
  notes: string[]
}

export type StrategyEnvironmentPayload = {
  asOf: string | null
  strategies: EnvStrategy[]
}

export function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function mean(xs: number[]): number {
  if (!xs.length) return 0
  return xs.reduce((sum, value) => sum + value, 0) / xs.length
}

export function variance(xs: number[]): number {
  if (xs.length < 2) return 0
  const center = mean(xs)
  return xs.reduce((sum, value) => sum + (value - center) ** 2, 0) / (xs.length - 1)
}

export function correlation(left: number[], right: number[]): number | null {
  const n = Math.min(left.length, right.length)
  if (n < 8) return null
  const xs = left.slice(0, n)
  const ys = right.slice(0, n)
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const vx = xs[i] - mx
    const vy = ys[i] - my
    num += vx * vy
    dx += vx * vx
    dy += vy * vy
  }
  if (dx < 1e-18 || dy < 1e-18) return null
  return num / Math.sqrt(dx * dy)
}

export function tStatOfCorr(r: number, n: number): number | null {
  if (n < 8 || !(Math.abs(r) < 1)) return null
  return r * Math.sqrt((n - 2) / (1 - r * r))
}

/** Share of `window` that is less than or equal to `value`, on a 0–100 scale. */
export function pctRank(window: number[], value: number): number {
  const xs = window.filter((item) => Number.isFinite(item))
  if (!xs.length || !Number.isFinite(value)) return 50
  let below = 0
  for (const item of xs) if (item <= value) below += 1
  return (below / xs.length) * 100
}

export function weightedScore(parts: Array<{ score: number; weight: number } | null>): number | null {
  const usable = parts.filter(
    (part): part is { score: number; weight: number } =>
      !!part && Number.isFinite(part.score) && part.weight > 0,
  )
  const total = usable.reduce((sum, part) => sum + part.weight, 0)
  if (!usable.length || total <= 0) return null
  return round1(usable.reduce((sum, part) => sum + part.score * part.weight, 0) / total)
}

export function toneOf(score: number | null): EnvTone {
  if (score == null) return "empty"
  if (score >= 64) return "good"
  if (score >= 50) return "mid"
  return "weak"
}

export function bandRating(score: number): string {
  if (score >= 72) return "环境偏好"
  if (score >= 64) return "良（可做）"
  if (score >= 56) return "中性"
  if (score >= 45) return "谨慎"
  return "偏弱"
}

export function deltaPhrase(delta: number | null, compareDate: string | null): string {
  const when = compareDate ? `（${compareDate}）` : ""
  if (delta == null) return "交易日还不够，先不比近 5 日"
  if (Math.abs(delta) < 0.05) return `与 5 个交易日前持平${when}`
  const direction = delta > 0 ? "高" : "低"
  return `比 5 个交易日前${direction} ${Math.abs(delta).toFixed(1)} 分${when}`
}

export function emptyStrategy(key: string, name: string, group: string, why: string): EnvStrategy {
  return {
    key,
    name,
    group,
    asOf: null,
    score: null,
    rating: "暂无数据",
    tone: "empty",
    delta5: null,
    compareDate: null,
    history: [],
    headline: why,
    factors: [],
    notes: [why],
  }
}
