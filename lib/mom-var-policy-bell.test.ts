import assert from "node:assert/strict"
import test from "node:test"
import { budgetHardNote, budgetSoftNote, collectBreaches } from "./ma/var-mcr-policy"
import { momVarBudgetBell, momVarConcentrationBell } from "./mom-var-policy-bell"

test("a soft breach tells the bell to forbid new exposure and not to cut", () => {
  const breaches = collectBreaches({
    productSeries: { MA: [26.85, 33.8] },
    sectorSeries: { 能源化工: [56, 56.1] },
    asOfIndex: 1,
    driver: "position",
    attrPos: 1,
    varPct: 1.2,
    capOk: true,
  })
  const message = momVarConcentrationBell({ date: "2026-11-20", breaches, driver: "position" })
  assert.match(message?.title ?? "", /禁止新增/)
  assert.match(message?.body ?? "", /甲醇） 33\.8%/)
  assert.match(message?.body ?? "", /能源化工 56\.1%/)
  assert.match(message?.body ?? "", /次日起MA（甲醇）禁止加仓/)
  assert.match(message?.body ?? "", /能源化工自上一交易日收盘后已禁止加仓/)
  assert.match(message?.body ?? "", /不做正式硬砍/)
  assert.match(message?.body ?? "", /主因是持仓/)
  assert.doesNotMatch(message?.body ?? "", /超过你设置的/)
  assert.match(message?.href ?? "", /#section-intraday-mcr-suggestions/)
})

test("a quiet book does not ring the concentration bell", () => {
  const breaches = collectBreaches({
    productSeries: { MA: [19.9] },
    sectorSeries: { 能源化工: [40.8] },
    asOfIndex: 0,
    driver: "na",
    attrPos: null,
    varPct: 1,
    capOk: true,
  })
  assert.equal(momVarConcentrationBell({ date: "2026-11-20", breaches, driver: "na" }), null)
})

test("three hard sessions with a position-driven rise become a cut", () => {
  const breaches = collectBreaches({
    productSeries: { JD: [55, 58, 61] },
    sectorSeries: { 生鲜: [66, 68, 70] },
    asOfIndex: 2,
    driver: "position",
    attrPos: 2,
    varPct: 3,
    capOk: true,
  })
  const message = momVarConcentrationBell({ date: "2026-06-26", breaches, driver: "position" })
  assert.match(message?.title ?? "", /建议减仓/)
  assert.match(message?.body ?? "", /已满足正式硬砍条件/)
  assert.match(message?.body ?? "", /压回软线 30%/)
  assert.match(message?.body ?? "", /压回软线 50%/)
})

test("a market-driven hard streak freezes the cut", () => {
  const breaches = collectBreaches({
    productSeries: { JD: [55, 58, 61] },
    sectorSeries: {},
    asOfIndex: 2,
    driver: "market",
    attrPos: -1,
    varPct: 3,
    capOk: true,
  })
  const message = momVarConcentrationBell({ date: "2026-06-26", breaches, driver: "market" })
  assert.match(message?.title ?? "", /硬阈值冻结/)
  assert.match(message?.body ?? "", /集中度硬阈值冻结/)
  assert.match(message?.body ?? "", /不下达数量减仓令/)
})

test("the budget bell warns at 2.07 percent and names the 5 percent gate", () => {
  assert.equal(momVarBudgetBell({
    date: "2026-11-20",
    budgetSoft: budgetSoftNote(1.5, true),
    budgetHard: budgetHardNote({ varPct: 1.5, capOk: true, hardStreak: 0 }),
  }), null)

  const soft = momVarBudgetBell({
    date: "2026-11-20",
    budgetSoft: budgetSoftNote(3.4, true),
    budgetHard: budgetHardNote({ varPct: 3.4, capOk: true, hardStreak: 1 }),
  })
  assert.match(soft?.title ?? "", /预算软预警/)
  assert.match(soft?.body ?? "", /3\.40%/)
  assert.match(soft?.body ?? "", /不对整本账做自动封顶/)
  assert.doesNotMatch(soft?.body ?? "", /超过 .*年化风险预算/)

  const hard = momVarBudgetBell({
    date: "2026-01-14",
    budgetSoft: budgetSoftNote(6.2, true),
    budgetHard: budgetHardNote({ varPct: 6.2, capOk: true, hardStreak: 3 }),
  })
  assert.match(hard?.title ?? "", /预算硬闸门/)
  assert.match(hard?.body ?? "", /连续 3 个交易日超过 5%/)
  assert.match(hard?.body ?? "", /缩放到 2\.07%/)
  assert.match(hard?.href ?? "", /#section-intraday-mcr-suggestions/)
})
