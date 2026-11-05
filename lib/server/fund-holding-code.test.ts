import assert from "node:assert/strict"
import test from "node:test"
import { strategyMatchCodes } from "./fund-holding-code"

test("估值表代码 SSB595A matches canonical share SB595A", () => {
  assert.deepEqual(strategyMatchCodes("SSB595A"), ["SSB595A", "SB595A"])
})

test("canonical code is not expanded back to the extra-S ticker", () => {
  assert.deepEqual(strategyMatchCodes("SB595A"), ["SB595A"])
})

test("a code with no alias stays as itself", () => {
  assert.deepEqual(strategyMatchCodes("SGG943"), ["SGG943"])
})
