/**
 * 更新渠道：fof99 订阅方式与每周抓取，邮箱净值覆盖与每周写入。
 *
 * 有净值产品 = private_fund_info.latest_nav 有值。
 * 跟踪池 = JY tracking_pool。
 * 火富牛「已纳入」= fof99_nav_universe 的跟踪方式。
 * 一周从周一开始，按 Asia/Shanghai。上周是已经结束的那一周。
 * 周五任务 = fri-pm / fri-late / 按净值日分批的 FundMultiPrice。1970-01-01 探测不计入。
 */

import { query } from "@/lib/db"
import { listTeamUpdateCodes, type TeamUpdateCode } from "@/lib/server/team-data-query-pg"
import { withListResponseCache } from "@/lib/server/list-response-cache"
import { serveOpsSnapshot } from "@/lib/server/ops-overview-snapshot"
import { shanghaiToday } from "@/lib/ops-data-overview"
import { sqlBeianFamilyKey } from "@/lib/server/share-class-product"
import { sqlFundNameBase } from "@/lib/server/fund-name-match"
import {
  FOF99_LIST_COVERAGE,
  FOF99_POLICY_ROWS,
  addIsoDays,
  EMAIL_STALE_LIST_LABEL,
  buildEmailCohort,
  buildEmailCountBridge,
  buildFof99Cohort,
  buildUniverseMoves,
  emptyEmailCohortCounts,
  emptyFof99CohortCounts,
  formatCnMonthDay,
  formatWeekLabel,
  mondayOf,
  type EmailBridgeRecord,
  type EmailBridgeTeam,
  type EmailCohortCounts,
  type EmailCohortKey,
  type EmailCountBridge,
  type EmailProductStatus,
  type EmailStaleListKey,
  type EmailStaleListResponse,
  type EmailStaleProduct,
  type Fof99CohortCounts,
  type Fof99CohortKey,
  type Fof99ProductStatus,
  type Fof99RecentListPolicy,
  type Fof99RecentListProduct,
  type Fof99RecentListResponse,
  type Fof99StaleListResponse,
  type UpdateChannel,
  type UpdateChannelResponse,
  type UpdateCoverageBlock,
  type UpdateCoverageRow,
  type UpdateVerdictTone,
  type UpdateWeekStat,
} from "@/lib/ops-update-channel"

type PolicyCount = { scope: string; policy: string; n: number }

type FofWeekRow = {
  wk: string
  products: number
  ok_products: number
  empty_products: number
  error_products: number
  ok_rows: number
  empty_rows: number
  error_rows: number
  batches: number
  min_d: string | null
  max_d: string | null
  backfill_products: number
  backfill_ok_rows: number
  backfill_empty_rows: number
  backfill_error_rows: number
}

type EmailWeekRow = {
  wk: string
  records: number
  products: number
  emails: number
  null_nav: number
  pool_products: number
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function day(value: unknown): string | null {
  if (value == null || value === "") return null
  const text = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function zh(n: number): string {
  return n.toLocaleString("zh-CN")
}

function emptyWeek(start: string, inProgress: boolean): UpdateWeekStat {
  return {
    week_start: start,
    week_end: addIsoDays(start, 6),
    label: formatWeekLabel(start),
    in_progress: inProgress,
    products: 0,
    ok_products: 0,
    empty_products: 0,
    error_products: 0,
    ok_rows: 0,
    empty_rows: 0,
    error_rows: 0,
    batches: 0,
    min_date: null,
    max_date: null,
    backfill_products: 0,
    backfill_ok_rows: 0,
    backfill_empty_rows: 0,
    backfill_error_rows: 0,
    records: 0,
    emails: 0,
    null_nav: 0,
    pool_products: 0,
  }
}

function shareRows(
  total: number,
  counts: Map<string, number>,
  spec: Array<{ key: string; label: string; hint: string }>,
): UpdateCoverageRow[] {
  return spec.map((item) => {
    const count = counts.get(item.key) ?? 0
    return {
      key: item.key,
      label: item.label,
      hint: item.hint,
      count,
      share: total > 0 ? count / total : 0,
    }
  })
}

function coverageBlocks(rows: PolicyCount[], channel: UpdateChannel): UpdateCoverageBlock[] {
  const spec = channel === "fof99"
    ? FOF99_POLICY_ROWS
    : [
        { key: "email", label: "有邮箱净值", hint: "至少有一条带备案号的邮箱净值" },
        { key: "none", label: "未收到", hint: "还没有对上备案号的邮箱净值" },
      ]
  return (["nav", "pool"] as const).map((scope) => {
    const counts = new Map<string, number>()
    let total = 0
    for (const row of rows) {
      if (row.scope !== scope) continue
      const count = num(row.n)
      counts.set(row.policy, count)
      total += count
    }
    const items = shareRows(total, counts, spec)
    const subscribed = channel === "fof99"
      ? total - (counts.get("none") ?? 0)
      : counts.get("email") ?? 0
    const title = scope === "nav" ? "有净值的产品" : "跟踪池"
    return {
      key: scope,
      title,
      total,
      subscribed,
      summary: coverageSummary(channel, title, total, subscribed, items),
      rows: items,
    }
  })
}

function coverageSummary(
  channel: UpdateChannel,
  title: string,
  total: number,
  subscribed: number,
  rows: UpdateCoverageRow[],
): string {
  const pct = total > 0 ? `${((subscribed / total) * 100).toFixed(1)}%` : "0%"
  if (channel === "email") {
    return `${title} ${zh(total)} 只，其中 ${zh(subscribed)} 只（${pct}）已经有邮箱净值。`
  }
  const by = (key: string) => rows.find((row) => row.key === key)?.count ?? 0
  return `${title} ${zh(total)} 只，已纳入火富牛 ${zh(subscribed)} 只（${pct}）。每周拉取 ${zh(by("weekly"))} 只，邮件优先 ${zh(by("weekly_plus"))} 只，更新偏慢 ${zh(by("update_slow"))} 只，确认无序列 ${zh(by("skip"))} 只，未纳入 ${zh(by("none"))} 只。`
}

const FOF99_COVERAGE_SQL = `
WITH nav AS (
  SELECT DISTINCT UPPER(BTRIM(beian_hao)) AS code
  FROM private_fund_info
  WHERE latest_nav IS NOT NULL AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL
),
pool AS (
  SELECT DISTINCT UPPER(BTRIM(register_number)) AS code
  FROM tracking_pool
  WHERE NULLIF(BTRIM(register_number), '') IS NOT NULL
),
uni AS (
  SELECT UPPER(BTRIM(reg_code)) AS code, policy
  FROM fof99_nav_universe
)
SELECT 'nav' AS scope, COALESCE(u.policy, 'none') AS policy, COUNT(*)::int AS n
FROM nav n
LEFT JOIN uni u ON u.code = n.code
GROUP BY 2
UNION ALL
SELECT 'pool', COALESCE(u.policy, 'none'), COUNT(*)::int
FROM pool p
LEFT JOIN uni u ON u.code = p.code
GROUP BY 2
`

const EMAIL_COVERAGE_SQL = `
WITH email AS (
  SELECT DISTINCT UPPER(BTRIM(product_code)) AS code
  FROM ops_email_nav_records
  WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
    AND nav IS NOT NULL
),
nav AS (
  SELECT DISTINCT UPPER(BTRIM(beian_hao)) AS code
  FROM private_fund_info
  WHERE latest_nav IS NOT NULL AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL
),
pool AS (
  SELECT DISTINCT UPPER(BTRIM(register_number)) AS code
  FROM tracking_pool
  WHERE NULLIF(BTRIM(register_number), '') IS NOT NULL
)
SELECT 'nav' AS scope, 'email' AS policy, COUNT(*)::int AS n
FROM nav n JOIN email e ON e.code = n.code
UNION ALL
SELECT 'nav', 'none', COUNT(*)::int
FROM nav n LEFT JOIN email e ON e.code = n.code
WHERE e.code IS NULL
UNION ALL
SELECT 'pool', 'email', COUNT(*)::int
FROM pool p JOIN email e ON e.code = p.code
UNION ALL
SELECT 'pool', 'none', COUNT(*)::int
FROM pool p LEFT JOIN email e ON e.code = p.code
WHERE e.code IS NULL
`

const FOF99_WEEKS_SQL = `
WITH tagged AS (
  SELECT
    date_trunc('week', fetched_at AT TIME ZONE 'Asia/Shanghai')::date AS wk,
    UPPER(BTRIM(reg_code)) AS code,
    status,
    NULLIF(BTRIM(batch_id), '') AS batch_id,
    price_date,
    CASE
      WHEN price_date <= DATE '1970-01-02' THEN 'probe'
      WHEN batch_id LIKE 'fri-pm-%'
        OR batch_id LIKE 'fri-late-%'
        OR batch_id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$' THEN 'friday'
      ELSE 'backfill'
    END AS kind
  FROM fof99_nav_fetch_log
  WHERE fetched_at >= (NOW() AT TIME ZONE 'Asia/Shanghai') - INTERVAL '20 weeks'
),
friday_code AS (
  SELECT
    wk,
    code,
    BOOL_OR(status = 'ok') AS has_ok,
    BOOL_OR(status = 'no_data') AS has_empty,
    BOOL_OR(status = 'error') AS has_error,
    MIN(price_date) FILTER (WHERE price_date > DATE '2020-01-01') AS min_d,
    MAX(price_date) FILTER (WHERE price_date > DATE '2020-01-01') AS max_d
  FROM tagged
  WHERE kind = 'friday'
  GROUP BY wk, code
),
friday_week AS (
  SELECT
    wk,
    COUNT(*)::int AS products,
    COUNT(*) FILTER (WHERE has_ok)::int AS ok_products,
    COUNT(*) FILTER (WHERE NOT has_ok AND NOT has_error AND has_empty)::int AS empty_products,
    COUNT(*) FILTER (WHERE NOT has_ok AND has_error)::int AS error_products,
    MIN(min_d) AS min_d,
    MAX(max_d) AS max_d
  FROM friday_code
  GROUP BY wk
),
friday_rows AS (
  SELECT
    wk,
    COUNT(*) FILTER (WHERE status = 'ok')::int AS ok_rows,
    COUNT(*) FILTER (WHERE status = 'no_data')::int AS empty_rows,
    COUNT(*) FILTER (WHERE status = 'error')::int AS error_rows,
    COUNT(DISTINCT batch_id)::int AS batches
  FROM tagged
  WHERE kind = 'friday'
  GROUP BY wk
),
backfill AS (
  SELECT
    wk,
    COUNT(DISTINCT code)::int AS products,
    COUNT(*) FILTER (WHERE status = 'ok')::int AS ok_rows,
    COUNT(*) FILTER (WHERE status = 'no_data')::int AS empty_rows,
    COUNT(*) FILTER (WHERE status = 'error')::int AS error_rows
  FROM tagged
  WHERE kind = 'backfill'
  GROUP BY wk
)
SELECT
  COALESCE(f.wk, r.wk, b.wk)::text AS wk,
  COALESCE(f.products, 0)::int AS products,
  COALESCE(f.ok_products, 0)::int AS ok_products,
  COALESCE(f.empty_products, 0)::int AS empty_products,
  COALESCE(f.error_products, 0)::int AS error_products,
  COALESCE(r.ok_rows, 0)::int AS ok_rows,
  COALESCE(r.empty_rows, 0)::int AS empty_rows,
  COALESCE(r.error_rows, 0)::int AS error_rows,
  COALESCE(r.batches, 0)::int AS batches,
  f.min_d::text AS min_d,
  f.max_d::text AS max_d,
  COALESCE(b.products, 0)::int AS backfill_products,
  COALESCE(b.ok_rows, 0)::int AS backfill_ok_rows,
  COALESCE(b.empty_rows, 0)::int AS backfill_empty_rows,
  COALESCE(b.error_rows, 0)::int AS backfill_error_rows
FROM friday_week f
FULL JOIN friday_rows r USING (wk)
FULL JOIN backfill b USING (wk)
ORDER BY 1
`

const EMAIL_WEEKS_SQL = `
WITH weeks AS (
  SELECT
    date_trunc('week', created_at AT TIME ZONE 'Asia/Shanghai')::date AS wk,
    UPPER(BTRIM(product_code)) AS code,
    nav,
    email_uid
  FROM ops_email_nav_records
  WHERE created_at >= (NOW() AT TIME ZONE 'Asia/Shanghai') - INTERVAL '20 weeks'
),
pool AS (
  SELECT DISTINCT UPPER(BTRIM(register_number)) AS code
  FROM tracking_pool
  WHERE NULLIF(BTRIM(register_number), '') IS NOT NULL
)
SELECT
  w.wk::text AS wk,
  COUNT(*)::int AS records,
  COUNT(DISTINCT w.code) FILTER (WHERE NULLIF(w.code, '') IS NOT NULL)::int AS products,
  COUNT(DISTINCT w.email_uid)::int AS emails,
  COUNT(*) FILTER (WHERE w.nav IS NULL)::int AS null_nav,
  COUNT(DISTINCT w.code) FILTER (WHERE p.code IS NOT NULL)::int AS pool_products
FROM weeks w
LEFT JOIN pool p ON p.code = w.code AND NULLIF(w.code, '') IS NOT NULL
GROUP BY w.wk
ORDER BY w.wk
`

function fofWeek(row: FofWeekRow, thisWeek: string): UpdateWeekStat {
  const start = day(row.wk) ?? String(row.wk).slice(0, 10)
  return {
    ...emptyWeek(start, start === thisWeek),
    products: num(row.products),
    ok_products: num(row.ok_products),
    empty_products: num(row.empty_products),
    error_products: num(row.error_products),
    ok_rows: num(row.ok_rows),
    empty_rows: num(row.empty_rows),
    error_rows: num(row.error_rows),
    batches: num(row.batches),
    min_date: day(row.min_d),
    max_date: day(row.max_d),
    backfill_products: num(row.backfill_products),
    backfill_ok_rows: num(row.backfill_ok_rows),
    backfill_empty_rows: num(row.backfill_empty_rows),
    backfill_error_rows: num(row.backfill_error_rows),
  }
}

function emailWeek(row: EmailWeekRow, thisWeek: string): UpdateWeekStat {
  const start = day(row.wk) ?? String(row.wk).slice(0, 10)
  const products = num(row.products)
  return {
    ...emptyWeek(start, start === thisWeek),
    products,
    ok_products: products,
    records: num(row.records),
    emails: num(row.emails),
    null_nav: num(row.null_nav),
    pool_products: num(row.pool_products),
  }
}

function fofVerdict(week: UpdateWeekStat): { verdict: string; tone: UpdateVerdictTone } {
  if (week.products === 0 && week.backfill_products === 0) {
    return { verdict: "上周没有抓取", tone: "warn" }
  }
  if (week.products === 0) {
    return { verdict: "上周没有周五任务", tone: "warn" }
  }
  if (week.error_products > 0 || week.error_rows > 0) {
    return { verdict: "有接口失败", tone: "bad" }
  }
  if (week.empty_products / week.products >= 0.15) {
    return { verdict: "空返回偏多", tone: "warn" }
  }
  return { verdict: "正常", tone: "ok" }
}

function emailVerdict(week: UpdateWeekStat): { verdict: string; tone: UpdateVerdictTone } {
  if (week.records === 0) return { verdict: "上周没有新邮件净值", tone: "warn" }
  if (week.records > 0 && week.null_nav / week.records >= 0.05) {
    return { verdict: "有些行没有净值", tone: "warn" }
  }
  return { verdict: "正常", tone: "ok" }
}

function dateSpan(week: UpdateWeekStat): string {
  if (!week.min_date && !week.max_date) return ""
  if (week.min_date === week.max_date) return formatCnMonthDay(week.min_date)
  return `${formatCnMonthDay(week.min_date)}至${formatCnMonthDay(week.max_date)}`
}

function fofHeadline(week: UpdateWeekStat, previous: UpdateWeekStat | null): string {
  const when = `上周（${week.label}）`
  if (week.products === 0 && week.backfill_products === 0) {
    return `${when}没有火富牛抓取记录。`
  }
  if (week.products === 0) {
    return `${when}没有周五任务。另有补历史 ${zh(week.backfill_products)} 只，成功 ${zh(week.backfill_ok_rows)} 条，空返回 ${zh(week.backfill_empty_rows)} 条，失败 ${zh(week.backfill_error_rows)} 条。`
  }
  const span = dateSpan(week)
  let text = `${when}火富牛周五任务覆盖 ${zh(week.products)} 只产品，${zh(week.ok_products)} 只拿到净值，${zh(week.empty_products)} 只只有空返回，失败 ${zh(week.error_products)} 只。`
  text += `成功 ${zh(week.ok_rows)} 条，空返回 ${zh(week.empty_rows)} 条，调用 ${zh(week.batches)} 批。`
  if (span) text += `净值日 ${span}。`
  if (week.backfill_products > 0) {
    text += `另外补历史 ${zh(week.backfill_products)} 只。`
  }
  if (previous && previous.products > 0) {
    text += `再往前一周（${previous.label}）周五任务是 ${zh(previous.products)} 只。`
  }
  return text
}

function emailHeadline(week: UpdateWeekStat, previous: UpdateWeekStat | null): string {
  const when = `上周（${week.label}）`
  if (week.records === 0) return `${when}没有新写入的邮箱净值。`
  let text = `${when}邮箱写入 ${zh(week.records)} 条净值，${zh(week.products)} 只产品，${zh(week.emails)} 封邮件。跟踪池里 ${zh(week.pool_products)} 只这周有新邮件净值。无净值的行 ${zh(week.null_nav)} 条。`
  if (previous && previous.products > 0) {
    text += `再往前一周是 ${zh(previous.products)} 只产品。`
  }
  return text
}

function fillWeekGaps(history: UpdateWeekStat[], thisWeek: string): UpdateWeekStat[] {
  if (history.length === 0) return history
  const byStart = new Map(history.map((week) => [week.week_start, week]))
  const end = history[history.length - 1].week_start
  const filled: UpdateWeekStat[] = []
  for (let cursor = history[0].week_start; cursor <= end; cursor = addIsoDays(cursor, 7)) {
    filled.push(byStart.get(cursor) ?? emptyWeek(cursor, cursor === thisWeek))
  }
  return filled
}

function currentNote(channel: UpdateChannel, week: UpdateWeekStat | null): string {
  if (!week) return ""
  if (channel === "fof99") {
    if (week.products === 0 && week.backfill_products === 0) return ""
    if (week.products === 0) {
      return `本周（${week.label}）周五任务还没跑，另有补历史 ${zh(week.backfill_products)} 只。`
    }
    return `本周（${week.label}，进行中）周五任务已覆盖 ${zh(week.products)} 只，拿到净值 ${zh(week.ok_products)} 只，失败 ${zh(week.error_products)} 只。`
  }
  if (week.records === 0) return ""
  return `本周（${week.label}，进行中）已写入 ${zh(week.records)} 条，${zh(week.products)} 只产品，跟踪池 ${zh(week.pool_products)} 只。`
}

type MoveTotals = {
  added: number
  added_still_weekly: number
  moved_slow: number
  moved_still_slow: number
}

type AdmitDay = { ran_on: string; added: number }

type SlowDay = { ran_on: string; moved: number; fridays: string | null }

const FOF99_MOVE_TOTALS_SQL = `
SELECT
  COUNT(*) FILTER (WHERE reason LIKE 'new fund inception%')::int AS added,
  COUNT(*) FILTER (WHERE reason LIKE 'new fund inception%' AND policy = 'weekly')::int AS added_still_weekly,
  COUNT(*) FILTER (WHERE reason LIKE '3 consecutive weekly Fridays empty%')::int AS moved_slow,
  COUNT(*) FILTER (WHERE reason LIKE '3 consecutive weekly Fridays empty%' AND policy = 'update_slow')::int AS moved_still_slow
FROM fof99_nav_universe
`

const FOF99_ADMIT_DAYS_SQL = `
SELECT (listed_at AT TIME ZONE 'Asia/Shanghai')::date::text AS ran_on,
       COUNT(*)::int AS added
FROM fof99_nav_universe
WHERE reason LIKE 'new fund inception%'
GROUP BY 1
ORDER BY 1
`

const FOF99_SLOW_DAYS_SQL = `
SELECT (updated_at AT TIME ZONE 'Asia/Shanghai')::date::text AS ran_on,
       substring(reason from '\\(([^)]+)\\)') AS fridays,
       COUNT(*)::int AS moved
FROM fof99_nav_universe
WHERE reason LIKE '3 consecutive weekly Fridays empty%'
GROUP BY 1, 2
ORDER BY 1
`

async function buildFof99(thisWeek: string, lastWeek: string): Promise<UpdateChannelResponse> {
  const [coverageRows, weekRows, totalsRows, admitRows, slowRows, cohortRows] = await Promise.all([
    query<PolicyCount>(FOF99_COVERAGE_SQL),
    query<FofWeekRow>(FOF99_WEEKS_SQL),
    query<MoveTotals>(FOF99_MOVE_TOTALS_SQL),
    query<AdmitDay>(FOF99_ADMIT_DAYS_SQL),
    query<SlowDay>(FOF99_SLOW_DAYS_SQL),
    query<Fof99CohortRow>(fof99ProductStatusSql(lastWeek)),
  ])
  const history = fillWeekGaps(weekRows.map((row) => fofWeek(row, thisWeek)), thisWeek)
  const last = history.find((row) => row.week_start === lastWeek) ?? emptyWeek(lastWeek, false)
  const current = history.find((row) => row.week_start === thisWeek) ?? null
  const previous = [...history].reverse().find((row) => row.week_start < lastWeek && row.products > 0) ?? null
  const verdict = fofVerdict(last)
  const note = currentNote("fof99", current)
  return {
    channel: "fof99",
    generated_at: new Date().toISOString(),
    headline: `${fofHeadline(last, previous)}${note ? ` ${note}` : ""}`,
    verdict: verdict.verdict,
    verdict_tone: verdict.tone,
    coverage: coverageBlocks(coverageRows, "fof99"),
    last_week: last,
    current_week: current && (current.products > 0 || current.backfill_products > 0) ? current : null,
    history,
    list_coverage: FOF99_LIST_COVERAGE,
    email_products: null,
    fof99_products: fof99ProductStatus(cohortRows),
    email_count_bridge: null,
    universe_moves: buildUniverseMoves(
      totalsRows[0] ?? { added: 0, added_still_weekly: 0, moved_slow: 0, moved_still_slow: 0 },
      admitRows,
      slowRows,
    ),
  }
}

type EmailCohortRow = EmailCohortCounts & { cohort: string }

function sqlDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("bad week")
  return iso
}

/** Same product after dropping 份额 / A类份额 and the legal fund suffix. */
function sqlLagFundNameKey(nameExpr: string): string {
  return sqlFundNameBase(`regexp_replace(BTRIM(${nameExpr}), '(类)?份额$', '')`)
}

/**
 * Ever-emailed products, and the subset written last week.
 * Freshness windows match `emailFreshnessBucket`.
 * Latest date is the later of email, manual, fof99, and the product-page date.
 * The product-page date is the later of `private_fund_info.latest_nav_date`,
 * the detail NAV cache tip (the chart the product page serves), and the
 * tracking / FOF / managed list dates the page header uses.
 * A main fund and its A/B/C shares share one judging date: the latest of those
 * dates anywhere in the 备案号 family. The same fund name on another 备案号
 * counts too, so a stale alias does not stay lagged when the product page is current.
 * One current share keeps the whole product out of the lag buckets.
 * The winning channel compares only email, manual, and fof99 on this 备案号.
 * Same day: manual, then email.
 */
function navSourceCtes(lastWeek: string): string {
  const week = sqlDate(lastWeek)
  return `
today AS (
  SELECT (timezone('Asia/Shanghai', now()))::date AS d
),
email_base AS (
  SELECT
    UPPER(BTRIM(product_code)) AS code,
    BOOL_OR(date_trunc('week', created_at AT TIME ZONE 'Asia/Shanghai')::date = DATE '${week}') AS in_last_week,
    (MAX(nav_date) FILTER (
      WHERE nav IS NOT NULL AND nav_date IS NOT NULL AND nav_date > DATE '1970-01-01'
    ))::date AS nav_d
  FROM ops_email_nav_records
  WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
  GROUP BY 1
),
manual_nav AS (
  SELECT UPPER(BTRIM(beian_hao)) AS code, MAX(nav_date)::date AS d
  FROM ops_team_nav_manual
  WHERE unit_nav IS NOT NULL
    AND nav_date IS NOT NULL
    AND nav_type = 'pre_fee'
    AND nav_date > DATE '1970-01-01'
    AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL
  GROUP BY 1
),
val AS (
  SELECT
    UPPER(BTRIM(product_code)) AS code,
    (MAX(valuation_date) FILTER (
      WHERE COALESCE(source, '') = 'manual_upload'
         OR COALESCE(crawl_email_account, '') = 'team_manual_upload'
    ))::date AS manual_d,
    (MAX(valuation_date) FILTER (
      WHERE NOT (
        COALESCE(source, '') = 'manual_upload'
        OR COALESCE(crawl_email_account, '') = 'team_manual_upload'
      )
    ))::date AS email_d
  FROM ops_email_valuation_records
  WHERE valuation_date IS NOT NULL
    AND valuation_date > DATE '1970-01-01'
    AND NULLIF(BTRIM(product_code), '') IS NOT NULL
  GROUP BY 1
),
fof AS (
  SELECT UPPER(BTRIM(reg_code)) AS code, MAX(price_date)::date AS d
  FROM fof99_nav_fetch_log
  WHERE status = 'ok'
    AND price_date > DATE '1970-01-01'
    AND NULLIF(BTRIM(reg_code), '') IS NOT NULL
  GROUP BY 1
),
uni AS (
  SELECT DISTINCT ON (code) code, policy
  FROM (
    SELECT UPPER(BTRIM(reg_code)) AS code, policy
    FROM fof99_nav_universe
    WHERE NULLIF(BTRIM(reg_code), '') IS NOT NULL
  ) s
  ORDER BY code
),
page AS (
  SELECT code, MAX(d) AS d
  FROM (
    SELECT UPPER(BTRIM(beian_hao)) AS code, latest_nav_date::date AS d
    FROM private_fund_info
    WHERE latest_nav_date IS NOT NULL
      AND latest_nav_date > DATE '1970-01-01'
      AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), tip_nav_date::date
    FROM ops_private_fund_detail_nav_cache
    WHERE tip_nav_date IS NOT NULL
      AND tip_nav_date > DATE '1970-01-01'
      AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), nav_date::date
    FROM ops_tracking_funds_list_cache
    WHERE nav_date IS NOT NULL
      AND nav_date > DATE '1970-01-01'
      AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), nav_date::date
    FROM ops_managed_products_list_cache
    WHERE nav_date IS NOT NULL
      AND nav_date > DATE '1970-01-01'
      AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), nav_date::date
    FROM ops_fof_overview_list_cache
    WHERE nav_date IS NOT NULL
      AND nav_date > DATE '1970-01-01'
      AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL
  ) s
  WHERE code <> ''
  GROUP BY code
),
code_latest AS (
  SELECT code, MAX(d) AS d
  FROM (
    SELECT code, nav_d AS d FROM email_base
    UNION ALL
    SELECT code, d FROM manual_nav
    UNION ALL
    SELECT code, email_d FROM val
    UNION ALL
    SELECT code, manual_d FROM val
    UNION ALL
    SELECT code, d FROM fof
    UNION ALL
    SELECT code, d FROM page
  ) s
  WHERE code <> '' AND d IS NOT NULL
  GROUP BY code
),
family_latest AS (
  SELECT family, MAX(d) AS d
  FROM (
    SELECT ${sqlBeianFamilyKey("code")} AS family, d
    FROM code_latest
  ) s
  WHERE family IS NOT NULL
  GROUP BY family
),
email_name AS (
  SELECT UPPER(BTRIM(product_code)) AS code, MAX(BTRIM(fund_name)) AS name
  FROM ops_email_nav_records
  WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
    AND NULLIF(BTRIM(fund_name), '') IS NOT NULL
  GROUP BY 1
),
code_name AS (
  SELECT DISTINCT ON (code) code, name_key
  FROM (
    SELECT UPPER(BTRIM(beian_hao)) AS code, ${sqlLagFundNameKey("product_name")} AS name_key, 1 AS pri
    FROM private_fund_info
    WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
      AND NULLIF(BTRIM(product_name), '') IS NOT NULL
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), ${sqlLagFundNameKey("product_name")}, 2
    FROM private_fund_info_bfl
    WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
      AND NULLIF(BTRIM(product_name), '') IS NOT NULL
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), ${sqlLagFundNameKey("product_name")}, 3
    FROM ops_private_fund_detail_nav_cache
    WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
      AND NULLIF(BTRIM(product_name), '') IS NOT NULL
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), ${sqlLagFundNameKey("product_name")}, 4
    FROM ops_tracking_funds_list_cache
    WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
      AND NULLIF(BTRIM(product_name), '') IS NOT NULL
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), ${sqlLagFundNameKey("product_name")}, 4
    FROM ops_managed_products_list_cache
    WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
      AND NULLIF(BTRIM(product_name), '') IS NOT NULL
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), ${sqlLagFundNameKey("product_name")}, 4
    FROM ops_fof_overview_list_cache
    WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
      AND NULLIF(BTRIM(product_name), '') IS NOT NULL
    UNION ALL
    SELECT code, ${sqlLagFundNameKey("name")}, 5
    FROM email_name
  ) s
  WHERE code <> ''
    AND name_key IS NOT NULL
    AND char_length(name_key) >= 4
    AND name_key ~ '[一-龥]'
  ORDER BY code, pri
),
name_latest AS (
  SELECT n.name_key, MAX(c.d) AS d
  FROM code_latest c
  JOIN code_name n ON n.code = c.code
  GROUP BY n.name_key
),
pool AS (
  SELECT DISTINCT UPPER(BTRIM(register_number)) AS code
  FROM tracking_pool
  WHERE NULLIF(BTRIM(register_number), '') IS NOT NULL
),
universe AS (
  SELECT DISTINCT ON (code) code, product_name, policy
  FROM (
    SELECT UPPER(BTRIM(reg_code)) AS code,
           BTRIM(product_name) AS product_name,
           policy
    FROM fof99_nav_universe
    WHERE NULLIF(BTRIM(reg_code), '') IS NOT NULL
  ) s
  ORDER BY code
),
last_ok AS (
  SELECT DISTINCT UPPER(BTRIM(reg_code)) AS code
  FROM fof99_nav_fetch_log
  WHERE status = 'ok'
    AND price_date > DATE '1970-01-01'
    AND date_trunc('week', fetched_at AT TIME ZONE 'Asia/Shanghai')::date = DATE '${week}'
    AND NULLIF(BTRIM(reg_code), '') IS NOT NULL
)`
}

function emailTaggedCte(lastWeek: string): string {
  return `
WITH ${navSourceCtes(lastWeek)},
flags AS (
  SELECT
    e.code,
    e.in_last_week,
    (e.nav_d IS NOT NULL OR v.email_d IS NOT NULL) AS has_email,
    (m.d IS NOT NULL OR v.manual_d IS NOT NULL) AS has_manual,
    (f.d IS NOT NULL) AS has_fof99,
    GREATEST(e.nav_d, v.email_d) AS email_d,
    GREATEST(m.d, v.manual_d) AS manual_d,
    f.d AS fof_d,
    GREATEST(e.nav_d, v.email_d, m.d, v.manual_d, f.d, p.d, fam.d, nm.d) AS latest,
    COALESCE(u.policy, 'none') AS policy,
    (pool.code IS NOT NULL) AS in_pool
  FROM email_base e
  LEFT JOIN manual_nav m ON m.code = e.code
  LEFT JOIN val v ON v.code = e.code
  LEFT JOIN fof f ON f.code = e.code
  LEFT JOIN uni u ON u.code = e.code
  LEFT JOIN page p ON p.code = e.code
  LEFT JOIN family_latest fam ON fam.family = ${sqlBeianFamilyKey("e.code")}
  LEFT JOIN code_name cn ON cn.code = e.code
  LEFT JOIN name_latest nm ON nm.name_key = cn.name_key
  LEFT JOIN pool ON pool.code = e.code
),
tagged AS (
  SELECT
    f.*,
    CASE
      WHEN f.manual_d IS NOT NULL
        AND f.manual_d >= COALESCE(f.email_d, f.manual_d)
        AND f.manual_d >= COALESCE(f.fof_d, f.manual_d)
        THEN 'manual'
      WHEN f.email_d IS NOT NULL
        AND f.email_d >= COALESCE(f.fof_d, f.email_d)
        THEN 'email'
      WHEN f.fof_d IS NOT NULL THEN 'fof99'
      ELSE 'none'
    END AS winner
  FROM flags f
)`
}

function emailProductStatusSql(lastWeek: string): string {
  return `${emailTaggedCte(lastWeek)}
SELECT
  c.cohort,
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE in_pool)::int AS in_pool,
  COUNT(*) FILTER (WHERE has_fof99)::int AS with_fof99,
  COUNT(*) FILTER (WHERE has_manual)::int AS with_manual,
  COUNT(*) FILTER (WHERE has_email AND (has_fof99 OR has_manual))::int AS multi_source,
  COUNT(*) FILTER (WHERE has_email AND NOT has_fof99 AND NOT has_manual)::int AS src_email_only,
  COUNT(*) FILTER (WHERE has_email AND has_fof99 AND NOT has_manual)::int AS src_email_fof99,
  COUNT(*) FILTER (WHERE has_email AND has_manual AND NOT has_fof99)::int AS src_email_manual,
  COUNT(*) FILTER (WHERE has_email AND has_fof99 AND has_manual)::int AS src_all_three,
  COUNT(*) FILTER (WHERE NOT has_email AND (has_fof99 OR has_manual))::int AS src_other,
  COUNT(*) FILTER (WHERE NOT has_email AND NOT has_fof99 AND NOT has_manual)::int AS src_none,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest >= t.d - 7)::int AS fresh_w1,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < t.d - 7 AND latest >= t.d - 14)::int AS fresh_w1_2,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < t.d - 14 AND latest >= t.d - 21)::int AS fresh_w2_3,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < t.d - 21 AND latest >= t.d - 28)::int AS fresh_w3_4,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < t.d - 28 AND latest >= (t.d - INTERVAL '2 months')::date)::int AS fresh_m1_2,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < (t.d - INTERVAL '2 months')::date AND latest >= (t.d - INTERVAL '3 months')::date)::int AS fresh_m2_3,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < (t.d - INTERVAL '3 months')::date AND latest >= (t.d - INTERVAL '6 months')::date)::int AS fresh_m3_6,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < (t.d - INTERVAL '6 months')::date)::int AS fresh_over_m6,
  COUNT(*) FILTER (WHERE latest IS NULL)::int AS fresh_none,
  COUNT(*) FILTER (WHERE winner = 'email')::int AS ch_email,
  COUNT(*) FILTER (WHERE winner = 'manual')::int AS ch_manual,
  COUNT(*) FILTER (WHERE winner = 'fof99')::int AS ch_fof99,
  COUNT(*) FILTER (WHERE winner = 'none')::int AS ch_none,
  COUNT(*) FILTER (WHERE policy = 'weekly')::int AS pol_weekly,
  COUNT(*) FILTER (WHERE policy = 'weekly_plus')::int AS pol_weekly_plus,
  COUNT(*) FILTER (WHERE policy = 'update_slow')::int AS pol_update_slow,
  COUNT(*) FILTER (WHERE policy = 'skip')::int AS pol_skip,
  COUNT(*) FILTER (WHERE policy IS NULL OR policy NOT IN ('weekly', 'weekly_plus', 'update_slow', 'skip'))::int AS pol_none
FROM tagged
CROSS JOIN today t
CROSS JOIN (VALUES ('ever'::text), ('last_week')) AS c(cohort)
WHERE c.cohort = 'ever' OR in_last_week
GROUP BY c.cohort
`
}

function cohortCounts(row: EmailCohortRow | undefined): EmailCohortCounts {
  const blank = emptyEmailCohortCounts()
  if (!row) return blank
  const counts = { ...blank }
  for (const key of Object.keys(blank) as Array<keyof EmailCohortCounts>) {
    counts[key] = num(row[key])
  }
  return counts
}

function emailProductStatus(rows: EmailCohortRow[]): EmailProductStatus {
  const byCohort = new Map(rows.map((row) => [row.cohort, row]))
  const cohort = (key: EmailCohortKey) => buildEmailCohort(cohortCounts(byCohort.get(key)))
  return { ever: cohort("ever"), last_week: cohort("last_week") }
}

/**
 * Products in fof99_nav_universe.
 * 接口在拉 = weekly + weekly_plus. 全部跟踪 includes update_slow and skip.
 * 上周拿到 = a successful fetch whose fetched_at falls in last week.
 * Freshness and the winning channel use the same rules as the email cohort.
 */
function fof99TaggedCte(lastWeek: string): string {
  return `
WITH ${navSourceCtes(lastWeek)},
flags AS (
  SELECT
    u.code,
    u.product_name,
    u.policy,
    (ok.code IS NOT NULL) AS in_last_ok,
    (e.nav_d IS NOT NULL OR v.email_d IS NOT NULL) AS has_email,
    (m.d IS NOT NULL OR v.manual_d IS NOT NULL) AS has_manual,
    (f.d IS NOT NULL) AS has_fof99,
    GREATEST(e.nav_d, v.email_d) AS email_d,
    GREATEST(m.d, v.manual_d) AS manual_d,
    f.d AS fof_d,
    GREATEST(e.nav_d, v.email_d, m.d, v.manual_d, f.d, p.d, fam.d, nm.d) AS latest,
    (pool.code IS NOT NULL) AS in_pool
  FROM universe u
  LEFT JOIN email_base e ON e.code = u.code
  LEFT JOIN manual_nav m ON m.code = u.code
  LEFT JOIN val v ON v.code = u.code
  LEFT JOIN fof f ON f.code = u.code
  LEFT JOIN last_ok ok ON ok.code = u.code
  LEFT JOIN page p ON p.code = u.code
  LEFT JOIN family_latest fam ON fam.family = ${sqlBeianFamilyKey("u.code")}
  LEFT JOIN code_name cn ON cn.code = u.code
  LEFT JOIN name_latest nm ON nm.name_key = cn.name_key
  LEFT JOIN pool ON pool.code = u.code
),
tagged AS (
  SELECT
    f.*,
    CASE
      WHEN f.manual_d IS NOT NULL
        AND f.manual_d >= COALESCE(f.email_d, f.manual_d)
        AND f.manual_d >= COALESCE(f.fof_d, f.manual_d)
        THEN 'manual'
      WHEN f.email_d IS NOT NULL
        AND f.email_d >= COALESCE(f.fof_d, f.email_d)
        THEN 'email'
      WHEN f.fof_d IS NOT NULL THEN 'fof99'
      ELSE 'none'
    END AS winner
  FROM flags f
)`
}

function fof99CohortSql(cohort: Fof99CohortKey): string {
  if (cohort === "fetching") return "policy IN ('weekly', 'weekly_plus')"
  if (cohort === "last_ok") return "in_last_ok"
  return "TRUE"
}

type Fof99CohortRow = Fof99CohortCounts & { cohort: string }

function fof99ProductStatusSql(lastWeek: string): string {
  return `${fof99TaggedCte(lastWeek)}
SELECT
  c.cohort,
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE in_pool)::int AS in_pool,
  COUNT(*) FILTER (WHERE has_email)::int AS with_email,
  COUNT(*) FILTER (WHERE has_manual)::int AS with_manual,
  COUNT(*) FILTER (WHERE has_fof99 AND (has_email OR has_manual))::int AS multi_source,
  COUNT(*) FILTER (WHERE has_fof99 AND NOT has_email AND NOT has_manual)::int AS src_fof99_only,
  COUNT(*) FILTER (WHERE has_fof99 AND has_email AND NOT has_manual)::int AS src_fof99_email,
  COUNT(*) FILTER (WHERE has_fof99 AND has_manual AND NOT has_email)::int AS src_fof99_manual,
  COUNT(*) FILTER (WHERE has_fof99 AND has_email AND has_manual)::int AS src_all_three,
  COUNT(*) FILTER (WHERE NOT has_fof99 AND (has_email OR has_manual))::int AS src_other,
  COUNT(*) FILTER (WHERE NOT has_fof99 AND NOT has_email AND NOT has_manual)::int AS src_none,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest >= t.d - 7)::int AS fresh_w1,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < t.d - 7 AND latest >= t.d - 14)::int AS fresh_w1_2,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < t.d - 14 AND latest >= t.d - 21)::int AS fresh_w2_3,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < t.d - 21 AND latest >= t.d - 28)::int AS fresh_w3_4,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < t.d - 28 AND latest >= (t.d - INTERVAL '2 months')::date)::int AS fresh_m1_2,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < (t.d - INTERVAL '2 months')::date AND latest >= (t.d - INTERVAL '3 months')::date)::int AS fresh_m2_3,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < (t.d - INTERVAL '3 months')::date AND latest >= (t.d - INTERVAL '6 months')::date)::int AS fresh_m3_6,
  COUNT(*) FILTER (WHERE latest IS NOT NULL AND latest < (t.d - INTERVAL '6 months')::date)::int AS fresh_over_m6,
  COUNT(*) FILTER (WHERE latest IS NULL)::int AS fresh_none,
  COUNT(*) FILTER (WHERE winner = 'email')::int AS ch_email,
  COUNT(*) FILTER (WHERE winner = 'manual')::int AS ch_manual,
  COUNT(*) FILTER (WHERE winner = 'fof99')::int AS ch_fof99,
  COUNT(*) FILTER (WHERE winner = 'none')::int AS ch_none,
  COUNT(*) FILTER (WHERE policy = 'weekly')::int AS pol_weekly,
  COUNT(*) FILTER (WHERE policy = 'weekly_plus')::int AS pol_weekly_plus,
  COUNT(*) FILTER (WHERE policy = 'update_slow')::int AS pol_update_slow,
  COUNT(*) FILTER (WHERE policy = 'skip')::int AS pol_skip,
  COUNT(*) FILTER (WHERE policy IS NULL OR policy NOT IN ('weekly', 'weekly_plus', 'update_slow', 'skip'))::int AS pol_none
FROM tagged
CROSS JOIN today t
CROSS JOIN (VALUES ('fetching'::text), ('tracked'), ('last_ok')) AS c(cohort)
WHERE CASE c.cohort
  WHEN 'fetching' THEN policy IN ('weekly', 'weekly_plus')
  WHEN 'last_ok' THEN in_last_ok
  ELSE TRUE
END
GROUP BY c.cohort
`
}

function fof99CohortCounts(row: Fof99CohortRow | undefined): Fof99CohortCounts {
  const blank = emptyFof99CohortCounts()
  if (!row) return blank
  const counts = { ...blank }
  for (const key of Object.keys(blank) as Array<keyof Fof99CohortCounts>) {
    counts[key] = num(row[key])
  }
  return counts
}

function fof99ProductStatus(rows: Fof99CohortRow[]): Fof99ProductStatus {
  const byCohort = new Map(rows.map((row) => [row.cohort, row]))
  const cohort = (key: Fof99CohortKey) => buildFof99Cohort(fof99CohortCounts(byCohort.get(key)))
  return { fetching: cohort("fetching"), tracked: cohort("tracked"), last_ok: cohort("last_ok") }
}

function staleFreshnessWhere(key: EmailStaleListKey): string {
  const latest = "t.latest"
  const today = "d.d"
  const twoMonths = `(${today} - INTERVAL '2 months')::date`
  const threeMonths = `(${today} - INTERVAL '3 months')::date`
  const sixMonths = `(${today} - INTERVAL '6 months')::date`
  switch (key) {
    case "w2_3":
      return `${latest} IS NOT NULL AND ${latest} < ${today} - 14 AND ${latest} >= ${today} - 21`
    case "w3_4":
      return `${latest} IS NOT NULL AND ${latest} < ${today} - 21 AND ${latest} >= ${today} - 28`
    case "m1_2":
      return `${latest} IS NOT NULL AND ${latest} < ${today} - 28 AND ${latest} >= ${twoMonths}`
    case "m2_3":
      return `${latest} IS NOT NULL AND ${latest} < ${twoMonths} AND ${latest} >= ${threeMonths}`
    case "m3_6":
      return `${latest} IS NOT NULL AND ${latest} < ${threeMonths} AND ${latest} >= ${sixMonths}`
    case "over_m6":
      return `${latest} IS NOT NULL AND ${latest} < ${sixMonths}`
    case "behind_2w":
      return `${latest} IS NOT NULL AND ${latest} < ${today} - 14`
  }
}

type StaleProductRow = {
  code: string
  name: string | null
  latest: string | null
  lag_days: number | null
  email_date: string | null
  manual_date: string | null
  fof99_date: string | null
  has_email: boolean
  has_manual: boolean
  has_fof99: boolean
  winner: string
  policy: string | null
  in_pool: boolean
}

function emailStaleListSql(lastWeek: string, cohort: EmailCohortKey, freshness: EmailStaleListKey): string {
  const cohortSql = cohort === "last_week" ? "t.in_last_week" : "TRUE"
  return `${emailTaggedCte(lastWeek)}
, names AS (
  SELECT DISTINCT ON (code)
    UPPER(BTRIM(beian_hao)) AS code,
    BTRIM(product_name) AS name
  FROM private_fund_info
  WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
    AND NULLIF(BTRIM(product_name), '') IS NOT NULL
  ORDER BY code, latest_nav_date DESC NULLS LAST
),
email_names AS (
  SELECT DISTINCT ON (code)
    UPPER(BTRIM(product_code)) AS code,
    BTRIM(fund_name) AS name
  FROM ops_email_nav_records
  WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
    AND NULLIF(BTRIM(fund_name), '') IS NOT NULL
  ORDER BY code, created_at DESC
)
SELECT
  t.code,
  COALESCE(NULLIF(n.name, ''), NULLIF(en.name, ''), '') AS name,
  t.latest::text AS latest,
  (d.d - t.latest)::int AS lag_days,
  t.email_d::text AS email_date,
  t.manual_d::text AS manual_date,
  t.fof_d::text AS fof99_date,
  t.has_email,
  t.has_manual,
  t.has_fof99,
  t.winner,
  t.policy,
  t.in_pool
FROM tagged t
CROSS JOIN today d
LEFT JOIN names n ON n.code = t.code
LEFT JOIN email_names en ON en.code = t.code
WHERE ${cohortSql}
  AND ${staleFreshnessWhere(freshness)}
ORDER BY t.latest ASC NULLS LAST, t.code
LIMIT 500
`
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1
}

function staleProduct(row: StaleProductRow): EmailStaleProduct {
  const winner = row.winner === "email" || row.winner === "manual" || row.winner === "fof99" ? row.winner : "none"
  return {
    code: String(row.code ?? "").trim(),
    name: String(row.name ?? "").trim(),
    latest: day(row.latest),
    lag_days: row.lag_days == null ? null : num(row.lag_days),
    email_date: day(row.email_date),
    manual_date: day(row.manual_date),
    fof99_date: day(row.fof99_date),
    has_email: flag(row.has_email),
    has_manual: flag(row.has_manual),
    has_fof99: flag(row.has_fof99),
    channel: winner,
    policy: String(row.policy ?? "none"),
    in_pool: flag(row.in_pool),
  }
}

function fof99StaleListSql(lastWeek: string, cohort: Fof99CohortKey, freshness: EmailStaleListKey): string {
  return `${fof99TaggedCte(lastWeek)}
, names AS (
  SELECT DISTINCT ON (code)
    UPPER(BTRIM(beian_hao)) AS code,
    BTRIM(product_name) AS name
  FROM private_fund_info
  WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
    AND NULLIF(BTRIM(product_name), '') IS NOT NULL
  ORDER BY code, latest_nav_date DESC NULLS LAST
)
SELECT
  t.code,
  COALESCE(NULLIF(BTRIM(t.product_name), ''), NULLIF(n.name, ''), '') AS name,
  t.latest::text AS latest,
  (d.d - t.latest)::int AS lag_days,
  t.email_d::text AS email_date,
  t.manual_d::text AS manual_date,
  t.fof_d::text AS fof99_date,
  t.has_email,
  t.has_manual,
  t.has_fof99,
  t.winner,
  t.policy,
  t.in_pool,
  COUNT(*) OVER()::int AS total_count
FROM tagged t
CROSS JOIN today d
LEFT JOIN names n ON n.code = t.code
WHERE ${fof99CohortSql(cohort)}
  AND ${staleFreshnessWhere(freshness)}
ORDER BY t.latest ASC NULLS LAST, t.code
LIMIT 500
`
}

export async function listEmailStaleProducts(
  cohort: EmailCohortKey,
  freshness: EmailStaleListKey,
): Promise<EmailStaleListResponse> {
  const today = shanghaiToday()
  const lastWeek = addIsoDays(mondayOf(today), -7)
  const key = `ops-email-stale:v5:${lastWeek}:${cohort}:${freshness}`
  return await withListResponseCache(key, async () => {
    const rows = await query<StaleProductRow>(emailStaleListSql(lastWeek, cohort, freshness))
    const products = rows.map(staleProduct).filter((row) => row.code)
    return {
      cohort,
      freshness,
      label: EMAIL_STALE_LIST_LABEL[freshness],
      as_of: today,
      total: products.length,
      products,
    }
  }) as EmailStaleListResponse
}

export async function listFof99StaleProducts(
  cohort: Fof99CohortKey,
  freshness: EmailStaleListKey,
): Promise<Fof99StaleListResponse> {
  const today = shanghaiToday()
  const lastWeek = addIsoDays(mondayOf(today), -7)
  const key = `ops-fof99-stale:v1:${lastWeek}:${cohort}:${freshness}`
  return await withListResponseCache(key, async () => {
    const rows = await query<StaleProductRow & { total_count: number }>(fof99StaleListSql(lastWeek, cohort, freshness))
    const products = rows.map(staleProduct).filter((row) => row.code)
    return {
      cohort,
      freshness,
      label: EMAIL_STALE_LIST_LABEL[freshness],
      as_of: today,
      total: rows.length > 0 ? num(rows[0].total_count) : 0,
      products,
    }
  }) as Fof99StaleListResponse
}

type RecentListRow = {
  code: string
  name: string | null
  price_date: string | null
  price_nav: string | null
  measured_on: string | null
  cutoff: string | null
  in_pool: boolean
}

function formatListNav(raw: string | null): string | null {
  if (raw == null || raw === "") return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return raw
  return value.toFixed(4)
}

export async function listFof99RecentProducts(
  policy: Fof99RecentListPolicy,
): Promise<Fof99RecentListResponse> {
  const label = FOF99_POLICY_ROWS.find((row) => row.key === policy)?.label ?? policy
  const key = `ops-fof99-recent-list:v1:${policy}`
  return await withListResponseCache(key, async () => {
    const rows = await query<RecentListRow>(
      `SELECT
         p.reg_code AS code,
         COALESCE(p.product_name, '') AS name,
         p.price_date::text AS price_date,
         p.price_nav::text AS price_nav,
         p.measured_on::text AS measured_on,
         p.cutoff::text AS cutoff,
         (pool.code IS NOT NULL) AS in_pool
       FROM fof99_list_recent_products p
       LEFT JOIN (
         SELECT DISTINCT UPPER(BTRIM(register_number)) AS code
         FROM tracking_pool
         WHERE NULLIF(BTRIM(register_number), '') IS NOT NULL
       ) pool ON pool.code = p.reg_code
       WHERE p.policy = $1
       ORDER BY p.price_date DESC, p.reg_code`,
      [policy],
    )
    const products: Fof99RecentListProduct[] = rows
      .map((row) => ({
        code: String(row.code ?? "").trim(),
        name: String(row.name ?? "").trim(),
        price_date: String(row.price_date ?? "").slice(0, 10),
        price_nav: formatListNav(row.price_nav),
        in_pool: flag(row.in_pool),
      }))
      .filter((row) => row.code)
    const first = rows[0]
    return {
      policy,
      label,
      measured_on: String(first?.measured_on ?? FOF99_LIST_COVERAGE.recent_measured_on).slice(0, 10),
      cutoff: String(first?.cutoff ?? FOF99_LIST_COVERAGE.cutoff).slice(0, 10),
      total: products.length,
      products,
    }
  }) as Fof99RecentListResponse
}

type BridgeFactRow = {
  code: string
  in_ever: boolean
  in_last_week: boolean
  in_library: boolean
  channel: string | null
}

function bridgeChannel(value: string | null): EmailBridgeRecord["channel"] {
  if (value === "email" || value === "manual" || value === "fof99") return value
  return "none"
}

/**
 * Ever-emailed codes, plus library products whose latest channel is email
 * even when that code never appears in the email NAV table.
 * Channel rule matches 数据概览 全库.
 */
function emailBridgeSql(lastWeek: string): string {
  const week = sqlDate(lastWeek)
  return `
WITH email_ever AS (
  SELECT
    UPPER(BTRIM(product_code)) AS code,
    BOOL_OR(date_trunc('week', created_at AT TIME ZONE 'Asia/Shanghai')::date = DATE '${week}') AS in_last_week
  FROM ops_email_nav_records
  WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
  GROUP BY 1
),
channels AS (
  SELECT code, channel, MAX(d) AS d
  FROM (
    SELECT UPPER(BTRIM(product_code)) AS code, 'email'::text AS channel, nav_date::date AS d
    FROM ops_email_nav_records
    WHERE nav IS NOT NULL AND nav_date IS NOT NULL AND nav_date > DATE '1970-01-01'
    UNION ALL
    SELECT UPPER(BTRIM(product_code)),
      CASE
        WHEN COALESCE(source, '') = 'manual_upload' OR COALESCE(crawl_email_account, '') = 'team_manual_upload'
        THEN 'manual' ELSE 'email'
      END,
      valuation_date::date
    FROM ops_email_valuation_records
    WHERE valuation_date IS NOT NULL AND valuation_date > DATE '1970-01-01'
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), 'manual', nav_date::date
    FROM ops_team_nav_manual
    WHERE unit_nav IS NOT NULL
      AND nav_date IS NOT NULL
      AND nav_type = 'pre_fee'
      AND nav_date > DATE '1970-01-01'
    UNION ALL
    SELECT UPPER(BTRIM(reg_code)), 'fof99', price_date::date
    FROM fof99_nav_fetch_log
    WHERE status = 'ok' AND price_date > DATE '1970-01-01'
  ) s
  WHERE code <> '' AND d IS NOT NULL
  GROUP BY code, channel
),
best_channel AS (
  SELECT DISTINCT ON (code) code, channel
  FROM channels
  ORDER BY code, d DESC, CASE channel WHEN 'manual' THEN 3 WHEN 'email' THEN 2 ELSE 1 END DESC
),
library AS (
  SELECT DISTINCT UPPER(BTRIM(beian_hao)) AS code
  FROM private_fund_info
  WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
)
SELECT
  e.code,
  TRUE AS in_ever,
  e.in_last_week,
  (l.code IS NOT NULL) AS in_library,
  COALESCE(b.channel, '') AS channel
FROM email_ever e
LEFT JOIN library l ON l.code = e.code
LEFT JOIN best_channel b ON b.code = e.code
UNION ALL
SELECT
  b.code,
  FALSE AS in_ever,
  FALSE AS in_last_week,
  TRUE AS in_library,
  b.channel
FROM best_channel b
JOIN library l ON l.code = b.code
LEFT JOIN email_ever e ON e.code = b.code
WHERE b.channel = 'email' AND e.code IS NULL
`
}

function teamOnlyFactSql(): string {
  return `
WITH input AS (
  SELECT DISTINCT code FROM unnest($1::text[]) AS t(code)
),
channels AS (
  SELECT code, channel, MAX(d) AS d
  FROM (
    SELECT UPPER(BTRIM(product_code)) AS code, 'email'::text AS channel, nav_date::date AS d
    FROM ops_email_nav_records
    WHERE nav IS NOT NULL AND nav_date IS NOT NULL AND nav_date > DATE '1970-01-01'
    UNION ALL
    SELECT UPPER(BTRIM(product_code)),
      CASE
        WHEN COALESCE(source, '') = 'manual_upload' OR COALESCE(crawl_email_account, '') = 'team_manual_upload'
        THEN 'manual' ELSE 'email'
      END,
      valuation_date::date
    FROM ops_email_valuation_records
    WHERE valuation_date IS NOT NULL AND valuation_date > DATE '1970-01-01'
    UNION ALL
    SELECT UPPER(BTRIM(beian_hao)), 'manual', nav_date::date
    FROM ops_team_nav_manual
    WHERE unit_nav IS NOT NULL
      AND nav_date IS NOT NULL
      AND nav_type = 'pre_fee'
      AND nav_date > DATE '1970-01-01'
    UNION ALL
    SELECT UPPER(BTRIM(reg_code)), 'fof99', price_date::date
    FROM fof99_nav_fetch_log
    WHERE status = 'ok' AND price_date > DATE '1970-01-01'
  ) s
  WHERE code <> '' AND d IS NOT NULL
  GROUP BY code, channel
),
best_channel AS (
  SELECT DISTINCT ON (code) code, channel
  FROM channels
  ORDER BY code, d DESC, CASE channel WHEN 'manual' THEN 3 WHEN 'email' THEN 2 ELSE 1 END DESC
),
library AS (
  SELECT DISTINCT UPPER(BTRIM(beian_hao)) AS code
  FROM private_fund_info
  WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
)
SELECT
  i.code,
  (l.code IS NOT NULL) AS in_library,
  COALESCE(b.channel, '') AS channel
FROM input i
LEFT JOIN library l ON l.code = i.code
LEFT JOIN best_channel b ON b.code = i.code
`
}

function bridgeRecords(
  everRows: BridgeFactRow[],
  teamRows: TeamUpdateCode[],
  teamOnly: Map<string, { inLibrary: boolean; channel: EmailBridgeRecord["channel"] }>,
): { records: EmailBridgeRecord[]; blankTeamEmailRows: number; duplicateTeamEmailRows: number } {
  const byCode = new Map<string, EmailBridgeRecord>()
  for (const row of everRows) {
    const code = String(row.code || "").trim().toUpperCase()
    if (!code || byCode.has(code)) continue
    byCode.set(code, {
      inEver: flag(row.in_ever),
      inLastWeek: flag(row.in_last_week),
      inLibrary: flag(row.in_library),
      channel: bridgeChannel(row.channel),
      team: "absent",
    })
  }
  const methodByCode = new Map<string, EmailBridgeTeam>()
  let blankTeamEmailRows = 0
  let duplicateTeamEmailRows = 0
  for (const row of teamRows) {
    const code = row.code.trim().toUpperCase()
    if (!code) {
      if (row.method === "email") blankTeamEmailRows += 1
      continue
    }
    const prev = methodByCode.get(code)
    if (prev === "email" && row.method === "email") duplicateTeamEmailRows += 1
    if (!prev || row.method === "email") methodByCode.set(code, row.method)
  }
  for (const [code, method] of methodByCode) {
    const existing = byCode.get(code)
    if (existing) {
      existing.team = method
      continue
    }
    if (method !== "email") continue
    const fact = teamOnly.get(code)
    byCode.set(code, {
      inEver: false,
      inLastWeek: false,
      inLibrary: fact?.inLibrary ?? false,
      channel: fact?.channel ?? "none",
      team: "email",
    })
  }
  return { records: [...byCode.values()], blankTeamEmailRows, duplicateTeamEmailRows }
}

async function loadEmailCountBridge(
  lastWeek: string,
  teamRows: TeamUpdateCode[],
  everRowsInput?: BridgeFactRow[],
): Promise<EmailCountBridge> {
  const everRows = everRowsInput ?? await query<BridgeFactRow>(emailBridgeSql(lastWeek))
  const known = new Set(everRows.map((row) => String(row.code || "").trim().toUpperCase()).filter(Boolean))
  const missing = [...new Set(
    teamRows
      .filter((row) => row.method === "email")
      .map((row) => row.code.trim().toUpperCase())
      .filter((code) => code && !known.has(code)),
  )]
  const teamOnly = new Map<string, { inLibrary: boolean; channel: EmailBridgeRecord["channel"] }>()
  if (missing.length > 0) {
    const facts = await query<{ code: string; in_library: boolean; channel: string | null }>(teamOnlyFactSql(), [missing])
    for (const row of facts) {
      teamOnly.set(String(row.code || "").trim().toUpperCase(), {
        inLibrary: flag(row.in_library),
        channel: bridgeChannel(row.channel),
      })
    }
  }
  return buildEmailCountBridge(bridgeRecords(everRows, teamRows, teamOnly))
}

async function buildEmail(thisWeek: string, lastWeek: string): Promise<UpdateChannelResponse> {
  void import("@/lib/server/fof-email-product-sync")
    .then((mod) => mod.ensureFofUnderlyingInEmailPool())
    .catch((err) => console.warn("[update-channel] FOF→邮箱池 sync skipped:", err))
  const [coverageRows, weekRows, cohortRows, teamRows, everRows] = await Promise.all([
    query<PolicyCount>(EMAIL_COVERAGE_SQL),
    query<EmailWeekRow>(EMAIL_WEEKS_SQL),
    query<EmailCohortRow>(emailProductStatusSql(lastWeek)),
    listTeamUpdateCodes(),
    query<BridgeFactRow>(emailBridgeSql(lastWeek)),
  ])
  const emailCountBridge = await loadEmailCountBridge(lastWeek, teamRows, everRows)
  const history = fillWeekGaps(weekRows.map((row) => emailWeek(row, thisWeek)), thisWeek)
  const last = history.find((row) => row.week_start === lastWeek) ?? emptyWeek(lastWeek, false)
  const current = history.find((row) => row.week_start === thisWeek) ?? null
  const previous = [...history].reverse().find((row) => row.week_start < lastWeek && row.products > 0) ?? null
  const verdict = emailVerdict(last)
  const note = currentNote("email", current)
  return {
    channel: "email",
    generated_at: new Date().toISOString(),
    headline: `${emailHeadline(last, previous)}${note ? ` ${note}` : ""}`,
    verdict: verdict.verdict,
    verdict_tone: verdict.tone,
    coverage: coverageBlocks(coverageRows, "email"),
    last_week: last,
    current_week: current && current.records > 0 ? current : null,
    history,
    list_coverage: null,
    universe_moves: null,
    email_products: emailProductStatus(cohortRows),
    fof99_products: null,
    email_count_bridge: emailCountBridge,
  }
}

export async function buildUpdateChannel(channel: UpdateChannel): Promise<UpdateChannelResponse> {
  const today = shanghaiToday()
  const thisWeek = mondayOf(today)
  const lastWeek = addIsoDays(thisWeek, -7)
  if (channel === "email") return buildEmail(thisWeek, lastWeek)
  return buildFof99(thisWeek, lastWeek)
}

export function parseUpdateChannel(raw: string | null): UpdateChannel | null {
  const value = (raw ?? "").trim().toLowerCase()
  if (value === "fof99" || value === "email") return value
  return null
}

export async function getUpdateChannel(channel: UpdateChannel, refresh: boolean): Promise<UpdateChannelResponse> {
  const key = `ops-update-channel:v8:${channel}`
  return serveOpsSnapshot(key, refresh, () => buildUpdateChannel(channel))
}
