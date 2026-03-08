/**
 * SQLite-backed chat history store.
 * Database file is stored outside the project directory so it survives deployments.
 *
 * Uses node:sqlite (Node 22+ / Node 24) when available at runtime,
 * and falls back to better-sqlite3 (Node 20) otherwise.
 */
import { randomUUID } from "crypto"
import { mkdirSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"

// ── Cross-version SQLite compatibility ───────────────────────────────────────

interface SqlStatement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(...args: any[]): unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(...args: any[]): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all(...args: any[]): any[]
}

interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
}

function openSqlite(filePath: string): SqlDatabase {
  try {
    // node:sqlite is stable in Node 23+ and available (with flag) in Node 22+
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => SqlDatabase
    }
    return new DatabaseSync(filePath)
  } catch {
    // Fallback for Node 20 and any version without node:sqlite
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require("better-sqlite3") as new (path: string) => SqlDatabase
    return new BetterSqlite3(filePath)
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export type ChatConversation = {
  id: string
  userId: string
  title: string
  scope: string        // folder path OR file relativePath
  scopeType: "folder" | "file"
  createdAt: string
  updatedAt: string
}

export type ChatMessage = {
  id: string
  conversationId: string
  role: "user" | "assistant"
  content: string
  sources: string[]   // file paths cited by the assistant
  createdAt: string
}

// ── DB initialisation ─────────────────────────────────────────────────────────

let _db: SqlDatabase | null = null

function getDb(): SqlDatabase {
  if (_db) return _db

  const dbDir = getServerStoragePath("chat_history")
  mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, "chat_history.db")

  const db = openSqlite(dbPath)
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      title       TEXT NOT NULL,
      scope       TEXT NOT NULL DEFAULT '',
      scope_type  TEXT NOT NULL DEFAULT 'folder',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content         TEXT NOT NULL,
      sources         TEXT NOT NULL DEFAULT '[]',
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at ASC);
  `)

  _db = db
  return db
}

// ── Conversations ─────────────────────────────────────────────────────────────

export function listConversations(userId: string): ChatConversation[] {
  const db = getDb()
  const rows = db
    .prepare(`SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`)
    .all(userId) as Record<string, string>[]
  return rows.map(rowToConversation)
}

export function getConversation(id: string, userId: string): ChatConversation | null {
  const db = getDb()
  const row = db
    .prepare(`SELECT * FROM conversations WHERE id = ? AND user_id = ?`)
    .get(id, userId) as Record<string, string> | undefined
  return row ? rowToConversation(row) : null
}

export function createConversation(
  userId: string,
  title: string,
  scope: string,
  scopeType: "folder" | "file",
): ChatConversation {
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO conversations(id, user_id, title, scope, scope_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, title, scope, scopeType, now, now)
  return { id, userId, title, scope, scopeType, createdAt: now, updatedAt: now }
}

export function updateConversationTitle(id: string, userId: string, title: string) {
  const db = getDb()
  db.prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(title, new Date().toISOString(), id, userId)
}

export function touchConversation(id: string) {
  const db = getDb()
  db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id)
}

export function deleteConversation(id: string, userId: string) {
  const db = getDb()
  db.prepare(`DELETE FROM conversations WHERE id = ? AND user_id = ?`).run(id, userId)
}

export function countMessages(conversationId: string): number {
  const db = getDb()
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?`)
    .get(conversationId) as { cnt: number } | undefined
  return row?.cnt ?? 0
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function getMessages(conversationId: string, userId: string): ChatMessage[] {
  const db = getDb()
  // Verify ownership
  const conv = db
    .prepare(`SELECT id FROM conversations WHERE id = ? AND user_id = ?`)
    .get(conversationId, userId) as { id: string } | undefined
  if (!conv) return []

  const rows = db
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`)
    .all(conversationId) as Record<string, string>[]
  return rows.map(rowToMessage)
}

export function appendMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  sources: string[] = [],
): ChatMessage {
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO messages(id, conversation_id, role, content, sources, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, conversationId, role, content, JSON.stringify(sources), now)
  touchConversation(conversationId)
  return { id, conversationId, role, content, sources, createdAt: now }
}

// ── Row mappers ───────────────────────────────────────────────────────────────

function rowToConversation(row: Record<string, string>): ChatConversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    scope: row.scope,
    scopeType: row.scope_type as "folder" | "file",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToMessage(row: Record<string, string>): ChatMessage {
  let sources: string[] = []
  try { sources = JSON.parse(row.sources) } catch {}
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as "user" | "assistant",
    content: row.content,
    sources,
    createdAt: row.created_at,
  }
}
