import assert from "node:assert/strict"
import test from "node:test"
import { resolveFundHoldingCode, strategyFamilyLookupCodes, strategyMatchCodes } from "./fund-holding-code"

test("估值表代码 SSB595A matches canonical share SB595A", () => {
  assert.deepEqual(strategyMatchCodes("SSB595A"), ["SSB595A", "SB595A"])
})

test("canonical code is not expanded back to the extra-S ticker", () => {
  assert.deepEqual(strategyMatchCodes("SB595A"), ["SB595A"])
})

test("a code with no alias stays as itself", () => {
  assert.deepEqual(strategyMatchCodes("SGG943"), ["SGG943"])
})

test("FOF valuation share-class code looks up the AMAC parent family", () => {
  const codes = strategyFamilyLookupCodes("GG136A")
  assert.ok(codes.includes("GG136A"))
  assert.ok(codes.includes("SGG136"))
  assert.ok(codes.includes("GG136"))
})

test("listed 6-digit tickers are not expanded into a share-class family", () => {
  assert.deepEqual(strategyFamilyLookupCodes("512000"), ["512000"])
})

test("华泰 锡泰科目 SAMR32OTC is 象上容成 A类 AMR32A", () => {
  assert.equal(
    resolveFundHoldingCode(
      "11083501SAMR32OTC",
      "场外_已上市_开放式_私募_成本.象上容成多策略私募证券投资基金A",
    ),
    "AMR32A",
  )
})
