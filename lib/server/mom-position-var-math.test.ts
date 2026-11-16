import assert from "node:assert/strict"
import test from "node:test"
import { assemblePositionVarDay } from "./mom-position-var-math"

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
