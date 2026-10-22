import assert from "node:assert/strict"
import test from "node:test"
import { parsePoolPresence, sqlPoolPresenceClause } from "./tracking-pool-membership"

test("parsePoolPresence keeps in and out", () => {
  assert.equal(parsePoolPresence("in"), "in")
  assert.equal(parsePoolPresence("out"), "out")
  assert.equal(parsePoolPresence("all"), "all")
  assert.equal(parsePoolPresence(null), "all")
  assert.equal(parsePoolPresence("both"), "all")
})

test("sqlPoolPresenceClause matches JY跟踪池 and JY精选池 by 备案号", () => {
  assert.equal(sqlPoolPresenceClause("i.beian_hao", "jy", "all"), null)
  const inJy = sqlPoolPresenceClause("cache.beian_hao", "jy", "in")
  assert.match(inJy ?? "", /FROM tracking_pool jy_presence/)
  assert.match(inJy ?? "", /UPPER\(BTRIM\(cache\.beian_hao\)\)/)
  assert.doesNotMatch(inJy ?? "", /^NOT/)
  const outSelected = sqlPoolPresenceClause("i.beian_hao", "selected", "out")
  assert.match(outSelected ?? "", /^NOT \(/)
  assert.match(outSelected ?? "", /FROM selected_pool jy_presence/)
})

test("sqlPoolPresenceClause refuses request text in the column expression", () => {
  assert.throws(() => sqlPoolPresenceClause("i.beian_hao; drop", "jy", "in"))
})
