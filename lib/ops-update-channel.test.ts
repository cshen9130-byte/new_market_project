import assert from "node:assert/strict"
import test from "node:test"
import { FOF99_LIST_COVERAGE, buildUniverseMoves, formatEmptyFridays } from "./ops-update-channel"

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

test("recorded list coverage adds up", () => {
  const coverage = FOF99_LIST_COVERAGE
  assert.equal(coverage.with_nav + coverage.no_nav, coverage.operating_total)
  assert.equal(coverage.recent + coverage.older_nav, coverage.with_nav)
  const recentSum = coverage.recent_rows.reduce((sum, row) => sum + row.count, 0)
  assert.equal(recentSum, coverage.recent)
  const olderSum = coverage.older_rows.reduce((sum, row) => sum + row.count, 0)
  assert.equal(olderSum, coverage.older_nav)
})
