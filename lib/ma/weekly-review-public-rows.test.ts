/**
 *   npx tsx --test lib/ma/weekly-review-public-rows.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { meanOf, takeBestByWeek } from "./weekly-review-public-rows"
import { buildWeeklyReviewMarketChartTables } from "../server/weekly-review-excel-charts"

test("mean ignores missing values", () => {
  assert.equal(meanOf([0.02, null, 0.04, undefined]), 0.03)
  assert.equal(meanOf([null]), null)
  assert.equal(meanOf([]), null)
})

test("the market chart compares featured public funds with the same-strategy pool", () => {
  const tables = buildWeeklyReviewMarketChartTables(
    [{ name: "沪深300", ret: 0.01 }],
    [
      { beian_hao: "S1", name: "私募甲", bucket: "500指增", ret_1w: 0.02 },
      { beian_hao: "S2", name: "私募乙", bucket: "500指增", ret_1w: 0.04 },
    ],
    [{ beian_hao: "000001", name: "公募领先", bucket: "500指增", ret_1w: 0.03 }],
    [
      { beian_hao: "000001", name: "公募领先", bucket: "500指增", ret_1w: 0.03 },
      { beian_hao: "000002", name: "公募普通", bucket: "500指增", ret_1w: 0.01 },
      { beian_hao: "000003", name: "别的组", bucket: "上证50指增", ret_1w: 0.09 },
    ],
    8,
  )
  assert.equal(tables.chart2?.title, "公募指增 vs 跟踪池（近一周）")
  assert.equal(tables.dataAoa[0]?.[6], "公募指增")
  assert.equal(tables.dataAoa[1]?.[4], "整体")
  assert.equal(tables.dataAoa[1]?.[5], 0.03)
  assert.equal(tables.dataAoa[1]?.[6], 0.02)
  assert.equal(tables.dataAoa[2]?.[4], "公募领先（500指增）")
  assert.equal(tables.note.includes("已投"), false)
})

test("best weekly rows are the highest finite values, capped at five", () => {
  const rows = [
    { name: "丙", week: 0.01 },
    { name: "甲", week: null },
    { name: "乙", week: 0.05 },
    { name: "丁", week: 0.04 },
    { name: "戊", week: 0.03 },
    { name: "己", week: 0.02 },
    { name: "庚", week: 0.015 },
  ]
  assert.deepEqual(
    takeBestByWeek(rows, (row) => row.week).map((row) => row.name),
    ["乙", "丁", "戊", "己", "庚"],
  )
  assert.deepEqual(
    takeBestByWeek(rows, (row) => row.week, 2).map((row) => row.name),
    ["乙", "丁"],
  )
})
