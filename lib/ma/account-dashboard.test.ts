import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  DEFAULT_ACCOUNT_CHARTS,
  chartSpan,
  sanitizeAccountDashboardPrefs,
} from "./account-dashboard"

describe("account dashboard prefs", () => {
  it("starts a new account with an empty board", () => {
    const prefs = sanitizeAccountDashboardPrefs({}, true)
    assert.deepEqual(prefs.charts, DEFAULT_ACCOUNT_CHARTS)
    assert.deepEqual(prefs.charts, [])
    assert.equal(prefs.columns, 2)
    assert.deepEqual(prefs.layout, {})
    assert.equal(prefs.landing, "overview")
    assert.equal(prefs.theme, "system")
  })

  it("keeps an explicit empty subscription", () => {
    const prefs = sanitizeAccountDashboardPrefs({ charts: [] }, true)
    assert.deepEqual(prefs.charts, [])
  })

  it("drops unknown charts and keeps order", () => {
    const prefs = sanitizeAccountDashboardPrefs({
      title: "  早盘  ",
      theme: "dark",
      charts: ["regime-similarity", "nope", "regime-similarity", "scale-index-vol"],
    }, true)
    assert.equal(prefs.title, "早盘")
    assert.equal(prefs.theme, "dark")
    assert.deepEqual(prefs.charts, ["regime-similarity", "scale-index-vol"])
    assert.equal(prefs.layout["regime-similarity"].width, "full")
    assert.equal(prefs.layout["scale-index-vol"].width, "half")
    assert.equal(prefs.layout["scale-index-vol"].height, "auto")
  })

  it("hides MOM charts from accounts without that permission", () => {
    const prefs = sanitizeAccountDashboardPrefs({
      charts: ["ashare-crowding", "equity-curve", "var-prediction"],
    }, false)
    assert.deepEqual(prefs.charts, ["ashare-crowding"])
    assert.equal(prefs.layout["equity-curve"], undefined)
    assert.equal(prefs.layout["ashare-crowding"].width, "full")
  })

  it("keeps a chosen width and height, and ignores unknown layout keys", () => {
    const prefs = sanitizeAccountDashboardPrefs({
      columns: 4,
      charts: ["scale-index-vol"],
      layout: {
        "scale-index-vol": { width: "narrow", height: "s" },
        missing: { width: "full", height: "l" },
      },
    }, true)
    assert.equal(prefs.columns, 4)
    assert.deepEqual(prefs.layout, { "scale-index-vol": { width: "narrow", height: "s" } })
    assert.equal(chartSpan("full", 4), 4)
    assert.equal(chartSpan("half", 4), 2)
    assert.equal(chartSpan("narrow", 2), 1)
    assert.equal(chartSpan("wide", 3), 2)
    assert.equal(prefs.holders[0]?.chartId, "scale-index-vol")
    assert.equal(prefs.holders[0]?.width, "narrow")
  })

  it("keeps an empty chart holder and uses holders as the board", () => {
    const prefs = sanitizeAccountDashboardPrefs({
      charts: ["scale-index-vol"],
      holders: [{ id: "slot_a", chartId: null, width: "full", height: "l" }],
    }, true)
    assert.deepEqual(prefs.charts, [])
    assert.equal(prefs.holders.length, 1)
    assert.equal(prefs.holders[0].id, "slot_a")
    assert.equal(prefs.holders[0].chartId, null)
    assert.equal(prefs.holders[0].height, "l")
  })
})
