import {
  buildFundScatterPoints,
  type WinRateGranularity,
} from "@/lib/fund-compare-win-rate"
import type { NavPoint } from "@/lib/fund-compare-period-returns"

export interface ConditionalProbabilityStats {
  totalPeriods: number
  benchUpFundUp: number
  benchUpFundDown: number
  benchDownFundUp: number
  benchDownFundDown: number
}

export function computeConditionalProbabilities(
  fundReturns: number[],
  benchReturns: number[],
): ConditionalProbabilityStats | null {
  if (fundReturns.length !== benchReturns.length) return null
  let total = 0
  let benchUp = 0
  let benchDown = 0
  let uu = 0
  let ud = 0
  let du = 0
  let dd = 0

  for (let i = 0; i < fundReturns.length; i++) {
    const b = benchReturns[i]
    const f = fundReturns[i]
    if (!Number.isFinite(f) || !Number.isFinite(b)) continue
    if (b === 0 && f === 0) continue
    total += 1
    const bUp = b > 0
    const bDown = b < 0
    const fUp = f > 0
    const fDown = f < 0
    if (bUp) {
      benchUp += 1
      if (fUp) uu += 1
      else if (fDown) ud += 1
    } else if (bDown) {
      benchDown += 1
      if (fUp) du += 1
      else if (fDown) dd += 1
    }
  }

  if (total === 0) return null
  return {
    totalPeriods: total,
    benchUpFundUp: benchUp > 0 ? (uu / benchUp) * 100 : 0,
    benchUpFundDown: benchUp > 0 ? (ud / benchUp) * 100 : 0,
    benchDownFundUp: benchDown > 0 ? (du / benchDown) * 100 : 0,
    benchDownFundDown: benchDown > 0 ? (dd / benchDown) * 100 : 0,
  }
}

export function buildFundConditionalProb(
  fundNavPoints: NavPoint[],
  benchNavPoints: NavPoint[],
  gran: WinRateGranularity,
  from: string,
  to: string,
): ConditionalProbabilityStats | null {
  const points = buildFundScatterPoints(fundNavPoints, benchNavPoints, gran, from, to, false)
  if (!points.length) return null
  return computeConditionalProbabilities(
    points.map((p) => p.fund),
    points.map((p) => p.bench),
  )
}

export function fmtConditionalPct(v: number): string {
  return `${v.toFixed(2)}%`
}
