/**
 *   npx tsx --test lib/server/cffex-daily-history.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CtpCandle } from "@/lib/client/ctp-market"
import { prependOlderDaily } from "./cffex-daily-history"

function bar(time: number, close: number, open = close): CtpCandle {
  return { time, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 }
}

describe("prependOlderDaily", () => {
  it("keeps the contract bars and puts older sessions in front", () => {
    const older = [bar(1, 100), bar(2, 110), bar(3, 120)]
    const listed = [bar(3, 90, 88), bar(4, 92)]
    const out = prependOlderDaily(older, listed)
    assert.deepEqual(out.map((item) => item.time), [1, 2, 3, 4])
    assert.equal(out[2]?.close, 90)
    assert.equal(out[0]?.close, 100)
  })

  it("returns the older series when the contract has no stored rows", () => {
    const older = [bar(1, 100)]
    assert.equal(prependOlderDaily(older, []).length, 1)
  })
})
