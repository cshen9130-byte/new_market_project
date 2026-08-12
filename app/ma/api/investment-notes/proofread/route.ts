import { NextResponse } from "next/server"
import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { getUserById } from "@/lib/server/users"
import { getServerDueDiligenceTable } from "@/lib/server/due-diligence-table"
import type { DueDiligenceTableRow } from "@/lib/ma/due-diligence-table"
import { MAX_INVESTMENT_NOTE_CONTENT_CHARS, compactRichNoteHtml } from "@/lib/ma/investment-notes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

type RoadshowFact = {
  label: string
  value: string
}

type ProofreadChange = {
  field: string
  from: string
  to: string
}

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

function getChatModel() {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error("缺少 DASHSCOPE_API_KEY")
  return new ChatOpenAI({
    apiKey,
    model: process.env.DASHSCOPE_ANALYSIS_MODEL || process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus",
    temperature: 0.1,
    streaming: false,
    configuration: {
      baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  })
}

function trim(value?: string | null): string {
  return String(value ?? "").trim()
}

function buildRoadshowFacts(row: DueDiligenceTableRow): RoadshowFact[] {
  const strategy = [row.strategyLevel1, row.strategyLevel2, row.strategyLevel3]
    .map(trim)
    .filter(Boolean)
    .join(" / ")
  const datetime = [trim(row.ddDate), trim(row.ddTime)].filter(Boolean).join(" ")
  const facts: Array<[string, string]> = [
    ["尽调日期", datetime],
    ["路演日期", datetime],
    ["尽调形式", trim(row.ddMethod)],
    ["路演形式", trim(row.ddMethod)],
    ["尽调人员", trim(row.ddPersonnel)],
    ["路演人员", trim(row.ddPersonnel)],
    ["尽调对象", trim(row.ddTarget)],
    ["路演对象", trim(row.ddTarget)],
    ["基金公司", trim(row.fundCompany)],
    ["管理人", trim(row.fundCompany)],
    ["投资经理", trim(row.investmentManager)],
    ["代表产品", trim(row.representativeProduct)],
    ["备案编码", trim(row.representativeProductBeianHao)],
    ["推荐人", trim(row.recommender)],
    ["策略初筛", trim(row.strategyPreliminary)],
    ["策略", strategy],
    ["一级策略", trim(row.strategyLevel1)],
    ["二级策略", trim(row.strategyLevel2)],
    ["三级策略", trim(row.strategyLevel3)],
    ["尽调结论", trim(row.ddConclusion)],
  ]
  return facts
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => ({ label, value }))
}

/** Deterministic fix for labeled lines like `基金公司：xxx`. */
function applyLabeledFieldCorrections(
  content: string,
  facts: RoadshowFact[],
): { content: string; changes: ProofreadChange[] } {
  let next = content
  const changes: ProofreadChange[] = []
  const seen = new Set<string>()

  for (const fact of facts) {
    const key = `${fact.label}|${fact.value}`
    if (seen.has(key)) continue
    seen.add(key)

    const pattern = new RegExp(
      `(${escapeRegExp(fact.label)}\\s*[:：]\\s*)([^\\n<]+)`,
      "g",
    )
    next = next.replace(pattern, (full, prefix: string, rawValue: string) => {
      const current = rawValue.replace(/&nbsp;/gi, " ").trim()
      if (!current || current === fact.value) return full
      if (!changes.some((c) => c.field === fact.label && c.from === current && c.to === fact.value)) {
        changes.push({ field: fact.label, from: current, to: fact.value })
      }
      return `${prefix}${fact.value}`
    })
  }

  return { content: next, changes }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] || text).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf("{")
    const end = candidate.lastIndexOf("}")
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1))
    }
    throw new Error("AI 返回格式无效")
  }
}

function factsPromptBlock(facts: RoadshowFact[]): string {
  return facts.map((f) => `- ${f.label}：${f.value}`).join("\n")
}

export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const content = typeof body?.content === "string" ? body.content : ""
    const rowIds = Array.isArray(body?.rowIds)
      ? body.rowIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : []

    if (!content.trim()) {
      return NextResponse.json({ ok: false, error: "笔记内容为空" }, { status: 400 })
    }
    if (rowIds.length === 0) {
      return NextResponse.json({ ok: false, error: "请先关联路演" }, { status: 400 })
    }
    if (content.length > MAX_INVESTMENT_NOTE_CONTENT_CHARS) {
      return NextResponse.json(
        {
          ok: false,
          error: `笔记内容过长，请控制在 ${MAX_INVESTMENT_NOTE_CONTENT_CHARS.toLocaleString("zh-CN")} 字符以内`,
        },
        { status: 400 },
      )
    }

    const table = await getServerDueDiligenceTable()
    const rows = rowIds
      .map((id: string) => table.rows.find((row) => row.id === id))
      .filter((row): row is DueDiligenceTableRow => Boolean(row))

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "未找到关联路演的尽调表格数据，请重新关联路演" },
        { status: 404 },
      )
    }

    const primary = rows[0]
    const facts = buildRoadshowFacts(primary)
    if (facts.length === 0) {
      return NextResponse.json({ ok: false, error: "关联路演缺少可用于校对的基本信息" }, { status: 400 })
    }

    const labeled = applyLabeledFieldCorrections(content, facts)
    let corrected = labeled.content
    const changes = [...labeled.changes]

    const model = getChatModel()
    const system = new SystemMessage(
      [
        "你是私募投资尽调报告校对助手。",
        "任务：以「路演基本信息（权威）」为准，校对并修正报告正文中的基础事实错误。",
        "重点修正：基金公司/管理人名称、投资经理姓名、尽调/路演对象、代表产品、备案编码、策略名称、日期与形式等。",
        "要求：",
        "1. 只修正与权威信息不一致的基础事实；不要改写分析观点、结论逻辑或虚构新信息。",
        "2. 保持原有 HTML/排版结构，尽量少改无关文字。",
        "3. 若某字段权威信息为空，则不要删除正文对应内容。",
        "4. 严格输出 JSON：{\"content\":\"校对后的完整正文\",\"changes\":[{\"field\":\"字段\",\"from\":\"原文\",\"to\":\"改正\"}]}",
        "5. content 必须是完整正文，不要省略；changes 只列实际修改。",
      ].join("\n"),
    )
    const human = new HumanMessage(
      [
        "【路演基本信息（权威）】",
        factsPromptBlock(facts),
        "",
        "【待校对报告正文】",
        corrected,
      ].join("\n"),
    )

    const aiResult = await model.invoke([system, human])
    const rawText = typeof aiResult.content === "string"
      ? aiResult.content
      : Array.isArray(aiResult.content)
        ? aiResult.content.map((part) => ("text" in part ? String(part.text || "") : "")).join("")
        : String(aiResult.content ?? "")

    const parsed = extractJsonObject(rawText) as {
      content?: unknown
      changes?: unknown
    }
    const aiContent = typeof parsed.content === "string" ? parsed.content.trim() : ""
    if (!aiContent) {
      throw new Error("AI 未返回校对后的正文")
    }

    corrected = compactRichNoteHtml(aiContent)
    if (corrected.length > MAX_INVESTMENT_NOTE_CONTENT_CHARS) {
      throw new Error("校对后内容过长，请缩短笔记后再试")
    }

    if (Array.isArray(parsed.changes)) {
      for (const item of parsed.changes) {
        if (!item || typeof item !== "object") continue
        const row = item as Partial<ProofreadChange>
        const field = trim(row.field)
        const from = trim(row.from)
        const to = trim(row.to)
        if (!field || !to || from === to) continue
        if (!changes.some((c) => c.field === field && c.from === from && c.to === to)) {
          changes.push({ field, from, to })
        }
      }
    }

    // Re-apply labeled corrections so explicit basic-info lines stay authoritative.
    const finalized = applyLabeledFieldCorrections(corrected, facts)
    corrected = finalized.content
    for (const change of finalized.changes) {
      if (!changes.some((c) => c.field === change.field && c.from === change.from && c.to === change.to)) {
        changes.push(change)
      }
    }

    return NextResponse.json({
      ok: true,
      content: corrected,
      changes,
      roadshowLabel:
        [trim(primary.ddDate), trim(primary.fundCompany) || trim(primary.ddTarget), trim(primary.representativeProduct)]
          .filter(Boolean)
          .join(" ") || primary.id,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[investment-notes/proofread]", e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
