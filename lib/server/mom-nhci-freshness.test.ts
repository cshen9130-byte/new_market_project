/**
 *   npx tsx --test lib/server/mom-nhci-freshness.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { buildNhciLagMeta, type MomNhciAsOf } from "./mom-nhci-freshness"

function asOf(partial: Partial<MomNhciAsOf>): MomNhciAsOf {
  return {
    positionAsOf: null,
    dailyReportsAsOf: null,
    positionDetailsAsOf: null,
    capitalFlowAsOf: null,
    nhciAsOf: null,
    nanhuaNhciAsOf: null,
    rawNhciAsOf: null,
    ...partial,
  }
}

test("calendar today past the shared session is not an NHCI lag", () => {
  const meta = buildNhciLagMeta(
    asOf({
      positionAsOf: "2026-11-06",
      dailyReportsAsOf: "2026-11-06",
      positionDetailsAsOf: "2026-11-06",
      nhciAsOf: "2026-11-06",
      nanhuaNhciAsOf: "2026-11-06",
    }),
    "2026-11-09",
  )
  assert.equal(meta.lagging, false)
  assert.equal(meta.lagReason, null)
})

test("NHCI behind the latest position day is a lag", () => {
  const meta = buildNhciLagMeta(
    asOf({
      positionAsOf: "2026-11-06",
      nhciAsOf: "2026-11-05",
      nanhuaNhciAsOf: "2026-11-05",
    }),
    "2026-11-06",
  )
  assert.equal(meta.lagging, true)
  assert.match(meta.lagReason ?? "", /lags position/)
})

test("missing NHCI while positions exist is a lag", () => {
  const meta = buildNhciLagMeta(asOf({ positionAsOf: "2026-11-06" }), "2026-11-09")
  assert.equal(meta.lagging, true)
})
