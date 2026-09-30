/**
 *   npx tsx --test lib/server/fof-overview-list-sort.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  isSignedNumericOrderAlias,
  orderSqlForProjectedAlias,
} from "./fof-overview-list-sort"

const SIGNED_ALIASES = [
  "latest_return_pct",
  "ret_1w",
  "ret_1m",
  "ret_3m",
  "ret_6m",
  "ret_1y",
  "sharpe_1y",
  "calmar_1y",
] as const

describe("orderSqlForProjectedAlias", () => {
  it("casts latest_return_pct through ::numeric so leading +/- sort as numbers", () => {
    assert.equal(
      orderSqlForProjectedAlias("latest_return_pct", "ASC"),
      "latest_return_pct::numeric ASC NULLS LAST",
    )
    assert.equal(
      orderSqlForProjectedAlias("latest_return_pct", "DESC"),
      "latest_return_pct::numeric DESC NULLS LAST",
    )
  })

  it("casts all signed return / risk metric aliases the same way", () => {
    for (const alias of SIGNED_ALIASES) {
      assert.equal(
        orderSqlForProjectedAlias(alias, "ASC"),
        `${alias}::numeric ASC NULLS LAST`,
      )
      assert.equal(isSignedNumericOrderAlias(alias), true)
    }
  })

  it("casts 近一年夏普比率 / 近一年卡玛比率 (sharpe_1y / calmar_1y) as signed numerics", () => {
    assert.equal(
      orderSqlForProjectedAlias("sharpe_1y", "DESC"),
      "sharpe_1y::numeric DESC NULLS LAST",
    )
    assert.equal(
      orderSqlForProjectedAlias("calmar_1y", "ASC"),
      "calmar_1y::numeric ASC NULLS LAST",
    )
  })

  it("leaves date, name, and non-signed aliases unchanged (no cast)", () => {
    assert.equal(
      orderSqlForProjectedAlias("product_name", "ASC"),
      "product_name ASC NULLS LAST",
    )
    assert.equal(
      orderSqlForProjectedAlias("first_entry_date", "DESC"),
      "first_entry_date DESC NULLS LAST",
    )
    assert.equal(
      orderSqlForProjectedAlias("latest_nav_date", "ASC"),
      "latest_nav_date ASC NULLS LAST",
    )
    assert.equal(
      orderSqlForProjectedAlias("market_value_num", "DESC"),
      "market_value_num DESC NULLS LAST",
    )
    assert.equal(
      orderSqlForProjectedAlias("latest_unit_nav", "DESC"),
      "latest_unit_nav DESC NULLS LAST",
    )
    assert.equal(isSignedNumericOrderAlias("product_name"), false)
  })

  it("keeps NULLS LAST so missing values sort to the end in both directions", () => {
    for (const alias of ["latest_return_pct", "sharpe_1y", "calmar_1y"] as const) {
      assert.match(orderSqlForProjectedAlias(alias, "ASC"), /NULLS LAST$/)
      assert.match(orderSqlForProjectedAlias(alias, "DESC"), /NULLS LAST$/)
    }
  })
})

describe("signed metric text vs numeric ordering (bug regression)", () => {
  it("text sort of signed fractions does not match numeric order; ::numeric does", () => {
    const values = ["-0.0368", "-0.0114", "0.0161"]
    const textAsc = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const numericAsc = [...values].sort((a, b) => parseFloat(a) - parseFloat(b))
    assert.deepEqual(textAsc, ["-0.0114", "-0.0368", "0.0161"])
    assert.deepEqual(numericAsc, ["-0.0368", "-0.0114", "0.0161"])
    assert.notDeepEqual(textAsc, numericAsc)
  })

  it("text sort of signed Sharpe/Calmar-like values does not match numeric order", () => {
    // Screenshot-style values: 7.01, -6.67, 6.65, -5.13
    const values = ["7.01", "-6.67", "6.65", "-5.13"]
    const textAsc = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const numericAsc = [...values].sort((a, b) => parseFloat(a) - parseFloat(b))
    // Lexicographic puts all "-" before digits, but among negatives order is wrong
    // and multi-digit positives also diverge from numeric magnitude in general.
    assert.deepEqual(numericAsc, ["-6.67", "-5.13", "6.65", "7.01"])
    assert.notDeepEqual(textAsc, numericAsc)
    assert.equal(isSignedNumericOrderAlias("sharpe_1y"), true)
    assert.equal(isSignedNumericOrderAlias("calmar_1y"), true)
  })
})
