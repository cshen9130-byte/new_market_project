import assert from "node:assert/strict"
import test from "node:test"
import { sqlTrackingFirstEntryByCode } from "./tracking-first-entry"

const sql = sqlTrackingFirstEntryByCode()

test("首次入表 uses the earliest pool add and the first email fetch", () => {
  for (const table of [
    "tracking_pool",
    "selected_pool",
    "core_pool",
    "hy_tracking_pool",
    "fof_mom_tracking",
    "user_custom_pool",
    "type6_ops_team_full",
    "ops_email_nav_records",
    "ops_email_valuation_records",
  ]) {
    assert.match(sql, new RegExp(`FROM ${table}\\b`))
  }
  assert.match(sql, /MIN\(\(imported_at AT TIME ZONE 'Asia\/Shanghai'\)::date\)/)
  assert.match(sql, /MIN\(\(created_at AT TIME ZONE 'Asia\/Shanghai'\)::date\)/)
})

test("首次入表 does not read the list cache", () => {
  assert.doesNotMatch(sql, /ops_tracking_funds_list_cache/)
  assert.doesNotMatch(sql, /refreshed_at/)
  assert.doesNotMatch(sql, /as_of_date/)
  assert.doesNotMatch(sql, /updated_at/)
})
