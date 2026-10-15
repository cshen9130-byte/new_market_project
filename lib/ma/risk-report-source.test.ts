/**
 *   npx tsx --test lib/ma/risk-report-source.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { rewriteRiskFetchUrl } from "./risk-report-source"

test("监控中心 selection still rewrites mom-analysis onto account-risk", () => {
  const out = rewriteRiskFetchUrl("/ma/api/mom-analysis/product-nav?product_code=AU", "", "book:abc")
  assert.equal(out.accountSource, true)
  assert.equal(out.url, "/ma/api/account-risk/product-nav?product_code=AU&book=abc")
})

test("a MOM sub-account stays on mom-analysis and adds account", () => {
  const out = rewriteRiskFetchUrl(
    "/ma/api/mom-analysis/category-pnl?product_code=AU",
    "rx319",
    "book:abc",
  )
  assert.equal(out.accountSource, false)
  assert.equal(out.url, "/ma/api/mom-analysis/category-pnl?product_code=AU&account=rx319")
})

test("the sub-account list is not rewritten or filtered", () => {
  const out = rewriteRiskFetchUrl("/ma/api/mom-analysis/sub-accounts", "rx000", "book:abc")
  assert.equal(out.accountSource, false)
  assert.equal(out.url, "/ma/api/mom-analysis/sub-accounts")
})
