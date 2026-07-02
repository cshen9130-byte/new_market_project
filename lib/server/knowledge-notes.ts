import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { randomUUID } from "crypto"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"

export type KnowledgePrivateNote = {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export type KnowledgePrivateNoteMeta = Pick<KnowledgePrivateNote, "id" | "title" | "createdAt" | "updatedAt">

type LegacyKnowledgeNote = {
  userId?: string
  content?: string
  updatedAt?: string
}

type KnowledgeNotesStore = Record<string, KnowledgePrivateNote[]>

const MAX_NOTE_CHARS = 500_000
const MAX_TITLE_CHARS = 100

function notesStorageDir() {
  return getServerStoragePath("ai-knowledge-base-metadata")
}

function notesStorageFile() {
  return path.join(notesStorageDir(), "notes.json")
}

function ensureStorageDir() {
  mkdirSync(notesStorageDir(), { recursive: true })
}

function readStore(): KnowledgeNotesStore {
  ensureStorageDir()
  const file = notesStorageFile()
  if (!existsSync(file)) {
    return {}
  }

  try {
    const raw = readFileSync(file, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }

    const store: KnowledgeNotesStore = {}
    for (const [userId, value] of Object.entries(parsed)) {
      store[userId] = normalizeUserNotes(value)
    }
    return store
  } catch {
    return {}
  }
}

function writeStore(store: KnowledgeNotesStore) {
  ensureStorageDir()
  writeFileSync(notesStorageFile(), JSON.stringify(store, null, 2), "utf-8")
}

function deriveDefaultTitle(content: string): string {
  const line = content.trim().split("\n")[0]?.trim() || ""
  return line.slice(0, MAX_TITLE_CHARS) || "默认草稿"
}

function normalizeUserNotes(raw: unknown): KnowledgePrivateNote[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is KnowledgePrivateNote => {
        return Boolean(entry && typeof entry === "object" && typeof (entry as KnowledgePrivateNote).id === "string")
      })
      .map((entry) => ({
        id: entry.id,
        title: String(entry.title || "未命名草稿").slice(0, MAX_TITLE_CHARS),
        content: String(entry.content ?? ""),
        createdAt: entry.createdAt || entry.updatedAt || new Date().toISOString(),
        updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString(),
      }))
  }

  if (raw && typeof raw === "object" && "content" in raw) {
    const legacy = raw as LegacyKnowledgeNote
    const updatedAt = legacy.updatedAt || new Date().toISOString()
    const content = String(legacy.content ?? "")
    return [{
      id: randomUUID(),
      title: deriveDefaultTitle(content),
      content,
      createdAt: updatedAt,
      updatedAt,
    }]
  }

  return []
}

function sanitizeTitle(raw: string): string {
  return String(raw || "").trim().slice(0, MAX_TITLE_CHARS) || "未命名草稿"
}

export function listKnowledgeNotes(userId: string): KnowledgePrivateNoteMeta[] {
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) return []

  const store = readStore()
  const notes = store[safeUserId] ?? []
  return notes
    .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function getKnowledgeNote(userId: string, noteId: string): KnowledgePrivateNote | null {
  const safeUserId = String(userId || "").trim()
  const safeNoteId = String(noteId || "").trim()
  if (!safeUserId || !safeNoteId) return null

  const store = readStore()
  return store[safeUserId]?.find((note) => note.id === safeNoteId) ?? null
}

export function saveKnowledgeNote(
  userId: string,
  input: { id?: string | null; title: string; content: string },
): KnowledgePrivateNote {
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) {
    throw new Error("用户未登录")
  }

  const normalized = String(input.content ?? "").replace(/\r\n/g, "\n")
  if (normalized.length > MAX_NOTE_CHARS) {
    throw new Error(`笔记内容过长，请控制在 ${MAX_NOTE_CHARS.toLocaleString("zh-CN")} 字以内`)
  }

  const title = sanitizeTitle(input.title)
  const now = new Date().toISOString()
  const store = readStore()
  const notes = store[safeUserId] ?? []
  const existingId = String(input.id || "").trim()
  const idx = existingId ? notes.findIndex((note) => note.id === existingId) : -1

  if (idx >= 0) {
    const next: KnowledgePrivateNote = {
      ...notes[idx],
      title,
      content: normalized,
      updatedAt: now,
    }
    notes[idx] = next
    store[safeUserId] = notes
    writeStore(store)
    return next
  }

  const created: KnowledgePrivateNote = {
    id: randomUUID(),
    title,
    content: normalized,
    createdAt: now,
    updatedAt: now,
  }
  store[safeUserId] = [created, ...notes]
  writeStore(store)
  return created
}

export function deleteKnowledgeNote(userId: string, noteId: string): boolean {
  const safeUserId = String(userId || "").trim()
  const safeNoteId = String(noteId || "").trim()
  if (!safeUserId || !safeNoteId) return false

  const store = readStore()
  const notes = store[safeUserId] ?? []
  const next = notes.filter((note) => note.id !== safeNoteId)
  if (next.length === notes.length) return false

  store[safeUserId] = next
  writeStore(store)
  return true
}
