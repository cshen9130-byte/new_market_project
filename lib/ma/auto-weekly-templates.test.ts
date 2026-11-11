/**
 *   npx tsx --test lib/ma/auto-weekly-templates.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  AUTO_WEEKLY_TEMPLATE_ID,
  AUTO_WEEKLY_TEMPLATE_NAME,
  AUTO_WEEKLY_TEMPLATE_OPTIONS,
  autoWeeklyTemplateShortLabel,
  isAutoWeeklyTemplateId,
  officialMonthlyTemplateShortLabel,
  officialReportTemplateShortLabel,
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
    assert.equal(resolved.name, "跟踪产品（持仓版）")
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

  it("maps legacy weekly names to short labels and leaves monthly titles alone", () => {
    assert.equal(autoWeeklyTemplateShortLabel("weekly-track-curve", "跟踪产品（通用曲线版）"), "超额版")
    assert.equal(autoWeeklyTemplateShortLabel(undefined, "跟踪产品（通用曲线版）"), "超额版")
    assert.equal(autoWeeklyTemplateShortLabel("weekly-track-holdings", "跟踪产品（持仓饼图版）"), "持仓版")
    assert.equal(autoWeeklyTemplateShortLabel(undefined, "跟踪产品（通用曲线版）月报"), "跟踪产品（通用曲线版）月报")
    assert.equal(autoWeeklyTemplateShortLabel("monthly-track-curve", "跟踪产品（通用曲线版）"), "跟踪产品（通用曲线版）")
  })
})


describe("official monthly short labels", () => {
  it("maps monthly ids and legacy names without treating them as weekly templates", () => {
    assert.equal(officialMonthlyTemplateShortLabel("monthly-track-curve", "跟踪产品（通用曲线版）"), "超额版")
    assert.equal(officialMonthlyTemplateShortLabel("monthly-review", "跟踪产品（月度回顾版）"), "马年版")
    assert.equal(officialMonthlyTemplateShortLabel("monthly-pe-official", "私募基金月报-官方"), "低中高波三产品版")
    assert.equal(officialMonthlyTemplateShortLabel("monthly-fund-official", "单产品投资月报"), "表格版")
    assert.equal(officialMonthlyTemplateShortLabel("monthly-track-holdings", "跟踪产品（持仓版）"), "持仓版")
    assert.equal(officialMonthlyTemplateShortLabel(undefined, "跟踪产品（通用曲线版）月报"), "超额版")
    assert.equal(officialMonthlyTemplateShortLabel("weekly-track-curve", "跟踪产品（通用曲线版）"), null)
    assert.equal(officialReportTemplateShortLabel("monthly-track-curve", "跟踪产品（通用曲线版）"), "超额版")
    assert.equal(officialReportTemplateShortLabel("weekly-track-curve", "跟踪产品（通用曲线版）"), "超额版")
    assert.equal(officialReportTemplateShortLabel("weekly-track-holdings", "跟踪产品（持仓饼图版）"), "持仓版")
  })
})
