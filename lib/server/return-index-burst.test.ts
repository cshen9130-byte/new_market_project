import assert from "node:assert/strict"
import test from "node:test"
import { sanitizeReturnIndexNavSeries, type LegacyNavRow } from "./email-nav-query"

function row(price_date: string, nav: number, cumulative = nav): LegacyNavRow {
  const unit = String(nav)
  const cum = String(cumulative)
  return {
    price_date,
    nav: unit,
    cumulative_nav: cum,
    cum_nav_withdrawal: cum,
    price_change: "",
  }
}

function dates(rows: LegacyNavRow[]): string[] {
  return rows.map((item) => item.price_date)
}

test("a weekly grind that later rebases stays on the chart", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, index) => row(`2024-03-${String(index + 1).padStart(2, "0")}`, 0.8)),
    row("2024-05-31", 1.32),
    row("2024-06-07", 1.74),
    row("2024-06-21", 2.2),
    row("2024-07-05", 2.8),
    row("2024-08-02", 3.4),
    row("2025-01-27", 3.85),
    row("2025-02-07", 1, 3.93),
  ]
  const cleaned = sanitizeReturnIndexNavSeries(rows, { beian_hao: "SAAL90" })
  assert.deepEqual(dates(cleaned), dates(rows))
  const reset = cleaned.find((item) => item.price_date === "2025-02-07")
  assert.equal(reset?.nav, "1")
  assert.equal(reset?.cumulative_nav, "3.93")
})

test("a return-index burst with a doubling step is still removed", () => {
  const rows = [
    row("2023-04-07", 1.006),
    row("2023-04-14", 1.62),
    row("2023-04-21", 12.19),
    row("2023-04-25", 12.2),
    row("2023-04-28", 1, 12.2),
  ]
  const cleaned = sanitizeReturnIndexNavSeries(rows, { beian_hao: "SXK911" })
  assert.deepEqual(dates(cleaned), ["2023-04-07", "2023-04-28"])
  const reset = cleaned.find((item) => item.price_date === "2023-04-28")
  assert.equal(reset?.nav, "1")
  assert.equal(reset?.cumulative_nav, "1")
})

test("a grind that stays high is still kept", () => {
  const rows = [
    row("2026-05-01", 0.57),
    row("2026-05-08", 0.7),
    row("2026-05-15", 0.9),
    row("2026-05-22", 1.2),
    row("2026-05-29", 1.6),
    row("2026-06-05", 2.1),
    row("2026-06-12", 2.81),
  ]
  const cleaned = sanitizeReturnIndexNavSeries(rows, { beian_hao: "SQU767" })
  assert.deepEqual(dates(cleaned), dates(rows))
})
