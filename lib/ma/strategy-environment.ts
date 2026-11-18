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
  /** Alpha environment, 10-day average of the daily score. The chart's red line. */
  score: number | null
  /** Same number as `score`. Kept beside the total so the card can show both. */
  alphaScore: number | null
  /** Regression beta of the products' own return against 沪深300. */
  marketBeta: number | null
  /** Signed. Negative when a high beta meets a falling 沪深300. */
  betaScore: number | null
  /** 沪深300 return over the last 10 trading days, in percent. */
  market10d: number | null
  /** Alpha plus beta, clamped to 0–100. This is the number on the card. */
  totalScore: number | null
  totalDelta: number | null
  /** 沪深300 10-day percent return on each history date. */
  market10: Array<number | null>
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

/** Cards and the chart's red line both judge the alpha environment on this window. */
export const ENV_SCORE_WINDOW = 10
/** One point of beta-driven return, in percent, moves the beta score by this many points. */
export const MARKET_BETA_SCALE = 5

/** Mean of the daily scores ending at `end`, same window the chart draws. */
export function smoothedScoreAt(
  history: Array<{ score: number }>,
  end: number,
  window = ENV_SCORE_WINDOW,
): number | null {
  if (end < 0 || end >= history.length) return null
  const start = Math.max(0, end - window + 1)
  let sum = 0
  let count = 0
  for (let i = start; i <= end; i++) {
    const value = history[i]?.score
    if (!Number.isFinite(value)) continue
    sum += value
    count += 1
  }
  if (!count) return null
  return sum / count
}

function ratingForHeadline(key: string, score: number, fallback: string): string {
  if (key === "cta" || key === "swing") return fallback
  if (key === "arb") return score >= 58 ? "环境偏好" : score >= 48 ? "中性" : "机会偏少"
  return bandRating(score)
}

export function betaPoints(beta: number | null | undefined, marketPct: number | null | undefined): number | null {
  if (beta == null || marketPct == null || !Number.isFinite(beta) || !Number.isFinite(marketPct)) return null
  return round1(beta * marketPct * MARKET_BETA_SCALE)
}

export function totalOf(alpha: number, betaScore: number | null): number {
  if (betaScore == null) return alpha
  return round1(clamp(alpha + betaScore))
}

/**
 * The number on the card is the 10-day average of daily scores.
 * Daily scores stay in `history` so the chart does not average them twice.
 */
export function headlineFromHistory(item: {
  key: string
  name: string
  rating: string
  history: Array<{ date: string; score: number }>
  notes: string[]
  marketBeta?: number | null
  market10?: Array<number | null> | null
}): {
  score: number
  alphaScore: number
  betaScore: number | null
  market10d: number | null
  totalScore: number
  totalDelta: number | null
  delta5: number | null
  compareDate: string | null
  tone: EnvTone
  rating: string
  notes: string[]
} | null {
  const history = item.history
  if (!history.length) return null
  const end = history.length - 1
  const raw = smoothedScoreAt(history, end)
  if (raw == null) return null
  const alpha = round1(raw)
  const market10d = item.market10?.[end] ?? null
  const betaScore = betaPoints(item.marketBeta, market10d)
  const total = totalOf(alpha, betaScore)
  const prevIndex = end - 5
  const prevRaw = prevIndex >= 0 ? smoothedScoreAt(history, prevIndex) : null
  const delta5 = prevRaw == null ? null : round1(raw - prevRaw)
  const prevAlpha = prevRaw == null ? null : round1(prevRaw)
  const prevBeta = prevIndex >= 0 ? betaPoints(item.marketBeta, item.market10?.[prevIndex] ?? null) : null
  const totalDelta = prevAlpha == null ? null : round1(total - totalOf(prevAlpha, prevBeta))
  const compareDate = prevIndex >= 0 ? history[prevIndex].date : null
  const betaText = betaScore == null || item.marketBeta == null || market10d == null
    ? ""
    : `β ${betaScore > 0 ? "+" : ""}${betaScore.toFixed(1)}（贝塔 ${item.marketBeta.toFixed(2)} × 近 10 日沪深300 ${market10d > 0 ? "+" : ""}${market10d.toFixed(1)}%）。`
  const lead = betaText
    ? `${item.name} 合计 ${total.toFixed(1)}。α ${alpha.toFixed(1)}（10 日均），${betaText}合计 = α + β，限制在 0 到 100。${deltaPhrase(totalDelta, compareDate)}。`
    : `${item.name} ${alpha.toFixed(1)} 分（10 日均），${deltaPhrase(delta5, compareDate)}。`
  const rest = item.notes[0]?.startsWith(`${item.name} `) ? item.notes.slice(1) : item.notes
  return {
    score: alpha,
    alphaScore: alpha,
    betaScore,
    market10d,
    totalScore: total,
    totalDelta,
    delta5,
    compareDate,
    tone: toneOf(total),
    rating: ratingForHeadline(item.key, total, item.rating),
    notes: [lead, ...rest],
  }
}

export function totalSpark(item: {
  history: Array<{ score: number }>
  marketBeta?: number | null
  market10?: Array<number | null> | null
}, count = 24): number[] {
  const out: number[] = []
  for (let i = 0; i < item.history.length; i++) {
    const raw = smoothedScoreAt(item.history, i)
    if (raw == null) continue
    out.push(totalOf(round1(raw), betaPoints(item.marketBeta, item.market10?.[i] ?? null)))
  }
  return out.slice(-count)
}

export function emptyStrategy(key: string, name: string, group: string, why: string): EnvStrategy {
  return {
    key,
    name,
    group,
    asOf: null,
    score: null,
    alphaScore: null,
    marketBeta: null,
    betaScore: null,
    market10d: null,
    totalScore: null,
    totalDelta: null,
    market10: [],
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
