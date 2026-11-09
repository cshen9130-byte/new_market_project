import assert from "node:assert/strict"
import test from "node:test"
import { dailyVarBudgetPct, momVarBudgetMessage } from "./mom-var-budget"

test("a 20 percent annual budget is about 2.07 percent as a 1-day 95 percent VaR", () => {
  const limit = dailyVarBudgetPct(20)
  assert.ok(Math.abs(limit - 2.072) < 0.01)
  assert.equal(momVarBudgetMessage({
    date: "2026-11-06",
    varPct: 1.1,
    netCapital: 76992329,
    annualPct: 20,
  }), null)
})

test("the bell names the daily ratio, the annual budget, and net capital", () => {
  const message = momVarBudgetMessage({
    date: "2026-11-06",
    varPct: 2.4,
    netCapital: 76992329,
    annualPct: 20,
  })
  assert.match(message?.title ?? "", /日间 VaR 超过风险预算/)
  assert.match(message?.body ?? "", /2\.40%/)
  assert.match(message?.body ?? "", /20% 年化风险预算/)
  assert.match(message?.body ?? "", /76,992,329/)
  assert.equal(message?.href, "/ma/dashboard/mom-analysis/risk-report?tab=intraday#section-intraday-sandbox")
})
