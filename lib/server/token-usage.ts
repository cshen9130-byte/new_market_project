/**
 * Token usage tracking for DashScope/LangChain API calls.
 * Older rows live in {storageDir}/token_usage/records.json.
 * New rows are appended to records.jsonl so overlapping requests do not overwrite each other.
 */
import { randomUUID } from "crypto"
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"

// ── Types ─────────────────────────────────────────────────────────────────────

export type TokenUsageRecord = {
  id: string
  userId: string
  userName: string
  timestamp: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  model: string
  questionPreview: string   // first 80 chars of question
  /** web = 网页知识库问答. mcp = WorkBuddy / API 工具调用. Older rows omit this and are web. */
  channel?: "web" | "mcp"
  /** Tool name when channel is mcp, e.g. kb_ask. */
  tool?: string
}

export type UserTokenStats = {
  userId: string
  userName: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requestCount: number
  lastUsed: string
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function storageDir(): string {
  return getServerStoragePath("token_usage")
}

function recordsFile(): string {
  return path.join(storageDir(), "records.json")
}

function journalFile(): string {
  return path.join(storageDir(), "records.jsonl")
}

function readJsonRecords(): TokenUsageRecord[] {
  const file = recordsFile()
  if (!existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, "utf-8")) } catch { return [] }
}

function readJournalRecords(): TokenUsageRecord[] {
  const file = journalFile()
  if (!existsSync(file)) return []
  try {
    const out: TokenUsageRecord[] = []
    for (const line of readFileSync(file, "utf-8").split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try { out.push(JSON.parse(trimmed) as TokenUsageRecord) } catch { /* skip a torn line */ }
    }
    return out
  } catch {
    return []
  }
}

function readRecords(): TokenUsageRecord[] {
  mkdirSync(storageDir(), { recursive: true })
  const merged = [...readJsonRecords(), ...readJournalRecords()]
  if (merged.length > 10000) return merged.slice(-10000)
  return merged
}

/** Append one line. A short line is one write, so two Node processes do not overwrite each other. */
function appendJournal(record: TokenUsageRecord): void {
  mkdirSync(storageDir(), { recursive: true })
  appendFileSync(journalFile(), `${JSON.stringify(record)}\n`, "utf8")
}

// ── Public API ────────────────────────────────────────────────────────────────

export function appendTokenUsage(entry: Omit<TokenUsageRecord, "id" | "timestamp">): TokenUsageRecord {
  const record: TokenUsageRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  }
  appendJournal(record)
  return record
}

/** Per-user aggregated stats, sorted by totalTokens desc */
export function getUserTokenStats(): UserTokenStats[] {
  const records = readRecords()
  const map = new Map<string, UserTokenStats>()
  for (const r of records) {
    const existing = map.get(r.userId)
    if (existing) {
      existing.inputTokens += r.inputTokens
      existing.outputTokens += r.outputTokens
      existing.totalTokens += r.totalTokens
      existing.requestCount += 1
      if (r.timestamp > existing.lastUsed) existing.lastUsed = r.timestamp
    } else {
      map.set(r.userId, {
        userId: r.userId,
        userName: r.userName,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        totalTokens: r.totalTokens,
        requestCount: 1,
        lastUsed: r.timestamp,
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens)
}

/** Most recent N records (across all users) */
export function getRecentTokenRecords(limit = 100): TokenUsageRecord[] {
  const records = readRecords()
  return records.slice(-limit).reverse()
}
