import type { TimeframeId } from "@/lib/client/timeframes"

const GK_OPEN_CLOSE = 2 * Math.log(2) - 1

/** How many bars of this size make one year. Intraday uses the session's bar count times 252. */
export function volPeriodsPerYear(interval: TimeframeId, sessionBars: number) {
  if (interval === "1d") return 252
  if (interval === "1w") return 52
  if (interval === "1M") return 12
  return Math.max(1, sessionBars) * 252
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

/** Multiplier that puts `source` on the same level as `reference` over their overlap. */
export function levelScaleFactor(reference: Array<number | null>, source: Array<number | null>) {
  const ref: number[] = []
  const src: number[] = []
  const n = Math.min(reference.length, source.length)
  for (let i = 0; i < n; i += 1) {
    const left = reference[i]
    const right = source[i]
    if (left == null || right == null || !(right > 0) || !Number.isFinite(left) || !Number.isFinite(right)) continue
    ref.push(left)
    src.push(right)
  }
  if (ref.length < 5) return null
  const factor = median(ref) / median(src)
  return Number.isFinite(factor) && factor > 0 ? factor : null
}

/** Garman–Klass of each bar, annualized and keyed by `bucket(time)`, so it can share an implied-vol axis. */
export function annualizedGarmanKlassByTime(
  bars: Array<OhlcBar & { time: number }>,
  period: number,
  periodsPerYear: number,
  bucket: (time: number) => number,
) {
  const factor = Math.sqrt(Math.max(periodsPerYear, 1))
  const values = rollingGarmanKlass(bars, period)
  const out = new Map<number, number>()
  for (let i = 0; i < bars.length; i += 1) {
    const value = values[i]
    if (value == null) continue
    out.set(bucket(bars[i]!.time), value * factor)
  }
  return out
}

export type OhlcBar = { open: number; high: number; low: number; close: number }

/** Garman–Klass volatility of the last `period` bars, in percent of one bar. Uses open, high, low, and close. A negative window average is floored at 0. */
export function rollingGarmanKlass(bars: OhlcBar[], period: number): Array<number | null> {
  const window = Math.max(2, Math.floor(period))
  const out: Array<number | null> = new Array(bars.length).fill(null)
  for (let i = window - 1; i < bars.length; i += 1) {
    let sum = 0
    let ok = true
    for (let j = i - window + 1; j <= i; j += 1) {
      const bar = bars[j]
      if (!bar || !(bar.high > 0) || !(bar.low > 0) || !(bar.open > 0) || !(bar.close > 0) || bar.high < bar.low) {
        ok = false
        break
      }
      const range = Math.log(bar.high / bar.low)
      const body = Math.log(bar.close / bar.open)
      sum += 0.5 * range * range - GK_OPEN_CLOSE * body * body
    }
    if (!ok) continue
    out[i] = Math.sqrt(Math.max(sum / window, 0)) * 100
  }
  return out
}

/** Sample standard deviation of the last `period` log returns, in percent. Needs `period` returns, so the first value lands on the following candle. */
export function rollingLogVolatility(closes: number[], period: number): Array<number | null> {
  const window = Math.max(2, Math.floor(period))
  const out: Array<number | null> = new Array(closes.length).fill(null)
  for (let i = window; i < closes.length; i += 1) {
    let mean = 0
    const rets: number[] = []
    let ok = true
    for (let j = i - window + 1; j <= i; j += 1) {
      const prev = closes[j - 1]
      const cur = closes[j]
      if (!(prev > 0) || !(cur > 0)) {
        ok = false
        break
      }
      const ret = Math.log(cur / prev)
      rets.push(ret)
      mean += ret
    }
    if (!ok || rets.length !== window) continue
    mean /= window
    let sumSq = 0
    for (const ret of rets) sumSq += (ret - mean) ** 2
    out[i] = Math.sqrt(sumSq / (window - 1)) * 100
  }
  return out
}
