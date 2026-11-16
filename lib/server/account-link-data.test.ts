/**
 *   npx tsx --test lib/server/account-link-data.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  compareAccountLink,
  parseAccountLinkFreq,
  parseAccountLinkNav,
  shapeAccountLinkCompare,
} from "@/lib/server/account-link-data"

describe("account link compare shaping", () => {
  it("parses the page's nav and frequency names", () => {
    assert.equal(parseAccountLinkNav(undefined), "adjusted")
    assert.equal(parseAccountLinkNav("累计净值"), "accumulated")
    assert.equal(parseAccountLinkNav("nope"), null)
    assert.equal(parseAccountLinkFreq("weekly"), "周频")
    assert.equal(parseAccountLinkFreq("nope"), null)
  })

  it("quotes overlap returns as percentage points", () => {
    const fund = [
      { d: "2026-10-29", v: 1 },
      { d: "2026-10-30", v: 1.004 },
      { d: "2026-11-02", v: 1.008 },
      { d: "2026-11-03", v: 1.0128 },
    ]
    const account = [
      { d: "2026-10-29", v: 1 },
      { d: "2026-10-30", v: 1.003 },
      { d: "2026-11-02", v: 1.007 },
      { d: "2026-11-03", v: 1.0116 },
    ]
    const shaped = shapeAccountLinkCompare(fund, account, "全部")
    assert.equal(shaped.summary?.fund_period_return_pct, 1.28)
    assert.equal(shaped.summary?.account_period_return_pct, 1.16)
    assert.equal(shaped.summary?.excess_return_pct, 0.12)
    assert.equal(shaped.summary?.overlap_start, "2026-10-29")
    assert.equal(shaped.summary?.overlap_end, "2026-11-03")
    assert.equal(shaped.curve[0]?.fund_pct, 0)
    assert.equal(shaped.curve.at(-1)?.fund_pct, 1.28)
    assert.equal(shaped.curve.at(-1)?.account_pct, 1.16)
  })

  it("rejects a compare call that has no reg_code before touching the database", async () => {
    const result = await compareAccountLink({})
    assert.equal(result.error_code, 1)
    assert.equal(result.data, null)
  })
})
