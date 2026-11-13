import assert from "node:assert/strict"
import test from "node:test"
import { mergeNavSeriesWithEmail, type EmailNavPoint } from "./email-nav-query"

function point(price_date: string, unit: number, cum: number): EmailNavPoint {
  return {
    price_date,
    nav: unit.toFixed(4),
    cumulative_nav: cum.toFixed(4),
    adjusted_nav: cum.toFixed(4),
  }
}

test("AVF39A dividend that crosses 2× keeps the email 累计 and does not crash 复权", () => {
  const before = Array.from({ length: 12 }, (_, index) => {
    const unit = 1.05 + index * 0.015
    return point(`2026-09-${String(index + 1).padStart(2, "0")}`, unit, unit + 0.7038)
  })
  const email = [
    ...before,
    point("2026-10-21", 1.2695, 1.9733),
    point("2026-10-22", 1.2753, 1.9791),
    point("2026-10-23", 1.277, 1.9808),
    point("2026-10-26", 0.9774, 1.9582),
    point("2026-10-27", 0.9688, 1.9496),
    point("2026-10-28", 0.9804, 1.9612),
    point("2026-10-29", 0.9768, 1.9576),
    point("2026-10-30", 0.9582, 1.939),
  ]
  const merged = mergeNavSeriesWithEmail([], email)
  const byDate = new Map(merged.map((row) => [row.price_date.slice(0, 10), row]))
  const prev = byDate.get("2026-10-23")
  const ex = byDate.get("2026-10-26")
  const next = byDate.get("2026-10-27")
  assert.ok(prev && ex && next)
  assert.ok(Math.abs(parseFloat(ex.cum_nav_withdrawal) - 1.9582) < 0.001)
  assert.ok(Math.abs(parseFloat(next.cum_nav_withdrawal) - 1.9496) < 0.001)
  const prevAdj = parseFloat(prev.cumulative_nav)
  const exAdj = parseFloat(ex.cumulative_nav)
  assert.ok(exAdj / prevAdj > 0.95, `复权 ${exAdj} fell from ${prevAdj}`)
  assert.ok(exAdj > parseFloat(ex.cum_nav_withdrawal) - 0.001)
})

test("a single dividend day above 2× is not cleared as a stray 累计", () => {
  const email = [
    point("2026-10-21", 1.2695, 1.9733),
    point("2026-10-22", 1.2753, 1.9791),
    point("2026-10-23", 1.277, 1.9808),
    point("2026-10-26", 0.9774, 1.9582),
  ]
  const merged = mergeNavSeriesWithEmail([], email)
  const ex = merged.find((row) => row.price_date.slice(0, 10) === "2026-10-26")
  assert.ok(ex)
  assert.ok(Math.abs(parseFloat(ex.cum_nav_withdrawal) - 1.9582) < 0.001)
})

test("a stray 累计 of 3 inside a normal series is still cleared", () => {
  const email = [
    point("2026-05-28", 1.05, 1.2),
    point("2026-05-29", 1.05, 3),
    point("2026-06-01", 1.06, 1.21),
  ]
  const merged = mergeNavSeriesWithEmail([], email)
  const stray = merged.find((row) => row.price_date.slice(0, 10) === "2026-05-29")
  assert.ok(stray)
  assert.ok(Math.abs(parseFloat(stray.cum_nav_withdrawal) - 3) > 0.5)
})

test("an email series that starts above 2× is still dropped when nothing confirms the scale", () => {
  const email = [
    point("2026-01-05", 1.1, 2.7),
    point("2026-01-06", 1.11, 2.71),
    point("2026-01-07", 1.12, 2.72),
  ]
  const merged = mergeNavSeriesWithEmail([], email)
  for (const row of merged) {
    const cum = parseFloat(row.cum_nav_withdrawal)
    assert.ok(!(cum > 2), `${row.price_date} kept unconfirmed 累计 ${cum}`)
  }
})
