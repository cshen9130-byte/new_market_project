import { chinaMarketOpenDaysBetween } from "@/lib/server/china-trading-calendar"

/**
 * Adjacent chart step treated as a share-class / unit-vs-adjusted splice.
 * 1.30 catches A/B mixes around 1.09 to 1.45 and stays next to the 1.35
 * discontinuity used when period returns refuse a broken path.
 */
export const NAV_CHART_JUMP_RATIO = 1.3

/** Doubling or halving inside about a month, even across a short hole. */
export const NAV_CHART_HARD_JUMP_RATIO = 2
export const NAV_CHART_HARD_JUMP_MAX_OPEN_DAYS = 20

/** One point that leaves both neighbors and then comes back. */
export const NAV_CHART_SPIKE_DEVIATION = 0.15
export const NAV_CHART_SPIKE_NEIGHBOR_TOLERANCE = 0.08

const SNIPPET_BEFORE = 5
const SNIPPET_AFTER = 5

export type NavAnomalyPoint = {
  date: string
  value: number
}

export type NavAnomalyReason = "" | "jump" | "spike"

export type NavAnomalyStats = {
  anomalous: boolean
  reason: NavAnomalyReason
  date: string
  ratio: number
  count: number
  /** Chart window around the flagged point, for the list sparkline. */
  snippet: NavAnomalyPoint[]
}

export type NavAnomalyHit = {
  reason: "jump" | "spike"
  date: string
  ratio: number
  snippet: NavAnomalyPoint[]
}

type LevelFields = {
  adjusted?: unknown
  cumulative?: unknown
  unit?: unknown
}

function isoDay(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, 10)
}

function lowerMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0
}

function positiveLevel(raw: unknown): number | null {
  if (raw == null) return null
  const text = String(raw).trim()
  if (!text) return null
  const n = Number(text)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * Value drawn on the default NAV chart: adjusted, then cumulative, then unit.
 * A dividend that only drops unit NAV stays smooth here.
 */
export function chartNavLevel(fields: LevelFields): number | null {
  return positiveLevel(fields.adjusted)
    ?? positiveLevel(fields.cumulative)
    ?? positiveLevel(fields.unit)
}

function datesOnOrAfter(points: NavAnomalyPoint[], fromDate?: string | null): NavAnomalyPoint[] {
  const start = isoDay(fromDate)
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.value) && p.value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(isoDay(p.date)))
    .sort((a, b) => isoDay(a.date).localeCompare(isoDay(b.date)))
  const deduped: NavAnomalyPoint[] = []
  for (const point of sorted) {
    const date = isoDay(point.date)
    const prev = deduped[deduped.length - 1]
    if (prev && prev.date === date) {
      deduped[deduped.length - 1] = { date, value: point.value }
      continue
    }
    deduped.push({ date, value: point.value })
  }
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return deduped
  return deduped.filter((p) => p.date >= start)
}

function isHardJump(ratio: number, openDays: number): boolean {
  const extreme = ratio >= NAV_CHART_HARD_JUMP_RATIO || ratio <= 1 / NAV_CHART_HARD_JUMP_RATIO
  return extreme && openDays <= NAV_CHART_HARD_JUMP_MAX_OPEN_DAYS
}

function isChartJump(ratio: number): boolean {
  return ratio >= NAV_CHART_JUMP_RATIO || ratio <= 1 / NAV_CHART_JUMP_RATIO
}

function snippetAround(series: NavAnomalyPoint[], index: number): NavAnomalyPoint[] {
  const from = Math.max(0, index - SNIPPET_BEFORE)
  const to = Math.min(series.length, index + SNIPPET_AFTER + 1)
  return series.slice(from, to).map((point) => ({
    date: point.date,
    value: +point.value.toFixed(6),
  }))
}

function hitFrom(stats: NavAnomalyStats): NavAnomalyHit | null {
  if (!stats.anomalous || (stats.reason !== "jump" && stats.reason !== "spike")) return null
  return {
    reason: stats.reason,
    date: stats.date,
    ratio: +stats.ratio.toFixed(6),
    snippet: stats.snippet,
  }
}

/**
 * Suspicious chart path from the operation date (or the first point) through the latest point.
 * A step counts only when it sits inside the product's usual disclosure gap.
 * A much longer hole can carry a real compounded move, so it is left to the gap filter.
 * Weekend-only gaps still count as the next print.
 */
export function analyzeNavAnomaly(points: NavAnomalyPoint[], fromDate?: string | null): NavAnomalyStats {
  const series = datesOnOrAfter(points, fromDate)
  const empty: NavAnomalyStats = {
    anomalous: false,
    reason: "",
    date: "",
    ratio: 1,
    count: series.length,
    snippet: [],
  }
  if (series.length < 2) return empty

  const openDays: number[] = []
  for (let i = 1; i < series.length; i++) {
    openDays.push(chinaMarketOpenDaysBetween(series[i].date, series[i - 1].date))
  }
  const typical = lowerMedian(openDays.filter((days) => days > 0))
  const holeFloor = typical > 0 ? Math.max(typical * 2, 7) : Number.POSITIVE_INFINITY

  const normalStep = (days: number) => days <= holeFloor

  for (let i = 1; i < series.length; i++) {
    const ratio = series[i].value / series[i - 1].value
    const days = openDays[i - 1]
    if (isHardJump(ratio, days) || (normalStep(days) && isChartJump(ratio))) {
      return {
        anomalous: true,
        reason: "jump",
        date: series[i].date,
        ratio,
        count: series.length,
        snippet: snippetAround(series, i),
      }
    }
  }

  for (let i = 1; i < series.length - 1; i++) {
    if (!normalStep(openDays[i - 1]) || !normalStep(openDays[i])) continue
    const prev = series[i - 1].value
    const curr = series[i].value
    const next = series[i + 1].value
    const devPrev = Math.abs(curr / prev - 1)
    const devNext = Math.abs(curr / next - 1)
    const bridge = Math.abs(next / prev - 1)
    if (
      devPrev >= NAV_CHART_SPIKE_DEVIATION
      && devNext >= NAV_CHART_SPIKE_DEVIATION
      && bridge <= NAV_CHART_SPIKE_NEIGHBOR_TOLERANCE
    ) {
      return {
        anomalous: true,
        reason: "spike",
        date: series[i].date,
        ratio: curr / prev,
        count: series.length,
        snippet: snippetAround(series, i),
      }
    }
  }

  return empty
}

export function hasNavAnomaly(points: NavAnomalyPoint[], fromDate?: string | null): boolean {
  return analyzeNavAnomaly(points, fromDate).anomalous
}

export function navAnomalyHit(points: NavAnomalyPoint[], fromDate?: string | null): NavAnomalyHit | null {
  return hitFrom(analyzeNavAnomaly(points, fromDate))
}