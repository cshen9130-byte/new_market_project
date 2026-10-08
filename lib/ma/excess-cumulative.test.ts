/**
 *   npx tsx --test lib/ma/excess-cumulative.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { geometricExcessPct } from "../../app/ma/dashboard/private-funds/[beian_hao]/components/performanceChartUtils"

describe("geometricExcessPct", () => {
  it("rises when the fund beats the benchmark that period", () => {
    const fund0 = 96.29
    const bench0 = 15.08
    const before = geometricExcessPct(fund0, bench0)
    const fund1 = ((1 + fund0 / 100) * (1 - 0.0177) - 1) * 100
    const bench1 = ((1 + bench0 / 100) * (1 - 0.024) - 1) * 100
    const after = geometricExcessPct(fund1, bench1)
    assert.ok(before != null && after != null && after > before)
    const arithmeticBefore = fund0 - bench0
    const arithmeticAfter = fund1 - bench1
    assert.ok(arithmeticAfter < arithmeticBefore)
  })
})