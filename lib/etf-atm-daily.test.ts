import assert from "node:assert/strict"
import test from "node:test"
import { buildAtmDailyBars, sseEtfExpiryDay } from "./etf-atm-daily"

test("ETF options expire on the 4th Wednesday", () => {
  assert.equal(sseEtfExpiryDay("2609"), "2026-09-23")
  assert.equal(sseEtfExpiryDay("2611"), "2026-11-25")
  assert.equal(sseEtfExpiryDay("26"), null)
})

test("rolling front month uses the nearest live expiry and its closest strike", () => {
  const spot = [
    { date: "2026-11-18", close: 6.1 },
    { date: "2026-11-26", close: 6.1 },
  ]
  const near = {
    yymm: "2611",
    expireDay: "2026-11-25",
    strikes: [
      {
        strike: 6.1,
        call: [{ date: "2026-11-18", close: 0.09 }],
        put: [{ date: "2026-11-18", close: 0.09 }],
      },
      {
        strike: 7.5,
        call: [{ date: "2026-11-18", close: 0.01 }],
        put: [{ date: "2026-11-18", close: 1.4 }],
      },
    ],
  }
  const far = {
    yymm: "2612",
    expireDay: "2026-12-23",
    strikes: [
      {
        strike: 6.1,
        call: [
          { date: "2026-11-18", close: 0.2 },
          { date: "2026-11-26", close: 0.18 },
        ],
        put: [
          { date: "2026-11-18", close: 0.2 },
          { date: "2026-11-26", close: 0.18 },
        ],
      },
    ],
  }
  const rolling = buildAtmDailyBars({ spot, months: [far, near], month: null })
  assert.equal(rolling[0]?.date, "2026-11-18")
  assert.equal(rolling[0]?.yymm, "2611")
  assert.equal(rolling[0]?.strike, 6.1)
  assert.ok(rolling[0]!.close > 20 && rolling[0]!.close < 80)
  assert.equal(rolling[1]?.yymm, "2612")
  const pinned = buildAtmDailyBars({ spot, months: [far, near], month: "2612" })
  assert.equal(pinned.length, 2)
  assert.ok(pinned.every((point) => point.yymm === "2612"))
})

test("a quote months away from the next session is dropped", () => {
  const spot = [
    { date: "2026-01-29", close: 6.1 },
    { date: "2026-07-15", close: 6.1 },
    { date: "2026-07-16", close: 6.1 },
  ]
  const month = {
    yymm: "2609",
    expireDay: "2026-09-23",
    strikes: [
      {
        strike: 6.1,
        call: spot.map((row) => ({ date: row.date, close: 0.2 })),
        put: spot.map((row) => ({ date: row.date, close: 0.2 })),
      },
    ],
  }
  const bars = buildAtmDailyBars({ spot, months: [month], month: "2609" })
  assert.deepEqual(bars.map((point) => point.date), ["2026-07-15", "2026-07-16"])
})
