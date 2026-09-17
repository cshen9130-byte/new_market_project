/**
 *   npx tsx --test lib/server/fof-holding-step-pnl.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  computeHoldingStepPnl,
  transferredUnrealizedOnRedeem,
} from "./fof-holding-step-pnl"

describe("transferredUnrealizedOnRedeem", () => {
  it("moves all prior 市值变动 when the position is fully redeemed", () => {
    assert.equal(transferredUnrealizedOnRedeem(-127_765, 3_194_122.81, 0), -127_765)
  })

  it("moves a pro-rata slice on a partial redeem", () => {
    assert.equal(transferredUnrealizedOnRedeem(10, 100, 50), 5)
  })

  it("moves nothing when quantity does not fall", () => {
    assert.equal(transferredUnrealizedOnRedeem(10, 100, 120), 0)
  })
})

describe("computeHoldingStepPnl redeem amount", () => {
  it("does not treat Δ成本 as extra 已实现 when it disagrees with 份额×净值", () => {
    const step = computeHoldingStepPnl(
      { qty: 3_194_122.81, mv: 3_872_235.08, price: 1.2123 },
      { qty: 0, mv: 0, price: null },
      [{ date: "2026-07-20", kind: "redeem", shares: 3_194_122.81, amount: 4_000_000, nav: 1.2123 }],
    )
    assert.ok(Math.abs(step.realizedPnl) < 1)
    assert.ok(Math.abs(step.pnl) < 1)
  })

  it("keeps a small fee residual as 已实现", () => {
    const step = computeHoldingStepPnl(
      { qty: 1000, mv: 1000, price: 1 },
      { qty: 0, mv: 0, price: null },
      [{ date: "", kind: "redeem", shares: 1000, amount: 999, nav: 1 }],
    )
    assert.equal(step.realizedPnl, -1)
  })
})
