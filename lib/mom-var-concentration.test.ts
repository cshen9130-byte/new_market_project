import assert from "node:assert/strict"
import test from "node:test"
import { momVarConcentrationMessage, varConcentrationShares } from "./mom-var-concentration"

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

test("the bell fires only when a variety is above its limit or a sector is above its limit", () => {
  const quiet = momVarConcentrationMessage({
    date: "2026-11-06",
    products: [{ name: "MA", pct: 19.9 }],
    sectors: [{ name: "能源化工", pct: 40.8 }],
    productPct: 30,
    sectorPct: 50,
  })
  assert.equal(quiet, null)
  const loud = momVarConcentrationMessage({
    date: "2026-11-06",
    products: [{ name: "MA", pct: 32.5 }],
    sectors: [{ name: "能源化工", pct: 55 }],
    productPct: 30,
    sectorPct: 50,
  })
  assert.match(loud?.body ?? "", /MA（甲醇）/)
  assert.match(loud?.body ?? "", /32.5%/)
  assert.match(loud?.body ?? "", /能源化工/)
  assert.match(loud?.href ?? "", /risk-report\?tab=intraday#section-intraday-sandbox/)
})
