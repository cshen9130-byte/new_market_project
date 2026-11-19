/**
 * Median returns of FOF underlyings we currently hold, grouped by the same
 * strategy buckets as 周度回顾(股票) / 周度回顾(期货).
 */

import { query } from "@/lib/db"
import {
  buildInvestedMedianGroups,
  type InvestedMedianGroup,
  type InvestedMedianInput,
  type InvestedReturnPoint,
} from "@/lib/ma/weekly-review-invested-median"
import { WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS } from "@/lib/weekly-review-data-status"
import {
  sqlExcludeFofUnderlyingProduct,
  sqlFofUnderlyingFundClassFilter,
} from "@/lib/server/fund-holding-code"
import {
  bucketForFund,
  collapseWeeklyReviewFunds,
  computeFundMetrics,
  isEquityFund,
  loadWeeklyReviewNavCoverage,
  metricModeForBucket,
  previewWeeklyReview,
  resolveWeekWindow,
  type FundMetrics,
  type MetricMode,
  type WeeklyReviewFund,
} from "@/lib/server/jy-weekly-review"
import {
  FUTURES_WEEKLY_CATEGORIES,
  futuresWeeklyCategories,
  isFuturesWeeklyFund,
} from "@/lib/server/jy-weekly-review-futures"

export type WeeklyReviewInvestedVariant = "equity" | "futures"

export type WeeklyReviewInvestedMedian = {
  variant: WeeklyReviewInvestedVariant
  week_start: string
  week_end: string
  as_of: string
  fund_count: number
  groups: InvestedMedianGroup[]
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

function displayPoint(row: FundMetrics, mode: MetricMode): InvestedReturnPoint {
  const source = mode === "excess" ? row.excess : row.ret
  return {
    ret_1w: finiteOrNull(source.ret_1w),
    ret_1m: finiteOrNull(source.ret_1m),
    ret_3m: finiteOrNull(source.ret_3m),
    ret_6m: finiteOrNull(source.ret_6m),
    ret_1y: finiteOrNull(source.ret_1y),
  }
}

/** Currently held private FOF underlyings. Strategy prefers the tracking-pool tag. */
async function loadHeldFofUnderlyings(): Promise<WeeklyReviewFund[]> {
  const privateOnly = sqlFofUnderlyingFundClassFilter("private", "c.product_name", "c.beian_hao")
  const notListed = sqlExcludeFofUnderlyingProduct("c.product_name", "c.beian_hao")
  return query<WeeklyReviewFund>(
    `SELECT DISTINCT ON (UPPER(BTRIM(c.beian_hao)))
        BTRIM(c.beian_hao) AS beian_hao,
        COALESCE(NULLIF(BTRIM(c.product_name), ''), BTRIM(c.beian_hao)) AS product_name,
        COALESCE(NULLIF(BTRIM(t.short_name), ''), NULLIF(BTRIM(c.short_name), '')) AS short_name,
        COALESCE(t.l1, NULLIF(BTRIM(c.company_strategy_l1), '')) AS l1,
        COALESCE(t.l2, NULLIF(BTRIM(c.company_strategy_l2), '')) AS l2,
        COALESCE(t.l3, NULLIF(BTRIM(c.company_strategy_l3), '')) AS l3
     FROM ops_fof_overview_list_cache c
     LEFT JOIN (
       SELECT DISTINCT ON (UPPER(BTRIM(beian_hao)))
         UPPER(BTRIM(beian_hao)) AS code,
         NULLIF(BTRIM(short_name), '') AS short_name,
         NULLIF(BTRIM(company_strategy_l1), '') AS l1,
         NULLIF(BTRIM(company_strategy_l2), '') AS l2,
         NULLIF(BTRIM(company_strategy_l3), '') AS l3
       FROM ops_tracking_funds_list_cache
       WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
       ORDER BY UPPER(BTRIM(beian_hao))
     ) t ON t.code = UPPER(BTRIM(c.beian_hao))
     WHERE c.product_name <> '合计'
       AND COALESCE(c.market_value, 0) > 0
       AND NULLIF(BTRIM(c.beian_hao), '') IS NOT NULL
       AND ${privateOnly}
       AND ${notListed}
     ORDER BY UPPER(BTRIM(c.beian_hao)), c.market_value DESC NULLS LAST`,
  )
}

export async function buildWeeklyReviewInvestedMedian(
  variant: WeeklyReviewInvestedVariant,
  weekEndRaw: string,
): Promise<WeeklyReviewInvestedMedian> {
  const { weekStart, weekEnd, asOf } = resolveWeekWindow(weekEndRaw)
  const held = await loadHeldFofUnderlyings()
  const scoped = held.filter((fund) => variant === "equity" ? isEquityFund(fund) : isFuturesWeeklyFund(fund))
  const coverage = await loadWeeklyReviewNavCoverage(scoped, asOf)
  const collapsed = collapseWeeklyReviewFunds(scoped, coverage)

  const funds = variant === "equity"
    ? collapsed.filter((fund) => !WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS.has(bucketForFund(fund)) && bucketForFund(fund) !== "未分类")
    : collapsed.filter((fund) => futuresWeeklyCategories(fund).length > 0)

  const metrics = funds.length === 0
    ? []
    : await computeFundMetrics(
      funds,
      asOf,
      undefined,
      variant === "futures"
        ? { bucketFor: () => "量化期货", modeFor: () => "absolute" }
        : undefined,
    )
  const byCode = new Map(metrics.map((row) => [row.beian_hao, row]))

  const inputs: InvestedMedianInput[] = []
  for (const fund of funds) {
    const row = byCode.get(fund.beian_hao)
    if (!row) continue
    if (variant === "futures") {
      const buckets = futuresWeeklyCategories(fund)
      if (buckets.length === 0) continue
      inputs.push({
        code: fund.beian_hao,
        name: row.name,
        buckets: [...buckets],
        mode: "absolute",
        ...displayPoint(row, "absolute"),
      })
      continue
    }
    const bucket = row.bucket
    if (!bucket || bucket === "未分类" || WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS.has(bucket)) continue
    inputs.push({
      code: fund.beian_hao,
      name: row.name,
      buckets: [bucket],
      mode: metricModeForBucket(bucket),
      ...displayPoint(row, row.mode),
    })
  }

  const bucketOrder = variant === "futures"
    ? FUTURES_WEEKLY_CATEGORIES
    : previewWeeklyReview(funds).map((group) => group.bucket)

  return {
    variant,
    week_start: weekStart,
    week_end: weekEnd,
    as_of: asOf,
    fund_count: funds.length,
    groups: buildInvestedMedianGroups(inputs, bucketOrder),
  }
}
