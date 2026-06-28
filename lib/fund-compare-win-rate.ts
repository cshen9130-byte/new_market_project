import {
  computePeriodReturnsFromNav,
  type NavPoint,
} from "@/lib/fund-compare-period-returns"

export type WinRateGranularity = "week" | "month"

export interface WinRateStats {
  totalPeriods: number
  upPct: number
  downPct: number
  avgUpReturn: number | null
  avgDownLoss: number | null
  maxReturn: number | null
  maxLoss: number | null
  upStdDev: number | null
  downStdDev: number | null
}

export interface WinRateRow {
  key: string
  name: string
  isBenchmark: boolean
  stats: WinRateStats
  rangeFrom: string | null
  rangeTo: string | null
}

export const WIN_RATE_GRANULARITY_LABELS: Record<
  WinRateGranularity,
  {
    total: string
    unit: string
    upShare: string
    downShare: string
    avgUp: string
    avgDown: string
    maxUp: string
    maxDown: string
    upStd: string
    downStd: string
  }
> = {
  week: {
    total: "总周期",
    unit: "周",
    upShare: "上涨周数占比",
    downShare: "下跌周数占比",
    avgUp: "上涨周平均收益",
    avgDown: "下跌周平均亏损",
    maxUp: "最大周收益",
    maxDown: "最大周亏损",
    upStd: "上涨周标准差",
    downStd: "下跌周标准差",
  },
  month: {
    total: "总周期",
    unit: "月",
    upShare: "上涨月数占比",
    downShare: "下跌月数占比",
    avgUp: "上涨月平均收益",
    avgDown: "下跌月平均亏损",
    maxUp: "最大月收益",
    maxDown: "最大月亏损",
    upStd: "上涨月标准差",
    downStd: "下跌月标准差",
  },
}

function stdDev(values: number[]): number | null {
  if (values.length === 0) return null
  if (values.length === 1) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
}

export function computeWinRateStats(returns: number[]): WinRateStats {
  const valid = returns.filter((r) => Number.isFinite(r))
  const total = valid.length
  const up = valid.filter((r) => r > 0)
  const down = valid.filter((r) => r < 0)
  return {
    totalPeriods: total,
    upPct: total > 0 ? (up.length / total) * 100 : 0,
    downPct: total > 0 ? (down.length / total) * 100 : 0,
    avgUpReturn: up.length ? up.reduce((s, v) => s + v, 0) / up.length : null,
    avgDownLoss: down.length ? down.reduce((s, v) => s + v, 0) / down.length : null,
    maxReturn: valid.length ? Math.max(...valid) : null,
    maxLoss: valid.length ? Math.min(...valid) : null,
    upStdDev: up.length ? stdDev(up) : null,
    downStdDev: down.length ? stdDev(down) : null,
  }
}

function filterNavPoints(points: NavPoint[], from: string, to: string): NavPoint[] {
  return [...points]
    .filter((p) => p.d >= from && p.d <= to)
    .sort((a, b) => a.d.localeCompare(b.d))
}

export function computePeriodReturnPcts(
  points: NavPoint[],
  gran: WinRateGranularity,
  from: string,
  to: string,
): { returns: number[]; rangeFrom: string | null; rangeTo: string | null } {
  const filtered = filterNavPoints(points, from, to)
  if (filtered.length < 2) {
    return { returns: [], rangeFrom: null, rangeTo: null }
  }
  const periodReturns = computePeriodReturnsFromNav(filtered, gran)
  return {
    returns: periodReturns.map((p) => p.pct),
    rangeFrom: filtered[0].d.slice(0, 10),
    rangeTo: filtered.at(-1)!.d.slice(0, 10),
  }
}

export function computeExcessPeriodReturnPcts(
  fundPoints: NavPoint[],
  benchPoints: NavPoint[],
  gran: WinRateGranularity,
  from: string,
  to: string,
): { returns: number[]; rangeFrom: string | null; rangeTo: string | null } {
  const fundFiltered = filterNavPoints(fundPoints, from, to)
  const benchFiltered = filterNavPoints(benchPoints, from, to)
  if (fundFiltered.length < 2) {
    return { returns: [], rangeFrom: null, rangeTo: null }
  }

  const fundPeriods = computePeriodReturnsFromNav(fundFiltered, gran)
  const benchPeriods = computePeriodReturnsFromNav(benchFiltered, gran)
  const benchMap = new Map(benchPeriods.map((p) => [p.label, p.pct]))

  const returns = fundPeriods
    .map((p) => {
      const bench = benchMap.get(p.label)
      return bench == null ? NaN : p.pct - bench
    })
    .filter((v) => Number.isFinite(v))

  return {
    returns,
    rangeFrom: fundFiltered[0].d.slice(0, 10),
    rangeTo: fundFiltered.at(-1)!.d.slice(0, 10),
  }
}

export function buildWinRateRow(
  key: string,
  name: string,
  navPoints: NavPoint[],
  gran: WinRateGranularity,
  from: string,
  to: string,
  isBenchmark: boolean,
  showExcess: boolean,
  benchPoints?: NavPoint[],
): WinRateRow {
  const { returns, rangeFrom, rangeTo } = showExcess && benchPoints && !isBenchmark
    ? computeExcessPeriodReturnPcts(navPoints, benchPoints, gran, from, to)
    : computePeriodReturnPcts(navPoints, gran, from, to)

  return {
    key,
    name,
    isBenchmark,
    stats: computeWinRateStats(returns),
    rangeFrom,
    rangeTo,
  }
}

export interface ReturnScatterPoint {
  label: string
  bench: number
  fund: number
}

export function buildFundScatterPoints(
  fundNavPoints: NavPoint[],
  benchNavPoints: NavPoint[],
  gran: WinRateGranularity,
  from: string,
  to: string,
  showExcess: boolean,
): ReturnScatterPoint[] {
  const fundFiltered = filterNavPoints(fundNavPoints, from, to)
  const benchFiltered = filterNavPoints(benchNavPoints, from, to)
  if (fundFiltered.length < 2 || benchFiltered.length < 2) return []

  const fundPeriods = computePeriodReturnsFromNav(fundFiltered, gran)
  const benchPeriods = computePeriodReturnsFromNav(benchFiltered, gran)
  const benchMap = new Map(benchPeriods.map((p) => [p.label, p.pct]))

  return fundPeriods
    .filter((p) => benchMap.has(p.label))
    .map((p) => {
      const bench = benchMap.get(p.label)!
      return {
        label: p.label,
        bench,
        fund: showExcess ? p.pct - bench : p.pct,
      }
    })
}

export function scatterAxisBounds(values: number[], fallback: [number, number]): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v))
  if (!finite.length) return fallback
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const pad = Math.max((max - min) * 0.12, 1)
  return [Math.floor(min - pad), Math.ceil(max + pad)]
}

export function fmtWinRatePct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return `${v.toFixed(2)}%`
}

export function fmtWinRateSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`
}

export function winRatePctClass(v: number | null | undefined, positiveIsRed = true): string {
  if (v == null || !Number.isFinite(v)) return "text-foreground"
  if (v > 0) return positiveIsRed ? "text-red-500" : "text-green-500"
  if (v < 0) return positiveIsRed ? "text-green-500" : "text-red-500"
  return "text-foreground"
}
