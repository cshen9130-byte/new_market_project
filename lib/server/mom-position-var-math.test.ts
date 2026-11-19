import assert from "node:assert/strict"
import test from "node:test"
import { assemblePositionVarDay, averagePairCorrelation, averagePairCorrelationByGroup, correlationExposureByGroup, signedCorrelationExposure } from "./mom-position-var-math"

test("identity correlation splits marginal share by squared dollar vol and component VaR sums to the book", () => {
  const day = assemblePositionVarDay({
    date: "2026-11-14",
    products: [
      { prod: "MA", mv: 2, lots: 1, sigma: 1 },
      { prod: "LH", mv: 1, lots: 1, sigma: 1 },
    ],
    corr: [
      [1, 0],
      [0, 1],
    ],
    zScore: 1.6449,
  })
  assert.ok(day)
  assert.equal(day.sector["能源化工"], 80)
  assert.equal(day.sector["生鲜"], 20)
  assert.equal(day.products.reduce((sum, product) => sum + product.componentVar, 0), day.totalVar)
  assert.equal(day.groups.sector.reduce((sum, group) => sum + group.componentVar, 0), day.totalVar)
  const ma = day.products.find((product) => product.code === "MA")
  assert.equal(ma?.name, "甲醇")
  assert.equal(ma?.marginalPct, 80)
})

test("correlation-adjusted exposure equals the direct net only when correlation is 1", () => {
  assert.equal(signedCorrelationExposure([100, -80], [[1, 1], [1, 1]]), 20)
  assert.equal(signedCorrelationExposure([100, -80], [[1, 0.8], [0.8, 1]]), 60)
  assert.equal(signedCorrelationExposure([80, -100], [[1, 0.8], [0.8, 1]]), -60)
  assert.equal(signedCorrelationExposure([100, 80], [[1, 0.8], [0.8, 1]]), 171)
  assert.equal(signedCorrelationExposure([100, -100], [[1, 0.5], [0.5, 1]]), 100)
  assert.equal(signedCorrelationExposure([-50], [[1]]), -50)
})

test("correlation-adjusted exposure is computed inside each sector, not across sectors", () => {
  const grouped = correlationExposureByGroup(
    [
      { prod: "MA", mv: 100 },
      { prod: "L", mv: -80 },
      { prod: "LH", mv: 40 },
    ],
    [
      [1, 0.8, 0],
      [0.8, 1, 0],
      [0, 0, 1],
    ],
  )
  assert.equal(grouped.sector["能源化工"], 60)
  assert.equal(grouped.sector["生鲜"], 40)
  assert.equal(grouped.category["商品"], signedCorrelationExposure([100, -80, 40], [
    [1, 0.8, 0],
    [0.8, 1, 0],
    [0, 0, 1],
  ]))
})

test("average within-sector correlation weights pairs by absolute market value and skips a single name", () => {
  assert.equal(averagePairCorrelation([100, -80], [[1, 0.8], [0.8, 1]]), 0.8)
  assert.equal(averagePairCorrelation([-50], [[1]]), null)
  assert.equal(averagePairCorrelation([2, 2, 1], [
    [1, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
  ]), 0.5)
  const grouped = averagePairCorrelationByGroup(
    [
      { prod: "MA", mv: 100 },
      { prod: "L", mv: -80 },
      { prod: "LH", mv: 40 },
    ],
    [
      [1, 0.8, 0],
      [0.8, 1, 0],
      [0, 0, 1],
    ],
  )
  assert.equal(grouped.sector["能源化工"], 0.8)
  assert.equal(grouped.sector["生鲜"], undefined)
  assert.ok(Math.abs((grouped.category["商品"] ?? NaN) - 8 / 19) < 1e-12)
})

test("a dust contribution below 1 is left out of the marginal-share denominator", () => {
  const day = assemblePositionVarDay({
    date: "2026-11-14",
    products: [
      { prod: "RB", mv: 10, lots: 1, sigma: 1 },
      { prod: "AU", mv: 0.1, lots: 1, sigma: 1 },
    ],
    corr: [
      [1, 0],
      [0, 1],
    ],
  })
  assert.ok(day)
  assert.equal(day.sector["黑色"], 100)
  assert.equal(day.sector["贵金属"], undefined)
})
