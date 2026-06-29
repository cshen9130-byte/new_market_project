import { NextResponse } from "next/server"
import { loadFundNavSeries, resolveFundNames } from "@/lib/server/fund-nav-series"

export const dynamic = "force-dynamic"

interface FundInput {
  beian_hao: string
  product_name: string
  min_weight?: number
  max_weight?: number
  expected_return?: number | null
}

type OptimizationGoal = "max-return" | "min-risk" | "max-sharpe" | "max-utility" | "risk-parity"
type OptimizationModel = "mean-variance" | "risk-parity" | "black-litterman"
type RiskPeriod = "6m" | "1y" | "2y" | "3y" | "5y" | "since-inception"

const PERIOD_DAYS: Record<RiskPeriod, number> = {
  "6m": 126,
  "1y": 252,
  "2y": 504,
  "3y": 756,
  "5y": 1260,
  "since-inception": 99999,
}

const SIM_COUNT = 4000

function mean(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stdDev(values: number[]) {
  if (values.length <= 1) return 0
  const m = mean(values)
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(Math.max(variance, 0))
}

function dailyReturns(levels: number[]): number[] {
  const rets: number[] = []
  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1]
    const curr = levels[i]
    if (prev > 0 && curr > 0) rets.push(curr / prev - 1)
  }
  return rets
}

function subtractDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function projectWeights(raw: number[], mins: number[], maxs: number[]): number[] {
  const n = raw.length
  let w = raw.map((x, i) => Math.min(maxs[i], Math.max(mins[i], x)))
  let sum = w.reduce((a, b) => a + b, 0)
  if (sum <= 0) return w.map(() => 1 / n)
  w = w.map((x) => x / sum)

  for (let iter = 0; iter < 24; iter++) {
    let capped = false
    let capSum = 0
    let freeSum = 0
    const next = [...w]
    for (let i = 0; i < n; i++) {
      if (w[i] > maxs[i] + 1e-9) {
        next[i] = maxs[i]
        capped = true
      } else if (w[i] < mins[i] - 1e-9) {
        next[i] = mins[i]
        capped = true
      }
    }
    if (capped) {
      for (let i = 0; i < n; i++) {
        if (next[i] >= maxs[i] - 1e-9 || next[i] <= mins[i] + 1e-9) capSum += next[i]
        else freeSum += w[i]
      }
      w = next.map((wi, i) => {
        if (wi >= maxs[i] - 1e-9 || wi <= mins[i] + 1e-9) return wi
        const remain = Math.max(0, 1 - capSum)
        return freeSum > 0 ? (w[i] / freeSum) * remain : wi
      })
    } else {
      w = next
    }
    sum = w.reduce((a, b) => a + b, 0)
    if (Math.abs(sum - 1) > 1e-6) w = w.map((x) => x / sum)
    if (!capped) break
  }
  return w
}

function scorePortfolio(
  goal: OptimizationGoal,
  portRet: number,
  portVol: number,
  sharpe: number,
  riskFree: number,
) {
  if (goal === "max-return") return portRet
  if (goal === "min-risk") return -portVol
  if (goal === "max-sharpe") return sharpe
  return portRet - 0.5 * portVol ** 2 - riskFree
}

function covTimesW(cov: number[][], w: number[]): number[] {
  const n = cov.length
  const result = Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      result[i] += cov[i][j] * w[j]
    }
  }
  return result
}

function portfolioVol(cov: number[][], w: number[]): number {
  const cw = covTimesW(cov, w)
  let v = 0
  for (let i = 0; i < w.length; i++) v += w[i] * cw[i]
  return Math.sqrt(Math.max(v, 0))
}

function marginalRiskContributions(cov: number[][], w: number[]): number[] {
  const cw = covTimesW(cov, w)
  const vol = portfolioVol(cov, w)
  if (vol <= 0) return w.map(() => 0)
  return w.map((wi, i) => (wi * cw[i]) / vol)
}

function riskParityWeights(cov: number[][], mins: number[], maxs: number[]): number[] {
  const n = cov.length
  const vols = cov.map((row, i) => Math.sqrt(Math.max(row[i], 1e-12)))
  let w = projectWeights(vols.map((v) => 1 / v), mins, maxs)

  for (let iter = 0; iter < 200; iter++) {
    const rc = marginalRiskContributions(cov, w)
    const target = mean(rc)
    if (target <= 0) break
    let maxDiff = 0
    const next = w.map((wi, i) => {
      maxDiff = Math.max(maxDiff, Math.abs(rc[i] - target))
      return wi * (target / Math.max(rc[i], 1e-12))
    })
    w = projectWeights(next, mins, maxs)
    if (maxDiff < 1e-8) break
  }
  return w
}

function riskContributionPercents(cov: number[][], w: number[]): number[] {
  const rc = marginalRiskContributions(cov, w)
  const total = rc.reduce((a, b) => a + b, 0)
  if (total <= 0) return w.map(() => 0)
  return rc.map((v) => (v / total) * 100)
}

function blackLittermanPosteriorReturns(
  equilibrium: number[],
  views: (number | null | undefined)[],
  tau = 0.6,
): number[] {
  return equilibrium.map((pi, i) => {
    const view = views[i]
    if (view == null || !Number.isFinite(view)) return pi
    return (1 - tau) * pi + tau * view
  })
}

function optimizeMeanVariance(
  annualReturns: number[],
  annualVols: number[],
  cov: number[][],
  mins: number[],
  maxs: number[],
  goal: OptimizationGoal,
  riskFree: number,
): { bestWeights: number[]; frontier: { vol: number; ret: number }[] } {
  const N = annualReturns.length
  const simPoints: { vol: number; ret: number }[] = []
  let bestScore = -Infinity
  let bestWeights = Array(N).fill(0).map((_, i) => (i === 0 ? 1 : 0))

  for (let i = 0; i < N; i++) {
    simPoints.push({ vol: annualVols[i], ret: annualReturns[i] })
  }

  for (let s = 0; s < SIM_COUNT; s++) {
    const raw = Array.from({ length: N }, () => -Math.log(Math.random() + 1e-15))
    const sumRaw = raw.reduce((a, b) => a + b, 0)
    const w = projectWeights(raw.map((x) => x / sumRaw), mins, maxs)

    const portRet = w.reduce((acc, wi, i) => acc + wi * annualReturns[i], 0)
    let portVar = 0
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        portVar += w[i] * w[j] * cov[i][j]
      }
    }
    const portVol = Math.sqrt(Math.max(portVar, 0)) * 100
    simPoints.push({ vol: Math.round(portVol * 100) / 100, ret: Math.round(portRet * 100) / 100 })

    const sharpe = portVol > 0 ? (portRet / 100 - riskFree) / (portVol / 100) : -Infinity
    const score = scorePortfolio(goal, portRet, portVol, sharpe, riskFree)
    if (score > bestScore) {
      bestScore = score
      bestWeights = [...w]
    }
  }

  const volValues = simPoints.map((p) => p.vol)
  const minVol = Math.min(...volValues)
  const maxVol = Math.max(...volValues)
  const BIN_COUNT = 50
  const binWidth = (maxVol - minVol) / BIN_COUNT || 1
  const bins: (number | null)[] = Array(BIN_COUNT).fill(null)

  for (const p of simPoints) {
    const bin = Math.min(Math.floor((p.vol - minVol) / binWidth), BIN_COUNT - 1)
    if (bins[bin] === null || p.ret > (bins[bin] as number)) {
      bins[bin] = p.ret
    }
  }

  let peak = -Infinity
  const frontier: { vol: number; ret: number }[] = []
  for (let i = 0; i < BIN_COUNT; i++) {
    if (bins[i] !== null) {
      const pt = {
        vol: Math.round((minVol + (i + 0.5) * binWidth) * 100) / 100,
        ret: Math.round((bins[i] as number) * 100) / 100,
      }
      if (pt.ret >= peak) {
        peak = pt.ret
        frontier.push(pt)
      }
    }
  }

  return { bestWeights, frontier }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      funds?: FundInput[]
      period?: RiskPeriod
      goal?: OptimizationGoal
      model?: OptimizationModel
      risk_free_rate?: number
      cash_ratio?: number
      as_of?: string
    }

    const funds = body.funds ?? []
    if (funds.length === 0) {
      return NextResponse.json({ error: "missing funds" }, { status: 400 })
    }

    const period = body.period ?? "6m"
    const model = body.model ?? "mean-variance"
    const goal = body.goal ?? "max-return"
    const riskFreePct = body.risk_free_rate ?? 0
    const riskFree = riskFreePct / 100
    const asOf = (body.as_of ?? new Date().toISOString().slice(0, 10)).slice(0, 10)
    const lookbackDays = PERIOD_DAYS[period] ?? 126
    const from = subtractDays(asOf, Math.ceil(lookbackDays * 1.5))

    const returnsMatrix: number[][] = []
    const fundKeys: string[] = []

    for (const fund of funds) {
      const names = await resolveFundNames(fund.beian_hao, fund.product_name)
      const navRows = await loadFundNavSeries(
        fund.beian_hao,
        names.product_name,
        names.short_name,
        { from, to: asOf },
      )
      const levels = navRows
        .map((r) => parseFloat(r.level))
        .filter((v) => Number.isFinite(v) && v > 0)
      const rets = dailyReturns(levels).slice(-lookbackDays)
      if (rets.length < 20) {
        return NextResponse.json(
          { error: `基金 ${fund.product_name} 净值数据不足，无法优化` },
          { status: 400 },
        )
      }
      returnsMatrix.push(rets)
      fundKeys.push(fund.beian_hao)
    }

    const T = Math.min(...returnsMatrix.map((r) => r.length))
    const aligned = returnsMatrix.map((r) => r.slice(r.length - T))
    const N = aligned.length

    const annualReturns = aligned.map((r) => mean(r) * 252 * 100)
    const annualVols = aligned.map((r) => stdDev(r) * Math.sqrt(252) * 100)

    const means = aligned.map(mean)
    const cov: number[][] = Array.from({ length: N }, () => Array(N).fill(0))
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        let c = 0
        for (let t = 0; t < T; t++) {
          c += (aligned[i][t] - means[i]) * (aligned[j][t] - means[j])
        }
        cov[i][j] = (c / Math.max(T - 1, 1)) * 252
      }
    }

    const mins = funds.map((f) => (f.min_weight ?? 0) / 100)
    const maxs = funds.map((f) => (f.max_weight ?? 100) / 100)

    const periodFrom = subtractDays(asOf, T)
    const periodTo = asOf

    let bestWeights: number[]
    let frontier: { vol: number; ret: number }[] = []
    let returnsForOpt = annualReturns

    if (model === "risk-parity") {
      bestWeights = riskParityWeights(cov, mins, maxs)
    } else {
      if (model === "black-litterman") {
        returnsForOpt = blackLittermanPosteriorReturns(
          annualReturns,
          funds.map((f) => f.expected_return ?? null),
        )
      }
      const result = optimizeMeanVariance(
        returnsForOpt,
        annualVols,
        cov,
        mins,
        maxs,
        goal,
        riskFree,
      )
      bestWeights = result.bestWeights
      frontier = result.frontier
    }

    const rcPcts = riskContributionPercents(cov, bestWeights)

    const optRet = bestWeights.reduce((acc, wi, i) => acc + wi * returnsForOpt[i], 0)
    let optVar = 0
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        optVar += bestWeights[i] * bestWeights[j] * cov[i][j]
      }
    }
    const optVol = Math.sqrt(Math.max(optVar, 0)) * 100
    const optSharpe = optVol > 0 ? (optRet / 100 - riskFree) / (optVol / 100) : 0

    const investablePct = Math.max(0, 100 - (body.cash_ratio ?? 0))
    const weights = fundKeys.map((beian_hao, i) => ({
      beian_hao,
      weight: Math.round(bestWeights[i] * investablePct * 100) / 100,
    }))

    const weightSum = weights.reduce((s, w) => s + w.weight, 0)
    if (weights.length > 0 && Math.abs(weightSum - investablePct) > 0.05) {
      const adjust = investablePct - weightSum
      weights[weights.length - 1].weight = Math.round((weights[weights.length - 1].weight + adjust) * 100) / 100
    }

    return NextResponse.json({
      weights,
      frontier,
      periodFrom,
      periodTo,
      riskContributions: fundKeys.map((beian_hao, i) => ({
        beian_hao,
        pct: Math.round(rcPcts[i] * 100) / 100,
      })),
      fundPoints: annualReturns.map((ret, i) => ({
        beian_hao: fundKeys[i],
        vol: Math.round(annualVols[i] * 100) / 100,
        ret: Math.round(ret * 100) / 100,
      })),
      portfolio: {
        vol: Math.round(optVol * 100) / 100,
        ret: Math.round(optRet * 100) / 100,
        sharpe: Math.round(optSharpe * 100) / 100,
      },
    })
  } catch (err) {
    console.error("[portfolio/optimize]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "优化失败" },
      { status: 500 },
    )
  }
}
