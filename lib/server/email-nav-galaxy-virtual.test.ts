/**
 *   npx tsx --test lib/server/email-nav-galaxy-virtual.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as XLSX from "xlsx"
import { extractNavData, extractNavMetadata } from "./email-nav-extract"
import {
  extractNavTableFromBuffer,
  isNavTableAttachmentFilename,
  isNavTableSubject,
  selectNavTableAttachments,
} from "./email-nav-attachment"

const SUBJECT =
  "[虚拟净值][AJX62B]-[稳博鹏瑞套利2号私募证券投资基金B][鑫楚稳增量化1号FOF私募证券投资基金][20260924]"
const FILENAME = `${SUBJECT}.xls`
const BODY = [
  "产品名称 产品代码 客户名称 参与计提份额 净值日期 单位净值 累计单位净值 虚拟计提业绩报酬 提取前净值 计提后虚拟净值 基金账号",
  "稳博鹏瑞套利2号私募证券投资基金B AJX62B 鑫楚稳增量化1号FOF私募证券投资基金 913,492.28 20260924 1.1327 1.1327 20,827.62 0.0228 1.1099 Y10017653998",
].join("\n")

describe("银河 [虚拟净值] mail", () => {
  it("reads the product code and B-class name, not the FOF investor", () => {
    const meta = extractNavMetadata(SUBJECT, BODY)
    assert.equal(meta.productCode, "AJX62B")
    assert.equal(meta.fundName, "稳博鹏瑞套利2号B类")
  })

  it("accepts the same subject when the investor name is not wrapped in brackets", () => {
    const plain =
      "[虚拟净值][AJX62B]-[稳博鹏瑞套利2号私募证券投资基金B]金舆稳健增长1号FOF私募证券投资基金[20260827]"
    const meta = extractNavMetadata(plain, "")
    assert.equal(meta.productCode, "AJX62B")
    assert.equal(meta.fundName, "稳博鹏瑞套利2号B类")
  })

  it("stores 单位净值, not 计提后虚拟净值", () => {
    const row = extractNavData(SUBJECT, BODY)
    assert.ok(row)
    assert.equal(row.nav, 1.1327)
    assert.equal(row.cumulativeNav, 1.1327)
    assert.equal(row.navDate, "2026-09-24")
    assert.equal(row.productCode, "AJX62B")
    assert.equal(row.fundName, "稳博鹏瑞套利2号B类")
    assert.notEqual(row.nav, 1.1099)
  })

  it("treats the half-width subject and xls as a NAV attachment", () => {
    assert.equal(isNavTableSubject(SUBJECT), true)
    assert.equal(isNavTableAttachmentFilename(FILENAME), true)
    const picked = selectNavTableAttachments(SUBJECT, [{ filename: FILENAME, part: "2" }])
    assert.deepEqual(picked.map((item) => item.filename), [FILENAME])
  })

  it("reads 单位净值 from the workbook and ignores the fee columns", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["产品名称", "产品代码", "客户名称", "参与计提份额", "净值日期", "单位净值", "累计单位净值", "虚拟计提业绩报酬", "提取前净值", "计提后虚拟净值", "基金账号"],
      ["稳博鹏瑞套利2号私募证券投资基金B", "AJX62B", "鑫楚稳增量化1号FOF私募证券投资基金", 913492.28, "20260924", 1.1327, 1.1327, 20827.62, 0.0228, 1.1099, "Y10017653998"],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, "Sheet1")
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xls" }) as Buffer
    const rows = extractNavTableFromBuffer(buffer, FILENAME, SUBJECT)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].nav, 1.1327)
    assert.equal(rows[0].cumulativeNav, 1.1327)
    assert.equal(rows[0].navDate, "2026-09-24")
    assert.equal(rows[0].productCode, "AJX62B")
    assert.equal(rows[0].fundName, "稳博鹏瑞套利2号B类")
  })
})
