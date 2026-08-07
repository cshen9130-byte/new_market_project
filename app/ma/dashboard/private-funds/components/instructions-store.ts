export type InstructionCategory = "underlying" | "direct" | "customer" | "pool"

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
  progress: string
  summary: string
  createdAt: string
  initiator: string
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
