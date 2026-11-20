import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { cropMcrHistory, normalizeMcrPayload } from "./var-mcr-payload"

describe("cropMcrHistory", () => {
  it("does not throw when the account-risk catch-all returns ok without a series", () => {
    const stub = {
      ok: true,
      data: [],
      rows: [],
      points: [],
      notEnoughData: true,
      notYetRun: true,
    }
    const view = cropMcrHistory(stub as never)
    assert.deepEqual(view.dates, [])
    assert.deepEqual(view.productData, {})
    assert.deepEqual(view.sectorData, {})
    assert.equal(Object.keys(view.productData).length, 0)
  })

  it("keeps a mature series and drops the build-up window", () => {
    const view = cropMcrHistory({
      ok: true,
      dates: ["2025-07-01", "2025-08-06", "2025-08-07"],
      productData: { AU: [1, 2, 3] },
      sectorData: { 贵金属: [4, 5, 6] },
      maxProductShare: [1, 2, 3],
      maxSectorShare: [4, 5, 6],
      distanceProduct: [9, 8, 7],
      distanceSector: [6, 5, 4],
    })
    assert.deepEqual(view.dates, ["2025-08-06", "2025-08-07"])
    assert.deepEqual(view.productData.AU, [2, 3])
    assert.deepEqual(view.sectorData.贵金属, [5, 6])
    assert.deepEqual(view.distanceProduct, [8, 7])
  })

  it("leaves a series that already starts on the history date unchanged", () => {
    const view = normalizeMcrPayload({
      ok: true,
      dates: ["2025-08-06", "2025-08-07"],
      productData: { RB: [10, 11] },
      sectorData: { 黑色: [1, 2] },
      maxProductShare: [10, 11],
      maxSectorShare: [1, 2],
      distanceProduct: [20, 19],
      distanceSector: [49, 48],
    })
    const cropped = cropMcrHistory(view)
    assert.deepEqual(cropped.dates, view.dates)
    assert.deepEqual(cropped.productData.RB, [10, 11])
  })
})
