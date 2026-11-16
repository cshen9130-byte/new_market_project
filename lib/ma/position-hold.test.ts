import assert from "node:assert/strict"
import test from "node:test"
import {
  calendarDays,
  holdSpell,
  lotFloatingPnl,
  openLotAge,
  pickTypicalHold,
  weightedMedian,
} from "./position-hold"

test("calendar days ignore the clock and weekends still count", () => {
  assert.equal(calendarDays("2026-11-10", "2026-11-13"), 3)
  assert.equal(calendarDays("2026-11-13", "2026-11-13"), 0)
})

test("a same-direction spell survives a missing file and stops on a flat day", () => {
  const spell = holdSpell({
    asOf: "2026-11-13",
    dataStart: "2025-07-08",
    presentDates: ["2026-11-10", "2026-11-12", "2026-11-13"],
    exposure: [
      { date: "2026-11-10", netLots: 10, grossLots: 10 },
      { date: "2026-11-12", netLots: 8, grossLots: 8 },
      { date: "2026-11-13", netLots: 12, grossLots: 12 },
    ],
  })
  assert.equal(spell?.since, "2026-11-10")
  assert.equal(spell?.days, 3)
  assert.equal(spell?.capped, false)
  assert.equal(spell?.mode, "direction")

  const broken = holdSpell({
    asOf: "2026-11-13",
    dataStart: "2025-07-08",
    presentDates: ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"],
    exposure: [
      { date: "2026-11-10", netLots: 10, grossLots: 10 },
      { date: "2026-11-12", netLots: 8, grossLots: 8 },
      { date: "2026-11-13", netLots: 12, grossLots: 12 },
    ],
  })
  assert.equal(broken?.since, "2026-11-12")
  assert.equal(broken?.days, 1)
})

test("flipping from short to long starts a new spell", () => {
  const spell = holdSpell({
    asOf: "2026-11-13",
    dataStart: "2025-07-08",
    presentDates: ["2026-11-11", "2026-11-12", "2026-11-13"],
    exposure: [
      { date: "2026-11-11", netLots: -6, grossLots: 6 },
      { date: "2026-11-12", netLots: 4, grossLots: 4 },
      { date: "2026-11-13", netLots: 4, grossLots: 4 },
    ],
  })
  assert.equal(spell?.since, "2026-11-12")
  assert.equal(spell?.days, 1)
})

test("a two-sided book stays one spell across a net-sign change", () => {
  const spell = holdSpell({
    asOf: "2026-11-13",
    dataStart: "2025-07-08",
    presentDates: ["2026-11-12", "2026-11-13"],
    exposure: [
      { date: "2026-11-12", netLots: -20, grossLots: 100 },
      { date: "2026-11-13", netLots: 10, grossLots: 100 },
    ],
  })
  assert.equal(spell?.mode, "gross")
  assert.equal(spell?.since, "2026-11-12")
  assert.equal(spell?.days, 1)
})

test("a spell that reaches the first book day is only a lower bound", () => {
  const spell = holdSpell({
    asOf: "2026-11-13",
    dataStart: "2025-07-08",
    presentDates: ["2025-07-08", "2026-11-13"],
    exposure: [
      { date: "2025-07-08", netLots: 1, grossLots: 1 },
      { date: "2026-11-13", netLots: 1, grossLots: 1 },
    ],
  })
  assert.equal(spell?.capped, true)
  assert.equal(spell?.since, "2025-07-08")
})

test("an opened-today position is zero calendar days", () => {
  const spell = holdSpell({
    asOf: "2026-11-13",
    dataStart: "2025-07-08",
    presentDates: ["2026-11-12", "2026-11-13"],
    exposure: [{ date: "2026-11-13", netLots: 2, grossLots: 2 }],
  })
  assert.equal(spell?.days, 0)
  assert.equal(spell?.since, "2026-11-13")
})

test("lot-weighted median follows the larger closes", () => {
  const med = weightedMedian([
    { value: 1, weight: 1 },
    { value: 20, weight: 10 },
  ])
  assert.deepEqual(med, { median: 20, n: 2 })
  assert.equal(pickTypicalHold({ median: 6, n: 10 }, { median: 2, n: 40 })?.scope, "product")
  assert.equal(pickTypicalHold({ median: 6, n: 4 }, { median: 2, n: 40 })?.scope, "account")
  assert.equal(pickTypicalHold({ median: 6, n: 2 }, { median: 2, n: 2 }), null)
})

test("open-lot age is the lot-weighted age, and the oldest date is kept", () => {
  const age = openLotAge([
    { openDate: "2026-11-12", lots: 2 },
    { openDate: "2026-10-28", lots: 2 },
  ], "2026-11-13")
  assert.equal(age.oldestDate, "2026-10-28")
  assert.equal(age.weightedDays, Math.round((1 * 2 + 16 * 2) / 4))
})

test("floating P&L is open price to settlement, long and short", () => {
  assert.equal(lotFloatingPnl({
    buyLots: 2, buyPx: 3044, sellLots: 0, sellPx: 0, settle: 3064, marketValue: 61280, multiplierFallback: 10,
  }), 400)
  assert.equal(lotFloatingPnl({
    buyLots: 0, buyPx: 0, sellLots: 2, sellPx: 2960, settle: 2973, marketValue: 59460, multiplierFallback: 10,
  }), -260)
  assert.equal(lotFloatingPnl({
    buyLots: 2, buyPx: 0, sellLots: 0, sellPx: 0, settle: 3064, marketValue: 61280, multiplierFallback: 10,
  }), null)
})
