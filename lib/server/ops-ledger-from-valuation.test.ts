/**
 *   npx tsx --test lib/server/ops-ledger-from-valuation.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { collectValuationLedgerDeltas } from "./ops-ledger-from-valuation"

describe("collectValuationLedgerDeltas", () => {
  it("emits 申购 on first shares and 赎回 when parent dates continue at qty 0", () => {
    const deltas = collectValuationLedgerDeltas({
      parentCode: "SAVW72",
      parentName: "金舆基石一号",
      parentKey: "AVW72",
      underlyingCode: "SXN324",
      points: [
        {
          date: "2026-07-09",
          qty: 3_194_122.81,
          mv: 4_015_651.2,
          price: 1.2572,
          cost: 4_000_000,
          undName: "顽岩量化对冲专享3号",
        },
        {
          date: "2026-07-17",
          qty: 3_194_122.81,
          mv: 3_872_235.08,
          price: 1.2123,
          cost: 4_000_000,
          undName: "顽岩量化对冲专享3号",
        },
      ],
      parentDates: ["2026-07-08", "2026-07-09", "2026-07-17", "2026-07-20"],
    })
    assert.equal(deltas.length, 2)
    assert.equal(deltas[0].deltaQty > 0, true)
    assert.equal(deltas[0].valuationDate, "2026-07-09")
    assert.equal(deltas[0].applyDate, "2026-07-08")
    assert.equal(deltas[1].deltaQty < 0, true)
    assert.equal(deltas[1].valuationDate, "2026-07-20")
    assert.equal(deltas[1].applyDate, "2026-07-17")
    assert.equal(deltas[1].qty, 0)
  })

  it("does not invent a 赎回 without later parent 估值日", () => {
    const deltas = collectValuationLedgerDeltas({
      parentCode: "SAVW72",
      parentName: "金舆基石一号",
      parentKey: "AVW72",
      underlyingCode: "SXN324",
      points: [
        {
          date: "2026-07-09",
          qty: 3_194_122.81,
          mv: 4_015_651.2,
          price: 1.2572,
          cost: 4_000_000,
          undName: "顽岩量化对冲专享3号",
        },
      ],
    })
    assert.equal(deltas.length, 1)
    assert.equal(deltas[0].deltaQty > 0, true)
  })
})
