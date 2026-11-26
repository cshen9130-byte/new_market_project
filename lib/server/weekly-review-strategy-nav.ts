/**
 * Average NAV of each 周度回顾 strategy, using funds in the selected universe
 * that classify into that strategy. Share classes of one product count once.
 */

import { query, queryUnbounded } from "@/lib/db"
import {
  STRATEGY_NAV_MIN_PRINTS,
  STRATEGY_NAV_UNIVERSE_LABEL,
  STRATEGY_NAV_UNIVERSES,
  assembleStrategyNavCompare,
  buildWeeklyReviewStrategyNav,
  type WeeklyReviewStrategyNav,
  type WeeklyReviewStrategyNavMode,
  type WeeklyReviewStrategyNavStat,
  type WeeklyReviewStrategyNavUniverse,
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
  defaultWeeklyReviewWeekEnd,
  isEquityFund,
  type WeeklyReviewFund,
} from "@/lib/server/jy-weekly-review"
import {
  futuresWeeklyCategories,
  isFuturesWeeklyFund,
} from "@/lib/server/jy-weekly-review-futures"
import { loadStrategyNavUniverseCodes } from "@/lib/server/weekly-review-strategy-nav-universes"

const LOOKBACK_YEARS = 3
const MAX_WEEKLY_MOVE = 0.2
const MAX_GAP_DAYS = 21

type Member = {
  code: string
  bucket: string
  family: string
  rank: number
}

export type WeeklyReviewStrategyNavQuery = {
  universe?: WeeklyReviewStrategyNavUniverse
  mode?: WeeklyReviewStrategyNavMode
  strategy?: string
  weekEnd?: string
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

function weekOf(raw?: string): string {
  const text = (raw ?? "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : defaultWeeklyReviewWeekEnd()
}

async function loadFunds(since: string, codes?: ReadonlySet<string>): Promise<WeeklyReviewFund[]> {
  if (codes && codes.size === 0) return []
  const expr = sqlResolvedStrategyExprs("t6", "i")
  const codeFilter = codes ? "AND UPPER(BTRIM(i.beian_hao)) = ANY($2::text[])" : ""
  const params: unknown[] = [since]
  if (codes) params.push([...codes])
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
       AND NULLIF(BTRIM(i.beian_hao), '') IS NOT NULL
       ${codeFilter}`,
    params,
  )
  const seen = new Set<string>()
  const funds: WeeklyReviewFund[] = []
  for (const row of rows) {
    const code = row.beian_hao.trim()
    const key = code.toUpperCase()
    if (!code || seen.has(key)) continue
    if (codes && !codes.has(key)) continue
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

function relabelMembers(members: Member[], label: string, strategy?: string): Member[] {
  const out: Member[] = []
  const seen = new Set<string>()
  for (const row of members) {
    if (strategy && row.bucket !== strategy) continue
    const code = row.code.trim()
    const key = `${label}\0${code.toUpperCase()}`
    if (!code || seen.has(key)) continue
    seen.add(key)
    out.push({
      code,
      bucket: label,
      family: `${label}\u001f${familyOf(code)}`,
      rank: row.rank,
    })
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

async function membersForUniverse(
  variant: WeeklyReviewStrategyNavVariant,
  universe: WeeklyReviewStrategyNavUniverse,
  since: string,
  weekEnd: string,
): Promise<Member[]> {
  if (universe === "market") {
    return membersFor(variant, await loadFunds(since))
  }
  const codes = await loadStrategyNavUniverseCodes(universe, variant, weekEnd)
  return membersFor(variant, await loadFunds(since, codes))
}

export async function buildWeeklyReviewStrategyNavReport(
  variant: WeeklyReviewStrategyNavVariant,
  today = shanghaiTodayIsoDate(),
  options: WeeklyReviewStrategyNavQuery = {},
): Promise<WeeklyReviewStrategyNav> {
  const since = addYears(today, -LOOKBACK_YEARS)
  const universe = options.universe ?? "market"
  const mode = options.mode === "compare" ? "compare" : "universe"
  const weekEnd = weekOf(options.weekEnd)
  const strategy = (options.strategy ?? "").trim()

  if (mode === "compare") {
    console.time(`[weekly-strategy-nav] ${variant} compare ${strategy}`)
    const allFunds = await loadFunds(since)
    const labeled: Member[] = []
    for (const row of STRATEGY_NAV_UNIVERSES) {
      let funds = allFunds
      if (row.key !== "market") {
        const codes = await loadStrategyNavUniverseCodes(row.key, variant, weekEnd)
        funds = allFunds.filter((fund) => codes.has(fund.beian_hao.trim().toUpperCase()))
      }
      labeled.push(...relabelMembers(membersFor(variant, funds), STRATEGY_NAV_UNIVERSE_LABEL[row.key], strategy))
    }
    const stats = await loadWeekStats(labeled, since, today)
    console.timeEnd(`[weekly-strategy-nav] ${variant} compare ${strategy}`)
    console.log(`[weekly-strategy-nav] ${variant} compare strategy=${strategy} members=${labeled.length} weeks=${stats.length}`)
    return buildWeeklyReviewStrategyNav(variant, stats, { mode, universe, strategy, weekEnd })
  }

  console.time(`[weekly-strategy-nav] ${variant} ${universe}`)
  const members = await membersForUniverse(variant, universe, since, weekEnd)
  const stats = await loadWeekStats(members, since, today)
  console.timeEnd(`[weekly-strategy-nav] ${variant} ${universe}`)
  console.log(`[weekly-strategy-nav] ${variant} ${universe} members=${members.length} weeks=${stats.length}`)
  return buildWeeklyReviewStrategyNav(variant, stats, { mode, universe, weekEnd })
}

function persistOpsSnapshots(): boolean {
  return !(process.platform === "win32" && (process.env.DATABASE_URL || "").includes(":5433/"))
}

export function weeklyReviewStrategyNavSnapshotKey(
  variant: WeeklyReviewStrategyNavVariant,
  options: WeeklyReviewStrategyNavQuery = {},
): string {
  const universe = options.universe ?? "market"
  const weekEnd = weekOf(options.weekEnd)
  if (universe === "market") return `weekly-review-strategy-nav:v3:${variant}`
  if (universe === "xiaohe" || universe === "ima") {
    return `weekly-review-strategy-nav:v4:${variant}:${universe}:${weekEnd}`
  }
  return `weekly-review-strategy-nav:v4:${variant}:${universe}`
}

async function loadUniverseSnapshot(
  variant: WeeklyReviewStrategyNavVariant,
  universe: WeeklyReviewStrategyNavUniverse,
  refresh: boolean,
  weekEnd: string,
): Promise<WeeklyReviewStrategyNav> {
  const options: WeeklyReviewStrategyNavQuery = { universe, mode: "universe", weekEnd }
  const key = weeklyReviewStrategyNavSnapshotKey(variant, options)
  const build = () => buildWeeklyReviewStrategyNavReport(variant, shanghaiTodayIsoDate(), options)
  const body = await serveOpsSnapshot(key, refresh, build, { persist: persistOpsSnapshots() })
  if (body.mode && body.universe) return body
  return { ...body, mode: "universe", universe }
}

export async function getWeeklyReviewStrategyNav(
  variant: WeeklyReviewStrategyNavVariant,
  refresh = false,
  options: WeeklyReviewStrategyNavQuery = {},
): Promise<WeeklyReviewStrategyNav> {
  const universe = options.universe ?? "market"
  const mode = options.mode === "compare" ? "compare" : "universe"
  const weekEnd = weekOf(options.weekEnd)
  if (mode === "compare") {
    const strategy = (options.strategy ?? "").trim()
    const sources: Array<{ universe: WeeklyReviewStrategyNavUniverse; body: WeeklyReviewStrategyNav }> = []
    for (const row of STRATEGY_NAV_UNIVERSES) {
      const body = await loadUniverseSnapshot(variant, row.key, refresh, weekEnd)
      sources.push({ universe: row.key, body })
    }
    return assembleStrategyNavCompare(variant, strategy, weekEnd, sources)
  }
  return loadUniverseSnapshot(variant, universe, refresh, weekEnd)
}

export type WeeklyReviewStrategyNavDailyItem = {
  variant: WeeklyReviewStrategyNavVariant
  universe: WeeklyReviewStrategyNavUniverse
  week_end: string
  key: string
  series: number
  ms: number
}

export type WeeklyReviewStrategyNavDailyResult = {
  skipped?: boolean
  items: WeeklyReviewStrategyNavDailyItem[]
}

async function reportWeekEnd(variant: WeeklyReviewStrategyNavVariant): Promise<string> {
  try {
    const { getLatestReadyWeeklyReviewWeek } = await import("@/lib/server/weekly-review-excel-cache")
    const ready = await getLatestReadyWeeklyReviewWeek(variant)
    const weekEnd = ready?.weekEnd?.slice(0, 10) ?? ""
    if (/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) return weekEnd
  } catch (err) {
    console.error(`[weekly-strategy-nav] ready week for ${variant} skipped:`, err)
  }
  return defaultWeeklyReviewWeekEnd()
}

/** Rebuild every source-universe snapshot the 策略平均净值 chart reads. */
export async function refreshWeeklyReviewStrategyNavDaily(): Promise<WeeklyReviewStrategyNavDailyResult> {
  if (!persistOpsSnapshots()) {
    console.log("[weekly-strategy-nav] skipped: Windows against tunneled production DB")
    return { skipped: true, items: [] }
  }
  const variants: WeeklyReviewStrategyNavVariant[] = ["equity", "futures"]
  const items: WeeklyReviewStrategyNavDailyItem[] = []
  for (const variant of variants) {
    const weekEnd = await reportWeekEnd(variant)
    for (const row of STRATEGY_NAV_UNIVERSES) {
      const started = Date.now()
      const key = weeklyReviewStrategyNavSnapshotKey(variant, { universe: row.key, weekEnd })
      const body = await getWeeklyReviewStrategyNav(variant, true, { universe: row.key, weekEnd })
      items.push({
        variant,
        universe: row.key,
        week_end: weekEnd,
        key,
        series: body.series.length,
        ms: Date.now() - started,
      })
      console.log(
        `[weekly-strategy-nav] ${variant} ${row.key} week=${weekEnd} series=${body.series.length} in ${Date.now() - started}ms`,
      )
    }
  }
  return { items }
}

let running: Promise<void> | null = null

export function runScheduledWeeklyReviewStrategyNav(): void {
  if (running) {
    console.log("[weekly-strategy-nav] daily snapshot already running")
    return
  }
  running = refreshWeeklyReviewStrategyNavDaily()
    .then((result) => {
      console.log(`[weekly-strategy-nav] daily ${JSON.stringify(result)}`)
    })
    .catch((err) => console.error("[weekly-strategy-nav] daily snapshot failed", err))
    .finally(() => {
      running = null
    })
}
