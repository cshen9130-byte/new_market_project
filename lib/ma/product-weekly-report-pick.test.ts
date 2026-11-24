import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { pickProductWeeklyReport, type ProductWeeklyRow } from "./product-weekly-report-pick.ts"

const rows: ProductWeeklyRow[] = [
  { reportId: "a", product_name: "金舆基石一号", beian_hao: "SAVW72", title: "金舆基石一号", weekStart: "2026-11-16", weekEnd: "2026-11-20" },
  { reportId: "b", product_name: "金舆基石一号", beian_hao: "SAVW72", title: "金舆基石一号", weekStart: "2026-11-09", weekEnd: "2026-11-13" },
  { reportId: "c", product_name: "金舆守安一号", beian_hao: "SCN504", title: "金舆守安一号", weekStart: "2026-11-16", weekEnd: "2026-11-20" },
]

describe("product weekly report pick", () => {
  it("picks the latest week for one product", () => {
    const picked = pickProductWeeklyReport(rows, "基石一号")
    assert.equal(picked.status, "ok")
    if (picked.status === "ok") assert.equal(picked.row.reportId, "a")
  })

  it("does not guess when two products match", () => {
    const picked = pickProductWeeklyReport(rows, "金舆")
    assert.equal(picked.status, "ambiguous")
  })

  it("uses the named week", () => {
    const picked = pickProductWeeklyReport(rows, "SAVW72", "2026-11-13")
    assert.equal(picked.status, "ok")
    if (picked.status === "ok") assert.equal(picked.row.reportId, "b")
  })
})
