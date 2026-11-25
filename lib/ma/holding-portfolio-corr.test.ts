import assert from "node:assert/strict"
import test from "node:test"
import { holdingPortfolioCorrelations } from "./holding-portfolio-corr"

test("a one-name book is perfectly correlated with itself", () => {
  assert.deepEqual(holdingPortfolioCorrelations([{ mv: 100, sigma: 0.02 }], [[1]]), [1])
  assert.deepEqual(holdingPortfolioCorrelations([{ mv: -100, sigma: 0.02 }], [[1]]), [1])
})

test("two equal uncorrelated longs each explain half the variance", () => {
  const corrs = holdingPortfolioCorrelations(
    [
      { mv: 1, sigma: 1 },
      { mv: 1, sigma: 1 },
    ],
    [
      [1, 0],
      [0, 1],
    ],
  )
  assert.ok(Math.abs(corrs[0] - Math.SQRT1_2) < 1e-12)
  assert.ok(Math.abs(corrs[1] - Math.SQRT1_2) < 1e-12)
})

test("a smaller short against a perfectly correlated long is negatively correlated", () => {
  const corrs = holdingPortfolioCorrelations(
    [
      { mv: 200, sigma: 1 },
      { mv: -100, sigma: 1 },
    ],
    [
      [1, 1],
      [1, 1],
    ],
  )
  assert.ok(Math.abs(corrs[0] - 1) < 1e-12)
  assert.ok(Math.abs(corrs[1] - -1) < 1e-12)
})

test("a fully hedged book has no portfolio variance", () => {
  const corrs = holdingPortfolioCorrelations(
    [
      { mv: 100, sigma: 1 },
      { mv: -100, sigma: 1 },
    ],
    [
      [1, 1],
      [1, 1],
    ],
  )
  assert.deepEqual(corrs, [0, 0])
})
