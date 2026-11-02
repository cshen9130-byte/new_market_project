/**
 *   npx tsx --test lib/client/linked-crosshair.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { crosshairIndex } from "./linked-crosshair"

function unix(y: number, m: number, d: number, h = 0, min = 0) {
  return Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000)
}

describe("crosshairIndex", () => {
  const days = [unix(2026, 5, 8), unix(2026, 5, 11), unix(2026, 5, 12)]

  it("matches a daily hover to the same date even when the bar is stamped at the close", () => {
    assert.equal(crosshairIndex(days, unix(2026, 5, 11, 15, 0), "1d"), 1)
  })

  it("stays off the chart when the hovered date is not in the window", () => {
    assert.equal(crosshairIndex(days, unix(2019, 12, 23), "1d"), -1)
  })
})
