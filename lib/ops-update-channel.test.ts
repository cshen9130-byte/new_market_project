import assert from "node:assert/strict"
import test from "node:test"
import { addCalendarMonths } from "./ops-data-overview"
import {
  FOF99_LIST_COVERAGE,
  buildEmailCohort,
  buildFof99Cohort,
  buildUniverseMoves,
  emailFreshnessBucket,
  emailFreshnessListKey,
  emptyEmailCohortCounts,
  emptyFof99CohortCounts,
  parseFof99Cohort,
  formatEmptyFridays,
  parseEmailStaleListKey,
  parseFof99RecentListPolicy,
  buildEmailCountBridge,
  winningUpdateChannel,
} from "./ops-update-channel"

test("empty Friday list formats the dates stored on a downgrade", () => {
  assert.equal(
    formatEmptyFridays("2026-09-18, 2026-09-11, 2026-09-04"),
    "9月18日、9月11日、9月4日",
  )
  assert.equal(formatEmptyFridays(""), "")
  assert.equal(formatEmptyFridays(null), "")
})

test("universe moves merge admits and downgrades onto the run day", () => {
  const moves = buildUniverseMoves(
    { added: 10, added_still_weekly: 10, moved_slow: 554, moved_still_slow: 554 },
    [
      { ran_on: "2026-09-11", added: 6 },
      { ran_on: "2026-09-18", added: 3 },
      { ran_on: "2026-10-08", added: 1 },
    ],
    [
      { ran_on: "2026-09-11", moved: 37, fridays: "2026-09-04, 2026-08-28, 2026-08-21" },
      { ran_on: "2026-09-18", moved: 6, fridays: "2026-09-11, 2026-09-04, 2026-08-28" },
      { ran_on: "2026-09-25", moved: 511, fridays: "2026-09-18, 2026-09-11, 2026-09-04" },
    ],
  )
  assert.equal(moves.added, 10)
  assert.equal(moves.moved_slow, 554)
  assert.deepEqual(
    moves.runs.map((row) => [row.ran_on, row.added, row.moved_slow]),
    [
      ["2026-09-11", 6, 37],
      ["2026-09-18", 3, 6],
      ["2026-09-25", 0, 511],
      ["2026-10-08", 1, 0],
    ],
  )
  assert.equal(moves.runs[2].empty_fridays, "9月18日、9月11日、9月4日")
  assert.equal(moves.runs[3].empty_fridays, "")
})

test("email freshness splits weeks, then 1-2 months and later", () => {
  const today = "2026-10-19"
  assert.equal(emailFreshnessBucket("2026-10-19", today), "w1")
  assert.equal(emailFreshnessBucket("2026-10-12", today), "w1")
  assert.equal(emailFreshnessBucket("2026-10-11", today), "w1_2")
  assert.equal(emailFreshnessBucket("2026-10-05", today), "w1_2")
  assert.equal(emailFreshnessBucket("2026-10-04", today), "w2_3")
  assert.equal(emailFreshnessBucket("2026-09-28", today), "w2_3")
  assert.equal(emailFreshnessBucket("2026-09-27", today), "w3_4")
  assert.equal(emailFreshnessBucket("2026-09-21", today), "w3_4")
  assert.equal(emailFreshnessBucket("2026-09-20", today), "m1_2")
  assert.equal(emailFreshnessBucket(addCalendarMonths(today, -2), today), "m1_2")
  assert.equal(emailFreshnessBucket("2026-08-18", today), "m2_3")
  assert.equal(emailFreshnessBucket(addCalendarMonths(today, -3), today), "m2_3")
  assert.equal(emailFreshnessBucket("2026-07-18", today), "m3_6")
  assert.equal(emailFreshnessBucket(addCalendarMonths(today, -6), today), "m3_6")
  assert.equal(emailFreshnessBucket("2026-04-18", today), "over_m6")
  assert.equal(emailFreshnessBucket("", today), "none")
  assert.equal(emailFreshnessBucket("2026-10-25", today), "w1")
})

test("same-day channel prefers manual, then email", () => {
  assert.equal(winningUpdateChannel({ email: "2026-10-10", manual: "2026-10-10", fof99: "2026-10-10" }), "manual")
  assert.equal(winningUpdateChannel({ email: "2026-10-10", fof99: "2026-10-10" }), "email")
  assert.equal(winningUpdateChannel({ email: "2026-10-01", fof99: "2026-10-10" }), "fof99")
  assert.equal(winningUpdateChannel({}), "none")
})

test("only buckets behind two weeks open a product list", () => {
  assert.equal(emailFreshnessListKey("fresh_w1"), null)
  assert.equal(emailFreshnessListKey("fresh_w1_2"), null)
  assert.equal(emailFreshnessListKey("fresh_w2_3"), "w2_3")
  assert.equal(emailFreshnessListKey("fresh_over_m6"), "over_m6")
  assert.equal(parseEmailStaleListKey("behind_2w"), "behind_2w")
  assert.equal(parseEmailStaleListKey("w1"), null)
})

test("email cohort rows share the product total", () => {
  const counts = emptyEmailCohortCounts()
  counts.total = 10
  counts.in_pool = 4
  counts.with_fof99 = 6
  counts.with_manual = 3
  counts.multi_source = 7
  counts.src_email_only = 2
  counts.src_email_fof99 = 4
  counts.src_email_manual = 1
  counts.src_all_three = 2
  counts.src_other = 1
  counts.src_none = 0
  counts.fresh_w1 = 3
  counts.fresh_w1_2 = 2
  counts.fresh_m1_2 = 5
  counts.ch_email = 8
  counts.ch_none = 2
  counts.pol_weekly = 6
  counts.pol_none = 4
  const cohort = buildEmailCohort(counts)
  const sum = (rows: Array<{ count: number }>) => rows.reduce((total, row) => total + row.count, 0)
  assert.equal(sum(cohort.sources), 10)
  assert.equal(sum(cohort.freshness), 10)
  assert.equal(sum(cohort.channel), 10)
  assert.equal(sum(cohort.policy), 10)
  assert.equal(cohort.sources.find((row) => row.key === "src_none"), undefined)
  assert.equal(cohort.sources.find((row) => row.key === "src_email_only")?.share, 0.2)
  assert.equal(cohort.multi_source, 7)
})

test("fof99 tracked cohort rows share the product total", () => {
  const counts = emptyFof99CohortCounts()
  counts.total = 10
  counts.in_pool = 4
  counts.with_email = 3
  counts.with_manual = 2
  counts.multi_source = 4
  counts.src_fof99_only = 5
  counts.src_fof99_email = 2
  counts.src_fof99_manual = 1
  counts.src_all_three = 1
  counts.src_other = 1
  counts.src_none = 0
  counts.fresh_w1 = 6
  counts.fresh_w2_3 = 4
  counts.ch_fof99 = 7
  counts.ch_email = 2
  counts.ch_none = 1
  counts.pol_weekly = 8
  counts.pol_weekly_plus = 2
  const cohort = buildFof99Cohort(counts)
  const sum = (rows: Array<{ count: number }>) => rows.reduce((total, row) => total + row.count, 0)
  assert.equal(sum(cohort.sources), 10)
  assert.equal(sum(cohort.freshness), 10)
  assert.equal(sum(cohort.channel), 10)
  assert.equal(sum(cohort.policy), 10)
  assert.equal(cohort.sources.find((row) => row.key === "src_none"), undefined)
  assert.equal(cohort.sources.find((row) => row.key === "src_fof99_only")?.label, "仅 fof99")
  assert.equal(parseFof99Cohort("fetching"), "fetching")
  assert.equal(parseFof99Cohort("ever"), null)
})

test("recorded list coverage adds up", () => {
  const coverage = FOF99_LIST_COVERAGE
  assert.equal(coverage.with_nav + coverage.no_nav, coverage.operating_total)
  assert.equal(coverage.recent + coverage.older_nav, coverage.with_nav)
  const recentSum = coverage.recent_rows.reduce((sum, row) => sum + row.count, 0)
  assert.equal(recentSum, coverage.recent)
  const olderSum = coverage.older_rows.reduce((sum, row) => sum + row.count, 0)
  assert.equal(olderSum, coverage.older_nav)
  assert.equal(coverage.recent_measured_on, "2026-10-19")
  assert.equal(parseFof99RecentListPolicy("weekly"), "weekly")
  assert.equal(parseFof99RecentListPolicy("none"), "none")
  assert.equal(parseFof99RecentListPolicy("email"), null)
})

test("email count bridge columns add up to the four headlines", () => {
  const bridge = buildEmailCountBridge({
    records: [
      { inEver: true, inLastWeek: true, inLibrary: true, channel: "email", team: "email" },
      { inEver: true, inLastWeek: true, inLibrary: false, channel: "none", team: "email" },
      { inEver: true, inLastWeek: false, inLibrary: true, channel: "fof99", team: "absent" },
      { inEver: false, inLastWeek: false, inLibrary: false, channel: "none", team: "email" },
      { inEver: true, inLastWeek: true, inLibrary: true, channel: "email", team: "manual" },
    ],
    blankTeamEmailRows: 1,
    duplicateTeamEmailRows: 2,
  })
  const sum = (flag: "ever" | "lastWeek" | "libraryEmail" | "teamEmail") => (
    bridge.rows.reduce((total, row) => total + (row[flag] ? row.count : 0), 0)
  )
  assert.equal(sum("ever"), bridge.ever)
  assert.equal(sum("lastWeek"), bridge.lastWeek)
  assert.equal(sum("libraryEmail"), bridge.libraryEmail)
  assert.equal(sum("teamEmail"), bridge.teamEmail)
  assert.equal(bridge.ever, 4)
  assert.equal(bridge.lastWeek, 3)
  assert.equal(bridge.libraryEmail, 2)
  assert.equal(bridge.teamEmail, 6)
  assert.equal(bridge.rows.some((row) => row.key === "blank" && row.count === 1), true)
  assert.equal(bridge.rows.some((row) => row.key === "duplicate" && row.count === 2), true)
})
