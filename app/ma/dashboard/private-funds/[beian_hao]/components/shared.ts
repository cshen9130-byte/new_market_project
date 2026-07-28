import type { FundNavMetrics, MetricKey } from "@/lib/fund-nav-metrics"
import { filterWeekendNavRows } from "@/lib/nav-trading-day"

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

function weekBucketKey(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  const day = d.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + mondayOffset)
  return monday.toISOString().slice(0, 10)
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
