import assert from "node:assert/strict"
import test from "node:test"
import {
  buildWeeklyReviewDataStatus,
  coversWeek,
  latestNavOnOrBefore,
  pickBestSource,
  type WeekWindow,
} from "./weekly-review-data-status"

const weeks: WeekWindow[] = [
  { week_start: "2026-10-12", week_end: "2026-10-16" },
  { week_start: "2026-10-05", week_end: "2026-10-09" },
  { week_start: "2026-09-28", week_end: "2026-10-02" },
]

test("a print inside Monday–Friday covers that week only", () => {
  assert.equal(coversWeek(["2026-10-16"], weeks[0]), true)
  assert.equal(coversWeek(["2026-10-12"], weeks[0]), true)
  assert.equal(coversWeek(["2026-10-11"], weeks[0]), false)
  assert.equal(coversWeek(["2026-10-17"], weeks[0]), false)
  assert.equal(coversWeek(["2026-10-16"], weeks[1]), false)
})

test("latest nav ignores prints after the week end", () => {
  assert.equal(latestNavOnOrBefore(["2026-10-02", "2026-10-16"], "2026-10-09"), "2026-10-02")
  assert.equal(latestNavOnOrBefore([], "2026-10-16"), null)
})

test("same-day source prefers manual, then email, then fof99; a newer day wins", () => {
  assert.equal(
    pickBestSource([
      { source: "fof99", date: "2026-10-16" },
      { source: "email", date: "2026-10-16" },
      { source: "manual", date: "2026-10-16" },
    ]).source,
    "manual",
  )
  assert.deepEqual(
    pickBestSource([
      { source: "manual", date: "2026-09-30" },
      { source: "email", date: "2026-10-16" },
    ]),
    { source: "email", date: "2026-10-16" },
  )
  assert.equal(pickBestSource([]).source, "none")
})

test("category status counts missing products by update channel", () => {
  const status = buildWeeklyReviewDataStatus({
    variant: "equity",
    weeks,
    bucketOrder: ["500指增", "1000指增"],
    modeFor: (bucket) => (bucket.endsWith("指增") ? "excess" : "absolute"),
    generatedAt: "2026-10-19T01:00:00.000Z",
    funds: [
      {
        beian_hao: "A",
        name: "甲",
        bucket: "500指增",
        nav_dates: ["2026-10-16", "2026-10-09", "2026-10-02"],
        source: "email",
        source_date: "2026-10-16",
      },
      {
        beian_hao: "B",
        name: "乙",
        bucket: "500指增",
        nav_dates: ["2026-10-02"],
        source: "fof99",
        source_date: "2026-10-02",
      },
      {
        beian_hao: "C",
        name: "丙",
        bucket: "500指增",
        nav_dates: [],
        source: "none",
        source_date: null,
      },
      {
        beian_hao: "D",
        name: "丁",
        bucket: "1000指增",
        nav_dates: ["2026-09-25"],
        source: "email",
        source_date: "2026-10-16",
      },
    ],
  })

  assert.equal(status.fund_count, 4)
  assert.equal(status.categories[0]?.bucket, "500指增")
  assert.equal(status.categories[0]?.mode, "excess")
  assert.equal(status.categories[0]?.total, 3)
  assert.equal(status.categories[0]?.weeks[0]?.missing, 2)
  assert.deepEqual(status.categories[0]?.weeks[0]?.by_source, {
    email: 0,
    manual: 0,
    fof99: 1,
    none: 1,
  })
  assert.equal(status.categories[0]?.weeks[2]?.missing, 1)
  assert.equal(status.categories[0]?.weeks[2]?.by_source.none, 1)
  assert.deepEqual(
    status.categories[0]?.missing_funds.map((fund) => fund.beian_hao),
    ["B", "C"],
  )
  assert.equal(status.categories[1]?.mode, "excess")
  assert.equal(status.categories[1]?.total, 1)
  assert.equal(status.categories[1]?.weeks[0]?.missing, 1)
  assert.equal(status.categories[1]?.weeks[0]?.by_source.email, 1)
  assert.deepEqual(status.categories[1]?.missing_funds[0]?.unused_weeks, [
    "2026-10-16",
  ])
  assert.equal(status.categories[1]?.missing_funds[0]?.nav_date, "2026-09-25")
})
