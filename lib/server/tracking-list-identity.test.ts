import assert from "node:assert/strict"
import test from "node:test"
import { collapseTrackingIdentities, visibleTrackingBeianCodes } from "./tracking-list-identity"

const CHENGQI = "诚奇浦江CTA1号"

const CHENGQI_ROWS = [
  { beian_hao: "SB595A", product_name: `${CHENGQI}私募证券投资基金A类份额` },
  { beian_hao: "SSB595A", product_name: `${CHENGQI}私募证券投资基金A类` },
  { beian_hao: "SSB595", product_name: CHENGQI },
  {
    beian_hao: "场外_已上市_开放式_私募_成本.诚奇浦江CTA1号",
    product_name: "场外_已上市_开放式_私募_成本.诚奇浦江CTA1号",
  },
]

test("诚奇浦江CTA1号A类 keeps the share whose latest nav matches the product page", () => {
  assert.deepEqual(visibleTrackingBeianCodes(CHENGQI_ROWS), ["SB595A"])
})

test("keyword catalog collapse keeps one 诚奇浦江 row", () => {
  const collapsed = collapseTrackingIdentities(CHENGQI_ROWS)
  assert.deepEqual(collapsed.map((row) => row.beian_hao), ["SB595A"])
})

test("a lone tiered share stays when the over-stripped code is not in the list", () => {
  const visible = visibleTrackingBeianCodes([
    { beian_hao: "SB595A", product_name: `${CHENGQI}A类` },
  ])
  assert.deepEqual(visible, ["SB595A"])
})

test("parent is still hidden beside a same-family share class", () => {
  const visible = visibleTrackingBeianCodes([
    { beian_hao: "SALF51", product_name: "示例一号" },
    { beian_hao: "ALF51B", product_name: "示例一号B类" },
  ])
  assert.deepEqual(visible, ["ALF51B"])
})

test("a mapped custodian code collapses even when the stored names differ", () => {
  assert.deepEqual(
    visibleTrackingBeianCodes([
      { beian_hao: "SBTH74B", product_name: "另一只产品B类" },
      { beian_hao: "BTH74B", product_name: "示例二号B类" },
    ]),
    ["BTH74B"],
  )
})

test("藤创藤达CTA1号A类 drops the custodian ticker beside the 备案号", () => {
  assert.deepEqual(
    visibleTrackingBeianCodes([
      { beian_hao: "BJN16A", product_name: "藤创藤达CTA1号私募证券投资基金A类份额" },
      { beian_hao: "ABFJ9A", product_name: "藤创藤达CTA1号A类" },
      { beian_hao: "SBJN16", product_name: "藤创藤达CTA1号" },
    ]),
    ["BJN16A"],
  )
})

test("an S-prefix share is kept when the canonical code is a different fund name", () => {
  assert.deepEqual(
    visibleTrackingBeianCodes([
      { beian_hao: "SSB595A", product_name: "另一只A类" },
      { beian_hao: "SB595A", product_name: "诚奇浦江CTA1号A类" },
    ]).sort(),
    ["SB595A", "SSB595A"],
  )
})
