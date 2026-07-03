import { query } from "@/lib/db"
import type { DueDiligenceTableRow, TableCellFormats } from "@/lib/ma/due-diligence-table"
import {
  DD_TABLE_COLUMNS,
  defaultDueDiligenceTableRowData,
  seedDueDiligenceTableRows,
} from "@/lib/ma/due-diligence-table"

export type DueDiligenceTableSnapshot = {
  rows: DueDiligenceTableRow[]
  formats: TableCellFormats
  updatedAt: string
  updatedBy: string
}

const TEAM_ROW_ID = "team"

let initPromise: Promise<void> | null = null

function ensureTable(): Promise<void> {
  if (!initPromise) {
    initPromise = _ensureTable().catch((e) => {
      initPromise = null
      throw e
    })
  }
  return initPromise
}

async function _ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS due_diligence_team_table (
      id          TEXT PRIMARY KEY,
      rows        JSONB NOT NULL DEFAULT '[]',
      formats     JSONB NOT NULL DEFAULT '{}',
      updated_by  TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

function sanitizeRow(row: unknown): DueDiligenceTableRow | null {
  if (!row || typeof row !== "object") return null
  const r = row as Partial<DueDiligenceTableRow> & Record<string, unknown>
  if (typeof r.id !== "string" || !r.id.trim()) return null
  const data = defaultDueDiligenceTableRowData()
  for (const col of DD_TABLE_COLUMNS) {
    data[col.key] = String(r[col.key] ?? "").trim()
  }
  const now = new Date().toISOString()
  return {
    ...data,
    id: r.id,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : now,
    fundId: typeof r.fundId === "string" ? r.fundId : undefined,
    representativeProductBeianHao:
      typeof r.representativeProductBeianHao === "string" && r.representativeProductBeianHao.trim()
        ? r.representativeProductBeianHao.trim()
        : undefined,
  }
}

function sanitizeRows(value: unknown): DueDiligenceTableRow[] {
  if (!Array.isArray(value)) return []
  return value.map(sanitizeRow).filter((row): row is DueDiligenceTableRow => row !== null)
}

function sanitizeFormats(value: unknown): TableCellFormats {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as TableCellFormats
}

function defaultSnapshot(): DueDiligenceTableSnapshot {
  const now = new Date().toISOString()
  return {
    rows: seedDueDiligenceTableRows(),
    formats: {},
    updatedAt: now,
    updatedBy: "system",
  }
}

async function migrateFromLegacyFile(): Promise<DueDiligenceTableSnapshot | null> {
  try {
    const { existsSync, readFileSync } = await import("fs")
    const path = await import("path")
    const { getServerStoragePath } = await import("@/lib/server/storage")
    const file = path.join(getServerStoragePath("due-diligence-table"), "team-table.json")
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as Partial<DueDiligenceTableSnapshot>
    const rows = sanitizeRows(parsed.rows)
    if (rows.length === 0) return null
    return {
      rows,
      formats: sanitizeFormats(parsed.formats),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : "migration",
    }
  } catch {
    return null
  }
}

async function readSnapshot(): Promise<DueDiligenceTableSnapshot | null> {
  await ensureTable()
  const rows = await query<{
    rows: unknown
    formats: unknown
    updated_by: string
    updated_at: Date | string
  }>(
    `SELECT rows, formats, updated_by, updated_at
       FROM due_diligence_team_table
      WHERE id = $1
      LIMIT 1`,
    [TEAM_ROW_ID],
  )
  if (rows.length === 0) return null

  const sanitizedRows = sanitizeRows(rows[0].rows)
  if (sanitizedRows.length === 0) return null

  const updatedAt = rows[0].updated_at
  return {
    rows: sanitizedRows,
    formats: sanitizeFormats(rows[0].formats),
    updatedAt:
      typeof updatedAt === "string"
        ? new Date(updatedAt).toISOString()
        : updatedAt.toISOString(),
    updatedBy: rows[0].updated_by || "",
  }
}

async function writeSnapshot(snapshot: DueDiligenceTableSnapshot): Promise<void> {
  await ensureTable()
  await query(
    `INSERT INTO due_diligence_team_table (id, rows, formats, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4, $5::timestamptz)
     ON CONFLICT (id)
     DO UPDATE SET
       rows = EXCLUDED.rows,
       formats = EXCLUDED.formats,
       updated_by = EXCLUDED.updated_by,
       updated_at = EXCLUDED.updated_at`,
    [
      TEAM_ROW_ID,
      JSON.stringify(snapshot.rows),
      JSON.stringify(snapshot.formats),
      snapshot.updatedBy,
      snapshot.updatedAt,
    ],
  )
}

export async function getServerDueDiligenceTable(): Promise<DueDiligenceTableSnapshot> {
  const existing = await readSnapshot()
  if (existing) return existing

  const migrated = await migrateFromLegacyFile()
  if (migrated) {
    await writeSnapshot(migrated)
    return migrated
  }

  const seeded = defaultSnapshot()
  await writeSnapshot(seeded)
  return seeded
}

export async function saveServerDueDiligenceTable(
  rows: DueDiligenceTableRow[],
  formats: TableCellFormats,
  userName: string,
): Promise<DueDiligenceTableSnapshot> {
  const sanitized = sanitizeRows(rows)
  if (sanitized.length === 0) {
    throw new Error("表格不能为空")
  }
  const snapshot: DueDiligenceTableSnapshot = {
    rows: sanitized,
    formats: sanitizeFormats(formats),
    updatedAt: new Date().toISOString(),
    updatedBy: userName || "unknown",
  }
  await writeSnapshot(snapshot)
  return snapshot
}
