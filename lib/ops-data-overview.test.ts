import assert from "node:assert/strict"
import test from "node:test"
import {
  addCalendarMonths,
  laterNavDate,
  navDateBucket,
  overviewRows,
  teamLagBucket,
  weekBucket,
} from "./ops-data-overview"

const today = "2026-10-15"

test("week buckets split the latest week from one week behind", () => {
  assert.equal(weekBucket("2026-10-15", today), "w0")
  assert.equal(weekBucket("2026-10-08", today), "w0")
  assert.equal(weekBucket("2026-10-07", today), "w1")
  assert.equal(weekBucket("2026-10-01", today), "w1")
  assert.equal(weekBucket("2026-09-30", today), "w2")
  assert.equal(weekBucket("2026-09-24", today), "w2")
  assert.equal(weekBucket("2026-09-23", today), "w3")
  assert.equal(weekBucket("2026-09-17", today), "w3")
  assert.equal(weekBucket("2026-09-16", today), "m1_3")
  assert.equal(weekBucket(addCalendarMonths(today, -6), today), "m3_6")
  assert.equal(weekBucket("2026-04-14", today), "over_m6")
  assert.equal(weekBucket("", today), "none")
  assert.equal(weekBucket("2026-10-20", today), "w0")
})

test("platform nav date buckets match the list windows", () => {
  assert.equal(navDateBucket("2026-10-15", today), "m1")
  assert.equal(navDateBucket(addCalendarMonths(today, -1), today), "m1")
  assert.equal(navDateBucket("2026-09-14", today), "m1_3")
  assert.equal(navDateBucket(addCalendarMonths(today, -3), today), "m1_3")
  assert.equal(navDateBucket("2026-07-14", today), "m3_6")
  assert.equal(navDateBucket(addCalendarMonths(today, -6), today), "m3_6")
  assert.equal(navDateBucket("2026-04-14", today), "over_m6")
  assert.equal(navDateBucket(null, today), "none")
})

test("team lag treats a missing date as behind two weeks", () => {
  assert.equal(teamLagBucket("2026-10-01", today), "within_2w")
  assert.equal(teamLagBucket("2026-09-30", today), "behind_2w")
  assert.equal(teamLagBucket(null, today), "behind_2w")
})

test("later nav date is the newer of the two product-page dates", () => {
  assert.equal(laterNavDate("2026-10-01", "2026-09-01"), "2026-10-01")
  assert.equal(laterNavDate("2026-09-01", "2026-10-01"), "2026-10-01")
  assert.equal(laterNavDate("2026-10-01", null), "2026-10-01")
  assert.equal(laterNavDate("", "2026-10-01"), "2026-10-01")
  assert.equal(laterNavDate(null, undefined), "")
  assert.equal(laterNavDate("2026-10-01T00:00:00", "2026-10-02"), "2026-10-02")
})

test("shares use the scope total", () => {
  const rows = overviewRows(4, [
    { key: "a", label: "A", count: 1 },
    { key: "b", label: "B", count: 3 },
  ])
  assert.equal(rows[0]?.share, 0.25)
  assert.equal(rows[1]?.share, 0.75)
  assert.equal(overviewRows(0, [{ key: "a", label: "A", count: 0 }])[0]?.share, 0)
})
