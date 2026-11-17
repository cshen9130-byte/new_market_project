import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { noteExcerpt, rankWebsiteNotes } from "./investment-note-query.ts"
import type { InvestmentNote } from "./investment-notes.ts"

function note(partial: Partial<InvestmentNote> & Pick<InvestmentNote, "id" | "title">): InvestmentNote {
  return {
    content: "",
    preview: "",
    contentVariant: "plain",
    teamShared: true,
    tags: [],
    associations: [],
    roadshowAssociations: [],
    attachments: [],
    creator: "沈聪",
    lastModifiedBy: "沈聪",
    modifiedDate: "2026-09-28",
    createdDate: "2026-09-28",
    ...partial,
  }
}

describe("website investment note search", () => {
  it("ranks a title hit ahead of a body mention and builds the notes page link", () => {
    const hits = rankWebsiteNotes([
      {
        scope: "team",
        note: note({
          id: "zhuolei",
          title: "卓镭基金量化CTA策略及润榕6号产品介绍",
          content: "<p>资料来源：量衍量化CTA介绍.pdf</p>",
          modifiedDate: "2026-11-01",
        }),
      },
      {
        scope: "team",
        note: note({
          id: "liangyan",
          title: "量衍:量化CTA策略投资笔记",
          content: "<p>浙江量衍投资管理有限公司</p>",
          modifiedDate: "2026-09-28",
        }),
      },
    ], "量衍")
    assert.equal(hits[0].id, "liangyan")
    assert.equal(hits[0].match, "title")
    assert.equal(hits[1].id, "zhuolei")
    assert.equal(hits[1].match, "body")
    assert.match(hits[1].excerpt, /量衍量化CTA介绍/)
    assert.equal(
      hits[0].url,
      "https://8.154.33.143/ma/dashboard/private-funds?tab=investment&side=inv-dd-notes&noteId=liangyan&notesScope=team",
    )
  })

  it("keeps the matched words in the excerpt", () => {
    const text = `${"甲".repeat(400)}量衍策略${"乙".repeat(400)}`
    const excerpt = noteExcerpt(text, "量衍")
    assert.match(excerpt, /^…/)
    assert.match(excerpt, /量衍策略/)
    assert.match(excerpt, /…$/)
  })
})
