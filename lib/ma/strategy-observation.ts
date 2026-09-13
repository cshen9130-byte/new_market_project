export type ReturnGranularity = "week" | "month" | "quarter" | "half" | "year" | "phase"

export const STRATEGY_OBSERVATION_CATEGORIES = [
  "股票市场中性",
  "1000指增",
  "500指增",
  "300指增",
  "A500指增",
  "量化选股",
  "主观多头",
  "量化期货",
  "主观期货",
  "套利策略",
  "股票对冲",
  "股票多头",
  "期权策略",
  "多资产策略",
  "债券策略",
  "组合策略",
  "可转债多头",
] as const

export const STRATEGY_OBSERVATION_TABLE_CATEGORIES = [
  "股票市场中性",
  "1000指增",
  "500指增",
  "300指增",
  "A500指增",
  "量化选股",
  "主观多头",
  "量化精选",
  "主观精选",
  "期货策略",
  "股票对冲",
  "股票多头",
  "套利策略",
  "期权策略",
  "多资产策略",
  "债券策略",
  "组合策略",
  "可转债多头",
] as const

export const STRATEGY_OBSERVATION_ALL_CATEGORIES = Array.from(
  new Set([...STRATEGY_OBSERVATION_CATEGORIES, ...STRATEGY_OBSERVATION_TABLE_CATEGORIES, "量化多头"]),
)

export type StrategyObservationCategory = (typeof STRATEGY_OBSERVATION_ALL_CATEGORIES)[number]

export type StrategyObservationLabels = {
  l1: string
  l2: string
  l3: string
  name: string
}

export type StrategyObservationSeries = {
  values: Array<number | null>
  excessValues: Array<number | null>
  yearRet: number | null
  excessYearRet: number | null
  winRate: number | null
  excessWinRate: number | null
  sampleN: number
}

export type StrategyObservationDistParams = {
  mean: number
  std: number
  n: number
}

export type StrategyObservationDistribution = {
  current: StrategyObservationDistParams | null
  previous: StrategyObservationDistParams | null
  excessCurrent: StrategyObservationDistParams | null
  excessPrevious: StrategyObservationDistParams | null
}

export type StrategyObservationIndicatorRow = {
  category: string
  sampleSize: number
  average: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  positiveRatio: number
}

export type StrategyObservationIndicatorTab = "return" | "sharpe" | "maxdd" | "vol" | "calmar"

export type StrategyObservationResponse = {
  year: number
  granularity: ReturnGranularity
  cutoff: string
  fundCount: number
  periodKeys: string[]
  series: Record<string, StrategyObservationSeries>
  distributions: Record<string, StrategyObservationDistribution>
  indicators: Record<StrategyObservationIndicatorTab, StrategyObservationIndicatorRow[]>
}

const INDEX_ENHANCE_TAGS: Record<string, RegExp> = {
  "1000指增": /1000指增|中证1000(?:指增|指数增强)|1000增强/,
  "500指增": /(?<![A1])500指增|(?<!中证[A1])中证500(?:指增|指数增强)|(?<![A1])500增强/,
  "300指增": /300指增|沪深300(?:指增|指数增强)|HS300(?:指增|指数增强)|300增强/,
  "A500指增": /A500指增|A500指数增强|中证A500(?:指增|指数增强)|A500增强/,
}

function compact(value: string | null | undefined): string {
  return (value ?? "").trim()
}

function splitL3(value: string): string[] {
  return value
    .split(/[，,、/]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function looksLikeQuantStock(name: string, l2: string): boolean {
  if (["指数增强", "主观多头", "可转债多头"].includes(l2)) return false
  return /量化选股|量化多头|量化精选/.test(name)
}

export function observationCategoryAliases(category: string): string[] {
  if (category === "量化精选" || category === "量化多头") return ["量化选股", "量化精选", "量化多头"]
  if (category === "主观精选") return ["主观多头", "主观精选"]
  return [category]
}

export function fundMatchesObservationCategory(
  category: string,
  labels: StrategyObservationLabels,
): boolean {
  const l1 = compact(labels.l1)
  const l2 = compact(labels.l2)
  const l3 = compact(labels.l3)
  const name = compact(labels.name).replace(/\s+/g, "")
  const l3s = splitL3(l3)
  const blob = `${l1}${l2}${l3}${name}`

  switch (category) {
    case "股票市场中性":
      return l2 === "股票市场中性" || /股票市场中性|量化中性|市场中性/.test(blob)
    case "1000指增":
    case "500指增":
    case "300指增":
    case "A500指增": {
      const haystack = `${l2}${l3}${name}`
      if (category === "500指增" && INDEX_ENHANCE_TAGS["A500指增"].test(haystack)) return false
      const re = INDEX_ENHANCE_TAGS[category]
      return l2 === category || l3s.includes(category) || (re != null && re.test(haystack))
    }
    case "量化选股":
    case "量化精选":
    case "量化多头":
      return l2 === "量化选股" || l2 === "量化多头" || l2 === "量化精选" || looksLikeQuantStock(name, l2)
    case "主观多头":
    case "主观精选":
      return l2 === "主观多头" || l2 === "主观精选" || /主观多头|主观精选/.test(name)
    case "量化期货":
      return l2 === "量化期货" || /量化期货|量化CTA|程序化期货/.test(blob)
    case "主观期货":
      return l2 === "主观期货" || /主观期货|主观CTA/.test(blob)
    case "期货策略":
      return l1 === "期货策略" || l1 === "管理期货" || l1 === "CTA"
    case "套利策略":
      return l1 === "套利策略" || l1 === "套利" || l2.includes("套利")
    case "股票对冲":
      return l1 === "股票对冲"
    case "股票多头":
      return l1 === "股票多头" || l1 === "股票策略"
    case "期权策略":
      return l1 === "期权策略" || l2.includes("期权")
    case "多资产策略":
      return l1 === "多资产策略"
    case "债券策略":
      return l1 === "债券策略" || l1 === "固定收益" || l1 === "固收策略"
    case "组合策略":
      return l1 === "组合策略" || l2 === "FOF" || l2 === "MOM"
    case "可转债多头":
      return l2 === "可转债多头" || (/可转债|转债/.test(name) && !/套利|指增/.test(name) && l1 === "股票多头")
    default:
      return false
  }
}

export function periodStartDate(key: string, granularity: ReturnGranularity): string {
  if (granularity === "week" || granularity === "phase") return key
  if (granularity === "month") return `${key}-01`
  if (granularity === "year") return `${key}-01-01`
  if (granularity === "quarter") {
    const q = Number(key.slice(-1))
    const month = Number.isFinite(q) ? (q - 1) * 3 + 1 : 1
    return `${key.slice(0, 4)}-${String(month).padStart(2, "0")}-01`
  }
  if (granularity === "half") {
    return key.endsWith("H1") ? `${key.slice(0, 4)}-01-01` : `${key.slice(0, 4)}-07-01`
  }
  return key
}

export function lookbackStart(year: number, granularity: ReturnGranularity): string {
  if (granularity === "week") return `${year - 1}-12-15`
  if (granularity === "month") return `${year - 1}-11-01`
  if (granularity === "quarter") return `${year - 1}-10-01`
  if (granularity === "half") return `${year - 1}-07-01`
  return `${year - 1}-01-01`
}

export function sqlPeriodBucketExpr(priceDateExpr: string, granularity: ReturnGranularity): string {
  if (granularity === "week") {
    return `TO_CHAR(DATE_TRUNC('week', ${priceDateExpr}::date), 'YYYY-MM-DD')`
  }
  if (granularity === "month") {
    return `TO_CHAR(${priceDateExpr}::date, 'YYYY-MM')`
  }
  if (granularity === "quarter") {
    return `TO_CHAR(${priceDateExpr}::date, 'YYYY') || '-Q' || TO_CHAR(${priceDateExpr}::date, 'Q')`
  }
  if (granularity === "half") {
    return `TO_CHAR(${priceDateExpr}::date, 'YYYY') || '-H' || CASE WHEN EXTRACT(MONTH FROM ${priceDateExpr}::date) <= 6 THEN '1' ELSE '2' END`
  }
  return `TO_CHAR(${priceDateExpr}::date, 'YYYY')`
}

export function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Drop broken NAV jumps, then trim the outer 1% when the sample is large. */
export function sanitizeReturns(values: number[], absCap = 80): number[] {
  const finite = values.filter((value) => Number.isFinite(value) && Math.abs(value) <= absCap)
  if (finite.length < 20) return finite
  const sorted = [...finite].sort((a, b) => a - b)
  const lo = sorted[Math.floor(sorted.length * 0.01)]
  const hi = sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)]
  return finite.filter((value) => value >= lo && value <= hi)
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 1.2
  const avg = mean(values) ?? 0
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1)
  return Math.sqrt(Math.max(variance, 1e-6))
}

/** 火富牛-style: 10%分位 = best decile (high return), 90%分位 = worst decile. */
export function rankedPercentile(sortedDesc: number[], fractionFromTop: number): number {
  if (!sortedDesc.length) return 0
  const index = Math.min(sortedDesc.length - 1, Math.max(0, Math.round((sortedDesc.length - 1) * fractionFromTop)))
  return sortedDesc[index]
}

export function winRate(values: number[]): number | null {
  if (!values.length) return null
  return Math.round((values.filter((value) => value > 0).length / values.length) * 10000) / 100
}

export function round2(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value * 100) / 100
}
