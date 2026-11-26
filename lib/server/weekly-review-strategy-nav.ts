/**
 * Average NAV of each 周度回顾 strategy, using every fund in the database
 * that classifies into that strategy. Share classes of one product count once.
 */

import { query, queryUnbounded } from "@/lib/db"
import {
  STRATEGY_NAV_MIN_PRINTS,
  buildWeeklyReviewStrategyNav,
  type WeeklyReviewStrategyNav,
  type WeeklyReviewStrategyNavStat,
  type WeeklyReviewStrategyNavVariant,
} from "@/lib/ma/weekly-review-strategy-nav"
import { beianFamilyKey } from "@/lib/server/share-class-product"
import {
  sqlResolvedStrategyExprs,
  sqlType6LatestStrategyJoin,
} from "@/lib/server/fund-strategy-resolve"
import { serveOpsSnapshot } from "@/lib/server/ops-overview-snapshot"
import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
import { WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS } from "@/lib/weekly-review-data-status"
import {
  bucketForFund,
  isEquityFund,
  type WeeklyReviewFund,
} from "@/lib/server/jy-weekly-review"
import {
  futuresWeeklyCategories,
  isFuturesWeeklyFund,
} from "@/lib/server/jy-weekly-review-futures"

const LOOKBACK_YEARS = 3
const MAX_WEEKLY_MOVE = 0.2
const MAX_GAP_DAYS = 21

type Member = {
  code: string
  bucket: string
  family: string
  rank: number
}

function addYears(iso: string, years: number): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number)
  const date = new Date(Date.UTC(year + years, month - 1, day))
  return date.toISOString().slice(0, 10)
}

function shareRank(code: string): number {
  const text = code.trim().toUpperCase()
  if (text.endsWith("A")) return 0
  if (text.endsWith("B")) return 1
  if (text.endsWith("C")) return 2
  return 3
}

function familyOf(code: string): string {
  return beianFamilyKey(code) || code.trim().toUpperCase()
}

async function loadFunds(since: string): Promise<WeeklyReviewFund[]> {
  const expr = sqlResolvedStrategyExprs("t6", "i")
  const rows = await query<{
    beian_hao: string
    product_name: string | null
    l1: string | null
    l2: string | null
    l3: string | null
  }>(
    `SELECT BTRIM(i.beian_hao) AS beian_hao,
            COALESCE(i.product_name, '') AS product_name,
            ${expr.l1} AS l1,
            ${expr.l2} AS l2,
            ${expr.l3} AS l3
     FROM private_fund_info i
     ${sqlType6LatestStrategyJoin("i.beian_hao", "t6")}
     WHERE i.latest_nav_date >= $1::date
       AND NULLIF(BTRIM(i.beian_hao), '') IS NOT NULL`,
    [since],
  )
  const seen = new Set<string>()
  const funds: WeeklyReviewFund[] = []
  for (const row of rows) {
    const code = row.beian_hao.trim()
    const key = code.toUpperCase()
    if (!code || seen.has(key)) continue
    seen.add(key)
    funds.push({
      beian_hao: code,
      product_name: row.product_name ?? "",
      short_name: null,
      l1: row.l1,
      l2: row.l2,
      l3: row.l3,
    })
  }
  return funds
}

function pushMember(out: Member[], seen: Set<string>, fund: WeeklyReviewFund, bucket: string) {
  const name = bucket.trim()
  if (!name || name === "未分类" || WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS.has(name)) return
  const code = fund.beian_hao.trim()
  if (!code) return
  const key = `${name}\0${code.toUpperCase()}`
  if (seen.has(key)) return
  seen.add(key)
  out.push({
    code,
    bucket: name,
    family: `${name}\u001f${familyOf(code)}`,
    rank: shareRank(code),
  })
}

function membersFor(variant: WeeklyReviewStrategyNavVariant, funds: WeeklyReviewFund[]): Member[] {
  const out: Member[] = []
  const seen = new Set<string>()
  if (variant === "futures") {
    for (const fund of funds) {
      if (!isFuturesWeeklyFund(fund)) continue
      for (const bucket of futuresWeeklyCategories(fund)) pushMember(out, seen, fund, bucket)
    }
    return out
  }
  for (const fund of funds) {
    if (!isEquityFund(fund)) continue
    pushMember(out, seen, fund, bucketForFund(fund))
  }
  return out
}

async function loadWeekStats(members: Member[], since: string, until: string): Promise<WeeklyReviewStrategyNavStat[]> {
  if (members.length === 0) return []
  const rows = await queryUnbounded<{
    bucket: string
    week_end: string
    avg_ret: number | string | null
    n: number | string
    funds: number | string
  }>(
    `WITH members AS (
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS t(code, bucket, family, rank)
     ),
     weekly AS (
       SELECT m.bucket,
              m.family,
              m.code,
              m.rank,
              LEAST((date_trunc('week', n.price_date)::date + 4), $6::date) AS week_end,
              (array_agg(n.cumulative_nav::float8 ORDER BY n.price_date DESC))[1] AS nav
       FROM private_fund_nav n
       JOIN members m ON n.beian_hao = m.code
       WHERE n.price_date >= $5::date
         AND n.price_date <= $6::date
         AND n.cumulative_nav IS NOT NULL
         AND n.cumulative_nav::float8 > 0
       GROUP BY 1, 2, 3, 4, 5
     ),
     best AS (
       SELECT DISTINCT ON (bucket, family) bucket, family, code
       FROM (
         SELECT bucket, family, code, rank, count(*) AS points
         FROM weekly
         GROUP BY 1, 2, 3, 4
       ) coverage
       ORDER BY bucket, family, points DESC, rank ASC, code
     ),
     chosen AS (
       SELECT w.bucket, w.code, w.week_end, w.nav
       FROM weekly w
       JOIN best b ON b.bucket = w.bucket AND b.family = w.family AND b.code = w.code
     ),
     ordered AS (
       SELECT bucket,
              code,
              week_end,
              nav,
              lag(nav) OVER (PARTITION BY bucket, code ORDER BY week_end) AS prev_nav,
              lag(week_end) OVER (PARTITION BY bucket, code ORDER BY week_end) AS prev_week
       FROM chosen
     ),
     rets AS (
       SELECT bucket, code, week_end, nav / prev_nav - 1 AS ret
       FROM ordered
       WHERE prev_nav > 0
         AND (week_end - prev_week) <= $7::int
         AND abs(nav / prev_nav - 1) <= $8::float8
     )
     SELECT r.bucket,
            r.week_end::text AS week_end,
            avg(r.ret)::float8 AS avg_ret,
            count(*)::int AS n,
            c.funds
     FROM rets r
     JOIN (
       SELECT bucket, count(DISTINCT code)::int AS funds
       FROM rets
       GROUP BY 1
     ) c ON c.bucket = r.bucket
     GROUP BY r.bucket, r.week_end, c.funds
     HAVING count(*) >= $9::int
     ORDER BY r.bucket, r.week_end`,
    [
      members.map((row) => row.code),
      members.map((row) => row.bucket),
      members.map((row) => row.family),
      members.map((row) => row.rank),
      since,
      until,
      MAX_GAP_DAYS,
      MAX_WEEKLY_MOVE,
      STRATEGY_NAV_MIN_PRINTS,
    ],
  )
  const out: WeeklyReviewStrategyNavStat[] = []
  for (const row of rows) {
    const avgRet = typeof row.avg_ret === "number" ? row.avg_ret : Number(row.avg_ret)
    const n = Number(row.n)
    const funds = Number(row.funds)
    const week = String(row.week_end ?? "").slice(0, 10)
    if (!row.bucket || !/^\d{4}-\d{2}-\d{2}$/.test(week)) continue
    if (!Number.isFinite(avgRet) || !Number.isFinite(n) || !Number.isFinite(funds)) continue
    out.push({ bucket: row.bucket, week, avgRet, n, funds })
  }
  return out
}

export async function buildWeeklyReviewStrategyNavReport(
  variant: WeeklyReviewStrategyNavVariant,
  today = shanghaiTodayIsoDate(),
): Promise<WeeklyReviewStrategyNav> {
  const since = addYears(today, -LOOKBACK_YEARS)
  console.time(`[weekly-strategy-nav] ${variant}`)
  const funds = await loadFunds(since)
  const members = membersFor(variant, funds)
  const stats = await loadWeekStats(members, since, today)
  console.timeEnd(`[weekly-strategy-nav] ${variant}`)
  console.log(`[weekly-strategy-nav] ${variant} funds=${funds.length} members=${members.length} weeks=${stats.length}`)
  return buildWeeklyReviewStrategyNav(variant, stats)
}

export async function getWeeklyReviewStrategyNav(
  variant: WeeklyReviewStrategyNavVariant,
  refresh = false,
): Promise<WeeklyReviewStrategyNav> {
  const key = `weekly-review-strategy-nav:v3:${variant}`
  return serveOpsSnapshot(key, refresh, () => buildWeeklyReviewStrategyNavReport(variant))
}
