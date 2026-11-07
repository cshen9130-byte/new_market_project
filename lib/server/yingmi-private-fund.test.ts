/**
 *   npx tsx --test lib/server/yingmi-private-fund.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  compareYingmiRows,
  decideYingmiRun,
  emptyProgress,
  formatNav,
  formatReturn,
  isYingmiQuotaMessage,
  nextYingmiSearch,
  shortManager,
  shortStrategy,
  strategyKey,
  yingmiNote,
  type YingmiNodeProgress,
  type YingmiProduct,
  type YingmiStrategyRef,
} from "@/lib/ma/yingmi-private-fund"
import { parseToolBody } from "@/lib/server/yingmi-mcp"

const stock: YingmiStrategyRef = { level: 1, name: "股票策略" }
const neutral: YingmiStrategyRef = { level: 3, name: "中性-复合", level1Name: "相对价值策略", level2Name: "股票市场中性" }

describe("yingmi display", () => {
  it("matches the 波克 sample row", () => {
    assert.equal(shortStrategy("宏观策略", ["宏观策略", "其他"]), "宏观")
    assert.equal(shortStrategy("多策略", ["多策略"]), "多策略")
    assert.equal(shortStrategy("其他策略", ["其他策略", "其他"]), "其他策略")
    assert.equal(shortManager("上海波克私募基金管理合伙企业（有限合伙）"), "上海波克私募")
    assert.equal(formatNav(0.99), "0.9900")
    assert.equal(formatReturn(null), "—")
    assert.equal(yingmiNote("产品成立未满半年，暂不展示业绩"), "成立未满半年")
  })
})

describe("yingmi column sort", () => {
  const label = (row: YingmiProduct) => row.strategyLevel1.replace(/策略$/, "")
  const older: YingmiProduct = {
    fundCode: "a",
    fundName: "甲产品",
    companyName: "甲私募",
    strategyLevel1: "股票策略",
    strategyLevel2: null,
    strategyLevel3: null,
    setupDate: "2020-01-01",
    navDate: "2026-11-04",
    navUnit: 1.1,
    return1y: 0.02,
    maxDrawdown1y: -0.2,
    performanceHideReason: null,
    note: "",
  }
  const newer: YingmiProduct = {
    ...older,
    fundCode: "b",
    fundName: "乙产品",
    setupDate: "2026-09-24",
    navUnit: 0.99,
    return1y: null,
    maxDrawdown1y: null,
    note: "成立未满半年",
  }

  it("puts the higher one-year return first and keeps a missing return last", () => {
    const rows = [newer, older].sort((a, b) => compareYingmiRows(a, b, "return1y", "desc", label))
    assert.deepEqual(rows.map((row) => row.fundName), ["甲产品", "乙产品"])
  })

  it("sorts setup date descending with the newest fund first", () => {
    const rows = [older, newer].sort((a, b) => compareYingmiRows(a, b, "setup", "desc", label))
    assert.deepEqual(rows.map((row) => row.fundName), ["乙产品", "甲产品"])
  })
})

describe("yingmi weekly resume", () => {
  it("starts on Sunday and continues Monday after a quota stop", () => {
    const sunday = decideYingmiRun({
      today: "2026-11-08",
      weekday: 0,
      status: "idle",
      runStartedOn: null,
      finishedOn: null,
      callsDay: null,
      force: false,
    })
    assert.equal(sunday.action, "fresh")

    const sameDay = decideYingmiRun({
      today: "2026-11-08",
      weekday: 0,
      status: "paused_quota",
      runStartedOn: "2026-11-08",
      finishedOn: null,
      callsDay: "2026-11-08",
      force: false,
    })
    assert.equal(sameDay.action, "skip")

    const monday = decideYingmiRun({
      today: "2026-11-09",
      weekday: 1,
      status: "paused_quota",
      runStartedOn: "2026-11-08",
      finishedOn: null,
      callsDay: "2026-11-08",
      force: false,
    })
    assert.equal(monday.action, "continue")

    const done = decideYingmiRun({
      today: "2026-11-09",
      weekday: 1,
      status: "complete",
      runStartedOn: "2026-11-08",
      finishedOn: "2026-11-08",
      callsDay: "2026-11-08",
      force: false,
    })
    assert.equal(done.action, "skip")

    const wednesday = decideYingmiRun({
      today: "2026-11-11",
      weekday: 3,
      status: "paused_quota",
      runStartedOn: "2026-11-08",
      finishedOn: null,
      callsDay: "2026-11-09",
      force: false,
    })
    assert.equal(wednesday.action, "skip")
  })

  it("searches unfinished children before slicing the parent again", () => {
    const child: YingmiStrategyRef = { level: 2, name: "主观多头", level1Name: "股票策略" }
    const progress: Record<string, YingmiNodeProgress> = {
      [strategyKey(stock)]: {
        ...emptyProgress(),
        total: 146,
        collected: 20,
        truncated: true,
        unfilteredDone: true,
      },
      [strategyKey(child)]: emptyProgress(),
    }
    const next = nextYingmiSearch([stock, child], progress)
    assert.equal(next?.strategy.name, "主观多头")
    assert.equal(next?.metrics, undefined)
  })

  it("uses a return slice only after the unfiltered page is stored", () => {
    const progress: Record<string, YingmiNodeProgress> = {
      [strategyKey(neutral)]: {
        ...emptyProgress(),
        total: 27,
        collected: 20,
        truncated: true,
        unfilteredDone: true,
      },
    }
    const next = nextYingmiSearch([neutral], progress)
    assert.equal(next?.metrics?.[0]?.timeRange, "si")
    assert.equal(next?.metrics?.[0]?.op, "gte")
  })
})

describe("yingmi mcp payload", () => {
  it("treats the gateway limit as a stop, separate from a successful tool body", () => {
    assert.equal(isYingmiQuotaMessage('{"error":{"message":"今日请求次数已达上限，请明天再试"}}'), true)
    const body = parseToolBody(JSON.stringify({
      result: { content: [{ text: JSON.stringify({ data: { totalMatched: 2, items: [] } }) }] },
    }))
    assert.equal((body as { data: { totalMatched: number } }).data.totalMatched, 2)
  })
})
