import assert from "node:assert/strict"
import test from "node:test"
import { dailyVarBudgetPct } from "./mom-var-budget"

test("a 20 percent annual budget is about 2.07 percent as a 1-day 95 percent VaR", () => {
  const limit = dailyVarBudgetPct(20)
  assert.ok(Math.abs(limit - 2.072) < 0.01)
})
