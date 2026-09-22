import assert from "node:assert/strict"
import * as XLSX from "xlsx"
import { extractNavMetadata } from "../../lib/server/email-nav-extract"
import { parseValuationWorkbook } from "../../lib/server/valuation-analyzer"
import {
  cleanValuationDerivedFundName,
  parseValuationWorkbookFilename,
} from "../../lib/server/valuation-filename"
import { resolveUnregisteredProductName } from "../../lib/server/unregistered-fund-product"

const title = "SAJX62稳博鹏瑞套利2号2026年08月31日估值报表四级.xls"

const parsed = parseValuationWorkbookFilename(title)
assert.equal(parsed?.code, "SAJX62")
assert.equal(parsed?.fundName, "稳博鹏瑞套利2号")

const meta = extractNavMetadata(title, "")
assert.equal(meta.fundName, "稳博鹏瑞套利2号")
assert.equal(meta.productCode, "SAJX62")

assert.equal(
  cleanValuationDerivedFundName("2024-03-20至2024-08-27估值报表补发文件"),
  null,
)
assert.equal(resolveUnregisteredProductName({ fileName: title }), "稳博鹏瑞套利2号")
assert.equal(
  resolveUnregisteredProductName({
    extracted: { fund_name: "SAJX62稳博鹏瑞套利2号2026年08月31日估值报表四级" } as never,
  }),
  "稳博鹏瑞套利2号",
)

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ["SAJX62稳博鹏瑞套利2号2026年08月31日估值报表四级"],
    ["产品名称", "SAJX62稳博鹏瑞套利2号2026年08月31日估值报表四级"],
    ["科目代码", "科目名称", "市值"],
    ["1002", "银行存款", 100],
  ]),
  "Sheet1",
)
const analysis = parseValuationWorkbook(
  Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })),
  title,
)
assert.equal(analysis.summary.fund_name, "稳博鹏瑞套利2号")

const existing = parseValuationWorkbookFilename(
  "SBHK26_六妙星豪鑫6号私募证券投资基金_资产估值表_20260630_4级_荣熙共赢私募证券投资基金.xls",
)
assert.equal(existing, null, "legal-suffix custody names stay with older parsers")

const guosen = extractNavMetadata("SCP742金舆木盛那平江1号私募证券投资基金估值表20260825.xlsx", "")
assert.equal(guosen.productCode, "SCP742")
assert.match(guosen.fundName ?? "", /金舆木盛那平江1号/)

assert.equal(
  parseValuationWorkbookFilename("SAJX62稳博鹏瑞套利2号2026年08月31日估值报表四级")?.code,
  "SAJX62",
)

console.log("ok: valuation filename product-name cleanup")
