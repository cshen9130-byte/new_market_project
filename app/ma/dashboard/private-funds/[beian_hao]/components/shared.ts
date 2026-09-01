import type { FundNavMetrics, MetricKey } from "@/lib/fund-nav-metrics"
import { filterWeekendNavRows, isWeekendIsoDate } from "@/lib/nav-trading-day"

export const RED   = "rgb(239,68,68)"
export const GREEN = "rgb(34,197,94)"

export interface NavRow {
  price_date:         string
  nav:                string
  cumulative_nav:     string
  cum_nav_withdrawal: string
  price_change:       string
}

export interface BenchmarkPoint {
  date: string
  value: number
}

export interface PeerMonthlyRow {
  ym:         string
  sample_n:   number
  mean_ret:   number
  median_ret: number
  fund_ret:   number | null
  rank_num:   number | null
}

export interface PeerYearlyRow {
  year: number
  interval: string
  sample_n: number
  mean: Record<MetricKey, number | null>
  median: Record<MetricKey, number | null>
  rank: Record<MetricKey, number | null>
  percentile: Record<MetricKey, number | null>
}

export interface AnnualFundRow {
  year: number
  interval: string
  metrics: FundNavMetrics
}

export function getNavFieldValue(row: NavRow, navType: string): number {
  if (navType === "单位净值") return parseFloat(row.nav)
  if (navType === "累计净值") return parseFloat(row.cum_nav_withdrawal)
  return parseFloat(row.cumulative_nav)
}

export type NavFrequencyFilter = "全部" | "日频" | "周频" | "月频"
export type HeadlineRiskFrequency = "日频" | "周频" | "月频"

const HEADLINE_RISK_PPY: Record<HeadlineRiskFrequency, number> = {
  日频: 252,
  周频: 52,
  月频: 12,
}

/**
 * Since-inception max drawdown and Sharpe on a frequency-resampled 复权净值 series.
 * Sharpe matches the FOF week report: annualized return / vol, no risk-free, sample std.
 */
export function computeHeadlineRiskMetrics(
  rows: NavRow[],
  freq: HeadlineRiskFrequency,
): { max_drawdown: string | null; sharpe: string | null } {
  const sampled = filterNavRowsByFrequency(rows, freq)
  const values: number[] = []
  const dates: string[] = []
  for (const row of sampled) {
    const v = parseFloat(row.cumulative_nav)
    if (!Number.isFinite(v) || v <= 0) continue
    values.push(v)
    dates.push(row.price_date)
  }
  if (values.length < 2) return { max_drawdown: null, sharpe: null }

  let peak = values[0]
  let maxDd = 0
  const rets: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) peak = values[i]
    if (peak > 0) maxDd = Math.max(maxDd, (peak - values[i]) / peak)
    if (i > 0 && values[i - 1] > 0) rets.push(values[i] / values[i - 1] - 1)
  }

  const start = new Date(`${dates[0]}T00:00:00`).getTime()
  const end = new Date(`${dates[dates.length - 1]}T00:00:00`).getTime()
  const years = Math.max((end - start) / 86_400_000 / 365.25, 1 / 365.25)
  const annRet = Math.pow(values[values.length - 1] / values[0], 1 / years) - 1

  let sharpe: string | null = null
  if (rets.length > 1) {
    const mean = rets.reduce((sum, r) => sum + r, 0) / rets.length
    const variance = rets.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (rets.length - 1)
    const annVol = Math.sqrt(variance) * Math.sqrt(HEADLINE_RISK_PPY[freq])
    if (annVol > 0) sharpe = (annRet / annVol).toFixed(2)
  }

  return {
    max_drawdown: maxDd > 0 ? (maxDd * 100).toFixed(2) : null,
    sharpe,
  }
}

function weekBucketKey(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  const day = d.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + mondayOffset)
  return monday.toISOString().slice(0, 10)
}

/** Keep the last point per week/month bucket. `日频`/`全部` keep trading-day observations. */
export function filterPointsByFrequency<T extends { d: string }>(
  pts: T[],
  freq: NavFrequencyFilter,
): T[] {
  const trading = pts.filter((p) => !isWeekendIsoDate(p.d))
  if (!trading.length || freq === "全部" || freq === "日频") return trading

  const bucketKey = (dateStr: string): string =>
    freq === "月频" ? dateStr.slice(0, 7) : weekBucketKey(dateStr)

  const byBucket = new Map<string, T>()
  for (const p of trading) byBucket.set(bucketKey(p.d), p)
  return [...byBucket.values()].sort((a, b) => a.d.localeCompare(b.d))
}

/** Keep the last NAV point per bucket for the selected frequency. */
export function filterNavRowsByFrequency(rows: NavRow[], freq: NavFrequencyFilter): NavRow[] {
  // Always drop custody weekend forward-fills before frequency bucketing.
  const tradingRows = filterWeekendNavRows(rows)
  if (!tradingRows.length || freq === "全部") return tradingRows

  const bucketKey = (row: NavRow): string => {
    if (freq === "日频") return row.price_date.slice(0, 10)
    if (freq === "月频") return row.price_date.slice(0, 7)
    return weekBucketKey(row.price_date)
  }

  const byBucket = new Map<string, NavRow>()
  for (const row of tradingRows) byBucket.set(bucketKey(row), row)
  return [...byBucket.values()].sort((a, b) => a.price_date.localeCompare(b.price_date))
}

/** Daily 涨跌幅 (percentage points) for the selected NAV type vs the prior row in the series. */
export function computeNavPctChange(rows: NavRow[], navType: string, date: string): number | null {
  const idx = rows.findIndex((row) => row.price_date === date)
  if (idx <= 0) return null
  const prevVal = getNavFieldValue(rows[idx - 1], navType)
  const curr = getNavFieldValue(rows[idx], navType)
  if (!Number.isFinite(prevVal) || prevVal <= 0 || !Number.isFinite(curr)) return null
  return ((curr / prevVal - 1) * 100)
}
