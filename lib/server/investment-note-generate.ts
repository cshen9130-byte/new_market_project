import path from "path"
import mammoth from "mammoth"
import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import {
  compactRichNoteHtml,
  MAX_INVESTMENT_NOTE_CONTENT_CHARS,
  MAX_INVESTMENT_NOTE_TITLE_CHARS,
  type InvestmentNote,
  type InvestmentNoteAssociation,
  type InvestmentNoteExtractedProduct,
  type InvestmentNoteRoadshowAssociation,
} from "@/lib/ma/investment-notes"
import { readFundContractText } from "@/lib/server/fund-contract-element-extract"
import { resolveExtractedProductCandidates } from "@/lib/server/investment-note-extracted-products"
import { extractPptxText, isPptxOpenXmlExtension } from "@/lib/server/pptx-text"
import { readPdfTextWithCmaps } from "@/lib/server/pdf-text"
import {
  linkInvestmentNoteMaterials,
  readInvestmentNoteMaterialFile,
  resolveInvestmentNoteMaterials,
  type InvestmentNoteMaterial,
} from "@/lib/server/investment-note-materials"
import {
  createServerInvestmentNoteWithKbSync,
  type CreateServerInvestmentNoteOptions,
} from "@/lib/server/investment-notes"
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
  ".pptx",
  ".pptm",
  ".ppsx",
  ".ppsm",
  ".potx",
  ".potm",
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
  if (isPptxOpenXmlExtension(ext)) {
    return extractPptxText(buffer)
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
  roadshowPlainText?: string
}): Promise<{ title: string; content: string; products: Array<{ name: string; recordNo: string }> }> {
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
      "1. 只依据提供的文件内容和路演信息整理，不要编造其中没有的事实、数据或结论。",
      "2. 用中文撰写，结构清晰，突出要点、关键数据和风险。",
      "3. 严格输出 JSON：{\"title\":\"笔记标题\",\"content\":\"HTML正文\",\"products\":[{\"name\":\"产品全称\",\"recordNo\":\"备案号\"}]}",
      "4. title 简洁，不超过 80 字，可包含管理人、产品或主题。",
      "5. content 使用简单 HTML（div、b、p、ul、li、table），不要使用 markdown，不要用代码块包裹。",
      "6. 若多份文件主题不同，按文件分节；主题相同则合并去重。",
      "7. 若提供了路演信息，把它作为背景写入笔记（日期、对象、策略等），不要重复成空表格。",
      "8. products 列出文件中明确出现的基金产品。name 用全称；备案号未知则 recordNo 为空字符串。没有产品则 []。不要编造产品。",
    ].join("\n"),
  )
  const human = new HumanMessage(
    [
      `共 ${input.fileNames.length} 份资料：${input.fileNames.join("、")}`,
      input.roadshowPlainText?.trim() ? `\n【路演信息】\n${input.roadshowPlainText.trim()}` : "",
      "",
      "【文件内容】",
      chunks.join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n"),
  )

  const aiResult = await model.invoke([system, human])
  const rawText = stringifyModelContent(aiResult.content)
  const parsed = extractJsonObject(rawText) as {
    title?: unknown
    content?: unknown
    products?: unknown
  }
  const title = String(parsed.title ?? "").trim().slice(0, MAX_INVESTMENT_NOTE_TITLE_CHARS)
  const content = toNoteHtml(String(parsed.content ?? ""))
  if (!content.replace(/<[^>]+>/g, "").trim()) {
    throw new Error("AI 未返回可用的笔记正文")
  }
  return {
    title: title || fallbackTitle(input.fileNames),
    content,
    products: parseAiProducts(parsed.products),
  }
}

function parseAiProducts(value: unknown): Array<{ name: string; recordNo: string }> {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: Array<{ name: string; recordNo: string }> = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const row = item as { name?: unknown; recordNo?: unknown; register_number?: unknown }
    const name = String(row.name ?? "").trim()
    const recordNo = String(row.recordNo ?? row.register_number ?? "").trim()
    if (!name && !recordNo) continue
    const key = `${recordNo.toUpperCase()}::${name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: name || recordNo, recordNo })
  }
  return out
}

function stripOuterHtmlDocument(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<\/?(?:html|body)[^>]*>/gi, "")
    .trim()
}

/** Convert a DD-material / upload file into note HTML (Word keeps formatting). */
export async function convertFileBufferToNoteHtml(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const ext = getExtension(fileName)
  if (ext === ".html" || ext === ".htm") {
    const html = compactRichNoteHtml(stripOuterHtmlDocument(buffer.toString("utf8")))
    if (html.replace(/<[^>]+>/g, "").trim()) return html
  }
  if (ext === ".docx" || ext === ".doc") {
    try {
      const parsed = await mammoth.convertToHtml({ buffer })
      const html = compactRichNoteHtml(stripOuterHtmlDocument(parsed.value || ""))
      if (html.replace(/<[^>]+>/g, "").trim()) return html
    } catch {
      // fall through to text extraction
    }
  }
  const text = await extractMaterialText(buffer, fileName)
  return toNoteHtml(text)
}

export type ComposedNoteFromFiles = {
  title: string
  body: string
  extractedNames: string[]
  skipped: string[]
}

export async function composeInvestmentNoteFromFileBuffers(input: {
  files: Array<{ name: string; buffer: Buffer }>
  roadshowPlainText?: string
  fallbackTitle?: string
}): Promise<ComposedNoteFromFiles> {
  const extracted: Array<{ name: string; text: string }> = []
  const skipped: string[] = []

  for (const file of input.files) {
    try {
      const text = await extractMaterialText(file.buffer, file.name)
      if (!text.trim()) {
        skipped.push(`${file.name}（无文字内容）`)
        continue
      }
      extracted.push({ name: file.name, text: text.trim() })
    } catch (err) {
      const reason = err instanceof Error ? err.message : "无法提取文字"
      skipped.push(`${file.name}（${reason}）`)
    }
  }

  if (extracted.length === 0) {
    return {
      title: (input.fallbackTitle || "资料笔记").slice(0, MAX_INVESTMENT_NOTE_TITLE_CHARS),
      body: "",
      extractedNames: [],
      skipped,
    }
  }

  const fileNames = input.files.map((item) => item.name)
  let title = input.fallbackTitle?.trim() || fallbackTitle(fileNames)
  let body = fallbackContent(extracted)
  try {
    const generated = await summarizeWithAi({
      fileNames,
      extracted,
      roadshowPlainText: input.roadshowPlainText,
    })
    title = generated.title
    body = generated.content
  } catch (err) {
    console.error("[investment-note-generate] AI summarize failed, using extracted text", err)
  }

  return {
    title: title.slice(0, MAX_INVESTMENT_NOTE_TITLE_CHARS),
    body,
    extractedNames: extracted.map((item) => item.name),
    skipped,
  }
}

export async function generateInvestmentNoteFromMaterials(input: {
  materialIds: string[]
  userId: string
  userName: string
  owner: InvestmentNoteKbOwner
  roadshowAssociations?: InvestmentNoteRoadshowAssociation[]
  associations?: InvestmentNoteAssociation[]
  roadshowPlainText?: string
  fallbackTitle?: string
  createOptions?: CreateServerInvestmentNoteOptions
}): Promise<GeneratedNoteFromMaterials> {
  const ids = input.materialIds.map((id) => String(id || "").trim()).filter(Boolean)
  if (ids.length === 0) throw new Error("请先选择文件")
  if (ids.length > MAX_MATERIALS) {
    throw new Error(`一次最多根据 ${MAX_MATERIALS} 个文件生成笔记`)
  }

  const materials = await resolveInvestmentNoteMaterials(ids, input.userId)
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
  let title = input.fallbackTitle?.trim() || fallbackTitle(fileNames)
  let body = fallbackContent(extracted)
  let aiProducts: Array<{ name: string; recordNo: string }> = []
  try {
    const generated = await summarizeWithAi({
      fileNames,
      extracted,
      roadshowPlainText: input.roadshowPlainText,
    })
    title = generated.title
    body = generated.content
    aiProducts = generated.products
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

  let extractedProducts: InvestmentNoteExtractedProduct[] = []
  if (aiProducts.length > 0) {
    try {
      extractedProducts = await resolveExtractedProductCandidates(
        aiProducts,
        extracted.map((item) => item.name).join("、"),
      )
    } catch (err) {
      console.error("[investment-note-generate] resolve extracted products failed", err)
      extractedProducts = aiProducts.map((item) => ({
        name: item.name,
        recordNo: item.recordNo,
        sourceFile: extracted.map((file) => file.name).join("、"),
        confidence: "extracted" as const,
      }))
    }
  }

  const note = await createServerInvestmentNoteWithKbSync(
    input.userId,
    input.userName,
    input.owner,
    {
      title,
      content,
      teamShared: true,
      ...(input.roadshowAssociations ? { roadshowAssociations: input.roadshowAssociations } : {}),
      ...(input.associations ? { associations: input.associations } : {}),
      ...(extractedProducts.length ? { extractedProducts } : {}),
    },
    input.createOptions,
  )

  const storedIds = materials
    .filter((item) => item.source !== "dd-table")
    .map((item) => item.id)
  const linked = linkInvestmentNoteMaterials(storedIds, note.id, input.userId)
  const byId = new Map(linked.map((item) => [item.id, item]))
  const nextMaterials = materials.map((item) => byId.get(item.id) ?? item)

  return { note, materials: nextMaterials, skipped }
}
