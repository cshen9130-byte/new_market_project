/**
 * Shared disk + Postgres meta for instruction 合同 / 确认函 uploads.
 * Client IndexedDB remains an optional cache only.
 */

import { createHash } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import { query } from "@/lib/db"
import { getServerStoragePath } from "@/lib/server/storage"

export type InstructionAttachmentMeta = {
  id: string
  name: string
  size: number
  uploadedAt: string
  source: "upload"
}

export type InstructionAttachmentRow = {
  id: string
  original_filename: string
  storage_filename: string
  mime_type: string
  file_size: number
  uploaded_by: string
  created_at: string
}

const MAX_FILE_BYTES = 15 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set([
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

let initPromise: Promise<void> | null = null

function sanitizeFilename(name: string): string {
  return (
    name.replace(/[^\w\u4e00-\u9fff.\-()+（）\s]/g, "_").replace(/\s+/g, " ").trim()
    || "attachment.pdf"
  )
}

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase()
}

function mimeTypeForFilename(fileName: string, fallback?: string): string {
  const ext = getExtension(fileName)
  if (ext === ".pdf") return "application/pdf"
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".gif") return "image/gif"
  if (ext === ".webp") return "image/webp"
  if (ext === ".bmp") return "image/bmp"
  if (ext === ".xls") return "application/vnd.ms-excel"
  if (ext === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
  if (ext === ".doc") return "application/msword"
  if (ext === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  return fallback?.trim() || "application/octet-stream"
}

function createAttachmentId(): string {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

async function ensureTable() {
  if (!initPromise) {
    initPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS ops_instruction_attachments (
          id                 TEXT PRIMARY KEY,
          original_filename  TEXT NOT NULL,
          storage_filename   TEXT NOT NULL UNIQUE,
          mime_type          TEXT NOT NULL DEFAULT 'application/octet-stream',
          file_size          BIGINT NOT NULL DEFAULT 0,
          uploaded_by        VARCHAR(255) NOT NULL DEFAULT '',
          created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      await query(`
        CREATE INDEX IF NOT EXISTS idx_ops_instruction_attachments_created
          ON ops_instruction_attachments (created_at DESC)
      `)
    })().catch((e) => {
      initPromise = null
      throw e
    })
  }
  await initPromise
}

function storageDir(): string {
  return getServerStoragePath("instruction-attachments")
}

function storagePathFor(storageFilename: string): string {
  return path.join(storageDir(), storageFilename)
}

export async function saveInstructionAttachment(input: {
  file: File
  uploadedBy?: string
  id?: string
}): Promise<InstructionAttachmentMeta> {
  const originalFilename = sanitizeFilename(input.file.name || "attachment.pdf")
  const ext = getExtension(originalFilename)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      "仅支持 PDF、Word (.doc/.docx)、Excel (.xls/.xlsx)、图片 (.png/.jpg/.jpeg/.gif/.webp/.bmp) 格式",
    )
  }
  if (input.file.size > MAX_FILE_BYTES) {
    throw new Error("文件大小不能超过 15MB")
  }

  const buffer = Buffer.from(await input.file.arrayBuffer())
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16)
  const id = (input.id || "").trim() || createAttachmentId()
  const storageFilename = `${id}_${hash}${ext}`
  const mimeType = mimeTypeForFilename(originalFilename, input.file.type)
  const uploadedBy = (input.uploadedBy || "").trim()
  const dir = storageDir()
  const fullPath = storagePathFor(storageFilename)

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(fullPath, buffer)
  await ensureTable()

  const rows = await query<{ created_at: string }>(
    `INSERT INTO ops_instruction_attachments
       (id, original_filename, storage_filename, mime_type, file_size, uploaded_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET
       original_filename = EXCLUDED.original_filename,
       storage_filename = EXCLUDED.storage_filename,
       mime_type = EXCLUDED.mime_type,
       file_size = EXCLUDED.file_size,
       uploaded_by = EXCLUDED.uploaded_by
     RETURNING created_at::text AS created_at`,
    [id, originalFilename, storageFilename, mimeType, buffer.length, uploadedBy],
  )

  return {
    id,
    name: originalFilename,
    size: buffer.length,
    uploadedAt: rows[0]?.created_at || new Date().toISOString(),
    source: "upload",
  }
}

export async function getInstructionAttachmentRow(
  id: string,
): Promise<InstructionAttachmentRow | null> {
  await ensureTable()
  const safeId = String(id || "").trim()
  if (!safeId) return null
  const rows = await query<InstructionAttachmentRow>(
    `SELECT id, original_filename, storage_filename, mime_type, file_size,
            uploaded_by, created_at::text AS created_at
       FROM ops_instruction_attachments
      WHERE id = $1
      LIMIT 1`,
    [safeId],
  )
  return rows[0] ?? null
}

export async function readInstructionAttachmentFile(
  id: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
  const row = await getInstructionAttachmentRow(id)
  if (!row) return null
  const fullPath = storagePathFor(row.storage_filename)
  try {
    const buffer = await fs.readFile(fullPath)
    return {
      buffer,
      filename: row.original_filename,
      mimeType: row.mime_type || mimeTypeForFilename(row.original_filename),
    }
  } catch {
    return null
  }
}
