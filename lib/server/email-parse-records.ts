import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"

export type ParseStepStatus = "成功" | "失败"

export type EmailParseRecord = {
  id: string
  crawlEmailId: string
  crawlEmailAccount: string
  senderEmail: string
  uid: string
  sentAt: string
  subject: string
  tableNavStatus: ParseStepStatus
  postTableNavStatus: ParseStepStatus
  valuationStatus: ParseStepStatus
  ledgerStatus: ParseStepStatus
  parsedAt: string
}

export type EmailParseRecordFilters = {
  tableNavStatus?: ParseStepStatus | "all"
  postTableNavStatus?: ParseStepStatus | "all"
  valuationStatus?: ParseStepStatus | "all"
  ledgerStatus?: ParseStepStatus | "all"
  sentFrom?: string
  sentTo?: string
  subject?: string
  page?: number
  pageSize?: number
}

export type EmailParseRecordStats = {
  total: number
  success: number
  failure: number
  lastUpdatedAt: string | null
}

const DATA_FILE = path.join(process.cwd(), "data", "ops_email_parse_records.json")

type Store = {
  lastUpdatedAt: string | null
  records: EmailParseRecord[]
}

function repairRecordIds(records: EmailParseRecord[]): EmailParseRecord[] {
  return records.map((row) => (row.id?.trim() ? row : { ...row, id: randomUUID() }))
}

function readStore(): Store {
  if (!fs.existsSync(DATA_FILE)) return { lastUpdatedAt: null, records: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Store | EmailParseRecord[]
    const store: Store = Array.isArray(raw)
      ? { lastUpdatedAt: null, records: raw }
      : {
          lastUpdatedAt: raw.lastUpdatedAt ?? null,
          records: Array.isArray(raw.records) ? raw.records : [],
        }
    const repaired = repairRecordIds(store.records)
    if (repaired.some((row, i) => row.id !== store.records[i]?.id)) {
      store.records = repaired
      writeStore(store)
    }
    return store
  } catch {
    return { lastUpdatedAt: null, records: [] }
  }
}

function writeStore(store: Store): void {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8")
}

function recordKey(account: string, uid: string): string {
  return `${account.trim().toLowerCase()}|${uid}`
}

function applyFilters(records: EmailParseRecord[], filters: EmailParseRecordFilters): EmailParseRecord[] {
  const subject = (filters.subject ?? "").trim().toLowerCase()
  const sentFrom = filters.sentFrom ? new Date(filters.sentFrom) : null
  const sentTo = filters.sentTo ? new Date(`${filters.sentTo}T23:59:59.999`) : null

  return records.filter((row) => {
    if (filters.tableNavStatus && filters.tableNavStatus !== "all" && row.tableNavStatus !== filters.tableNavStatus) {
      return false
    }
    if (
      filters.postTableNavStatus &&
      filters.postTableNavStatus !== "all" &&
      row.postTableNavStatus !== filters.postTableNavStatus
    ) {
      return false
    }
    if (filters.valuationStatus && filters.valuationStatus !== "all" && row.valuationStatus !== filters.valuationStatus) {
      return false
    }
    if (filters.ledgerStatus && filters.ledgerStatus !== "all" && row.ledgerStatus !== filters.ledgerStatus) {
      return false
    }
    if (subject && !row.subject.toLowerCase().includes(subject)) return false
    const sentAt = new Date(row.sentAt)
    if (sentFrom && sentAt < sentFrom) return false
    if (sentTo && sentAt > sentTo) return false
    return true
  })
}

export function replaceEmailParseRecords(records: Omit<EmailParseRecord, "id">[]): EmailParseRecord[] {
  const store = readStore()
  const existingByKey = new Map(store.records.map((r) => [recordKey(r.crawlEmailAccount, r.uid), r]))
  const next: EmailParseRecord[] = []

  for (const row of records) {
    const key = recordKey(row.crawlEmailAccount, row.uid)
    const existing = existingByKey.get(key)
    next.push({
      ...row,
      senderEmail: row.senderEmail?.trim() || existing?.senderEmail?.trim() || "",
      id: existing?.id && existing.id.trim() ? existing.id : randomUUID(),
    })
    existingByKey.delete(key)
  }

  store.records = next.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
  store.lastUpdatedAt = new Date().toISOString()
  writeStore(store)
  return store.records
}

export function listEmailParseRecords(filters: EmailParseRecordFilters = {}): {
  rows: EmailParseRecord[]
  total: number
  stats: EmailParseRecordStats
} {
  const store = readStore()
  const filtered = applyFilters(store.records, filters)
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20))
  const start = (page - 1) * pageSize

  return {
    rows: filtered.slice(start, start + pageSize),
    total: filtered.length,
    stats: {
      total: filtered.length,
      success: filtered.filter((r) => r.tableNavStatus === "成功").length,
      failure: filtered.filter((r) => r.tableNavStatus === "失败").length,
      lastUpdatedAt: store.lastUpdatedAt,
    },
  }
}

export function getEmailParseRecordsByIds(ids: string[]): EmailParseRecord[] {
  const idSet = new Set(ids)
  return readStore().records.filter((r) => idSet.has(r.id))
}

export function patchSenderEmails(
  patches: { crawlEmailAccount: string; uid: string; senderEmail: string }[],
): number {
  if (patches.length === 0) return 0
  const store = readStore()
  const byKey = new Map(
    patches.map((p) => [recordKey(p.crawlEmailAccount, p.uid), p.senderEmail.trim()]),
  )
  let changed = 0
  store.records = store.records.map((row) => {
    const sender = byKey.get(recordKey(row.crawlEmailAccount, row.uid))
    if (!sender || sender === row.senderEmail) return row
    changed++
    return { ...row, senderEmail: sender }
  })
  if (changed > 0) {
    store.lastUpdatedAt = new Date().toISOString()
    writeStore(store)
  }
  return changed
}

export function countRecordsMissingSender(): number {
  return readStore().records.filter((r) => !r.senderEmail?.trim()).length
}

export function getRecordsNeedingSender(): Pick<EmailParseRecord, "crawlEmailAccount" | "uid" | "crawlEmailId">[] {
  return readStore()
    .records.filter((r) => !r.senderEmail?.trim())
    .map((r) => ({
      crawlEmailAccount: r.crawlEmailAccount,
      uid: r.uid,
      crawlEmailId: r.crawlEmailId,
    }))
}
