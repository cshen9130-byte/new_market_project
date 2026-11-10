/**
 *   npx tsx --test lib/ma/auto-weekly-templates.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  AUTO_WEEKLY_TEMPLATE_ID,
  AUTO_WEEKLY_TEMPLATE_NAME,
  AUTO_WEEKLY_TEMPLATE_OPTIONS,
  isAutoWeeklyTemplateId,
  resolveAutoWeeklyTemplate,
} from "@/lib/ma/auto-weekly-templates"

describe("resolveAutoWeeklyTemplate", () => {
  it("defaults missing or unknown ids to the curve template", () => {
    for (const value of [null, undefined, "", "weekly-unknown"]) {
      const resolved = resolveAutoWeeklyTemplate(value)
      assert.equal(resolved.id, AUTO_WEEKLY_TEMPLATE_ID)
      assert.equal(resolved.name, AUTO_WEEKLY_TEMPLATE_NAME)
      assert.equal(resolved.variant, "curve")
    }
  })

  it("resolves the holdings-pie weekly template", () => {
    const resolved = resolveAutoWeeklyTemplate("weekly-track-holdings")
    assert.equal(resolved.id, "weekly-track-holdings")
    assert.equal(resolved.name, "跟踪产品（持仓饼图版）")
    assert.equal(resolved.variant, "holdings")
  })

  it("lists only templates the auto scheduler can generate", () => {
    assert.deepEqual(
      AUTO_WEEKLY_TEMPLATE_OPTIONS.map((item) => item.id),
      ["weekly-track-curve", "weekly-track-holdings"],
    )
    assert.equal(isAutoWeeklyTemplateId("weekly-track-curve"), true)
    assert.equal(isAutoWeeklyTemplateId("weekly-track-holdings"), true)
    assert.equal(isAutoWeeklyTemplateId("weekly-track-general"), false)
  })
})
