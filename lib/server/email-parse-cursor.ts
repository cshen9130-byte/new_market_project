/**
 * Per-mailbox IMAP scan cursors for incremental email NAV / 估值表 parsing.
 *
 * Nightly ETL scans only from the last successful checkpoint (minus overlap).
 * First-time mailboxes (or explicit --days=N backfill) use a full initial window.
 */

import fs from "fs"
import path from "path"
import {
  resolveIncrementalOverlapDays,
  resolveInitialBackfillDays,
} from "@/lib/server/email-parse-lookback"

const DATA_FILE = path.join(process.cwd(), "data", "ops_email_parse_cursors.json")

export type EmailParseScanMode = "incremental" | "initial" | "explicit"

export type AccountParseCursor = {
  initialBackfillDone: boolean
  lastScanCompletedAt: string | null
  /** Latest email sentAt successfully parsed for this mailbox. */
  lastParsedSentAt: string | null
}

type CursorStore = {
  accounts: Record<string, AccountParseCursor>
}

function accountKey(account: string): string {
  return account.trim().toLowerCase()
}

function readStore(): CursorStore {
  if (!fs.existsSync(DATA_FILE)) return { accounts: {} }
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as CursorStore
    return { accounts: raw.accounts && typeof raw.accounts === "object" ? raw.accounts : {} }
  } catch {
    return { accounts: {} }
  }
}

function writeStore(store: CursorStore): void {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8")
}

export function getEmailParseCursor(account: string): AccountParseCursor | null {
  return readStore().accounts[accountKey(account)] ?? null
}

/** Clear cursor so the next scan uses the initial backfill window (new mailbox). */
export function resetEmailParseCursor(account: string): void {
  const store = readStore()
  delete store.accounts[accountKey(account)]
  writeStore(store)
}

function startOfUtcDay(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

/** Resolve IMAP `since` for one mailbox. Omit explicitLookbackDays for nightly incremental. */
export function resolveAccountScanSince(
  account: string,
  explicitLookbackDays?: number,
): { since: Date; mode: EmailParseScanMode } {
  const now = new Date()

  if (explicitLookbackDays != null && explicitLookbackDays > 0) {
    const since = startOfUtcDay(now)
    since.setUTCDate(since.getUTCDate() - explicitLookbackDays)
    return { since, mode: "explicit" }
  }

  const cursor = getEmailParseCursor(account)
  if (!cursor?.initialBackfillDone) {
    const since = startOfUtcDay(now)
    since.setUTCDate(since.getUTCDate() - resolveInitialBackfillDays())
    return { since, mode: "initial" }
  }

  const overlap = resolveIncrementalOverlapDays()
  const anchorIso = cursor.lastParsedSentAt ?? cursor.lastScanCompletedAt
  const since = anchorIso ? startOfUtcDay(new Date(anchorIso)) : startOfUtcDay(now)
  since.setUTCDate(since.getUTCDate() - overlap)
  return { since, mode: "incremental" }
}

export function markAccountScanCompleted(
  account: string,
  opts: {
    mode: EmailParseScanMode
    maxSentAt: Date | null
  },
): void {
  const store = readStore()
  const key = accountKey(account)
  const prev = store.accounts[key] ?? {
    initialBackfillDone: false,
    lastScanCompletedAt: null,
    lastParsedSentAt: null,
  }

  let lastParsedSentAt = prev.lastParsedSentAt
  if (opts.maxSentAt) {
    const sentIso = opts.maxSentAt.toISOString()
    if (!lastParsedSentAt || sentIso > lastParsedSentAt) {
      lastParsedSentAt = sentIso
    }
  }

  store.accounts[key] = {
    initialBackfillDone:
      prev.initialBackfillDone || opts.mode === "initial" || opts.mode === "explicit",
    lastScanCompletedAt: new Date().toISOString(),
    lastParsedSentAt,
  }
  writeStore(store)
}

/**
 * One-time bootstrap for mailboxes that already have parsed history but no cursor file yet
 * (avoids re-scanning 400 days on first deploy of incremental mode).
 */
export function bootstrapEmailParseCursorIfMissing(
  account: string,
  lastParsedSentAt: string | null | undefined,
): void {
  if (!lastParsedSentAt?.trim()) return
  if (getEmailParseCursor(account)) return

  const store = readStore()
  store.accounts[accountKey(account)] = {
    initialBackfillDone: true,
    lastScanCompletedAt: new Date().toISOString(),
    lastParsedSentAt: lastParsedSentAt.trim(),
  }
  writeStore(store)
}
