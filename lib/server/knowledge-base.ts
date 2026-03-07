import { promises as fs } from "fs"
import path from "path"
import * as mammoth from "mammoth"
import { PDFParse } from "pdf-parse"
import { CanvasFactory, getData } from "pdf-parse/worker"
import * as XLSX from "xlsx"
import { getServerStoragePath } from "@/lib/server/storage"

PDFParse.setWorker(getData())

export type KnowledgeBaseDocumentNode = {
  name: string
  relativePath: string
  extension: string
  size: number
  updatedAt: string
  ownerId: string | null
  ownerName: string
  uploadedAt: string | null
  canPreview: boolean
  canChat: boolean
  canDelete: boolean
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

export type KnowledgeBaseFileOwner = {
  ownerId: string
  ownerName: string
  ownerEmail?: string
}

type KnowledgeBaseOwnershipRecord = {
  relativePath: string
  ownerId: string
  ownerName: string
  ownerEmail?: string
  uploadedAt: string
}

const DEFAULT_STORAGE_ROOT = getServerStoragePath("ai-knowledge-base")
const OWNERSHIP_STORAGE_DIR = getServerStoragePath("ai-knowledge-base-metadata")
const OWNERSHIP_FILE = path.join(OWNERSHIP_STORAGE_DIR, "file-owners.json")

const TEXT_PREVIEW_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".log", ".tsv", ".xml"])
const IMAGE_PREVIEW_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"])
const FRAME_PREVIEW_EXTENSIONS = new Set([".html", ".htm", ".pdf"])
const CHAT_EXTENSIONS = new Set([...TEXT_PREVIEW_EXTENSIONS, ".html", ".htm", ".pdf", ".docx", ".xlsx", ".xls"])
const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024

const MIME_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml; charset=utf-8",
}

export function getKnowledgeBaseStorageRoot() {
  return path.resolve(process.env.AI_KB_STORAGE_DIR || DEFAULT_STORAGE_ROOT)
}

export function getKnowledgeBaseStorageDisplayPath() {
  return process.env.AI_KB_STORAGE_DIR?.trim() || "服务器部署时由 AI_KB_STORAGE_DIR 指定"
}

async function ensureKnowledgeBaseMetadataStorage() {
  await fs.mkdir(OWNERSHIP_STORAGE_DIR, { recursive: true })
}

async function readOwnershipRecords() {
  await ensureKnowledgeBaseMetadataStorage()
  try {
    const raw = await fs.readFile(OWNERSHIP_FILE, "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as KnowledgeBaseOwnershipRecord[]) : []
  } catch {
    return []
  }
}

async function writeOwnershipRecords(records: KnowledgeBaseOwnershipRecord[]) {
  await ensureKnowledgeBaseMetadataStorage()
  await fs.writeFile(OWNERSHIP_FILE, JSON.stringify(records, null, 2), "utf8")
}

async function getOwnershipMap() {
  const records = await readOwnershipRecords()
  return new Map(records.map((record) => [record.relativePath, record]))
}

async function setKnowledgeBaseFileOwner(relativePath: string, owner: KnowledgeBaseFileOwner) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  const records = await readOwnershipRecords()
  const uploadedAt = new Date().toISOString()
  const nextRecord: KnowledgeBaseOwnershipRecord = {
    relativePath: normalizedPath,
    ownerId: owner.ownerId,
    ownerName: owner.ownerName,
    ownerEmail: owner.ownerEmail,
    uploadedAt,
  }
  const next = records.filter((record) => record.relativePath !== normalizedPath)
  next.push(nextRecord)
  next.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
  await writeOwnershipRecords(next)
  return nextRecord
}

async function removeKnowledgeBaseFileOwner(relativePath: string) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  const records = await readOwnershipRecords()
  const next = records.filter((record) => record.relativePath !== normalizedPath)
  await writeOwnershipRecords(next)
}

function buildKnowledgeBaseDocumentNode(
  input: {
    name: string
    relativePath: string
    size: number
    updatedAt: string
  },
  ownershipMap: Map<string, KnowledgeBaseOwnershipRecord>,
  viewerUserId?: string,
): KnowledgeBaseDocumentNode {
  const extension = getExtension(input.name)
  const ownership = ownershipMap.get(input.relativePath)

  return {
    name: input.name,
    relativePath: input.relativePath,
    extension,
    size: input.size,
    updatedAt: input.updatedAt,
    ownerId: ownership?.ownerId || null,
    ownerName: ownership?.ownerName || "未知",
    uploadedAt: ownership?.uploadedAt || null,
    canPreview: isKnowledgeBasePreviewable(extension),
    canChat: isKnowledgeBaseChatSupported(extension),
    canDelete: Boolean(viewerUserId && ownership?.ownerId && ownership.ownerId === viewerUserId),
  }
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

export function isKnowledgeBaseImagePreview(extension: string) {
  return IMAGE_PREVIEW_EXTENSIONS.has(extension)
}

export function isKnowledgeBaseFramePreview(extension: string) {
  return FRAME_PREVIEW_EXTENSIONS.has(extension)
}

export function isKnowledgeBasePreviewable(extension: string) {
  return isKnowledgeBaseTextPreview(extension) || isKnowledgeBaseImagePreview(extension) || isKnowledgeBaseFramePreview(extension)
}

export function isKnowledgeBaseChatSupported(extension: string) {
  return CHAT_EXTENSIONS.has(extension)
}

export function getKnowledgeBaseMimeType(fileName: string) {
  return MIME_TYPES[getExtension(fileName)] || "application/octet-stream"
}

async function buildFolderTree(
  absoluteDir: string,
  relativeDir: string,
  ownershipMap: Map<string, KnowledgeBaseOwnershipRecord>,
  viewerUserId?: string,
): Promise<KnowledgeBaseFolderNode> {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true })

  const folders: KnowledgeBaseFolderNode[] = []
  const documents: KnowledgeBaseDocumentNode[] = []

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name)
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      folders.push(await buildFolderTree(absolutePath, relativePath, ownershipMap, viewerUserId))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const stat = await fs.stat(absolutePath)
    documents.push(
      buildKnowledgeBaseDocumentNode(
        {
          name: entry.name,
          relativePath,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        },
        ownershipMap,
        viewerUserId,
      ),
    )
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

export async function listKnowledgeBaseTree(viewerUserId?: string) {
  const root = await ensureKnowledgeBaseStorage()
  const ownershipMap = await getOwnershipMap()
  return buildFolderTree(root, "", ownershipMap, viewerUserId)
}

export async function createKnowledgeBaseFolder(relativePath: string) {
  const { target, normalized } = await resolveKnowledgeBasePath(relativePath)
  await fs.mkdir(target, { recursive: true })
  return {
    relativePath: normalized,
    name: normalized ? path.basename(normalized) : "全部资料",
  }
}

export async function saveKnowledgeBaseFile(folderPath: string, file: File, owner?: KnowledgeBaseFileOwner) {
  const safeName = sanitizeFileName(file.name || "document")
  const { target: folderAbsolutePath, normalized } = await resolveKnowledgeBasePath(folderPath)
  await fs.mkdir(folderAbsolutePath, { recursive: true })

  const absolutePath = path.join(folderAbsolutePath, safeName)
  assertInsideRoot(await ensureKnowledgeBaseStorage(), absolutePath)

  const buffer = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(absolutePath, buffer)

  const stat = await fs.stat(absolutePath)
  const relativePath = normalized ? `${normalized}/${safeName}` : safeName
  const ownership = owner ? await setKnowledgeBaseFileOwner(relativePath, owner) : null

  return buildKnowledgeBaseDocumentNode(
    {
      name: safeName,
      relativePath,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    },
    new Map(
      ownership
        ? [
            [
              relativePath,
              ownership,
            ],
          ]
        : [],
    ),
    owner?.ownerId,
  )
}

export async function saveKnowledgeBaseFileWithRelativePath(
  folderPath: string,
  relativeFilePath: string,
  file: File,
  owner?: KnowledgeBaseFileOwner,
) {
  const normalizedRelativeFilePath = normalizeKnowledgeBasePath(relativeFilePath)
  const segments = normalizedRelativeFilePath.split("/").filter(Boolean)

  if (!segments.length) {
    throw new Error("文件路径不合法")
  }

  const safeName = sanitizeFileName(segments[segments.length - 1] || file.name || "document")
  const nestedFolder = segments.slice(0, -1).join("/")
  const targetFolder = [folderPath, nestedFolder].filter(Boolean).join("/")

  const { target: folderAbsolutePath, normalized } = await resolveKnowledgeBasePath(targetFolder)
  await fs.mkdir(folderAbsolutePath, { recursive: true })

  const absolutePath = path.join(folderAbsolutePath, safeName)
  assertInsideRoot(await ensureKnowledgeBaseStorage(), absolutePath)

  const buffer = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(absolutePath, buffer)

  const stat = await fs.stat(absolutePath)
  const relativePath = normalized ? `${normalized}/${safeName}` : safeName
  const ownership = owner ? await setKnowledgeBaseFileOwner(relativePath, owner) : null

  return buildKnowledgeBaseDocumentNode(
    {
      name: safeName,
      relativePath,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    },
    new Map(
      ownership
        ? [
            [
              relativePath,
              ownership,
            ],
          ]
        : [],
    ),
    owner?.ownerId,
  )
}

async function removeEmptyKnowledgeBaseDirectories(relativePath: string) {
  const normalized = normalizeKnowledgeBasePath(relativePath)
  if (!normalized) {
    return
  }

  const root = await ensureKnowledgeBaseStorage()
  const segments = normalized.split("/")

  while (segments.length > 0) {
    const currentPath = path.join(root, ...segments)
    const entries = await fs.readdir(currentPath).catch(() => [])
    if (entries.length > 0) {
      break
    }
    await fs.rmdir(currentPath).catch(() => undefined)
    segments.pop()
  }
}

export async function deleteKnowledgeBaseFile(relativePath: string, actorUserId: string) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  if (!normalizedPath) {
    throw new Error("缺少文件路径")
  }
  if (!actorUserId) {
    throw new Error("缺少用户信息")
  }

  const ownershipMap = await getOwnershipMap()
  const ownership = ownershipMap.get(normalizedPath)
  if (!ownership) {
    throw new Error("文件缺少归属信息，无法删除")
  }
  if (ownership.ownerId !== actorUserId) {
    throw new Error("只有上传者可以删除该文件")
  }

  const { target } = await resolveKnowledgeBasePath(normalizedPath)
  const stat = await fs.stat(target)
  if (!stat.isFile()) {
    throw new Error("目标不是文件")
  }

  await fs.unlink(target)
  await removeKnowledgeBaseFileOwner(normalizedPath)
  await removeEmptyKnowledgeBaseDirectories(path.posix.dirname(normalizedPath) === "." ? "" : path.posix.dirname(normalizedPath))
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
    const parser = new PDFParse({ data: buffer, CanvasFactory })
    try {
      const parsed = await parser.getText()
      return parsed.text.replace(/\s+/g, " ").trim()
    } finally {
      await parser.destroy().catch(() => undefined)
    }
  }

  if (extension === ".docx") {
    const buffer = await fs.readFile(absolutePath)
    const parsed = await mammoth.extractRawText({ buffer })
    return parsed.value.replace(/\s+/g, " ").trim()
  }

  if (extension === ".xlsx" || extension === ".xls") {
    const workbook = XLSX.read(await fs.readFile(absolutePath), { type: "buffer" })
    const sheetTexts = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName]
      const csv = XLSX.utils.sheet_to_csv(worksheet)
      return `Sheet: ${sheetName}\n${csv}`.trim()
    }).filter(Boolean)

    return sheetTexts.join("\n\n").replace(/\s+/g, " ").trim()
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