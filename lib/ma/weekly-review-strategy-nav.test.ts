/**
 *   npx tsx --test lib/ma/weekly-review-strategy-nav.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import {
  STRATEGY_NAV_UNIVERSE_LABEL,
  STRATEGY_NAV_UNIVERSES,
  buildWeeklyReviewStrategyNav,
  parseStrategyNavMode,
  parseStrategyNavUniverse,
  assembleStrategyNavCompare,
  sortStrategyNavCompareSeries,
  strategyNavNote,
} from "./weekly-review-strategy-nav"

test("compounds the weekly average and carries a week another strategy printed", () => {
  const body = buildWeeklyReviewStrategyNav("equity", [
    { bucket: "300指增", week: "2026-01-09", avgRet: 0.01, n: 4, funds: 10 },
    { bucket: "300指增", week: "2026-01-23", avgRet: -0.02, n: 4, funds: 10 },
    { bucket: "1000指增", week: "2026-01-09", avgRet: 0, n: 3, funds: 8 },
    { bucket: "1000指增", week: "2026-01-16", avgRet: 0.05, n: 3, funds: 8 },
    { bucket: "1000指增", week: "2026-01-23", avgRet: 0, n: 3, funds: 8 },
  ])
  assert.deepEqual(body.dates, ["2026-01-09", "2026-01-16", "2026-01-23"])
  const hs300 = body.series.find((row) => row.bucket === "300指增")
  assert.ok(hs300)
  assert.equal(hs300.count, 10)
  assert.deepEqual(hs300.values, [101, 101, 98.98])
  const csi1000 = body.series.find((row) => row.bucket === "1000指增")
  assert.deepEqual(csi1000?.values, [100, 105, 105])
  assert.equal(body.mode, "universe")
  assert.equal(body.universe, "market")
})

test("a strategy that starts later stays empty on earlier weeks", () => {
  const body = buildWeeklyReviewStrategyNav("equity", [
    { bucket: "CTA", week: "2026-02-06", avgRet: 0.01, n: 3, funds: 4 },
    { bucket: "红利指增", week: "2026-02-13", avgRet: 0.02, n: 5, funds: 6 },
  ])
  const dividend = body.series.find((row) => row.bucket === "红利指增")
  assert.deepEqual(dividend?.values, [null, 102])
})

test("a single fund still draws that strategy line", () => {
  const body = buildWeeklyReviewStrategyNav("futures", [
    { bucket: "MOM", week: "2026-03-06", avgRet: 0.01, n: 1, funds: 1 },
  ])
  assert.deepEqual(body.dates, ["2026-03-06"])
  assert.equal(body.series[0]?.bucket, "MOM")
  assert.deepEqual(body.series[0]?.values, [101])
})

test("universe and mode parsers accept the public keys and ignore unknown values", () => {
  assert.equal(parseStrategyNavUniverse(null), "market")
  assert.equal(parseStrategyNavUniverse("tracking"), "tracking")
  assert.equal(parseStrategyNavUniverse("JY"), "tracking")
  assert.equal(parseStrategyNavUniverse("xiaohe"), "xiaohe")
  assert.equal(parseStrategyNavUniverse("ima"), "ima")
  assert.equal(parseStrategyNavUniverse("yt"), "yt")
  assert.equal(parseStrategyNavUniverse("other"), "market")
  assert.equal(parseStrategyNavMode("compare"), "compare")
  assert.equal(parseStrategyNavMode(""), "universe")
})

test("source labels stay on the public names, including YT", () => {
  const text = [
    ...STRATEGY_NAV_UNIVERSES.map((row) => `${row.key}${row.label}`),
    ...Object.values(STRATEGY_NAV_UNIVERSE_LABEL),
    strategyNavNote("universe", "yt"),
    strategyNavNote("compare"),
  ].join("")
  assert.equal(text.includes("已投"), false)
  assert.equal(STRATEGY_NAV_UNIVERSE_LABEL.yt, "YT")
})

test("compare mode keeps source order and a shared week axis", () => {
  const body = buildWeeklyReviewStrategyNav("equity", [
    { bucket: "YT", week: "2026-01-16", avgRet: 0.02, n: 2, funds: 3 },
    { bucket: "市场全部", week: "2026-01-09", avgRet: 0.01, n: 8, funds: 20 },
    { bucket: "市场全部", week: "2026-01-16", avgRet: 0, n: 8, funds: 20 },
    { bucket: "跟踪池", week: "2026-01-16", avgRet: 0.03, n: 4, funds: 6 },
  ], { mode: "compare", strategy: "500增强", weekEnd: "2026-01-16" })
  assert.equal(body.mode, "compare")
  assert.equal(body.strategy, "500增强")
  assert.deepEqual(body.dates, ["2026-01-09", "2026-01-16"])
  assert.deepEqual(body.series.map((row) => row.bucket), ["市场全部", "跟踪池", "YT"])
  const market = body.series[0]
  assert.deepEqual(market?.values, [101, 101])
  const tracking = body.series[1]
  assert.deepEqual(tracking?.values, [null, 103])
  assert.equal(sortStrategyNavCompareSeries(body.series).map((row) => row.bucket).join("/"), "市场全部/跟踪池/YT")
})

test("compare mode can be assembled from precomputed universe snapshots", () => {
  const market = buildWeeklyReviewStrategyNav("equity", [
    { bucket: "500增强", week: "2026-01-09", avgRet: 0.01, n: 8, funds: 20 },
    { bucket: "500增强", week: "2026-01-16", avgRet: 0, n: 8, funds: 20 },
    { bucket: "1000增强", week: "2026-01-16", avgRet: 0.02, n: 5, funds: 9 },
  ], { universe: "market" })
  const tracking = buildWeeklyReviewStrategyNav("equity", [
    { bucket: "500增强", week: "2026-01-16", avgRet: 0.03, n: 4, funds: 6 },
  ], { universe: "tracking" })
  const emptyIma = buildWeeklyReviewStrategyNav("equity", [], { universe: "ima" })
  const body = assembleStrategyNavCompare("equity", "500增强", "2026-01-16", [
    { universe: "market", body: market },
    { universe: "tracking", body: tracking },
    { universe: "ima", body: emptyIma },
  ])
  assert.equal(body.mode, "compare")
  assert.equal(body.strategy, "500增强")
  assert.deepEqual(body.dates, ["2026-01-09", "2026-01-16"])
  assert.deepEqual(body.series.map((row) => row.bucket), ["市场全部", "跟踪池"])
  assert.deepEqual(body.series[0]?.values, [101, 101])
  assert.deepEqual(body.series[1]?.values, [null, 103])
  assert.equal(body.series.some((row) => row.bucket === "ima点睛"), false)
  assert.equal(`${body.note}${body.series.map((row) => row.bucket).join("")}`.includes("已投"), false)
})
