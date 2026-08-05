import AdmZip from "adm-zip"
import { execFile } from "child_process"
import { createHash } from "crypto"
import { createReadStream, promises as fs } from "fs"
import os from "os"
import path from "path"
import { promisify } from "util"
import * as mammoth from "mammoth"
import { PDFParse } from "pdf-parse"
import { CanvasFactory, getData } from "pdf-parse/worker"
import WordExtractor from "word-extractor"
import * as XLSX from "xlsx"
import { getServerStoragePath } from "@/lib/server/storage"

const execFileAsync = promisify(execFile)

/** Race a promise against a timeout; rejects with an Error on timeout. */
function withExtractTimeout<T>(promise: Promise<T>, ms = 20_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`文件解析超时 (${ms / 1000}s)`)), ms)),
  ])
}

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
  locked: boolean
  canLock: boolean
}

export type KnowledgeBaseFolderNode = {
  name: string
  relativePath: string
  size: number
  ownerId: string | null
  ownerName: string
  uploadedAt: string | null
  canDelete: boolean
  locked: boolean
  canLock: boolean
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

export type KnowledgeBaseOwnershipRecord = {
  relativePath: string
  entryType?: "file" | "folder"
  ownerId: string
  ownerName: string
  ownerEmail?: string
  uploadedAt: string
  locked?: boolean
}

const DEFAULT_STORAGE_ROOT = getServerStoragePath("ai-knowledge-base")
const OWNERSHIP_STORAGE_DIR = getServerStoragePath("ai-knowledge-base-metadata")
const OWNERSHIP_FILE = path.join(OWNERSHIP_STORAGE_DIR, "file-owners.json")
const OWNERSHIP_BACKUP_COUNT = 12

const TEXT_PREVIEW_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".log", ".tsv", ".xml", ".doc", ".docx", ".xls", ".xlsx"])
const EDITABLE_TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".log", ".tsv", ".xml", ".docx"])
const IMAGE_PREVIEW_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"])
const FRAME_PREVIEW_EXTENSIONS = new Set([".html", ".htm", ".pdf"])
const CHAT_EXTENSIONS = new Set([...TEXT_PREVIEW_EXTENSIONS, ".html", ".htm", ".pdf"])
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

const OWNERSHIP_LOCK_FILE = `${OWNERSHIP_FILE}.lock`
const OWNERSHIP_LOCK_STALE_MS = 30_000
const OWNERSHIP_LOCK_TIMEOUT_MS = 15_000

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

async function rotateOwnershipBackups() {
  try {
    await fs.access(OWNERSHIP_FILE)
  } catch {
    return
  }

  await fs.unlink(`${OWNERSHIP_FILE}.bak.${OWNERSHIP_BACKUP_COUNT}`).catch(() => {})
  for (let index = OWNERSHIP_BACKUP_COUNT - 1; index >= 1; index -= 1) {
    const from = `${OWNERSHIP_FILE}.bak.${index}`
    const to = `${OWNERSHIP_FILE}.bak.${index + 1}`
    try {
      await fs.rename(from, to)
    } catch {
      // missing older backup slots are fine
    }
  }
  try {
    await fs.rename(`${OWNERSHIP_FILE}.bak`, `${OWNERSHIP_FILE}.bak.1`)
  } catch {
    // no prior .bak yet
  }

  try {
    await fs.copyFile(OWNERSHIP_FILE, `${OWNERSHIP_FILE}.bak`)
  } catch {
    // best-effort backup before mutating
  }
}

async function writeOwnershipRecords(records: KnowledgeBaseOwnershipRecord[]) {
  await ensureKnowledgeBaseMetadataStorage()
  await rotateOwnershipBackups()
  // Atomic replace so PM2 cluster workers never observe a truncated/partial JSON file.
  const tmp = `${OWNERSHIP_FILE}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(records, null, 2), "utf8")
  try {
    await fs.rename(tmp, OWNERSHIP_FILE)
  } catch {
    // Windows cannot rename over an existing file; fall back to replace.
    await fs.copyFile(tmp, OWNERSHIP_FILE)
    await fs.unlink(tmp).catch(() => {})
  }
}

export function getKnowledgeBaseOwnershipFilePath() {
  return OWNERSHIP_FILE
}

export function getKnowledgeBaseOwnershipStorageDir() {
  return OWNERSHIP_STORAGE_DIR
}

export async function readKnowledgeBaseOwnershipRecords() {
  return readOwnershipRecords()
}

export async function replaceKnowledgeBaseOwnershipRecords(records: KnowledgeBaseOwnershipRecord[]) {
  return withOwnershipLock(async () => {
    await writeOwnershipRecords(records)
  })
}

async function acquireOwnershipFileLock(): Promise<() => Promise<void>> {
  await ensureKnowledgeBaseMetadataStorage()
  const startedAt = Date.now()

  while (true) {
    try {
      const handle = await fs.open(OWNERSHIP_LOCK_FILE, "wx")
      await handle.writeFile(`${process.pid}:${Date.now()}`, "utf8")
      return async () => {
        await handle.close().catch(() => {})
        await fs.unlink(OWNERSHIP_LOCK_FILE).catch(() => {})
      }
    } catch (error: any) {
      if (error?.code !== "EEXIST") {
        throw error
      }

      try {
        const stat = await fs.stat(OWNERSHIP_LOCK_FILE)
        if (Date.now() - stat.mtimeMs > OWNERSHIP_LOCK_STALE_MS) {
          await fs.unlink(OWNERSHIP_LOCK_FILE).catch(() => {})
          continue
        }
      } catch {
        // Lock disappeared between EEXIST and stat — retry acquire.
      }

      if (Date.now() - startedAt > OWNERSHIP_LOCK_TIMEOUT_MS) {
        throw new Error("获取知识库归属锁超时")
      }

      await new Promise((resolve) => setTimeout(resolve, 15 + Math.random() * 35))
    }
  }
}

/**
 * Mutex for ownership file read-modify-write operations.
 * In-process chaining covers concurrent uploads inside one worker; the lockfile
 * also serialises PM2 cluster workers so they cannot clobber each other's records.
 */
let _ownershipMutex: Promise<void> = Promise.resolve()

async function withOwnershipLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void
  const prev = _ownershipMutex
  _ownershipMutex = new Promise<void>((res) => { release = res })
  await prev

  let releaseFileLock: (() => Promise<void>) | null = null
  try {
    releaseFileLock = await acquireOwnershipFileLock()
    return await fn()
  } finally {
    if (releaseFileLock) {
      await releaseFileLock().catch(() => {})
    }
    release()
  }
}

async function getOwnershipMap() {
  const records = await readOwnershipRecords()
  return new Map(records.map((record) => [record.relativePath, record]))
}

async function setKnowledgeBaseOwnershipRecord(
  relativePath: string,
  owner: KnowledgeBaseFileOwner,
  entryType: "file" | "folder",
  overwrite = true,
) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  if (!normalizedPath) {
    return null
  }

  return withOwnershipLock(async () => {
    const records = await readOwnershipRecords()
    const existing = records.find((record) => record.relativePath === normalizedPath)
    if (existing && !overwrite) {
      return existing
    }

    const uploadedAt = existing?.uploadedAt || new Date().toISOString()
    const nextRecord: KnowledgeBaseOwnershipRecord = {
      relativePath: normalizedPath,
      entryType,
      ownerId: owner.ownerId,
      ownerName: owner.ownerName,
      ownerEmail: owner.ownerEmail,
      uploadedAt,
      locked: existing?.locked,
    }
    const next = records.filter((record) => record.relativePath !== normalizedPath)
    next.push(nextRecord)
    next.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
    await writeOwnershipRecords(next)
    return nextRecord
  })
}

/** Record ownership for a file/folder (used by shared-note and other non-upload writers). */
export async function recordKnowledgeBaseOwner(
  relativePath: string,
  owner: KnowledgeBaseFileOwner,
  entryType: "file" | "folder" = "file",
  overwrite = true,
) {
  if (entryType === "folder") {
    await ensureKnowledgeBaseFolderOwner(relativePath, owner)
    return
  }
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  if (!normalizedPath) return
  const parent = normalizedPath.includes("/")
    ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/"))
    : ""
  if (parent) {
    await ensureKnowledgeBaseFolderOwner(parent, owner)
  }
  await setKnowledgeBaseOwnershipRecord(normalizedPath, owner, "file", overwrite)
}

async function setKnowledgeBaseFileOwner(relativePath: string, owner: KnowledgeBaseFileOwner) {
  return setKnowledgeBaseOwnershipRecord(relativePath, owner, "file")
}

async function ensureKnowledgeBaseFolderOwner(relativePath: string, owner: KnowledgeBaseFileOwner) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  if (!normalizedPath) {
    return
  }

  const segments = normalizedPath.split("/")
  for (let index = 0; index < segments.length; index += 1) {
    const currentPath = segments.slice(0, index + 1).join("/")
    await setKnowledgeBaseOwnershipRecord(currentPath, owner, "folder", false)
  }
}

async function removeKnowledgeBaseFileOwner(relativePath: string) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  return withOwnershipLock(async () => {
    const records = await readOwnershipRecords()
    const next = records.filter((record) => record.relativePath !== normalizedPath)
    await writeOwnershipRecords(next)
  })
}

export async function removeKnowledgeBaseOwnerRecord(relativePath: string) {
  await removeKnowledgeBaseFileOwner(relativePath)
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
  isAdmin = false,
): KnowledgeBaseDocumentNode {
  const extension = getExtension(input.name)
  const ownership = ownershipMap.get(input.relativePath)
  const locked = ownership?.locked === true
  const isOwner = Boolean(viewerUserId && ownership?.ownerId && ownership.ownerId === viewerUserId)

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
    canDelete: isAdmin || (locked ? isOwner : true),
    locked,
    canLock: isAdmin || isOwner,
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

function sanitizePathSegment(name: string, label: string) {
  const trimmed = String(name || "").trim()
  if (!trimmed) {
    throw new Error(`${label}不能为空`)
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error(`${label}不合法`)
  }
  if (/[\\/]/.test(trimmed)) {
    throw new Error(`${label}不能包含路径分隔符`)
  }

  const cleaned = trimmed
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()

  if (!cleaned) {
    throw new Error(`${label}不合法`)
  }

  return cleaned
}

function getExtension(fileName: string) {
  return path.extname(fileName).toLowerCase()
}

export function isKnowledgeBaseTextPreview(extension: string) {
  return TEXT_PREVIEW_EXTENSIONS.has(extension)
}

export function isKnowledgeBaseEditableText(extension: string) {
  return EDITABLE_TEXT_EXTENSIONS.has(extension.toLowerCase())
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
  isAdmin = false,
): Promise<KnowledgeBaseFolderNode> {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true })

  const folders: KnowledgeBaseFolderNode[] = []
  const documents: KnowledgeBaseDocumentNode[] = []

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name)
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      folders.push(await buildFolderTree(absolutePath, relativePath, ownershipMap, viewerUserId, isAdmin))
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
        isAdmin,
      ),
    )
  }

  folders.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
  documents.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))

  const size = documents.reduce((total, document) => total + document.size, 0) + folders.reduce((total, folder) => total + folder.size, 0)
  const explicitOwner = relativeDir ? ownershipMap.get(relativeDir) : null
  let fallbackOwnerId: string | null = null
  let fallbackOwnerName: string | null = null
  let fallbackUploadedAt: string | null = null

  const considerCandidate = (candidate: { ownerId: string | null; ownerName: string; uploadedAt: string | null }) => {
    if (!candidate.ownerName || candidate.ownerName === "未知" || candidate.ownerName === "-") {
      return
    }

    if (!fallbackOwnerName) {
      fallbackOwnerId = candidate.ownerId
      fallbackOwnerName = candidate.ownerName
      fallbackUploadedAt = candidate.uploadedAt
      return
    }

    if (!candidate.uploadedAt) {
      return
    }
    if (!fallbackUploadedAt) {
      fallbackOwnerId = candidate.ownerId
      fallbackOwnerName = candidate.ownerName
      fallbackUploadedAt = candidate.uploadedAt
      return
    }

    const currentTime = new Date(fallbackUploadedAt).getTime()
    const nextTime = new Date(candidate.uploadedAt).getTime()
    if (Number.isNaN(nextTime)) {
      return
    }
    if (Number.isNaN(currentTime) || nextTime < currentTime) {
      fallbackOwnerId = candidate.ownerId
      fallbackOwnerName = candidate.ownerName
      fallbackUploadedAt = candidate.uploadedAt
    }
  }

  for (const document of documents) {
    considerCandidate({ ownerId: document.ownerId, ownerName: document.ownerName, uploadedAt: document.uploadedAt })
  }

  for (const folder of folders) {
    considerCandidate({ ownerId: folder.ownerId, ownerName: folder.ownerName, uploadedAt: folder.uploadedAt })
  }

  const folderLocked = explicitOwner?.locked === true
  const isFolderOwner = Boolean(viewerUserId && (explicitOwner?.ownerId || fallbackOwnerId) && (explicitOwner?.ownerId ?? fallbackOwnerId) === viewerUserId)

  return {
    name: relativeDir ? path.basename(relativeDir) : "全部资料",
    relativePath: relativeDir,
    size,
    ownerId: explicitOwner?.ownerId || fallbackOwnerId,
    ownerName: explicitOwner?.ownerName || fallbackOwnerName || "-",
    uploadedAt: explicitOwner?.uploadedAt || fallbackUploadedAt,
    // A folder can be deleted by its owner or by an admin; root folder ("") is never deletable.
    // If locked, only owner/admin can delete/rename/move; if unlocked, anyone can.
    canDelete: Boolean(relativeDir) && (isAdmin || (folderLocked ? isFolderOwner : true)),
    locked: folderLocked,
    canLock: isAdmin || isFolderOwner,
    folders,
    documents,
  }
}

async function persistInferredFolderOwners(
  node: KnowledgeBaseFolderNode,
  ownershipMap: Map<string, KnowledgeBaseOwnershipRecord>,
) {
  const missing: Array<{ relativePath: string; ownerId: string; ownerName: string; uploadedAt: string }> = []

  const walk = (folder: KnowledgeBaseFolderNode) => {
    if (
      folder.relativePath &&
      folder.ownerId &&
      folder.ownerName &&
      folder.ownerName !== "-" &&
      folder.ownerName !== "未知" &&
      !ownershipMap.has(folder.relativePath)
    ) {
      missing.push({
        relativePath: folder.relativePath,
        ownerId: folder.ownerId,
        ownerName: folder.ownerName,
        uploadedAt: folder.uploadedAt || new Date().toISOString(),
      })
    }
    for (const child of folder.folders) {
      walk(child)
    }
  }
  walk(node)

  if (!missing.length) {
    return
  }

  await withOwnershipLock(async () => {
    const records = await readOwnershipRecords()
    const existing = new Set(records.map((record) => record.relativePath))
    let changed = false
    for (const item of missing) {
      if (existing.has(item.relativePath)) continue
      records.push({
        relativePath: item.relativePath,
        entryType: "folder",
        ownerId: item.ownerId,
        ownerName: item.ownerName,
        uploadedAt: item.uploadedAt,
      })
      existing.add(item.relativePath)
      changed = true
    }
    if (!changed) return
    records.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
    await writeOwnershipRecords(records)
  })
}

export async function listKnowledgeBaseTree(viewerUserId?: string, isAdmin = false) {
  const root = await ensureKnowledgeBaseStorage()
  const ownershipMap = await getOwnershipMap()
  const tree = await buildFolderTree(root, "", ownershipMap, viewerUserId, isAdmin)
  // Heal folder rows that lost explicit ownership but still have owned children.
  void persistInferredFolderOwners(tree, ownershipMap).catch(() => {})
  return tree
}

export async function deleteKnowledgeBaseFolder(relativePath: string, actorUserId: string, isAdmin = false) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  if (!normalizedPath) {
    throw new Error("缺少文件夹路径")
  }
  if (!actorUserId) {
    throw new Error("缺少用户信息")
  }

  if (!isAdmin) {
    const ownershipMap = await getOwnershipMap()
    const ownership = ownershipMap.get(normalizedPath)
    if (ownership?.locked === true && ownership.ownerId !== actorUserId) {
      throw new Error("只有创建者或管理员可以删除该文件夹")
    }
  }

  const { target } = await resolveKnowledgeBasePath(normalizedPath)
  const stat = await fs.stat(target)
  if (!stat.isDirectory()) {
    throw new Error("目标不是文件夹")
  }

  await fs.rm(target, { recursive: true, force: true })

  // Remove all ownership records whose paths are inside this folder
  await withOwnershipLock(async () => {
    const records = await readOwnershipRecords()
    const prefix = normalizedPath + "/"
    const remaining = records.filter(
      (r) => r.relativePath !== normalizedPath && !r.relativePath.startsWith(prefix)
    )
    await writeOwnershipRecords(remaining)
  })
}

export async function createKnowledgeBaseFolder(relativePath: string, owner?: KnowledgeBaseFileOwner) {
  const { target, normalized } = await resolveKnowledgeBasePath(relativePath)
  await fs.mkdir(target, { recursive: true })
  if (owner) {
    await ensureKnowledgeBaseFolderOwner(normalized, owner)
  }
  return {
    relativePath: normalized,
    name: normalized ? path.basename(normalized) : "全部资料",
  }
}

export async function saveKnowledgeBaseFile(folderPath: string, file: File, owner?: KnowledgeBaseFileOwner) {
  const safeName = sanitizeFileName(file.name || "document")
  const { target: folderAbsolutePath, normalized } = await resolveKnowledgeBasePath(folderPath)
  await fs.mkdir(folderAbsolutePath, { recursive: true })
  if (owner) {
    await ensureKnowledgeBaseFolderOwner(normalized, owner)
  }

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
  if (owner) {
    await ensureKnowledgeBaseFolderOwner(normalized, owner)
  }

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

export async function deleteKnowledgeBaseFile(relativePath: string, actorUserId: string, isAdmin = false) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  if (!normalizedPath) {
    throw new Error("缺少文件路径")
  }
  if (!actorUserId) {
    throw new Error("缺少用户信息")
  }

  if (!isAdmin) {
    const ownershipMap = await getOwnershipMap()
    const ownership = ownershipMap.get(normalizedPath)
    if (ownership?.locked === true && ownership.ownerId !== actorUserId) {
      throw new Error("只有上传者可以删除该文件")
    }
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

/** Stream a file and return its SHA-256 hex digest without loading it entirely into memory. */
async function hashFile(absolutePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(absolutePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex")))
    stream.on("error", reject)
  })
}

type DedupEntry = { relativePath: string; absolutePath: string; mtime: number; hash: string }

async function collectFilesForDedup(absoluteDir: string, relativeDir: string, results: DedupEntry[]) {
  let entries
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name)
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await collectFilesForDedup(absolutePath, relativePath, results)
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(absolutePath)
        const hash = await hashFile(absolutePath)
        results.push({ relativePath, absolutePath, mtime: stat.mtimeMs, hash })
      } catch {
        // skip unreadable files
      }
    }
  }
}

export type DedupResult = {
  scanned: number
  deleted: string[]
  kept: string[]
}

/** Scan a folder recursively, detect content-identical files, keep the newest, delete the rest. */
export async function deduplicateKnowledgeBaseFolder(folderPath: string): Promise<DedupResult> {
  const { target, normalized } = await resolveKnowledgeBasePath(folderPath)

  const entries: DedupEntry[] = []
  await collectFilesForDedup(target, normalized, entries)

  // Group files by SHA-256 hash
  const byHash = new Map<string, DedupEntry[]>()
  for (const entry of entries) {
    const group = byHash.get(entry.hash) ?? []
    group.push(entry)
    byHash.set(entry.hash, group)
  }

  const deleted: string[] = []
  const kept: string[] = []

  for (const group of byHash.values()) {
    if (group.length <= 1) continue
    // Keep the file with the newest mtime; delete the rest
    group.sort((a, b) => b.mtime - a.mtime)
    kept.push(group[0].relativePath)
    for (const dup of group.slice(1)) {
      try {
        await fs.unlink(dup.absolutePath)
        await removeKnowledgeBaseFileOwner(dup.relativePath)
        deleted.push(dup.relativePath)
      } catch {
        // ignore individual delete failures
      }
    }
  }

  // Clean up any directories that are now empty
  const dirsToCheck = new Set<string>()
  for (const p of deleted) {
    const dir = path.posix.dirname(p)
    if (dir && dir !== ".") dirsToCheck.add(dir)
  }
  for (const dir of dirsToCheck) {
    await removeEmptyKnowledgeBaseDirectories(dir)
  }

  return { scanned: entries.length, deleted, kept }
}

async function ensurePathNotExists(absolutePath: string) {
  try {
    await fs.access(absolutePath)
    throw new Error("目标名称已存在，请更换后重试")
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error
    }
  }
}

async function renameOwnershipPath(oldPath: string, newPath: string, entryType: "file" | "folder") {
  return withOwnershipLock(async () => {
    const records = await readOwnershipRecords()
    const prefix = `${oldPath}/`
    const next = records.map((record) => {
      if (record.relativePath === oldPath) {
        return { ...record, relativePath: newPath, entryType: record.entryType || entryType }
      }

      if (entryType === "folder" && record.relativePath.startsWith(prefix)) {
        return {
          ...record,
          relativePath: `${newPath}/${record.relativePath.slice(prefix.length)}`,
        }
      }

      return record
    })

    next.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
    await writeOwnershipRecords(next)
  })
}

export async function renameKnowledgeBaseFile(relativePath: string, newName: string, actorUserId: string, isAdmin = false) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  if (!normalizedPath) {
    throw new Error("缺少文件路径")
  }
  if (!actorUserId) {
    throw new Error("缺少用户信息")
  }

  const safeName = sanitizePathSegment(newName, "文件名")
  const parent = path.posix.dirname(normalizedPath) === "." ? "" : path.posix.dirname(normalizedPath)
  const nextPath = normalizeKnowledgeBasePath(parent ? `${parent}/${safeName}` : safeName)
  if (!nextPath) {
    throw new Error("文件名不合法")
  }
  if (nextPath === normalizedPath) {
    return { relativePath: normalizedPath, name: path.posix.basename(normalizedPath) }
  }

  if (!isAdmin) {
    const ownershipMap = await getOwnershipMap()
    const ownership = ownershipMap.get(normalizedPath)
    if (ownership?.locked === true && ownership.ownerId !== actorUserId) {
      throw new Error("只有上传者可以重命名该文件")
    }
  }

  const { target } = await resolveKnowledgeBasePath(normalizedPath)
  const sourceStat = await fs.stat(target)
  if (!sourceStat.isFile()) {
    throw new Error("目标不是文件")
  }

  const { target: nextTarget } = await resolveKnowledgeBasePath(nextPath)
  await ensurePathNotExists(nextTarget)

  await fs.rename(target, nextTarget)
  await renameOwnershipPath(normalizedPath, nextPath, "file")

  return { relativePath: nextPath, name: path.posix.basename(nextPath) }
}

export async function renameKnowledgeBaseFolder(relativePath: string, newName: string, actorUserId: string, isAdmin = false) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  if (!normalizedPath) {
    throw new Error("缺少文件夹路径")
  }
  if (!actorUserId) {
    throw new Error("缺少用户信息")
  }

  const safeName = sanitizePathSegment(newName, "文件夹名称")
  const parent = path.posix.dirname(normalizedPath) === "." ? "" : path.posix.dirname(normalizedPath)
  const nextPath = normalizeKnowledgeBasePath(parent ? `${parent}/${safeName}` : safeName)
  if (!nextPath) {
    throw new Error("文件夹名称不合法")
  }
  if (nextPath === normalizedPath) {
    return { relativePath: normalizedPath, name: path.posix.basename(normalizedPath) }
  }

  if (!isAdmin) {
    const ownershipMap = await getOwnershipMap()
    const ownership = ownershipMap.get(normalizedPath)
    if (ownership?.locked === true && ownership.ownerId !== actorUserId) {
      throw new Error("只有创建者或管理员可以重命名该文件夹")
    }
  }

  const { target } = await resolveKnowledgeBasePath(normalizedPath)
  const sourceStat = await fs.stat(target)
  if (!sourceStat.isDirectory()) {
    throw new Error("目标不是文件夹")
  }

  const { target: nextTarget } = await resolveKnowledgeBasePath(nextPath)
  await ensurePathNotExists(nextTarget)

  await fs.rename(target, nextTarget)
  await renameOwnershipPath(normalizedPath, nextPath, "folder")

  return { relativePath: nextPath, name: path.posix.basename(nextPath) }
}

export async function moveKnowledgeBaseFolder(sourcePath: string, destinationParentPath: string, actorUserId: string, isAdmin = false) {
  const normalizedSource = normalizeKnowledgeBasePath(sourcePath)
  if (!normalizedSource) throw new Error("缺少源文件夹路径")
  if (!actorUserId) throw new Error("缺少用户信息")

  const folderName = path.posix.basename(normalizedSource)
  const normalizedDest = normalizeKnowledgeBasePath(destinationParentPath)
  const targetPath = normalizedDest ? `${normalizedDest}/${folderName}` : folderName

  if (targetPath === normalizedSource) throw new Error("不能移动到当前位置")
  if (targetPath.startsWith(`${normalizedSource}/`)) throw new Error("不能将文件夹移动到自身子目录中")

  if (!isAdmin) {
    const ownershipMap = await getOwnershipMap()
    const ownership = ownershipMap.get(normalizedSource)
    if (ownership?.locked === true && ownership.ownerId !== actorUserId) {
      throw new Error("只有创建者或管理员可以移动该文件夹")
    }
  }

  const { target: sourceTarget } = await resolveKnowledgeBasePath(normalizedSource)
  const sourceStat = await fs.stat(sourceTarget)
  if (!sourceStat.isDirectory()) throw new Error("目标不是文件夹")

  const { target: destTarget } = await resolveKnowledgeBasePath(targetPath)
  await ensurePathNotExists(destTarget)
  await fs.mkdir(path.dirname(destTarget), { recursive: true })
  await fs.rename(sourceTarget, destTarget)
  await renameOwnershipPath(normalizedSource, targetPath, "folder")

  return { relativePath: targetPath, name: folderName }
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

  if (extension === ".doc") {
    const extractor = new WordExtractor()
    const parsed = await extractor.extract(absolutePath)
    return parsed.getBody().replace(/\s+/g, " ").trim()
  }

  if (extension === ".docx") {
    const buffer = await fs.readFile(absolutePath)
    try {
      const parsed = await mammoth.extractRawText({ buffer })
      const text = parsed.value
        .replace(/\r\n/g, "\n")
        .replace(/[ \t\f\v]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
      if (text) return text
    } catch {
      // Fall through to word-extractor for misidentified .doc files
    }
    // Fallback: try word-extractor (handles .doc files renamed to .docx)
    const extractor = new WordExtractor()
    const parsed = await extractor.extract(absolutePath)
    return parsed.getBody().replace(/\s+/g, " ").trim()
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

export { readChatDocumentText as readFileDocumentText }

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildKnowledgeBasePreviewHtml(title: string, body: string) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      body {
        margin: 0;
        padding: 16px 20px;
        background: #ffffff;
        color: #111827;
        line-height: 1.6;
        word-break: break-word;
        width: 100%;
        box-sizing: border-box;
      }
      .doc-preview-root {
        width: 100%;
        max-width: none;
      }
      .doc-preview-root * {
        max-width: 100% !important;
        box-sizing: border-box;
      }
      .doc-preview-root p,
      .doc-preview-root div,
      .doc-preview-root section,
      .doc-preview-root li,
      .doc-preview-root ul,
      .doc-preview-root ol {
        width: 100% !important;
        margin-left: 0 !important;
        padding-left: 0 !important;
        text-align: left !important;
      }
      h1, h2, h3, h4, h5, h6 {
        margin: 0 0 12px;
        line-height: 1.35;
      }
      p {
        margin: 0 0 12px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 16px 0;
        font-size: 14px;
      }
      th, td {
        border: 1px solid #d1d5db;
        padding: 8px 10px;
        vertical-align: top;
      }
      th {
        background: #f3f4f6;
        font-weight: 600;
      }
      section {
        margin-bottom: 24px;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      pre {
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body><div class="doc-preview-root">${body}</div></body>
</html>`
}

export async function readKnowledgeBasePreviewContent(relativePath: string) {
  const file = await getKnowledgeBaseFile(relativePath)
  if (!isKnowledgeBaseTextPreview(file.extension)) {
    throw new Error("该文件暂不支持文本预览")
  }

  if (file.extension === ".docx") {
    try {
      const buffer = await fs.readFile(file.absolutePath)
      const parsed = await mammoth.convertToHtml({ buffer })
      if (parsed.value) {
        return {
          content: buildKnowledgeBasePreviewHtml(file.name, parsed.value),
          contentType: "text/html; charset=utf-8",
        }
      }
    } catch {
      // fall through to plain-text fallback
    }
    const text = await readChatDocumentText(file.absolutePath, file.extension)
    return {
      content: buildKnowledgeBasePreviewHtml(file.name, `<pre>${escapeHtml(text)}</pre>`),
      contentType: "text/html; charset=utf-8",
    }
  }

  if (file.extension === ".doc") {
    // Try converting .doc → .docx via LibreOffice, then use mammoth for rich HTML
    try {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-preview-"))
      try {
        await execFileAsync("soffice", [
          "--headless",
          "--convert-to", "docx",
          "--outdir", tmpDir,
          file.absolutePath,
        ], { timeout: 30_000 })
        const baseName = path.basename(file.name, path.extname(file.name))
        const docxPath = path.join(tmpDir, `${baseName}.docx`)
        const buffer = await fs.readFile(docxPath)
        const parsed = await mammoth.convertToHtml({ buffer })
        if (parsed.value) {
          return {
            content: buildKnowledgeBasePreviewHtml(file.name, parsed.value),
            contentType: "text/html; charset=utf-8",
          }
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
      }
    } catch {
      // LibreOffice not available or conversion failed — fall back to word-extractor
    }
    try {
      const extractor = new WordExtractor()
      const parsed = await extractor.extract(file.absolutePath)
      const body = parsed.getBody()
      const paragraphs = body.split(/\n+/).filter((p: string) => p.trim())
      const html = paragraphs.map((p: string) => `<p>${escapeHtml(p.trim())}</p>`).join("\n")
      return {
        content: buildKnowledgeBasePreviewHtml(file.name, html),
        contentType: "text/html; charset=utf-8",
      }
    } catch {
      // fall through to plain-text fallback
    }
    const text = await readChatDocumentText(file.absolutePath, file.extension)
    return {
      content: buildKnowledgeBasePreviewHtml(file.name, `<pre>${escapeHtml(text)}</pre>`),
      contentType: "text/html; charset=utf-8",
    }
  }

  if (file.extension === ".xlsx" || file.extension === ".xls") {
    try {
      const workbook = XLSX.read(await fs.readFile(file.absolutePath), { type: "buffer" })
      const sections = workbook.SheetNames.map((sheetName) => {
        const worksheet = workbook.Sheets[sheetName]
        const sheetHtml = XLSX.utils.sheet_to_html(worksheet)
        return `<section><h2>${escapeHtml(sheetName)}</h2>${sheetHtml}</section>`
      }).join("")

      if (sections) {
        return {
          content: buildKnowledgeBasePreviewHtml(file.name, sections),
          contentType: "text/html; charset=utf-8",
        }
      }
    } catch {
      // fall through to plain-text fallback
    }
    const text = await readChatDocumentText(file.absolutePath, file.extension)
    return {
      content: buildKnowledgeBasePreviewHtml(file.name, `<pre>${escapeHtml(text)}</pre>`),
      contentType: "text/html; charset=utf-8",
    }
  }

  const text = await readChatDocumentText(file.absolutePath, file.extension)
  return {
    content: text,
    contentType: "text/plain; charset=utf-8",
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function buildDocxBufferFromPlainText(text: string): Buffer {
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n")
  const bodyXml = paragraphs
    .map((paragraph) => {
      if (!paragraph) return "<w:p/>"
      return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`
    })
    .join("")

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`

  const zip = new AdmZip()
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
  )
  zip.addFile(
    "_rels/.rels",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
  )
  zip.addFile(
    "word/_rels/document.xml.rels",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`),
  )
  zip.addFile("word/document.xml", Buffer.from(documentXml, "utf8"))
  return zip.toBuffer()
}

export async function readKnowledgeBaseEditableText(relativePath: string) {
  const file = await getKnowledgeBaseFile(relativePath)
  if (!isKnowledgeBaseEditableText(file.extension)) {
    throw new Error("该文件暂不支持编辑")
  }

  if (file.extension === ".docx") {
    const buffer = await fs.readFile(file.absolutePath)
    try {
      const parsed = await mammoth.extractRawText({ buffer })
      return parsed.value.replace(/\r\n/g, "\n")
    } catch {
      const extractor = new WordExtractor()
      const parsed = await extractor.extract(file.absolutePath)
      return parsed.getBody()
    }
  }

  if (file.extension === ".json") {
    const raw = await fs.readFile(file.absolutePath, "utf8")
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      return raw
    }
  }

  return fs.readFile(file.absolutePath, "utf8")
}

export async function writeKnowledgeBaseEditableText(
  relativePath: string,
  content: string,
  actorUserId: string,
  isAdmin = false,
) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  if (!normalizedPath) {
    throw new Error("缺少文件路径")
  }
  if (!actorUserId) {
    throw new Error("缺少用户信息")
  }

  const file = await getKnowledgeBaseFile(normalizedPath)
  if (!isKnowledgeBaseEditableText(file.extension)) {
    throw new Error("该文件暂不支持编辑")
  }

  if (!isAdmin) {
    const ownershipMap = await getOwnershipMap()
    const ownership = ownershipMap.get(normalizedPath)
    if (ownership?.locked === true && ownership.ownerId !== actorUserId) {
      throw new Error("只有上传者可以编辑该文件")
    }
  }

  let buffer: Buffer
  if (file.extension === ".docx") {
    buffer = buildDocxBufferFromPlainText(content)
  } else if (file.extension === ".json") {
    try {
      buffer = Buffer.from(JSON.stringify(JSON.parse(content), null, 2), "utf8")
    } catch {
      buffer = Buffer.from(content, "utf8")
    }
  } else {
    buffer = Buffer.from(content, "utf8")
  }

  await fs.writeFile(file.absolutePath, buffer)
  const stat = await fs.stat(file.absolutePath)

  return {
    relativePath: normalizedPath,
    name: file.name,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  }
}

export function shouldSkipKnowledgeBaseChatPath(relativePath: string, entryName: string, isDirectory: boolean): boolean {
  const normalized = relativePath.replace(/\\/g, "/")
  if (isDirectory) {
    return entryName === "_images" || normalized.endsWith("/_images")
  }
  if (entryName === "_notes_meta.json") return true
  if (normalized.includes("/_images/")) return true
  return false
}

export type KnowledgeBaseChatExtractProbe =
  | { status: "ok" }
  | { status: "too_large" }
  | { status: "unsupported" }
  | { status: "empty" }
  | { status: "failed"; message: string }

function formatChatExtractFailure(err: unknown): string {
  const msg = String((err as Error)?.message || err || "")
  const lower = msg.toLowerCase()
  if (lower.includes("password") || msg.includes("密码") || lower.includes("encrypted")) {
    return "PDF 可能已加密或需要密码，无法提取文本"
  }
  if (msg.includes("解析超时")) {
    return msg
  }
  return msg || "无法读取文件内容"
}

/** Stat-only scan of chat-supported files within a folder scope (matches index coverage UI). */
export async function listKnowledgeBaseIndexableFiles(
  folderPath = "",
): Promise<{ relativePath: string; size: number }[]> {
  const { target } = await resolveKnowledgeBasePath(folderPath)
  const stat = await fs.stat(target)
  if (!stat.isDirectory()) {
    return []
  }
  const results: { relativePath: string; size: number }[] = []
  const normalized = normalizeKnowledgeBasePath(folderPath)

  async function scan(absoluteDir: string, relativeDir: string) {
    let entries
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (shouldSkipKnowledgeBaseChatPath(relativePath, entry.name, true)) continue
        await scan(path.join(absoluteDir, entry.name), relativePath)
      } else if (entry.isFile()) {
        if (shouldSkipKnowledgeBaseChatPath(relativePath, entry.name, false)) continue
        const ext = getExtension(entry.name)
        if (!isKnowledgeBaseChatSupported(ext)) continue
        try {
          const fileStat = await fs.stat(path.join(absoluteDir, entry.name))
          if (fileStat.size <= MAX_CHAT_FILE_BYTES) {
            results.push({ relativePath, size: fileStat.size })
          }
        } catch {
          // skip unreadable
        }
      }
    }
  }

  await scan(target, normalized)
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN"))
  return results
}

/** Check whether a file can be text-extracted for embedding (same rules as vectorize). */
export async function probeKnowledgeBaseChatExtract(relativePath: string): Promise<KnowledgeBaseChatExtractProbe> {
  const normalized = normalizeKnowledgeBasePath(relativePath)
  if (!normalized) {
    return { status: "failed", message: "无效路径" }
  }
  let file: Awaited<ReturnType<typeof getKnowledgeBaseFile>>
  try {
    file = await getKnowledgeBaseFile(normalized)
  } catch {
    return { status: "failed", message: "文件不存在或无法访问" }
  }
  if (!isKnowledgeBaseChatSupported(file.extension)) {
    return { status: "unsupported" }
  }
  if (file.size > MAX_CHAT_FILE_BYTES) {
    return { status: "too_large" }
  }
  try {
    const text = await withExtractTimeout(readChatDocumentText(file.absolutePath, file.extension), 20_000)
    if (!text.trim()) {
      return { status: "empty" }
    }
    return { status: "ok" }
  } catch (err) {
    return { status: "failed", message: formatChatExtractFailure(err) }
  }
}

export function knowledgeBaseChatExtractReasonLabel(probe: KnowledgeBaseChatExtractProbe): string {
  switch (probe.status) {
    case "ok":
      return "可嵌入"
    case "too_large":
      return "超过 10MB，不参与问答索引"
    case "unsupported":
      return "格式不支持"
    case "empty":
      return "未能提取到文本（可能是扫描件 PDF 或无文字层）"
    case "failed":
      return probe.message
    default:
      return "无法嵌入"
  }
}

async function collectChatDocumentsInDirectory(
  absoluteDir: string,
  relativeDir: string,
  documents: KnowledgeBaseChatDocument[],
  onScan?: (file: string) => void,
) {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name)
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      if (shouldSkipKnowledgeBaseChatPath(relativePath, entry.name, true)) {
        continue
      }
      await collectChatDocumentsInDirectory(absolutePath, relativePath, documents, onScan)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    if (shouldSkipKnowledgeBaseChatPath(relativePath, entry.name, false)) {
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

    onScan?.(relativePath)

    let text: string
    try {
      text = await withExtractTimeout(readChatDocumentText(absolutePath, extension), 20_000)
    } catch {
      // Skip unreadable or timed-out files so the rest of the folder can still be indexed
      continue
    }
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

export async function collectKnowledgeBaseDocuments(folderPath = "", onScan?: (file: string) => void) {
  const { target } = await resolveKnowledgeBasePath(folderPath)
  const stat = await fs.stat(target)
  if (!stat.isDirectory()) {
    throw new Error("请选择有效的文件夹")
  }

  const documents: KnowledgeBaseChatDocument[] = []
  await collectChatDocumentsInDirectory(target, normalizeKnowledgeBasePath(folderPath), documents, onScan)
  documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
  return documents
}

export async function setKnowledgeBaseEntryLocked(
  relativePath: string,
  locked: boolean,
  actorUserId: string,
  isAdmin = false,
  actorMeta?: { name?: string; email?: string },
) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  if (!normalizedPath) {
    throw new Error("缺少路径")
  }
  if (!actorUserId) {
    throw new Error("缺少用户信息")
  }

  return withOwnershipLock(async () => {
    const records = await readOwnershipRecords()
    const existingIndex = records.findIndex((r) => r.relativePath === normalizedPath)
    const existing = existingIndex >= 0 ? records[existingIndex] : null

    if (!isAdmin) {
      if (!existing || existing.ownerId !== actorUserId) {
        throw new Error("只有上传者或管理员可以修改锁定状态")
      }
    }

    if (!existing) {
      // No ownership record yet — create one on the fly so the lock can be applied
      const newRecord: KnowledgeBaseOwnershipRecord = {
        relativePath: normalizedPath,
        entryType: normalizedPath.includes(".") ? "file" : "folder",
        ownerId: actorUserId,
        ownerName: actorMeta?.name ?? actorUserId,
        ownerEmail: actorMeta?.email,
        uploadedAt: new Date().toISOString(),
        locked,
      }
      records.push(newRecord)
      await writeOwnershipRecords(records)
      return
    }

    records[existingIndex] = { ...existing, locked }
    await writeOwnershipRecords(records)
  })
}

export async function setKnowledgeBaseEntryOwner(
  relativePath: string,
  newOwner: { ownerId: string; ownerName: string; ownerEmail?: string },
) {
  const normalizedPath = normalizeKnowledgeBasePath(relativePath)
  if (!normalizedPath) throw new Error("缺少路径")

  return withOwnershipLock(async () => {
    const records = await readOwnershipRecords()
    const existingIndex = records.findIndex((r) => r.relativePath === normalizedPath)

    if (existingIndex >= 0) {
      records[existingIndex] = {
        ...records[existingIndex],
        ownerId: newOwner.ownerId,
        ownerName: newOwner.ownerName,
        ownerEmail: newOwner.ownerEmail,
      }
    } else {
      records.push({
        relativePath: normalizedPath,
        entryType: normalizedPath.includes(".") ? "file" : "folder",
        ownerId: newOwner.ownerId,
        ownerName: newOwner.ownerName,
        ownerEmail: newOwner.ownerEmail,
        uploadedAt: new Date().toISOString(),
      })
    }

    records.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN"))
    await writeOwnershipRecords(records)
  })
}