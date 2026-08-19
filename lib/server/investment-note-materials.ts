/**
 * Disk + JSON meta for investment-note「上传资料」files.
 * Files live under investment-notes/materials/; index in materials.json.
 */

import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import { promises as fs } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"
import { listServerInvestmentNotes } from "@/lib/server/investment-notes"

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
}

type StoredMaterial = InvestmentNoteMaterial & {
  storageFilename: string
}

const MAX_FILE_BYTES = 50 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
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

function sanitizeFilename(name: string): string {
  return (
    name.replace(/[^\w\u4e00-\u9fff.\-()+（）\s]/g, "_").replace(/\s+/g, " ").trim() ||
    "material.bin"
  )
}

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase()
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
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".zip": "application/zip",
  }
  return map[ext] || fallback?.trim() || "application/octet-stream"
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
  }
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
  }
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

export function listInvestmentNoteMaterials(): InvestmentNoteMaterial[] {
  return readAll()
    .map(toPublic)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export async function saveInvestmentNoteMaterial(input: {
  file: File
  uploadedBy: string
  uploadedByName: string
  noteId?: string | null
}): Promise<InvestmentNoteMaterial> {
  const originalFilename = sanitizeFilename(input.file.name || "material.bin")
  const ext = getExtension(originalFilename)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      "仅支持 PDF、Office、图片、TXT/CSV、ZIP 等常见格式",
    )
  }
  if (input.file.size > MAX_FILE_BYTES) {
    throw new Error("文件大小不能超过 50MB")
  }

  const link = resolveNoteForUser(input.noteId, input.uploadedBy)
  const buffer = Buffer.from(await input.file.arrayBuffer())
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16)
  const id = createMaterialId()
  const storageFilename = `${id}_${hash}${ext}`
  const mimeType = mimeTypeForFilename(originalFilename, input.file.type)

  ensureDirs()
  await fs.writeFile(storagePathFor(storageFilename), buffer)

  const row: StoredMaterial = {
    id,
    name: originalFilename,
    size: buffer.length,
    mimeType,
    storageFilename,
    noteId: link.noteId,
    noteTitle: link.noteTitle,
    uploadedBy: input.uploadedBy,
    uploadedByName: input.uploadedByName,
    createdAt: new Date().toISOString(),
  }

  const all = readAll()
  all.unshift(row)
  writeAll(all)
  return toPublic(row)
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

export function linkInvestmentNoteMaterial(
  id: string,
  noteId: string | null,
  userId: string,
): InvestmentNoteMaterial {
  const safeId = String(id || "").trim()
  if (!safeId) throw new Error("缺少资料 ID")

  const all = readAll()
  const idx = all.findIndex((row) => row.id === safeId)
  if (idx < 0) throw new Error("资料不存在")

  const link = resolveNoteForUser(noteId, userId)
  all[idx] = {
    ...all[idx],
    noteId: link.noteId,
    noteTitle: link.noteTitle,
  }
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
    all[i] = {
      ...all[i],
      noteId: link.noteId,
      noteTitle: link.noteTitle,
    }
    updated.push(toPublic(all[i]))
  }
  writeAll(all)
  return updated
}

export function deleteInvestmentNoteMaterial(id: string, userId: string): boolean {
  const safeId = String(id || "").trim()
  if (!safeId) return false
  const all = readAll()
  const idx = all.findIndex((row) => row.id === safeId)
  if (idx < 0) return false

  const row = all[idx]
  if (row.uploadedBy && row.uploadedBy !== userId) {
    throw new Error("只能删除自己上传的资料")
  }

  all.splice(idx, 1)
  writeAll(all)
  try {
    unlinkSync(storagePathFor(row.storageFilename))
  } catch {
    // ignore missing file on disk
  }
  return true
}

export async function readInvestmentNoteMaterialFile(
  id: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
  const safeId = String(id || "").trim()
  if (!safeId) return null
  const row = readAll().find((item) => item.id === safeId)
  if (!row) return null
  try {
    const buffer = await fs.readFile(storagePathFor(row.storageFilename))
    return {
      buffer,
      filename: row.name,
      mimeType: row.mimeType || mimeTypeForFilename(row.name),
    }
  } catch {
    return null
  }
}
