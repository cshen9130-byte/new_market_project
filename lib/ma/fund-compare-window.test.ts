/**
 *   npx tsx --test lib/ma/fund-compare-window.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  alignReturnCurves,
  clipBenchmarkReturns,
  resolveCompareWindow,
} from "@/lib/ma/fund-compare-window"

describe("基金对比 window", () => {
  it("uses the newest nav date and one year back by default", () => {
    const window = resolveCompareWindow({
      latestDates: ["2026-11-01", "2026-11-13"],
      inceptionDates: ["2020-01-01"],
    })
    assert.equal(window?.period, "近一年")
    assert.equal(window?.end_date, "2026-11-13")
    assert.equal(window?.start_date, "2025-11-13")
  })

  it("keeps an explicit range", () => {
    const window = resolveCompareWindow({
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      latestDates: ["2026-11-13"],
      inceptionDates: [],
    })
    assert.equal(window?.period, "自定义")
    assert.equal(window?.start_date, "2026-01-01")
    assert.equal(window?.end_date, "2026-06-30")
  })

  it("aligns curves by subtracting the common start percent", () => {
    const aligned = alignReturnCurves([
      { key: "a", points: [{ d: "2026-01-01", v: 0 }, { d: "2026-02-01", v: 10 }, { d: "2026-03-01", v: 12 }] },
      { key: "b", points: [{ d: "2026-02-01", v: 0 }, { d: "2026-03-01", v: 4 }] },
    ], true)
    assert.equal(aligned[0]?.points[0]?.d, "2026-02-01")
    assert.equal(aligned[0]?.points[0]?.v, 0)
    assert.equal(aligned[0]?.points[1]?.v, 2)
    assert.equal(aligned[1]?.points[1]?.v, 4)
  })

  it("rebases a benchmark from the aligned start", () => {
    const points = clipBenchmarkReturns([
      { d: "2026-01-01", v: 100 },
      { d: "2026-02-01", v: 110 },
      { d: "2026-03-01", v: 121 },
    ], "2026-02-01")
    assert.equal(points[0]?.v, 0)
    assert.equal(points[1]?.v, 10)
  })
})
