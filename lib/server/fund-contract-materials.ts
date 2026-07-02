import { createHash } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import { query } from "@/lib/db"
import { getServerStoragePath } from "@/lib/server/storage"

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set([".pdf", ".doc", ".docx"])

export type FundContractMaterialRow = {
  id: number
  beian_hao: string
  original_filename: string
  file_size: number
  mime_type: string
  uploaded_by: string
  uploaded_at: string
}

function getExtension(fileName: string) {
  return path.extname(fileName).toLowerCase()
}

function mimeTypeForFilename(fileName: string) {
  const ext = getExtension(fileName)
  if (ext === ".pdf") return "application/pdf"
  if (ext === ".doc") return "application/msword"
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  return "application/octet-stream"
}

function sanitizeFilename(name: string) {
  return name.replace(/[^\w\u4e00-\u9fff.\-()+（）\s]/g, "_").replace(/\s+/g, " ").trim() || "contract.pdf"
}

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ops_fund_contract_materials (
      id                SERIAL PRIMARY KEY,
      beian_hao         VARCHAR(64) NOT NULL,
      original_filename TEXT NOT NULL,
      storage_filename  TEXT NOT NULL UNIQUE,
      file_size         BIGINT NOT NULL DEFAULT 0,
      mime_type         TEXT NOT NULL DEFAULT 'application/octet-stream',
      uploaded_by       VARCHAR(255) NOT NULL DEFAULT '',
      uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_ops_fund_contract_materials_beian
      ON ops_fund_contract_materials (beian_hao, uploaded_at DESC)
  `)
}

export async function listFundContractMaterials(beian_hao: string): Promise<FundContractMaterialRow[]> {
  await ensureTable()
  return query<FundContractMaterialRow>(
    `SELECT id, beian_hao, original_filename, file_size, mime_type, uploaded_by, uploaded_at::text
     FROM ops_fund_contract_materials
     WHERE beian_hao = $1
     ORDER BY uploaded_at DESC, id DESC`,
    [beian_hao.trim()],
  )
}

export async function saveFundContractMaterial(input: {
  beian_hao: string
  file: File
  uploaded_by?: string
}): Promise<FundContractMaterialRow> {
  const beian_hao = input.beian_hao.trim()
  if (!beian_hao) throw new Error("missing beian_hao")

  const originalFilename = sanitizeFilename(input.file.name || "contract.pdf")
  const ext = getExtension(originalFilename)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("仅支持 PDF、Word (.doc/.docx) 格式的基金合同")
  }
  if (input.file.size > MAX_FILE_BYTES) {
    throw new Error("文件大小不能超过 5MB")
  }

  const buffer = Buffer.from(await input.file.arrayBuffer())
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16)
  const storageFilename = `${beian_hao}_${Date.now()}_${hash}${ext}`
  const storageDir = getServerStoragePath("fund-contracts", beian_hao)
  const storagePath = path.join(storageDir, storageFilename)

  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(storagePath, buffer)

  await ensureTable()
  const rows = await query<FundContractMaterialRow>(
    `INSERT INTO ops_fund_contract_materials
       (beian_hao, original_filename, storage_filename, file_size, mime_type, uploaded_by, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id, beian_hao, original_filename, file_size, mime_type, uploaded_by, uploaded_at::text`,
    [
      beian_hao,
      originalFilename,
      storageFilename,
      buffer.byteLength,
      mimeTypeForFilename(originalFilename),
      input.uploaded_by?.trim() || "",
    ],
  )

  const row = rows[0]
  if (!row) throw new Error("保存合同失败")
  return row
}

export async function getFundContractMaterialById(id: number) {
  await ensureTable()
  const rows = await query<{
    id: number
    beian_hao: string
    original_filename: string
    storage_filename: string
    mime_type: string
  }>(
    `SELECT id, beian_hao, original_filename, storage_filename, mime_type
     FROM ops_fund_contract_materials
     WHERE id = $1
     LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

export async function readFundContractMaterialFile(id: number) {
  const row = await getFundContractMaterialById(id)
  if (!row) return null

  const absolutePath = getServerStoragePath("fund-contracts", row.beian_hao, row.storage_filename)
  try {
    const buffer = await fs.readFile(absolutePath)
    return {
      buffer,
      filename: row.original_filename,
      mimeType: row.mime_type || mimeTypeForFilename(row.original_filename),
    }
  } catch {
    return null
  }
}

export { mimeTypeForFilename }
