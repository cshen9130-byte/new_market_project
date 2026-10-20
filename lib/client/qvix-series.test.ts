/**
 *   npx tsx --test lib/client/qvix-series.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { qvixBarsForTimeframe } from "./qvix-series"

function unix(y: number, m: number, d: number, h = 0, min = 0) {
  return Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000)
}

describe("qvix bars for timeframe", () => {
  const minute = Array.from({ length: 30 }, (_, i) => ({
    time: unix(2026, 10, 20, 9, 30) + i * 60,
    close: 10 + i,
  }))
  const live = { bars: minute, source: "optbbs:300etf", value: minute.at(-1)!.close }

  it("keeps the 1-minute series", () => {
    const out = qvixBarsForTimeframe("1m", live, [])
    assert.equal(out.mode, "intraday")
    assert.equal(out.bars.length, minute.length)
    assert.equal(out.bars.at(-1)?.close, 39)
  })

  it("aggregates intraday closes and keeps the latest print", () => {
    const out = qvixBarsForTimeframe("15m", live, [])
    assert.equal(out.mode, "intraday")
    assert.ok(out.bars.length > 1)
    assert.ok(out.bars.length < minute.length)
    assert.equal(out.bars.at(-1)?.close, 39)
  })

  it("treats a Sina near-month ATM series as intraday", () => {
    const out = qvixBarsForTimeframe("1m", { ...live, source: "sina-atm:300etf" }, [])
    assert.equal(out.mode, "intraday")
    assert.equal(out.bars.length, minute.length)
  })

  it("does not invent an intraday line from a daily fallback", () => {
    const out = qvixBarsForTimeframe(
      "5m",
      { bars: [{ time: unix(2026, 10, 17, 15, 0), close: 18 }, { time: unix(2026, 10, 20, 15, 0), close: 19 }], source: "db:300etf", value: 19 },
      [],
    )
    assert.equal(out.mode, "unavailable")
    assert.equal(out.bars.length, 0)
  })

  it("stamps the live minute close onto today's daily bar", () => {
    const daily = [
      { time: unix(2026, 10, 17, 15, 0), close: 18 },
      { time: unix(2026, 10, 20, 15, 0), close: 19 },
    ]
    const out = qvixBarsForTimeframe("1d", live, daily)
    assert.equal(out.mode, "history")
    assert.equal(out.bars.length, 2)
    assert.equal(out.bars.at(-1)?.close, 39)
  })

  it("rolls daily history into weeks", () => {
    const daily = [13, 14, 15, 16, 17, 20].map((day, i) => ({
      time: unix(2026, 10, day, 15, 0),
      close: 18 + i,
    }))
    const out = qvixBarsForTimeframe("1w", { bars: [], source: null, value: null }, daily)
    assert.equal(out.mode, "history")
    assert.ok(out.bars.length >= 1)
    assert.ok(out.bars.length < daily.length)
    assert.equal(out.bars.at(-1)?.close, 23)
  })
})
