import assert from "node:assert/strict"
import test from "node:test"
import {
  FUTURES_WEEKLY_CATEGORIES,
  QUANT_WEEKLY_CATEGORIES,
  SUBJECTIVE_WEEKLY_CATEGORIES,
  bucketForFuturesFund,
  futuresWeeklyCategories,
  previewFuturesWeeklyReview,
} from "./jy-weekly-review-futures"
import type { WeeklyReviewFund } from "./jy-weekly-review"

function fund(l3: string, extra: Partial<WeeklyReviewFund> = {}): WeeklyReviewFund {
  return {
    beian_hao: "S00001",
    product_name: "测试",
    short_name: null,
    l1: "期货策略",
    l2: "量化期货",
    l3,
    ...extra,
  }
}

const subjective = { l2: "主观期货" }

test("quant weekly categories are eight sheets, and 量价、商品 stay out", () => {
  assert.equal(QUANT_WEEKLY_CATEGORIES.length, 8)
  assert.deepEqual(futuresWeeklyCategories(fund("时序")), [QUANT_WEEKLY_CATEGORIES[0]])
  assert.deepEqual(futuresWeeklyCategories(fund("时序,量价")), [])
  assert.deepEqual(futuresWeeklyCategories(fund("时序,截面")), [
    QUANT_WEEKLY_CATEGORIES[0],
    QUANT_WEEKLY_CATEGORIES[1],
  ])
  assert.deepEqual(futuresWeeklyCategories(fund("时序,混合")), [
    QUANT_WEEKLY_CATEGORIES[0],
    QUANT_WEEKLY_CATEGORIES[2],
  ])
  assert.deepEqual(futuresWeeklyCategories(fund("截面,混合")), [
    QUANT_WEEKLY_CATEGORIES[1],
    QUANT_WEEKLY_CATEGORIES[2],
  ])
  assert.deepEqual(futuresWeeklyCategories(fund("截面,大厂")), [
    QUANT_WEEKLY_CATEGORIES[1],
    QUANT_WEEKLY_CATEGORIES[4],
  ])
  assert.deepEqual(futuresWeeklyCategories(fund("混合")), [QUANT_WEEKLY_CATEGORIES[2]])
  assert.deepEqual(futuresWeeklyCategories(fund("商品")), [])
  assert.deepEqual(futuresWeeklyCategories(fund("大厂,商品")), [])
  assert.deepEqual(futuresWeeklyCategories(fund("中高频")), [QUANT_WEEKLY_CATEGORIES[3]])
  assert.deepEqual(
    futuresWeeklyCategories(fund("截面,机器学习")),
    [QUANT_WEEKLY_CATEGORIES[1], QUANT_WEEKLY_CATEGORIES[7]],
  )
  assert.deepEqual(
    futuresWeeklyCategories(fund("大厂,时序")),
    [QUANT_WEEKLY_CATEGORIES[0], QUANT_WEEKLY_CATEGORIES[4]],
  )
  assert.deepEqual(
    futuresWeeklyCategories(fund("大厂,股指,截面")),
    [QUANT_WEEKLY_CATEGORIES[1], QUANT_WEEKLY_CATEGORIES[4], QUANT_WEEKLY_CATEGORIES[5]],
  )
  assert.deepEqual(futuresWeeklyCategories(fund("基本面,机器学习")), [
    QUANT_WEEKLY_CATEGORIES[6],
    QUANT_WEEKLY_CATEGORIES[7],
  ])
  assert.deepEqual(futuresWeeklyCategories(fund("机器学习,中高频")), [
    QUANT_WEEKLY_CATEGORIES[3],
    QUANT_WEEKLY_CATEGORIES[7],
  ])
  assert.deepEqual(futuresWeeklyCategories(fund("混合,大厂,中高频")), [
    QUANT_WEEKLY_CATEGORIES[2],
    QUANT_WEEKLY_CATEGORIES[3],
    QUANT_WEEKLY_CATEGORIES[4],
  ])
  for (const name of FUTURES_WEEKLY_CATEGORIES) {
    assert.ok(name.length <= 31, name)
  }
})

test("subjective weekly categories are the six sector sheets, and MOM also sits in 多板块", () => {
  assert.deepEqual(futuresWeeklyCategories(fund("黑色", subjective)), [SUBJECTIVE_WEEKLY_CATEGORIES[0]])
  assert.deepEqual(futuresWeeklyCategories(fund("有色", subjective)), [SUBJECTIVE_WEEKLY_CATEGORIES[1]])
  assert.deepEqual(futuresWeeklyCategories(fund("能化", subjective)), [SUBJECTIVE_WEEKLY_CATEGORIES[2]])
  assert.deepEqual(futuresWeeklyCategories(fund("农产", subjective)), [SUBJECTIVE_WEEKLY_CATEGORIES[3]])
  assert.deepEqual(futuresWeeklyCategories(fund("多板块", subjective)), [SUBJECTIVE_WEEKLY_CATEGORIES[4]])
  assert.deepEqual(futuresWeeklyCategories(fund("MOM", subjective)), [
    SUBJECTIVE_WEEKLY_CATEGORIES[4],
    SUBJECTIVE_WEEKLY_CATEGORIES[5],
  ])
  assert.deepEqual(futuresWeeklyCategories(fund("黑色,农产", subjective)), [
    SUBJECTIVE_WEEKLY_CATEGORIES[0],
    SUBJECTIVE_WEEKLY_CATEGORIES[3],
  ])
  assert.deepEqual(futuresWeeklyCategories(fund("交易型", subjective)), [])
  assert.deepEqual(futuresWeeklyCategories(fund("黑色")), [])
  assert.deepEqual(futuresWeeklyCategories(fund("MOM")), [])
})

test("single bucket prefers the first matching category", () => {
  assert.equal(bucketForFuturesFund(fund("大厂,时序")), QUANT_WEEKLY_CATEGORIES[0])
  assert.equal(bucketForFuturesFund(fund("混合,中高频")), QUANT_WEEKLY_CATEGORIES[2])
  assert.equal(bucketForFuturesFund(fund("多板块", subjective)), SUBJECTIVE_WEEKLY_CATEGORIES[4])
  assert.equal(bucketForFuturesFund(fund("MOM", subjective)), SUBJECTIVE_WEEKLY_CATEGORIES[4])
  assert.equal(bucketForFuturesFund(fund("交易型", subjective)), "主观交易")
})

test("parenthetical notes never filter; every sheet is plain tag membership", () => {
  // Titles still contain （…） hints, but membership is only the base tag.
  assert.ok(QUANT_WEEKLY_CATEGORIES[0].includes("（"))
  assert.ok(QUANT_WEEKLY_CATEGORIES[3].includes("（按交易频率）"))
  assert.ok(QUANT_WEEKLY_CATEGORIES[4].includes("（按规模）"))
  assert.ok(QUANT_WEEKLY_CATEGORIES[5].includes("（按品种）"))
  assert.ok(QUANT_WEEKLY_CATEGORIES[6].includes("（按因子类型）"))
  assert.ok(QUANT_WEEKLY_CATEGORIES[7].includes("（按方法论）"))
  assert.ok(SUBJECTIVE_WEEKLY_CATEGORIES[4].includes("（包含MOM）"))

  assert.deepEqual(futuresWeeklyCategories(fund("中高频")), [QUANT_WEEKLY_CATEGORIES[3]])
  assert.deepEqual(futuresWeeklyCategories(fund("大厂")), [QUANT_WEEKLY_CATEGORIES[4]])
  assert.deepEqual(futuresWeeklyCategories(fund("股指")), [QUANT_WEEKLY_CATEGORIES[5]])
  assert.deepEqual(futuresWeeklyCategories(fund("基本面")), [QUANT_WEEKLY_CATEGORIES[6]])
  assert.deepEqual(futuresWeeklyCategories(fund("机器学习")), [QUANT_WEEKLY_CATEGORIES[7]])
  // No AUM / frequency / factor-type side channel: only the tag string matters.
  assert.deepEqual(futuresWeeklyCategories(fund("时序,中高频,大厂,股指,基本面,机器学习")), [
    QUANT_WEEKLY_CATEGORIES[0],
    QUANT_WEEKLY_CATEGORIES[3],
    QUANT_WEEKLY_CATEGORIES[4],
    QUANT_WEEKLY_CATEGORIES[5],
    QUANT_WEEKLY_CATEGORIES[6],
    QUANT_WEEKLY_CATEGORIES[7],
  ])
  // 多板块 sheet includes MOM by explicit methodology, not by parsing （包含MOM）.
  assert.deepEqual(futuresWeeklyCategories(fund("MOM", subjective)), [
    SUBJECTIVE_WEEKLY_CATEGORIES[4],
    SUBJECTIVE_WEEKLY_CATEGORIES[5],
  ])
  assert.deepEqual(futuresWeeklyCategories(fund("多板块,MOM", subjective)), [
    SUBJECTIVE_WEEKLY_CATEGORIES[4],
    SUBJECTIVE_WEEKLY_CATEGORIES[5],
  ])
})

test("preview always lists quant and subjective sheets", () => {
  const groups = previewFuturesWeeklyReview([
    fund("时序"),
    fund("大厂,时序"),
    fund("混合"),
    fund("中高频"),
    fund("股指"),
    fund("黑色", subjective),
    fund("MOM", subjective),
  ])
  assert.deepEqual(groups.map((group) => group.bucket), [...FUTURES_WEEKLY_CATEGORIES])
  assert.deepEqual(
    groups.map((group) => group.count),
    [2, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1],
  )
})
