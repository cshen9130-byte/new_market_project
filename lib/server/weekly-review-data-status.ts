/**
 * JY跟踪池周度回顾 data status for 运维 → 数据概览.
 * Universe, share-class collapse, and NAV series match the weekly workbook.
 */

import { query } from "@/lib/db"
import { shareClassFamilyBeianCodes } from "@/lib/server/share-class-product"
import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
import { serveOpsSnapshot } from "@/lib/server/ops-overview-snapshot"
import { addDays } from "@/lib/server/list-cache-nav-batch"
import {
  bucketForFund,
  collapseWeeklyReviewFunds,
  defaultWeeklyReviewWeekEnd,
  displayName,
  isEquityFund,
  loadJyTrackingPoolFunds,
  loadWeeklyReviewNavCoverage,
  loadWeeklyReviewNavHistories,
  metricModeForBucket,
  mondayOfWeek,
  previewWeeklyReview,
  type WeeklyReviewFund,
} from "@/lib/server/jy-weekly-review"
import {
  bucketForFuturesFund,
  isFuturesWeeklyFund,
  previewFuturesWeeklyReview,
} from "@/lib/server/jy-weekly-review-futures"
import {
  normalizeWeeklyReviewPools,
  type WeeklyReviewPoolKey,
} from "@/lib/ma/weekly-review-pools"
import {
  buildWeeklyReviewDataStatus,
  pickBestSource,
  type SourceHit,
  type StatusFundInput,
  type WeeklyReviewDataStatus,
  type WeeklyReviewSource,
  type WeeklyReviewStatusVariant,
  type WeekWindow,
} from "@/lib/weekly-review-data-status"

const CHANNELS: WeeklyReviewSource[] = ["email", "manual", "fof99"]

function isVariant(value: string | null): value is WeeklyReviewStatusVariant {
  return value === "equity" || value === "futures"
}

export function parseWeeklyReviewStatusVariant(raw: string | null): WeeklyReviewStatusVariant {
  const value = (raw ?? "").trim().toLowerCase()
  return isVariant(value) ? value : "equity"
}

function anchorWeekEnd(today: string, weekEnd?: string): string {
  const raw = (weekEnd ?? "").slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  return defaultWeeklyReviewWeekEnd(today)
}

function lastThreeWeeks(anchor: string): WeekWindow[] {
  const ends = [anchor, addDays(anchor, 7), addDays(anchor, 14)]
  return ends.map((weekEnd) => ({ week_start: mondayOfWeek(weekEnd), week_end: weekEnd }))
}

function isoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const text = String(value ?? "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ""
}

async function loadCollapsedFunds(
  variant: WeeklyReviewStatusVariant,
  asOf: string,
  pools: WeeklyReviewPoolKey[],
): Promise<WeeklyReviewFund[]> {
  const pool = await loadJyTrackingPoolFunds(pools)
  const selected = pool.filter(variant === "futures" ? isFuturesWeeklyFund : isEquityFund)
  const coverage = await loadWeeklyReviewNavCoverage(selected, asOf)
  return collapseWeeklyReviewFunds(selected, coverage)
}

async function loadUpdateChannels(codes: string[]): Promise<Map<string, SourceHit>> {
  const out = new Map<string, SourceHit>()
  if (codes.length === 0) return out
  const rows = await query<{ code: string; channel: string; d: string | Date }>(
    `WITH channels AS (
       SELECT code, channel, MAX(d) AS d
       FROM (
         SELECT UPPER(BTRIM(product_code)) AS code, 'email'::text AS channel, nav_date::date AS d
         FROM ops_email_nav_records
         WHERE nav IS NOT NULL
           AND nav_date IS NOT NULL
           AND nav_date > DATE '1970-01-01'
           AND UPPER(BTRIM(product_code)) = ANY($1::text[])
         UNION ALL
         SELECT UPPER(BTRIM(product_code)),
           CASE
             WHEN COALESCE(source, '') = 'manual_upload' OR COALESCE(crawl_email_account, '') = 'team_manual_upload'
             THEN 'manual' ELSE 'email'
           END,
           valuation_date::date
         FROM ops_email_valuation_records
         WHERE valuation_date IS NOT NULL
           AND valuation_date > DATE '1970-01-01'
           AND UPPER(BTRIM(product_code)) = ANY($1::text[])
         UNION ALL
         SELECT UPPER(BTRIM(beian_hao)), 'manual', nav_date::date
         FROM ops_team_nav_manual
         WHERE unit_nav IS NOT NULL
           AND nav_date IS NOT NULL
           AND nav_type = 'pre_fee'
           AND nav_date > DATE '1970-01-01'
           AND UPPER(BTRIM(beian_hao)) = ANY($1::text[])
         UNION ALL
         SELECT UPPER(BTRIM(reg_code)), 'fof99', price_date::date
         FROM fof99_nav_fetch_log
         WHERE status = 'ok'
           AND price_date > DATE '1970-01-01'
           AND UPPER(BTRIM(reg_code)) = ANY($1::text[])
       ) s
       WHERE code <> '' AND d IS NOT NULL
       GROUP BY code, channel
     )
     SELECT DISTINCT ON (code) code, channel, d::text AS d
     FROM channels
     ORDER BY code, d DESC, CASE channel WHEN 'manual' THEN 3 WHEN 'email' THEN 2 ELSE 1 END DESC`,
    [codes],
  )
  for (const row of rows) {
    const date = isoDate(row.d)
    if (!row.code || !date || !CHANNELS.includes(row.channel as WeeklyReviewSource)) continue
    out.set(row.code, { source: row.channel as SourceHit["source"], date })
  }
  return out
}

function channelForFund(fund: WeeklyReviewFund, channels: Map<string, SourceHit>): { source: WeeklyReviewSource; date: string | null } {
  const hits: SourceHit[] = []
  for (const code of shareClassFamilyBeianCodes(fund.beian_hao)) {
    const hit = channels.get(code)
    if (hit) hits.push(hit)
  }
  return pickBestSource(hits)
}

export async function buildWeeklyReviewDataStatusReport(
  variant: WeeklyReviewStatusVariant,
  today = shanghaiTodayIsoDate(),
  query: { pools?: WeeklyReviewPoolKey[]; weekEnd?: string } = {},
): Promise<WeeklyReviewDataStatus> {
  const pools = normalizeWeeklyReviewPools(query.pools ?? ["jy"])
  const weeks = lastThreeWeeks(anchorWeekEnd(today, query.weekEnd))
  const asOf = weeks[0]?.week_end ?? defaultWeeklyReviewWeekEnd(today)
  const funds = await loadCollapsedFunds(variant, asOf, pools)
  const codes = [...new Set(funds.flatMap((fund) => shareClassFamilyBeianCodes(fund.beian_hao)))]
  const [histories, channels] = await Promise.all([
    loadWeeklyReviewNavHistories(funds, asOf),
    loadUpdateChannels(codes),
  ])
  const bucketOf = variant === "futures" ? bucketForFuturesFund : bucketForFund
  const bucketOrder = (variant === "futures" ? previewFuturesWeeklyReview(funds) : previewWeeklyReview(funds))
    .map((group) => group.bucket)

  const inputs: StatusFundInput[] = funds.map((fund) => {
    const channel = channelForFund(fund, channels)
    const history = histories.get(fund.beian_hao) ?? []
    return {
      beian_hao: fund.beian_hao,
      name: displayName(fund.product_name, fund.short_name, fund.beian_hao),
      bucket: bucketOf(fund),
      nav_dates: history.map((point) => point.nav_date),
      source: channel.source,
      source_date: channel.date,
    }
  })

  return buildWeeklyReviewDataStatus({
    variant,
    weeks,
    bucketOrder,
    funds: inputs,
    generatedAt: new Date().toISOString(),
    modeFor: variant === "futures" ? () => "absolute" : metricModeForBucket,
  })
}

export async function getWeeklyReviewDataStatus(
  variant: WeeklyReviewStatusVariant,
  refresh: boolean,
  query: { pools?: WeeklyReviewPoolKey[]; weekEnd?: string } = {},
): Promise<WeeklyReviewDataStatus> {
  const today = shanghaiTodayIsoDate()
  const pools = normalizeWeeklyReviewPools(query.pools ?? ["jy"])
  const asOf = anchorWeekEnd(today, query.weekEnd)
  const key = `ops-weekly-review-status:v3:${variant}:${asOf}:${pools.join(",")}`
  return serveOpsSnapshot(
    key,
    refresh,
    () => buildWeeklyReviewDataStatusReport(variant, today, { pools, weekEnd: asOf }),
  )
}
