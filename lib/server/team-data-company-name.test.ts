import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isBareManagerCompanyName } from "./team-data-query-pg"

describe("bare manager company names", () => {
  it("drops 管理人 legal names that were stored as products", () => {
    assert.equal(isBareManagerCompanyName("上海复途管理有限公司"), true)
    assert.equal(isBareManagerCompanyName("湖南汇智融达管理有限公司"), true)
    assert.equal(isBareManagerCompanyName("上海交睿管理有限公司"), true)
    assert.equal(isBareManagerCompanyName("上海复途私募基金管理有限公司"), true)
    assert.equal(isBareManagerCompanyName("武汉金时信管理有限公司"), true)
    assert.equal(isBareManagerCompanyName("南京金友管理有限公司"), true)
  })

  it("keeps the 申银万国期货 single-account book", () => {
    assert.equal(isBareManagerCompanyName("申银万国期货8005166176"), false)
    assert.equal(isBareManagerCompanyName("申银万国期货 8005166176"), false)
  })

  it("keeps real fund names", () => {
    assert.equal(isBareManagerCompanyName("复途神舟一号"), false)
    assert.equal(isBareManagerCompanyName("国泰君安期货CTA因子组合2号集合资产管理计划"), false)
    assert.equal(isBareManagerCompanyName("汇融CTA增强13号私募证券投资基金B类"), false)
  })
})
