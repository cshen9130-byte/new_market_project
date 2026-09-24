/**
 *   npx tsx --test lib/fund-display-name.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveFundDisplayLabel } from "./fund-display-name"

describe("resolveFundDisplayLabel", () => {
  it("keeps the share class when the shorter name omits it", () => {
    assert.equal(
      resolveFundDisplayLabel(
        "众量资产聚宝19号",
        "众量资产聚宝19号私募证券投资基金C类",
      ),
      "众量资产聚宝19号C类",
    )
    assert.equal(
      resolveFundDisplayLabel(
        "众量资产聚宝19号B类",
        "众量资产聚宝19号",
      ),
      "众量资产聚宝19号B类",
    )
  })

  it("still prefers the shorter label when both names carry the class", () => {
    assert.equal(
      resolveFundDisplayLabel(
        "众量资产聚宝10号C类",
        "众量资产聚宝10号私募证券投资基金C类",
      ),
      "众量资产聚宝10号C类",
    )
  })

  it("adds the share class from the filing code when both names omit it", () => {
    assert.equal(
      resolveFundDisplayLabel("众量资产聚宝19号", "众量资产聚宝19号", "EJ748B"),
      "众量资产聚宝19号B类",
    )
    assert.equal(
      resolveFundDisplayLabel("众量资产聚宝19号", "众量资产聚宝19号", "SEJ748"),
      "众量资产聚宝19号",
    )
  })

  it("keeps a renamed product_name instead of a different short name", () => {
    assert.equal(
      resolveFundDisplayLabel("兰盈中性增强", "兰盈俱乐部3号"),
      "兰盈俱乐部3号",
    )
  })
})
