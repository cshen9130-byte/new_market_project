import { authService } from "@/lib/auth"
import {
  formatInstructionAmount,
  listInstructionRecords,
  type InstructionAttachmentMeta,
  type InstructionRecord,
} from "./instructions-store"

export type OpsLedgerAttachment = Pick<
  InstructionAttachmentMeta,
  "id" | "name" | "source" | "confirmRecordId"
>

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
  /** 合同 — from 产品运维执行 (non-追加). */
  contract_attachment?: OpsLedgerAttachment | null
  /** 确认函/确认单 — from 产品运维确认. */
  confirm_attachment?: OpsLedgerAttachment | null
  generation_key?: string | null
  locked?: boolean
  review_status?: "pending" | "confirmed"
  reviewed_by?: string | null
  reviewed_at?: string | null
}

function toLedgerAttachment(
  meta: InstructionAttachmentMeta | null | undefined,
): OpsLedgerAttachment | null {
  if (!meta?.id || !meta.name) return null
  return {
    id: meta.id,
    name: meta.name,
    source: meta.source,
    confirmRecordId: meta.confirmRecordId,
  }
}

export type OpsLedgerInput = Omit<OpsLedgerRow, "id"> & { id?: string }

const STORAGE_KEY = "ma_ops_ledger_records_v1"
const CHANGE_EVENT = "ma-ops-ledger-records-changed"
const LIST_API = "/ma/api/ops/ledger/list"
const ADD_API = "/ma/api/ops/ledger/add"
const DELETE_API = "/ma/api/ops/ledger/delete"
const CONFIRM_API = "/ma/api/ops/ledger/confirm"
const EMPTY_SNAPSHOT: OpsLedgerRow[] = []

let cachedSnapshot: OpsLedgerRow[] | null = null
let hydratePromise: Promise<void> | null = null
let lastHydrateError: string | null = null
let hydrateStatus: "idle" | "loading" | "ready" | "error" = "idle"

export function getLedgerRecordsHydrateError(): string | null {
  return lastHydrateError
}

export function getLedgerHydrateStatus(): "idle" | "loading" | "ready" | "error" {
  return hydrateStatus
}

export function ledgerReviewStatus(row: Pick<OpsLedgerRow, "review_status">): "pending" | "confirmed" {
  return row.review_status === "confirmed" ? "confirmed" : "pending"
}

export function ledgerReviewTitle(row: Pick<OpsLedgerRow, "review_status" | "reviewed_by" | "reviewed_at">): string {
  if (ledgerReviewStatus(row) !== "confirmed") return "尚未人工核对"
  const who = row.reviewed_by?.trim() || "同事"
  const when = row.reviewed_at
    ? row.reviewed_at.replace("T", " ").slice(0, 16)
    : ""
  return when ? `${who} 于 ${when} 确认` : `${who} 已确认`
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function authHeaders(): HeadersInit {
  const uid = authService.getCurrentUser()?.id?.trim() || ""
  return uid ? { "x-market-user-id": uid } : {}
}

function parseStored(raw: string | null): OpsLedgerRow[] {
  if (!raw) return EMPTY_SNAPSHOT
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return EMPTY_SNAPSHOT
    const rows = parsed.filter((row): row is OpsLedgerRow => {
      return Boolean(row && typeof row === "object" && typeof (row as OpsLedgerRow).id === "string")
    })
    return rows.length === 0 ? EMPTY_SNAPSHOT : rows
  } catch {
    return EMPTY_SNAPSHOT
  }
}

function readAll(): OpsLedgerRow[] {
  if (cachedSnapshot) return cachedSnapshot
  if (!canUseStorage()) {
    cachedSnapshot = EMPTY_SNAPSHOT
    return cachedSnapshot
  }
  cachedSnapshot = parseStored(window.localStorage.getItem(STORAGE_KEY))
  return cachedSnapshot
}

function writeAll(rows: OpsLedgerRow[]) {
  cachedSnapshot = rows.length === 0 ? EMPTY_SNAPSHOT : rows
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
    } catch {
      // Private mode / quota — memory snapshot is still shared for this tab.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }
}

function invalidateCache() {
  cachedSnapshot = null
}

async function apiFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || res.statusText || "请求失败")
  }
  return data as T
}

async function pushRecordToServer(record: OpsLedgerRow) {
  await apiFetch<{ ok: true; record: OpsLedgerRow }>(ADD_API, {
    method: "POST",
    body: JSON.stringify({ record }),
  })
}

async function pushRecordsToServer(records: OpsLedgerRow[]) {
  if (records.length === 0) return
  await apiFetch<{ ok: true; records: OpsLedgerRow[] }>(ADD_API, {
    method: "POST",
    body: JSON.stringify({ records }),
  })
}

async function deleteRecordOnServer(id: string) {
  await apiFetch<{ ok: true }>(`${DELETE_API}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

async function deleteByInstructionOnServer(instructionId: string) {
  await apiFetch<{ ok: true }>(
    `${DELETE_API}?instruction_id=${encodeURIComponent(instructionId)}`,
    { method: "DELETE" },
  )
}

/**
 * Pull shared ledger from server (source of truth).
 * Safe to call repeatedly; concurrent callers share one in-flight promise.
 */
export function ensureLedgerRecordsHydrated(): Promise<void> {
  if (hydratePromise) return hydratePromise

  hydrateStatus = "loading"
  lastHydrateError = null
  if (canUseStorage()) window.dispatchEvent(new Event(CHANGE_EVENT))

  hydratePromise = (async () => {
    try {
      const data = await apiFetch<{ ok: true; records: OpsLedgerRow[] }>(
        `${LIST_API}?all=1`,
      )
      const serverRows = Array.isArray(data.records) ? data.records : []
      writeAll(serverRows)
      lastHydrateError = null
      hydrateStatus = "ready"
    } catch (e) {
      lastHydrateError = e instanceof Error ? e.message : "台账列表同步失败"
      hydrateStatus = "error"
      if (canUseStorage()) {
        window.dispatchEvent(new Event(CHANGE_EVENT))
      }
    } finally {
      hydratePromise = null
    }
  })()

  return hydratePromise
}

/** Force a fresh pull from the shared server ledger. */
export function refreshLedgerRecordsFromServer(): Promise<void> {
  hydratePromise = null
  return ensureLedgerRecordsHydrated()
}

function createLedgerId(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  const rand = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")
  return `L${y}${m}${d}${rand}`
}

function ledgerBeianFamilyKey(code: string | null | undefined): string {
  const raw = String(code ?? "").trim().toUpperCase()
  if (!raw) return ""
  let base = raw.replace(/[ABC]$/u, "")
  if (base.startsWith("S") && base.length > 1 && /^S[A-Z][A-Z0-9]{4,7}$/u.test(base)) {
    base = base.slice(1)
  }
  return base
}

function formatLedgerNumber(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  return formatInstructionAmount(trimmed)
}

export function isInstructionConfirmed(progress: string | null | undefined): boolean {
  if (!progress) return false
  return progress.includes("已确认") || progress.includes("已完成") || progress.includes("结束")
}

export function mapInstructionTypeToLedgerTx(type: string): string {
  if (type === "初次申购" || type === "追加申购") return "申购"
  if (type === "转换入" || type === "转换出") return type
  return type
}

/** Instruction may carry optional confirmDate from confirm flow. */
type InstructionWithConfirm = InstructionRecord & { confirmDate?: string | null }

export function ledgerRowFromInstruction(record: InstructionWithConfirm): OpsLedgerRow {
  const confirmDate = record.confirmDate?.trim() || record.applyDate
  let shares = record.shares
  if (!shares && record.nav && record.amount) {
    const amt = Number(String(record.amount).replace(/,/g, "").trim())
    const nav = Number(String(record.nav).replace(/,/g, "").trim())
    if (Number.isFinite(amt) && Number.isFinite(nav) && nav > 0) {
      shares = (amt / nav).toFixed(2)
    }
  }
  return {
    id: `instr-${record.id}`,
    fof_fund_name: record.fofFundName,
    fof_register_number: record.fofBeianHao || null,
    transaction_type: mapInstructionTypeToLedgerTx(record.type),
    underlying_type: "FOF底层",
    underlying_fund_name: record.underlyingFundName,
    underlying_beian_hao: record.underlyingBeianHao || null,
    apply_date: record.applyDate,
    confirm_date: confirmDate,
    confirmed_shares: formatLedgerNumber(shares),
    confirmed_amount: formatLedgerNumber(record.amount),
    confirmed_unit_nav: record.nav ? String(record.nav).trim() : null,
    transaction_fee: formatLedgerNumber(record.tradeFee),
    performance_fee: null,
    share_balance: null,
    dividend_per_unit: null,
    source: "指令",
    remark: null,
    instruction_id: record.id,
    contract_attachment: toLedgerAttachment(record.contractAttachment),
    confirm_attachment: toLedgerAttachment(record.confirmAttachment),
    generation_key: null,
    locked: false,
    review_status: "confirmed",
    reviewed_by: null,
    reviewed_at: record.confirmDate || record.applyDate || null,
  }
}

function buildLedgerRecord(input: OpsLedgerInput): OpsLedgerRow {
  return {
    id: input.id ?? createLedgerId(),
    fof_fund_name: input.fof_fund_name,
    fof_register_number: input.fof_register_number,
    transaction_type: input.transaction_type,
    underlying_type: input.underlying_type,
    underlying_fund_name: input.underlying_fund_name,
    underlying_beian_hao: input.underlying_beian_hao,
    apply_date: input.apply_date,
    confirm_date: input.confirm_date,
    confirmed_shares: formatLedgerNumber(input.confirmed_shares),
    confirmed_amount: formatLedgerNumber(input.confirmed_amount),
    confirmed_unit_nav: input.confirmed_unit_nav,
    transaction_fee: formatLedgerNumber(input.transaction_fee),
    performance_fee: formatLedgerNumber(input.performance_fee),
    share_balance: formatLedgerNumber(input.share_balance),
    dividend_per_unit: input.dividend_per_unit,
    source: input.source,
    remark: input.remark,
    instruction_id: input.instruction_id ?? null,
    contract_attachment: input.contract_attachment ?? null,
    confirm_attachment: input.confirm_attachment ?? null,
    generation_key: input.generation_key ?? null,
    locked: input.locked === true,
    review_status: input.review_status === "confirmed" ? "confirmed" : "pending",
    reviewed_by: input.reviewed_by ?? null,
    reviewed_at: input.reviewed_at ?? null,
  }
}

export async function addLedgerRecord(input: OpsLedgerInput): Promise<OpsLedgerRow> {
  const record = buildLedgerRecord(input)
  writeAll([record, ...readAll().filter((r) => r.id !== record.id)])
  try {
    await pushRecordToServer(record)
    lastHydrateError = null
  } catch (e) {
    const message = e instanceof Error ? e.message : "台账同步失败"
    lastHydrateError = message
    throw new Error(message)
  }
  return record
}

export async function addLedgerRecords(inputs: OpsLedgerInput[]): Promise<OpsLedgerRow[]> {
  if (inputs.length === 0) return []
  const created = inputs.map((input) => buildLedgerRecord({
    ...input,
    underlying_type: input.underlying_type ?? "FOF底层",
    source: input.source ?? "手工",
  }))
  const createdIds = new Set(created.map((r) => r.id))
  writeAll([...created, ...readAll().filter((r) => !createdIds.has(r.id))])
  try {
    await pushRecordsToServer(created)
    lastHydrateError = null
  } catch (e) {
    const message = e instanceof Error ? e.message : "台账批量同步失败"
    lastHydrateError = message
    throw new Error(message)
  }
  return created
}

function attachmentKey(a: OpsLedgerAttachment | null | undefined): string {
  if (!a?.id) return ""
  return `${a.id}:${a.name}`
}

function ledgerContentEqual(a: OpsLedgerRow, b: OpsLedgerRow): boolean {
  return (
    a.fof_fund_name === b.fof_fund_name
    && a.fof_register_number === b.fof_register_number
    && a.transaction_type === b.transaction_type
    && a.underlying_fund_name === b.underlying_fund_name
    && a.underlying_beian_hao === b.underlying_beian_hao
    && a.apply_date === b.apply_date
    && a.confirm_date === b.confirm_date
    && a.confirmed_shares === b.confirmed_shares
    && a.confirmed_amount === b.confirmed_amount
    && a.confirmed_unit_nav === b.confirmed_unit_nav
    && a.source === b.source
    && a.instruction_id === b.instruction_id
    && attachmentKey(a.contract_attachment) === attachmentKey(b.contract_attachment)
    && attachmentKey(a.confirm_attachment) === attachmentKey(b.confirm_attachment)
  )
}

export async function upsertLedgerFromConfirmedInstruction(
  record: InstructionWithConfirm,
): Promise<OpsLedgerRow | null> {
  if (!isInstructionConfirmed(record.progress)) return null
  if (record.category !== "underlying" && record.category !== "direct") return null

  const mapped = ledgerRowFromInstruction(record)
  const rows = readAll()
  const idx = rows.findIndex((r) => r.instruction_id === record.id)
  let nextRow: OpsLedgerRow
  if (idx >= 0) {
    const merged = { ...mapped, id: rows[idx].id }
    if (ledgerContentEqual(rows[idx], merged)) return rows[idx]
    const next = [...rows]
    next[idx] = merged
    writeAll(next)
    nextRow = merged
  } else {
    writeAll([mapped, ...rows])
    nextRow = mapped
  }

  try {
    await pushRecordToServer(nextRow)
    lastHydrateError = null
  } catch (e) {
    lastHydrateError = e instanceof Error ? e.message : "台账同步失败"
    // Keep local row; instruction confirm already succeeded.
  }
  return nextRow
}

export async function removeLedgerByInstructionId(instructionId: string): Promise<boolean> {
  const rows = readAll()
  const next = rows.filter((r) => r.instruction_id !== instructionId)
  if (next.length === rows.length) {
    // Still try server delete in case local cache was stale.
    try {
      await deleteByInstructionOnServer(instructionId)
    } catch {
      /* ignore */
    }
    return false
  }
  writeAll(next)
  try {
    await deleteByInstructionOnServer(instructionId)
    lastHydrateError = null
  } catch (e) {
    lastHydrateError = e instanceof Error ? e.message : "台账删除同步失败"
  }
  return true
}

export async function removeLedgerRecord(id: string): Promise<boolean> {
  const rows = readAll()
  const next = rows.filter((r) => r.id !== id)
  if (next.length === rows.length) return false
  writeAll(next)
  try {
    await deleteRecordOnServer(id)
    lastHydrateError = null
  } catch (e) {
    lastHydrateError = e instanceof Error ? e.message : "台账删除同步失败"
  }
  return true
}

/** Backfill ledger rows from any already-confirmed instruction records. */
export async function backfillLedgerFromConfirmedInstructions(): Promise<number> {
  const instructions = listInstructionRecords()
  let count = 0
  for (const record of instructions) {
    if (!isInstructionConfirmed(record.progress)) continue
    if (record.category !== "underlying" && record.category !== "direct") continue
    const beforeLen = readAll().length
    await upsertLedgerFromConfirmedInstruction(record)
    if (readAll().length > beforeLen) count += 1
  }
  return count
}

export async function generateLedgerFromValuation(): Promise<{
  products: number
  candidates: number
  inserted: number
  updated: number
  skippedProtected: number
  skippedDeleted: number
  confirmMatched: number
}> {
  const data = await apiFetch<{
    ok: true
    products: number
    candidates: number
    inserted: number
    updated: number
    skippedProtected: number
    skippedDeleted: number
    confirmMatched: number
  }>("/ma/api/ops/ledger/generate-from-valuation", { method: "POST" })
  await refreshLedgerRecordsFromServer()
  return data
}

export async function confirmLedgerRecords(ids: string[]): Promise<number> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (unique.length === 0) return 0
  const data = await apiFetch<{ ok: true; count: number; records: OpsLedgerRow[] }>(
    CONFIRM_API,
    { method: "POST", body: JSON.stringify({ ids: unique }) },
  )
  const updated = Array.isArray(data.records) ? data.records : []
  if (updated.length > 0) {
    const byId = new Map(updated.map((row) => [row.id, row]))
    writeAll(readAll().map((row) => byId.get(row.id) ?? row))
  }
  lastHydrateError = null
  return typeof data.count === "number" ? data.count : updated.length
}

export type ListLedgerOptions = {
  fof_register_number?: string | null
  fof_fund_name?: string | null
  underlying_beian_hao?: string | null
  underlying_fund_name?: string | null
  product_beian_hao?: string | null
  apply_date_from?: string
  apply_date_to?: string
  underlying_name_q?: string
  review_status?: "pending" | "confirmed" | "all" | ""
  sort?: "apply_date" | "confirm_date" | ""
  dir?: "asc" | "desc"
  page?: number
  pageSize?: number
  /** Skip pagination and return every matching row. */
  all?: boolean
}

export function listLedgerRecords(options?: ListLedgerOptions): {
  data: OpsLedgerRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
} {
  let rows = [...readAll()]
  const fofReg = options?.fof_register_number?.trim()
  const fofName = options?.fof_fund_name?.trim()
  const undBeian = options?.underlying_beian_hao?.trim()
  const undName = options?.underlying_fund_name?.trim()
  const productBeian = options?.product_beian_hao?.trim()
  const from = options?.apply_date_from?.trim()
  const to = options?.apply_date_to?.trim()
  const nameQ = options?.underlying_name_q?.trim()

  if (productBeian) {
    const family = ledgerBeianFamilyKey(productBeian)
    rows = rows.filter((r) => {
      if (r.fof_register_number === productBeian || r.underlying_beian_hao === productBeian) return true
      if (family && ledgerBeianFamilyKey(r.fof_register_number) === family) return true
      if (family && ledgerBeianFamilyKey(r.underlying_beian_hao) === family) return true
      return false
    })
  }
  if (fofReg || fofName) {
    const nameNeedle = fofName?.toLowerCase() ?? ""
    const fofFam = ledgerBeianFamilyKey(fofReg)
    rows = rows.filter((r) => {
      if (fofReg) {
        if (r.fof_register_number === fofReg) return true
        if (fofFam && ledgerBeianFamilyKey(r.fof_register_number) === fofFam) return true
      }
      if (nameNeedle) {
        if (r.fof_fund_name.toLowerCase().includes(nameNeedle)) return true
        if ((r.fof_register_number || "").toLowerCase().includes(nameNeedle)) return true
      }
      return false
    })
  }
  if (undBeian || undName) {
    const nameNeedle = undName?.toLowerCase() ?? ""
    const undFam = ledgerBeianFamilyKey(undBeian)
    rows = rows.filter((r) => {
      if (undBeian) {
        if (r.underlying_beian_hao === undBeian) return true
        if (undFam && ledgerBeianFamilyKey(r.underlying_beian_hao) === undFam) return true
      }
      if (nameNeedle) {
        if (r.underlying_fund_name.toLowerCase().includes(nameNeedle)) return true
        if ((r.underlying_beian_hao || "").toLowerCase().includes(nameNeedle)) return true
      }
      return false
    })
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
  const reviewStatus = options?.review_status
  if (reviewStatus === "pending" || reviewStatus === "confirmed") {
    rows = rows.filter((r) => (r.review_status || "pending") === reviewStatus)
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

  const total = rows.length
  if (options?.all) {
    return {
      data: rows,
      total,
      page: 1,
      pageSize: total || 1,
      totalPages: 1,
    }
  }
  const page = Math.max(1, options?.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, options?.pageSize ?? 50))
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

export function subscribeLedgerRecords(listener: () => void): () => void {
  if (!canUseStorage()) return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      invalidateCache()
      listener()
    }
  }
  const onLocalChange = () => listener()
  window.addEventListener("storage", onStorage)
  window.addEventListener(CHANGE_EVENT, onLocalChange)
  return () => {
    window.removeEventListener("storage", onStorage)
    window.removeEventListener(CHANGE_EVENT, onLocalChange)
  }
}

export function getLedgerRecordsSnapshot(): OpsLedgerRow[] {
  return readAll()
}

export function getLedgerRecordsServerSnapshot(): OpsLedgerRow[] {
  return EMPTY_SNAPSHOT
}
