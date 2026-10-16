/**
 * Shared shapes for 运维 → 数据维护 → 数据概览 → 更新 (fof99 / 邮箱).
 */

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
