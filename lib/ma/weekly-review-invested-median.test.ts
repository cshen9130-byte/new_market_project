/**
 *   npx tsx --test lib/ma/weekly-review-invested-median.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { meanOf } from "./weekly-review-public-rows"
import {
  buildInvestedMedianGroups,
  formatWeekReturnTopShare,
  investedMedianInsertIndex,
  medianOf,
  weekReturnTopShare,
  type InvestedMedianInput,
} from "./weekly-review-invested-median"

const empty = { ret_3m: null, ret_6m: null, ret_1y: null }

test("median averages the two middle values when the count is even", () => {
  assert.equal(medianOf([0.04, null, 0.01, 0.02, 0.03]), 0.025)
  assert.equal(medianOf([0.02]), 0.02)
  assert.equal(medianOf([null, undefined]), null)
})

test("a holding in two strategies counts in both medians, and empty strategies stay out", () => {
  const rows: InvestedMedianInput[] = [
    { code: "A", name: "甲", buckets: ["时序", "截面"], mode: "absolute", ret_1w: 0.01, ret_1m: 0.02, ...empty },
    { code: "B", name: "乙", buckets: ["时序"], mode: "absolute", ret_1w: 0.03, ret_1m: null, ...empty },
    { code: "C", name: "丙", buckets: ["截面", "截面"], mode: "absolute", ret_1w: null, ret_1m: 0.04, ...empty },
  ]
  const groups = buildInvestedMedianGroups(rows, ["时序", "截面", "混合"])
  assert.deepEqual(groups.map((group) => group.bucket), ["时序", "截面"])

  const timing = groups[0]!
  assert.equal(timing.count, 2)
  assert.equal(timing.median.ret_1w, 0.02)
  assert.equal(timing.median.ret_1m, 0.02)
  assert.deepEqual(timing.products.map((product) => product.code), ["B", "A"])

  const cross = groups[1]!
  assert.equal(cross.count, 2)
  assert.equal(cross.median.ret_1w, 0.01)
  assert.equal(cross.median.ret_1m, 0.03)
})

test("a column median and mean take a top-share rank among the same products", () => {
  const weeks = [0.05, 0.03, null, 0.01]
  const median = medianOf(weeks)
  const mean = meanOf(weeks)
  assert.equal(median, 0.03)
  assert.equal(mean, 0.03)
  assert.equal(weekReturnTopShare(median, weeks), 2 / 3)
  assert.equal(formatWeekReturnTopShare(weekReturnTopShare(mean, weeks)), "前67%")
  assert.equal(weekReturnTopShare(0.05, weeks), 1 / 3)
  assert.equal(formatWeekReturnTopShare(weekReturnTopShare(0.05, weeks)), "前33%")
})

test("the median row slots in after higher weekly returns and before missing prints", () => {
  assert.equal(investedMedianInsertIndex([0.0359, 0.0335, 0.0319, null], 0.0325), 2)
  assert.equal(investedMedianInsertIndex([0.01, null], 0.02), 0)
  assert.equal(investedMedianInsertIndex([0.04, 0.03], 0.01), 2)
  assert.equal(investedMedianInsertIndex([0.04], null), null)
})
