/**
 *   npx tsx --test lib/client/cffex-expiry.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  annualizedBasisPct,
  calendarDaysToCffexExpiry,
  daysForBasisBar,
  daysToCffexExpiry,
  listedCffexIndexContractsOnYmd,
} from "./cffex-expiry"

/** Noon in Shanghai, so the calendar day does not slip across UTC midnight. */
function shanghaiNoon(ymd: string) {
  return new Date(`${ymd}T04:00:00Z`)
}

describe("daysForBasisBar", () => {
  it("annualizes a far month with its own expiry, not the front month's last week", () => {
    const on = shanghaiNoon("2026-07-09")
    for (const symbol of ["IH2709", "IF2709", "IC2709", "IM2709"]) {
      const days = daysForBasisBar(symbol, on)
      assert.equal(days, daysToCffexExpiry(symbol, on))
      assert.ok(days != null && days > 400, `${symbol} days ${days}`)
      const ann = annualizedBasisPct(2939.8, 2995.789, days!)
      assert.ok(ann != null && ann > -3 && ann < 0, `${symbol} ann ${ann}`)
    }
  })

  it("keeps a listed near month on its own remaining days", () => {
    const on = shanghaiNoon("2026-11-03")
    const days = daysForBasisBar("IH2611", on)
    assert.equal(days, daysToCffexExpiry("IH2611", on))
    assert.ok(days != null && days > 7 && days < 40, `IH2611 days ${days}`)
  })

  it("picks the April 2025 quarter contract, whose own days make a wide discount about -15%", () => {
    const listed = listedCffexIndexContractsOnYmd("IH", "2025-04-07")
    assert.deepEqual(listed, ["IH2504", "IH2505", "IH2506", "IH2509"])
    const days = calendarDaysToCffexExpiry("IH2506", shanghaiNoon("2025-04-07"))
    assert.equal(days, 74)
    const ann = annualizedBasisPct(100 * (1 - 0.0301), 100, days!)
    assert.ok(ann != null && ann < -14 && ann > -16, `quarter ann ${ann}`)
  })

  it("picks the September 2026 near month, about -15% a week before expiry", () => {
    const listed = listedCffexIndexContractsOnYmd("IH", "2026-09-07")
    assert.equal(listed[0], "IH2609")
    const days = calendarDaysToCffexExpiry("IH2609", shanghaiNoon("2026-09-07"))
    assert.equal(days, 11)
    const ann = annualizedBasisPct(100 * (1 - 0.0045), 100, days!)
    assert.ok(ann != null && ann < -14 && ann > -16, `near ann ${ann}`)
  })

  it("still rolls a continuous symbol inside the last 7 days", () => {
    const beforeRoll = daysForBasisBar("IH0", shanghaiNoon("2026-07-09"))
    const insideRoll = daysForBasisBar("IH0", shanghaiNoon("2026-07-13"))
    assert.equal(beforeRoll, 8)
    assert.ok(insideRoll != null && insideRoll > 30, `rolled days ${insideRoll}`)
  })
})
