import { NextResponse } from "next/server"
import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { getUserById } from "@/lib/server/users"
import {
  parseInvestmentNoteIntegrationAnalysis,
  type InvestmentNoteIntegrationAnalysis,
} from "@/lib/ma/investment-note-integration"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const MAX_NOTES = 40
const MAX_TEXT = 24_000

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
    temperature: 0.2,
    streaming: false,
    configuration: {
      baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  })
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] || text).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf("{")
    const end = candidate.lastIndexOf("}")
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1))
    throw new Error("AI 返回格式无效")
  }
}

type SourceNote = {
  title: string
  date: string
  creator: string
  roadshows: string[]
  text: string
}

function readSources(body: unknown): SourceNote[] {
  const notes = Array.isArray((body as { notes?: unknown })?.notes)
    ? (body as { notes: unknown[] }).notes
    : []
  const sources: SourceNote[] = []
  for (const item of notes) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const text = String(row.text ?? "").trim()
    if (!text) continue
    sources.push({
      title: String(row.title ?? "").trim().slice(0, 200) || "无标题",
      date: String(row.date ?? "").trim().slice(0, 32),
      creator: String(row.creator ?? "").trim().slice(0, 40),
      roadshows: Array.isArray(row.roadshows)
        ? row.roadshows.map((v) => String(v ?? "").trim()).filter(Boolean).slice(0, 8)
        : [],
      text: text.slice(0, 4000),
    })
    if (sources.length >= MAX_NOTES) break
  }
  return sources
}

function promptBlock(notes: SourceNote[], keyword: string): string {
  let used = 0
  const parts: string[] = []
  if (keyword) parts.push(`筛选词：${keyword}`, "")
  notes.forEach((note, index) => {
    const body = note.text.slice(0, Math.max(400, MAX_TEXT - used))
    used += body.length
    if (!body || used > MAX_TEXT + 400) return
    const roadshow = note.roadshows.length ? `路演：${note.roadshows.join("；")}` : "路演：未关联"
    parts.push(
      `【${index + 1}】${note.date || "日期不详"} · ${note.title}${note.creator ? ` · ${note.creator}` : ""}`,
      roadshow,
      body,
      "",
    )
  })
  return parts.join("\n").slice(0, MAX_TEXT + 2000)
}

export async function POST(req: Request) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const keyword = String((body as { keyword?: unknown })?.keyword ?? "").trim().slice(0, 80)
    const sources = readSources(body)
    if (sources.length < 2) {
      return NextResponse.json({ ok: false, error: "至少需要 2 条有正文的笔记" }, { status: 400 })
    }

    const model = getChatModel()
    const system = new SystemMessage(
      [
        "你是私募投研助理，负责把多场路演笔记收成一份简报。",
        "只根据给定笔记写作，不要编造规模、收益、排名或日期。笔记里没有的数字不要出现。",
        "用中文。综述 4 到 8 句，写清管理人/策略、路演跨度和主要结论。",
        "recentChanges 写近期相对更早路演的增减：规模、超额、排名、团队、策略、回撤、容量等。trend 只用：上升、下降、持平、新出现。",
        "series 只收录同一指标在两个及以上日期都能对上的数字，用于折线图。value 必须是数字，unit 如 亿元、%。对不上就不要给 series。",
        "focus 给投资团队 3 到 5 条接下来该盯的点，具体、可执行。",
        '严格输出 JSON：{"summary":"","recentChanges":[{"topic":"","trend":"上升","detail":""}],"focus":[""],"series":[{"name":"","unit":"","points":[{"date":"2026/03","value":12}]}]}',
      ].join("\n"),
    )
    const human = new HumanMessage(["【路演笔记，按时间从早到晚】", promptBlock(sources, keyword)].join("\n"))
    const aiResult = await model.invoke([system, human])
    const rawText = typeof aiResult.content === "string"
      ? aiResult.content
      : Array.isArray(aiResult.content)
        ? aiResult.content.map((part) => ("text" in part ? String(part.text || "") : "")).join("")
        : String(aiResult.content ?? "")
    const analysis: InvestmentNoteIntegrationAnalysis | null = parseInvestmentNoteIntegrationAnalysis(
      extractJsonObject(rawText),
    )
    if (!analysis?.summary) throw new Error("AI 未返回可用综述")
    return NextResponse.json({ ok: true, analysis })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[investment-notes/integrate]", e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
