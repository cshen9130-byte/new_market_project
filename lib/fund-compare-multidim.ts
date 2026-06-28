import {
  computeCompareMetrics,
  type CompareMetrics,
  type ReturnCurvePoint,
} from "@/lib/fund-compare-metrics"

export type PeriodPreset = "1w" | "1m" | "3m" | "6m" | "1y" | "phase"

export const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "1w", label: "近一周" },
  { key: "1m", label: "近一月" },
  { key: "3m", label: "近三月" },
  { key: "6m", label: "近六月" },
  { key: "1y", label: "近一年" },
  { key: "phase", label: "阶段" },
]

export type AxisMetricKey =
  | "periodReturn"
  | "annReturn"
  | "annVol"
  | "sharpe"
  | "calmar"
  | "sortino"
  | "downsideRisk"
  | "maxDrawdown"

export const AXIS_METRICS: { key: AxisMetricKey; label: string; isPct: boolean }[] = [
  { key: "periodReturn", label: "收益", isPct: true },
  { key: "annReturn", label: "年化收益", isPct: true },
  { key: "annVol", label: "年化波动率", isPct: true },
  { key: "maxDrawdown", label: "最大回撤", isPct: true },
  { key: "sharpe", label: "夏普比率", isPct: false },
  { key: "calmar", label: "卡玛比率", isPct: false },
  { key: "sortino", label: "索提诺比率", isPct: false },
  { key: "downsideRisk", label: "下行风险", isPct: true },
]

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function isValidDateStr(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  return Number.isFinite(new Date(`${dateStr}T12:00:00`).getTime())
}

function subDays(dateStr: string, days: number): string {
  const base = isValidDateStr(dateStr) ? dateStr : isoToday()
  const d = new Date(`${base}T12:00:00`)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export function resolvePeriodRange(
  preset: PeriodPreset,
  appliedFrom: string,
  appliedTo: string,
): { from: string; to: string; label: string } {
  const to = isValidDateStr(appliedTo) ? appliedTo : isoToday()
  const phaseFrom = isValidDateStr(appliedFrom) ? appliedFrom : subDays(to, 365)
  switch (preset) {
    case "1w":
      return { from: subDays(to, 7), to, label: "近一周" }
    case "1m":
      return { from: subDays(to, 30), to, label: "近一月" }
    case "3m":
      return { from: subDays(to, 90), to, label: "近三月" }
    case "6m":
      return { from: subDays(to, 180), to, label: "近六月" }
    case "1y":
      return { from: subDays(to, 365), to, label: "近一年" }
    case "phase":
      return { from: phaseFrom, to, label: "阶段" }
  }
}

export function sliceReturnWindow(
  points: ReturnCurvePoint[],
  from: string,
  to: string,
): ReturnCurvePoint[] {
  const sorted = [...points]
    .filter((p) => p.d >= from && p.d <= to)
    .sort((a, b) => a.d.localeCompare(b.d))
  if (sorted.length < 2) return []
  const baseLevel = 1 + sorted[0].v / 100
  return sorted.map((p) => ({
    d: p.d,
    v: baseLevel > 0 ? ((1 + p.v / 100) / baseLevel - 1) * 100 : 0,
  }))
}

export function sliceReturnToCalendarYear(
  points: ReturnCurvePoint[],
  year: number,
  appliedFrom: string,
  appliedTo: string,
): ReturnCurvePoint[] {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const effectiveFrom = from > appliedFrom ? from : appliedFrom
  const effectiveTo = to < appliedTo ? to : appliedTo
  if (effectiveFrom > effectiveTo) return []
  return sliceReturnWindow(points, effectiveFrom, effectiveTo)
}

export function computeFundPeriodMetrics(
  returnPoints: ReturnCurvePoint[],
  from: string,
  to: string,
): CompareMetrics {
  const sliced = sliceReturnWindow(returnPoints, from, to)
  return computeCompareMetrics(sliced)
}

export function readMetricValue(metrics: CompareMetrics, key: AxisMetricKey): number | null {
  const v = metrics[key]
  if (v == null || Number.isNaN(v)) return null
  return v
}

export function axisTitle(metric: AxisMetricKey, periodLabel: string): string {
  switch (metric) {
    case "periodReturn":
      return `${periodLabel}收益`
    case "maxDrawdown":
      return `${periodLabel}最大回撤`
    case "annReturn":
      return `${periodLabel}年化收益`
    case "annVol":
      return `${periodLabel}年化波动率`
    case "downsideRisk":
      return `${periodLabel}下行风险`
    default:
      return AXIS_METRICS.find((m) => m.key === metric)?.label ?? metric
  }
}

export function niceAxisBounds(
  values: number[],
  options?: { minZero?: boolean; symmetric?: boolean },
): { min: number; max: number } {
  const finite = values.filter((v) => Number.isFinite(v))
  if (!finite.length) return { min: -10, max: 10 }

  let min = options?.minZero ? 0 : Math.min(...finite, 0)
  let max = Math.max(...finite, 0)

  if (options?.symmetric) {
    const abs = Math.max(Math.abs(min), Math.abs(max), 1)
    min = -abs
    max = abs
  } else {
    const span = Math.max(max - min, 1)
    const pad = span * 0.12
    min = options?.minZero ? 0 : Math.floor((min - pad) / 3) * 3
    max = Math.ceil((max + pad) / 3) * 3
  }

  return { min, max }
}
