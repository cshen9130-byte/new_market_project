/**
 * System messages shown on the dashboard bell.
 * Add a rule here to let every account turn it on or off.
 * Sending still needs a caller that inserts a row when the event happens.
 */

export const WEEKLY_STRATEGY_EXCEL_RULE = "weekly_strategy_excel_ready"
export const MANAGED_SYSTEM_WEEKLY_RULE = "managed_system_weekly_current"
export const US_MACRO_BELL_RULE = "us_macro_market_day"
export const FEATURE_LAUNCH_RULE = "feature_launch"
export const MOM_VAR_CONCENTRATION_RULE = "mom_var_concentration"
export const MOM_VAR_PRODUCT_PCT = 30
export const MOM_VAR_SECTOR_PCT = 50
export const MOM_DECISION_SIGNAL_RULE = "mom_decision_signal"
export const MOM_VAR_BUDGET_RULE = "mom_var_budget"
export const MOM_VAR_BUDGET_ANNUAL_PCT = 20
export const MACRO_RECOVERY_RULE = "macro_recovery_regime"
export const INDEX_QUARTER_BASIS_RULE = "index_quarter_basis"
export const INDEX_ATM_IV_SPIKE_RULE = "index_atm_iv_spike"
export const FUTURES_TOP_SECTOR_RULE = "futures_top_sector"

/**
 * MOM bells are listed and delivered only to accounts that can open MOM.
 * Each account stores its own cutoff in that rule's config.
 */
export const MOM_NOTIFICATION_RULES = [MOM_VAR_CONCENTRATION_RULE, MOM_DECISION_SIGNAL_RULE, MOM_VAR_BUDGET_RULE] as const

/** Suggestions a MOM account can watch on the latest 决策信号 report. Default is 加码. */
export const MOM_DECISION_ACTIONS = ["加码", "暂缓加码", "减码准备", "观望", "补风格", "控拥挤"] as const
export const MOM_DECISION_DEFAULT_ACTIONS = ["加码"] as const

/** Newest week is ready when at least half the strategy-comparison products have a print. */
export const WEEKLY_STRATEGY_EXCEL_READY_RATIO = 0.5

/** 在管产品系统周报: 距下期缺日为已最新 must be strictly above this share. */
export const MANAGED_SYSTEM_WEEKLY_CURRENT_RATIO = 0.9

export type NotificationRuleKind = "periodic" | "abnormal" | "launch"

export type NotificationRuleDef = {
  key: string
  kind: NotificationRuleKind
  title: string
  description: string
  /** Used when the account has not saved a preference. */
  defaultEnabled: boolean
}

export const NOTIFICATION_RULES: NotificationRuleDef[] = [
  {
    key: WEEKLY_STRATEGY_EXCEL_RULE,
    kind: "periodic",
    title: "周五周度策略对比 Excel",
    description: "每个周五，周报数据抓取完成、可以生成周度策略对比 Excel 时，通知本账户。",
    defaultEnabled: true,
  },
  {
    key: MANAGED_SYSTEM_WEEKLY_RULE,
    kind: "periodic",
    title: "在管产品系统周报",
    description: "在管产品里，距下期缺日为「已最新」的比例超过 90% 时，通知本账户。同一周只发一次。",
    defaultEnabled: true,
  },
  {
    key: US_MACRO_BELL_RULE,
    kind: "periodic",
    title: "美国 CPI 与非农",
    description: "每月美国 CPI 和非农公布当天的北京时间早上提醒。晚上公布的数据，当天早上就会出现。同一天只发一条。",
    defaultEnabled: true,
  },
  {
    key: FEATURE_LAUNCH_RULE,
    kind: "launch",
    title: "新功能上线",
    description: "新功能上线时通知本账户。每一项只发一次。",
    defaultEnabled: true,
  },
  {
    key: MOM_VAR_CONCENTRATION_RULE,
    kind: "abnormal",
    title: "日间风控集中度",
    description: "最新交易日，单个品种的边际波动贡献超过设定值，或单个板块超过设定值时通知。只有能看 MOM 的账户会收到。默认品种 30%、板块 50%。",
    defaultEnabled: true,
  },
  {
    key: MOM_DECISION_SIGNAL_RULE,
    kind: "abnormal",
    title: "决策信号",
    description: "最新一期日间风控里，板块或品种的建议命中你勾选的类型时通知。默认只看「加码」。只有能看 MOM 的账户会收到。同一天只发一次。",
    defaultEnabled: true,
  },
  {
    key: MOM_VAR_BUDGET_RULE,
    kind: "abnormal",
    title: "日间 VaR 预算",
    description: "最新交易日，1 日 95% VaR 占累计净资本的比例，超过你设的年化风险预算换成的日度上限时通知。默认年化 20%，约等于 1 日 2.07%。只有能看 MOM 的账户会收到。同一天只发一次。",
    defaultEnabled: true,
  },
  {
    key: MACRO_RECOVERY_RULE,
    kind: "abnormal",
    title: "宏观复苏期",
    description: "最新交易日的经济象限落在复苏期（簇 3）时通知本账户。同一天只发一次。",
    defaultEnabled: true,
  },
  {
    key: INDEX_QUARTER_BASIS_RULE,
    kind: "abnormal",
    title: "近季年化基差",
    description: "上证50、沪深300、中证500、中证1000 里，任一近季年化基差率高于 -5% 时通知本账户。同一天只发一次。",
    defaultEnabled: true,
  },
  {
    key: INDEX_ATM_IV_SPIKE_RULE,
    kind: "abnormal",
    title: "平值隐含波动率尖峰",
    description: "上证50、沪深300、中证500、中证1000 的平值 IV，近 5 个交易日最高比窗口前一天高出 15 个点以上时通知。同一次尖峰只发一次。",
    defaultEnabled: true,
  },
  {
    key: FUTURES_TOP_SECTOR_RULE,
    kind: "abnormal",
    title: "成交额最大板块切换",
    description: "商品期货日成交额排行里，成交额最大的板块和上一交易日不同时通知。同一天只发一次。",
    defaultEnabled: true,
  },
]

export function notificationRuleRequiresMom(key: string): boolean {
  return (MOM_NOTIFICATION_RULES as readonly string[]).includes(key)
}

export type MomVarThresholds = { productPct: number; sectorPct: number }

export function momVarThresholds(config: unknown): MomVarThresholds {
  const raw = config && typeof config === "object" ? config as Record<string, unknown> : {}
  return {
    productPct: readPct(raw.productPct, MOM_VAR_PRODUCT_PCT),
    sectorPct: readPct(raw.sectorPct, MOM_VAR_SECTOR_PCT),
  }
}

/** Accept any percent strictly above 0 and at most 100. Invalid input keeps the previous value. */
export function parseMomVarThresholds(input: unknown): MomVarThresholds | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>
  const productPct = readPctStrict(raw.productPct)
  const sectorPct = readPctStrict(raw.sectorPct)
  if (productPct == null || sectorPct == null) return null
  return { productPct, sectorPct }
}

export function momVarBudgetAnnualPct(config: unknown): number {
  const raw = config && typeof config === "object" ? (config as { annualPct?: unknown }).annualPct : undefined
  return readPct(raw, MOM_VAR_BUDGET_ANNUAL_PCT)
}

export function parseMomVarBudget(input: unknown): { annualPct: number } | null {
  if (!input || typeof input !== "object") return null
  const annualPct = readPctStrict((input as { annualPct?: unknown }).annualPct)
  if (annualPct == null) return null
  return { annualPct }
}

export function momDecisionActions(config: unknown): string[] {
  const raw = config && typeof config === "object" ? (config as { actions?: unknown }).actions : undefined
  const parsed = parseActionList(raw)
  return parsed ?? [...MOM_DECISION_DEFAULT_ACTIONS]
}

/** Keep the chosen suggestions. An empty list or an unknown suggestion is rejected. */
export function parseMomDecisionActions(input: unknown): string[] | null {
  if (!input || typeof input !== "object") return null
  return parseActionList((input as { actions?: unknown }).actions)
}

function parseActionList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const allowed = new Set<string>(MOM_DECISION_ACTIONS)
  const picked = new Set<string>()
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item)) return null
    picked.add(item)
  }
  return MOM_DECISION_ACTIONS.filter((action) => picked.has(action))
}

function readPct(value: unknown, fallback: number): number {
  return readPctStrict(value) ?? fallback
}

function readPctStrict(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(number) || number <= 0 || number > 100) return null
  return Math.round(number * 100) / 100
}

export type FeatureLaunch = {
  key: string
  title: string
  body: string
  href: string
}

/** One row per shipped feature. Add the next one here when it goes live. */
export const FEATURE_LAUNCHES: FeatureLaunch[] = [
  {
    key: "yingmi-external-rank",
    title: "外部私募业绩排行可以看盈米",
    body: "投资跟踪的外部私募业绩排行新增盈米数据源，打开后即可按盈米代销私募查看业绩。",
    href: "/ma/dashboard/private-funds?tab=investment&side=inv-tracking&track=external-rank&rank_source=yingmi",
  },
  {
    key: "weekly-public-enhanced",
    title: "周度回顾（公募指增）已上线",
    body: "投资跟踪新增公募指增周度回顾，可以按周查看分组表现并生成 Excel。",
    href: "/ma/dashboard/private-funds?tab=investment&side=inv-tracking&track=weekly-public",
  },
]

export function featureLaunchDedupeKey(key: string): string {
  return `feature_launch:${key}`
}

export function notificationRuleByKey(key: string): NotificationRuleDef | null {
  return NOTIFICATION_RULES.find((rule) => rule.key === key) ?? null
}

export type WeeklyCoverageInput = {
  weeks: Array<{ week_start?: string; week_end: string }>
  categories: Array<{ total: number; weeks: Array<{ missing: number }> }>
}

export type WeeklyCoverage = {
  weekStart: string
  weekEnd: string
  total: number
  covered: number
  ready: boolean
}

function coverageAt(status: WeeklyCoverageInput, index: number): WeeklyCoverage {
  const week = status.weeks[index]
  const weekEnd = week?.week_end?.slice(0, 10) ?? ""
  const weekStart = week?.week_start?.slice(0, 10) ?? ""
  let total = 0
  let missing = 0
  for (const category of status.categories) {
    total += category.total
    missing += category.weeks[index]?.missing ?? 0
  }
  const covered = Math.max(0, total - missing)
  const ready = Boolean(weekEnd) && total > 0 && covered / total >= WEEKLY_STRATEGY_EXCEL_READY_RATIO
  return { weekStart, weekEnd, total, covered, ready }
}

/** Coverage of the newest week in a weekly-review status payload. */
export function weeklyStrategyExcelCoverage(status: WeeklyCoverageInput): WeeklyCoverage {
  return coverageAt(status, 0)
}

/**
 * Newest week that can actually fill the Excel.
 * The calendar's latest Friday often still has a thin 火富牛 pull; the previous
 * Friday is the one the workbook should use until that pull lands.
 */
export function latestReadyWeeklyStrategyWeek(status: WeeklyCoverageInput): WeeklyCoverage | null {
  for (let index = 0; index < status.weeks.length; index++) {
    const coverage = coverageAt(status, index)
    if (coverage.ready) return coverage
  }
  return null
}

export function weeklyStrategyExcelDedupeKey(weekEnd: string): string {
  return `${WEEKLY_STRATEGY_EXCEL_RULE}:${weekEnd.slice(0, 10)}`
}

/** Monday of the calendar week containing `todayIso` (YYYY-MM-DD). */
export function mondayOfIsoDate(todayIso: string): string {
  const [year, month, day] = todayIso.slice(0, 10).split("-").map(Number)
  if (!year || !month || !day) return todayIso.slice(0, 10)
  const date = new Date(Date.UTC(year, month - 1, day))
  const weekday = date.getUTCDay()
  const back = weekday === 0 ? 6 : weekday - 1
  date.setUTCDate(date.getUTCDate() - back)
  return date.toISOString().slice(0, 10)
}

export function managedSystemWeeklyDedupeKey(todayIso: string): string {
  return `${MANAGED_SYSTEM_WEEKLY_RULE}:${mondayOfIsoDate(todayIso)}`
}

export type ManagedWeeklyShare = {
  total: number
  current: number
  ready: boolean
}

/** `daysBehind` uses the 距下期缺日 rule: 0 is 已最新. Null means the product has no NAV. */
export function managedWeeklyCurrentShare(daysBehind: readonly (number | null)[]): ManagedWeeklyShare {
  const total = daysBehind.length
  const current = daysBehind.filter((days) => days != null && days <= 0).length
  const ready = total > 0 && current / total > MANAGED_SYSTEM_WEEKLY_CURRENT_RATIO
  return { total, current, ready }
}

export function managedSystemWeeklyMessage(share: ManagedWeeklyShare): {
  title: string
  body: string
  href: string
} {
  return {
    title: "在管产品系统周报已最新",
    body: `在管产品 ${share.current}/${share.total} 只的距下期缺日为已最新，系统周报可以查看。`,
    href: "/ma/dashboard/private-funds?tab=reports&side=rpt-mine",
  }
}

function slashDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-")
  if (!year || !month || !day) return iso
  return `${year}/${Number(month)}/${Number(day)}`
}

export function weeklyStrategyExcelMessage(coverage: WeeklyCoverage): {
  title: string
  body: string
  href: string
  dedupeKey: string
} {
  const range = coverage.weekStart
    ? `${slashDate(coverage.weekStart)}–${slashDate(coverage.weekEnd)}`
    : slashDate(coverage.weekEnd)
  return {
    title: "周度策略对比 Excel 可以生成",
    body: `${range} 的周报数据已经抓取完成，可以生成周度策略对比 Excel。近一周净值覆盖 ${coverage.covered}/${coverage.total} 只产品。`,
    href: `/ma/dashboard/private-funds?tab=investment&side=inv-tracking&track=weekly&week_end=${coverage.weekEnd}`,
    dedupeKey: weeklyStrategyExcelDedupeKey(coverage.weekEnd),
  }
}
