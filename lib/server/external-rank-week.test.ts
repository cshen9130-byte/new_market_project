/**
 *   npx tsx --test lib/server/external-rank-week.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as XLSX from "xlsx"
import type { ExternalRankWeekFile } from "@/lib/ma/external-rank-week"
import {
  buildExternalRankWeekWorkbook,
  concreteDateSpans,
  extractRankFileDates,
  externalRankWeekFileName,
  externalRankWeekWindow,
  matchRankWeek,
  weekFriday,
  yearForShortDates,
} from "./external-rank-week"

const WEEK_OCT2 = { start: "2026-09-28", end: "2026-10-02" }
const WEEK_OCT9 = { start: "2026-10-05", end: "2026-10-09" }

describe("filename dates", () => {
  it("reads a dotted range that omits the year on the end date", () => {
    const dates = extractRankFileDates("2026.9.28~9.30 网红量化私募.xlsx")
    assert.deepEqual(dates.spans, [{ start: "2026-09-28", end: "2026-09-30" }])
    assert.deepEqual(dates.shorts, [])
    assert.equal(matchRankWeek(dates.spans, null, WEEK_OCT2.start, WEEK_OCT2.end), "filename")
    assert.equal(matchRankWeek(dates.spans, null, WEEK_OCT9.start, WEEK_OCT9.end), null)
  })

  it("reads a compact cutoff and a year-less 截止930", () => {
    const compact = extractRankFileDates("点睛业绩放送_量化+主观CTA（截止20250930）.xlsx")
    assert.deepEqual(compact.spans, [{ start: "2025-09-30", end: "2025-09-30" }])

    const shortName = "点睛业绩放送_主观多头管理人业绩榜（今年来截止930）.xlsx"
    const short = extractRankFileDates(shortName)
    assert.deepEqual(short.shorts, [{ month: 9, day: 30 }])
    const spans = concreteDateSpans(short, yearForShortDates(shortName, null, 2026))
    assert.deepEqual(spans, [{ start: "2026-09-30", end: "2026-09-30" }])
    assert.equal(matchRankWeek(spans, null, WEEK_OCT2.start, WEEK_OCT2.end), "filename")
    assert.equal(matchRankWeek(spans, null, WEEK_OCT9.start, WEEK_OCT9.end), null)
  })

  it("leaves an issue-number file without a filename date", () => {
    const dates = extractRankFileDates("第470次.xlsx")
    assert.deepEqual(dates.spans, [])
    assert.deepEqual(dates.shorts, [])
  })

  it("matches the workbook as-of, and ignores a filename date from another week", () => {
    assert.equal(matchRankWeek([], "2026-10-09", WEEK_OCT9.start, WEEK_OCT9.end), "as_of")
    assert.equal(matchRankWeek([], "2026-09-30", WEEK_OCT9.start, WEEK_OCT9.end), null)
    assert.equal(matchRankWeek([{ start: "2026-10-09", end: "2026-10-09" }], "2026-10-09", WEEK_OCT9.start, WEEK_OCT9.end), "both")
    assert.equal(matchRankWeek([{ start: "2026-09-30", end: "2026-09-30" }], "2026-10-09", WEEK_OCT2.start, WEEK_OCT2.end), null)
    assert.equal(matchRankWeek([{ start: "2026-09-30", end: "2026-09-30" }], "2026-10-09", WEEK_OCT9.start, WEEK_OCT9.end), "as_of")
  })
})

describe("week window", () => {
  it("uses Monday through the selected day, and labels weeks by Friday", () => {
    assert.deepEqual(externalRankWeekWindow("2026-10-09", "2026-10-14"), {
      weekStart: "2026-10-05",
      weekEnd: "2026-10-09",
    })
    assert.equal(weekFriday("2026-09-30"), "2026-10-02")
    assert.equal(weekFriday("2026-10-10"), "2026-10-09")
    assert.equal(externalRankWeekFileName("2026-10-09"), "外部私募业绩排行 - 2026.10.9.xlsx")
  })
})

describe("workbook", () => {
  it("writes an overview plus one sheet per parsed file", () => {
    const file: ExternalRankWeekFile = {
      path: "外部私募业绩排行/点睛.xlsx",
      name: "点睛业绩放送_主观多头.xlsx",
      size: 100,
      updated_at: "2026-10-13T03:00:00.000Z",
      parsed: true,
      error: null,
      title: "主观多头业绩榜",
      as_of: "2026-10-09",
      window_label: "今年以来",
      classes: ["主观多头"],
      matched_by: "both",
      row_count: 1,
      truncated: false,
      rows: [{
        rank: 1,
        strategy: "主观多头",
        class_key: "主观多头",
        manager: "北京禧悦私募",
        product: null,
        aum: "5-10亿",
        nav_date: "2026-10-09",
        ytd: 1.5912,
        ytd_drawdown: 0.2442,
        ret_1w: -0.0012,
        sheet: "主观多头",
      }],
    }
    const buffer = buildExternalRankWeekWorkbook({
      week_start: "2026-10-05",
      week_end: "2026-10-09",
      files: [file],
    })
    const book = XLSX.read(buffer, { type: "buffer" })
    assert.deepEqual(book.SheetNames, ["概览", "汇总", "点睛业绩放送_主观多头"])
    const sheet = book.Sheets["点睛业绩放送_主观多头"]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
    assert.equal(rows[2]?.[2], "北京禧悦私募")
    assert.equal(rows[2]?.[6], 1.5912)
  })
})
