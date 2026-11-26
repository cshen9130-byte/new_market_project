/**
 *   npx tsx --test lib/server/ima-dianjing-mirror.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isSkippedImaFolderName, safePathSegment } from "./ima-dianjing-mirror"

describe("ima mirror paths", () => {
  it("skips only the folder named 2025", () => {
    assert.equal(isSkippedImaFolderName("2025"), true)
    assert.equal(isSkippedImaFolderName(" 2025 "), true)
    assert.equal(isSkippedImaFolderName("2025年"), false)
    assert.equal(isSkippedImaFolderName("1116-1120"), false)
  })

  it("keeps Chinese names and strips characters Windows cannot store", () => {
    assert.equal(safePathSegment("点睛业绩放送_量化+主观CTA业绩榜（1116-1120）.xlsx"), "点睛业绩放送_量化+主观CTA业绩榜（1116-1120）.xlsx")
    assert.equal(safePathSegment('a<b>c:"d"?.xlsx'), "a_b_c__d__.xlsx")
  })
})
