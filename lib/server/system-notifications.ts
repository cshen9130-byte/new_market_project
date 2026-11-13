/**
 * Per-account system messages.
 *
 * Preferences live in public.user_notification_rules. A missing row uses the
 * rule's default (the Friday weekly Excel is on for every account).
 * Messages live in public.user_notifications. One dedupe key is sent once.
 */

import { randomUUID } from "node:crypto"
import { publicQuery } from "@/lib/db"
import { daysBehindNextWeeklyReport } from "@/lib/server/auto-weekly-report-week"
import {
  listManagedProductsForAutoWeekly,
  lookupProductLatestNavDate,
} from "@/lib/server/auto-weekly-reports"
import { marketBellEventsForDay, usMacroBellDedupeKey, usMacroBellMessage } from "@/lib/market-bell-events"
import { listMarketEvents } from "@/lib/ma/market-event-calendar"
import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
import { defaultWeeklyReviewWeekEnd } from "@/lib/server/jy-weekly-review"
import { getWeeklyReviewDataStatus } from "@/lib/server/weekly-review-data-status"
import {
  FEATURE_LAUNCH_RULE,
  FEATURE_LAUNCHES,
  FUTURES_TOP_SECTOR_RULE,
  INDEX_ATM_IV_SPIKE_RULE,
  INDEX_QUARTER_BASIS_RULE,
  MACRO_RECOVERY_RULE,
  MOM_DECISION_SIGNAL_RULE,
  MOM_VAR_BUDGET_RULE,
  MOM_VAR_CONCENTRATION_RULE,
  MANAGED_SYSTEM_WEEKLY_RULE,
  NOTIFICATION_RULES,
  US_MACRO_BELL_RULE,
  featureLaunchDedupeKey,
  momDecisionActions,
  momVarBudgetAnnualPct,
  momVarThresholds,
  WEEKLY_STRATEGY_EXCEL_RULE,
  latestReadyWeeklyStrategyWeek,
  managedSystemWeeklyDedupeKey,
  managedSystemWeeklyMessage,
  managedWeeklyCurrentShare,
  notificationRuleByKey,
  weeklyStrategyExcelDedupeKey,
  weeklyStrategyExcelMessage,
  type ManagedWeeklyShare,
  type NotificationRuleDef,
  type NotificationRuleKind,
} from "@/lib/system-notifications"

export type NotificationItem = {
  id: string
  rule_key: string
  title: string
  body: string
  href: string | null
  created_at: string
  read_at: string | null
}

export type NotificationRuleState = NotificationRuleDef & {
  enabled: boolean
  config?: { productPct?: number; sectorPct?: number; actions?: string[]; annualPct?: number }
}

type RuleRow = { rule_key: string; enabled: boolean; config: unknown }
type ItemRow = {
  id: string
  rule_key: string
  title: string
  body: string
  href: string | null
  created_at: Date | string
  read_at: Date | string | null
}

let initPromise: Promise<void> | null = null

function ensureTables(): Promise<void> {
  if (!initPromise) {
    initPromise = createTables().catch((error) => {
      initPromise = null
      throw error
    })
  }
  return initPromise
}

async function createTables(): Promise<void> {
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS public.user_notification_rules (
      user_id TEXT NOT NULL,
      rule_key TEXT NOT NULL,
      enabled BOOLEAN NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, rule_key)
    )
  `)
  await publicQuery(`
    ALTER TABLE public.user_notification_rules
      ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb
  `)
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS public.user_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      rule_key TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      href TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at TIMESTAMPTZ
    )
  `)
  await publicQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_user_dedupe_uq
      ON public.user_notifications (user_id, dedupe_key)
  `)
  await publicQuery(`
    CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
      ON public.user_notifications (user_id, created_at DESC)
  `)
}

async function rows<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const result = await publicQuery(sql, params)
  return result.rows as T[]
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function listNotificationRules(userId: string): Promise<NotificationRuleState[]> {
  await ensureTables()
  const saved = await rows<RuleRow>(
    `SELECT rule_key, enabled, config
       FROM public.user_notification_rules
      WHERE user_id = $1`,
    [userId],
  )
  const savedByKey = new Map(saved.map((row) => [row.rule_key, row]))
  return NOTIFICATION_RULES.map((rule) => {
    const savedRow = savedByKey.get(rule.key)
    const state: NotificationRuleState = {
      ...rule,
      enabled: savedRow ? Boolean(savedRow.enabled) : rule.defaultEnabled,
    }
    if (rule.key === MOM_VAR_CONCENTRATION_RULE) {
      state.config = momVarThresholds(savedRow?.config)
    }
    if (rule.key === MOM_DECISION_SIGNAL_RULE) {
      state.config = { actions: momDecisionActions(savedRow?.config) }
    }
    if (rule.key === MOM_VAR_BUDGET_RULE) {
      state.config = { annualPct: momVarBudgetAnnualPct(savedRow?.config) }
    }
    return state
  })
}

export async function setMomVarBudget(userId: string, annualPct: number): Promise<NotificationRuleState[]> {
  const rule = notificationRuleByKey(MOM_VAR_BUDGET_RULE)
  if (!rule) throw new Error("未知提醒")
  await ensureTables()
  await publicQuery(
    `INSERT INTO public.user_notification_rules (user_id, rule_key, enabled, config, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (user_id, rule_key)
     DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
    [userId, MOM_VAR_BUDGET_RULE, rule.defaultEnabled, JSON.stringify({ annualPct })],
  )
  return listNotificationRules(userId)
}

export async function setMomDecisionActions(userId: string, actions: string[]): Promise<NotificationRuleState[]> {
  const rule = notificationRuleByKey(MOM_DECISION_SIGNAL_RULE)
  if (!rule) throw new Error("未知提醒")
  await ensureTables()
  await publicQuery(
    `INSERT INTO public.user_notification_rules (user_id, rule_key, enabled, config, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (user_id, rule_key)
     DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
    [userId, MOM_DECISION_SIGNAL_RULE, rule.defaultEnabled, JSON.stringify({ actions })],
  )
  return listNotificationRules(userId)
}

export async function setMomVarThresholds(
  userId: string,
  thresholds: { productPct: number; sectorPct: number },
): Promise<NotificationRuleState[]> {
  const rule = notificationRuleByKey(MOM_VAR_CONCENTRATION_RULE)
  if (!rule) throw new Error("未知提醒")
  await ensureTables()
  await publicQuery(
    `INSERT INTO public.user_notification_rules (user_id, rule_key, enabled, config, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (user_id, rule_key)
     DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
    [userId, MOM_VAR_CONCENTRATION_RULE, rule.defaultEnabled, JSON.stringify(thresholds)],
  )
  return listNotificationRules(userId)
}

export async function setNotificationRule(userId: string, key: string, enabled: boolean): Promise<NotificationRuleState[]> {
  const rule = notificationRuleByKey(key)
  if (!rule) throw new Error("未知提醒")
  await ensureTables()
  await publicQuery(
    `INSERT INTO public.user_notification_rules (user_id, rule_key, enabled, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, rule_key)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [userId, key, enabled],
  )
  return listNotificationRules(userId)
}

export async function listNotifications(userId: string): Promise<{ unread: number; items: NotificationItem[] }> {
  await ensureTables()
  const [countRows, itemRows] = await Promise.all([
    rows<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM public.user_notifications
        WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    ),
    rows<ItemRow>(
      `SELECT id, rule_key, title, body, href, created_at, read_at
         FROM public.user_notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 40`,
      [userId],
    ),
  ])
  return {
    unread: countRows[0]?.n ?? 0,
    items: itemRows.map((row) => ({
      id: row.id,
      rule_key: row.rule_key,
      title: row.title,
      body: row.body,
      href: row.href,
      created_at: iso(row.created_at) ?? "",
      read_at: iso(row.read_at),
    })),
  }
}

export async function markNotificationRead(userId: string, id: string): Promise<number> {
  await ensureTables()
  await publicQuery(
    `UPDATE public.user_notifications
        SET read_at = NOW()
      WHERE user_id = $1 AND id = $2 AND read_at IS NULL`,
    [userId, id],
  )
  const countRows = await rows<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM public.user_notifications
      WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  )
  return countRows[0]?.n ?? 0
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  await ensureTables()
  await publicQuery(
    `UPDATE public.user_notifications
        SET read_at = NOW()
      WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  )
  return 0
}

async function dedupeExists(dedupeKey: string): Promise<boolean> {
  const found = await rows<{ id: string }>(
    `SELECT id FROM public.user_notifications WHERE dedupe_key = $1 LIMIT 1`,
    [dedupeKey],
  )
  return found.length > 0
}

/** Insert one message for every account that still has this rule turned on. */
export async function broadcastNotification(input: {
  ruleKey: string
  dedupeKey: string
  title: string
  body: string
  href: string | null
}): Promise<number> {
  const rule = notificationRuleByKey(input.ruleKey)
  if (!rule) throw new Error("未知提醒")
  await ensureTables()
  const recipients = await rows<{ id: string }>(
    `SELECT u.id
       FROM public.auth_users u
       LEFT JOIN public.user_notification_rules r
         ON r.user_id = u.id AND r.rule_key = $1
      WHERE COALESCE(r.enabled, $2::boolean) = TRUE`,
    [input.ruleKey, rule.defaultEnabled],
  )
  if (recipients.length === 0) return 0
  const ids = recipients.map(() => randomUUID())
  const userIds = recipients.map((row) => row.id)
  const result = await publicQuery(
    `INSERT INTO public.user_notifications (id, user_id, rule_key, dedupe_key, title, body, href)
     SELECT t.id, t.user_id, $3, $4, $5, $6, $7
       FROM UNNEST($1::text[], $2::text[]) AS t(id, user_id)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
    [ids, userIds, input.ruleKey, input.dedupeKey, input.title, input.body, input.href],
  )
  return result.rowCount ?? 0
}

export type WeeklyExcelNotifyResult = {
  sent: number
  reason: "already_sent" | "not_ready" | "sent" | "already_checking"
  weekEnd: string
}

let inflight: Promise<WeeklyExcelNotifyResult> | null = null

/**
 * When this week's weekly-review NAV is in, tell every account (unless they
 * turned the rule off) that the strategy-comparison Excel can be generated.
 * The same week is sent once.
 */
export function notifyWeeklyStrategyExcelIfReady(source: string): Promise<WeeklyExcelNotifyResult> {
  if (inflight) return inflight
  inflight = runWeeklyStrategyExcelNotify(source).finally(() => {
    inflight = null
  })
  return inflight
}

async function runWeeklyStrategyExcelNotify(source: string): Promise<WeeklyExcelNotifyResult> {
  const weekEnd = defaultWeeklyReviewWeekEnd(shanghaiTodayIsoDate())
  const dedupeKey = weeklyStrategyExcelDedupeKey(weekEnd)
  await ensureTables()
  if (await dedupeExists(dedupeKey)) {
    return { sent: 0, reason: "already_sent", weekEnd }
  }

  const status = await getWeeklyReviewDataStatus("equity", false)
  const coverage = latestReadyWeeklyStrategyWeek(status)
  if (!coverage) {
    console.log(`[weekly-excel-notify] not ready (${source}) anchor=${weekEnd}`)
    return { sent: 0, reason: "not_ready", weekEnd }
  }
  if (coverage.weekEnd !== weekEnd && await dedupeExists(weeklyStrategyExcelDedupeKey(coverage.weekEnd))) {
    return { sent: 0, reason: "already_sent", weekEnd: coverage.weekEnd }
  }

  const message = weeklyStrategyExcelMessage(coverage)
  const sent = await broadcastNotification({
    ruleKey: WEEKLY_STRATEGY_EXCEL_RULE,
    dedupeKey: message.dedupeKey,
    title: message.title,
    body: message.body,
    href: message.href,
  })
  console.log(`[weekly-excel-notify] sent ${sent} (${source}) ${coverage.weekEnd}`)
  return { sent, reason: "sent", weekEnd: coverage.weekEnd }
}

async function measureManagedSystemWeeklyShare(): Promise<ManagedWeeklyShare> {
  const products = await listManagedProductsForAutoWeekly()
  const daysBehind: Array<number | null> = new Array(products.length)
  let cursor = 0
  async function worker() {
    while (cursor < products.length) {
      const index = cursor
      cursor += 1
      const product = products[index]
      const latest = await lookupProductLatestNavDate(product.product_name, product.beian_hao)
      daysBehind[index] = daysBehindNextWeeklyReport(latest)
    }
  }
  const workers = Math.min(6, products.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return managedWeeklyCurrentShare(daysBehind)
}

export type ManagedWeeklyNotifyResult = {
  sent: number
  reason: "already_sent" | "not_ready" | "sent" | "already_checking"
  current: number
  total: number
}

let managedInflight: Promise<ManagedWeeklyNotifyResult> | null = null

/**
 * When more than 90% of 在管产品 show 距下期缺日 = 已最新, tell every account
 * that still has this rule on. One message per calendar week.
 */
export function notifyManagedSystemWeeklyIfReady(source: string): Promise<ManagedWeeklyNotifyResult> {
  if (managedInflight) return managedInflight
  managedInflight = runManagedSystemWeeklyNotify(source).finally(() => {
    managedInflight = null
  })
  return managedInflight
}

async function runManagedSystemWeeklyNotify(source: string): Promise<ManagedWeeklyNotifyResult> {
  const today = shanghaiTodayIsoDate()
  const dedupeKey = managedSystemWeeklyDedupeKey(today)
  await ensureTables()
  if (await dedupeExists(dedupeKey)) {
    return { sent: 0, reason: "already_sent", current: 0, total: 0 }
  }
  const share = await measureManagedSystemWeeklyShare()
  if (!share.ready) {
    console.log(
      `[managed-weekly-notify] not ready (${source}) ${share.current}/${share.total}`,
    )
    return { sent: 0, reason: "not_ready", current: share.current, total: share.total }
  }
  const message = managedSystemWeeklyMessage(share)
  const sent = await broadcastNotification({
    ruleKey: MANAGED_SYSTEM_WEEKLY_RULE,
    dedupeKey,
    title: message.title,
    body: message.body,
    href: message.href,
  })
  console.log(`[managed-weekly-notify] sent ${sent} (${source}) ${share.current}/${share.total}`)
  return { sent, reason: "sent", current: share.current, total: share.total }
}

export type UsMacroBellResult = {
  sent: number
  reason: "none" | "already_sent" | "sent" | "already_checking"
  events: number
}

let usMacroInflight: Promise<UsMacroBellResult> | null = null

/**
 * On the Beijing morning of a US CPI or non-farm payrolls release, tell every
 * account that still has the rule on. The release clock can be that evening;
 * the message uses the Beijing date already stored on the event. One message
 * per series per day. Fed meetings are not included.
 */
export function notifyUsMacroBellForBeijingDay(source: string): Promise<UsMacroBellResult> {
  if (usMacroInflight) return usMacroInflight.then((result) => ({ ...result, reason: "already_checking" as const }))
  usMacroInflight = runUsMacroBell(source).finally(() => {
    usMacroInflight = null
  })
  return usMacroInflight
}

async function runUsMacroBell(source: string): Promise<UsMacroBellResult> {
  const today = shanghaiTodayIsoDate()
  const { getLiveMarketEvents } = await import("./market-events-live")
  const live = await getLiveMarketEvents({ from: today, to: today })
  const fixed = listMarketEvents({ from: today, to: today })
  const events = marketBellEventsForDay([...live.events, ...fixed], today)
  if (events.length === 0) {
    console.log(`[us-macro-bell] none (${source}) ${today}`)
    return { sent: 0, reason: "none", events: 0 }
  }

  await ensureTables()
  let sent = 0
  let pending = 0
  for (const event of events) {
    const dedupeKey = usMacroBellDedupeKey(event.series, event.date)
    if (await dedupeExists(dedupeKey)) continue
    pending += 1
    const message = usMacroBellMessage(event)
    sent += await broadcastNotification({
      ruleKey: US_MACRO_BELL_RULE,
      dedupeKey,
      title: message.title,
      body: message.body,
      href: message.href,
    })
  }
  const reason = pending === 0 ? "already_sent" : "sent"
  console.log(`[us-macro-bell] ${reason} (${source}) ${today} events=${events.length} sent=${sent}`)
  return { sent, reason, events: events.length }
}

export type FeatureLaunchNotifyResult = {
  sent: number
  pending: number
  reason: "none" | "sent" | "already_sent"
}

/**
 * Tell every account that still has 新功能上线 turned on about features in
 * FEATURE_LAUNCHES. Each feature is sent once. Add the next launch to that
 * list; the next run picks it up.
 */
export async function notifyFeatureLaunches(source: string): Promise<FeatureLaunchNotifyResult> {
  await ensureTables()
  let sent = 0
  let pending = 0
  for (const launch of FEATURE_LAUNCHES) {
    const dedupeKey = featureLaunchDedupeKey(launch.key)
    if (await dedupeExists(dedupeKey)) continue
    pending += 1
    sent += await broadcastNotification({
      ruleKey: FEATURE_LAUNCH_RULE,
      dedupeKey,
      title: launch.title,
      body: launch.body,
      href: launch.href,
    })
  }
  const reason = pending === 0 ? (FEATURE_LAUNCHES.length === 0 ? "none" : "already_sent") : "sent"
  console.log(`[feature-launch] ${reason} (${source}) pending=${pending} sent=${sent}`)
  return { sent, pending, reason }
}

export async function notifyMomVarBudget(source: string): Promise<MomVarNotifyResult> {
  const { momVarBudgetMessage } = await import("@/lib/mom-var-budget")
  const { GET: varGet } = await import("@/app/ma/api/mom-analysis/var-sandbox/route")
  const { GET: navGet } = await import("@/app/ma/api/mom-analysis/product-nav/route")
  const [varResponse, navResponse] = await Promise.all([
    varGet(new Request("http://localhost/ma/api/mom-analysis/var-sandbox?confidence=95&volDays=20&corrDays=252&distModel=normal")),
    navGet(new Request("http://localhost/ma/api/mom-analysis/product-nav")),
  ])
  const sandbox = await varResponse.json().catch(() => null) as { ok?: boolean; date?: string | null; totalVar?: number } | null
  const nav = await navResponse.json().catch(() => null) as { ok?: boolean; data?: { cumCapital?: number }[] } | null
  const date = sandbox?.date?.slice(0, 10) ?? ""
  const points = nav?.data ?? []
  const netCapital = points.length > 0 ? Number(points[points.length - 1]?.cumCapital) || 0 : 0
  const totalVar = Number(sandbox?.totalVar) || 0
  if (!sandbox?.ok || !nav?.ok || !date || netCapital <= 0 || totalVar <= 0) {
    console.log(`[mom-var-budget] no data (${source})`)
    return { sent: 0, reason: "no_data", date }
  }
  const varPct = (totalVar / netCapital) * 100
  await ensureTables()
  const recipients = await rows<{ id: string; config: unknown }>(
    `SELECT u.id, r.config
       FROM public.auth_users u
       LEFT JOIN public.user_notification_rules r
         ON r.user_id = u.id AND r.rule_key = $1
      WHERE COALESCE(r.enabled, TRUE) = TRUE
        AND (u.role = 'admin' OR COALESCE((u.permissions->>'mom')::boolean, FALSE))`,
    [MOM_VAR_BUDGET_RULE],
  )
  let sent = 0
  let pending = 0
  for (const recipient of recipients) {
    const annualPct = momVarBudgetAnnualPct(recipient.config)
    const message = momVarBudgetMessage({ date, varPct, netCapital, annualPct })
    if (!message) continue
    pending += 1
    const result = await publicQuery(
      `INSERT INTO public.user_notifications (id, user_id, rule_key, dedupe_key, title, body, href)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      [randomUUID(), recipient.id, MOM_VAR_BUDGET_RULE, `mom_var_budget:${date}`, message.title, message.body, message.href],
    )
    sent += result.rowCount ?? 0
  }
  const reason = pending === 0 ? "within_limits" : sent === 0 ? "already_sent" : "sent"
  console.log(`[mom-var-budget] ${reason} (${source}) ${date} varPct=${varPct.toFixed(2)} sent=${sent}`)
  return { sent, reason, date }
}

export async function notifyMomDecisionSignals(source: string): Promise<MomVarNotifyResult> {
  const { briefingDecisionHits, momDecisionSignalMessage } = await import("@/lib/mom-decision-signal")
  const { GET } = await import("@/app/ma/api/mom-analysis/quant-vs-subjective/route")
  const { QUANT_ACCOUNT_IDS } = await import("@/lib/ma/quant-accounts")
  const { expandQuantVsSubjectivePayload } = await import("@/lib/ma/quant-vs-subjective-payload")
  const qs = new URLSearchParams({ quantIds: QUANT_ACCOUNT_IDS.join(",") })
  const response = await GET(new Request(`http://localhost/ma/api/mom-analysis/quant-vs-subjective?${qs}`))
  const json = expandQuantVsSubjectivePayload(await response.json().catch(() => null)) as {
    ok?: boolean
    date?: string | null
    quantShare?: number
    sectors?: Parameters<typeof briefingDecisionHits>[0]["sectors"]
    products?: Parameters<typeof briefingDecisionHits>[0]["products"]
    flows?: Parameters<typeof briefingDecisionHits>[0]["flows"]
    sectorTs?: Parameters<typeof briefingDecisionHits>[0]["sectorTs"]
    productTs?: Parameters<typeof briefingDecisionHits>[0]["productTs"]
    groups?: { quant?: { nAccounts?: number }; subjective?: { nAccounts?: number } } | null
  } | null
  const date = json?.date?.slice(0, 10) ?? ""
  if (!json?.ok || !date) {
    console.log(`[mom-decision-bell] no data (${source})`)
    return { sent: 0, reason: "no_data", date }
  }
  const hits = briefingDecisionHits({
    date,
    sectors: json.sectors ?? [],
    products: json.products ?? [],
    quantShare: json.quantShare ?? 0,
    quantAccounts: json.groups?.quant?.nAccounts ?? 0,
    subjectiveAccounts: json.groups?.subjective?.nAccounts ?? 0,
    flows: json.flows,
    sectorTs: json.sectorTs,
    productTs: json.productTs,
  })
  await ensureTables()
  const recipients = await rows<{ id: string; config: unknown }>(
    `SELECT u.id, r.config
       FROM public.auth_users u
       LEFT JOIN public.user_notification_rules r
         ON r.user_id = u.id AND r.rule_key = $1
      WHERE COALESCE(r.enabled, TRUE) = TRUE
        AND (u.role = 'admin' OR COALESCE((u.permissions->>'mom')::boolean, FALSE))`,
    [MOM_DECISION_SIGNAL_RULE],
  )
  let sent = 0
  let pending = 0
  for (const recipient of recipients) {
    const message = momDecisionSignalMessage({
      date,
      hits,
      actions: momDecisionActions(recipient.config),
    })
    if (!message) continue
    pending += 1
    const result = await publicQuery(
      `INSERT INTO public.user_notifications (id, user_id, rule_key, dedupe_key, title, body, href)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      [randomUUID(), recipient.id, MOM_DECISION_SIGNAL_RULE, `mom_decision_signal:${date}`, message.title, message.body, message.href],
    )
    sent += result.rowCount ?? 0
  }
  const adds = hits.filter((hit) => hit.action === "加码").length
  const reason = pending === 0 ? "within_limits" : sent === 0 ? "already_sent" : "sent"
  console.log(`[mom-decision-bell] ${reason} (${source}) ${date} jiama=${adds} sent=${sent}`)
  return { sent, reason, date }
}

export type MacroRecoveryNotifyResult = {
  sent: number
  reason: "no_data" | "quiet" | "sent" | "already_sent"
  date: string
  cluster: number | null
}

/**
 * Latest daily economic quadrant. Tell every account that still has the rule
 * on when that day is 复苏期 (cluster 3). One message per date.
 */
export async function notifyMacroRecovery(source: string): Promise<MacroRecoveryNotifyResult> {
  const { macroRecoveryMessage } = await import("@/lib/macro-recovery-bell")
  const found = await rows<{ trade_date: string; cluster: number | string | null }>(
    `SELECT trade_date::text AS trade_date, cluster
       FROM public.current_market_prediction
      WHERE freq = 'daily'
      ORDER BY trade_date DESC
      LIMIT 1`,
  )
  const date = String(found[0]?.trade_date ?? "").slice(0, 10)
  const rawCluster = found[0]?.cluster
  const parsed = rawCluster == null || rawCluster === "" ? null : Number(rawCluster)
  const cluster = parsed != null && Number.isFinite(parsed) ? parsed : null
  if (!date) {
    console.log(`[macro-recovery-bell] no data (${source})`)
    return { sent: 0, reason: "no_data", date, cluster }
  }
  const message = macroRecoveryMessage({ date, cluster })
  if (!message) {
    console.log(`[macro-recovery-bell] quiet (${source}) ${date} cluster=${cluster}`)
    return { sent: 0, reason: "quiet", date, cluster }
  }
  const dedupeKey = `macro_recovery:${date}`
  await ensureTables()
  if (await dedupeExists(dedupeKey)) {
    return { sent: 0, reason: "already_sent", date, cluster }
  }
  const sent = await broadcastNotification({
    ruleKey: MACRO_RECOVERY_RULE,
    dedupeKey,
    title: message.title,
    body: message.body,
    href: message.href,
  })
  console.log(`[macro-recovery-bell] sent (${source}) ${date} cluster=${cluster} sent=${sent}`)
  return { sent, reason: "sent", date, cluster }
}

export type IndexQuarterBasisNotifyResult = {
  sent: number
  reason: "no_data" | "quiet" | "sent" | "already_sent"
  date: string
}

/** Latest 近季 print on the four index charts. One message per date when any is above -5%. */
export async function notifyIndexQuarterBasis(source: string): Promise<IndexQuarterBasisNotifyResult> {
  const { indexQuarterBasisMessage } = await import("@/lib/index-quarter-basis")
  const { latestQuarterBasisReadings } = await import("@/lib/server/index-quarter-basis")
  const readings = await latestQuarterBasisReadings()
  const message = indexQuarterBasisMessage(readings)
  if (!message) {
    const latest = readings.reduce((max, row) => (row.date > max ? row.date : max), "")
    console.log(`[index-quarter-basis] ${readings.length ? "quiet" : "no data"} (${source}) ${latest}`)
    return { sent: 0, reason: readings.length ? "quiet" : "no_data", date: latest }
  }
  const dedupeKey = `index_quarter_basis:${message.date}`
  await ensureTables()
  if (await dedupeExists(dedupeKey)) {
    return { sent: 0, reason: "already_sent", date: message.date }
  }
  const sent = await broadcastNotification({
    ruleKey: INDEX_QUARTER_BASIS_RULE,
    dedupeKey,
    title: message.title,
    body: message.body,
    href: message.href,
  })
  console.log(`[index-quarter-basis] sent (${source}) ${message.date} sent=${sent}`)
  return { sent, reason: "sent", date: message.date }
}

export type IndexAtmIvSpikeNotifyResult = {
  sent: number
  reason: "quiet" | "sent" | "already_sent"
  products: string[]
}

function ivBarDate(time: number): string {
  const date = new Date(time * 1000)
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${date.getUTCFullYear()}-${month}-${day}`
}

/** Daily 平值 IV, the same series as the quotes chart. One message per product per spike day. */
export async function notifyIndexAtmIvSpikes(source: string): Promise<IndexAtmIvSpikeNotifyResult> {
  const { atmIvSpikeMessage, atmIvSpikes } = await import("@/lib/index-atm-iv-spike")
  const { INDEX_FUTURES } = await import("@/lib/client/ctp-market")
  const { getQvixDailyBars } = await import("@/lib/server/qvix-realtime")
  await ensureTables()
  let sent = 0
  let pending = 0
  const products: string[] = []
  for (const item of INDEX_FUTURES) {
    const bars = await getQvixDailyBars(item.product)
    const spike = atmIvSpikes({
      product: item.product,
      name: item.name,
      bars: bars.map((bar) => ({ date: ivBarDate(bar.time), value: bar.close })),
    })
    if (!spike) continue
    products.push(item.product)
    const message = atmIvSpikeMessage(spike)
    if (await dedupeExists(message.dedupeKey)) continue
    pending += 1
    sent += await broadcastNotification({
      ruleKey: INDEX_ATM_IV_SPIKE_RULE,
      dedupeKey: message.dedupeKey,
      title: message.title,
      body: message.body,
      href: message.href,
    })
  }
  const reason = pending > 0 ? "sent" : products.length > 0 ? "already_sent" : "quiet"
  console.log(`[index-atm-iv-spike] ${reason} (${source}) products=${products.join(",") || "-"} sent=${sent}`)
  return { sent, reason, products }
}

export type FuturesTopSectorNotifyResult = {
  sent: number
  reason: "no_data" | "quiet" | "sent" | "already_sent"
  date: string
  sector: string
}

/** Latest two turnover days. One message when the largest sector block changes. */
export async function notifyFuturesTopSector(source: string): Promise<FuturesTopSectorNotifyResult> {
  const { futuresTopSectorMessage } = await import("@/lib/futures-top-sector")
  const found = await rows<{ trade_date: string; sector: string; amount: string | number }>(
    `SELECT trade_date::text AS trade_date,
            COALESCE(NULLIF(sector, ''), '其他') AS sector,
            SUM(amount) AS amount
       FROM public.raw_commodity_amount_daily
      WHERE trade_date IN (
        SELECT trade_date
          FROM public.raw_commodity_amount_daily
         GROUP BY trade_date
         ORDER BY trade_date DESC
         LIMIT 2
      )
      GROUP BY trade_date, COALESCE(NULLIF(sector, ''), '其他')
      ORDER BY trade_date DESC`,
  )
  const byDate = new Map<string, { sector: string; amount: number }[]>()
  for (const row of found) {
    const date = String(row.trade_date).slice(0, 10)
    const list = byDate.get(date) ?? []
    list.push({ sector: row.sector, amount: Number(row.amount) || 0 })
    byDate.set(date, list)
  }
  const dates = [...byDate.keys()].sort()
  const previousDate = dates[0] ?? ""
  const todayDate = dates[1] ?? ""
  if (!previousDate || !todayDate) {
    console.log(`[futures-top-sector] no data (${source})`)
    return { sent: 0, reason: "no_data", date: todayDate, sector: "" }
  }
  const message = futuresTopSectorMessage({
    today: { date: todayDate, sectors: byDate.get(todayDate) ?? [] },
    previous: { date: previousDate, sectors: byDate.get(previousDate) ?? [] },
  })
  if (!message) {
    console.log(`[futures-top-sector] quiet (${source}) ${todayDate}`)
    return { sent: 0, reason: "quiet", date: todayDate, sector: "" }
  }
  const dedupeKey = `futures_top_sector:${todayDate}`
  await ensureTables()
  if (await dedupeExists(dedupeKey)) {
    return { sent: 0, reason: "already_sent", date: todayDate, sector: "" }
  }
  const sent = await broadcastNotification({
    ruleKey: FUTURES_TOP_SECTOR_RULE,
    dedupeKey,
    title: message.title,
    body: message.body,
    href: message.href,
  })
  console.log(`[futures-top-sector] sent (${source}) ${todayDate} sent=${sent}`)
  return { sent, reason: "sent", date: todayDate, sector: message.title }
}

export type MomVarNotifyResult = {
  sent: number
  reason: "no_data" | "within_limits" | "sent" | "already_sent"
  date: string
}

/**
 * Latest VaR sandbox day: tell MOM accounts when one variety's marginal
 * contribution is above their variety limit, or one sector is above their
 * sector limit. One message per account per date. Accounts without MOM
 * access are not recipients.
 */
export async function notifyMomVarConcentration(source: string): Promise<MomVarNotifyResult> {
  const { momVarConcentrationMessage, varConcentrationShares } = await import("@/lib/mom-var-concentration")
  const { GET } = await import("@/app/ma/api/mom-analysis/var-sandbox/route")
  const response = await GET(new Request(
    "http://localhost/ma/api/mom-analysis/var-sandbox?confidence=95&volDays=20&corrDays=252&distModel=normal",
  ))
  const json = await response.json().catch(() => null) as {
    ok?: boolean
    date?: string | null
    products?: { prod: string; mv: number; sigma: number }[]
    corrMatrix?: number[][]
  } | null
  const date = json?.date?.slice(0, 10) ?? ""
  const products = json?.products ?? []
  if (!json?.ok || !date || products.length === 0) {
    console.log(`[mom-var-bell] no data (${source})`)
    return { sent: 0, reason: "no_data", date }
  }
  const shares = varConcentrationShares(products, json.corrMatrix ?? [])
  await ensureTables()
  const recipients = await rows<{ id: string; config: unknown }>(
    `SELECT u.id, r.config
       FROM public.auth_users u
       LEFT JOIN public.user_notification_rules r
         ON r.user_id = u.id AND r.rule_key = $1
      WHERE COALESCE(r.enabled, TRUE) = TRUE
        AND (u.role = 'admin' OR COALESCE((u.permissions->>'mom')::boolean, FALSE))`,
    [MOM_VAR_CONCENTRATION_RULE],
  )
  let sent = 0
  let pending = 0
  for (const recipient of recipients) {
    const thresholds = momVarThresholds(recipient.config)
    const message = momVarConcentrationMessage({
      date,
      products: shares.products,
      sectors: shares.sectors,
      productPct: thresholds.productPct,
      sectorPct: thresholds.sectorPct,
    })
    if (!message) continue
    pending += 1
    const dedupeKey = `mom_var_concentration:${date}`
    const result = await publicQuery(
      `INSERT INTO public.user_notifications (id, user_id, rule_key, dedupe_key, title, body, href)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      [randomUUID(), recipient.id, MOM_VAR_CONCENTRATION_RULE, dedupeKey, message.title, message.body, message.href],
    )
    sent += result.rowCount ?? 0
  }
  const reason = pending === 0 ? "within_limits" : sent === 0 ? "already_sent" : "sent"
  const topProduct = shares.products[0]
  const topSector = shares.sectors[0]
  console.log(
    `[mom-var-bell] ${reason} (${source}) ${date} product=${topProduct?.name ?? "-"} ${topProduct?.pct.toFixed(1) ?? "-"} sector=${topSector?.name ?? "-"} ${topSector?.pct.toFixed(1) ?? "-"} sent=${sent}`,
  )
  return { sent, reason, date }
}

export type { NotificationRuleKind }
