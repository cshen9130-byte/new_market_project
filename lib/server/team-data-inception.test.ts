import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { listedInceptionDate, navStartValueBand, parentFilingCodes, parentNavStart, shareClassNavTipFits } from "./team-data-query-pg"

function sources(partial: {
  track?: Array<[string, string]>
  info?: Array<[string, string]>
  amac?: Array<[string, string]>
}) {
  return {
    track: new Map(partial.track ?? []),
    info: new Map(partial.info ?? []),
    amac: new Map(partial.amac ?? []),
  }
}

describe("listed inception date", () => {
  it("uses the parent filing when an A类 code has no date of its own", () => {
    assert.equal(
      listedInceptionDate("AZV51A", sources({ track: [["SAZV51", "2025-06-10"]] })),
      "2025-06-10",
    )
  })

  it("keeps the share-class date when that code has one", () => {
    assert.equal(
      listedInceptionDate("AZV51A", sources({
        track: [["AZV51A", "2024-01-01"], ["SAZV51", "2025-06-10"]],
      })),
      "2024-01-01",
    )
  })

  it("prefers 产品要素 over 协会成立日期", () => {
    assert.equal(
      listedInceptionDate("AZV51A", sources({
        track: [["SAZV51", "2025-06-10"]],
        amac: [["SAZV51", "2020-01-01"]],
      })),
      "2025-06-10",
    )
  })

  it("falls back to the parent 协会成立日期", () => {
    assert.equal(
      listedInceptionDate("AZV51A", sources({ amac: [["SAZV51", "2025-06-10"]] })),
      "2025-06-10",
    )
  })

  it("treats a first unit NAV within 5% of 1 as near", () => {
    assert.equal(navStartValueBand("1"), "near_1")
    assert.equal(navStartValueBand("1.0000"), "near_1")
    assert.equal(navStartValueBand("0.95"), "near_1")
    assert.equal(navStartValueBand("1.05"), "near_1")
    assert.equal(navStartValueBand("1.0501"), "away_1")
    assert.equal(navStartValueBand("0.949"), "away_1")
    assert.equal(navStartValueBand("1.4598"), "away_1")
    assert.equal(navStartValueBand(null), "missing")
    assert.equal(navStartValueBand(""), "missing")
  })

  it("does not let a B类 tip replace the parent fund", () => {
    assert.equal(shareClassNavTipFits("", "B"), false)
    assert.equal(shareClassNavTipFits("A", "B"), false)
    assert.equal(shareClassNavTipFits("B", "B"), true)
    assert.equal(shareClassNavTipFits("B", ""), true)
    assert.equal(shareClassNavTipFits("", ""), true)
  })

  it("maps 金舆中国互联网B类 back to the parent filing the product page charts", () => {
    const parents = parentFilingCodes("J5938B")
    assert.ok(parents.includes("SJ5938"))
    assert.ok(parents.includes("J5938"))
    assert.deepEqual(
      parentNavStart(
        { beian_hao: "J5938B" },
        [{
          code: "SJ5938",
          cache_key: "SJ5938",
          product_name: "金舆中国互联网",
          date: "2016-05-13",
          nav: "1",
        }],
        new Map(),
      ),
      { date: "2016-05-13", nav: "1" },
    )
    assert.equal(
      parentNavStart(
        { beian_hao: "J5938B" },
        [{
          code: "J5938A",
          cache_key: "J5938A",
          product_name: "金舆中国互联网A类",
          date: "2016-01-01",
          nav: "1",
        }],
        new Map(),
      ),
      null,
    )
  })

  it("does not borrow an unrelated code", () => {
    assert.equal(
      listedInceptionDate("SAZV51", sources({ track: [["OTHER1", "2025-06-10"]] })),
      null,
    )
  })
})
