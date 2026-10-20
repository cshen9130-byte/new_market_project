import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { classifyNavFrequency, classifyNavGaps, parseNavFrequencyFilter } from "./nav-frequency"

describe("nav frequency from open-day gaps", () => {
  it("names a steady cadence", () => {
    assert.equal(classifyNavGaps([]), "无净值")
    assert.equal(classifyNavGaps([1, 1, 1, 1, 1, 1]), "日频")
    assert.equal(classifyNavGaps([5, 5, 5, 5, 5, 5]), "周频")
    assert.equal(classifyNavGaps([10, 10, 10, 10, 10]), "双周")
    assert.equal(classifyNavGaps([20, 21, 22, 20, 19, 21]), "月频")
    assert.equal(classifyNavGaps([60, 55, 62, 58, 60, 59]), "季频")
    assert.equal(classifyNavGaps([180, 200, 190, 210]), "其他")
  })

  it("keeps a weekly fund weekly when one holiday stretch is longer", () => {
    assert.equal(classifyNavGaps([5, 5, 5, 5, 5, 15]), "周频")
  })

  it("calls a series mixed when two cadences each take a real share", () => {
    assert.equal(classifyNavGaps([1, 1, 1, 5, 5, 5]), "混合")
    assert.equal(classifyNavGaps([5, 5, 5, 20, 21, 22]), "混合")
  })

  it("does not call one or two points mixed", () => {
    assert.equal(classifyNavGaps([1]), "日频")
    assert.equal(classifyNavGaps([7]), "周频")
    assert.equal(classifyNavGaps([1, 20]), "日频")
  })
})

describe("nav frequency from dates", () => {
  it("treats a Friday-to-Friday series as weekly", () => {
    const fridays = [
      "2024-01-05",
      "2024-01-12",
      "2024-01-19",
      "2024-01-26",
      "2024-02-02",
      "2024-02-09",
    ]
    assert.equal(classifyNavFrequency(fridays), "周频")
  })

  it("treats consecutive sessions as daily, including a weekend", () => {
    const days = ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12", "2024-01-15", "2024-01-16"]
    assert.equal(classifyNavFrequency(days), "日频")
  })

  it("uses the recent window when an old cadence differs", () => {
    const monthly = ["2020-01-31", "2020-02-28", "2020-03-31", "2020-04-30", "2020-05-29", "2020-06-30"]
    const weekly = [
      "2024-06-07", "2024-06-14", "2024-06-21", "2024-06-28",
      "2024-07-05", "2024-07-12", "2024-07-19", "2024-07-26",
      "2024-08-02", "2024-08-09", "2024-08-16", "2024-08-23",
      "2024-08-30", "2024-09-06", "2024-09-13", "2024-09-20",
      "2024-09-27", "2024-10-11", "2024-10-18", "2024-10-25",
      "2024-11-01", "2024-11-08", "2024-11-15", "2024-11-22",
      "2024-11-29",
    ]
    assert.equal(classifyNavFrequency([...monthly, ...weekly]), "周频")
  })

  it("returns 无净值 without two dates", () => {
    assert.equal(classifyNavFrequency([]), "无净值")
    assert.equal(classifyNavFrequency(["2024-01-05"]), "无净值")
  })
})

describe("nav frequency filter parsing", () => {
  it("keeps a known label and drops anything else", () => {
    assert.equal(parseNavFrequencyFilter("周频"), "周频")
    assert.equal(parseNavFrequencyFilter("混合"), "混合")
    assert.equal(parseNavFrequencyFilter("all"), "all")
    assert.equal(parseNavFrequencyFilter(""), "all")
    assert.equal(parseNavFrequencyFilter("每天"), "all")
  })
})
