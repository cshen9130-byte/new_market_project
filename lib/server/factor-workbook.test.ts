/**
 *   npx tsx --test lib/server/factor-workbook.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as XLSX from "xlsx"
import { parseFactorWorkbook } from "./factor-workbook"

function workbook(sheetName: string, rows: unknown[][], mutate?: (ws: XLSX.WorkSheet) => void): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  mutate?.(sheet)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, sheetName)
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer
}

describe("parseFactorWorkbook", () => {
  it("turns Wind close levels into close-to-close returns and skips a zero formula column", () => {
    const header = ["Wind代码", "GTJAQH001.WI", "GTJAQH009.WI"]
    const names = ["", "长期动量", "利润"]
    const rows: unknown[][] = [header, names]
    for (let i = 0; i < 40; i++) {
      rows.push([43467 + i, 100 * (1.01 ** i), 0])
    }
    const buffer = workbook("CTA因子", rows, (ws) => {
      for (let i = 0; i < 40; i++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 2 + i, c: 2 })]
        if (cell) cell.f = "i_dq_close($C$2,A3)"
      }
    })

    const parsed = parseFactorWorkbook(buffer, "factors.xlsx")
    assert.equal(parsed.sheetName, "CTA因子")
    assert.deepEqual(parsed.factors.map((factor) => factor.name), ["长期动量"])
    assert.equal(parsed.dates[0], "2019-01-02")
    assert.equal(parsed.dates[1], "2019-01-03")
    const series = parsed.series.GTJAQH001_WI
    assert.equal(series[0], null)
    assert.ok(series[1] != null && Math.abs(series[1] - 0.01) < 1e-12)
    assert.ok(parsed.warnings.some((warning) => warning.includes("利润")))
  })

  it("prefers the factor sheet over an index sheet", () => {
    const factorRows: unknown[][] = [["日期", "基差"]]
    const indexRows: unknown[][] = [["日期", "南华商品"]]
    for (let i = 0; i < 40; i++) {
      factorRows.push([43467 + i, 200 + i])
      indexRows.push([43467 + i, 1000 + i])
    }
    const factor = XLSX.utils.aoa_to_sheet(factorRows)
    const index = XLSX.utils.aoa_to_sheet(indexRows)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, index, "指数收盘价")
    XLSX.utils.book_append_sheet(book, factor, "CTA因子")
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer

    const parsed = parseFactorWorkbook(buffer, "book.xlsx")
    assert.equal(parsed.sheetName, "CTA因子")
    assert.deepEqual(parsed.factors.map((item) => item.name), ["基差"])
    assert.ok(parsed.warnings.some((warning) => warning.includes("指数收盘价")))
  })
})
