/**
 *   npx tsx --test lib/ma/investment-note-integration.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  integrationBriefHtml,
  metricSeriesSvg,
  parseInvestmentNoteIntegrationAnalysis,
  roadshowTimelineBuckets,
  roadshowTimelineSvg,
} from "./investment-note-integration"
import { buildIntegratedInvestmentNoteDraft, type InvestmentNote } from "./investment-notes"

function note(partial: Partial<InvestmentNote> & Pick<InvestmentNote, "id" | "title">): InvestmentNote {
  return {
    content: "正文",
    preview: "",
    contentVariant: "plain",
    teamShared: true,
    tags: [],
    associations: [],
    roadshowAssociations: [],
    attachments: [],
    creator: "甲",
    lastModifiedBy: "甲",
    modifiedDate: "2026/03/01",
    createdDate: "2026/03/01",
    ...partial,
  }
}

describe("roadshow timeline", () => {
  it("counts unique roadshows per month", () => {
    const buckets = roadshowTimelineBuckets([
      {
        createdDate: "2026/03/04",
        roadshows: [
          { key: "a", date: "2026/03/04" },
          { key: "a", date: "2026/03/20" },
        ],
      },
      { createdDate: "2026/09/24", roadshows: [{ key: "b", date: "2026/09/24" }] },
      { createdDate: "2026/09/23", roadshows: [] },
    ])
    assert.deepEqual(buckets, [
      { label: "2026/03", count: 1 },
      { label: "2026/09", count: 2 },
    ])
    const svg = roadshowTimelineSvg(buckets)
    assert.match(svg, /<svg/)
    assert.match(svg, /路演场次/)
    assert.doesNotMatch(svg, /class=/)
    assert.doesNotMatch(svg, /style=/)
  })
})

describe("integration analysis", () => {
  it("keeps chart series that have two points and drops the rest", () => {
    const parsed = parseInvestmentNoteIntegrationAnalysis({
      summary: "规模上升。",
      recentChanges: [{ topic: "管理规模", trend: "上升", detail: "由 10 亿到 12 亿" }],
      focus: ["跟踪超额是否维持"],
      series: [
        { name: "管理规模", unit: "亿元", points: [{ date: "2026/03", value: 10 }, { date: "2026/09", value: "12" }] },
        { name: "一次", unit: "%", points: [{ date: "2026/03", value: 1 }] },
      ],
    })
    assert.equal(parsed?.series.length, 1)
    assert.equal(parsed?.series[0]?.points[1]?.value, 12)
    assert.match(metricSeriesSvg(parsed!.series[0]!), /polyline/)
  })

  it("writes the brief and the original notes into one draft", () => {
    const draft = buildIntegratedInvestmentNoteDraft(
      [
        note({
          id: "1",
          title: "星阔 3月",
          createdDate: "2026/03/04",
          content: "<div>规模约10亿</div>",
          roadshowAssociations: [{ rowId: "r1", label: "2026/03/04 星阔", ddDate: "2026/03/04", fundCompany: "星阔" }],
        }),
        note({
          id: "2",
          title: "星阔 9月",
          createdDate: "2026/09/24",
          content: "规模约12亿",
          roadshowAssociations: [{ rowId: "r2", label: "2026/09/24 星阔", ddDate: "2026/09/24", fundCompany: "星阔" }],
        }),
        note({ id: "3", title: "星阔 路演整合", content: "旧整合", tags: ["整合"] }),
      ],
      "",
      {
        summary: "两场路演之间规模上升。",
        recentChanges: [{ topic: "管理规模", trend: "上升", detail: "10亿到12亿" }],
        focus: ["核实容量"],
        series: [{ name: "管理规模", unit: "亿元", points: [{ date: "2026/03", value: 10 }, { date: "2026/09", value: 12 }] }],
      },
      { selected: true },
    )
    assert.match(draft.title, /星阔/)
    assert.match(draft.title, /路演整合/)
    assert.match(draft.content, /路演时间线/)
    assert.match(draft.content, /两场路演之间规模上升/)
    assert.match(draft.content, /近期变化/)
    assert.match(draft.content, /核实容量/)
    assert.match(draft.content, /规模约12亿/)
    assert.doesNotMatch(draft.content, /旧整合/)
    assert.equal(draft.roadshowAssociations.length, 2)
    const html = integrationBriefHtml({
      noteCount: 2,
      roadshowCount: 2,
      buckets: roadshowTimelineBuckets([]),
      sourceLabel: "",
      analysis: null,
    })
    assert.match(html, /路演时间线/)
  })
})
