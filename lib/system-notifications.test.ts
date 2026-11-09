import assert from "node:assert/strict"
import test from "node:test"
import {
  NOTIFICATION_RULES,
  WEEKLY_STRATEGY_EXCEL_RULE,
  notificationRuleByKey,
  latestReadyWeeklyStrategyWeek,
  managedSystemWeeklyDedupeKey,
  managedSystemWeeklyMessage,
  managedWeeklyCurrentShare,
  mondayOfIsoDate,
  weeklyStrategyExcelCoverage,
  weeklyStrategyExcelDedupeKey,
  weeklyStrategyExcelMessage,
  FEATURE_LAUNCHES,
  FEATURE_LAUNCH_RULE,
  FUTURES_TOP_SECTOR_RULE,
  INDEX_ATM_IV_SPIKE_RULE,
  INDEX_QUARTER_BASIS_RULE,
  MACRO_RECOVERY_RULE,
  MANAGED_SYSTEM_WEEKLY_RULE,
  MOM_DECISION_ACTIONS,
  MOM_DECISION_SIGNAL_RULE,
  MOM_VAR_BUDGET_ANNUAL_PCT,
  MOM_VAR_BUDGET_RULE,
  MOM_VAR_CONCENTRATION_RULE,
  MOM_VAR_PRODUCT_PCT,
  MOM_VAR_SECTOR_PCT,
  US_MACRO_BELL_RULE,
  featureLaunchDedupeKey,
  momDecisionActions,
  momVarBudgetAnnualPct,
  parseMomVarBudget,
  momVarThresholds,
  notificationRuleRequiresMom,
  parseMomDecisionActions,
  parseMomVarThresholds,
} from "./system-notifications"

test("default rules cover the weekly reports, US macro day, feature launches, and MOM bells", () => {
  assert.deepEqual(
    NOTIFICATION_RULES.map((rule) => [rule.key, rule.kind]),
    [
      [WEEKLY_STRATEGY_EXCEL_RULE, "periodic"],
      [MANAGED_SYSTEM_WEEKLY_RULE, "periodic"],
      [US_MACRO_BELL_RULE, "periodic"],
      [FEATURE_LAUNCH_RULE, "launch"],
      [MOM_VAR_CONCENTRATION_RULE, "abnormal"],
      [MOM_DECISION_SIGNAL_RULE, "abnormal"],
      [MOM_VAR_BUDGET_RULE, "abnormal"],
      [MACRO_RECOVERY_RULE, "abnormal"],
      [INDEX_QUARTER_BASIS_RULE, "abnormal"],
      [INDEX_ATM_IV_SPIKE_RULE, "abnormal"],
      [FUTURES_TOP_SECTOR_RULE, "abnormal"],
    ],
  )
  assert.equal(notificationRuleRequiresMom(FUTURES_TOP_SECTOR_RULE), false)
  assert.equal(notificationRuleRequiresMom(MACRO_RECOVERY_RULE), false)
  assert.equal(notificationRuleRequiresMom(INDEX_QUARTER_BASIS_RULE), false)
  assert.equal(notificationRuleRequiresMom(INDEX_ATM_IV_SPIKE_RULE), false)
  assert.equal(NOTIFICATION_RULES.every((rule) => rule.defaultEnabled), true)
  assert.equal(notificationRuleRequiresMom(MOM_DECISION_SIGNAL_RULE), true)
  assert.equal(notificationRuleRequiresMom(WEEKLY_STRATEGY_EXCEL_RULE), false)
  assert.equal(momVarBudgetAnnualPct(null), MOM_VAR_BUDGET_ANNUAL_PCT)
  assert.deepEqual(parseMomVarBudget({ annualPct: "15" }), { annualPct: 15 })
  assert.equal(parseMomVarBudget({ annualPct: 0 }), null)
  assert.deepEqual(momDecisionActions(null), ["加码"])
  assert.deepEqual(parseMomDecisionActions({ actions: ["观望", "加码", "加码"] }), ["加码", "观望"])
  assert.equal(parseMomDecisionActions({ actions: [] }), null)
  assert.equal(parseMomDecisionActions({ actions: ["中性"] }), null)
  assert.equal(MOM_DECISION_ACTIONS.includes("加码"), true)
  assert.deepEqual(momVarThresholds(null), { productPct: MOM_VAR_PRODUCT_PCT, sectorPct: MOM_VAR_SECTOR_PCT })
  assert.deepEqual(parseMomVarThresholds({ productPct: "12.5", sectorPct: 80 }), { productPct: 12.5, sectorPct: 80 })
  assert.equal(parseMomVarThresholds({ productPct: 0, sectorPct: 50 }), null)
  assert.equal(parseMomVarThresholds({ productPct: 101, sectorPct: 50 }), null)
  assert.equal(notificationRuleByKey("missing"), null)
  assert.deepEqual(
    FEATURE_LAUNCHES.map((item) => item.key),
    ["yingmi-external-rank", "weekly-public-enhanced"],
  )
  assert.equal(featureLaunchDedupeKey("yingmi-external-rank"), "feature_launch:yingmi-external-rank")
  assert.match(FEATURE_LAUNCHES[0].href, /track=external-rank&rank_source=yingmi/)
  assert.match(FEATURE_LAUNCHES[1].href, /track=weekly-public/)
})

test("managed weekly reports notify only when 已最新 is above 90 percent", () => {
  assert.equal(managedWeeklyCurrentShare([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]).ready, false)
  assert.equal(managedWeeklyCurrentShare([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).ready, true)
  const mixed = managedWeeklyCurrentShare([0, 0, null, 2])
  assert.equal(mixed.total, 4)
  assert.equal(mixed.current, 2)
  assert.equal(mixed.ready, false)
  assert.equal(mondayOfIsoDate("2026-11-09"), "2026-11-09")
  assert.equal(mondayOfIsoDate("2026-11-13"), "2026-11-09")
  assert.equal(mondayOfIsoDate("2026-11-08"), "2026-11-02")
  assert.equal(managedSystemWeeklyDedupeKey("2026-11-11"), "managed_system_weekly_current:2026-11-09")
  const message = managedSystemWeeklyMessage({ total: 40, current: 37, ready: true })
  assert.match(message.body, /37\/40/)
  assert.match(message.href, /side=rpt-mine/)
})

test("weekly excel is ready when at least half of this week's products have a print", () => {
  const ready = weeklyStrategyExcelCoverage({
    weeks: [{ week_start: "2026-11-09", week_end: "2026-11-13" }],
    categories: [
      { total: 10, weeks: [{ missing: 4 }] },
      { total: 10, weeks: [{ missing: 6 }] },
    ],
  })
  assert.equal(ready.covered, 10)
  assert.equal(ready.total, 20)
  assert.equal(ready.ready, true)

  const thin = weeklyStrategyExcelCoverage({
    weeks: [{ week_start: "2026-11-09", week_end: "2026-11-13" }],
    categories: [{ total: 10, weeks: [{ missing: 6 }] }],
  })
  assert.equal(thin.covered, 4)
  assert.equal(thin.ready, false)

  const empty = weeklyStrategyExcelCoverage({ weeks: [], categories: [] })
  assert.equal(empty.ready, false)
})

test("a thin newest week falls back to the previous complete week", () => {
  const coverage = latestReadyWeeklyStrategyWeek({
    weeks: [
      { week_start: "2026-11-02", week_end: "2026-11-06" },
      { week_start: "2026-10-26", week_end: "2026-10-30" },
    ],
    categories: [{ total: 796, weeks: [{ missing: 461 }, { missing: 68 }] }],
  })
  assert.equal(coverage?.weekEnd, "2026-10-30")
  assert.equal(coverage?.covered, 728)
  assert.equal(coverage?.ready, true)
})

test("one Friday produces one deduped message for every account", () => {
  const coverage = weeklyStrategyExcelCoverage({
    weeks: [{ week_start: "2026-11-09", week_end: "2026-11-13" }],
    categories: [{ total: 8, weeks: [{ missing: 1 }] }],
  })
  const message = weeklyStrategyExcelMessage(coverage)
  assert.equal(message.dedupeKey, weeklyStrategyExcelDedupeKey("2026-11-13"))
  assert.equal(message.dedupeKey, "weekly_strategy_excel_ready:2026-11-13")
  assert.match(message.body, /2026\/11\/9–2026\/11\/13/)
  assert.match(message.body, /7\/8/)
  assert.match(message.href, /track=weekly/)
  assert.match(message.href, /week_end=2026-11-13/)
})
