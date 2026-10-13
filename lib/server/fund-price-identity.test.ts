import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  familySearchText,
  fundFamilyName,
  isTestFundProduct,
  listedPriceFields,
  nullFirstPriceChange,
  pagePricePoints,
  parsePriceBulkCursor,
  priceChangePercent,
  priceCodeCandidates,
  sameFundFamily,
} from "./fund-price-identity"

describe("price codes", () => {
  it("maps AAK83C to parent SAAK83 and not a longer neighbor", () => {
    const codes = priceCodeCandidates("AAK83C")
    assert.equal(codes[0], "SAAK83")
    assert.equal(codes.includes("AAK837"), false)
    assert.deepEqual(listedPriceFields("AAK83C"), {
      parent_reg_code: "SAAK83",
      share_class: "C",
      price_reg_code: "SAAK83",
    })
  })

  it("maps BAK10A to SBAK10", () => {
    assert.equal(priceCodeCandidates("BAK10A")[0], "SBAK10")
  })

  it("does not invent a name-family alias such as AANT7A to VR172A", () => {
    assert.equal(priceCodeCandidates("AANT7A").includes("VR172A"), false)
    assert.equal(priceCodeCandidates("ZB0807").includes("SXL292"), false)
  })
})

describe("family names", () => {
  it("treats share-class wording and legal suffixes as one product", () => {
    const base = fundFamilyName("自然红启程2号私募证券投资基金")
    assert.equal(fundFamilyName("自然红启程2号私募基金A类"), base)
    assert.equal(fundFamilyName("自然红启程2号（B类份额）"), base)
    assert.equal(fundFamilyName("自然红启程2号A类份额"), base)
    assert.equal(sameFundFamily("自然红启程2号私募证券投资基金", "自然红启程2号（B类份额）"), true)
    assert.equal(sameFundFamily("自然红启程2号", "另一只产品2号"), false)
    assert.equal(familySearchText("自然红启程2号（B类份额）"), "自然红启程2号")
  })
})

describe("test products", () => {
  it("recognizes leaked test rows", () => {
    assert.equal(isTestFundProduct("Test Fund 1780586970800", "SD8500_test_1780586970800"), true)
    assert.equal(isTestFundProduct("奇盾量化优选2号私募证券投资基金B类", "BGD35B"), false)
  })
})

describe("price change", () => {
  it("keeps percent points and nulls only the first row", () => {
    assert.equal(priceChangePercent(""), null)
    assert.equal(priceChangePercent("0.297619"), 0.297619)
    assert.equal(priceChangePercent(0), 0)
    const points = nullFirstPriceChange([
      { price_date: "2026-01-02", price_change: 0.297619 },
      { price_date: "2026-01-01", price_change: 0 },
      { price_date: "2026-01-03", price_change: 0 },
    ])
    assert.equal(points[0].price_change, null)
    assert.equal(points[1].price_change, 0.297619)
    assert.equal(points[2].price_change, 0)
  })
})

describe("bulk cursor", () => {
  it("continues a capped series from the next day", () => {
    const points = Array.from({ length: 5001 }, (_, i) => ({ price_date: `2020-01-${String((i % 28) + 1).padStart(2, "0")}` }))
    points.sort((a, b) => a.price_date.localeCompare(b.price_date))
    const page = pagePricePoints(points, null, null)
    assert.equal(page.truncated, true)
    assert.equal(page.points.length, 5000)
    assert.ok(page.next_start_date)
    assert.deepEqual(parsePriceBulkCursor("12@2024-03-01"), { index: 12, start: "2024-03-01" })
  })
})
