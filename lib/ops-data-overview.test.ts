import assert from "node:assert/strict"
import test from "node:test"
import {
  DATA_OVERVIEW_SCOPES,
  addCalendarMonths,
  laterNavDate,
  navAgeTree,
  navDateBucket,
  overviewRows,
  productTotalTree,
  teamLagBucket,
  weekBucket,
} from "./ops-data-overview"

const today = "2026-10-15"

test("week buckets split the latest week from one week behind", () => {
  assert.equal(weekBucket("2026-10-15", today), "w0")
  assert.equal(weekBucket("2026-10-08", today), "w0")
  assert.equal(weekBucket("2026-10-07", today), "w1")
  assert.equal(weekBucket("2026-10-01", today), "w1")
  assert.equal(weekBucket("2026-09-30", today), "w2")
  assert.equal(weekBucket("2026-09-24", today), "w2")
  assert.equal(weekBucket("2026-09-23", today), "w3")
  assert.equal(weekBucket("2026-09-17", today), "w3")
  assert.equal(weekBucket("2026-09-16", today), "m1_3")
  assert.equal(weekBucket(addCalendarMonths(today, -6), today), "m3_6")
  assert.equal(weekBucket("2026-04-14", today), "over_m6")
  assert.equal(weekBucket("", today), "none")
  assert.equal(weekBucket("2026-10-20", today), "w0")
})

test("platform nav date buckets match the list windows", () => {
  assert.equal(navDateBucket("2026-10-15", today), "m1")
  assert.equal(navDateBucket(addCalendarMonths(today, -1), today), "m1")
  assert.equal(navDateBucket("2026-09-14", today), "m1_3")
  assert.equal(navDateBucket(addCalendarMonths(today, -3), today), "m1_3")
  assert.equal(navDateBucket("2026-07-14", today), "m3_6")
  assert.equal(navDateBucket(addCalendarMonths(today, -6), today), "m3_6")
  assert.equal(navDateBucket("2026-04-14", today), "over_m6")
  assert.equal(navDateBucket(null, today), "none")
})

test("team lag treats a missing date as behind two weeks", () => {
  assert.equal(teamLagBucket("2026-10-01", today), "within_2w")
  assert.equal(teamLagBucket("2026-09-30", today), "behind_2w")
  assert.equal(teamLagBucket(null, today), "behind_2w")
})

test("later nav date is the newer of the two product-page dates", () => {
  assert.equal(laterNavDate("2026-10-01", "2026-09-01"), "2026-10-01")
  assert.equal(laterNavDate("2026-09-01", "2026-10-01"), "2026-10-01")
  assert.equal(laterNavDate("2026-10-01", null), "2026-10-01")
  assert.equal(laterNavDate("", "2026-10-01"), "2026-10-01")
  assert.equal(laterNavDate(null, undefined), "")
  assert.equal(laterNavDate("2026-10-01T00:00:00", "2026-10-02"), "2026-10-02")
})

test("product total tree splits private and other by nav, then by tracking pool", () => {
  const tree = productTotalTree(10, {
    private_present: 6,
    private_absent: 1,
    other_present: 2,
    other_absent: 1,
    private_present_in: 4,
    private_present_out: 2,
    private_absent_in: 0,
    private_absent_out: 1,
    other_present_in: 1,
    other_present_out: 1,
    other_absent_in: 1,
    other_absent_out: 0,
  })
  assert.equal(tree.label, "产品总数")
  assert.equal(tree.count, 10)
  assert.equal(tree.children?.[0]?.label, "私募基金")
  assert.equal(tree.children?.[0]?.count, 7)
  assert.deepEqual(tree.children?.[0]?.children?.map((node) => node.count), [6, 1])
  assert.deepEqual(tree.children?.[0]?.children?.[0]?.children?.map((node) => [node.label, node.count]), [
    ["在跟踪池", 4],
    ["不在跟踪池", 2],
  ])
  assert.deepEqual(tree.children?.[0]?.children?.[1]?.children?.map((node) => node.count), [0, 1])
  assert.equal(tree.children?.[1]?.label, "其他")
  assert.equal(tree.children?.[1]?.count, 3)
  assert.deepEqual(tree.children?.[1]?.children?.map((node) => [node.label, node.count]), [
    ["有净值", 2],
    ["无净值", 1],
  ])
  assert.deepEqual(tree.children?.[1]?.children?.[0]?.children?.map((node) => node.count), [1, 1])
  assert.deepEqual(tree.children?.[1]?.children?.[1]?.children?.map((node) => [node.label, node.count]), [
    ["在跟踪池", 1],
    ["不在跟踪池", 0],
  ])
})

test("nav age tree splits dated products by tracking pool", () => {
  const tree = navAgeTree({
    m1: { in: 8, out: 2 },
    m1_3: { in: 3, out: 1 },
    m3_6: { in: 1, out: 1 },
    over_m6: { in: 0, out: 4 },
    none: { in: 0, out: 0 },
  })
  assert.equal(tree.label, "有净值")
  assert.equal(tree.count, 20)
  assert.deepEqual(tree.children?.map((node) => [node.label, node.count]), [
    ["1个月以内", 10],
    ["1-3个月", 4],
    ["3-6个月", 2],
    ["6个月以上", 4],
  ])
  assert.deepEqual(tree.children?.[0]?.children?.map((node) => [node.label, node.count]), [
    ["在跟踪池", 8],
    ["不在跟踪池", 2],
  ])
  assert.deepEqual(tree.children?.[3]?.children?.map((node) => node.count), [0, 4])
})

test("nav age tree keeps products that have a nav but no date", () => {
  const tree = navAgeTree({
    m1: { in: 1, out: 0 },
    m1_3: { in: 0, out: 0 },
    m3_6: { in: 0, out: 0 },
    over_m6: { in: 0, out: 0 },
    none: { in: 2, out: 3 },
  })
  assert.equal(tree.count, 6)
  assert.equal(tree.children?.[4]?.label, "无净值日期")
  assert.deepEqual(tree.children?.[4]?.children?.map((node) => node.count), [2, 3])
})

test("scope filters include products that already have a nav", () => {
  assert.deepEqual(
    DATA_OVERVIEW_SCOPES.map((item) => [item.key, item.label]),
    [
      ["all", "全库"],
      ["nav", "有净值"],
      ["tracking", "跟踪池"],
      ["team", "团队数据"],
      ["platform", "平台数据"],
    ],
  )
})

test("shares use the scope total", () => {
  const rows = overviewRows(4, [
    { key: "a", label: "A", count: 1 },
    { key: "b", label: "B", count: 3 },
  ])
  assert.equal(rows[0]?.share, 0.25)
  assert.equal(rows[1]?.share, 0.75)
  assert.equal(overviewRows(0, [{ key: "a", label: "A", count: 0 }])[0]?.share, 0)
})
