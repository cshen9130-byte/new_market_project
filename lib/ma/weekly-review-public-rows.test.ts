/**
 *   npx tsx --test lib/ma/weekly-review-public-rows.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { meanOf, takeBestByWeek } from "./weekly-review-public-rows"
import { buildWeeklyReviewMarketChartTables, freezeWorksheetHeaderRows, sampleStdev, SOURCE_WEEK_STATS, sourceMedianRows, sourceWeekStatRows } from "../server/weekly-review-excel-charts"

test("mean ignores missing values", () => {
  assert.equal(meanOf([0.02, null, 0.04, undefined]), 0.03)
  assert.equal(meanOf([null]), null)
  assert.equal(meanOf([]), null)
})

test("each strategy median counts a product in every source it belongs to", () => {
  const rows = sourceMedianRows([
    { bucket: "500指增", week: 0.02, pool: true, xiaohe: true },
    { bucket: "500指增", week: 0.04, pool: true },
    { bucket: "500指增", week: 0.01, xiaohe: true, held: true },
    { bucket: "500指增", week: 0.03, public: true },
    { bucket: "500指增", week: null, ima: true },
    { bucket: "主观多头", week: 0.05, ima: true },
  ])
  const tables = buildWeeklyReviewMarketChartTables(
    [{ name: "沪深300", ret: 0.01 }],
    [{ beian_hao: "S1", name: "私募甲", bucket: "500指增", ret_1w: 0.02 }],
    rows,
    8,
  )
  assert.equal(tables.chart2?.title, "各策略来源近一周中位数")
  assert.equal(tables.chart2?.series.length, 5)
  assert.equal(tables.dataAoa[0]?.[4], "策略")
  assert.equal(tables.dataAoa[0]?.[5], "跟踪池")
  assert.equal(tables.dataAoa[0]?.[6], "小荷公众号")
  assert.equal(tables.dataAoa[0]?.[7], "公募指增")
  assert.equal(tables.dataAoa[0]?.[8], "ima点睛")
  assert.equal(tables.dataAoa[0]?.[9], "已投")
  assert.equal(tables.dataAoa[1]?.[4], "500指增")
  assert.equal(tables.dataAoa[1]?.[5], 0.03)
  assert.equal(tables.dataAoa[1]?.[6], 0.015)
  assert.equal(tables.dataAoa[1]?.[7], 0.03)
  assert.equal(tables.dataAoa[1]?.[8], null)
  assert.equal(tables.dataAoa[1]?.[9], 0.01)
  assert.equal(tables.dataAoa[2]?.[4], "主观多头")
  assert.equal(tables.dataAoa[2]?.[8], 0.05)
  assert.equal(tables.note.includes("公募指增 vs 跟踪池"), false)
})

test("source stats count a product in every source and ignore a blank week", () => {
  const rows = sourceWeekStatRows([
    { bucket: "500指增", week: 0.02, pool: true, xiaohe: true },
    { bucket: "500指增", week: 0.04, pool: true },
    { bucket: "500指增", week: 0.01, xiaohe: true, held: true },
    { bucket: "500指增", week: 0.03, public: true },
    { bucket: "500指增", week: null, ima: true },
  ])
  assert.equal(rows.length, 1)
  const [pool, xiaohe, pub, ima, held] = rows[0].sources
  assert.deepEqual(pool, { count: 2, median: 0.03, mean: 0.03, max: 0.04, min: 0.02, stdev: Math.sqrt(0.0002) })
  assert.deepEqual(xiaohe, { count: 2, median: 0.015, mean: 0.015, max: 0.02, min: 0.01, stdev: Math.sqrt(0.00005) })
  assert.deepEqual(pub, { count: 1, median: 0.03, mean: 0.03, max: 0.03, min: 0.03, stdev: null })
  assert.equal(ima.count, 0)
  assert.equal(ima.stdev, null)
  assert.deepEqual(held, { count: 1, median: 0.01, mean: 0.01, max: 0.01, min: 0.01, stdev: null })
})

test("sample stdev is undefined for n under 2 and uses n-1 for n of 2 or more", () => {
  assert.equal(sampleStdev([]), null)
  assert.equal(sampleStdev([null, undefined]), null)
  assert.equal(sampleStdev([0.02]), null)
  assert.equal(sampleStdev([0.02, null]), null)
  assert.equal(sampleStdev([1, 2, 3]), 1)
  assert.equal(sampleStdev([0.02, 0.04]), Math.sqrt(0.0002))
  assert.equal(sampleStdev([0.01, Number.NaN, 0.03]), Math.sqrt(0.0002))
  assert.equal(
    SOURCE_WEEK_STATS.map((stat) => stat.label).join(","),
    "中位数,平均数,最大值,最小值,产品数,分化程度",
  )
})

test("a strategy sheet freezes the header row", async () => {
  const xlsxMod = await import("xlsx-js-style") as { default?: typeof import("xlsx"); utils?: typeof import("xlsx")["utils"]; write?: Function }
  const XLSX = (xlsxMod.utils ? xlsxMod : xlsxMod.default) as typeof import("xlsx") & {
    write: (wb: unknown, opts: { bookType: string; type: string; cellStyles?: boolean }) => Buffer
  }
  const ws = XLSX.utils.aoa_to_sheet([["产品名称", "近一周收益"], ["甲", 0.01]])
  const raw = XLSX.write(
    { SheetNames: ["04_500指增"], Sheets: { "04_500指增": ws } },
    { bookType: "xlsx", type: "buffer", cellStyles: true },
  ) as unknown as Buffer
  const frozen = await freezeWorksheetHeaderRows(raw, ["04_500指增", "口径说明"])
  const JSZip = (await import("jszip")).default
  const zip = await JSZip.loadAsync(frozen)
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string")
  assert.match(xml, /ySplit="1"/)
  assert.match(xml, /topLeftCell="A2"/)
  assert.match(xml, /state="frozen"/)
  assert.equal(xml.includes("<pane"), true)
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
