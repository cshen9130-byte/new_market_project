import { query } from "@/lib/db"
import type { DueDiligenceTableRow, TableCellFormats } from "@/lib/ma/due-diligence-table"
import {
  DD_TABLE_COLUMNS,
  compactCellFormats,
  defaultDueDiligenceTableRowData,
  seedDueDiligenceTableRows,
} from "@/lib/ma/due-diligence-table"

export type DueDiligenceTableSnapshot = {
  rows: DueDiligenceTableRow[]
  formats: TableCellFormats
  updatedAt: string
  updatedBy: string
}

export type DueDiligenceTableBackupKind = "pre_reset" | "daily"

export type DueDiligenceTableBackupMeta = {
  id: number
  kind: DueDiligenceTableBackupKind
  rowCount: number
  sourceUpdatedAt: string | null
  sourceUpdatedBy: string
  createdAt: string
  createdBy: string
}

export type DueDiligenceTableBackup = DueDiligenceTableBackupMeta & {
  rows: DueDiligenceTableRow[]
  formats: TableCellFormats
}

const TEAM_ROW_ID = "team"
const DAILY_BACKUP_KEEP = 3
const PRE_RESET_BACKUP_KEEP = 10

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
  await query(`
    CREATE TABLE IF NOT EXISTS due_diligence_team_table_backups (
      id                 BIGSERIAL PRIMARY KEY,
      kind               TEXT NOT NULL,
      rows               JSONB NOT NULL DEFAULT '[]',
      formats            JSONB NOT NULL DEFAULT '{}',
      source_updated_at  TIMESTAMPTZ,
      source_updated_by  TEXT NOT NULL DEFAULT '',
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by         TEXT NOT NULL DEFAULT '',
      row_count          INT NOT NULL DEFAULT 0
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS due_diligence_team_table_backups_kind_created_idx
      ON due_diligence_team_table_backups (kind, created_at DESC)
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
    ddMaterialsKbPath:
      typeof r.ddMaterialsKbPath === "string" && r.ddMaterialsKbPath.trim()
        ? r.ddMaterialsKbPath.trim()
        : undefined,
    ddMaterialsLinkStatus:
      r.ddMaterialsLinkStatus === "approved"
      || r.ddMaterialsLinkStatus === "manual"
      || r.ddMaterialsLinkStatus === "rejected"
      || r.ddMaterialsLinkStatus === "auto"
        ? r.ddMaterialsLinkStatus
        : undefined,
    ddMaterialsFileLinks: sanitizeDdMaterialsFileLinks(r.ddMaterialsFileLinks),
  }
}

function sanitizeDdMaterialsFileLinks(
  value: unknown,
): Partial<Record<string, "approved" | "rejected">> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const out: Partial<Record<string, "approved" | "rejected">> = {}
  for (const [path, status] of Object.entries(value as Record<string, unknown>)) {
    const key = path.trim()
    if (!key) continue
    if (status === "approved" || status === "rejected") out[key] = status
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function sanitizeRows(value: unknown): DueDiligenceTableRow[] {
  if (!Array.isArray(value)) return []
  return value.map(sanitizeRow).filter((row): row is DueDiligenceTableRow => row !== null)
}

function sanitizeFormats(value: unknown, rowIds?: Set<string>): TableCellFormats {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return compactCellFormats(value as TableCellFormats, rowIds)
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
      formats: sanitizeFormats(parsed.formats, new Set(rows.map((row) => row.id))),
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

  const rowIds = new Set(sanitizedRows.map((row) => row.id))
  const updatedAt = rows[0].updated_at
  return {
    rows: sanitizedRows,
    formats: sanitizeFormats(rows[0].formats, rowIds),
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
    formats: sanitizeFormats(formats, new Set(sanitized.map((row) => row.id))),
    updatedAt: new Date().toISOString(),
    updatedBy: userName || "unknown",
  }
  await writeSnapshot(snapshot)
  return snapshot
}

function toBackupMeta(row: {
  id: string | number
  kind: string
  row_count: number
  source_updated_at: Date | string | null
  source_updated_by: string
  created_at: Date | string
  created_by: string
}): DueDiligenceTableBackupMeta | null {
  if (row.kind !== "pre_reset" && row.kind !== "daily") return null
  const createdAt =
    typeof row.created_at === "string"
      ? new Date(row.created_at).toISOString()
      : row.created_at.toISOString()
  const sourceUpdatedAt = row.source_updated_at
    ? typeof row.source_updated_at === "string"
      ? new Date(row.source_updated_at).toISOString()
      : row.source_updated_at.toISOString()
    : null
  return {
    id: Number(row.id),
    kind: row.kind,
    rowCount: Number(row.row_count) || 0,
    sourceUpdatedAt,
    sourceUpdatedBy: row.source_updated_by || "",
    createdAt,
    createdBy: row.created_by || "",
  }
}

async function pruneDueDiligenceTableBackups(): Promise<void> {
  await ensureTable()
  await query(
    `DELETE FROM due_diligence_team_table_backups
      WHERE kind = 'daily'
        AND id NOT IN (
          SELECT id FROM due_diligence_team_table_backups
           WHERE kind = 'daily'
           ORDER BY created_at DESC, id DESC
           LIMIT $1
        )`,
    [DAILY_BACKUP_KEEP],
  )
  await query(
    `DELETE FROM due_diligence_team_table_backups
      WHERE kind = 'pre_reset'
        AND id NOT IN (
          SELECT id FROM due_diligence_team_table_backups
           WHERE kind = 'pre_reset'
           ORDER BY created_at DESC, id DESC
           LIMIT $1
        )`,
    [PRE_RESET_BACKUP_KEEP],
  )
}

export async function createDueDiligenceTableBackup(
  kind: DueDiligenceTableBackupKind,
  createdBy: string,
  source?: DueDiligenceTableSnapshot | null,
): Promise<DueDiligenceTableBackupMeta | null> {
  await ensureTable()
  const snapshot = source ?? (await readSnapshot())
  if (!snapshot || snapshot.rows.length === 0) return null

  const inserted = await query<{
    id: string | number
    kind: string
    row_count: number
    source_updated_at: Date | string | null
    source_updated_by: string
    created_at: Date | string
    created_by: string
  }>(
    `INSERT INTO due_diligence_team_table_backups
       (kind, rows, formats, source_updated_at, source_updated_by, created_by, row_count)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::timestamptz, $5, $6, $7)
     RETURNING id, kind, row_count, source_updated_at, source_updated_by, created_at, created_by`,
    [
      kind,
      JSON.stringify(snapshot.rows),
      JSON.stringify(snapshot.formats),
      snapshot.updatedAt,
      snapshot.updatedBy || "",
      createdBy || "system",
      snapshot.rows.length,
    ],
  )
  await pruneDueDiligenceTableBackups()
  return inserted[0] ? toBackupMeta(inserted[0]) : null
}

export async function listDueDiligenceTableBackups(
  limit = 20,
): Promise<DueDiligenceTableBackupMeta[]> {
  await ensureTable()
  const rows = await query<{
    id: string | number
    kind: string
    row_count: number
    source_updated_at: Date | string | null
    source_updated_by: string
    created_at: Date | string
    created_by: string
  }>(
    `SELECT id, kind, row_count, source_updated_at, source_updated_by, created_at, created_by
       FROM due_diligence_team_table_backups
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
    [Math.max(1, Math.min(100, limit))],
  )
  return rows.map(toBackupMeta).filter((row): row is DueDiligenceTableBackupMeta => row !== null)
}

export async function getDueDiligenceTableBackup(
  backupId: number,
): Promise<DueDiligenceTableBackup | null> {
  await ensureTable()
  const rows = await query<{
    id: string | number
    kind: string
    rows: unknown
    formats: unknown
    row_count: number
    source_updated_at: Date | string | null
    source_updated_by: string
    created_at: Date | string
    created_by: string
  }>(
    `SELECT id, kind, rows, formats, row_count, source_updated_at, source_updated_by, created_at, created_by
       FROM due_diligence_team_table_backups
      WHERE id = $1
      LIMIT 1`,
    [backupId],
  )
  if (rows.length === 0) return null
  const meta = toBackupMeta(rows[0])
  if (!meta) return null
  const sanitizedRows = sanitizeRows(rows[0].rows)
  if (sanitizedRows.length === 0) return null
  return {
    ...meta,
    rows: sanitizedRows,
    formats: sanitizeFormats(rows[0].formats, new Set(sanitizedRows.map((row) => row.id))),
  }
}

export async function restoreDueDiligenceTableBackup(
  backupId: number,
  userName: string,
): Promise<DueDiligenceTableSnapshot> {
  const backup = await getDueDiligenceTableBackup(backupId)
  if (!backup) throw new Error("备份不存在")
  // Snapshot current live table before overwriting with a restore.
  await createDueDiligenceTableBackup("pre_reset", userName || "restore")
  return saveServerDueDiligenceTable(backup.rows, backup.formats, userName || "restore")
}

export async function resetServerDueDiligenceTableFromSeed(
  userName: string,
): Promise<{ snapshot: DueDiligenceTableSnapshot; backup: DueDiligenceTableBackupMeta | null }> {
  const existing = await readSnapshot()
  const backup = existing
    ? await createDueDiligenceTableBackup("pre_reset", userName || "reset", existing)
    : null
  const seeded = defaultSnapshot()
  seeded.updatedBy = userName || "reset"
  await writeSnapshot(seeded)
  return { snapshot: seeded, backup }
}

export async function createDailyDueDiligenceTableBackup(
  createdBy = "nightly_etl",
): Promise<DueDiligenceTableBackupMeta | null> {
  return createDueDiligenceTableBackup("daily", createdBy)
}
