/**
 *   npx tsx --test lib/server/knowledge-retrieval.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  assembleContext,
  buildFileBody,
  extractQueryAnchors,
  extractSnippets,
  cellSourcesFromCitations,
  namesColumn,
  parseGroundedAnswer,
  parseTableCellQuestion,
  rankSources,
  stripTrailingNoData,
  stripUnstatedIdentityAssumptions,
  type KbHit,
} from "./knowledge-retrieval"

const QUESTION = "左广东看多的品种都有哪些？"
const INTERNAL = "内部尽调资料/2025.12.25-左广东/左广东路演笔记-2025.12.25.pdf"
const MOM = "MOM尽调资料/左广东/左广东路演笔记-2025.12.25.pdf"
const MONTHLY = "倍致金选/倍致金选月报.pdf"

const PAGES = [
  { num: 1, text: "主讲人：左广东\n华泰期货19期路演" },
  { num: 2, text: "三、方向\n多头方向：铜、铝、黄金、铂金、碳酸锂。铜精矿短缺，短缺向下游传导。" },
]
const FULL = PAGES.map((page) => `[第${page.num}页]\n${page.text}`).join("\n\n")

describe("query anchors", () => {
  it("reads 左广东 from a stance question", () => {
    assert.deepEqual(extractQueryAnchors(QUESTION), ["左广东"])
  })

  it("reads 左广东 when the stance word is later in the question", () => {
    assert.ok(extractQueryAnchors("左广东在2025年12月路演里看多什么").includes("左广东"))
  })

  it("does not treat 黄金 as a person", () => {
    assert.deepEqual(extractQueryAnchors("黄金供需怎么看"), [])
  })
})

describe("path ranking for a named speaker", () => {
  const hits: KbHit[] = [
    { source: INTERNAL, content: "主讲人：左广东", score: 0.42, channel: "vector" },
    { source: MOM, content: "主讲人：左广东", score: 0.4, channel: "vector" },
    { source: MONTHLY, content: "黄金维持多头配置", score: 0.62, channel: "vector" },
  ]

  it("ranks the roadshow above an unrelated 月报 and collapses the two copies", () => {
    const ranked = rankSources(hits, QUESTION, [INTERNAL, MOM])
    assert.equal(ranked[0].identity, "左广东路演笔记-2025.12.25.pdf")
    assert.equal(ranked[0].aliases.length, 1)
    assert.ok(ranked[0].aliases.includes(INTERNAL) || ranked[0].aliases.includes(MOM) || ranked[0].source === INTERNAL || ranked[0].source === MOM)
    assert.equal(new Set([ranked[0].source, ...ranked[0].aliases]).size, 2)
    assert.equal(ranked.some((row) => row.source === MONTHLY), false)
  })
})

describe("short notes are read whole", () => {
  it("keeps the page-2 stance inside a short roadshow", () => {
    const body = buildFileBody({
      fullText: FULL,
      chunks: ["主讲人：左广东"],
      question: QUESTION,
    })
    assert.equal(body.coverage, "full")
    assert.match(body.text, /多头方向：铜、铝、黄金、铂金、碳酸锂/)
    const snippets = extractSnippets(body.text, QUESTION, PAGES, 4)
    assert.ok(snippets.some((item) => item.snippet.includes("碳酸锂") && item.page === 2))
  })

  it("expands to the stance chunk when the file is long", () => {
    const chunks = Array.from({ length: 12 }, (_, index) => `第${index}段${"内容".repeat(30)}`)
    chunks[0] = `主讲人：左广东 ${chunks[0]}`
    chunks[7] = `多头方向：铜、铝、黄金、铂金、碳酸锂 ${chunks[7]}`
    const body = buildFileBody({
      fullText: "长".repeat(25_000),
      chunks,
      question: QUESTION,
    })
    assert.equal(body.coverage, "neighbors")
    assert.match(body.text, /碳酸锂/)
    assert.equal(body.text.includes("长长长长"), false)
  })
})

describe("grounded citations", () => {
  it("keeps a page quote and drops files the answer does not quote", () => {
    const assembled = assembleContext([{ source: INTERNAL, text: FULL }], 28_000)
    const raw = [
      "多头包括铜、铝、黄金、铂金、碳酸锂【1】。",
      JSON.stringify({
        citations: [{
          n: 1,
          quote: "多头方向：铜、铝、黄金、铂金、碳酸锂",
          path: INTERNAL,
          page: 2,
        }],
      }),
    ].join("\n")
    const parsed = parseGroundedAnswer(raw, assembled.body, [INTERNAL, MONTHLY], { [INTERNAL]: PAGES })
    assert.equal(parsed.citations.length, 1)
    assert.equal(parsed.citations[0].page, 2)
    assert.deepEqual(parsed.sources, [INTERNAL])
    assert.equal(parsed.citationsGrounded, true)
    assert.equal(parsed.answer.includes("倍致"), false)
  })

  it("rejects a quote that is not in the note", () => {
    const parsed = parseGroundedAnswer(
      `${JSON.stringify({ citations: [{ n: 1, quote: "这段话资料里根本没有写过", path: INTERNAL, page: 1 }] })}`,
      FULL,
      [INTERNAL],
      { [INTERNAL]: PAGES },
    )
    assert.equal(parsed.citations.length, 0)
    assert.deepEqual(parsed.sources, [INTERNAL])
    assert.equal(parsed.citationsGrounded, false)
  })

  it("removes an identity link the note never states", () => {
    const stripped = stripUnstatedIdentityAssumptions("假设为倍致金选的基金经理。未找到看多品种。", FULL)
    assert.match(stripped, /资料未说明该身份关联/)
    assert.equal(stripped.includes("假设为"), false)
  })

  it("keeps 假设为 when the note itself says it", () => {
    const context = "笔记原文：假设为情景分析，不作为配置建议。"
    const stripped = stripUnstatedIdentityAssumptions("笔记写了假设为情景分析。", context)
    assert.match(stripped, /假设为情景分析/)
  })
})

describe("table cells", () => {
  const cellQuestion = "填写「打板策略横向比较表」。列：「量道」，行：「代表产品」。只采用出现了「量道」的段落。"

  it("reads the column and row", () => {
    assert.deepEqual(parseTableCellQuestion(cellQuestion), { column: "量道", row: "代表产品" })
    assert.equal(parseTableCellQuestion("左广东看多的品种都有哪些？"), null)
  })

  it("does not treat 六九星 as 六妙星", () => {
    assert.equal(namesColumn("六九星路演，三年回测年化约80%", "六妙星"), false)
    assert.equal(namesColumn("923 六妙星 20260728 代表一号", "六妙星"), true)
  })

  it("drops a 打板 note that never names the column", () => {
    const question = cellQuestion
    const ranked = rankSources([
      { source: "投资笔记/上海务扬打板.html", content: "三年回测年化约80%，最大回撤约7%，胜率约55%。", score: 0.9, channel: "vector" },
      { source: "外部尽调资料/量道量化择时多空指数增强策略.pdf", content: "投资总监程余。代表产品千石资本量道对冲1号。", score: 0.2, channel: "vector" },
    ], question)
    assert.deepEqual(ranked.map((row) => row.source), ["外部尽调资料/量道量化择时多空指数增强策略.pdf"])
  })

  it("keeps a short file whose name contains the column even without a chunk hit", () => {
    const ranked = rankSources(
      [],
      "填写「打板策略横向比较表」。列：「衍复」，行：「细分策略」。",
      ["投资笔记/2025.07衍复尽调.html"],
    )
    assert.equal(ranked.length, 1)
    assert.match(ranked[0].source, /衍复/)
  })

  it("drops a trailing 暂无数据 when the cell already has a value", () => {
    assert.equal(stripTrailingNoData("程余\n暂无数据"), "程余")
    assert.equal(stripTrailingNoData("千石资本量道对冲1号。暂无数据"), "千石资本量道对冲1号")
    assert.equal(stripTrailingNoData("暂无数据"), "暂无数据")
  })

  it("keeps a source only when the quote names the column", () => {
    const sources = cellSourcesFromCitations([
      { n: 1, quote: "三年回测年化约80%，最大回撤约7%", path: "投资笔记/上海务扬.html", page: 1 },
      { n: 2, quote: "量道的代表产品是千石资本量道对冲1号", path: "外部尽调资料/量道.pdf", page: 2 },
    ], "量道")
    assert.deepEqual(sources, [{ path: "外部尽调资料/量道.pdf", quote: "量道的代表产品是千石资本量道对冲1号" }])
  })
})
