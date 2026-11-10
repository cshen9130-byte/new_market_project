/**
 *   npx tsx --test lib/server/auto-weekly-reports-display.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  autoWeeklyReportDedupeKey,
  autoWeeklyWeekGroupKey,
  pickPreferredAutoWeeklyReports,
} from "@/lib/server/auto-weekly-reports"

type Row = {
  id: string
  product_name: string
  beian_hao: string | null
  weekEnd: string
  templateId?: string
}

function row(
  id: string,
  name: string,
  weekEnd: string,
  templateId: string,
  beian_hao: string | null = "S123",
): Row {
  return { id, product_name: name, beian_hao, weekEnd, templateId }
}

describe("autoWeeklyReportDedupeKey", () => {
  it("keeps curve and holdings reports for the same product week distinct", () => {
    const curve = autoWeeklyReportDedupeKey("抱朴聚融祥和一号", "S123", "2026-11-06", "weekly-track-curve")
    const pie = autoWeeklyReportDedupeKey("抱朴聚融祥和一号", "S123", "2026-11-06", "weekly-track-holdings")
    assert.notEqual(curve, pie)
    assert.equal(
      autoWeeklyWeekGroupKey("抱朴聚融祥和一号", "S123", "2026-11-06"),
      autoWeeklyWeekGroupKey("抱朴聚融祥和一号", "S123", "2026-11-06"),
    )
    assert.equal(
      autoWeeklyReportDedupeKey("抱朴聚融祥和一号", "S123", "2026-11-06", undefined),
      curve,
    )
  })
})

describe("pickPreferredAutoWeeklyReports", () => {
  const reports = [
    row("c1", "抱朴聚融祥和一号", "2026-11-06", "weekly-track-curve"),
    row("h1", "抱朴聚融祥和一号", "2026-11-06", "weekly-track-holdings"),
    row("c0", "抱朴聚融祥和一号", "2026-10-30", "weekly-track-curve"),
    row("h2", "另一产品", "2026-11-06", "weekly-track-holdings", "S999"),
  ]

  it("shows only the holdings report when that template is selected", () => {
    const picked = pickPreferredAutoWeeklyReports(reports, () => "weekly-track-holdings")
    assert.deepEqual(
      picked.map((item) => item.id),
      ["h1", "h2"],
    )
  })

  it("shows only the curve report when that template is selected", () => {
    const picked = pickPreferredAutoWeeklyReports(reports, () => "weekly-track-curve")
    assert.deepEqual(
      picked.map((item) => item.id),
      ["c1", "c0"],
    )
  })

  it("does not fall back to the other variant when the preferred one is missing", () => {
    const picked = pickPreferredAutoWeeklyReports(reports, (item) =>
      item.product_name === "抱朴聚融祥和一号" && item.weekEnd === "2026-10-30"
        ? "weekly-track-holdings"
        : "weekly-track-curve",
    )
    assert.deepEqual(
      picked.map((item) => item.id),
      ["c1"],
    )
  })
})