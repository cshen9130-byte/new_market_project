import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"

export type KnowledgeNote = {
  userId: string
  content: string
  updatedAt: string
}

type KnowledgeNotesStore = Record<string, KnowledgeNote>

const MAX_NOTE_CHARS = 500_000

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
    return parsed as KnowledgeNotesStore
  } catch {
    return {}
  }
}

function writeStore(store: KnowledgeNotesStore) {
  ensureStorageDir()
  writeFileSync(notesStorageFile(), JSON.stringify(store, null, 2), "utf-8")
}

export function getKnowledgeNote(userId: string): KnowledgeNote | null {
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) {
    return null
  }

  const store = readStore()
  const note = store[safeUserId]
  return note ?? null
}

export function saveKnowledgeNote(userId: string, content: string): KnowledgeNote {
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) {
    throw new Error("用户未登录")
  }

  const normalized = String(content ?? "").replace(/\r\n/g, "\n")
  if (normalized.length > MAX_NOTE_CHARS) {
    throw new Error(`笔记内容过长，请控制在 ${MAX_NOTE_CHARS.toLocaleString("zh-CN")} 字以内`)
  }

  const store = readStore()
  const next: KnowledgeNote = {
    userId: safeUserId,
    content: normalized,
    updatedAt: new Date().toISOString(),
  }
  store[safeUserId] = next
  writeStore(store)
  return next
}
