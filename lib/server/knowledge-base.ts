import { promises as fs } from "fs"
import path from "path"
import { PDFParse } from "pdf-parse"
import { getServerStoragePath } from "@/lib/server/storage"

export type KnowledgeBaseDocumentNode = {
  name: string
  relativePath: string
  extension: string
  size: number
  updatedAt: string
  canPreview: boolean
  canChat: boolean
}

export type KnowledgeBaseFolderNode = {
  name: string
  relativePath: string
  folders: KnowledgeBaseFolderNode[]
  documents: KnowledgeBaseDocumentNode[]
}

export type KnowledgeBaseChatDocument = {
  relativePath: string
  text: string
  size: number
  updatedAt: string
}

const DEFAULT_STORAGE_ROOT = getServerStoragePath("ai-knowledge-base")

const TEXT_PREVIEW_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".log"])
const FRAME_PREVIEW_EXTENSIONS = new Set([".html", ".htm", ".pdf"])
const CHAT_EXTENSIONS = new Set([...TEXT_PREVIEW_EXTENSIONS, ".html", ".htm", ".pdf"])
const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024

const MIME_TYPES: Record<string, string> = {
  ".csv": "text/csv; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
}

export function getKnowledgeBaseStorageRoot() {
  return path.resolve(process.env.AI_KB_STORAGE_DIR || DEFAULT_STORAGE_ROOT)
}

export function getKnowledgeBaseStorageDisplayPath() {
  return process.env.AI_KB_STORAGE_DIR?.trim() || "服务器部署时由 AI_KB_STORAGE_DIR 指定"
}

export async function ensureKnowledgeBaseStorage() {
  const root = getKnowledgeBaseStorageRoot()
  await fs.mkdir(root, { recursive: true })
  return root
}

export function normalizeKnowledgeBasePath(input?: string | null) {
  if (!input) return ""

  const normalized = input
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)

  for (const segment of normalized) {
    if (segment === "." || segment === "..") {
      throw new Error("路径不合法")
    }
  }

  return normalized.join("/")
}

function assertInsideRoot(root: string, target: string) {
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("路径超出知识库目录")
  }
}

async function resolveKnowledgeBasePath(relativePath = "") {
  const root = await ensureKnowledgeBaseStorage()
  const normalized = normalizeKnowledgeBasePath(relativePath)
  const target = normalized ? path.join(root, ...normalized.split("/")) : root
  assertInsideRoot(root, target)
  return { root, normalized, target }
}

function sanitizeFileName(fileName: string) {
  const baseName = path.basename(fileName || "document")
  const cleaned = baseName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim()
  if (!cleaned) {
    throw new Error("文件名不合法")
  }
  return cleaned
}

function getExtension(fileName: string) {
  return path.extname(fileName).toLowerCase()
}

export function isKnowledgeBaseTextPreview(extension: string) {
  return TEXT_PREVIEW_EXTENSIONS.has(extension)
}

export function isKnowledgeBaseFramePreview(extension: string) {
  return FRAME_PREVIEW_EXTENSIONS.has(extension)
}

export function isKnowledgeBasePreviewable(extension: string) {
  return isKnowledgeBaseTextPreview(extension) || isKnowledgeBaseFramePreview(extension)
}

export function isKnowledgeBaseChatSupported(extension: string) {
  return CHAT_EXTENSIONS.has(extension)
}

export function getKnowledgeBaseMimeType(fileName: string) {
  return MIME_TYPES[getExtension(fileName)] || "application/octet-stream"
}

async function buildFolderTree(absoluteDir: string, relativeDir: string): Promise<KnowledgeBaseFolderNode> {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true })

  const folders: KnowledgeBaseFolderNode[] = []
  const documents: KnowledgeBaseDocumentNode[] = []

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name)
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      folders.push(await buildFolderTree(absolutePath, relativePath))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const extension = getExtension(entry.name)
    const stat = await fs.stat(absolutePath)
    documents.push({
      name: entry.name,
      relativePath,
      extension,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      canPreview: isKnowledgeBasePreviewable(extension),
      canChat: isKnowledgeBaseChatSupported(extension),
    })
  }

  folders.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
  documents.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))

  return {
    name: relativeDir ? path.basename(relativeDir) : "全部资料",
    relativePath: relativeDir,
    folders,
    documents,
  }
}

export async function listKnowledgeBaseTree() {
  const root = await ensureKnowledgeBaseStorage()
  return buildFolderTree(root, "")
}

export async function createKnowledgeBaseFolder(relativePath: string) {
  const { target, normalized } = await resolveKnowledgeBasePath(relativePath)
  await fs.mkdir(target, { recursive: true })
  return {
    relativePath: normalized,
    name: normalized ? path.basename(normalized) : "全部资料",
  }
}

export async function saveKnowledgeBaseFile(folderPath: string, file: File) {
  const safeName = sanitizeFileName(file.name || "document")
  const { target: folderAbsolutePath, normalized } = await resolveKnowledgeBasePath(folderPath)
  await fs.mkdir(folderAbsolutePath, { recursive: true })

  const absolutePath = path.join(folderAbsolutePath, safeName)
  assertInsideRoot(await ensureKnowledgeBaseStorage(), absolutePath)

  const buffer = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(absolutePath, buffer)

  const stat = await fs.stat(absolutePath)
  const relativePath = normalized ? `${normalized}/${safeName}` : safeName
  const extension = getExtension(safeName)

  return {
    name: safeName,
    relativePath,
    extension,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    canPreview: isKnowledgeBasePreviewable(extension),
    canChat: isKnowledgeBaseChatSupported(extension),
  }
}

export async function getKnowledgeBaseFile(relativePath: string) {
  const { target, normalized } = await resolveKnowledgeBasePath(relativePath)
  const stat = await fs.stat(target)
  if (!stat.isFile()) {
    throw new Error("目标不是文件")
  }

  return {
    absolutePath: target,
    relativePath: normalized,
    name: path.basename(target),
    extension: getExtension(target),
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    mimeType: getKnowledgeBaseMimeType(target),
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

async function readChatDocumentText(absolutePath: string, extension: string) {
  if (extension === ".pdf") {
    const buffer = await fs.readFile(absolutePath)
    const parser = new PDFParse({ data: buffer })
    try {
      const parsed = await parser.getText()
      return parsed.text.replace(/\s+/g, " ").trim()
    } finally {
      await parser.destroy().catch(() => undefined)
    }
  }

  const raw = await fs.readFile(absolutePath, "utf8")

  if (extension === ".json") {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      return raw
    }
  }

  if (extension === ".html" || extension === ".htm") {
    return stripHtml(raw)
  }

  return raw
}

async function collectChatDocumentsInDirectory(
  absoluteDir: string,
  relativeDir: string,
  documents: KnowledgeBaseChatDocument[],
) {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name)
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      await collectChatDocumentsInDirectory(absolutePath, relativePath, documents)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const extension = getExtension(entry.name)
    if (!isKnowledgeBaseChatSupported(extension)) {
      continue
    }

    const stat = await fs.stat(absolutePath)
    if (stat.size > MAX_CHAT_FILE_BYTES) {
      continue
    }

    const text = await readChatDocumentText(absolutePath, extension)
    if (!text.trim()) {
      continue
    }

    documents.push({
      relativePath,
      text,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    })
  }
}

export async function collectKnowledgeBaseDocuments(folderPath = "") {
  const { target } = await resolveKnowledgeBasePath(folderPath)
  const stat = await fs.stat(target)
  if (!stat.isDirectory()) {
    throw new Error("请选择有效的文件夹")
  }

  const documents: KnowledgeBaseChatDocument[] = []
  await collectChatDocumentsInDirectory(target, normalizeKnowledgeBasePath(folderPath), documents)
  documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
  return documents
}