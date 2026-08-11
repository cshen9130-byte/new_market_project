import { query } from "@/lib/db"
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

let initPromise: Promise<void> | null = null

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

function sortByCreatedDesc(rows: InstructionRecord[]): InstructionRecord[] {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0
    const tb = Date.parse(b.createdAt) || 0
    return tb - ta
  })
}

async function ensureTable() {
  if (!initPromise) {
    initPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS ops_instruction_records (
          id          TEXT PRIMARY KEY,
          category    TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          payload     JSONB NOT NULL
        )
      `)
      await query(`
        CREATE INDEX IF NOT EXISTS idx_ops_instruction_records_category
          ON ops_instruction_records (category)
      `)
      await query(`
        CREATE INDEX IF NOT EXISTS idx_ops_instruction_records_created_at
          ON ops_instruction_records (created_at DESC)
      `)
    })().catch((e) => {
      initPromise = null
      throw e
    })
  }
  await initPromise
}

/** Any logged-in account may use the shared instruction inbox. */
export function canAccessInstructionRecords(
  user: Pick<StoredUser, "id" | "role" | "permissions"> | null | undefined,
): boolean {
  return Boolean(user?.id?.trim())
}

export async function listServerInstructionRecords(): Promise<InstructionRecord[]> {
  await ensureTable()
  const rows = await query<{ payload: InstructionRecord | string }>(
    `SELECT payload
       FROM ops_instruction_records
      ORDER BY created_at DESC`,
  )
  const out: InstructionRecord[] = []
  for (const row of rows) {
    const payload =
      typeof row.payload === "string"
        ? (() => {
            try {
              return JSON.parse(row.payload) as unknown
            } catch {
              return null
            }
          })()
        : row.payload
    const record = normalizeInstructionRecord(payload)
    if (record) out.push(record)
  }
  return sortByCreatedDesc(out)
}

export async function upsertServerInstructionRecord(input: unknown): Promise<InstructionRecord> {
  await ensureTable()
  const record = normalizeInstructionRecord(input)
  if (!record) throw new Error("指令数据无效")

  await query(
    `INSERT INTO ops_instruction_records (id, category, created_at, updated_at, payload)
     VALUES ($1, $2, $3::timestamptz, NOW(), $4::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       category = EXCLUDED.category,
       updated_at = NOW(),
       payload = EXCLUDED.payload`,
    [
      record.id,
      record.category,
      record.createdAt || new Date().toISOString(),
      JSON.stringify(record),
    ],
  )
  return record
}

export async function deleteServerInstructionRecord(id: string): Promise<boolean> {
  await ensureTable()
  const safeId = String(id || "").trim()
  if (!safeId) return false
  const rows = await query<{ id: string }>(
    `DELETE FROM ops_instruction_records WHERE id = $1 RETURNING id`,
    [safeId],
  )
  return rows.length > 0
}
