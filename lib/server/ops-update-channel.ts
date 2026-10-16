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
import { setListResponseCache, withListResponseCache } from "@/lib/server/list-response-cache"
import { shanghaiToday } from "@/lib/ops-data-overview"
import {
  FOF99_LIST_COVERAGE,
  FOF99_POLICY_ROWS,
  addIsoDays,
  buildUniverseMoves,
  formatCnMonthDay,
  formatWeekLabel,
  mondayOf,
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
  const [coverageRows, weekRows, totalsRows, admitRows, slowRows] = await Promise.all([
    query<PolicyCount>(FOF99_COVERAGE_SQL),
    query<FofWeekRow>(FOF99_WEEKS_SQL),
    query<MoveTotals>(FOF99_MOVE_TOTALS_SQL),
    query<AdmitDay>(FOF99_ADMIT_DAYS_SQL),
    query<SlowDay>(FOF99_SLOW_DAYS_SQL),
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
    universe_moves: buildUniverseMoves(
      totalsRows[0] ?? { added: 0, added_still_weekly: 0, moved_slow: 0, moved_still_slow: 0 },
      admitRows,
      slowRows,
    ),
  }
}

async function buildEmail(thisWeek: string, lastWeek: string): Promise<UpdateChannelResponse> {
  const [coverageRows, weekRows] = await Promise.all([
    query<PolicyCount>(EMAIL_COVERAGE_SQL),
    query<EmailWeekRow>(EMAIL_WEEKS_SQL),
  ])
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
  const key = `ops-update-channel:v4:${channel}`
  if (refresh) {
    const body = await buildUpdateChannel(channel)
    setListResponseCache(key, body)
    return body
  }
  return await withListResponseCache(key, () => buildUpdateChannel(channel)) as UpdateChannelResponse
}
