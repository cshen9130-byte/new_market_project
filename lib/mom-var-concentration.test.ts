import assert from "node:assert/strict"
import test from "node:test"
import { varConcentrationShares } from "./mom-var-concentration"

test("identity correlation makes a variety's share its squared risk weight", () => {
  const shares = varConcentrationShares(
    [
      { prod: "MA", mv: 2, sigma: 1 },
      { prod: "LH", mv: 1, sigma: 1 },
    ],
    [
      [1, 0],
      [0, 1],
    ],
  )
  assert.equal(shares.products[0].name, "MA")
  assert.ok(Math.abs(shares.products[0].pct - 80) < 0.001)
  assert.ok(Math.abs(shares.products[1].pct - 20) < 0.001)
  const sectorTotal = shares.sectors.reduce((sum, item) => sum + item.pct, 0)
  assert.ok(Math.abs(sectorTotal - 100) < 0.001)
})
