/**
 *   npx tsx --test lib/ma/quant-vs-subjective-payload.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import {
  compactQuantVsSubjectivePayload,
  expandQuantVsSubjectivePayload,
  projectQuantVsSubjectiveLight,
} from "./quant-vs-subjective-payload"

const sample = {
  ok: true,
  date: "2026-11-12",
  groups: { quant: { nAccounts: 8 } },
  signals: [{ key: "AU" }],
  flows: { AU: { trade: 1 } },
  sectorTs: [
    { date: "2026-11-11", sector: "贵金属", quantNetPct: 10.1, subjNetPct: -2.2, quantEquityPct: 8, subjEquityPct: 3 },
    { date: "2026-11-12", sector: "贵金属", quantNetPct: 11, subjNetPct: -1, quantEquityPct: 9, subjEquityPct: 2 },
  ],
  productTs: [
    { date: "2026-11-11", product: "AU", quantNetPct: 1.5, subjNetPct: 0.5, quantEquityPct: 2, subjEquityPct: 1 },
    { date: "2026-11-12", product: "AU", quantNetPct: 1.6, subjNetPct: 0.4, quantEquityPct: 2.1, subjEquityPct: 0.9 },
    { date: "2026-11-12", product: "AG", quantNetPct: 0.2, subjNetPct: 0.1, quantEquityPct: 0.3, subjEquityPct: 0.2 },
  ],
  holdingTs: { dates: ["2026-11-12"], products: [{ code: "AU" }] },
}

test("compact/expand round-trips productTs and sectorTs", () => {
  const compact = compactQuantVsSubjectivePayload(sample)
  assert.notEqual(JSON.stringify(compact.productTs), JSON.stringify(sample.productTs))
  assert.equal((compact.productTs as { v: number }).v, 1)
  const back = expandQuantVsSubjectivePayload(compact)
  assert.deepEqual(back.productTs, sample.productTs)
  assert.deepEqual(back.sectorTs, sample.sectorTs)
  assert.deepEqual(back.holdingTs, sample.holdingTs)
  assert.deepEqual(back.signals, sample.signals)
})

test("expand is idempotent on legacy expanded cache files", () => {
  const again = expandQuantVsSubjectivePayload(sample)
  assert.deepEqual(again.productTs, sample.productTs)
  assert.deepEqual(again.sectorTs, sample.sectorTs)
})

test("compact is idempotent", () => {
  const once = compactQuantVsSubjectivePayload(sample)
  const twice = compactQuantVsSubjectivePayload(once)
  assert.deepEqual(twice, once)
})

test("project light drops timeseries but keeps first-paint fields", () => {
  const light = projectQuantVsSubjectiveLight(sample) as Record<string, unknown>
  assert.equal(light.light, true)
  assert.equal(light.holdingTs, undefined)
  assert.equal(light.productTs, undefined)
  assert.equal(light.sectorTs, undefined)
  assert.ok(light.signals)
  assert.ok(light.groups)
  assert.ok(light.flows)
})
