/**
 *   npx tsx --test lib/server/ima-dianjing-rank.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { pickLatestWeekFolder, weekFolderEndIso } from "./ima-dianjing-rank"

describe("ima week folder", () => {
  it("reads an MMDD-MMDD folder as this year when the end date is not far ahead", () => {
    assert.equal(weekFolderEndIso("1116-1120", "2026-11-26"), "2026-11-20")
    assert.equal(weekFolderEndIso("2025", "2026-11-26"), null)
    assert.equal(weekFolderEndIso("0831-0930", "2026-11-26"), "2026-09-30")
  })

  it("rolls a December folder back a year once January has started", () => {
    assert.equal(weekFolderEndIso("1222-1226", "2027-01-08"), "2026-12-26")
    assert.equal(weekFolderEndIso("0104-0108", "2027-01-08"), "2027-01-08")
  })

  it("picks the latest week folder and ignores the year archive", () => {
    const latest = pickLatestWeekFolder(
      [{ name: "2025" }, { name: "0105-0109" }, { name: "0831-0930" }, { name: "1116-1120" }],
      "2026-11-26",
    )
    assert.equal(latest?.name, "1116-1120")
  })

  it("prefers the new year week over last December", () => {
    const latest = pickLatestWeekFolder(
      [{ name: "1222-1226" }, { name: "0104-0108" }],
      "2027-01-08",
    )
    assert.equal(latest?.name, "0104-0108")
  })
})
