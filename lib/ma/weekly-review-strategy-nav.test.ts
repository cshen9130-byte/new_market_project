/**
 *   npx tsx --test lib/ma/weekly-review-strategy-nav.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { buildWeeklyReviewStrategyNav } from "./weekly-review-strategy-nav"

test("compounds the weekly average and carries a week another strategy printed", () => {
  const body = buildWeeklyReviewStrategyNav("equity", [
    { bucket: "300指增", week: "2026-01-09", avgRet: 0.01, n: 4, funds: 10 },
    { bucket: "300指增", week: "2026-01-23", avgRet: -0.02, n: 4, funds: 10 },
    { bucket: "1000指增", week: "2026-01-09", avgRet: 0, n: 3, funds: 8 },
    { bucket: "1000指增", week: "2026-01-16", avgRet: 0.05, n: 3, funds: 8 },
    { bucket: "1000指增", week: "2026-01-23", avgRet: 0, n: 3, funds: 8 },
  ])
  assert.deepEqual(body.dates, ["2026-01-09", "2026-01-16", "2026-01-23"])
  const hs300 = body.series.find((row) => row.bucket === "300指增")
  assert.ok(hs300)
  assert.equal(hs300.count, 10)
  assert.deepEqual(hs300.values, [101, 101, 98.98])
  const csi1000 = body.series.find((row) => row.bucket === "1000指增")
  assert.deepEqual(csi1000?.values, [100, 105, 105])
})

test("a strategy that starts later stays empty on earlier weeks", () => {
  const body = buildWeeklyReviewStrategyNav("equity", [
    { bucket: "CTA", week: "2026-02-06", avgRet: 0.01, n: 3, funds: 4 },
    { bucket: "红利指增", week: "2026-02-13", avgRet: 0.02, n: 5, funds: 6 },
  ])
  const dividend = body.series.find((row) => row.bucket === "红利指增")
  assert.deepEqual(dividend?.values, [null, 102])
})

test("a single fund still draws that strategy line", () => {
  const body = buildWeeklyReviewStrategyNav("futures", [
    { bucket: "MOM", week: "2026-03-06", avgRet: 0.01, n: 1, funds: 1 },
  ])
  assert.deepEqual(body.dates, ["2026-03-06"])
  assert.equal(body.series[0]?.bucket, "MOM")
  assert.deepEqual(body.series[0]?.values, [101])
})
