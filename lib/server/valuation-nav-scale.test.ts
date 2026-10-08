/**
 *   npx tsx --test lib/server/valuation-nav-scale.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  valuationScaleMismatchesSeries,
  valuationTipIsNotAfterSeries,
} from "./valuation-nav-scale"

describe("valuationTipIsNotAfterSeries", () => {
  it("treats an older custody mark as behind the platform tip", () => {
    const series = [
      { price_date: "2026-01-30", nav: "1.0713" },
      { price_date: "2026-09-24", nav: "1.1550" },
    ]
    const valuation = [{ price_date: "2026-02-02", nav: "1.0787" }]
    assert.equal(valuationTipIsNotAfterSeries(series, valuation), true)
    assert.equal(valuationScaleMismatchesSeries(series, valuation), false)
  })

  it("does not treat a newer valuation tip as behind", () => {
    const series = [{ price_date: "2026-07-03", nav: "1.7062" }]
    const valuation = [{ price_date: "2026-08-31", nav: "1.6153" }]
    assert.equal(valuationTipIsNotAfterSeries(series, valuation), false)
  })
})
