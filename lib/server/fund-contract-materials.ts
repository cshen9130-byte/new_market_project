import { createHash } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import mammoth from "mammoth"
import * as XLSX from "xlsx"
import { query } from "@/lib/db"
import { readFileDocumentText } from "@/lib/server/knowledge-base"
import { getServerStoragePath } from "@/lib/server/storage"

const MAX_FILE_BYTES = 20 * 1024 * 1024
const HTML_PREVIEW_EXTENSIONS = new Set([".doc", ".docx", ".xls", ".xlsx"])

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

export type FundContractMaterialRow = {
  id: number
  beian_hao: string
  original_filename: string
  file_size: number
  mime_type: string
  uploaded_by: string
  uploaded_at: string
  /** YYYY-MM-DD when set; shown as a marker on the product NAV chart */
  chart_date: string | null
  /** Short label for tooltip / list; empty falls back to filename */
  title: string
}

const MATERIAL_SELECT_COLS = `
  id, beian_hao, original_filename, file_size, mime_type, uploaded_by,
  uploaded_at::text,
  CASE WHEN chart_date IS NULL THEN NULL ELSE to_char(chart_date, 'YYYY-MM-DD') END AS chart_date,
  COALESCE(title, '') AS title
`

function normalizeChartDate(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim()
  if (!raw) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("关联净值日期格式应为 YYYY-MM-DD")
  }
  const ts = new Date(`${raw}T00:00:00`).getTime()
  if (!Number.isFinite(ts)) throw new Error("关联净值日期无效")
  return raw
}

function normalizeTitle(value: string | null | undefined): string {
  return (value ?? "").trim().slice(0, 120)
}

function getExtension(fileName: string) {
  return path.extname(fileName).toLowerCase()
}

function mimeTypeForFilename(fileName: string) {
  const ext = getExtension(fileName)
  if (ext === ".pdf") return "application/pdf"
  if (ext === ".doc") return "application/msword"
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  if (ext === ".xls") return "application/vnd.ms-excel"
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".gif") return "image/gif"
  if (ext === ".webp") return "image/webp"
  if (ext === ".bmp") return "image/bmp"
  return "application/octet-stream"
}

function sanitizeFilename(name: string) {
  return name.replace(/[^\w\u4e00-\u9fff.\-()+（）\s]/g, "_").replace(/\s+/g, " ").trim() || "contract.pdf"
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function buildPreviewHtml(title: string, body: string) {
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
        padding: 24px;
        background: #ffffff;
        color: #111827;
        line-height: 1.6;
        word-break: break-word;
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
  <body>${body}</body>
</html>`
}

export function needsHtmlPreview(filename: string) {
  return HTML_PREVIEW_EXTENSIONS.has(getExtension(filename))
}

export async function ensureFundContractMaterialsTable() {
  await ensureTable()
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
      uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      chart_date        DATE,
      title             TEXT NOT NULL DEFAULT ''
    )
  `)
  await query(`
    ALTER TABLE ops_fund_contract_materials
      ADD COLUMN IF NOT EXISTS chart_date DATE
  `)
  await query(`
    ALTER TABLE ops_fund_contract_materials
      ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_ops_fund_contract_materials_beian
      ON ops_fund_contract_materials (beian_hao, uploaded_at DESC)
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_ops_fund_contract_materials_chart
      ON ops_fund_contract_materials (beian_hao, chart_date)
      WHERE chart_date IS NOT NULL
  `)
}

export async function listFundContractMaterials(beian_hao: string): Promise<FundContractMaterialRow[]> {
  await ensureTable()
  return query<FundContractMaterialRow>(
    `SELECT ${MATERIAL_SELECT_COLS}
     FROM ops_fund_contract_materials
     WHERE beian_hao = $1
     ORDER BY uploaded_at DESC, id DESC`,
    [beian_hao.trim()],
  )
}

export async function saveFundContractMaterialFromBuffer(input: {
  beian_hao: string
  buffer: Buffer
  originalFilename: string
  uploaded_by?: string
  chart_date?: string | null
  title?: string | null
}): Promise<FundContractMaterialRow> {
  const beian_hao = input.beian_hao.trim()
  if (!beian_hao) throw new Error("missing beian_hao")

  const originalFilename = sanitizeFilename(input.originalFilename || "contract.pdf")
  const ext = getExtension(originalFilename)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      "仅支持 PDF、Word (.doc/.docx)、Excel (.xls/.xlsx)、图片 (.png/.jpg/.jpeg/.gif/.webp/.bmp) 格式",
    )
  }
  if (input.buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error("文件大小不能超过 20MB")
  }

  const chartDate = normalizeChartDate(input.chart_date)
  const title = normalizeTitle(input.title)

  const hash = createHash("sha256").update(input.buffer).digest("hex").slice(0, 16)
  const storageFilename = `${beian_hao}_${Date.now()}_${hash}${ext}`
  const storageDir = getServerStoragePath("fund-contracts", beian_hao)
  const storagePath = path.join(storageDir, storageFilename)

  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(storagePath, input.buffer)

  await ensureTable()
  const rows = await query<FundContractMaterialRow>(
    `INSERT INTO ops_fund_contract_materials
       (beian_hao, original_filename, storage_filename, file_size, mime_type, uploaded_by, uploaded_at, chart_date, title)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7::date, $8)
     RETURNING ${MATERIAL_SELECT_COLS}`,
    [
      beian_hao,
      originalFilename,
      storageFilename,
      input.buffer.byteLength,
      mimeTypeForFilename(originalFilename),
      input.uploaded_by?.trim() || "",
      chartDate,
      title,
    ],
  )

  const row = rows[0]
  if (!row) throw new Error("保存合同失败")
  return row
}

export async function saveFundContractMaterial(input: {
  beian_hao: string
  file: File
  uploaded_by?: string
  chart_date?: string | null
  title?: string | null
}): Promise<FundContractMaterialRow> {
  const buffer = Buffer.from(await input.file.arrayBuffer())
  return saveFundContractMaterialFromBuffer({
    beian_hao: input.beian_hao,
    buffer,
    originalFilename: input.file.name || "contract.pdf",
    uploaded_by: input.uploaded_by,
    chart_date: input.chart_date,
    title: input.title,
  })
}

export async function updateFundContractMaterialMeta(
  id: number,
  input: { chart_date?: string | null; title?: string | null },
): Promise<FundContractMaterialRow | null> {
  if (!Number.isFinite(id)) return null
  await ensureTable()

  const existing = await query<{ id: number }>(
    `SELECT id FROM ops_fund_contract_materials WHERE id = $1 LIMIT 1`,
    [id],
  )
  if (!existing[0]) return null

  const sets: string[] = []
  const params: unknown[] = []
  let idx = 1

  if ("chart_date" in input) {
    const chartDate = normalizeChartDate(input.chart_date)
    sets.push(`chart_date = $${idx++}::date`)
    params.push(chartDate)
  }
  if ("title" in input) {
    sets.push(`title = $${idx++}`)
    params.push(normalizeTitle(input.title))
  }
  if (!sets.length) {
    const rows = await query<FundContractMaterialRow>(
      `SELECT ${MATERIAL_SELECT_COLS} FROM ops_fund_contract_materials WHERE id = $1 LIMIT 1`,
      [id],
    )
    return rows[0] ?? null
  }

  params.push(id)
  const rows = await query<FundContractMaterialRow>(
    `UPDATE ops_fund_contract_materials
     SET ${sets.join(", ")}
     WHERE id = $${idx}
     RETURNING ${MATERIAL_SELECT_COLS}`,
    params,
  )
  return rows[0] ?? null
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

export async function previewStoredDocument(absolutePath: string, originalFilename: string) {
  const ext = getExtension(originalFilename)
  if (!HTML_PREVIEW_EXTENSIONS.has(ext)) return null

  if (ext === ".docx") {
    try {
      const buffer = await fs.readFile(absolutePath)
      const parsed = await mammoth.convertToHtml({ buffer })
      if (parsed.value) {
        return {
          content: buildPreviewHtml(originalFilename, parsed.value),
          contentType: "text/html; charset=utf-8",
        }
      }
    } catch {
      // fall through
    }
  }

  if (ext === ".xlsx" || ext === ".xls") {
    try {
      const workbook = XLSX.read(await fs.readFile(absolutePath), { type: "buffer" })
      const sections = workbook.SheetNames.map((sheetName) => {
        const worksheet = workbook.Sheets[sheetName]
        const sheetHtml = XLSX.utils.sheet_to_html(worksheet)
        return `<section><h2>${escapeHtml(sheetName)}</h2>${sheetHtml}</section>`
      }).join("")
      if (sections) {
        return {
          content: buildPreviewHtml(originalFilename, sections),
          contentType: "text/html; charset=utf-8",
        }
      }
    } catch {
      // fall through
    }
  }

  const text = await readFileDocumentText(absolutePath, ext)
  const body = ext === ".doc" || ext === ".docx"
    ? text.split(/\n+/).filter((p: string) => p.trim()).map((p: string) => `<p>${escapeHtml(p.trim())}</p>`).join("\n")
    : `<pre>${escapeHtml(text)}</pre>`
  return {
    content: buildPreviewHtml(originalFilename, body),
    contentType: "text/html; charset=utf-8",
  }
}

export async function readFundContractMaterialPreview(id: number) {
  const row = await getFundContractMaterialById(id)
  if (!row) return null
  const absolutePath = getServerStoragePath("fund-contracts", row.beian_hao, row.storage_filename)
  return previewStoredDocument(absolutePath, row.original_filename)
}

export async function deleteFundContractMaterial(id: number): Promise<boolean> {
  const row = await getFundContractMaterialById(id)
  if (!row) return false

  await query(`DELETE FROM ops_fund_contract_materials WHERE id = $1`, [id])

  const absolutePath = getServerStoragePath("fund-contracts", row.beian_hao, row.storage_filename)
  await fs.unlink(absolutePath).catch(() => undefined)
  return true
}

export { mimeTypeForFilename }
