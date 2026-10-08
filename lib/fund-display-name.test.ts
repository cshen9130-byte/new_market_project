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

  it("keeps C类份额 as the share class and does not append it twice", () => {
    assert.equal(
      resolveFundDisplayLabel(null, "添禄投资添睿六号私募证券投资基金C类份额", "AWV23C"),
      "添禄投资添睿六号C类",
    )
    assert.equal(
      resolveFundDisplayLabel("添禄投资添睿六号", "添禄投资添睿六号", "AWV23C"),
      "添禄投资添睿六号C类",
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

  it("strips 资产净值公告 filename prefixes from the product name", () => {
    assert.equal(
      resolveFundDisplayLabel(null, "资产净值公告_AVF39A_棕榈滩泰来"),
      "棕榈滩泰来",
    )
    assert.equal(
      resolveFundDisplayLabel(null, "资产净值公告_AVF39A_棕榈滩泰来私募证券投资基金"),
      "棕榈滩泰来",
    )
    assert.equal(
      resolveFundDisplayLabel(null, "资产净值公告_SVP460墨雪鑫瑞1号私募证券投资基金_20260805.xls"),
      "墨雪鑫瑞1号",
    )
    assert.equal(
      resolveFundDisplayLabel(null, "资产净值公告_SSG947_抱朴聚融祥和一号"),
      "抱朴聚融祥和一号",
    )
  })
})
