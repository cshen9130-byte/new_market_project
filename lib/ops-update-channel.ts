/**
 * Shared shapes for 运维 → 数据维护 → 数据概览 → 更新 (fof99 / 邮箱).
 */

import { addCalendarMonths, daysBetween, isoDay } from "./ops-data-overview"

export type UpdateChannel = "fof99" | "email"

export type UpdateVerdictTone = "ok" | "warn" | "bad"

export type UpdateCoverageRow = {
  key: string
  label: string
  hint: string
  count: number
  /** Share of this block's total, 0–1. */
  share: number
}

export type UpdateCoverageBlock = {
  key: "nav" | "pool"
  title: string
  total: number
  /** In the fof99 universe, or with at least one email NAV, depending on channel. */
  subscribed: number
  summary: string
  rows: UpdateCoverageRow[]
}

export type UpdateWeekStat = {
  week_start: string
  week_end: string
  label: string
  in_progress: boolean
  products: number
  ok_products: number
  empty_products: number
  error_products: number
  ok_rows: number
  empty_rows: number
  error_rows: number
  batches: number
  min_date: string | null
  max_date: string | null
  backfill_products: number
  backfill_ok_rows: number
  backfill_empty_rows: number
  backfill_error_rows: number
  records: number
  emails: number
  null_nav: number
  pool_products: number
}

/** One paid read of 火富牛 /fund/advancedlist. The page does not call the API again. */
export type Fof99ListCoverage = {
  measured_on: string
  /** List NAV date on or after this counts as the recent month. */
  cutoff: string
  operating_total: number
  with_nav: number
  recent: number
  older_nav: number
  no_nav: number
  private_securities_all_states: number
  all_products: number
  recent_rows: Array<{ key: string; label: string; count: number }>
  /** Age of list NAV inside older_nav. Same read as the cards above. */
  older_rows: Array<{ key: string; label: string; count: number }>
}

export type UniverseMoveRun = {
  ran_on: string
  added: number
  moved_slow: number
  /** Trading Fridays that were empty, already formatted for display. */
  empty_fridays: string
}

export type UniverseMoves = {
  added: number
  added_still_weekly: number
  moved_slow: number
  moved_still_slow: number
  runs: UniverseMoveRun[]
}

/** Products that have ever appeared in an email NAV write. */
export type EmailCohortKey = "ever" | "last_week"

export type EmailFreshnessKey =
  | "w1"
  | "w1_2"
  | "w2_3"
  | "w3_4"
  | "m1_2"
  | "m2_3"
  | "m3_6"
  | "over_m6"
  | "none"

export type EmailCohortCounts = {
  total: number
  in_pool: number
  with_fof99: number
  with_manual: number
  multi_source: number
  src_email_only: number
  src_email_fof99: number
  src_email_manual: number
  src_all_three: number
  src_other: number
  src_none: number
  fresh_w1: number
  fresh_w1_2: number
  fresh_w2_3: number
  fresh_w3_4: number
  fresh_m1_2: number
  fresh_m2_3: number
  fresh_m3_6: number
  fresh_over_m6: number
  fresh_none: number
  ch_email: number
  ch_manual: number
  ch_fof99: number
  ch_none: number
  pol_weekly: number
  pol_weekly_plus: number
  pol_update_slow: number
  pol_skip: number
  pol_none: number
}

export type EmailCohortStatus = {
  total: number
  in_pool: number
  with_fof99: number
  with_manual: number
  /** Email NAV plus at least one of fof99 or manual. */
  multi_source: number
  sources: UpdateCoverageRow[]
  freshness: UpdateCoverageRow[]
  channel: UpdateCoverageRow[]
  policy: UpdateCoverageRow[]
}

export type EmailProductStatus = Record<EmailCohortKey, EmailCohortStatus>

export type UpdateChannelResponse = {
  channel: UpdateChannel
  generated_at: string
  headline: string
  verdict: string
  verdict_tone: UpdateVerdictTone
  coverage: UpdateCoverageBlock[]
  last_week: UpdateWeekStat
  current_week: UpdateWeekStat | null
  history: UpdateWeekStat[]
  /** Present for fof99. Null on the email channel. */
  list_coverage: Fof99ListCoverage | null
  universe_moves: UniverseMoves | null
  /** Present for email. Null on the fof99 channel. */
  email_products: EmailProductStatus | null
  /** How 曾经写入, 上周写入, 全库邮箱抓取 and 团队数据邮箱抓取 overlap. Null on fof99. */
  email_count_bridge: EmailCountBridge | null
}

export const EMAIL_COHORTS: Array<{ key: EmailCohortKey; label: string }> = [
  { key: "ever", label: "曾经写入" },
  { key: "last_week", label: "上周写入" },
]

/** Latest NAV is at least 15 days old. `behind_2w` is every such bucket together. */
export type EmailStaleListKey = "w2_3" | "w3_4" | "m1_2" | "m2_3" | "m3_6" | "over_m6" | "behind_2w"

export const EMAIL_STALE_LIST_LABEL: Record<EmailStaleListKey, string> = {
  w2_3: "2–3周",
  w3_4: "3–4周",
  m1_2: "1–2个月",
  m2_3: "2–3个月",
  m3_6: "3–6个月",
  over_m6: "6个月以上",
  behind_2w: "滞后超过2周",
}

const EMAIL_FRESHNESS_LIST_KEY: Record<string, EmailStaleListKey> = {
  fresh_w2_3: "w2_3",
  fresh_w3_4: "w3_4",
  fresh_m1_2: "m1_2",
  fresh_m2_3: "m2_3",
  fresh_m3_6: "m3_6",
  fresh_over_m6: "over_m6",
}

export function emailFreshnessListKey(rowKey: string): EmailStaleListKey | null {
  return EMAIL_FRESHNESS_LIST_KEY[rowKey] ?? null
}

export function parseEmailCohort(raw: string | null): EmailCohortKey | null {
  if (raw === "ever" || raw === "last_week") return raw
  return null
}

export function parseEmailStaleListKey(raw: string | null): EmailStaleListKey | null {
  if (!raw) return null
  if (raw in EMAIL_STALE_LIST_LABEL) return raw as EmailStaleListKey
  return null
}

export type EmailStaleProduct = {
  code: string
  name: string
  latest: string | null
  lag_days: number | null
  email_date: string | null
  manual_date: string | null
  fof99_date: string | null
  has_email: boolean
  has_manual: boolean
  has_fof99: boolean
  channel: "email" | "manual" | "fof99" | "none"
  policy: string
  in_pool: boolean
}

export type EmailStaleListResponse = {
  cohort: EmailCohortKey
  freshness: EmailStaleListKey
  label: string
  as_of: string
  total: number
  products: EmailStaleProduct[]
}

const EMAIL_SOURCE_ROWS: Array<{ key: keyof EmailCohortCounts; label: string; hint: string; optional?: boolean }> = [
  { key: "src_email_only", label: "仅邮箱", hint: "有邮箱净值或估值表日期，没有手动净值，也没有火富牛成功抓取" },
  { key: "src_email_fof99", label: "邮箱 + fof99", hint: "还有火富牛接口成功写入的净值，没有手动净值" },
  { key: "src_email_manual", label: "邮箱 + 手动", hint: "还有手动净值，没有火富牛成功抓取" },
  { key: "src_all_three", label: "邮箱 + fof99 + 手动", hint: "邮箱、火富牛、手动都有净值日" },
  { key: "src_other", label: "邮箱无净值日，另有其他来源", hint: "邮件里出现过备案号，但邮箱和估值表没有净值日；手动或火富牛有", optional: true },
  { key: "src_none", label: "没有有效净值日", hint: "邮件里出现过备案号，邮箱、手动、火富牛都没有净值日", optional: true },
]

const EMAIL_FRESHNESS_ROWS: Array<{ key: keyof EmailCohortCounts; label: string; hint: string }> = [
  { key: "fresh_w1", label: "1周以内", hint: "最新净值日距今 0–7 天，含未来日期" },
  { key: "fresh_w1_2", label: "1–2周", hint: "距今 8–14 天" },
  { key: "fresh_w2_3", label: "2–3周", hint: "距今 15–21 天" },
  { key: "fresh_w3_4", label: "3–4周", hint: "距今 22–28 天" },
  { key: "fresh_m1_2", label: "1–2个月", hint: "超过 28 天，且在两个月以内" },
  { key: "fresh_m2_3", label: "2–3个月", hint: "两个月以前，三个月以内" },
  { key: "fresh_m3_6", label: "3–6个月", hint: "三个月以前，六个月以内" },
  { key: "fresh_over_m6", label: "6个月以上", hint: "六个月以前" },
  { key: "fresh_none", label: "无日期", hint: "邮箱、手动、火富牛和产品页都没有净值日" },
]

const EMAIL_CHANNEL_ROWS: Array<{ key: keyof EmailCohortCounts; label: string; hint: string }> = [
  { key: "ch_email", label: "邮箱仍是最新", hint: "邮箱净值日不早于火富牛。同一天不算火富牛" },
  { key: "ch_manual", label: "手动更新更近", hint: "手动净值日最晚。同一天优先算手动" },
  { key: "ch_fof99", label: "fof99 更近", hint: "火富牛净值日比邮箱和手动都晚" },
  { key: "ch_none", label: "三个来源都没有日期", hint: "邮箱、手动、火富牛都没有净值日。产品页可能仍有日期" },
]

const EMAIL_POLICY_ROWS: Array<{ key: keyof EmailCohortCounts; label: string; hint: string }> = [
  { key: "pol_weekly", label: "每周拉取 weekly", hint: "每周五用火富牛接口拉净值" },
  { key: "pol_weekly_plus", label: "邮件优先 weekly_plus", hint: "邮箱通常已有，列表落后才拉" },
  { key: "pol_update_slow", label: "更新偏慢 update_slow", hint: "名单近一月没有净值时不参与周更" },
  { key: "pol_skip", label: "确认无序列 skip", hint: "名单近一月没有净值" },
  { key: "pol_none", label: "未纳入火富牛", hint: "没有放进火富牛跟踪" },
]

function coverageRows(
  total: number,
  spec: Array<{ key: keyof EmailCohortCounts; label: string; hint: string; optional?: boolean }>,
  counts: EmailCohortCounts,
): UpdateCoverageRow[] {
  return spec.flatMap((item) => {
    const count = counts[item.key]
    if (item.optional && count <= 0) return []
    return [{
      key: item.key,
      label: item.label,
      hint: item.hint,
      count,
      share: total > 0 ? count / total : 0,
    }]
  })
}

export function emptyEmailCohortCounts(): EmailCohortCounts {
  return {
    total: 0,
    in_pool: 0,
    with_fof99: 0,
    with_manual: 0,
    multi_source: 0,
    src_email_only: 0,
    src_email_fof99: 0,
    src_email_manual: 0,
    src_all_three: 0,
    src_other: 0,
    src_none: 0,
    fresh_w1: 0,
    fresh_w1_2: 0,
    fresh_w2_3: 0,
    fresh_w3_4: 0,
    fresh_m1_2: 0,
    fresh_m2_3: 0,
    fresh_m3_6: 0,
    fresh_over_m6: 0,
    fresh_none: 0,
    ch_email: 0,
    ch_manual: 0,
    ch_fof99: 0,
    ch_none: 0,
    pol_weekly: 0,
    pol_weekly_plus: 0,
    pol_update_slow: 0,
    pol_skip: 0,
    pol_none: 0,
  }
}

export type EmailBridgeTeam = "email" | "manual" | "fof99" | "other" | "absent"

/** One 备案号, plus how each email count treats it. */
export type EmailBridgeRecord = {
  inEver: boolean
  inLastWeek: boolean
  inLibrary: boolean
  channel: "" | "email" | "manual" | "fof99" | "none"
  team: EmailBridgeTeam
}

export type EmailCountBridgeRow = {
  key: string
  label: string
  hint: string
  count: number
  ever: boolean
  lastWeek: boolean
  libraryEmail: boolean
  teamEmail: boolean
}

export type EmailCountBridge = {
  ever: number
  lastWeek: number
  libraryEmail: number
  teamEmail: number
  rows: EmailCountBridgeRow[]
}

function bridgeChannelName(channel: EmailBridgeRecord["channel"]): string {
  if (channel === "manual") return "手动更新"
  if (channel === "fof99") return "fof99"
  if (channel === "email") return "邮箱"
  return "没有团队更新"
}

function bridgeTeamName(team: EmailBridgeTeam): string {
  if (team === "manual") return "手动更新"
  if (team === "fof99") return "fof99"
  if (team === "other") return "其他方式"
  return ""
}

function bridgeRecordRow(record: EmailBridgeRecord): Omit<EmailCountBridgeRow, "count"> | null {
  const libraryEmail = record.inLibrary && record.channel === "email"
  const teamEmail = record.team === "email"
  const ever = record.inEver
  const lastWeek = ever && record.inLastWeek
  if (!ever && !libraryEmail && !teamEmail) return null
  const key = [
    ever ? (lastWeek ? "week" : "earlier") : "never",
    libraryEmail ? "lib-email" : record.inLibrary ? `lib-${record.channel || "none"}` : "outside",
    record.team,
  ].join("|")
  const when = !ever ? "" : lastWeek ? "上周有邮件" : "更早有邮件、上周没有"
  const library = !record.inLibrary
    ? "备案号不在基金库"
    : libraryEmail
      ? "基金库算邮箱抓取"
      : record.channel === "none" || record.channel === ""
        ? "基金库没有邮箱、手动或 fof99 记录"
        : `基金库最新渠道是${bridgeChannelName(record.channel)}`
  const team = teamEmail
    ? "团队数据算邮箱抓取"
    : record.team === "absent"
      ? "团队数据没有这只"
      : `团队数据标成${bridgeTeamName(record.team)}`
  const bothEmail = libraryEmail && teamEmail
  const label = !ever
    ? record.inLibrary
      ? `团队数据算邮箱抓取，邮件净值表没有这个备案号；${library}`
      : "团队数据算邮箱抓取，邮件净值表没有这个备案号，也不在基金库"
    : bothEmail
      ? `${when}，基金库和团队数据都算邮箱抓取`
      : `${when}，${library}，${team}`
  let hint = "这一行的产品不和其他行重复。"
  if (!ever) hint = "团队列表在没有更新的手动或 fof99 时仍标成邮箱抓取。份额对到另一个备案号时，邮件表里的代码也不会出现在这里。"
  else if (!lastWeek) hint = "上周产品数只算这一周邮件里写过的备案号。"
  else if (!record.inLibrary) hint = "全库只统计私募基金库里的备案号。"
  else if (!libraryEmail) hint = "全库按最新一条归类。同一天优先手动更新，其次邮箱，再次 fof99。"
  else if (!teamEmail) hint = record.team === "absent"
    ? "团队数据列表里没有这个备案号。"
    : "团队数据这只的更新方式不是邮箱抓取。"
  else hint = "曾经写入、上周写入、全库邮箱抓取、团队数据邮箱抓取都把这只算进去。"
  return { key, label, hint, ever, lastWeek, libraryEmail, teamEmail }
}

/**
 * Split the four email counts into rows that do not overlap.
 * Each column, added down the rows, equals that count.
 */
export function buildEmailCountBridge(input: {
  records: EmailBridgeRecord[]
  blankTeamEmailRows?: number
  duplicateTeamEmailRows?: number
}): EmailCountBridge {
  const grouped = new Map<string, EmailCountBridgeRow>()
  for (const record of input.records) {
    const described = bridgeRecordRow(record)
    if (!described) continue
    const existing = grouped.get(described.key)
    if (existing) existing.count += 1
    else grouped.set(described.key, { ...described, count: 1 })
  }
  const blank = input.blankTeamEmailRows ?? 0
  if (blank > 0) {
    grouped.set("blank", {
      key: "blank",
      label: "团队数据算邮箱抓取，但这行没有备案号",
      hint: "团队列表把没有备案号的行也标成邮箱抓取。全库和邮件表都对不上。",
      count: blank,
      ever: false,
      lastWeek: false,
      libraryEmail: false,
      teamEmail: true,
    })
  }
  const duplicate = input.duplicateTeamEmailRows ?? 0
  if (duplicate > 0) {
    grouped.set("duplicate", {
      key: "duplicate",
      label: "团队数据里同一个备案号多计的行",
      hint: "邮件表和全库按备案号计一只。团队列表这只占了多行。",
      count: duplicate,
      ever: false,
      lastWeek: false,
      libraryEmail: false,
      teamEmail: true,
    })
  }
  const rows = [...grouped.values()].sort((a, b) => {
    const phase = (row: EmailCountBridgeRow) => row.lastWeek ? 0 : row.ever ? 1 : 2
    const phaseDiff = phase(a) - phase(b)
    if (phaseDiff) return phaseDiff
    const marks = (row: EmailCountBridgeRow) => Number(row.libraryEmail) + Number(row.teamEmail) + Number(row.ever)
    const markDiff = marks(b) - marks(a)
    if (markDiff) return markDiff
    return b.count - a.count || a.key.localeCompare(b.key)
  })
  const sum = (flag: "ever" | "lastWeek" | "libraryEmail" | "teamEmail") => (
    rows.reduce((total, row) => total + (row[flag] ? row.count : 0), 0)
  )
  return {
    ever: sum("ever"),
    lastWeek: sum("lastWeek"),
    libraryEmail: sum("libraryEmail"),
    teamEmail: sum("teamEmail"),
    rows,
  }
}

export function buildEmailCohort(counts: EmailCohortCounts): EmailCohortStatus {
  const total = counts.total
  return {
    total,
    in_pool: counts.in_pool,
    with_fof99: counts.with_fof99,
    with_manual: counts.with_manual,
    multi_source: counts.multi_source,
    sources: coverageRows(total, EMAIL_SOURCE_ROWS, counts),
    freshness: coverageRows(total, EMAIL_FRESHNESS_ROWS, counts),
    channel: coverageRows(total, EMAIL_CHANNEL_ROWS, counts),
    policy: coverageRows(total, EMAIL_POLICY_ROWS, counts),
  }
}

/**
 * Age of the latest NAV date.
 * 1周以内 is 0–7 days, then 8–14, 15–21, 22–28, then calendar months.
 * A missing date is 无日期. A future date stays in 1周以内.
 * Month edges match PostgreSQL `date - interval`.
 */
export function emailFreshnessBucket(navDate: string | null | undefined, today: string): EmailFreshnessKey {
  const day = isoDay(navDate)
  if (!day) return "none"
  const lag = daysBetween(today, day)
  if (lag == null) return "none"
  if (lag <= 7) return "w1"
  if (lag <= 14) return "w1_2"
  if (lag <= 21) return "w2_3"
  if (lag <= 28) return "w3_4"
  if (day >= addCalendarMonths(today, -2)) return "m1_2"
  if (day >= addCalendarMonths(today, -3)) return "m2_3"
  if (day >= addCalendarMonths(today, -6)) return "m3_6"
  return "over_m6"
}

/** Latest dated source. The same day prefers manual, then email, then fof99. */
export function winningUpdateChannel(dates: {
  email?: string | null
  manual?: string | null
  fof99?: string | null
}): "email" | "manual" | "fof99" | "none" {
  const ranked = [
    { key: "manual" as const, day: isoDay(dates.manual), rank: 3 },
    { key: "email" as const, day: isoDay(dates.email), rank: 2 },
    { key: "fof99" as const, day: isoDay(dates.fof99), rank: 1 },
  ].filter((row) => row.day)
  if (ranked.length === 0) return "none"
  ranked.sort((a, b) => (a.day === b.day ? b.rank - a.rank : a.day < b.day ? 1 : -1))
  return ranked[0].key
}

/**
 * 2026-10-16 read of type=1 平台策略, fund_type=2 私募证券, fund_state=1 正常运作.
 * Recent = list price_date >= 2026-09-16. Do not refresh this from the page.
 */
export const FOF99_LIST_COVERAGE: Fof99ListCoverage = {
  measured_on: "2026-10-16",
  cutoff: "2026-09-16",
  operating_total: 108481,
  with_nav: 51908,
  recent: 11128,
  older_nav: 40780,
  no_nav: 56573,
  private_securities_all_states: 207717,
  all_products: 464635,
  recent_rows: [
    { key: "weekly", label: "每周拉取 weekly", count: 9043 },
    { key: "weekly_plus", label: "邮件优先 weekly_plus", count: 145 },
    { key: "update_slow", label: "更新偏慢 update_slow", count: 151 },
    { key: "skip", label: "确认无序列 skip", count: 10 },
    { key: "none", label: "未纳入", count: 1779 },
  ],
  older_rows: [
    { key: "m1_2", label: "1–2 个月", count: 278 },
    { key: "m2_3", label: "2–3 个月", count: 593 },
    { key: "m3_6", label: "3–6 个月", count: 835 },
    { key: "over_6m", label: "6 个月以上", count: 39074 },
  ],
}

export function formatEmptyFridays(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw
    .split(",")
    .map((part) => formatCnMonthDay(part.trim()))
    .filter(Boolean)
    .join("、")
}

export function buildUniverseMoves(
  totals: {
    added: number
    added_still_weekly: number
    moved_slow: number
    moved_still_slow: number
  },
  admits: Array<{ ran_on: string; added: number }>,
  slows: Array<{ ran_on: string; moved: number; fridays: string | null }>,
): UniverseMoves {
  const byDay = new Map<string, UniverseMoveRun>()
  const ensure = (raw: string): UniverseMoveRun => {
    const ranOn = String(raw).slice(0, 10)
    const existing = byDay.get(ranOn)
    if (existing) return existing
    const created: UniverseMoveRun = { ran_on: ranOn, added: 0, moved_slow: 0, empty_fridays: "" }
    byDay.set(ranOn, created)
    return created
  }
  for (const admit of admits) {
    ensure(admit.ran_on).added += admit.added
  }
  for (const slow of slows) {
    const row = ensure(slow.ran_on)
    row.moved_slow += slow.moved
    const label = formatEmptyFridays(slow.fridays)
    if (label && !row.empty_fridays.split("；").includes(label)) {
      row.empty_fridays = row.empty_fridays ? `${row.empty_fridays}；${label}` : label
    }
  }
  return {
    added: totals.added,
    added_still_weekly: totals.added_still_weekly,
    moved_slow: totals.moved_slow,
    moved_still_slow: totals.moved_still_slow,
    runs: [...byDay.values()].sort((a, b) => a.ran_on.localeCompare(b.ran_on)),
  }
}

export const UPDATE_CHANNELS: Array<{ key: UpdateChannel | "all"; label: string }> = [
  { key: "all", label: "全部" },
  { key: "fof99", label: "fof99" },
  { key: "email", label: "邮箱" },
]

export const FOF99_POLICY_ROWS: Array<{ key: string; label: string; hint: string }> = [
  { key: "weekly", label: "每周拉取 weekly", hint: "每周五用火富牛接口拉净值" },
  { key: "weekly_plus", label: "邮件优先 weekly_plus", hint: "邮箱通常已有，列表落后才拉" },
  { key: "update_slow", label: "更新偏慢 update_slow", hint: "名单近一月没有净值时不参与周更；周五名单出现近一月净值则改回每周拉取" },
  { key: "skip", label: "确认无序列 skip", hint: "名单近一月没有净值；周五名单出现近一月净值则改回每周拉取" },
  { key: "none", label: "未纳入", hint: "没有放进火富牛跟踪" },
]

export function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number)
  const cursor = new Date(Date.UTC(year, month - 1, day + days))
  return cursor.toISOString().slice(0, 10)
}

/** Monday of the ISO week that contains this calendar day. */
export function mondayOf(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number)
  const cursor = new Date(Date.UTC(year, month - 1, day))
  const dow = cursor.getUTCDay()
  const delta = dow === 0 ? -6 : 1 - dow
  cursor.setUTCDate(cursor.getUTCDate() + delta)
  return cursor.toISOString().slice(0, 10)
}

export function formatWeekLabel(start: string): string {
  const end = addIsoDays(start, 6)
  return `${Number(start.slice(5, 7))}/${start.slice(8, 10)}–${Number(end.slice(5, 7))}/${end.slice(8, 10)}`
}

export function formatCnMonthDay(iso: string | null): string {
  if (!iso) return ""
  return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`
}
