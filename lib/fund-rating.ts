import {
  computeFundNavMetrics,
  metricRank,
  type FundNavMetrics,
  type MetricKey,
} from "@/lib/fund-nav-metrics"

export type ScoreLevel = "优秀" | "良好" | "中等" | "较差"

export interface RatingPeriodRow {
  periodKey: string
  periodLabel: string
  totalScore: number | null
  totalRank: number | null
  totalOutperformPct: number | null
  returnScore: number | null
  returnRank: number | null
  returnOutperformPct: number | null
  defenseScore: number | null
  defenseRank: number | null
  defenseOutperformPct: number | null
  riskAdjustedScore: number | null
  riskAdjustedRank: number | null
  riskAdjustedOutperformPct: number | null
  sampleN: number
}

export interface RatingMetricDetail {
  key: MetricKey
  label: string
  value: number | null
  displayValue: string
  rank: number | null
  score: number | null
  level: ScoreLevel | null
  vsBenchmark: "better" | "worse" | null
}

export interface RatingPeriodAnalysis {
  periodKey: string
  periodLabel: string
  totalScore: number | null
  totalOutperformPct: number | null
  returnScore: number | null
  defenseScore: number | null
  riskAdjustedScore: number | null
  returnLevel: ScoreLevel | null
  defenseLevel: ScoreLevel | null
  riskAdjustedLevel: ScoreLevel | null
  returnMetrics: RatingMetricDetail[]
  defenseMetrics: RatingMetricDetail[]
  riskAdjustedMetrics: RatingMetricDetail[]
}

export interface FundRatingResult {
  cutoffDate: string
  ratingModel: string
  sampleGroup: string | null
  navSource: string
  benchmarkLabel: string | null
  rows: RatingPeriodRow[]
  analyses: RatingPeriodAnalysis[]
}

export const TOTAL_DIMENSION_WEIGHTS = {
  return: 0.4,
  defense: 0.3,
  riskAdjusted: 0.3,
} as const

export const DIMENSION_COLORS = {
  return: "#ef4444",
  defense: "#3b82f6",
  riskAdjusted: "#f97316",
} as const

export interface RatingDimensionContribution {
  key: keyof typeof TOTAL_DIMENSION_WEIGHTS
  label: string
  color: string
  score: number | null
  weight: number
  contributionValue: number | null
  contributionPct: number | null
}

export function computeDimensionContributions(row: RatingPeriodRow): RatingDimensionContribution[] {
  const dims: Array<{
    key: keyof typeof TOTAL_DIMENSION_WEIGHTS
    label: string
    score: number | null
  }> = [
    { key: "return", label: "收益能力", score: row.returnScore },
    { key: "defense", label: "防守能力", score: row.defenseScore },
    { key: "riskAdjusted", label: "风险调整收益", score: row.riskAdjustedScore },
  ]

  const total = row.totalScore

  return dims.map(({ key, label, score }) => {
    const weight = TOTAL_DIMENSION_WEIGHTS[key]
    const contributionValue =
      score !== null && Number.isFinite(score) ? +(score * weight).toFixed(2) : null
    const contributionPct =
      contributionValue !== null && total !== null && total > 0
        ? +((contributionValue / total) * 100).toFixed(2)
        : null
    return {
      key,
      label,
      color: DIMENSION_COLORS[key],
      score,
      weight,
      contributionValue,
      contributionPct,
    }
  })
}

const RETURN_METRICS: Array<{ key: MetricKey; weight: number; higherIsBetter: boolean }> = [
  { key: "periodRet", weight: 0.35, higherIsBetter: true },
  { key: "sharpe", weight: 0.35, higherIsBetter: true },
  { key: "calmar", weight: 0.25, higherIsBetter: true },
  { key: "sortino", weight: 0.05, higherIsBetter: true },
]

const DEFENSE_METRICS: Array<{ key: MetricKey; weight: number; higherIsBetter: boolean }> = [
  { key: "maxDD", weight: 0.35, higherIsBetter: false },
  { key: "annVol", weight: 0.25, higherIsBetter: false },
  { key: "downsideRisk", weight: 0.2, higherIsBetter: false },
  { key: "sortino", weight: 0.2, higherIsBetter: true },
]

const RISK_ADJUSTED_METRICS: Array<{ key: MetricKey; weight: number; higherIsBetter: boolean }> = [
  { key: "calmar", weight: 0.5, higherIsBetter: true },
  { key: "sharpe", weight: 0.35, higherIsBetter: true },
  { key: "sortino", weight: 0.15, higherIsBetter: true },
]

const METRIC_LABELS: Partial<Record<MetricKey, string>> = {
  periodRet: "收益率",
  maxDD: "最大回撤",
  annVol: "年化波动率",
  calmar: "卡玛比率",
  sharpe: "夏普比率",
  sortino: "索提诺比率",
}

export type PeriodSpec =
  | { type: "days"; key: string; label: string; days: number }
  | { type: "year"; key: string; label: string; year: number }
  | { type: "ytd"; key: string; label: string }

export function buildDefaultPeriodSpecs(cutoffDate: string): PeriodSpec[] {
  const cutoffYear = parseInt(cutoffDate.slice(0, 4), 10)
  const specs: PeriodSpec[] = [
    { type: "days", key: "3m", label: "近三月", days: 91 },
    { type: "days", key: "6m", label: "近六月", days: 182 },
    { type: "days", key: "1y", label: "近一年", days: 365 },
  ]
  if (cutoffYear > 2000) {
    specs.push({ type: "year", key: `y${cutoffYear - 1}`, label: `${cutoffYear - 1}年度`, year: cutoffYear - 1 })
  }
  specs.push({ type: "ytd", key: "ytd", label: "今年以来" })
  return specs
}

export function deriveRatingModelName(strategy: string | null): string {
  if (!strategy) return "综合评分模型"
  if (strategy.includes("期货")) return "期货策略评分模型"
  if (strategy.includes("股票") || strategy.includes("权益")) return "股票策略评分模型"
  if (strategy.includes("债券") || strategy.includes("固收")) return "固收策略评分模型"
  return `${strategy}评分模型`
}

function sliceNavRows(
  rows: Array<{ price_date: string; nav: number }>,
  cutoff: string,
  spec: PeriodSpec,
): { dates: string[]; values: number[] } | null {
  const upToCutoff = rows.filter((r) => r.price_date <= cutoff)
  if (upToCutoff.length < 2) return null

  let slice = upToCutoff
  if (spec.type === "days") {
    const start = new Date(cutoff)
    start.setDate(start.getDate() - spec.days)
    const startStr = start.toISOString().slice(0, 10)
    slice = upToCutoff.filter((r) => r.price_date >= startStr)
  } else if (spec.type === "year") {
    slice = upToCutoff.filter((r) => r.price_date.startsWith(String(spec.year)))
  } else if (spec.type === "ytd") {
    const year = cutoff.slice(0, 4)
    slice = upToCutoff.filter((r) => r.price_date >= `${year}-01-01`)
  }

  if (slice.length < 2) return null
  return {
    dates: slice.map((r) => r.price_date),
    values: slice.map((r) => r.nav),
  }
}


function outperformPct(rank: number, sampleN: number): number {
  if (sampleN <= 0) return 0
  return +(((sampleN - rank) / sampleN) * 100).toFixed(2)
}

export function scoreLevel(score: number | null): ScoreLevel | null {
  if (score === null || !Number.isFinite(score)) return null
  if (score >= 80) return "优秀"
  if (score >= 55) return "中等"
  return "较差"
}

function metricScoreFromRank(rank: number, sampleN: number): number {
  return +(((sampleN - rank + 1) / sampleN) * 100).toFixed(2)
}

function formatMetricValue(key: MetricKey, value: number): string {
  if (key === "periodRet" || key === "maxDD" || key === "annVol" || key === "downsideRisk") {
    return `${(value * 100).toFixed(2)}%`
  }
  return value.toFixed(4)
}

function compareToBenchmark(
  key: MetricKey,
  fundVal: number,
  benchVal: number | null | undefined,
  higherIsBetter: boolean,
): "better" | "worse" | null {
  if (benchVal === null || benchVal === undefined || !isFinite(benchVal)) return null
  if (fundVal === benchVal) return null
  const fundBetter = higherIsBetter ? fundVal > benchVal : fundVal < benchVal
  return fundBetter ? "better" : "worse"
}

function buildMetricDetail(
  key: MetricKey,
  label: string,
  fundMetrics: FundNavMetrics,
  peerMetrics: FundNavMetrics[],
  higherIsBetter: boolean,
  benchMetrics: FundNavMetrics | null,
): RatingMetricDetail {
  const fundVal = fundMetrics[key]
  if (fundVal === null || fundVal === undefined || !isFinite(fundVal as number)) {
    return {
      key,
      label,
      value: null,
      displayValue: "—",
      rank: null,
      score: null,
      level: null,
      vsBenchmark: null,
    }
  }

  const peers = peerMetrics
    .map((m) => m[key])
    .filter((v): v is number => v !== null && v !== undefined && isFinite(v as number)) as number[]

  let rank: number | null = null
  let score: number | null = null
  if (peers.length >= 2) {
    rank = metricRank(fundVal as number, peers, higherIsBetter)
    score = metricScoreFromRank(rank, peers.length)
  }

  const benchVal = benchMetrics?.[key]
  return {
    key,
    label,
    value: fundVal as number,
    displayValue: formatMetricValue(key, fundVal as number),
    rank,
    score,
    level: scoreLevel(score),
    vsBenchmark: compareToBenchmark(key, fundVal as number, benchVal as number | null, higherIsBetter),
  }
}

function weightedComposite(
  metrics: FundNavMetrics,
  defs: Array<{ key: MetricKey; weight: number; higherIsBetter: boolean }>,
  peerMetrics: FundNavMetrics[],
): number | null {
  let totalWeight = 0
  let sum = 0

  for (const def of defs) {
    const fundVal = metrics[def.key]
    if (fundVal === null || fundVal === undefined || !isFinite(fundVal as number)) continue

    const peers = peerMetrics
      .map((m) => m[def.key])
      .filter((v): v is number => v !== null && v !== undefined && isFinite(v as number)) as number[]
    if (peers.length < 2) continue

    const rank = metricRank(fundVal as number, peers, def.higherIsBetter)
    const percentile = (peers.length - rank + 1) / peers.length
    sum += percentile * def.weight
    totalWeight += def.weight
  }

  if (totalWeight <= 0) return null
  return sum / totalWeight
}

function rankComposite(
  fundComposite: number,
  peerComposites: number[],
  higherIsBetter = true,
): { rank: number; sampleN: number } {
  const valid = peerComposites.filter((v) => isFinite(v))
  const sampleN = valid.length
  if (sampleN < 2) return { rank: 1, sampleN }
  const rank = metricRank(fundComposite, valid, higherIsBetter)
  return { rank, sampleN }
}

function dimensionRating(
  fundMetrics: FundNavMetrics,
  peerMetrics: FundNavMetrics[],
  defs: Array<{ key: MetricKey; weight: number; higherIsBetter: boolean }>,
): {
  score: number | null
  rank: number | null
  outperformPct: number | null
  sampleN: number
} {
  const fundComposite = weightedComposite(fundMetrics, defs, peerMetrics)
  if (fundComposite === null) return { score: null, rank: null, outperformPct: null, sampleN: 0 }

  const peerComposites = peerMetrics
    .map((m) => weightedComposite(m, defs, peerMetrics))
    .filter((v): v is number => v !== null && isFinite(v))

  const { rank, sampleN } = rankComposite(fundComposite, peerComposites, true)
  if (sampleN < 2) {
    return { score: +(fundComposite * 100).toFixed(2), rank: null, outperformPct: null, sampleN }
  }

  return {
    score: +((fundComposite) * 100).toFixed(2),
    rank,
    outperformPct: outperformPct(rank, sampleN),
    sampleN,
  }
}

export function computePeriodRating(
  fundRows: Array<{ price_date: string; nav: number }>,
  peerRowsByFund: Map<string, Array<{ price_date: string; nav: number }>>,
  cutoffDate: string,
  spec: PeriodSpec,
): RatingPeriodRow | null {
  const fundSlice = sliceNavRows(fundRows, cutoffDate, spec)
  if (!fundSlice) return null

  const fundMetrics = computeFundNavMetrics(fundSlice)
  if (!fundMetrics) return null

  const peerMetrics: FundNavMetrics[] = []
  for (const [, rows] of peerRowsByFund) {
    const slice = sliceNavRows(rows, cutoffDate, spec)
    if (!slice) continue
    const metrics = computeFundNavMetrics(slice)
    if (metrics) peerMetrics.push(metrics)
  }

  if (peerMetrics.length < 2) {
    return {
      periodKey: spec.key,
      periodLabel: spec.label,
      totalScore: null,
      totalRank: null,
      totalOutperformPct: null,
      returnScore: null,
      returnRank: null,
      returnOutperformPct: null,
      defenseScore: null,
      defenseRank: null,
      defenseOutperformPct: null,
      riskAdjustedScore: null,
      riskAdjustedRank: null,
      riskAdjustedOutperformPct: null,
      sampleN: peerMetrics.length,
    }
  }

  const ret = dimensionRating(fundMetrics, peerMetrics, RETURN_METRICS)
  const def = dimensionRating(fundMetrics, peerMetrics, DEFENSE_METRICS)
  const risk = dimensionRating(fundMetrics, peerMetrics, RISK_ADJUSTED_METRICS)

  const totalComposite =
    ret.score !== null && def.score !== null && risk.score !== null
      ? (
        ret.score * TOTAL_DIMENSION_WEIGHTS.return
        + def.score * TOTAL_DIMENSION_WEIGHTS.defense
        + risk.score * TOTAL_DIMENSION_WEIGHTS.riskAdjusted
      )
      : ret.score ?? def.score ?? risk.score

  const peerTotalComposites = peerMetrics
    .map((m) => {
      const r = dimensionRating(m, peerMetrics, RETURN_METRICS)
      const d = dimensionRating(m, peerMetrics, DEFENSE_METRICS)
      const k = dimensionRating(m, peerMetrics, RISK_ADJUSTED_METRICS)
      const parts = [r.score, d.score, k.score].filter((v): v is number => v !== null && isFinite(v))
      if (!parts.length) return null
      if (parts.length === 3) {
        return (
          r.score! * TOTAL_DIMENSION_WEIGHTS.return
          + d.score! * TOTAL_DIMENSION_WEIGHTS.defense
          + k.score! * TOTAL_DIMENSION_WEIGHTS.riskAdjusted
        )
      }
      return parts.reduce((s, v) => s + v, 0) / parts.length
    })
    .filter((v): v is number => v !== null && isFinite(v))

  let totalRank: number | null = null
  let totalOutperformPct: number | null = null
  let sampleN = Math.max(ret.sampleN, def.sampleN, risk.sampleN)

  if (totalComposite !== null && peerTotalComposites.length >= 2) {
    const ranked = rankComposite(totalComposite, peerTotalComposites, true)
    totalRank = ranked.rank
    sampleN = ranked.sampleN
    totalOutperformPct = outperformPct(ranked.rank, ranked.sampleN)
  }

  return {
    periodKey: spec.key,
    periodLabel: spec.label,
    totalScore: totalComposite !== null ? +totalComposite.toFixed(2) : null,
    totalRank,
    totalOutperformPct,
    returnScore: ret.score,
    returnRank: ret.rank,
    returnOutperformPct: ret.outperformPct,
    defenseScore: def.score,
    defenseRank: def.rank,
    defenseOutperformPct: def.outperformPct,
    riskAdjustedScore: risk.score,
    riskAdjustedRank: risk.rank,
    riskAdjustedOutperformPct: risk.outperformPct,
    sampleN,
  }
}

export function computePeriodAnalysis(
  fundRows: Array<{ price_date: string; nav: number }>,
  peerRowsByFund: Map<string, Array<{ price_date: string; nav: number }>>,
  cutoffDate: string,
  spec: PeriodSpec,
  benchRows: Array<{ price_date: string; nav: number }> | null,
  row: RatingPeriodRow | null,
): RatingPeriodAnalysis | null {
  if (!row) return null

  const fundSlice = sliceNavRows(fundRows, cutoffDate, spec)
  if (!fundSlice) return null
  const fundMetrics = computeFundNavMetrics(fundSlice)
  if (!fundMetrics) return null

  const peerMetrics: FundNavMetrics[] = []
  for (const [, rows] of peerRowsByFund) {
    const slice = sliceNavRows(rows, cutoffDate, spec)
    if (!slice) continue
    const metrics = computeFundNavMetrics(slice)
    if (metrics) peerMetrics.push(metrics)
  }

  let benchMetrics: FundNavMetrics | null = null
  if (benchRows?.length) {
    const benchSlice = sliceNavRows(benchRows, cutoffDate, spec)
    if (benchSlice) benchMetrics = computeFundNavMetrics(benchSlice)
  }

  return {
    periodKey: spec.key,
    periodLabel: spec.label,
    totalScore: row.totalScore,
    totalOutperformPct: row.totalOutperformPct,
    returnScore: row.returnScore,
    defenseScore: row.defenseScore,
    riskAdjustedScore: row.riskAdjustedScore,
    returnLevel: scoreLevel(row.returnScore),
    defenseLevel: scoreLevel(row.defenseScore),
    riskAdjustedLevel: scoreLevel(row.riskAdjustedScore),
    returnMetrics: [
      buildMetricDetail("periodRet", METRIC_LABELS.periodRet ?? "收益率", fundMetrics, peerMetrics, true, benchMetrics),
    ],
    defenseMetrics: [
      buildMetricDetail("maxDD", METRIC_LABELS.maxDD ?? "最大回撤", fundMetrics, peerMetrics, false, benchMetrics),
      buildMetricDetail("annVol", METRIC_LABELS.annVol ?? "年化波动率", fundMetrics, peerMetrics, false, benchMetrics),
    ],
    riskAdjustedMetrics: [
      buildMetricDetail("calmar", METRIC_LABELS.calmar ?? "卡玛比率", fundMetrics, peerMetrics, true, benchMetrics),
    ],
  }
}

export function computeFundRating(
  fundRows: Array<{ price_date: string; nav: number }>,
  peerRowsByFund: Map<string, Array<{ price_date: string; nav: number }>>,
  cutoffDate: string,
  options: {
    ratingModel: string
    sampleGroup: string | null
    navSource: string
    benchmarkLabel?: string | null
    benchRows?: Array<{ price_date: string; nav: number }> | null
    periodSpecs?: PeriodSpec[]
  },
): FundRatingResult {
  const specs = options.periodSpecs ?? buildDefaultPeriodSpecs(cutoffDate)
  const rows = specs
    .map((spec) => computePeriodRating(fundRows, peerRowsByFund, cutoffDate, spec))
    .filter((row): row is RatingPeriodRow => row !== null)

  const analyses = specs
    .map((spec) => {
      const row = rows.find((r) => r.periodKey === spec.key) ?? null
      return computePeriodAnalysis(
        fundRows,
        peerRowsByFund,
        cutoffDate,
        spec,
        options.benchRows ?? null,
        row,
      )
    })
    .filter((a): a is RatingPeriodAnalysis => a !== null)

  return {
    cutoffDate,
    ratingModel: options.ratingModel,
    sampleGroup: options.sampleGroup,
    navSource: options.navSource,
    benchmarkLabel: options.benchmarkLabel ?? null,
    rows,
    analyses,
  }
}
