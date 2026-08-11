/**
 * Shared FOF ledger rows (Postgres JSONB payload).
 * Client localStorage is a cache only.
 */

import { query } from "@/lib/db"
import type { StoredUser } from "@/lib/server/users"
import { canAccessInstructionRecords } from "@/lib/server/instruction-records"

export type OpsLedgerAttachment = {
  id: string
  name: string
  source?: "upload" | "email"
  confirmRecordId?: number
}

export type OpsLedgerRow = {
  id: string
  fof_fund_name: string
  fof_register_number: string | null
  transaction_type: string
  underlying_type: string | null
  underlying_fund_name: string
  underlying_beian_hao: string | null
  apply_date: string
  confirm_date: string
  confirmed_shares: string | null
  confirmed_amount: string | null
  confirmed_unit_nav: string | null
  transaction_fee: string | null
  performance_fee: string | null
  share_balance: string | null
  dividend_per_unit: string | null
  source: string | null
  remark: string | null
  instruction_id: string | null
  contract_attachment?: OpsLedgerAttachment | null
  confirm_attachment?: OpsLedgerAttachment | null
}

let initPromise: Promise<void> | null = null

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null
  return typeof value === "string" ? value : null
}

function normalizeAttachment(raw: unknown): OpsLedgerAttachment | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Partial<OpsLedgerAttachment>
  const id = asString(row.id).trim()
  const name = asString(row.name).trim()
  if (!id || !name) return null
  return {
    id,
    name,
    source: row.source === "email" ? "email" : row.source === "upload" ? "upload" : undefined,
    confirmRecordId:
      typeof row.confirmRecordId === "number" && Number.isFinite(row.confirmRecordId)
        ? row.confirmRecordId
        : undefined,
  }
}

export function normalizeOpsLedgerRow(raw: unknown): OpsLedgerRow | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Partial<OpsLedgerRow>
  const id = asString(row.id).trim()
  if (!id) return null
  const fof_fund_name = asString(row.fof_fund_name).trim()
  const underlying_fund_name = asString(row.underlying_fund_name).trim()
  const apply_date = asString(row.apply_date).trim()
  const confirm_date = asString(row.confirm_date).trim()
  if (!fof_fund_name || !underlying_fund_name || !apply_date || !confirm_date) return null

  return {
    id,
    fof_fund_name,
    fof_register_number: asNullableString(row.fof_register_number),
    transaction_type: asString(row.transaction_type),
    underlying_type: asNullableString(row.underlying_type),
    underlying_fund_name,
    underlying_beian_hao: asNullableString(row.underlying_beian_hao),
    apply_date,
    confirm_date,
    confirmed_shares: asNullableString(row.confirmed_shares),
    confirmed_amount: asNullableString(row.confirmed_amount),
    confirmed_unit_nav: asNullableString(row.confirmed_unit_nav),
    transaction_fee: asNullableString(row.transaction_fee),
    performance_fee: asNullableString(row.performance_fee),
    share_balance: asNullableString(row.share_balance),
    dividend_per_unit: asNullableString(row.dividend_per_unit),
    source: asNullableString(row.source),
    remark: asNullableString(row.remark),
    instruction_id: asNullableString(row.instruction_id),
    contract_attachment: normalizeAttachment(row.contract_attachment),
    confirm_attachment: normalizeAttachment(row.confirm_attachment),
  }
}

async function ensureTable() {
  if (!initPromise) {
    initPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS ops_ledger_records (
          id          TEXT PRIMARY KEY,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          payload     JSONB NOT NULL
        )
      `)
      await query(`
        CREATE INDEX IF NOT EXISTS idx_ops_ledger_records_updated
          ON ops_ledger_records (updated_at DESC)
      `)
      await query(`
        CREATE INDEX IF NOT EXISTS idx_ops_ledger_records_instruction
          ON ops_ledger_records ((payload->>'instruction_id'))
      `)
    })().catch((e) => {
      initPromise = null
      throw e
    })
  }
  await initPromise
}

export function canAccessOpsLedger(
  user: Pick<StoredUser, "id" | "role" | "permissions"> | null | undefined,
): boolean {
  return canAccessInstructionRecords(user)
}

function parsePayload(payload: OpsLedgerRow | string): unknown {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as unknown
    } catch {
      return null
    }
  }
  return payload
}

export async function listServerOpsLedgerRecords(): Promise<OpsLedgerRow[]> {
  await ensureTable()
  const rows = await query<{ payload: OpsLedgerRow | string }>(
    `SELECT payload
       FROM ops_ledger_records
      ORDER BY updated_at DESC`,
  )
  const out: OpsLedgerRow[] = []
  for (const row of rows) {
    const record = normalizeOpsLedgerRow(parsePayload(row.payload))
    if (record) out.push(record)
  }
  return out
}

export type ListServerOpsLedgerOptions = {
  fof_register_number?: string | null
  fof_fund_name?: string | null
  underlying_beian_hao?: string | null
  apply_date_from?: string
  apply_date_to?: string
  underlying_name_q?: string
  sort?: "apply_date" | "confirm_date" | ""
  dir?: "asc" | "desc"
  page?: number
  pageSize?: number
}

export function filterOpsLedgerRecords(
  all: OpsLedgerRow[],
  options?: ListServerOpsLedgerOptions,
): {
  data: OpsLedgerRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
} {
  let rows = [...all]
  const fofReg = options?.fof_register_number?.trim()
  const fofName = options?.fof_fund_name?.trim()
  const undBeian = options?.underlying_beian_hao?.trim()
  const from = options?.apply_date_from?.trim()
  const to = options?.apply_date_to?.trim()
  const nameQ = options?.underlying_name_q?.trim()

  if (fofReg || fofName) {
    rows = rows.filter((r) => {
      if (fofReg && r.fof_register_number === fofReg) return true
      if (fofName && r.fof_fund_name === fofName) return true
      if (fofName && r.fof_fund_name.includes(fofName)) return true
      return false
    })
  }
  if (undBeian) {
    rows = rows.filter((r) => r.underlying_beian_hao === undBeian)
  }
  if (from) rows = rows.filter((r) => r.apply_date >= from)
  if (to) rows = rows.filter((r) => r.apply_date <= to)
  if (nameQ) {
    rows = rows.filter(
      (r) =>
        r.underlying_fund_name.includes(nameQ)
        || r.fof_fund_name.includes(nameQ),
    )
  }

  const sortKey = options?.sort || "apply_date"
  const dir = options?.dir === "asc" ? 1 : -1
  rows.sort((a, b) => {
    const av = sortKey === "confirm_date" ? a.confirm_date : a.apply_date
    const bv = sortKey === "confirm_date" ? b.confirm_date : b.apply_date
    if (av < bv) return -1 * dir
    if (av > bv) return 1 * dir
    return 0
  })

  const page = Math.max(1, options?.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, options?.pageSize ?? 50))
  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize
  return {
    data: rows.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  }
}

export async function upsertServerOpsLedgerRecord(input: unknown): Promise<OpsLedgerRow> {
  await ensureTable()
  const record = normalizeOpsLedgerRow(input)
  if (!record) throw new Error("台账数据无效")

  await query(
    `INSERT INTO ops_ledger_records (id, created_at, updated_at, payload)
     VALUES ($1, NOW(), NOW(), $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       updated_at = NOW(),
       payload = EXCLUDED.payload`,
    [record.id, JSON.stringify(record)],
  )
  return record
}

export async function upsertServerOpsLedgerRecords(
  inputs: unknown[],
): Promise<OpsLedgerRow[]> {
  const saved: OpsLedgerRow[] = []
  for (const input of inputs) {
    saved.push(await upsertServerOpsLedgerRecord(input))
  }
  return saved
}

export async function deleteServerOpsLedgerRecord(id: string): Promise<boolean> {
  await ensureTable()
  const safeId = String(id || "").trim()
  if (!safeId) return false
  const rows = await query<{ id: string }>(
    `DELETE FROM ops_ledger_records WHERE id = $1 RETURNING id`,
    [safeId],
  )
  return rows.length > 0
}

export async function deleteServerOpsLedgerByInstructionId(
  instructionId: string,
): Promise<number> {
  await ensureTable()
  const safeId = String(instructionId || "").trim()
  if (!safeId) return 0
  const rows = await query<{ id: string }>(
    `DELETE FROM ops_ledger_records
      WHERE payload->>'instruction_id' = $1
      RETURNING id`,
    [safeId],
  )
  return rows.length
}
