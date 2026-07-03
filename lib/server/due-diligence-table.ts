import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"
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

function storageDir() {
  return getServerStoragePath("due-diligence-table")
}

function storageFile() {
  return path.join(storageDir(), "team-table.json")
}

function ensureStorageDir() {
  mkdirSync(storageDir(), { recursive: true })
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

function sanitizeFormats(value: unknown): TableCellFormats {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as TableCellFormats
}

function readSnapshot(): DueDiligenceTableSnapshot | null {
  ensureStorageDir()
  const file = storageFile()
  if (!existsSync(file)) return null

  try {
    const raw = readFileSync(file, "utf-8")
    const parsed = JSON.parse(raw) as Partial<DueDiligenceTableSnapshot>
    const rows = Array.isArray(parsed.rows)
      ? parsed.rows.map(sanitizeRow).filter((row): row is DueDiligenceTableRow => row !== null)
      : []
    if (rows.length === 0) return null
    return {
      rows,
      formats: sanitizeFormats(parsed.formats),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : "",
    }
  } catch {
    return null
  }
}

function writeSnapshot(snapshot: DueDiligenceTableSnapshot) {
  ensureStorageDir()
  writeFileSync(storageFile(), JSON.stringify(snapshot, null, 2), "utf-8")
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

export function getServerDueDiligenceTable(): DueDiligenceTableSnapshot {
  const existing = readSnapshot()
  if (existing) return existing
  const seeded = defaultSnapshot()
  writeSnapshot(seeded)
  return seeded
}

export function saveServerDueDiligenceTable(
  rows: DueDiligenceTableRow[],
  formats: TableCellFormats,
  userName: string,
): DueDiligenceTableSnapshot {
  const sanitized = rows.map(sanitizeRow).filter((row): row is DueDiligenceTableRow => row !== null)
  if (sanitized.length === 0) {
    throw new Error("表格不能为空")
  }
  const snapshot: DueDiligenceTableSnapshot = {
    rows: sanitized,
    formats: sanitizeFormats(formats),
    updatedAt: new Date().toISOString(),
    updatedBy: userName || "unknown",
  }
  writeSnapshot(snapshot)
  return snapshot
}
