import { authService } from "@/lib/auth"
import {
  instructionRoleDisplayName,
  type InstructionRoleKey,
} from "@/lib/ma/instruction-roles"
import { getInstructionRole, isAdmin } from "@/lib/permissions"

export type InstructionCategory = "underlying" | "direct" | "customer" | "pool"

/** Current login user id (empty when logged out). */
export function currentInstructionUserId(): string {
  return authService.getCurrentUser()?.id?.trim() || ""
}

/** Instruction-module role from 指令设置 (empty when unassigned). */
export function currentInstructionRole(): InstructionRoleKey | "" {
  return getInstructionRole(authService.getCurrentUser())
}

/** Whether the current user may act as a given instruction role (admins always can). */
export function currentUserHasInstructionRole(role: InstructionRoleKey): boolean {
  const user = authService.getCurrentUser()
  if (!user) return false
  if (isAdmin(user)) return true
  return getInstructionRole(user) === role
}

/** Initiator label for new instructions: 角色姓名 from 指令设置. */
export function currentInstructionInitiator(): string {
  const user = authService.getCurrentUser()
  return (
    instructionRoleDisplayName(user?.permissions, user?.name) ||
    user?.name?.trim() ||
    "-"
  )
}

/**
 * Resolve stored initiator for display.
 * Own records → "我"; others keep the name saved at create time.
 * Legacy "我" without initiatorUserId is treated as 基金经理-initiated.
 */
export function resolveInstructionInitiatorDisplay(
  stored: string | null | undefined,
  initiatorUserId?: string | null,
): string {
  const user = authService.getCurrentUser()
  const uid = user?.id?.trim() || ""
  const ownerId = (initiatorUserId || "").trim()
  if (uid && ownerId && ownerId === uid) return "我"

  const value = (stored || "").trim()
  if (!value || value === "我") {
    if (!ownerId && user?.permissions?.instructionRole === "fund_manager") return "我"
    if (!ownerId) return "基金经理"
    return value || "-"
  }
  return value
}

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
  /** Login user id of who submitted; used to filter 我发起的. */
  initiatorUserId?: string
  /** 总经理审批备注 */
  approvalRemark?: string | null
  /** Approver display name (角色别名 / 姓名) */
  approver?: string | null
  approverUserId?: string | null
  approvedAt?: string | null
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

export function isInstructionRejected(progress: string | null | undefined): boolean {
  if (!progress) return false
  return progress.includes("驳回") || progress.includes("拒绝")
}

export function isInstructionPendingApproval(progress: string | null | undefined): boolean {
  if (!progress) return false
  if (isInstructionRejected(progress)) return false
  return progress.includes("待审批") || progress.includes("待审核")
}

/** After 总经理审批通过, trade instructions wait for 产品运维执行. */
export function isInstructionAwaitingExecute(progress: string | null | undefined): boolean {
  if (!progress) return false
  if (isInstructionRejected(progress)) return false
  if (isInstructionPendingApproval(progress)) return false
  if (isInstructionExecuted(progress)) return false
  return progress.includes("待执行")
}

export function isPoolInstruction(record: Pick<InstructionRecord, "category" | "type">): boolean {
  return (
    record.category === "pool"
    || record.type === "基金入池"
    || record.type === "基金出池"
    || record.type === "管理人入池"
    || record.type === "管理人出池"
  )
}

/** Default trade / underlying / direct instruction flow */
export const INSTRUCTION_TIMELINE_TRADE = [
  "基金经理发起",
  "总经理审批",
  "产品运维执行",
  "产品运维确认",
  "指令结束",
] as const

/** 入/出池审批 — shorter approval flow */
export const INSTRUCTION_TIMELINE_POOL = [
  "基金经理发起",
  "总经理审批",
  "指令结束",
] as const

export function instructionTimelineSteps(
  record: Pick<InstructionRecord, "category" | "type">,
): readonly string[] {
  return isPoolInstruction(record) ? INSTRUCTION_TIMELINE_POOL : INSTRUCTION_TIMELINE_TRADE
}

/**
 * Active timeline index for the left stepper.
 * Completed nodes are before active; when finished, active is the last node (all filled).
 */
export function instructionTimelineActiveIndex(record: InstructionRecord): number {
  const steps = instructionTimelineSteps(record)
  const last = steps.length - 1
  const p = record.progress || ""

  if (isInstructionRejected(p)) {
    return Math.min(1, last)
  }
  if (
    p.includes("已确认")
    || p.includes("已完成")
    || p.includes("结束")
    || (isPoolInstruction(record) && p.includes("已通过"))
  ) {
    return last
  }
  if (p.includes("待确认")) {
    const idx = steps.indexOf("产品运维确认")
    return idx >= 0 ? idx : last
  }
  if (p.includes("待执行")) {
    const idx = steps.indexOf("产品运维执行")
    return idx >= 0 ? idx : Math.min(2, last)
  }
  if (isInstructionPendingApproval(p)) {
    const idx = steps.indexOf("总经理审批")
    return idx >= 0 ? idx : 1
  }
  // Fallback: treat unknown mid-state as awaiting approval.
  return Math.min(1, last)
}

export function isInstructionWorkflowFinished(record: InstructionRecord): boolean {
  const p = record.progress || ""
  if (isInstructionRejected(p)) return true
  if (p.includes("已确认") || p.includes("已完成") || p.includes("结束")) return true
  if (isPoolInstruction(record) && p.includes("已通过")) return true
  return false
}

/** Progress after 总经理审批通过. */
export function progressAfterApproval(record: Pick<InstructionRecord, "category" | "type">): string {
  return isPoolInstruction(record) ? "已完成" : "待执行(3/4)"
}

export function canApproveInstruction(record: InstructionRecord): boolean {
  if (!isInstructionPendingApproval(record.progress)) return false
  return currentUserHasInstructionRole("general_manager")
}

export function canExecuteInstruction(record: InstructionRecord): boolean {
  if (record.category !== "underlying" && record.category !== "direct") return false
  if (!isInstructionAwaitingExecute(record.progress)) return false
  return currentUserHasInstructionRole("ops")
}

export function canConfirmInstruction(record: InstructionRecord): boolean {
  if (record.category !== "underlying" && record.category !== "direct") return false
  const p = record.progress || ""
  if (!p.includes("待确认")) return false
  if (p.includes("已确认")) return false
  return currentUserHasInstructionRole("ops")
}

function canCurrentUserHandle(record: InstructionRecord): boolean {
  if (canApproveInstruction(record)) return true
  if (canExecuteInstruction(record)) return true
  if (canConfirmInstruction(record)) return true
  return false
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
  input: Omit<
    InstructionRecord,
    "id" | "createdAt" | "progress" | "shares" | "nav" | "initiator" | "initiatorUserId"
  > & {
    id?: string
    progress?: string
    shares?: string | null
    nav?: string | null
    initiator?: string
    initiatorUserId?: string
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
    initiator: input.initiator ?? currentInstructionInitiator(),
    initiatorUserId: input.initiatorUserId ?? (currentInstructionUserId() || undefined),
  }
  const next = [record, ...readAll()]
  writeAll(next)
  return record
}

function isInitiatedByCurrentUser(row: InstructionRecord, userId: string): boolean {
  if (!userId) return false
  const ownerId = (row.initiatorUserId || "").trim()
  if (ownerId) return ownerId === userId

  // Legacy rows (no initiatorUserId): match concrete saved name, or treat bare "我"
  // as 基金经理-initiated (workflow always starts with 基金经理发起).
  const initiator = (row.initiator || "").trim()
  if (initiator && initiator !== "我") {
    return initiator === currentInstructionInitiator()
  }
  const role = authService.getCurrentUser()?.permissions?.instructionRole
  return role === "fund_manager"
}

export function listInstructionRecords(options?: {
  category?: InstructionCategory
  variant?: "mine" | "handled" | "all"
}): InstructionRecord[] {
  let rows = readAll()
  if (options?.category) {
    rows = rows.filter((r) => r.category === options.category)
  }
  if (options?.variant === "handled") {
    rows = rows.filter((r) => canCurrentUserHandle(r))
    return rows
  }
  if (options?.variant === "mine") {
    const userId = currentInstructionUserId()
    rows = rows.filter((r) => isInitiatedByCurrentUser(r, userId))
  }
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
