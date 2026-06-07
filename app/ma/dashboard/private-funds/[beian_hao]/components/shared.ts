import type { FundNavMetrics, MetricKey } from "@/lib/fund-nav-metrics"

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
