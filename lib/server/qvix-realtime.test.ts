/**
 *   npx tsx --test lib/server/qvix-realtime.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { clipBarsAfterSession } from "./cffex-atm-iv-minute"
import { cffexTapeMissesClose } from "./option-minute-archive"
import { barsReachCashClose, indexOptionSessionOpen, pickClosedSessionSnap, undatedMinuteTapeIsStale } from "./qvix-realtime"

function wall(h: number, min: number) {
  return Math.floor(Date.UTC(2026, 10, 2, h, min) / 1000)
}

describe("undated minute tape", () => {
  const morning = new Date("2026-11-02T02:36:00Z")

  it("rejects a finished session while the Shanghai clock is still in the morning", () => {
    const bars = [
      { time: wall(9, 30), close: 15.88 },
      { time: wall(14, 8), close: 20.14 },
      { time: wall(15, 0), close: 16.03 },
    ]
    assert.equal(undatedMinuteTapeIsStale(bars, morning), true)
  })

  it("keeps a tape that stops at the current minute", () => {
    const bars = [
      { time: wall(9, 30), close: 15.88 },
      { time: wall(10, 34), close: 16.02 },
    ]
    assert.equal(undatedMinuteTapeIsStale(bars, morning), false)
  })

  it("treats 15:00 as still open and 15:01 as closed", () => {
    assert.equal(indexOptionSessionOpen(new Date("2026-11-02T07:00:00Z")), true)
    assert.equal(indexOptionSessionOpen(new Date("2026-11-02T07:01:00Z")), false)
    assert.equal(indexOptionSessionOpen(new Date("2026-11-02T04:00:00Z")), false)
  })

  it("treats a 14:47 index tape as the delayed file, and a 14:57 tape as the close", () => {
    assert.equal(cffexTapeMissesClose(14 * 60 + 47, 22 * 60 + 33, "Mon"), true)
    assert.equal(cffexTapeMissesClose(15 * 60, 22 * 60 + 33, "Mon"), false)
    assert.equal(cffexTapeMissesClose(14 * 60 + 57, 16 * 60, "Mon"), false)
    assert.equal(cffexTapeMissesClose(14 * 60 + 47, 15 * 60 + 5, "Mon"), false)
    assert.equal(cffexTapeMissesClose(14 * 60 + 47, 22 * 60, "Sat"), false)
    assert.equal(barsReachCashClose([{ time: wall(14, 47), close: 38 }]), false)
    assert.equal(barsReachCashClose([{ time: wall(15, 0), close: 38 }]), true)
  })

  it("keeps the 15:00 close after the session has ended", () => {
    const afterClose = new Date("2026-11-02T07:10:00Z")
    const bars = [
      { time: wall(9, 30), close: 15.88 },
      { time: wall(15, 0), close: 16.03 },
    ]
    assert.equal(undatedMinuteTapeIsStale(bars, afterClose), false)
  })
})

describe("closed session stays on the live close", () => {
  const live = [
    { time: wall(14, 59), close: 15.7 },
    { time: wall(15, 0), close: 15.8 },
  ]
  const delayed = [...live, { time: wall(15, 0) + 60, close: 16.2 }]

  it("drops a delayed minute that arrives after the last live quote", () => {
    const clipped = clipBarsAfterSession(delayed, live, false)
    assert.deepEqual(clipped, live)
  })

  it("does not replace the session line with another series that ends at the same minute", () => {
    const etf = { source: "qvix-sina:50etf", bars: [{ time: wall(15, 0), close: 15.49 }] }
    const index = { source: "qvix-cffex:50index", bars: [{ time: wall(15, 0), close: 16.03 }] }
    const kept = pickClosedSessionSnap(etf, index, "50etf")
    assert.equal(kept.snap?.bars.at(-1)?.close, 15.49)
    const restored = pickClosedSessionSnap(index, etf, "50etf")
    assert.equal(restored.snap?.bars.at(-1)?.close, 15.49)
    const again = pickClosedSessionSnap(restored.snap, index, "50etf")
    assert.equal(again.snap?.bars.at(-1)?.close, 15.49)
    const shortIndex = { source: "archive:1000index", bars: [{ time: wall(14, 47), close: 38.48 }] }
    const closedIndex = { source: "archive:1000index", bars: [{ time: wall(15, 0), close: 38.2 }] }
    assert.equal(pickClosedSessionSnap(shortIndex, closedIndex, "1000index").snap?.bars.at(-1)?.time, wall(15, 0))
    assert.equal(pickClosedSessionSnap(closedIndex, shortIndex, "1000index").snap?.bars.at(-1)?.time, wall(15, 0))
    const forum = { source: "optbbs:50etf", bars: [{ time: wall(15, 0), close: 16.03 }] }
    const stored = { source: "archive:50etf", bars: [{ time: wall(15, 0), close: 15.49 }] }
    assert.equal(pickClosedSessionSnap(forum, stored, "50etf").snap?.bars.at(-1)?.close, 15.49)
  })
})
