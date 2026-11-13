/**
 *   npx tsx --test lib/ma/quant-accounts.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import {
  QUANT_ACCOUNT_IDS,
  QUANT_STRATEGY_ACCOUNTS,
  isDefaultQuantIds,
  isQuantAccount,
  parseQuantIdList,
  quantStrategyAccount,
  quantStrategyLabel,
  quantStrategyTitle,
} from "./quant-accounts"
import { quantStrategyBooks } from "./quant-strategy-source"
import { quantStrategyWarmQueries } from "./quant-strategy-ranges"

test("isDefaultQuantIds ignores order and rejects a custom subset", () => {
  assert.equal(isDefaultQuantIds(QUANT_ACCOUNT_IDS), true)
  assert.equal(isDefaultQuantIds([...QUANT_ACCOUNT_IDS].reverse()), true)
  assert.equal(isDefaultQuantIds(parseQuantIdList("319,324")), false)
  assert.equal(isDefaultQuantIds([]), false)
})

test("rx387 is a MOM quant sleeve and the broker books stay off that list", () => {
  assert.equal(isQuantAccount("rx387"), true)
  assert.equal(isQuantAccount("387"), true)
  assert.equal(isQuantAccount("10800677"), false)
  assert.equal(isQuantAccount("85121150"), false)
  assert.ok(QUANT_ACCOUNT_IDS.includes(387))
})

test("量化策略分析 lists rx387, 正信期货 and 国泰君安期货", () => {
  const byId = new Map(QUANT_STRATEGY_ACCOUNTS.map((a) => [a.id, a]))
  assert.equal(byId.get("387")?.label, "rx387")
  assert.equal(byId.get("387")?.source, "mom")
  assert.equal(byId.get("10800677")?.label, "正信期货")
  assert.equal(byId.get("10800677")?.source, "cfmmc")
  assert.equal(byId.get("85121150")?.label, "国泰君安期货")
  assert.equal(quantStrategyLabel("85121150"), "国泰君安期货")
  assert.equal(quantStrategyTitle("10800677"), "正信期货 10800677")
  assert.equal(quantStrategyAccount("rx387")?.source, "mom")
})

test("broker strategy SQL reads cfmmc only", () => {
  const books = quantStrategyBooks("10800677")
  const sql = [books.daily, books.close, books.trade, books.pos].join("\n")
  assert.equal(books.source, "cfmmc")
  assert.match(sql, /public\.cfmmc_daily_summary/)
  assert.match(sql, /public\.cfmmc_closes/)
  assert.match(sql, /public\.cfmmc_trades/)
  assert.match(sql, /public\.cfmmc_positions/)
  assert.match(sql, /account_no = \$1/)
  assert.match(sql, /trade_date BETWEEN \$2::date AND \$3::date/)
  assert.match(sql, /MAX\(trade_date\) OVER \(\)/)
  assert.doesNotMatch(sql, /mom_/)
  assert.equal(quantStrategyBooks("387").daily, "mom_daily_reports")
  assert.equal(quantStrategyBooks("319").close, "mom_close_details")
})

test("precompute covers the new strategy accounts", () => {
  const ids = new Set(quantStrategyWarmQueries().map((q) => q.account))
  assert.ok(ids.has("387"))
  assert.ok(ids.has("10800677"))
  assert.ok(ids.has("85121150"))
  assert.ok(ids.has("319"))
})
