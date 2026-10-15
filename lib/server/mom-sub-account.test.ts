/**
 *   npx tsx --test lib/server/mom-sub-account.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import {
  applyMomSubAccountSql,
  momSubAccountAlsRun,
  parseMomSubAccountParam,
  scopeMomAccountQuery,
} from "./mom-sub-account"

test("parseMomSubAccountParam accepts rx and numeric ids", () => {
  assert.equal(parseMomSubAccountParam("rx000"), "0")
  assert.equal(parseMomSubAccountParam("RX0319"), "319")
  assert.equal(parseMomSubAccountParam("319"), "319")
  assert.equal(parseMomSubAccountParam("  rx319 "), "319")
  assert.equal(parseMomSubAccountParam(""), null)
  assert.equal(parseMomSubAccountParam("all"), null)
  assert.equal(parseMomSubAccountParam(null), null)
  assert.equal(parseMomSubAccountParam("nope"), false)
  assert.equal(parseMomSubAccountParam("rx"), false)
})

test("applyMomSubAccountSql wraps FROM and JOIN and shares one parameter", () => {
  const sql = `SELECT d."账户" FROM mom_daily_reports d JOIN mom_position_details p ON p."账户" = d."账户"`
  const out = applyMomSubAccountSql(sql, [], "319")
  assert.match(out.sql, /FROM \(SELECT \* FROM public\.mom_daily_reports WHERE/)
  assert.match(out.sql, /JOIN \(SELECT \* FROM public\.mom_position_details WHERE/)
  assert.match(out.sql, /\) AS d JOIN/)
  assert.match(out.sql, /\) AS p ON/)
  assert.equal(out.sql.split("$1").length - 1, 2)
  assert.deepEqual(out.params, ["319"])
})

test("applyMomSubAccountSql keeps existing placeholders and does not mutate params", () => {
  const params = ["AU"]
  const sql = `SELECT trade_date FROM mom_trade_details WHERE "合约" = $1`
  const out = applyMomSubAccountSql(sql, params, "0")
  assert.deepEqual(params, ["AU"])
  assert.deepEqual(out.params, ["AU", "0"])
  assert.match(out.sql, /TRIM\(account::text\)/)
  assert.match(out.sql, /\$2/)
  assert.doesNotMatch(out.sql, /"账户"/)
})

test("applyMomSubAccountSql leaves non-account tables and writes alone", () => {
  const fund = `SELECT 1 FROM mom_fund_transactions`
  assert.equal(applyMomSubAccountSql(fund, undefined, "0").sql, fund)
  assert.equal(applyMomSubAccountSql(fund, undefined, "0").params, undefined)

  const insert = `INSERT INTO mom_daily_reports ("账户") VALUES ('rx000')`
  assert.equal(applyMomSubAccountSql(insert, undefined, "0").sql, insert)
})

test("applyMomSubAccountSql replaces a schema-qualified FROM without doubling public", () => {
  const sql = `SELECT 1 FROM public.mom_daily_reports WHERE TRUE`
  const out = applyMomSubAccountSql(sql, undefined, "5")
  assert.match(out.sql, /^SELECT 1 FROM \(SELECT \* FROM public\.mom_daily_reports WHERE/)
  assert.doesNotMatch(out.sql, /public\.\(SELECT/)
  assert.match(out.sql, /\) AS mom_daily_reports WHERE TRUE$/)
})

test("scopeMomAccountQuery is a no-op unless a sub-account is selected", () => {
  const sql = `SELECT 1 FROM mom_daily_reports`
  const idle = scopeMomAccountQuery(sql)
  assert.equal(idle.sql, sql)
  assert.equal(idle.params, undefined)

  const scoped = momSubAccountAlsRun("319", () => scopeMomAccountQuery(sql))
  assert.match(scoped.sql, /public\.mom_daily_reports/)
  assert.deepEqual(scoped.params, ["319"])
})
