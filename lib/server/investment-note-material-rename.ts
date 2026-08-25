import { promises as fs } from "fs"
import path from "path"
import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import {
  cleanMaterialDisplayName,
  materialExtension,
  materialNameFromExtractedText,
  materialNameFromNoteTitle,
  needsContentBasedMaterialRename,
} from "@/lib/ma/investment-note-material-filename"
import { readFileDocumentText } from "@/lib/server/knowledge-base"
import { readPdfTextWithCmaps } from "@/lib/server/pdf-text"
import { getServerStoragePath } from "@/lib/server/storage"

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"])
const TEXT_EXTENSIONS = new Set([".txt", ".csv"])
const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".xls", ".xlsx"])
const MAX_RENAME_FILE_BYTES = 20 * 1024 * 1024
const MAX_TEXT_FOR_TITLE = 4_000

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

function dashScopeApiKey(): string | null {
  return process.env.DASHSCOPE_API_KEY?.trim() || null
}

function dashScopeBaseUrl(): string {
  return process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
}

function mimeTypeForImageExt(ext: string): string {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  }
  return map[ext] || "application/octet-stream"
}

async function suggestNameFromImage(buffer: Buffer, ext: string): Promise<string | null> {
  const apiKey = dashScopeApiKey()
  if (!apiKey) return null
  if (buffer.byteLength > MAX_RENAME_FILE_BYTES) return null

  const res = await fetch(`${dashScopeBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.DASHSCOPE_VISION_MODEL || "qwen-vl-plus",
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mimeTypeForImageExt(ext)};base64,${buffer.toString("base64")}` },
            },
            {
              type: "text",
              text: [
                "这是一份投资研究资料截图或扫描件。",
                "请用不超过 40 个字的中文概括它的主题，作为文件名。",
                "优先包含机构/产品/材料类型（如路演、一页通、合同、纪要）。",
                "只输出文件名本身，不要扩展名、引号或解释。",
              ].join(""),
            },
          ],
        },
      ],
    }),
  })
  if (!res.ok) return null
  const parsed = await res.json().catch(() => null)
  const text = stringifyModelContent(parsed?.choices?.[0]?.message?.content)
  return materialNameFromExtractedText(text, ext)
}

async function extractDocumentText(buffer: Buffer, fileName: string): Promise<string> {
  const ext = materialExtension(fileName)
  if (TEXT_EXTENSIONS.has(ext)) {
    return buffer.toString("utf8").replace(/\u0000/g, "").trim()
  }
  if (ext === ".pdf") {
    return (await readPdfTextWithCmaps(buffer)).trim()
  }
  if (!OFFICE_EXTENSIONS.has(ext)) return ""

  const tempDir = getServerStoragePath("investment-notes", "rename-tmp")
  await fs.mkdir(tempDir, { recursive: true })
  const tempPath = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
  try {
    await fs.writeFile(tempPath, buffer)
    return (await readFileDocumentText(tempPath, ext)).trim()
  } finally {
    await fs.unlink(tempPath).catch(() => undefined)
  }
}

async function suggestNameFromDocumentText(text: string, ext: string): Promise<string | null> {
  const heuristic = materialNameFromExtractedText(text, ext)
  if (heuristic) return heuristic

  const apiKey = dashScopeApiKey()
  const clipped = text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_FOR_TITLE)
  if (!apiKey || clipped.length < 8) return null

  const model = new ChatOpenAI({
    apiKey,
    model: process.env.DASHSCOPE_ANALYSIS_MODEL || process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus",
    temperature: 0,
    streaming: false,
    configuration: { baseURL: dashScopeBaseUrl() },
  })
  const result = await model.invoke([
    new SystemMessage(
      "你为投资研究资料生成简短中文文件名。只输出文件名，不要扩展名、引号或解释。不超过 40 字，可包含机构、产品或材料类型。",
    ),
    new HumanMessage(clipped),
  ])
  return materialNameFromExtractedText(stringifyModelContent(result.content), ext)
}

export async function resolveInvestmentNoteMaterialDisplayName(input: {
  originalName: string
  ext: string
  buffer: Buffer
  noteTitle?: string | null
}): Promise<{ name: string; resolved: boolean }> {
  const cleaned = cleanMaterialDisplayName(input.originalName || "material.bin", input.ext)
  if (!needsContentBasedMaterialRename(cleaned)) {
    return { name: cleaned, resolved: true }
  }

  try {
    if (IMAGE_EXTENSIONS.has(input.ext) && input.buffer.byteLength <= MAX_RENAME_FILE_BYTES) {
      const fromImage = await suggestNameFromImage(input.buffer, input.ext)
      if (fromImage) return { name: fromImage, resolved: true }
    } else if (input.buffer.byteLength <= MAX_RENAME_FILE_BYTES) {
      const text = await extractDocumentText(input.buffer, cleaned)
      const fromText = text ? await suggestNameFromDocumentText(text, input.ext) : null
      if (fromText) return { name: fromText, resolved: true }
    }
  } catch (err) {
    console.error("[investment-note-material-rename] content name failed", err)
  }

  const fromNote = materialNameFromNoteTitle(input.noteTitle || "", input.ext)
  if (fromNote) return { name: fromNote, resolved: true }

  return { name: cleaned, resolved: true }
}
