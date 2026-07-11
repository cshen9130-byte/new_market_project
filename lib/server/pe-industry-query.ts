import { query } from "@/lib/db"
import type {
  PeIndustryManagerScaleBucket,
  PeIndustryManagerScaleChange,
  PeIndustryMonthRow,
  PeIndustryRegionRow,
  PeIndustryScaleTrendBucket,
  PeIndustryScaleTrendPoint,
  PeIndustrySummary,
} from "@/lib/pe-industry-data"
import { PE_INDUSTRY_SCALE_TREND_BUCKETS } from "@/lib/pe-industry-data"

type MonthlyRow = {
  month: string
  new_filing_count: string
  new_filing_scale: string
  new_manager_count: string
  stock_fund_count: string
  stock_fund_scale: string
  stock_manager_count: string
  liquidation_count: string
  deregistered_manager_count: string
}

type SnapshotRow = {
  as_of: string | Date
  stock_scale: string
  stock_fund_count: string
  stock_manager_count: string
  scale_dist: PeIndustryManagerScaleBucket[] | null
  region_donut: Array<{ name: string; value: number; color: string }> | null
  region_table: PeIndustryRegionRow[] | null
  scale_trend: PeIndustryScaleTrendPoint[] | null
  scale_changes: { updatedAt: string; rows: PeIndustryManagerScaleChange[] } | null
  computed_at: string | Date | null
}

export type PeIndustryPayload = {
  summary: PeIndustrySummary
  monthly: PeIndustryMonthRow[]
  managerScaleDist: {
    updatedAt: string
    buckets: PeIndustryManagerScaleBucket[]
  }
  scaleTrend: PeIndustryScaleTrendPoint[]
  scaleChanges: {
    updatedAt: string
    rows: PeIndustryManagerScaleChange[]
  }
  regionDonut: Array<{ name: string; value: number; color: string }>
  regionTable: PeIndustryRegionRow[]
  computedAt: string | null
}

function n(value: string | null | undefined): number {
  return value != null ? Number(value) : 0
}

function fmtAsOf(month: string): string {
  return month.slice(0, 7).replace("-", ".")
}

function toDateStr(value: string | Date | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function normalizeScaleTrend(raw: PeIndustryScaleTrendPoint[] | null): PeIndustryScaleTrendPoint[] {
  if (!raw?.length) return []
  return raw.map((point) => ({
    month: point.month,
    counts: PE_INDUSTRY_SCALE_TREND_BUCKETS.reduce(
      (acc, bucket) => {
        acc[bucket as PeIndustryScaleTrendBucket] = point.counts?.[bucket as PeIndustryScaleTrendBucket] ?? 0
        return acc
      },
      {} as Record<PeIndustryScaleTrendBucket, number>,
    ),
  }))
}

export async function loadPeIndustryData(): Promise<PeIndustryPayload | null> {
  const snapshots = await query<SnapshotRow>(
    `SELECT as_of, stock_scale, stock_fund_count, stock_manager_count,
            scale_dist, region_donut, region_table, scale_trend, scale_changes, computed_at
     FROM pe_industry_snapshot
     WHERE id = 'default'`,
  )
  const monthlyRows = await query<MonthlyRow>(
    `SELECT to_char(month, 'YYYY-MM') AS month,
            new_filing_count, new_filing_scale, new_manager_count,
            stock_fund_count, stock_fund_scale, stock_manager_count,
            liquidation_count, deregistered_manager_count
     FROM pe_industry_monthly_stats
     ORDER BY month ASC`,
  )

  if (snapshots.length === 0 || monthlyRows.length === 0) return null

  const snapshot = snapshots[0]
  const monthly: PeIndustryMonthRow[] = monthlyRows.map((row) => ({
    month: row.month,
    newFilingCount: n(row.new_filing_count),
    newFilingScale: n(row.new_filing_scale),
    newManagerCount: n(row.new_manager_count),
    stockFundCount: n(row.stock_fund_count),
    stockFundScale: n(row.stock_fund_scale),
    stockManagerCount: n(row.stock_manager_count),
    liquidationCount: n(row.liquidation_count),
    deregisteredManagerCount: n(row.deregistered_manager_count),
  }))

  const asOfDate = toDateStr(snapshot.as_of) ?? ""
  const computedAt = toDateStr(snapshot.computed_at)
  const latestMonth = monthly[monthly.length - 1]?.month ?? asOfDate.slice(0, 7)

  return {
    summary: {
      asOf: fmtAsOf(latestMonth),
      stockScale: n(snapshot.stock_scale),
      stockFundCount: n(snapshot.stock_fund_count),
      stockManagerCount: n(snapshot.stock_manager_count),
    },
    monthly,
    managerScaleDist: {
      updatedAt: computedAt ?? asOfDate,
      buckets: snapshot.scale_dist ?? [],
    },
    scaleTrend: normalizeScaleTrend(snapshot.scale_trend),
    scaleChanges: snapshot.scale_changes ?? { updatedAt: latestMonth, rows: [] },
    regionDonut: snapshot.region_donut ?? [],
    regionTable: snapshot.region_table ?? [],
    computedAt,
  }
}
