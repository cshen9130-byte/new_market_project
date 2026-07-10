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

/**
 * Merge parse records for the given accounts with the new scan results.
 * Records belonging to accounts that were NOT in `scannedAccounts` are
 * preserved unchanged — so a temporary IMAP failure for one account does
 * not wipe out its previously-fetched records.
 *
 * When `scanSince` is provided, records from scanned accounts that fall
 * before that date are kept; only the scan window is upserted. This allows
 * a 7-day re-parse to refresh recent mail without discarding older history.
 *
 * @param records        Fresh records returned by the latest scan.
 * @param scannedAccounts Normalised account names that were actually attempted
 *                        in this scan run (regardless of success/failure per
 *                        email).  Pass an empty array to do a full replace
 *                        (legacy behaviour).
 * @param scanSinceByAccount  Per-mailbox start of the IMAP `since` window for this run.
 *                          Legacy: pass a single Date for all scanned accounts.
 */
export function replaceEmailParseRecords(
  records: Omit<EmailParseRecord, "id">[],
  scannedAccounts: string[] = [],
  scanSinceByAccount?: Map<string, Date> | Record<string, Date> | Date | null,
): EmailParseRecord[] {
  const store = readStore()
  const scanned = new Set(scannedAccounts.map((a) => a.trim().toLowerCase()))
  const doPerAccount = scanned.size > 0
  const newKeys = new Set(records.map((r) => recordKey(r.crawlEmailAccount, r.uid)))

  const sinceForAccount = (acct: string): Date | null => {
    if (scanSinceByAccount == null) return null
    if (scanSinceByAccount instanceof Date) return scanSinceByAccount
    const key = acct.trim().toLowerCase()
    if (scanSinceByAccount instanceof Map) return scanSinceByAccount.get(key) ?? null
    return scanSinceByAccount[key] ?? null
  }

  const preserved = doPerAccount
    ? store.records.filter((r) => {
        const acct = r.crawlEmailAccount.trim().toLowerCase()
        if (!scanned.has(acct)) return true
        const scanSince = sinceForAccount(acct)
        if (!scanSince) return false
        if (new Date(r.sentAt) < scanSince) return true
        return !newKeys.has(recordKey(r.crawlEmailAccount, r.uid))
      })
    : []

  const existingByKey = new Map(store.records.map((r) => [recordKey(r.crawlEmailAccount, r.uid), r]))
  const next: EmailParseRecord[] = [...preserved]

  for (const row of records) {
    const key = recordKey(row.crawlEmailAccount, row.uid)
    const existing = existingByKey.get(key)
    next.push({
      ...row,
      senderEmail: row.senderEmail?.trim() || existing?.senderEmail?.trim() || "",
      id: existing?.id && existing.id.trim() ? existing.id : randomUUID(),
    })
  }

  store.records = next.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
  store.lastUpdatedAt = new Date().toISOString()
  writeStore(store)
  return store.records
}

/** All stored parse records (no pagination cap) — for ETL pool sync. */
export function getAllEmailParseRecords(): EmailParseRecord[] {
  return readStore().records
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

  const all = store.records
  return {
    rows: filtered.slice(start, start + pageSize),
    total: filtered.length,
    stats: {
      total: all.length,
      success: all.filter((r) => r.tableNavStatus === "成功").length,
      failure: all.filter((r) => r.tableNavStatus === "失败").length,
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

/** Latest sentAt per crawl mailbox — used to bootstrap incremental scan cursors. */
export function maxSentAtByCrawlAccount(accounts: string[]): Map<string, string> {
  const wanted = new Set(accounts.map((a) => a.trim().toLowerCase()))
  const out = new Map<string, string>()
  for (const row of readStore().records) {
    const key = row.crawlEmailAccount.trim().toLowerCase()
    if (!wanted.has(key)) continue
    const prev = out.get(key)
    if (!prev || row.sentAt > prev) out.set(key, row.sentAt)
  }
  return out
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
