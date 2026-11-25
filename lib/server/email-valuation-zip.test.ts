import assert from "node:assert/strict"
import test from "node:test"
import AdmZip from "adm-zip"
import {
  expandValuationZipBuffer,
  extractSpreadsheetFromZipBuffer,
} from "./email-valuation-zip"

test("a zip packed inside a zip still yields the spreadsheets", () => {
  const inner = new AdmZip()
  inner.addFile("SJY381_估值表_20261124.xls", Buffer.from("inner-sheet"))
  const outer = new AdmZip()
  outer.addFile("SJY381_20261110-20261124.zip", inner.toBuffer())

  const files = expandValuationZipBuffer(outer.toBuffer(), "SJY381_20261110-20261124.zip")
  assert.deepEqual(
    files.map((file) => file.filename),
    ["SJY381_估值表_20261124.xls"],
  )
  assert.equal(files[0]?.buffer.toString(), "inner-sheet")

  const picked = extractSpreadsheetFromZipBuffer(outer.toBuffer(), "SJY381_估值表_20261124.xls")
  assert.equal(picked?.buffer.toString(), "inner-sheet")
})
