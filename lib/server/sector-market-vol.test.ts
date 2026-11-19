/**
 *   npx tsx --test lib/server/sector-market-vol.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"

import { stdDev } from "./mom-position-var-math"
import { buildSectorMarketVol, cleanProductReturns, closesToReturns, type DatedReturn } from "./sector-market-vol"

function days(n: number, ret: (i: number) => number): DatedReturn[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    ret: ret(i),
  }))
}

test("equal-weight basket vol is the annualized sample stdev of the last 20 group returns", () => {
  const points = days(20, (i) => (i % 2 === 0 ? 0.01 : -0.01))
  const payload = buildSectorMarketVol([
    { category: "商品", sector: "农产", sub: "谷物", points },
  ])
  const expected = Math.round(stdDev(points.map((point) => point.ret)) * Math.sqrt(252) * 100 * 10) / 10
  assert.equal(payload.sector["农产"]?.at(-1), expected)
  assert.equal(payload.category["商品"]?.at(-1), expected)
  assert.equal(payload.sub["谷物"]?.at(-1), expected)
  assert.equal(payload.dates.length, 6)
  assert.equal(payload.asOf, "2026-01-20")
})

test("two products in one sector are averaged before the vol is taken", () => {
  const up = days(20, () => 0.02)
  const down = days(20, () => -0.02)
  const payload = buildSectorMarketVol([
    { category: "商品", sector: "有色", sub: "有色", points: up },
    { category: "商品", sector: "有色", sub: "有色", points: down },
  ])
  assert.equal(payload.sector["有色"]?.at(-1), 0)
})

test("index closes become close-to-close returns and keep a flat day", () => {
  const returns = closesToReturns([
    { date: "2026-01-01", close: 100 },
    { date: "2026-01-02", close: 100 },
    { date: "2026-01-03", close: 110 },
  ])
  assert.equal(returns[0]?.date, "2026-01-02")
  assert.equal(returns[0]?.ret, 0)
  assert.equal(returns[1]?.date, "2026-01-03")
  assert.ok(returns[1] != null && Math.abs(returns[1].ret - 0.1) < 1e-12)
})

test("a rollover-sized print is left out of the product series", () => {
  const points = days(41, (i) => (i === 40 ? 0.8 : 0.005))
  const cleaned = cleanProductReturns(points)
  assert.equal(cleaned.some((point) => point.ret === 0.8), false)
  assert.equal(cleaned.length, 40)
})
