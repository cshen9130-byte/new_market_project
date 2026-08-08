export type InstructionCategory = "underlying" | "direct" | "customer" | "pool"

/** Lightweight attachment meta persisted with the local instruction record. */
export type InstructionAttachmentMeta = {
  /** IndexedDB key for the file blob (see instruction-attachment-files), or email-confirm:{id}. */
  id: string
  name: string
  size: number
  uploadedAt: string
  /** upload = local IndexedDB; email = server ops_email_confirm_records. */
  source?: "upload" | "email"
  /** Server row id when source === "email". */
  confirmRecordId?: number
}

export function isEmailConfirmAttachmentId(id: string | null | undefined): boolean {
  return Boolean(id && id.startsWith("email-confirm:"))
}

export function emailConfirmAttachmentId(recordId: number): string {
  return `email-confirm:${recordId}`
}

export function parseEmailConfirmRecordId(id: string | null | undefined): number | null {
  if (!id?.startsWith("email-confirm:")) return null
  const n = parseInt(id.slice("email-confirm:".length), 10)
  return Number.isFinite(n) ? n : null
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
  /** Trade confirmation date (YYYY-MM-DD), set when progress becomes 已确认. */
  confirmDate?: string | null
  /** Actual application date set at 产品运维执行. */
  actualApplyDate?: string | null
  execRemark?: string | null
  tradeFee?: string | null
  modifyReason?: string | null
  /** 合同 — required at 产品运维执行 when type is not 追加. */
  contractAttachment?: InstructionAttachmentMeta | null
  /** 确认函/确认单 — required at 产品运维确认. */
  confirmAttachment?: InstructionAttachmentMeta | null
  progress: string
  summary: string
  createdAt: string
  initiator: string
}

/** 追加申购 (and similar) skip the contract upload at 产品运维执行. */
export function isAdditionalSubscribeType(type: string | null | undefined): boolean {
  return Boolean(type && type.includes("追加"))
}

/** Contract upload is required at 产品运维执行 for non-追加 underlying/direct trades. */
export function requiresContractAtExecute(type: string | null | undefined): boolean {
  return !isAdditionalSubscribeType(type)
}

export function isInstructionExecuted(progress: string | null | undefined): boolean {
  if (!progress) return false
  return (
    progress.includes("待确认")
    || progress.includes("已确认")
    || progress.includes("已执行")
    || progress.includes("已完成")
    || progress.includes("结束")
  )
}

export function createAttachmentId(): string {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function attachmentMetaFromFile(
  file: File,
  uploadedAt = new Date().toISOString(),
  id = createAttachmentId(),
): InstructionAttachmentMeta {
  return {
    id,
    name: file.name,
    size: file.size,
    uploadedAt,
    source: "upload",
  }
}

const STORAGE_KEY = "ma_instruction_records_v1"
const CHANGE_EVENT = "ma-instruction-records-changed"
const EMPTY_SNAPSHOT: InstructionRecord[] = []

/** Cached for useSyncExternalStore — must return a stable reference between updates. */
let cachedSnapshot: InstructionRecord[] | null = null

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function parseStored(raw: string | null): InstructionRecord[] {
  if (!raw) return EMPTY_SNAPSHOT
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return EMPTY_SNAPSHOT
    const rows = parsed.filter((row): row is InstructionRecord => {
      return Boolean(row && typeof row === "object" && typeof (row as InstructionRecord).id === "string")
    })
    return rows.length === 0 ? EMPTY_SNAPSHOT : rows
  } catch {
    return EMPTY_SNAPSHOT
  }
}

function readAll(): InstructionRecord[] {
  if (cachedSnapshot) return cachedSnapshot
  if (!canUseStorage()) {
    cachedSnapshot = EMPTY_SNAPSHOT
    return cachedSnapshot
  }
  cachedSnapshot = parseStored(window.localStorage.getItem(STORAGE_KEY))
  return cachedSnapshot
}

function writeAll(rows: InstructionRecord[]) {
  if (!canUseStorage()) return
  cachedSnapshot = rows.length === 0 ? EMPTY_SNAPSHOT : rows
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function invalidateCache() {
  cachedSnapshot = null
}

/** ID format similar to reference: YYYYMMDD + 9 random digits */
export function createInstructionId(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  const rand = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")
  return `${y}${m}${d}${rand}`
}

export function formatInstructionAmount(value: string): string {
  const n = Number(String(value).replace(/,/g, "").trim())
  if (!Number.isFinite(n)) return value
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function addInstructionRecord(
  input: Omit<InstructionRecord, "id" | "createdAt" | "progress" | "shares" | "nav" | "initiator"> & {
    id?: string
    progress?: string
    shares?: string | null
    nav?: string | null
    initiator?: string
  },
): InstructionRecord {
  const record: InstructionRecord = {
    id: input.id ?? createInstructionId(),
    category: input.category,
    type: input.type,
    fofFundName: input.fofFundName,
    fofBeianHao: input.fofBeianHao,
    underlyingFundName: input.underlyingFundName,
    underlyingBeianHao: input.underlyingBeianHao,
    applyDate: input.applyDate,
    amount: formatInstructionAmount(input.amount),
    shares: input.shares ?? null,
    nav: input.nav ?? null,
    progress: input.progress ?? "待审批(2/4)",
    summary: input.summary,
    createdAt: new Date().toISOString(),
    initiator: input.initiator ?? "我",
  }
  const next = [record, ...readAll()]
  writeAll(next)
  return record
}

export function listInstructionRecords(options?: {
  category?: InstructionCategory
  variant?: "mine" | "handled" | "all"
}): InstructionRecord[] {
  let rows = readAll()
  if (options?.category) {
    rows = rows.filter((r) => r.category === options.category)
  }
  // Local demo store: all submitted records belong to current user ("mine" / "all").
  // "handled" stays empty until approval workflow exists.
  if (options?.variant === "handled") return EMPTY_SNAPSHOT
  return rows
}

export function removeInstructionRecord(id: string): boolean {
  const rows = readAll()
  const next = rows.filter((r) => r.id !== id)
  if (next.length === rows.length) return false
  writeAll(next)
  return true
}

export function updateInstructionRecord(
  id: string,
  patch: Partial<Omit<InstructionRecord, "id" | "createdAt">>,
): InstructionRecord | null {
  const rows = readAll()
  const idx = rows.findIndex((r) => r.id === id)
  if (idx < 0) return null
  const current = rows[idx]
  const nextRecord: InstructionRecord = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    amount:
      patch.amount != null ? formatInstructionAmount(patch.amount) : current.amount,
  }
  const next = [...rows]
  next[idx] = nextRecord
  writeAll(next)
  return nextRecord
}

export function subscribeInstructionRecords(listener: () => void): () => void {
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

export function getInstructionRecordsSnapshot(): InstructionRecord[] {
  return readAll()
}

/** Stable empty snapshot for SSR / useSyncExternalStore getServerSnapshot. */
export function getInstructionRecordsServerSnapshot(): InstructionRecord[] {
  return EMPTY_SNAPSHOT
}
