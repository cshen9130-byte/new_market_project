import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildSavedFundCompare, fundComparePageUrl } from "../server/fund-compare-link.ts"

describe("fund compare page link", () => {
  it("uses the website compare id and https page", () => {
    const saved = buildSavedFundCompare([
      {
        beian_hao: "SAVW72",
        product_name: "金舆基石一号私募证券投资基金",
        manager: null,
        fund_type: "私募",
        nav_start_date: null,
        latest_nav_date: "2026-11-13",
        inception_date: null,
        ret_ann_since_inception: null,
      },
      {
        beian_hao: "SCN504",
        product_name: "金舆守安一号",
        manager: null,
        fund_type: "私募",
        nav_start_date: null,
        latest_nav_date: "2026-11-13",
        inception_date: null,
        ret_ann_since_inception: null,
      },
    ], 1794891823275)
    assert.equal(saved.id, "cmp-1794891823275")
    assert.equal(saved.name, "金舆基石一号等2只")
    assert.equal(saved.funds[0].beian_hao, "SAVW72")
    assert.equal(
      fundComparePageUrl(saved.id),
      "https://8.154.33.143/ma/dashboard/private-funds/fund-compare/cmp-1794891823275",
    )
  })
})
