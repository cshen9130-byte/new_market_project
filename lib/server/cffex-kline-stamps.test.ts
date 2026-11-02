import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CtpCandle } from "@/lib/client/ctp-market"
import { rewindFutureMinuteStamps } from "@/lib/server/cffex-kline"

function bar(time: number): CtpCandle {
  return { time, open: 1, high: 1, low: 1, close: 1, volume: 1 }
}

function wall(y: number, m: number, d: number, h: number, min: number) {
  return Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000)
}

describe("rewindFutureMinuteStamps", () => {
  it("moves a dateless session stamped on tomorrow back to the previous trade day", () => {
    const now = new Date("2026-11-02T16:09:00Z")
    const out = rewindFutureMinuteStamps([
      bar(wall(2026, 11, 2, 9, 30)),
      bar(wall(2026, 11, 3, 9, 31)),
      bar(wall(2026, 11, 3, 14, 59)),
    ], now)
    assert.deepEqual(out.map((candle) => candle.time), [
      wall(2026, 11, 2, 9, 30),
      wall(2026, 11, 2, 9, 31),
      wall(2026, 11, 2, 14, 59),
    ])
  })

  it("leaves a session that has already printed", () => {
    const now = new Date("2026-11-02T07:30:00Z")
    const stamped = [bar(wall(2026, 11, 2, 9, 31)), bar(wall(2026, 11, 2, 14, 59))]
    const out = rewindFutureMinuteStamps(stamped, now)
    assert.equal(out, stamped)
  })

  it("steps back over the weekend", () => {
    const now = new Date("2026-11-01T16:09:00Z")
    const out = rewindFutureMinuteStamps([bar(wall(2026, 11, 2, 14, 59))], now)
    assert.equal(out[0]?.time, wall(2026, 10, 30, 14, 59))
  })
})
