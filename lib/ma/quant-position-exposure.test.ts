/**
 *   npx tsx --test lib/ma/quant-position-exposure.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildPositionExposure,
  fmtBookShare,
  fmtGrossCell,
  fmtWanCell,
  fmtYuanCell,
  isOptionContract,
  shortBookName,
  type ExposureLeg,
} from "./quant-position-exposure"

function leg(partial: Partial<ExposureLeg> & Pick<ExposureLeg, "id" | "label">): ExposureLeg {
  return {
    advisor: null,
    source: "mom",
    brokerLabel: null,
    onBook: true,
    latest: "2026-11-18",
    longBySector: {},
    shortBySector: {},
    pnlBySector: {},
    dailyPnl: null,
    equity: null,
    riskPct: null,
    ...partial,
  }
}

test("long fund names keep the product token", () => {
  assert.equal(shortBookName("上海衡颐资产管理有限公司衡颐鼎燧1号私募证券投资基金"), "衡颐鼎燧")
  assert.equal(shortBookName("魏友鹏"), "魏友鹏")
  assert.equal(shortBookName("余浩"), "余浩")
})

test("book share keeps the net direction and removes account size", () => {
  assert.equal(fmtBookShare(13_530_000, 154_610_000), fmtBookShare(1_353_000, 15_461_000))
  assert.equal(fmtBookShare(13_530_000, 154_610_000), "+8.8%")
  assert.equal(fmtBookShare(-1_010_000, 14_030_000), "-7.2%")
  assert.equal(fmtBookShare(390_000, 154_610_000), "+0.25%")
  assert.equal(fmtBookShare(5_000, 154_610_000), "—")
  assert.equal(fmtBookShare(-81_000, 0), "—")
})

test("wan cells round to 万元 and hide anything under 1 万", () => {
  assert.equal(fmtWanCell(74_000), "+7")
  assert.equal(fmtWanCell(5_000), "—")
  assert.equal(fmtWanCell(-6_090_000), "-609")
  assert.equal(fmtGrossCell(18_910_000), "1,891")
  assert.equal(fmtYuanCell(-99_668), "-99,668")
  assert.equal(fmtYuanCell(null), "—")
  assert.equal(isOptionContract("cu2506C72000"), true)
  assert.equal(isOptionContract("RB2510"), false)
})

test("book snapshot keeps opposite books, drops flat accounts, and writes the three notes", () => {
  const snap = buildPositionExposure({
    date: "2026-11-18",
    accounts: [
      leg({
        id: "356",
        label: "rx356",
        advisor: "刘亮",
        longBySector: { 有色: 3_010_000 },
        pnlBySector: { 有色: -33_720 },
        dailyPnl: -51_100,
      }),
      leg({
        id: "10800677",
        label: "10800677",
        advisor: "JC",
        source: "cfmmc",
        brokerLabel: "正信期货",
        longBySector: { 能源化工: 11_750_000 },
        shortBySector: { 有色: 6_090_000, 农产: 9_530_000 },
        pnlBySector: { 农产: -134_000, 能源化工: -86_000 },
        dailyPnl: -99_668,
        equity: 27_910_000,
        riskPct: 39.8,
      }),
      leg({
        id: "349",
        label: "rx349",
        longBySector: { 有色: 2_000 },
        dailyPnl: 100,
      }),
      leg({
        id: "324",
        label: "rx324",
        onBook: false,
        latest: "2026-11-17",
      }),
    ],
  })

  assert.deepEqual(snap.rows.map((row) => row.label), ["rx356", "10800677"])
  assert.equal(snap.conflicts.length, 1)
  assert.equal(snap.conflicts[0]?.label, "rx356")
  assert.equal(snap.conflicts[0]?.sectorLabel, "有色")
  assert.equal(Math.round((snap.conflicts[0]?.accountNet ?? 0) / 10_000), 301)
  assert.equal(Math.round((snap.conflicts[0]?.bookNet ?? 0) / 10_000), -308)
  assert.equal(snap.total.dailyPnl, -150_768)

  const byTitle = new Map(snap.bullets.map((b) => [b.title, b.text]))
  assert.match(byTitle.get("方向分歧") ?? "", /多 rx356 \+301万 vs 空 10800677 -609万/)
  assert.match(byTitle.get("当日盈亏归因") ?? "", /量化组合 2 户合计 -150,768 元/)
  assert.match(byTitle.get("当日盈亏归因") ?? "", /最大亏损户 10800677（JC，-99,668）主要来自 农产 -13\.4万、能化 -8\.6万/)
  assert.doesNotMatch(byTitle.get("当日盈亏归因") ?? "", /最大盈利户/)
  assert.match(byTitle.get("方向错配") ?? "", /农产（净 -953万）、能化（净 \+1,175万）/)

  assert.ok(snap.footnotes.some((line) => line.includes("已剔除空仓户：rx349")))
  assert.ok(snap.footnotes.some((line) => line.includes("rx324（最新 2026-11-17）")))
  assert.ok(snap.footnotes.some((line) => line.includes("10800677") && line.includes("正信期货") && line.includes("39.8%")))
  assert.ok(snap.footnotes.some((line) => line.includes("持仓浮动变动")))
})

test("opposite exposure under 100 万 stays off the focus list", () => {
  const snap = buildPositionExposure({
    date: "2026-11-18",
    accounts: [
      leg({ id: "1", label: "rx1", longBySector: { 有色: 800_000 }, dailyPnl: 1 }),
      leg({ id: "2", label: "rx2", shortBySector: { 有色: 2_000_000 }, dailyPnl: -1 }),
    ],
  })
  assert.equal(snap.conflicts.length, 0)
  assert.match(snap.bullets.find((b) => b.title === "方向分歧")?.text ?? "", /没有同时出现/)
})
