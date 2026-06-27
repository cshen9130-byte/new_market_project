import assert from "node:assert/strict"
import { parseValuationRows } from "../../lib/server/valuation-analyzer.ts"
import {
  inferCustodianFromText,
  resolveCustodianFromValuationRecord,
} from "../../lib/server/email-valuation-custodian.ts"
import { lookupManagedProductCustodian } from "../../lib/server/managed-product-beian.ts"
import { extractValuationFromEmailBody } from "../../lib/server/email-valuation-attachment.ts"

function headerRows(extra) {
  return [
    ...extra,
    ["科目代码", "科目名称", "数量", "单位成本", "成本", "市价", "市值"],
    ["1002", "银行存款", 1, 1, 100, 1, 100],
    ["1109", "私募基金", 1, 1, 100, 1, 100],
    ["1109", "私募基金B", 1, 1, 100, 1, 100],
    ["资产类合计", "", "", "", 300, "", 300],
  ]
}

const inline = parseValuationRows(
  headerRows([["基金托管人：国泰海通证券股份有限公司"]]),
  "test.xls",
)
assert.equal(inline.summary.custodian, "国泰海通证券股份有限公司")

const adjacent = parseValuationRows(
  headerRows([["基金托管人", "华泰证券股份有限公司", "产品名称", "测试基金"]]),
  "test.xls",
)
assert.equal(adjacent.summary.custodian, "华泰证券股份有限公司")

const below = parseValuationRows(
  headerRows([
    ["基金托管人", "", "产品名称", "测试基金"],
    ["国信证券股份有限公司", "", "管理人", "测试公司"],
  ]),
  "test.xls",
)
assert.equal(below.summary.custodian, "国信证券股份有限公司")

const standalone = parseValuationRows(
  headerRows([["中信证券股份有限公司"], ["产品名称", "测试基金"]]),
  "test.xls",
)
assert.equal(standalone.summary.custodian, "中信证券股份有限公司")

assert.equal(
  inferCustodianFromText("【华泰证券】基金估值表 SSG947_测试_20260622"),
  "华泰证券",
)

const resolved = resolveCustodianFromValuationRecord({
  custodian: null,
  summaryCustodian: null,
  senderEmail: "valuation@gtht.com",
  subject: "【基金估值表】SSG947_测试_资产估值表_20260622",
  attachmentFilename: "SSG947_测试_资产估值表_20260622.xls",
})
assert.equal(resolved, "国泰海通证券股份有限公司")

const cmschina = resolveCustodianFromValuationRecord({
  custodian: null,
  summaryCustodian: null,
  senderEmail: "valuation@cmschina.com",
  subject: "【基金估值表】SSG947_抱朴聚融祥和一号_资产估值表_20260622",
  attachmentFilename: "SSG947_抱朴聚融祥和一号_资产估值表_20260622.xls",
})
assert.equal(cmschina, "招商证券股份有限公司")

const cmschinaOtherBroker = resolveCustodianFromValuationRecord({
  custodian: null,
  summaryCustodian: null,
  headerRows: [["基金托管人", "光大证券股份有限公司"]],
  senderEmail: "valuation@cmschina.com",
  subject: "【基金估值表】TEST_衡颐海宸1号_资产估值表_20260622",
  attachmentFilename: "TEST_衡颐海宸1号_资产估值表_20260622.xls",
})
assert.equal(cmschinaOtherBroker, "光大证券股份有限公司")

assert.equal(lookupManagedProductCustodian(null, "SSG947"), "招商证券股份有限公司")
assert.equal(
  lookupManagedProductCustodian("抱朴聚融祥和一号私募证券投资基金", null),
  "招商证券股份有限公司",
)

const body = extractValuationFromEmailBody(
  "基金托管人：光大证券股份有限公司\n科目代码\t科目名称\t数量\n1002\t银行存款\t1\n1109\t私募基金\t1\n1109\t私募基金B\t1",
  "【基金估值表】TEST_测试_20260622",
  "notice@ebscn.com",
)
assert.equal(body?.custodian, "光大证券股份有限公司")

console.log("custodian extraction tests passed")
