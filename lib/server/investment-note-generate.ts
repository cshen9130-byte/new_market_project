import path from "path"
import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import {
  compactRichNoteHtml,
  MAX_INVESTMENT_NOTE_CONTENT_CHARS,
  MAX_INVESTMENT_NOTE_TITLE_CHARS,
  type InvestmentNote,
} from "@/lib/ma/investment-notes"
import { readFundContractText } from "@/lib/server/fund-contract-element-extract"
import { readPdfTextWithCmaps } from "@/lib/server/pdf-text"
import {
  getInvestmentNoteMaterialsByIds,
  linkInvestmentNoteMaterials,
  readInvestmentNoteMaterialFile,
  type InvestmentNoteMaterial,
} from "@/lib/server/investment-note-materials"
import { createServerInvestmentNoteWithKbSync } from "@/lib/server/investment-notes"
import type { InvestmentNoteKbOwner } from "@/lib/server/investment-notes-kb-sync"

const MAX_MATERIALS = 8
const MAX_TEXT_PER_FILE = 12_000
const MAX_TOTAL_TEXT = 40_000
const CONTRACT_MAX_BYTES = 20 * 1024 * 1024
const TEXT_EXTENSIONS = new Set([".txt", ".csv"])
const EXTRACT_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
])

export type GeneratedNoteFromMaterials = {
  note: InvestmentNote
  materials: InvestmentNoteMaterial[]
  skipped: string[]
}

function getExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase()
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function textToNoteHtml(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return "<div><br></div>"
  return trimmed
    .split(/\r?\n/)
    .map((line) => `<div>${line ? escapeHtml(line) : "<br>"}</div>`)
    .join("")
}

function toNoteHtml(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return "<div><br></div>"
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return compactRichNoteHtml(trimmed)
  return textToNoteHtml(trimmed)
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

function stringifyModelContent(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item
        if (item && typeof item === "object" && "text" in item) {
          return String((item as { text?: string }).text || "")
        }
        return ""
      })
      .join("\n")
      .trim()
  }
  return String(content || "")
}

function getChatModel(): ChatOpenAI {
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

async function extractMaterialText(buffer: Buffer, fileName: string): Promise<string> {
  const ext = getExtension(fileName)
  if (TEXT_EXTENSIONS.has(ext)) {
    return buffer.toString("utf8").replace(/\u0000/g, "").trim()
  }
  if (ext === ".pdf" && buffer.byteLength > CONTRACT_MAX_BYTES) {
    return (await readPdfTextWithCmaps(buffer)).trim()
  }
  if (EXTRACT_EXTENSIONS.has(ext)) {
    return (await readFundContractText(buffer, fileName)).trim()
  }
  throw new Error("暂不支持从该格式提取文字")
}

function fallbackTitle(fileNames: string[]): string {
  if (fileNames.length === 1) {
    const base = fileNames[0].replace(/\.[^.]+$/, "").trim()
    return (base || "资料笔记").slice(0, MAX_INVESTMENT_NOTE_TITLE_CHARS)
  }
  const first = fileNames[0]?.replace(/\.[^.]+$/, "").trim() || "资料"
  return `${first} 等${fileNames.length}份资料`.slice(0, MAX_INVESTMENT_NOTE_TITLE_CHARS)
}

function fallbackContent(extracted: Array<{ name: string; text: string }>): string {
  const sections = extracted.flatMap((item, index) => [
    `<div><b>${index + 1}. ${escapeHtml(item.name)}</b></div>`,
    toNoteHtml(item.text.slice(0, MAX_TEXT_PER_FILE)),
    "<div><br></div>",
  ])
  return compactRichNoteHtml(sections.join(""))
}

async function summarizeWithAi(input: {
  fileNames: string[]
  extracted: Array<{ name: string; text: string }>
}): Promise<{ title: string; content: string }> {
  const chunks: string[] = []
  let used = 0
  for (const item of input.extracted) {
    const remaining = MAX_TOTAL_TEXT - used
    if (remaining <= 200) break
    const text = item.text.slice(0, Math.min(MAX_TEXT_PER_FILE, remaining))
    chunks.push(`【文件：${item.name}】\n${text}`)
    used += text.length
  }

  const model = getChatModel()
  const system = new SystemMessage(
    [
      "你是私募投资研究助手，负责把路演材料、尽调资料、合同或研究报告整理成投资笔记。",
      "要求：",
      "1. 只依据提供的文件内容整理，不要编造文件中没有的事实、数据或结论。",
      "2. 用中文撰写，结构清晰，突出要点、关键数据和风险。",
      "3. 严格输出 JSON：{\"title\":\"笔记标题\",\"content\":\"HTML正文\"}",
      "4. title 简洁，不超过 80 字，可包含管理人、产品或主题。",
      "5. content 使用简单 HTML（div、b、p、ul、li、table），不要使用 markdown，不要用代码块包裹。",
      "6. 若多份文件主题不同，按文件分节；主题相同则合并去重。",
    ].join("\n"),
  )
  const human = new HumanMessage(
    [
      `共 ${input.fileNames.length} 份资料：${input.fileNames.join("、")}`,
      "",
      "【文件内容】",
      chunks.join("\n\n"),
    ].join("\n"),
  )

  const aiResult = await model.invoke([system, human])
  const rawText = stringifyModelContent(aiResult.content)
  const parsed = extractJsonObject(rawText) as { title?: unknown; content?: unknown }
  const title = String(parsed.title ?? "").trim().slice(0, MAX_INVESTMENT_NOTE_TITLE_CHARS)
  const content = toNoteHtml(String(parsed.content ?? ""))
  if (!content.replace(/<[^>]+>/g, "").trim()) {
    throw new Error("AI 未返回可用的笔记正文")
  }
  return {
    title: title || fallbackTitle(input.fileNames),
    content,
  }
}

export async function generateInvestmentNoteFromMaterials(input: {
  materialIds: string[]
  userId: string
  userName: string
  owner: InvestmentNoteKbOwner
}): Promise<GeneratedNoteFromMaterials> {
  const ids = input.materialIds.map((id) => String(id || "").trim()).filter(Boolean)
  if (ids.length === 0) throw new Error("请先选择文件")
  if (ids.length > MAX_MATERIALS) {
    throw new Error(`一次最多根据 ${MAX_MATERIALS} 个文件生成笔记`)
  }

  const materials = getInvestmentNoteMaterialsByIds(ids)
  if (materials.length === 0) throw new Error("未找到所选文件")

  const extracted: Array<{ name: string; text: string }> = []
  const skipped: string[] = []

  for (const material of materials) {
    const file = await readInvestmentNoteMaterialFile(material.id)
    if (!file) {
      skipped.push(`${material.name}（文件缺失）`)
      continue
    }
    try {
      const text = await extractMaterialText(file.buffer, file.filename)
      if (!text.trim()) {
        skipped.push(`${material.name}（无文字内容）`)
        continue
      }
      extracted.push({ name: material.name, text: text.trim() })
    } catch (err) {
      const reason = err instanceof Error ? err.message : "无法提取文字"
      skipped.push(`${material.name}（${reason}）`)
    }
  }

  if (extracted.length === 0) {
    throw new Error(
      skipped.length > 0
        ? `未能从所选文件中读取文字：${skipped.join("；")}`
        : "未能从所选文件中读取文字",
    )
  }

  const fileNames = materials.map((m) => m.name)
  let title = fallbackTitle(fileNames)
  let body = fallbackContent(extracted)
  try {
    const generated = await summarizeWithAi({ fileNames, extracted })
    title = generated.title
    body = generated.content
  } catch (err) {
    console.error("[investment-note-generate] AI summarize failed, using extracted text", err)
  }

  const sourceLines = [
    "<div><b>资料来源</b></div>",
    `<div>${escapeHtml(`本笔记根据 ${extracted.length} 份上传资料自动生成：${extracted.map((item) => item.name).join("、")}`)}</div>`,
  ]
  if (skipped.length > 0) {
    sourceLines.push(`<div>未能提取文字的文件：${escapeHtml(skipped.join("；"))}</div>`)
  }
  sourceLines.push("<div><br></div>")

  const content = compactRichNoteHtml(`${sourceLines.join("")}${body}`)
  if (content.length > MAX_INVESTMENT_NOTE_CONTENT_CHARS) {
    throw new Error("生成的笔记过长，请减少所选文件后再试")
  }

  const note = await createServerInvestmentNoteWithKbSync(
    input.userId,
    input.userName,
    input.owner,
    {
      title,
      content,
      teamShared: true,
    },
  )

  const linked = linkInvestmentNoteMaterials(
    materials.map((m) => m.id),
    note.id,
    input.userId,
  )

  return { note, materials: linked, skipped }
}
