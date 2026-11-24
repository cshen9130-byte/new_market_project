import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { briefingYearReturn, buildMomBriefingHtml, pickBriefingPoint } from "./mom-briefing-file.ts"

const points = [
  { date: "2026-01-02", nav: 1, cumCapital: 100, dailyReturn: 0 },
  { date: "2026-11-23", nav: 1.1, cumCapital: 120, dailyReturn: 0.012 },
]

describe("MOM briefing file", () => {
  it("uses the latest day unless a date is named", () => {
    assert.equal(pickBriefingPoint(points)?.date, "2026-11-23")
    assert.equal(pickBriefingPoint(points, "2026-01-02")?.date, "2026-01-02")
    assert.equal(pickBriefingPoint(points, "2026-05-01"), null)
  })

  it("puts the day's return in the html file", () => {
    const html = buildMomBriefingHtml({
      points,
      latest: points[1],
      pageUrl: "https://8.154.33.143/ma/dashboard/mom-analysis/risk-report?tab=briefing",
    })
    assert.match(html, /MOM 风控简报/)
    assert.match(html, /2026-11-23/)
    assert.match(html, /\+1\.20%/)
    assert.match(html, /\+10\.00%/)
    assert.ok(Math.abs((briefingYearReturn(points, points[1]) ?? 0) - 0.1) < 1e-9)
  })
})
