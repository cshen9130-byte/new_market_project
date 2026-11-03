/**
 *   npx tsx --test lib/client/window-input.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { formatWindowInput, lockAfterCommit, parseWindowInput, shanghaiMonthsAgoUnix } from "./window-input"

function unix(y: number, m: number, d: number, h = 0, min = 0) {
  return Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000)
}

describe("window input", () => {
  it("shows a daily bar as 2026.10.16", () => {
    assert.equal(formatWindowInput(unix(2026, 10, 16, 15, 0), "1d"), "2026.10.16")
  })

  it("parses 2026.10.16 as the start of that calendar day", () => {
    assert.deepEqual(parseWindowInput("2026.10.16"), { unix: unix(2026, 10, 16), hasTime: false })
  })

  it("rejects a day that does not exist", () => {
    assert.equal(parseWindowInput("2026.2.31"), null)
  })

  it("steps a Shanghai day back by whole months", () => {
    const day = new Date("2026-11-03T02:00:00Z")
    assert.equal(shanghaiMonthsAgoUnix(3, day), unix(2026, 8, 3))
    assert.equal(shanghaiMonthsAgoUnix(5, day), unix(2026, 6, 3))
  })

  it("keeps the latest day when the start is typed, then keeps that start when the end is typed", () => {
    const start = parseWindowInput("2024.9.24")
    const end = parseWindowInput("2026.5.15")
    const today = unix(2026, 10, 30, 15, 0)
    assert.ok(start && end)
    const afterStart = lockAfterCommit("start", start, null, unix(2025, 5, 8), today)
    assert.equal(afterStart.fromUnix, start.unix)
    assert.equal(afterStart.fromUser, true)
    assert.equal(afterStart.toUnix, today)
    assert.equal(afterStart.toUser, false)
    const afterEnd = lockAfterCommit("end", end, afterStart, unix(2025, 1, 7), today)
    assert.equal(afterEnd.fromUnix, start.unix)
    assert.equal(afterEnd.toUnix, end.unix)
    assert.equal(afterEnd.toUser, true)
  })
})
