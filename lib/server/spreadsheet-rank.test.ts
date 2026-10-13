import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as XLSX from "xlsx"
import {
  chooseRankFile,
  matchColumn,
  parseRankQuestion,
  pathHasToken,
  pickRankTable,
  sortSheetRows,
  tablesFromWorkbook,
} from "./spreadsheet-rank"

const QUESTION = "点睛 排行榜 截止20250930 which 主观多头 基金管理人 have the highest 成立以来夏普比率"

function workbook(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["点睛业绩放送"],
    ["基金管理人", "管理规模", "今年以来收益率", "成立以来夏普比率", "成立以来年化", "年化波动", "成立以来动态回撤"],
    ["北京禧悦私募", "5-10亿", "159.12%", 1.31, "99.71%", "74.30%", "72.60%"],
    ["国源信达", "50-100亿", "40.00%", 1.96, "26.77%", "10.65%", "4.58%"],
    ["和正私募", "10-20亿", "38.00%", 1.77, "28.56%", "12.63%", "8.70%"],
  ])
  const other = XLSX.utils.aoa_to_sheet([
    ["基金管理人", "成立以来夏普比率"],
    ["别的管理人", 9.9],
  ])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, "主观多头(20250930)")
  XLSX.utils.book_append_sheet(book, other, "量化CTA(20250930)")
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer
}

describe("filename tokens", () => {
  const files = [
    "外部私募业绩排行/点睛业绩放送_主观多头管理人业绩榜（今年来截止930）.xlsx",
    "外部私募业绩排行/点睛业绩放送_量化股票管理人业绩榜（今年来截止930）.xlsx",
    "外部私募业绩排行/点睛业绩放送_量化+主观CTA（截止20250930）.xlsx",
    "内部尽调资料/某路演.pdf",
  ]

  it("matches 20250930 to a filename that only says 930", () => {
    assert.equal(pathHasToken(files[0], "20250930"), true)
  })

  it("returns the 主观多头 workbook for 点睛 plus 930", () => {
    const tokens = parseRankQuestion(QUESTION)?.tokens ?? []
    assert.equal(chooseRankFile(files, tokens), files[0])
    assert.equal(chooseRankFile(files, ["点睛", "20250930"]).startsWith("外部私募业绩排行/点睛"), true)
  })
})

describe("sharpe sort", () => {
  it("sorts 成立以来夏普比率 instead of the sheet's year-to-date order", () => {
    const tables = tablesFromWorkbook(workbook())
    const picked = pickRankTable(tables, QUESTION)
    assert.equal(picked?.table.sheet, "主观多头(20250930)")
    assert.equal(matchColumn(picked?.table.headers ?? [], QUESTION), "成立以来夏普比率")
    const sorted = sortSheetRows(picked!.table.rows, picked!.column, "desc")
    assert.equal(sorted[0]["基金管理人"], "国源信达")
    assert.equal(sorted[0]["成立以来夏普比率"], 1.96)
    assert.equal(sorted[1]["基金管理人"], "和正私募")
    assert.equal(sorted[2]["基金管理人"], "北京禧悦私募")
    assert.equal(sorted[0]["基金管理人"] === tables[0].rows[0]["基金管理人"], false)
  })
})
