import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  annotateAction,
  attachBookState,
  classifyBookAction,
  driverLabelFor,
  episodeWindowIndices,
  firstProductText,
  formatMdDate,
  formatSharePct,
  formatWan,
  buildRegimeStatusTable,
  type DailyEventInput,
} from "./var-mcr-event-table"

const baseAction = {
  prodSoft: false, prodHard: false, secSoft: false, secHard: false,
  persistHard: false, persistSoft: false, streakProdSoft: 0, streakSecSoft: 0,
  posUp: false, varBudget: false, freeze: false, nSigns: 0,
}

describe("classifyBookAction (report-style 正式动作)", () => {
  it("returns 硬性减仓 when persist_hard + pos_up and not frozen (06-26 / 10-16)", () => {
    assert.equal(classifyBookAction({
      ...baseAction, prodSoft: true, prodHard: true, persistHard: true, posUp: true, nSigns: 7,
    }), "硬性减仓")
  })

  it("returns 硬阈值冻结 when the same conditions hold on a market-driven day", () => {
    assert.equal(classifyBookAction({
      ...baseAction, prodSoft: true, prodHard: true, persistHard: true, posUp: true, freeze: true,
    }), "硬阈值冻结")
  })

  it("returns 预警 on first hard-line day even without persist (06-23 / 07-06 / 10-14)", () => {
    assert.equal(classifyBookAction({
      ...baseAction, prodSoft: true, prodHard: true, streakProdSoft: 1, nSigns: 4,
    }), "预警")
  })

  it("returns 预警 when persist_hard but pos_up and var_budget are both off (06-25)", () => {
    assert.equal(classifyBookAction({
      ...baseAction, prodSoft: true, prodHard: true, persistHard: true, posUp: false, varBudget: false, nSigns: 5,
    }), "预警")
  })

  it("returns 预警 when var/capital > 2.07% on a first hard day (07-06)", () => {
    assert.equal(classifyBookAction({
      ...baseAction, prodSoft: true, prodHard: true, varBudget: true, posUp: true, nSigns: 6,
    }), "预警")
  })

  it("returns 无 when the book is quiet (07-03)", () => {
    assert.equal(classifyBookAction({ ...baseAction }), "无")
  })

  it("returns 观察 when a residual flag remains below soft (10-28)", () => {
    assert.equal(classifyBookAction({ ...baseAction, nSigns: 1 }), "观察")
  })
})

describe("annotateAction", () => {
  it("annotates 10-15 style 预警（若硬砍则应冻结） when hard + market and one day short of persist", () => {
    assert.equal(
      annotateAction("预警", { prodHard: false, secHard: true, freeze: true, persistHard: false, streakSecHard: 2, jump: true }),
      "预警（若硬砍则应冻结）",
    )
  })

  it("does not annotate a first-day market hard line (06-23)", () => {
    assert.equal(
      annotateAction("预警", { prodHard: true, secHard: false, freeze: true, persistHard: false, streakProdHard: 1 }),
      "预警",
    )
  })

  it("does not annotate once persist_hard already holds (06-29)", () => {
    assert.equal(
      annotateAction("预警", { prodHard: true, secHard: true, freeze: true, persistHard: true, streakProdHard: 5, jump: true }),
      "预警",
    )
  })

  it("does not annotate a plain 预警 on a position-driven hard day", () => {
    assert.equal(annotateAction("预警", { prodHard: true, secHard: false, freeze: false }), "预警")
  })

  it("does not rewrite 硬性减仓", () => {
    assert.equal(annotateAction("硬性减仓", { prodHard: true, secHard: true, freeze: false }), "硬性减仓")
  })
})

describe("driverLabelFor", () => {
  it("labels a market + jump day as 市场（跳价） (10-15)", () => {
    assert.equal(driverLabelFor("sector", { driver: "market", dVar: 4_000, sharePct: 73, prevSharePct: 66.7, jump: true }), "市场（跳价）")
  })

  it("labels a plain market day as 市场 (06-23 / 06-29)", () => {
    assert.equal(driverLabelFor("product", { driver: "market", dVar: -15_000, sharePct: 54.1, prevSharePct: 50 }), "市场")
  })

  it("labels a positive-VaR position day as 持仓", () => {
    assert.equal(driverLabelFor("product", { driver: "position", dVar: 89_000, sharePct: 53.4, prevSharePct: 54.1 }), "持仓")
  })

  it("labels 06-25 as 持仓（VaR下降）", () => {
    assert.equal(driverLabelFor("product", { driver: "position", dVar: -65_000, sharePct: 61.4, prevSharePct: 53.4 }), "持仓（VaR下降）")
  })

  it("labels 07-03 as 持仓（大幅回落）", () => {
    assert.equal(driverLabelFor("product", { driver: "position", dVar: -715_000, sharePct: 2.5, prevSharePct: 64.8 }), "持仓（大幅回落）")
  })

  it("labels 10-19 / 10-28 as 持仓（回落） for the sector", () => {
    assert.equal(driverLabelFor("sector", { driver: "position", dVar: -535_000, sharePct: 37.3, prevSharePct: 79.3 }), "持仓（回落）")
    assert.equal(driverLabelFor("sector", { driver: "position", dVar: -259_000, sharePct: 48.2, prevSharePct: 86.2 }), "持仓（回落）")
  })
})

describe("formatters", () => {
  it("formats ΔVaR in 万 to 1 decimal like the report", () => {
    assert.equal(formatWan(-15_000), "-1.5万")
    assert.equal(formatWan(89_000), "8.9万")
    assert.equal(formatWan(242_000), "24.2万")
    assert.equal(formatWan(-715_000), "-71.5万")
    assert.equal(formatWan(4_000), "0.4万")
    assert.equal(formatWan(998_000), "99.8万")
  })

  it("formats share and short dates", () => {
    assert.equal(formatSharePct(54.1), "54.1%")
    assert.equal(formatSharePct(2.5, true), "2.5%（空头）")
    assert.equal(formatMdDate("2026-06-23"), "06-23")
  })

  it("formats 第一品种 as Chinese name + share", () => {
    assert.equal(firstProductText("MA", 23.3), "甲醇 23.3%")
  })
})

describe("episodeWindowIndices", () => {
  it("keeps a first soft-breach day with at least 8 days of lead-in", () => {
    const shares = [10, 12, 14, 16, 18, 20, 22, 30.3]
    const w = episodeWindowIndices(shares, 30, shares.length - 1)
    assert.equal(w.end, 7)
    assert.equal(w.start, 0)
    assert.ok(w.end - w.start + 1 >= 8)
  })

  it("stitches two pulses 5 trading days apart (10-16 then 10-26)", () => {
    // 10-14..10-16 hard, then 10-19 37%, 10-20..10-23 quiet, 10-26 pulse
    const shares = [66, 73, 79, 37, 30, 28, 29, 29, 76]
    const w = episodeWindowIndices(shares, 50, shares.length - 1, { gap: 5, leadIn: 2, minDays: 8, maxDays: 18 })
    assert.ok(w.start <= 0, `expected to include first pulse, start=${w.start}`)
    assert.equal(w.end, shares.length - 1)
  })

  it("still shows a just-ended episode when as-of is below soft (10-28 style)", () => {
    const shares = [66, 73, 79, 37, 30, 28, 29, 29, 76, 86, 48]
    const w = episodeWindowIndices(shares, 50, shares.length - 1, { gap: 5, leadIn: 2 })
    assert.ok(w.start <= 2, `should reach the earlier pulse, start=${w.start}`)
    assert.equal(w.end, shares.length - 1)
  })

  it("caps the window at 18 days", () => {
    const shares = Array.from({ length: 30 }, (_, i) => (i >= 2 ? 55 : 20))
    const w = episodeWindowIndices(shares, 50, shares.length - 1)
    assert.equal(w.end - w.start + 1, 18)
  })
})

describe("buildRegimeStatusTable", () => {
  it("reproduces the 11-11 market-state readings", () => {
    const mature = Array.from({ length: 100 }, (_, i) => ({
      medSigma: i === 0 ? 0.0146 : i >= 82 ? [0.015, 0.0152, 0.0154, 0.0156, 0.0158, 0.016, 0.0161, 0.01615, 0.01618, 0.01619, 0.0162, 0.0162, 0.0162, 0.0162, 0.017, 0.018, 0.019, 0.02][i - 82] : 0.01,
      dMedSigma: i === 0 ? 0.0001 : 0.001,
      meanCorr: i <= 5 ? 0.155 : 0.3,
      breadth: i === 0 ? 0.841 : i >= 92 ? [0.85, 0.855, 0.861, 0.861, 0.9, 0.92, 0.95, 0.97][i - 92] : 0.5,
      gapMed: i === 0 ? 0.0078 : i >= 94 ? [0.008, 0.008, 0.009, 0.01, 0.011, 0.012][i - 94] : 0.005,
      jumpMed: i === 0 ? 0.0104 : i >= 87 ? [0.011, 0.011, 0.011, 0.011, 0.011, 0.011, 0.011, 0.0126, 0.0126, 0.02, 0.021, 0.022, 0.023][i - 87] : 0.005,
      maxAbsR: i === 0 ? 0.046 : i >= 98 ? 0.279 : 0.02,
      nLiqGap: 0,
      nSpike: 0,
    }))
    const table = buildRegimeStatusTable({ date: "2026-11-11", metrics: mature[0], mature })
    const by = Object.fromEntries(table.rows.map((row) => [row.key, row]))
    assert.equal(table.dateLabel, "11-11")
    assert.equal(by.vol_spike.trigger, "no")
    assert.equal(by.vol_spike.triggerText, "否（1.46%，约 82% 分位；增量未达 95%）")
    assert.match(by.vol_spike.rule, /1\.62%/)
    assert.equal(by.corr_surge.trigger, "no")
    assert.equal(by.corr_surge.triggerText, "否（0.155，反而是低相关）")
    assert.match(by.corr_surge.rule, /^持仓品种 252 日平均两两相关/)
    assert.match(by.corr_collapse.rule, /^持仓品种平均两两相关/)
    assert.equal(by.corr_collapse.trigger, "yes")
    assert.equal(by.corr_collapse.triggerText, "是（临界触发）")
    assert.match(by.corr_collapse.rule, /0\.155/)
    assert.equal(by.regime_breadth.trigger, "near")
    assert.equal(by.regime_breadth.triggerText, "接近（84.1%，约 92% 分位），未达阈值")
    assert.match(by.regime_breadth.rule, /86\.1%/)
    assert.equal(by.gap.trigger, "near")
    assert.equal(by.gap.triggerText, "接近（0.78%，约 94% 分位），未达阈值")
    assert.match(by.gap.rule, /0\.80%/)
    assert.equal(by.jump.trigger, "no")
    assert.equal(by.jump.triggerText, "否（1.04%，约 87% 分位）")
    assert.match(by.jump.rule, /1\.26%/)
    assert.equal(by.idiosyncratic.trigger, "no")
    assert.equal(by.idiosyncratic.triggerText, "否（最大约 4.6%）")
    assert.match(by.idiosyncratic.rule, /27\.9%/)
    assert.equal(by.liq.triggerText, "否（0 个）")
    assert.equal(by.roll.triggerText, "否（0 个）")
  })

  it("marks a one-short liquidity count as 接近 and a three-name gap as 是", () => {
    const quiet = {
      medSigma: 0.01, dMedSigma: 0, meanCorr: 0.2, breadth: 0.5,
      gapMed: 0.002, jumpMed: 0.004, maxAbsR: 0.02, nLiqGap: 0, nSpike: 0,
    }
    const day = { ...quiet, nLiqGap: 2, nSpike: 3 }
    const table = buildRegimeStatusTable({
      date: "2026-11-13",
      metrics: day,
      mature: [day, quiet],
    })
    const by = Object.fromEntries(table.rows.map((row) => [row.key, row]))
    assert.equal(by.liq.triggerText, "接近（2 个），未达阈值")
    assert.equal(by.roll.triggerText, "是（3 个）")
    assert.equal(table.dateLabel, "11-13")
  })
})

describe("attachBookState replays June 2026 鸡蛋 episode actions", () => {
  const june: DailyEventInput[] = [
    { date: "2026-06-20", maxProd: "JD", maxProdShare: 40, maxSec: "农产品", maxSecShare: 45, driver: "position", dVar: 10_000, attrPos: 10_000, attrMkt: 0, varPct: 1.4, capOk: true, nProd: 30, flags: {} },
    { date: "2026-06-23", maxProd: "JD", maxProdShare: 54.1, maxSec: "农产品", maxSecShare: 57.5, driver: "market", dVar: -15_000, attrPos: -5_000, attrMkt: -10_000, varPct: 1.59, capOk: true, nProd: 30, flags: { gap: true, vol_spike: true } },
    { date: "2026-06-24", maxProd: "JD", maxProdShare: 53.4, maxSec: "农产品", maxSecShare: 54.0, driver: "position", dVar: 89_000, attrPos: 80_000, attrMkt: 9_000, varPct: 1.70, capOk: true, nProd: 30, flags: {} },
    { date: "2026-06-25", maxProd: "JD", maxProdShare: 61.4, maxSec: "农产品", maxSecShare: 62.1, driver: "position", dVar: -65_000, attrPos: -50_000, attrMkt: -15_000, varPct: 1.67, capOk: true, nProd: 30, flags: {} },
    { date: "2026-06-26", maxProd: "JD", maxProdShare: 65.8, maxSec: "农产品", maxSecShare: 66.4, driver: "position", dVar: 242_000, attrPos: 200_000, attrMkt: 42_000, varPct: 2.02, capOk: true, nProd: 30, flags: { vol_spike: true } },
    { date: "2026-06-29", maxProd: "JD", maxProdShare: 64.8, maxSec: "农产品", maxSecShare: 65.1, driver: "market", dVar: -8_000, attrPos: -1_000, attrMkt: -7_000, varPct: 1.99, capOk: true, nProd: 30, flags: { jump: true } },
    { date: "2026-06-30", maxProd: "JD", maxProdShare: 20, maxSec: "农产品", maxSecShare: 25, driver: "position", dVar: -100_000, attrPos: -80_000, attrMkt: -20_000, varPct: 1.0, capOk: true, nProd: 30, flags: {} },
    { date: "2026-07-03", maxProd: "JD", maxProdShare: 2.5, maxSec: "农产品", maxSecShare: 3.7, driver: "position", dVar: -715_000, attrPos: -600_000, attrMkt: -115_000, varPct: 0.68, capOk: true, nProd: 30, flags: {} },
    { date: "2026-07-06", maxProd: "JD", maxProdShare: 53.6, maxSec: "农产品", maxSecShare: 53.6, driver: "position", dVar: 998_000, attrPos: 800_000, attrMkt: 198_000, varPct: 2.20, capOk: true, nProd: 30, flags: {} },
  ]
  const rows = attachBookState(june)

  it("matches official 正式动作 on the published dates", () => {
    const byDate = Object.fromEntries(rows.map((r) => [r.date, r]))
    assert.equal(byDate["2026-06-23"].action, "预警")
    assert.equal(byDate["2026-06-24"].action, "预警")
    assert.equal(byDate["2026-06-25"].action, "预警")
    assert.equal(byDate["2026-06-26"].action, "硬性减仓")
    assert.equal(byDate["2026-06-29"].action, "预警")
    assert.equal(byDate["2026-06-29"].actionDisplay, "预警")
    assert.equal(byDate["2026-07-03"].action, "无")
    assert.equal(byDate["2026-07-06"].action, "预警")
  })
})
