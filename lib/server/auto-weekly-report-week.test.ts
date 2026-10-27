import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  lastTradingDayOfIsoWeek,
  resolveLatestAvailableDataWeek,
  resolveNextWeeklyReportGap,
} from "@/lib/server/auto-weekly-report-week"

describe("resolveLatestAvailableDataWeek", () => {
  it("uses complete week when Friday NAV exists (2026-10-19..23)", () => {
    const week = resolveLatestAvailableDataWeek("2026-10-23", "2026-10-26")
    assert.ok(week)
    assert.equal(week!.weekStart, "2026-10-19")
    assert.equal(week!.weekEnd, "2026-10-23")
  })

  it("falls back to previous complete week when Fri NAV missing (through Thu)", () => {
    const week = resolveLatestAvailableDataWeek("2026-10-22", "2026-10-26")
    assert.ok(week)
    assert.equal(week!.weekStart, "2026-10-12")
    assert.equal(week!.weekEnd, "2026-10-16")
  })

  it("lastTradingDayOfIsoWeek returns Friday for a normal week", () => {
    assert.equal(lastTradingDayOfIsoWeek("2026-10-19"), "2026-10-23")
  })
})

describe("resolveNextWeeklyReportGap", () => {
  it("after weekend: counts 1 missing Fri when latest NAV is Thu 2026-10-22", () => {
    const gap = resolveNextWeeklyReportGap("2026-10-22", "2026-10-26")
    assert.ok(gap)
    assert.equal(gap!.nextWeekStart, "2026-10-19")
    assert.equal(gap!.nextWeekEnd, "2026-10-23")
    assert.equal(gap!.nextWeekendEnd, "2026-10-25")
    assert.equal(gap!.daysBehind, 1)
  })

  it("after weekend: counts full week when latest NAV ends previous Friday", () => {
    const gap = resolveNextWeeklyReportGap("2026-10-16", "2026-10-26")
    assert.ok(gap)
    assert.equal(gap!.nextWeekStart, "2026-10-19")
    assert.equal(gap!.nextWeekEnd, "2026-10-23")
    assert.equal(gap!.daysBehind, 5)
  })

  it("during next week: latest Fri 10-23 on Mon 10-26 is 已最新 (0), not 缺5日", () => {
    const gap = resolveNextWeeklyReportGap("2026-10-23", "2026-10-26")
    assert.ok(gap)
    assert.equal(gap!.nextWeekStart, "2026-10-26")
    assert.equal(gap!.nextWeekendEnd, "2026-11-01")
    assert.equal(gap!.daysBehind, 0)
  })

  it("before weekend ends: incomplete Fri still shows 0", () => {
    const gap = resolveNextWeeklyReportGap("2026-10-22", "2026-10-24")
    assert.ok(gap)
    assert.equal(gap!.nextWeekStart, "2026-10-19")
    assert.equal(gap!.nextWeekEnd, "2026-10-23")
    assert.equal(gap!.daysBehind, 0)
  })

  it("after next week weekend: latest 10-23 on 2026-11-02 is 缺5日", () => {
    const gap = resolveNextWeeklyReportGap("2026-10-23", "2026-11-02")
    assert.ok(gap)
    assert.equal(gap!.nextWeekStart, "2026-10-26")
    assert.equal(gap!.nextWeekEnd, "2026-10-30")
    assert.equal(gap!.daysBehind, 5)
  })
})
