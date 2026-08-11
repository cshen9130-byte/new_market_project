import { authService } from "@/lib/auth"
import {
  instructionTypeOptionFromCategory,
  readInstructionProcessConfig,
  requiresGmApprovalForType,
} from "@/lib/ma/instruction-process-config"
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

/** Lightweight attachment meta persisted with the instruction record. */
export type InstructionAttachmentMeta = {
  /** Server attachment id (upload) or email-confirm:{id}. */
  id: string
  name: string
  size: number
  uploadedAt: string
  /** upload = shared server file; email = ops_email_confirm_records. */
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
  /** 产品运维 who completed 执行 */
  executorUserId?: string | null
  executedAt?: string | null
  /** 产品运维 who completed 确认 */
  confirmerUserId?: string | null
  confirmedAt?: string | null
  /**
   * Snapshot of process config at create time.
   * Undefined on legacy rows → treat as requiring 总经理审批.
   */
  requireGmApproval?: boolean
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

/** Whether this record's official flow includes 总经理审批. */
export function recordRequiresGmApproval(
  record: Pick<InstructionRecord, "category" | "type" | "requireGmApproval">,
): boolean {
  if (typeof record.requireGmApproval === "boolean") return record.requireGmApproval
  const typeOpt = instructionTypeOptionFromCategory(record.category)
  return requiresGmApprovalForType(typeOpt)
}

export function instructionTimelineSteps(
  record: Pick<InstructionRecord, "category" | "type" | "requireGmApproval">,
): readonly string[] {
  const base = isPoolInstruction(record) ? INSTRUCTION_TIMELINE_POOL : INSTRUCTION_TIMELINE_TRADE
  if (recordRequiresGmApproval(record)) return base
  return base.filter((step) => step !== "总经理审批")
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
    const gmIdx = steps.indexOf("总经理审批")
    return gmIdx >= 0 ? gmIdx : Math.min(1, last)
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
  // Fallback: treat unknown mid-state as awaiting approval / next actionable step.
  if (!recordRequiresGmApproval(record)) {
    const execIdx = steps.indexOf("产品运维执行")
    if (execIdx >= 0) return execIdx
    return last
  }
  return Math.min(1, last)
}

/** Initial progress when a new instruction is submitted. */
export function initialProgressForInstruction(
  record: Pick<InstructionRecord, "category" | "type">,
  requireGmApproval?: boolean,
): string {
  const needsGm =
    typeof requireGmApproval === "boolean"
      ? requireGmApproval
      : recordRequiresGmApproval({
          ...record,
          requireGmApproval: undefined,
        })
  if (isPoolInstruction(record)) {
    return needsGm ? "待审批(2/3)" : "已完成"
  }
  return needsGm ? "待审批(2/4)" : "待执行(2/3)"
}

/** Snapshot requireGmApproval from current process settings for a new record. */
export function snapshotRequireGmApproval(
  category: InstructionRecord["category"],
): boolean {
  const typeOpt = instructionTypeOptionFromCategory(category)
  return requiresGmApprovalForType(typeOpt, readInstructionProcessConfig())
}

export function isInstructionWorkflowFinished(record: InstructionRecord): boolean {
  const p = record.progress || ""
  if (isInstructionRejected(p)) return true
  if (p.includes("已确认") || p.includes("已完成") || p.includes("结束")) return true
  if (isPoolInstruction(record) && p.includes("已通过")) return true
  return false
}

/** Progress after 总经理审批通过. */
export function progressAfterApproval(
  record: Pick<InstructionRecord, "category" | "type" | "requireGmApproval">,
): string {
  return isPoolInstruction(record) ? "已完成" : "待执行(3/4)"
}

/** Progress after 产品运维执行. */
export function progressAfterExecute(
  record: Pick<InstructionRecord, "category" | "type" | "requireGmApproval">,
): string {
  return recordRequiresGmApproval(record) ? "待确认(4/4)" : "待确认(3/3)"
}

/** Only 基金经理 may initiate new instructions (admins included via role helper). */
export function canInitiateInstruction(): boolean {
  return currentUserHasInstructionRole("fund_manager")
}

export function canApproveInstruction(record: InstructionRecord): boolean {
  if (!recordRequiresGmApproval(record)) return false
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

/** 基金经理 / 产品运维 can browse the shared team inbox (not only personal action items). */
export function canBrowseTeamInstructions(): boolean {
  return (
    currentUserHasInstructionRole("fund_manager")
    || currentUserHasInstructionRole("ops")
  )
}

/** True when the current user still has an action on this instruction. */
export function isInstructionPendingForCurrentUser(record: InstructionRecord): boolean {
  if (canApproveInstruction(record)) return true
  if (canExecuteInstruction(record)) return true
  if (canConfirmInstruction(record)) return true
  // Shared visibility: 基金经理 / 产品运维 see unfinished team instructions under 待处理.
  if (canBrowseTeamInstructions() && !isInstructionWorkflowFinished(record)) return true
  return false
}

function sameInstructionUser(
  storedId: string | null | undefined,
  userId: string,
): boolean {
  const a = (storedId || "").trim()
  return Boolean(a && userId && a === userId)
}

/**
 * True when the current user already completed a step on this instruction.
 * Used by 我处理的 → 已处理.
 *
 * Attribution is by user id (survives 指令角色 switching on the same account).
 * Role-based fallbacks cover legacy rows and the ops team inbox.
 */
export function isInstructionDoneForCurrentUser(record: InstructionRecord): boolean {
  const userId = currentInstructionUserId()
  const p = record.progress || ""
  const myName = currentInstructionInitiator()

  // Same login user acted as approver / executor / confirmer (any current role)
  if (
    sameInstructionUser(record.approverUserId, userId)
    || sameInstructionUser(record.executorUserId, userId)
    || sameInstructionUser(record.confirmerUserId, userId)
  ) {
    return true
  }

  // 总经理: legacy rows / display-name match when user id was not stored
  if (currentUserHasInstructionRole("general_manager")) {
    if (record.approver && myName && record.approver === myName) return true
    const approverId = (record.approverUserId || "").trim()
    if (!approverId && record.approvedAt) return true
    // Finished instructions on the GM flow: keep in 已处理 (incl. 已确认).
    // Only exclude when another user is explicitly recorded as approver.
    if (
      recordRequiresGmApproval(record)
      && (p.includes("已确认") || p.includes("已完成") || p.includes("已驳回"))
      && (!approverId || !userId || approverId === userId)
    ) {
      return true
    }
  }

  // 产品运维: executed or confirmed (no remaining ops action for this row)
  if (currentUserHasInstructionRole("ops")) {
    if (record.confirmDate || p.includes("已确认")) return true
    if (canExecuteInstruction(record) || canConfirmInstruction(record)) return false
    if (record.actualApplyDate || isInstructionExecuted(p)) return true
  }

  return false
}

function canCurrentUserHandle(record: InstructionRecord): boolean {
  return isInstructionPendingForCurrentUser(record) || isInstructionDoneForCurrentUser(record)
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
const API_PATH = "/ma/api/instructions"
const EMPTY_SNAPSHOT: InstructionRecord[] = []

/** Cached for useSyncExternalStore — must return a stable reference between updates. */
let cachedSnapshot: InstructionRecord[] | null = null
let hydratePromise: Promise<void> | null = null
let lastHydrateError: string | null = null

/** Last shared-inbox sync error (null when the latest hydrate succeeded). */
export function getInstructionRecordsHydrateError(): string | null {
  return lastHydrateError
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function authHeaders(): HeadersInit {
  const uid = currentInstructionUserId()
  return uid ? { "x-market-user-id": uid } : {}
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

function sortByCreatedDesc(rows: InstructionRecord[]): InstructionRecord[] {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0
    const tb = Date.parse(b.createdAt) || 0
    return tb - ta
  })
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
  cachedSnapshot = rows.length === 0 ? EMPTY_SNAPSHOT : sortByCreatedDesc(rows)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedSnapshot))
  window.dispatchEvent(new Event(CHANGE_EVENT))
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

async function pushRecordToServer(record: InstructionRecord, method: "POST" | "PUT") {
  await apiFetch<{ ok: true; record: InstructionRecord }>(API_PATH, {
    method,
    body: JSON.stringify({ record }),
  })
}

async function deleteRecordOnServer(id: string) {
  await apiFetch<{ ok: true }>(`${API_PATH}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

/**
 * Pull shared records from server (source of truth) and upload any local-only rows.
 * Safe to call repeatedly; concurrent callers share one in-flight promise.
 */
export function ensureInstructionRecordsHydrated(): Promise<void> {
  if (!canUseStorage()) return Promise.resolve()
  if (hydratePromise) return hydratePromise

  hydratePromise = (async () => {
    try {
      // Live shared inbox is source of truth. Do not auto-upload browser-local history
      // (that re-seeded old test rows). Explicit create/update still POSTs immediately.
      const data = await apiFetch<{ ok: true; records: InstructionRecord[] }>(API_PATH)
      const serverRows = Array.isArray(data.records) ? data.records : []
      writeAll(sortByCreatedDesc(serverRows))
      lastHydrateError = null
    } catch (e) {
      // Keep local cache so the page still works, but expose the error.
      lastHydrateError = e instanceof Error ? e.message : "指令列表同步失败"
    } finally {
      // Allow a later refresh (e.g. after login / role change).
      hydratePromise = null
      if (canUseStorage()) {
        window.dispatchEvent(new Event(CHANGE_EVENT))
      }
    }
  })()

  return hydratePromise
}

/**
 * One-shot recovery: upload browser-local rows missing from the shared inbox.
 * Use on the machine/browser that still has the original 发起 data (e.g. benc).
 */
export async function uploadLocalOnlyInstructionRecords(): Promise<{
  uploaded: number
  failed: string[]
}> {
  if (!canUseStorage()) return { uploaded: 0, failed: ["无 localStorage"] }
  const local = readAll()
  const data = await apiFetch<{ ok: true; records: InstructionRecord[] }>(API_PATH)
  const serverRows = Array.isArray(data.records) ? data.records : []
  const serverIds = new Set(serverRows.map((r) => r.id))
  const localOnly = local.filter((r) => r.id && !serverIds.has(r.id))
  const failed: string[] = []
  let uploaded = 0
  for (const row of localOnly) {
    try {
      await pushRecordToServer(row, "POST")
      uploaded += 1
    } catch (e) {
      failed.push(e instanceof Error ? e.message : `指令 ${row.id} 同步失败`)
    }
  }
  await refreshInstructionRecordsFromServer()
  return { uploaded, failed }
}

/** Force a fresh pull from the shared server inbox. */
export function refreshInstructionRecordsFromServer(): Promise<void> {
  hydratePromise = null
  return ensureInstructionRecordsHydrated()
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

export async function addInstructionRecord(
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
    requireGmApproval?: boolean
  },
): Promise<InstructionRecord> {
  const requireGmApproval =
    typeof input.requireGmApproval === "boolean"
      ? input.requireGmApproval
      : snapshotRequireGmApproval(input.category)
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
    progress:
      input.progress
      ?? initialProgressForInstruction(
        { category: input.category, type: input.type },
        requireGmApproval,
      ),
    summary: input.summary,
    createdAt: new Date().toISOString(),
    initiator: input.initiator ?? currentInstructionInitiator(),
    initiatorUserId: input.initiatorUserId ?? (currentInstructionUserId() || undefined),
    requireGmApproval,
  }
  const next = [record, ...readAll()]
  writeAll(next)
  try {
    await pushRecordToServer(record, "POST")
    lastHydrateError = null
  } catch (e) {
    const message = e instanceof Error ? e.message : "指令同步失败"
    lastHydrateError = message
    throw new Error(message)
  }
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

export async function removeInstructionRecord(id: string): Promise<boolean> {
  const rows = readAll()
  const next = rows.filter((r) => r.id !== id)
  if (next.length === rows.length) return false
  writeAll(next)
  try {
    await deleteRecordOnServer(id)
    lastHydrateError = null
  } catch (e) {
    // Keep local delete; surface sync issue for retry awareness.
    lastHydrateError = e instanceof Error ? e.message : "指令删除同步失败"
  }
  return true
}

export async function updateInstructionRecord(
  id: string,
  patch: Partial<Omit<InstructionRecord, "id" | "createdAt">>,
): Promise<InstructionRecord | null> {
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
  try {
    await pushRecordToServer(nextRecord, "PUT")
    lastHydrateError = null
  } catch (e) {
    const message = e instanceof Error ? e.message : "指令同步失败"
    lastHydrateError = message
    throw new Error(message)
  }
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
