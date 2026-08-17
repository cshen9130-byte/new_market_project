import { createHash } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import { query, withTransaction } from "@/lib/db"
import {
  type ExtractedFundElements,
  type FundMatchCandidate,
} from "@/lib/server/fund-contract-element-extract"
import { mimeTypeForFilename, previewStoredDocument } from "@/lib/server/fund-contract-materials"
import { getServerStoragePath } from "@/lib/server/storage"

export const EXTRACT_JOB_MAX_FILE_BYTES = 20 * 1024 * 1024
export const EXTRACT_JOB_MAX_FILES = 100

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

export const EXTRACT_JOB_STATUSES = [
  "queued",
  "extracting",
  "applied",
  "needs_review",
  "failed",
] as const

export type ExtractJobStatus = (typeof EXTRACT_JOB_STATUSES)[number]

export type ElementExtractJobRow = {
  id: number
  original_filename: string
  storage_filename: string
  file_size: number
  mime_type: string
  uploaded_by: string
  uploaded_at: string
  status: ExtractJobStatus
  beian_hao: string | null
  product_name: string | null
  extracted_json: ExtractedFundElements | null
  matched_funds: FundMatchCandidate[] | null
  text_preview: string | null
  applied_fields: string[] | null
  error_message: string | null
  processed_at: string | null
  contract_material_id: number | null
}

const JOB_SELECT_COLS = `
  id, original_filename, storage_filename, file_size, mime_type, uploaded_by,
  uploaded_at::text,
  status, beian_hao, product_name,
  extracted_json, matched_funds, text_preview, applied_fields,
  error_message, processed_at::text, contract_material_id
`

let tableReady: Promise<void> | null = null

function getExtension(fileName: string) {
  return path.extname(fileName).toLowerCase()
}

function sanitizeFilename(name: string) {
  return name.replace(/[^\w\u4e00-\u9fff.\-()+（）\s]/g, "_").replace(/\s+/g, " ").trim() || "contract.pdf"
}

export async function ensureElementExtractJobsTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS ops_element_extract_jobs (
          id                   BIGSERIAL PRIMARY KEY,
          original_filename    TEXT NOT NULL,
          storage_filename     TEXT NOT NULL UNIQUE,
          file_size            BIGINT NOT NULL DEFAULT 0,
          mime_type            TEXT NOT NULL DEFAULT 'application/octet-stream',
          uploaded_by          VARCHAR(255) NOT NULL DEFAULT '',
          uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          status               VARCHAR(32) NOT NULL DEFAULT 'queued',
          beian_hao            VARCHAR(64),
          product_name         TEXT,
          extracted_json       JSONB,
          matched_funds        JSONB,
          text_preview         TEXT,
          applied_fields       JSONB,
          error_message        TEXT,
          processed_at         TIMESTAMPTZ,
          contract_material_id INTEGER
        )
      `)
      await query(`
        CREATE INDEX IF NOT EXISTS idx_ops_element_extract_jobs_status
          ON ops_element_extract_jobs (status, uploaded_at DESC)
      `)
      await query(`
        CREATE INDEX IF NOT EXISTS idx_ops_element_extract_jobs_beian
          ON ops_element_extract_jobs (beian_hao)
      `)
    })().catch((err) => {
      tableReady = null
      throw err
    })
  }
  await tableReady
}

function mapJobRow(row: ElementExtractJobRow): ElementExtractJobRow {
  return {
    ...row,
    extracted_json: (row.extracted_json ?? null) as ExtractedFundElements | null,
    matched_funds: Array.isArray(row.matched_funds) ? row.matched_funds : null,
    applied_fields: Array.isArray(row.applied_fields)
      ? row.applied_fields
      : row.applied_fields
        ? (row.applied_fields as unknown as string[])
        : null,
  }
}

export function extractJobFilePath(storageFilename: string): string {
  return getServerStoragePath("fund-elements", "jobs", storageFilename)
}

export async function createElementExtractJob(input: {
  file: File
  uploaded_by?: string
}): Promise<ElementExtractJobRow> {
  await ensureElementExtractJobsTable()

  const originalFilename = sanitizeFilename(input.file.name || "contract.pdf")
  const ext = getExtension(originalFilename)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      "仅支持 PDF、Word (.doc/.docx)、Excel (.xls/.xlsx)、图片 (.png/.jpg/.jpeg/.gif/.webp/.bmp) 格式",
    )
  }
  if (input.file.size > EXTRACT_JOB_MAX_FILE_BYTES) {
    throw new Error("文件大小不能超过 20MB")
  }

  const buffer = Buffer.from(await input.file.arrayBuffer())
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16)
  const storageFilename = `${Date.now()}_${hash}${ext}`
  const storageDir = getServerStoragePath("fund-elements", "jobs")
  const storagePath = path.join(storageDir, storageFilename)

  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(storagePath, buffer)

  try {
    const rows = await query<ElementExtractJobRow>(
      `INSERT INTO ops_element_extract_jobs
         (original_filename, storage_filename, file_size, mime_type, uploaded_by, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')
       RETURNING ${JOB_SELECT_COLS}`,
      [
        originalFilename,
        storageFilename,
        buffer.byteLength,
        mimeTypeForFilename(originalFilename),
        input.uploaded_by?.trim() || "",
      ],
    )
    const row = rows[0]
    if (!row) throw new Error("创建提取任务失败")
    return mapJobRow(row)
  } catch (err) {
    await fs.unlink(storagePath).catch(() => undefined)
    throw err
  }
}

export async function listElementExtractJobs(input?: {
  status?: ExtractJobStatus | "all"
  q?: string
  limit?: number
  offset?: number
}): Promise<{ rows: ElementExtractJobRow[]; total: number }> {
  await ensureElementExtractJobsTable()
  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  if (input?.status && input.status !== "all") {
    conditions.push(`status = $${i++}`)
    params.push(input.status)
  }
  const q = input?.q?.trim()
  if (q) {
    conditions.push(`(
      original_filename ILIKE $${i}
      OR COALESCE(product_name, '') ILIKE $${i}
      OR COALESCE(beian_hao, '') ILIKE $${i}
    )`)
    params.push(`%${q}%`)
    i++
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = Math.min(200, Math.max(1, input?.limit ?? 50))
  const offset = Math.max(0, input?.offset ?? 0)

  const countRows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_element_extract_jobs ${where}`,
    params,
  )
  const total = parseInt(countRows[0]?.n || "0", 10)
  const rows = await query<ElementExtractJobRow>(
    `SELECT ${JOB_SELECT_COLS}
     FROM ops_element_extract_jobs
     ${where}
     ORDER BY uploaded_at DESC, id DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    [...params, limit, offset],
  )
  return { rows: rows.map(mapJobRow), total }
}

export async function listNeedsReviewExtractJobs(): Promise<ElementExtractJobRow[]> {
  await ensureElementExtractJobsTable()
  const rows = await query<ElementExtractJobRow>(
    `SELECT ${JOB_SELECT_COLS}
     FROM ops_element_extract_jobs
     WHERE status = 'needs_review'
     ORDER BY id ASC`,
  )
  return rows.map(mapJobRow)
}

export async function listAppliedExtractJobsByBeiAns(beiAns: string[]): Promise<ElementExtractJobRow[]> {
  await ensureElementExtractJobsTable()
  const codes = [...new Set(beiAns.map((code) => code.trim().toUpperCase()).filter(Boolean))]
  if (!codes.length) return []
  const rows = await query<ElementExtractJobRow>(
    `SELECT ${JOB_SELECT_COLS}
     FROM ops_element_extract_jobs
     WHERE status = 'applied' AND UPPER(BTRIM(beian_hao)) = ANY($1::text[])
     ORDER BY id DESC`,
    [codes],
  )
  return rows.map(mapJobRow)
}

export async function getElementExtractJobById(id: number): Promise<ElementExtractJobRow | null> {
  await ensureElementExtractJobsTable()
  if (!Number.isFinite(id)) return null
  const rows = await query<ElementExtractJobRow>(
    `SELECT ${JOB_SELECT_COLS} FROM ops_element_extract_jobs WHERE id = $1 LIMIT 1`,
    [id],
  )
  return rows[0] ? mapJobRow(rows[0]) : null
}

export async function readElementExtractJobFile(job: ElementExtractJobRow): Promise<Buffer> {
  return fs.readFile(extractJobFilePath(job.storage_filename))
}

export async function readElementExtractJobFilePayload(id: number): Promise<{
  buffer: Buffer
  filename: string
  mimeType: string
} | null> {
  const job = await getElementExtractJobById(id)
  if (!job) return null
  try {
    const buffer = await fs.readFile(extractJobFilePath(job.storage_filename))
    return {
      buffer,
      filename: job.original_filename,
      mimeType: job.mime_type || mimeTypeForFilename(job.original_filename),
    }
  } catch {
    return null
  }
}

export async function readElementExtractJobPreview(id: number) {
  const job = await getElementExtractJobById(id)
  if (!job) return null
  return previewStoredDocument(extractJobFilePath(job.storage_filename), job.original_filename)
}

export async function claimNextElementExtractJob(options?: {
  retryFailed?: boolean
}): Promise<ElementExtractJobRow | null> {
  await ensureElementExtractJobsTable()
  const retryFailed = options?.retryFailed === true
  return withTransaction(async (txQuery) => {
    const statusFilter = retryFailed
      ? `(status = 'queued'
          OR (status = 'extracting' AND processed_at < NOW() - INTERVAL '20 minutes')
          OR status = 'failed')`
      : `(status = 'queued'
          OR (status = 'extracting' AND processed_at < NOW() - INTERVAL '20 minutes'))`

    const claimed = await txQuery<{ id: number }>(
      `SELECT id FROM ops_element_extract_jobs
       WHERE ${statusFilter}
       ORDER BY
         CASE WHEN status = 'queued' THEN 0 WHEN status = 'extracting' THEN 1 ELSE 2 END,
         uploaded_at ASC, id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    )
    const id = claimed[0]?.id
    if (!id) return null
    const rows = await txQuery<ElementExtractJobRow>(
      `UPDATE ops_element_extract_jobs
       SET status = 'extracting', error_message = NULL, processed_at = NOW()
       WHERE id = $1
       RETURNING ${JOB_SELECT_COLS}`,
      [id],
    )
    return rows[0] ? mapJobRow(rows[0]) : null
  })
}

export async function updateElementExtractJob(
  id: number,
  patch: {
    status?: ExtractJobStatus
    beian_hao?: string | null
    product_name?: string | null
    extracted_json?: ExtractedFundElements | null
    matched_funds?: FundMatchCandidate[] | null
    text_preview?: string | null
    applied_fields?: string[] | null
    error_message?: string | null
    contract_material_id?: number | null
  },
): Promise<ElementExtractJobRow | null> {
  await ensureElementExtractJobsTable()
  const sets: string[] = ["processed_at = NOW()"]
  const params: unknown[] = []
  let i = 1
  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`)
    params.push(patch.status)
  }
  if (patch.beian_hao !== undefined) {
    sets.push(`beian_hao = $${i++}`)
    params.push(patch.beian_hao)
  }
  if (patch.product_name !== undefined) {
    sets.push(`product_name = $${i++}`)
    params.push(patch.product_name)
  }
  if (patch.extracted_json !== undefined) {
    sets.push(`extracted_json = $${i++}::jsonb`)
    params.push(patch.extracted_json == null ? null : JSON.stringify(patch.extracted_json))
  }
  if (patch.matched_funds !== undefined) {
    sets.push(`matched_funds = $${i++}::jsonb`)
    params.push(patch.matched_funds == null ? null : JSON.stringify(patch.matched_funds))
  }
  if (patch.text_preview !== undefined) {
    sets.push(`text_preview = $${i++}`)
    params.push(patch.text_preview)
  }
  if (patch.applied_fields !== undefined) {
    sets.push(`applied_fields = $${i++}::jsonb`)
    params.push(patch.applied_fields == null ? null : JSON.stringify(patch.applied_fields))
  }
  if (patch.error_message !== undefined) {
    sets.push(`error_message = $${i++}`)
    params.push(patch.error_message)
  }
  if (patch.contract_material_id !== undefined) {
    sets.push(`contract_material_id = $${i++}`)
    params.push(patch.contract_material_id)
  }
  params.push(id)
  const rows = await query<ElementExtractJobRow>(
    `UPDATE ops_element_extract_jobs
     SET ${sets.join(", ")}
     WHERE id = $${i}
     RETURNING ${JOB_SELECT_COLS}`,
    params,
  )
  return rows[0] ? mapJobRow(rows[0]) : null
}

export async function requeueElementExtractJob(id: number): Promise<ElementExtractJobRow | null> {
  await ensureElementExtractJobsTable()
  const rows = await query<ElementExtractJobRow>(
    `UPDATE ops_element_extract_jobs
     SET status = 'queued', error_message = NULL, processed_at = NULL
     WHERE id = $1 AND status IN ('failed', 'needs_review', 'queued')
     RETURNING ${JOB_SELECT_COLS}`,
    [id],
  )
  return rows[0] ? mapJobRow(rows[0]) : null
}

export async function countQueuedElementExtractJobs(): Promise<number> {
  await ensureElementExtractJobsTable()
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_element_extract_jobs WHERE status IN ('queued', 'extracting')`,
  )
  return parseInt(rows[0]?.n || "0", 10)
}
