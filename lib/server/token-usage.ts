/**
 * Token usage tracking for DashScope/LangChain API calls.
 * Stored as JSON: {storageDir}/token_usage/records.json
 */
import { randomUUID } from "crypto"
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs"
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

function readRecords(): TokenUsageRecord[] {
  mkdirSync(storageDir(), { recursive: true })
  const file = recordsFile()
  if (!existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, "utf-8")) } catch { return [] }
}

function writeRecords(records: TokenUsageRecord[]): void {
  mkdirSync(storageDir(), { recursive: true })
  writeFileSync(recordsFile(), JSON.stringify(records, null, 2))
}

// ── Public API ────────────────────────────────────────────────────────────────

export function appendTokenUsage(entry: Omit<TokenUsageRecord, "id" | "timestamp">): TokenUsageRecord {
  const records = readRecords()
  const record: TokenUsageRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  }
  records.push(record)
  // Keep last 10000 records to avoid unbounded growth
  if (records.length > 10000) records.splice(0, records.length - 10000)
  writeRecords(records)
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
