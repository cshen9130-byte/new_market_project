/**
 * Disk + JSON meta for investment-note「上传资料」files.
 * Files live under investment-notes/materials/; index in materials.json.
 */

import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import { promises as fs } from "fs"
import path from "path"
import AdmZip from "adm-zip"
import {
  buildDdMaterialsFolderIndex,
  collectDdMaterialsDocumentsForRows,
  ddSyncedMaterialId,
  parseDdSyncedMaterialId,
  parseRoadshowDdMaterialAttachmentId,
} from "@/lib/ma/due-diligence-materials"
import { previewStoredDocument } from "@/lib/server/fund-contract-materials"
import {
  cleanMaterialDisplayName,
  materialDuplicateKey,
  materialNameFromNoteTitle,
  needsContentBasedMaterialRename,
  selectKeptDuplicateMaterialIds,
} from "@/lib/ma/investment-note-material-filename"
import { INVESTMENT_NOTE_MATERIAL_MAX_BYTES, INVESTMENT_NOTE_MATERIAL_MAX_MB } from "@/lib/ma/investment-notes"
import { getServerDueDiligenceTable } from "@/lib/server/due-diligence-table"
import { getServerInvestmentNote, listServerInvestmentNotes } from "@/lib/server/investment-notes"
import { resolveInvestmentNoteMaterialDisplayName } from "@/lib/server/investment-note-material-rename"
import {
  getKnowledgeBaseFile,
  isKnowledgeBaseTextPreview,
  listKnowledgeBaseTree,
  readKnowledgeBasePreviewContent,
} from "@/lib/server/knowledge-base"
import { getServerStoragePath } from "@/lib/server/storage"

export type InvestmentNoteMaterial = {
  id: string
  name: string
  size: number
  mimeType: string
  noteId: string | null
  noteTitle: string | null
  uploadedBy: string
  uploadedByName: string
  createdAt: string
  source?: "upload" | "dd-table"
  /** Linked 产品要素 extract job, if auto-extract was queued for this file. */
  extractJobId?: number | null
}

type StoredMaterial = InvestmentNoteMaterial & {
  storageFilename: string
  /** True after suffix cleanup and any content-based rename attempt. */
  nameResolved?: boolean
}

export type InvestmentNoteMaterialExtractLink = {
  id: string
  name: string
  size: number
  extractJobId: number | null
  contentHash: string | null
}

export function contentHashFromMaterialStorageFilename(storageFilename: string): string | null {
  const match = String(storageFilename || "").trim().match(/_([0-9a-f]{16})(?:\.[^.]+)?$/i)
  return match?.[1]?.toLowerCase() ?? null
}

const MAX_FILE_BYTES = INVESTMENT_NOTE_MATERIAL_MAX_BYTES
const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".pptm",
  ".pps",
  ".ppsx",
  ".ppsm",
  ".pot",
  ".potx",
  ".potm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".txt",
  ".csv",
  ".zip",
])

const MIME_TO_EXTENSION: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/mspowerpoint": ".ppt",
  "application/powerpoint": ".ppt",
  "application/x-mspowerpoint": ".ppt",
  "application/x-pptx": ".pptx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12": ".pptm",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow": ".ppsx",
  "application/vnd.ms-powerpoint.slideshow.macroenabled.12": ".ppsm",
  "application/vnd.openxmlformats-officedocument.presentationml.template": ".potx",
  "application/vnd.ms-powerpoint.template.macroenabled.12": ".potm",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
}

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase()
}

function extensionForMime(mimeType?: string): string {
  const key = (mimeType || "").trim().toLowerCase().split(";")[0]
  return MIME_TO_EXTENSION[key] || ""
}

function resolveMaterialExtension(file: File): string {
  const fromName = getExtension(file.name || "")
  if (ALLOWED_EXTENSIONS.has(fromName)) return fromName
  const fromMime = extensionForMime(file.type)
  if (ALLOWED_EXTENSIONS.has(fromMime)) return fromMime
  return fromName
}

function looksLikeZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b
}

/** Browsers often send .pptx as application/vnd.ms-powerpoint (mapped to .ppt). */
function refinePowerpointExtension(ext: string, buffer: Buffer): string {
  if (!looksLikeZipBuffer(buffer)) return ext
  if (ext === ".ppt") return ".pptx"
  if (ext === ".pps") return ".ppsx"
  if (ext === ".pot") return ".potx"
  return ext
}

function displayNameWithExtension(fileName: string, ext: string): string {
  return cleanMaterialDisplayName(fileName || "material.bin", ext)
}

function mimeTypeForFilename(fileName: string, fallback?: string): string {
  const ext = getExtension(fileName)
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".pptm": "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
    ".pps": "application/vnd.ms-powerpoint",
    ".ppsx": "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
    ".ppsm": "application/vnd.ms-powerpoint.slideshow.macroEnabled.12",
    ".pot": "application/vnd.ms-powerpoint",
    ".potx": "application/vnd.openxmlformats-officedocument.presentationml.template",
    ".potm": "application/vnd.ms-powerpoint.template.macroEnabled.12",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".zip": "application/zip",
  }
  return map[ext] || fallback?.trim() || "application/octet-stream"
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
const STRONG_SNIFF_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  DOCX_MIME,
  XLSX_MIME,
  PPTX_MIME,
])
const HTML_PREVIEW_EXTENSIONS = new Set([".doc", ".docx", ".xls", ".xlsx"])

function sniffZipOfficeMime(buffer: Buffer): string | null {
  const headLen = Math.min(buffer.length, 16 * 1024)
  const tailStart = Math.max(0, buffer.length - 64 * 1024)
  const probe = Buffer.concat([buffer.subarray(0, headLen), buffer.subarray(tailStart)]).toString("latin1")
  if (probe.includes("word/")) return DOCX_MIME
  if (probe.includes("xl/workbook") || probe.includes("xl/worksheets")) return XLSX_MIME
  if (probe.includes("ppt/slides") || probe.includes("ppt/presentation")) return PPTX_MIME
  return null
}

function sniffMimeType(buffer: Buffer, fileName: string, storedMime?: string): string {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf"
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png"
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg"
  if (buffer.length >= 6 && buffer.subarray(0, 3).toString("ascii") === "GIF") return "image/gif"
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp"
  if (looksLikeZipBuffer(buffer)) {
    const office = sniffZipOfficeMime(buffer)
    if (office) return office
  }
  const fromName = mimeTypeForFilename(fileName, "")
  if (fromName && fromName !== "application/octet-stream") return fromName
  const stored = (storedMime || "").trim().split(";")[0]
  if (stored && stored !== "application/octet-stream") return stored
  if (buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    return "application/msword"
  }
  if (looksLikeZipBuffer(buffer)) return "application/zip"
  return stored || "application/octet-stream"
}

function ensureFilenameExtension(fileName: string, mimeType: string): string {
  const wanted = extensionForMime(mimeType)
  const current = getExtension(fileName)
  const base = (current ? fileName.slice(0, -current.length) : fileName).trim() || "file"
  if (!wanted) return fileName || "file"
  if (!current || current === ".bin") return `${base}${wanted}`
  const currentMime = mimeTypeForFilename(fileName, "")
  if (STRONG_SNIFF_MIMES.has(mimeType) && currentMime && currentMime !== mimeType) {
    return `${base}${wanted}`
  }
  return fileName
}

function resolveMaterialFileMeta(
  buffer: Buffer,
  fileName: string,
  storedMime?: string,
): { filename: string; mimeType: string } {
  const mimeType = sniffMimeType(buffer, fileName, storedMime)
  return {
    filename: ensureFilenameExtension(fileName || "file", mimeType),
    mimeType,
  }
}

function uniqueZipEntryName(filename: string, used: Set<string>): string {
  const safe = (filename || "file").replace(/[/\\]/g, "_").replace(/\0/g, "") || "file"
  const key = safe.toLowerCase()
  if (!used.has(key)) {
    used.add(key)
    return safe
  }
  const ext = path.extname(safe)
  const base = ext ? safe.slice(0, -ext.length) : safe
  let i = 2
  while (used.has(`${base} (${i})${ext}`.toLowerCase())) i += 1
  const next = `${base} (${i})${ext}`
  used.add(next.toLowerCase())
  return next
}

function createMaterialId(): string {
  return `mat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function rootDir(): string {
  return getServerStoragePath("investment-notes")
}

function materialsDir(): string {
  return path.join(rootDir(), "materials")
}

function materialsIndexFile(): string {
  return path.join(rootDir(), "materials.json")
}

function ensureDirs() {
  mkdirSync(materialsDir(), { recursive: true })
}

function storagePathFor(storageFilename: string): string {
  return path.join(materialsDir(), storageFilename)
}

function toPublic(row: StoredMaterial): InvestmentNoteMaterial {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    mimeType: row.mimeType,
    noteId: row.noteId,
    noteTitle: row.noteTitle,
    uploadedBy: row.uploadedBy,
    uploadedByName: row.uploadedByName,
    createdAt: row.createdAt,
    source: "upload",
    extractJobId: row.extractJobId ?? null,
  }
}

function listVisibleNotes(userId: string) {
  const seen = new Set<string>()
  const notes = [
    ...listServerInvestmentNotes("mine", userId),
    ...listServerInvestmentNotes("team", userId),
  ]
  return notes.filter((note) => {
    if (seen.has(note.id)) return false
    seen.add(note.id)
    return true
  })
}

function noteMaterialKey(noteId: string, fileName: string): string {
  return `${noteId}::${fileName.trim().toLowerCase()}`
}

async function collectDdSyncedMaterials(
  userId: string,
  stored: InvestmentNoteMaterial[],
): Promise<InvestmentNoteMaterial[]> {
  const notes = listVisibleNotes(userId).filter(
    (note) => (note.roadshowAssociations?.length ?? 0) > 0,
  )
  if (notes.length === 0) return []

  const snapshot = await getServerDueDiligenceTable()
  const rowById = new Map(snapshot.rows.map((row) => [row.id, row]))
  const tree = await listKnowledgeBaseTree(userId)
  const index = buildDdMaterialsFolderIndex(tree)

  const existing = new Set(
    stored
      .filter((row) => row.noteId)
      .map((row) => noteMaterialKey(row.noteId!, row.name)),
  )
  const seen = new Set<string>()
  const out: InvestmentNoteMaterial[] = []

  for (const note of notes) {
    const rows = (note.roadshowAssociations ?? [])
      .map((item) => rowById.get(item.rowId))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
    if (rows.length === 0) continue

    for (const doc of collectDdMaterialsDocumentsForRows(rows, index)) {
      const key = noteMaterialKey(note.id, doc.name)
      if (existing.has(key) || seen.has(key)) continue
      seen.add(key)
      out.push({
        id: ddSyncedMaterialId(note.id, doc.relativePath),
        name: doc.name,
        size: doc.size,
        mimeType: mimeTypeForFilename(doc.name),
        noteId: note.id,
        noteTitle: note.title.trim() || "无标题",
        uploadedBy: "dd-table",
        uploadedByName: "尽调表格",
        createdAt: doc.updatedAt || note.createdDate || new Date().toISOString(),
        source: "dd-table",
      })
    }
  }

  return out
}

function readAll(): StoredMaterial[] {
  ensureDirs()
  const file = materialsIndexFile()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"))
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((raw) => normalizeStored(raw))
      .filter((row): row is StoredMaterial => Boolean(row))
  } catch {
    return []
  }
}

function writeAll(rows: StoredMaterial[]) {
  ensureDirs()
  writeFileSync(materialsIndexFile(), JSON.stringify(rows, null, 2), "utf-8")
}

function normalizeStored(raw: unknown): StoredMaterial | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Partial<StoredMaterial>
  const id = typeof row.id === "string" ? row.id.trim() : ""
  const storageFilename = typeof row.storageFilename === "string" ? row.storageFilename.trim() : ""
  const name = typeof row.name === "string" ? row.name : ""
  if (!id || !storageFilename || !name) return null
  return {
    id,
    name,
    size: typeof row.size === "number" && Number.isFinite(row.size) ? row.size : 0,
    mimeType: typeof row.mimeType === "string" ? row.mimeType : "application/octet-stream",
    storageFilename,
    noteId: typeof row.noteId === "string" && row.noteId.trim() ? row.noteId.trim() : null,
    noteTitle: typeof row.noteTitle === "string" && row.noteTitle.trim() ? row.noteTitle.trim() : null,
    uploadedBy: typeof row.uploadedBy === "string" ? row.uploadedBy : "",
    uploadedByName: typeof row.uploadedByName === "string" ? row.uploadedByName : "",
    createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
    nameResolved: row.nameResolved === true,
    extractJobId:
      typeof row.extractJobId === "number" && Number.isFinite(row.extractJobId) && row.extractJobId > 0
        ? row.extractJobId
        : null,
  }
}

function applyLinkedNoteToMaterial(
  row: StoredMaterial,
  link: { noteId: string | null; noteTitle: string | null },
): StoredMaterial {
  const next: StoredMaterial = {
    ...row,
    noteId: link.noteId,
    noteTitle: link.noteTitle,
  }
  if (link.noteTitle && needsContentBasedMaterialRename(next.name)) {
    const fromNote = materialNameFromNoteTitle(
      link.noteTitle,
      getExtension(next.name) || getExtension(next.storageFilename),
    )
    if (fromNote) next.name = fromNote
  }
  return next
}

function resolveNoteForUser(
  noteId: string | null | undefined,
  userId: string,
): { noteId: string | null; noteTitle: string | null } {
  const safeId = (noteId || "").trim()
  if (!safeId) return { noteId: null, noteTitle: null }
  const team = listServerInvestmentNotes("team", userId)
  const mine = listServerInvestmentNotes("mine", userId)
  const note = [...team, ...mine].find((n) => n.id === safeId)
  if (!note) {
    throw new Error("关联的投资笔记不存在或无权访问")
  }
  const title = note.title.trim() || "无标题"
  return { noteId: note.id, noteTitle: title }
}

export function setInvestmentNoteMaterialExtractJobId(
  id: string,
  extractJobId: number | null,
): InvestmentNoteMaterial | null {
  const safeId = String(id || "").trim()
  if (!safeId) return null
  const all = readAll()
  const idx = all.findIndex((row) => row.id === safeId)
  if (idx < 0) return null
  all[idx] = {
    ...all[idx],
    extractJobId:
      typeof extractJobId === "number" && Number.isFinite(extractJobId) && extractJobId > 0
        ? extractJobId
        : null,
  }
  writeAll(all)
  return toPublic(all[idx])
}

export function listInvestmentNoteMaterialExtractLinks(noteId: string): InvestmentNoteMaterialExtractLink[] {
  const id = String(noteId || "").trim()
  if (!id) return []
  return readAll()
    .filter((row) => row.noteId === id)
    .map((row) => ({
      id: row.id,
      name: row.name,
      size: row.size,
      extractJobId: row.extractJobId ?? null,
      contentHash: contentHashFromMaterialStorageFilename(row.storageFilename),
    }))
}

export function listInvestmentNoteMaterials(): InvestmentNoteMaterial[] {
  return readAll()
    .map(toPublic)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** Stored uploads plus 尽调表格 files already attached to visible notes. */
export async function listInvestmentNoteMaterialsForViewer(
  userId: string,
): Promise<InvestmentNoteMaterial[]> {
  const stored = listInvestmentNoteMaterials()
  const synced = await collectDdSyncedMaterials(userId, stored)
  return [...synced, ...stored].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export type SaveInvestmentNoteMaterialResult = {
  material: InvestmentNoteMaterial
  duplicate: boolean
}

function pickKeptStoredMaterial(group: StoredMaterial[]): StoredMaterial | undefined {
  if (group.length === 0) return undefined
  const keep = selectKeptDuplicateMaterialIds(group)
  return group.find((row) => keep.has(row.id)) ?? group[0]
}

function findStoredDuplicate(
  all: StoredMaterial[],
  hash: string,
  name: string,
  size: number,
): StoredMaterial | undefined {
  const byHash = all.filter(
    (row) => contentHashFromMaterialStorageFilename(row.storageFilename) === hash,
  )
  if (byHash.length > 0) return pickKeptStoredMaterial(byHash)
  const key = materialDuplicateKey(name, size)
  return pickKeptStoredMaterial(
    all.filter((row) => materialDuplicateKey(row.name, row.size) === key),
  )
}

function removeStoredMaterialFiles(rows: StoredMaterial[], stillReferenced: Set<string>) {
  for (const row of rows) {
    if (stillReferenced.has(row.storageFilename)) continue
    try {
      unlinkSync(storagePathFor(row.storageFilename))
    } catch {
      // ignore missing file on disk
    }
  }
}

/** Drop extra copies of the same file (same hash or same cleaned name+size). */
export function deduplicateInvestmentNoteMaterials(): InvestmentNoteMaterial[] {
  const all = readAll()
  if (all.length < 2) return []

  const doomed = new Set<string>()
  const markExtras = (group: StoredMaterial[]) => {
    const visible = group.filter((row) => !doomed.has(row.id))
    if (visible.length <= 1) return
    const keep = selectKeptDuplicateMaterialIds(visible)
    for (const row of visible) {
      if (!keep.has(row.id)) doomed.add(row.id)
    }
  }

  const byHash = new Map<string, StoredMaterial[]>()
  const byNameSize = new Map<string, StoredMaterial[]>()
  for (const row of all) {
    const hash = contentHashFromMaterialStorageFilename(row.storageFilename)
    if (hash) {
      const hashed = byHash.get(hash) ?? []
      hashed.push(row)
      byHash.set(hash, hashed)
    }
    const key = materialDuplicateKey(row.name, row.size)
    const named = byNameSize.get(key) ?? []
    named.push(row)
    byNameSize.set(key, named)
  }
  for (const group of byHash.values()) markExtras(group)
  for (const group of byNameSize.values()) markExtras(group)
  if (doomed.size === 0) return []

  const deleted = all.filter((row) => doomed.has(row.id))
  const next = all.filter((row) => !doomed.has(row.id))
  const stillReferenced = new Set(next.map((row) => row.storageFilename))
  writeAll(next)
  removeStoredMaterialFiles(deleted, stillReferenced)
  return deleted.map(toPublic)
}

export async function saveInvestmentNoteMaterial(input: {
  file: File
  uploadedBy: string
  uploadedByName: string
  noteId?: string | null
}): Promise<SaveInvestmentNoteMaterialResult> {
  const ext = resolveMaterialExtension(input.file)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      "仅支持 PDF、PPT/PPTX、Word、Excel、图片、TXT/CSV、ZIP 等常见格式",
    )
  }
  if (input.file.size > MAX_FILE_BYTES) {
    throw new Error(`文件大小不能超过 ${INVESTMENT_NOTE_MATERIAL_MAX_MB}MB`)
  }

  const link = resolveNoteForUser(input.noteId, input.uploadedBy)
  const buffer = Buffer.from(await input.file.arrayBuffer())
  const resolvedExt = refinePowerpointExtension(ext, buffer)
  const originalFilename = displayNameWithExtension(input.file.name || "material.bin", resolvedExt)
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16)
  const all = readAll()
  const existing = findStoredDuplicate(all, hash, originalFilename, buffer.length)
  if (existing) {
    if (link.noteId && !existing.noteId) {
      const idx = all.findIndex((row) => row.id === existing.id)
      if (idx >= 0) {
        all[idx] = applyLinkedNoteToMaterial(all[idx], link)
        writeAll(all)
        return { material: toPublic(all[idx]), duplicate: true }
      }
    }
    return { material: toPublic(existing), duplicate: true }
  }

  const display = await resolveInvestmentNoteMaterialDisplayName({
    originalName: originalFilename,
    ext: resolvedExt,
    buffer,
    noteTitle: link.noteTitle,
  })
  const id = createMaterialId()
  const storageFilename = `${id}_${hash}${resolvedExt}`
  const mimeType = mimeTypeForFilename(display.name, input.file.type)

  ensureDirs()
  await fs.writeFile(storagePathFor(storageFilename), buffer)

  const row: StoredMaterial = {
    id,
    name: display.name,
    size: buffer.length,
    mimeType,
    storageFilename,
    noteId: link.noteId,
    noteTitle: link.noteTitle,
    uploadedBy: input.uploadedBy,
    uploadedByName: input.uploadedByName,
    createdAt: new Date().toISOString(),
    nameResolved: display.resolved,
  }

  all.unshift(row)
  writeAll(all)
  return { material: toPublic(row), duplicate: false }
}

function storedMaterialById(id: string): InvestmentNoteMaterial | null {
  const row = readAll().find((item) => item.id === id)
  return row ? toPublic(row) : null
}

export function getInvestmentNoteMaterialsByIds(ids: string[]): InvestmentNoteMaterial[] {
  const all = readAll()
  const byId = new Map(all.map((row) => [row.id, row]))
  const out: InvestmentNoteMaterial[] = []
  const seen = new Set<string>()
  for (const raw of ids) {
    const id = String(raw || "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const row = byId.get(id)
    if (row) out.push(toPublic(row))
  }
  return out
}

async function resolveDdSyncedMaterial(
  id: string,
  userId?: string,
): Promise<InvestmentNoteMaterial | null> {
  const parsed = parseDdSyncedMaterialId(id)
  if (!parsed) return null

  const note = userId ? getServerInvestmentNote(parsed.noteId, userId) : null
  if (userId && !note) return null
  const title = note?.title.trim() || "无标题"

  try {
    const file = await getKnowledgeBaseFile(parsed.relativePath)
    return {
      id,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType || mimeTypeForFilename(file.name),
      noteId: parsed.noteId,
      noteTitle: title,
      uploadedBy: "dd-table",
      uploadedByName: "尽调表格",
      createdAt: file.updatedAt,
      source: "dd-table",
    }
  } catch {
    return null
  }
}

export async function resolveInvestmentNoteMaterials(
  ids: string[],
  userId?: string,
): Promise<InvestmentNoteMaterial[]> {
  const out: InvestmentNoteMaterial[] = []
  const seen = new Set<string>()
  for (const raw of ids) {
    const id = String(raw || "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const stored = storedMaterialById(id)
    if (stored) {
      out.push(stored)
      continue
    }
    const synced = await resolveDdSyncedMaterial(id, userId)
    if (synced) out.push(synced)
  }
  return out
}

export function linkInvestmentNoteMaterial(
  id: string,
  noteId: string | null,
  userId: string,
): InvestmentNoteMaterial {
  const safeId = String(id || "").trim()
  if (!safeId) throw new Error("缺少资料 ID")
  if (parseDdSyncedMaterialId(safeId)) {
    throw new Error("尽调表格同步的资料请在尽调表格中管理关联")
  }

  const all = readAll()
  const idx = all.findIndex((row) => row.id === safeId)
  if (idx < 0) throw new Error("资料不存在")

  const link = resolveNoteForUser(noteId, userId)
  all[idx] = applyLinkedNoteToMaterial(all[idx], link)
  writeAll(all)
  return toPublic(all[idx])
}

export function linkInvestmentNoteMaterials(
  ids: string[],
  noteId: string,
  userId: string,
): InvestmentNoteMaterial[] {
  const wanted = new Set(
    ids.map((id) => String(id || "").trim()).filter(Boolean),
  )
  if (wanted.size === 0) return []

  const link = resolveNoteForUser(noteId, userId)
  const all = readAll()
  const updated: InvestmentNoteMaterial[] = []
  for (let i = 0; i < all.length; i++) {
    if (!wanted.has(all[i].id)) continue
    all[i] = applyLinkedNoteToMaterial(all[i], link)
    updated.push(toPublic(all[i]))
  }
  writeAll(all)
  return updated
}

export function deleteInvestmentNoteMaterial(id: string, userId: string): boolean {
  const safeId = String(id || "").trim()
  if (!safeId) return false
  if (parseDdSyncedMaterialId(safeId)) {
    throw new Error("尽调表格同步的资料请在尽调表格中删除")
  }
  const all = readAll()
  const idx = all.findIndex((row) => row.id === safeId)
  if (idx < 0) return false

  const row = all[idx]
  if (row.uploadedBy && row.uploadedBy !== userId) {
    throw new Error("只能删除自己上传的资料")
  }

  all.splice(idx, 1)
  writeAll(all)
  const stillReferenced = new Set(all.map((item) => item.storageFilename))
  removeStoredMaterialFiles([row], stillReferenced)
  return true
}

/** Persist cheap suffix cleanup such as `(1)(2)` / `-v1` on stored display names. */
export function cleanupInvestmentNoteMaterialDisplayNames(): InvestmentNoteMaterial[] {
  const all = readAll()
  const updated: InvestmentNoteMaterial[] = []
  let changed = false
  for (let i = 0; i < all.length; i++) {
    const ext = getExtension(all[i].name) || getExtension(all[i].storageFilename)
    const cleaned = displayNameWithExtension(all[i].name, ext)
    if (cleaned === all[i].name) continue
    all[i] = { ...all[i], name: cleaned }
    updated.push(toPublic(all[i]))
    changed = true
  }
  if (changed) writeAll(all)
  return updated
}

const AUTO_RENAME_BATCH = 8

/** Replace hash-like display names using file contents (or linked note title). */
export async function autoRenameOpaqueInvestmentNoteMaterials(): Promise<{
  materials: InvestmentNoteMaterial[]
  remaining: number
  deletedIds: string[]
}> {
  const all = readAll()
  const pending = all
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => !row.nameResolved && needsContentBasedMaterialRename(row.name))
    .slice(0, AUTO_RENAME_BATCH)

  const updated: InvestmentNoteMaterial[] = []
  for (const { row, idx } of pending) {
    try {
      const buffer = await fs.readFile(storagePathFor(row.storageFilename))
      const ext = getExtension(row.name) || getExtension(row.storageFilename)
      const display = await resolveInvestmentNoteMaterialDisplayName({
        originalName: row.name,
        ext,
        buffer,
        noteTitle: row.noteTitle,
      })
      all[idx] = {
        ...all[idx],
        name: display.name,
        nameResolved: true,
      }
      updated.push(toPublic(all[idx]))
    } catch (err) {
      console.error("[investment-note-materials] auto-rename", row.id, err)
      all[idx] = { ...all[idx], nameResolved: true }
    }
  }
  if (pending.length > 0) writeAll(all)
  const deleted = deduplicateInvestmentNoteMaterials()
  const deletedIds = new Set(deleted.map((row) => row.id))

  const remaining = readAll().filter(
    (row) => !row.nameResolved && needsContentBasedMaterialRename(row.name),
  ).length
  return {
    materials: updated.filter((row) => !deletedIds.has(row.id)),
    remaining,
    deletedIds: deleted.map((row) => row.id),
  }
}

export async function readInvestmentNoteMaterialFile(
  id: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
  const safeId = String(id || "").trim()
  if (!safeId) return null

  const kbPath =
    parseRoadshowDdMaterialAttachmentId(safeId) || parseDdSyncedMaterialId(safeId)?.relativePath
  if (kbPath) {
    try {
      const file = await getKnowledgeBaseFile(kbPath)
      const buffer = await fs.readFile(file.absolutePath)
      const resolved = resolveMaterialFileMeta(buffer, file.name, file.mimeType)
      return { buffer, filename: resolved.filename, mimeType: resolved.mimeType }
    } catch {
      return null
    }
  }

  const row = readAll().find((item) => item.id === safeId)
  if (!row) return null
  try {
    const buffer = await fs.readFile(storagePathFor(row.storageFilename))
    const resolved = resolveMaterialFileMeta(buffer, row.name, row.mimeType)
    return { buffer, filename: resolved.filename, mimeType: resolved.mimeType }
  } catch {
    return null
  }
}

/** Convert Word/Excel (and KB text docs) to HTML so the browser can preview them. */
export async function previewInvestmentNoteMaterialFile(
  id: string,
): Promise<{ content: string; contentType: string } | null> {
  const safeId = String(id || "").trim()
  if (!safeId) return null

  const kbPath =
    parseRoadshowDdMaterialAttachmentId(safeId) || parseDdSyncedMaterialId(safeId)?.relativePath
  if (kbPath) {
    try {
      const file = await getKnowledgeBaseFile(kbPath)
      if (!isKnowledgeBaseTextPreview(file.extension)) return null
      return await readKnowledgeBasePreviewContent(kbPath)
    } catch {
      return null
    }
  }

  const row = readAll().find((item) => item.id === safeId)
  if (!row) return null
  try {
    const absolutePath = storagePathFor(row.storageFilename)
    const buffer = await fs.readFile(absolutePath)
    const resolved = resolveMaterialFileMeta(buffer, row.name, row.mimeType)
    if (!HTML_PREVIEW_EXTENSIONS.has(getExtension(resolved.filename))) return null
    return await previewStoredDocument(absolutePath, resolved.filename)
  } catch {
    return null
  }
}

export async function zipInvestmentNoteAttachmentFiles(
  ids: string[],
): Promise<{ buffer: Buffer; count: number }> {
  const zip = new AdmZip()
  const used = new Set<string>()
  let count = 0
  for (const rawId of ids) {
    const file = await readInvestmentNoteMaterialFile(rawId)
    if (!file) continue
    zip.addFile(uniqueZipEntryName(file.filename, used), file.buffer)
    count += 1
  }
  if (count === 0) {
    throw new Error("没有可下载的附件")
  }
  return { buffer: zip.toBuffer(), count }
}
