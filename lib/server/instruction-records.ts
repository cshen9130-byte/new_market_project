import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"
import type { StoredUser } from "@/lib/server/users"

export type InstructionCategory = "underlying" | "direct" | "customer" | "pool"

export type InstructionAttachmentMeta = {
  id: string
  name: string
  size: number
  uploadedAt: string
  source?: "upload" | "email"
  confirmRecordId?: number
}

export type InstructionRecord = {
  id: string
  category: InstructionCategory
  type: string
  fofFundName: string
  fofBeianHao: string
  underlyingFundName: string
  underlyingBeianHao: string
  applyDate: string
  amount: string
  shares: string | null
  nav: string | null
  confirmDate?: string | null
  actualApplyDate?: string | null
  execRemark?: string | null
  tradeFee?: string | null
  modifyReason?: string | null
  contractAttachment?: InstructionAttachmentMeta | null
  confirmAttachment?: InstructionAttachmentMeta | null
  progress: string
  summary: string
  createdAt: string
  initiator: string
  initiatorUserId?: string
  approvalRemark?: string | null
  approver?: string | null
  approverUserId?: string | null
  approvedAt?: string | null
  executorUserId?: string | null
  executedAt?: string | null
  confirmerUserId?: string | null
  confirmedAt?: string | null
  requireGmApproval?: boolean
}

const CATEGORIES = new Set<InstructionCategory>(["underlying", "direct", "customer", "pool"])

function storageDir() {
  return getServerStoragePath("instruction-records")
}

function storageFile() {
  return path.join(storageDir(), "records.json")
}

function ensureStorageDir() {
  mkdirSync(storageDir(), { recursive: true })
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null
  return typeof value === "string" ? value : null
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeAttachment(raw: unknown): InstructionAttachmentMeta | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Partial<InstructionAttachmentMeta>
  const id = asString(row.id).trim()
  const name = asString(row.name).trim()
  if (!id || !name) return null
  const size = typeof row.size === "number" && Number.isFinite(row.size) ? row.size : 0
  return {
    id,
    name,
    size,
    uploadedAt: asString(row.uploadedAt, new Date().toISOString()),
    source: row.source === "email" ? "email" : row.source === "upload" ? "upload" : undefined,
    confirmRecordId:
      typeof row.confirmRecordId === "number" && Number.isFinite(row.confirmRecordId)
        ? row.confirmRecordId
        : undefined,
  }
}

export function normalizeInstructionRecord(raw: unknown): InstructionRecord | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Partial<InstructionRecord>
  const id = asString(row.id).trim()
  if (!id) return null
  const category = asString(row.category) as InstructionCategory
  if (!CATEGORIES.has(category)) return null

  return {
    id,
    category,
    type: asString(row.type),
    fofFundName: asString(row.fofFundName),
    fofBeianHao: asString(row.fofBeianHao),
    underlyingFundName: asString(row.underlyingFundName),
    underlyingBeianHao: asString(row.underlyingBeianHao),
    applyDate: asString(row.applyDate),
    amount: asString(row.amount),
    shares: asNullableString(row.shares),
    nav: asNullableString(row.nav),
    confirmDate: asNullableString(row.confirmDate),
    actualApplyDate: asNullableString(row.actualApplyDate),
    execRemark: asNullableString(row.execRemark),
    tradeFee: asNullableString(row.tradeFee),
    modifyReason: asNullableString(row.modifyReason),
    contractAttachment: normalizeAttachment(row.contractAttachment),
    confirmAttachment: normalizeAttachment(row.confirmAttachment),
    progress: asString(row.progress),
    summary: asString(row.summary),
    createdAt: asString(row.createdAt, new Date().toISOString()),
    initiator: asString(row.initiator, "-"),
    initiatorUserId: asOptionalString(row.initiatorUserId),
    approvalRemark: asNullableString(row.approvalRemark),
    approver: asNullableString(row.approver),
    approverUserId: asNullableString(row.approverUserId),
    approvedAt: asNullableString(row.approvedAt),
    executorUserId: asNullableString(row.executorUserId),
    executedAt: asNullableString(row.executedAt),
    confirmerUserId: asNullableString(row.confirmerUserId),
    confirmedAt: asNullableString(row.confirmedAt),
    requireGmApproval:
      typeof row.requireGmApproval === "boolean" ? row.requireGmApproval : undefined,
  }
}

function readAll(): InstructionRecord[] {
  ensureStorageDir()
  const file = storageFile()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeInstructionRecord)
      .filter((row): row is InstructionRecord => Boolean(row))
  } catch {
    return []
  }
}

function writeAll(rows: InstructionRecord[]) {
  ensureStorageDir()
  writeFileSync(storageFile(), JSON.stringify(rows, null, 2), "utf-8")
}

function sortByCreatedDesc(rows: InstructionRecord[]): InstructionRecord[] {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0
    const tb = Date.parse(b.createdAt) || 0
    return tb - ta
  })
}

/** Logged-in users with an instruction role (or admin) may read/write the shared inbox. */
export function canAccessInstructionRecords(
  user: Pick<StoredUser, "role" | "permissions"> | null | undefined,
): boolean {
  if (!user) return false
  if (user.role === "admin") return true
  const role = user.permissions?.instructionRole
  return role === "fund_manager" || role === "general_manager" || role === "ops"
}

export function listServerInstructionRecords(): InstructionRecord[] {
  return sortByCreatedDesc(readAll())
}

export function upsertServerInstructionRecord(input: unknown): InstructionRecord {
  const record = normalizeInstructionRecord(input)
  if (!record) throw new Error("指令数据无效")

  const rows = readAll()
  const idx = rows.findIndex((r) => r.id === record.id)
  if (idx >= 0) {
    rows[idx] = {
      ...rows[idx],
      ...record,
      id: rows[idx].id,
      createdAt: rows[idx].createdAt || record.createdAt,
    }
  } else {
    rows.unshift(record)
  }
  writeAll(sortByCreatedDesc(rows))
  return idx >= 0 ? rows.find((r) => r.id === record.id)! : record
}

export function deleteServerInstructionRecord(id: string): boolean {
  const safeId = String(id || "").trim()
  if (!safeId) return false
  const rows = readAll()
  const next = rows.filter((r) => r.id !== safeId)
  if (next.length === rows.length) return false
  writeAll(next)
  return true
}

export function replaceServerInstructionRecords(input: unknown): InstructionRecord[] {
  if (!Array.isArray(input)) throw new Error("指令列表无效")
  const rows = input
    .map(normalizeInstructionRecord)
    .filter((row): row is InstructionRecord => Boolean(row))
  const deduped = new Map<string, InstructionRecord>()
  for (const row of rows) deduped.set(row.id, row)
  const next = sortByCreatedDesc(Array.from(deduped.values()))
  writeAll(next)
  return next
}
