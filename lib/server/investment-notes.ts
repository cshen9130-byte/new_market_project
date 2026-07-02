import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"
import type {
  InvestmentNote,
  InvestmentNoteAssociation,
  InvestmentNoteAttachment,
  InvestmentNoteContentVariant,
} from "@/lib/ma/investment-notes"

const MAX_CONTENT_CHARS = 500_000
const MAX_TITLE_CHARS = 200

function storageDir() {
  return getServerStoragePath("investment-notes")
}

function storageFile() {
  return path.join(storageDir(), "notes.json")
}

function ensureStorageDir() {
  mkdirSync(storageDir(), { recursive: true })
}

function previewFromContent(content: string): string {
  const line = content.replace(/\s+/g, " ").trim()
  return line.length > 80 ? `${line.slice(0, 80)}...` : line
}

function normalizeNote(raw: unknown): InvestmentNote & { creatorId: string } {
  const note = (raw ?? {}) as Partial<InvestmentNote & { creatorId?: string }> & {
    associations?: unknown
  }
  const now = new Date().toISOString().slice(0, 10).replace(/-/g, "/")
  const content = typeof note.content === "string" ? note.content : ""
  return {
    id:
      typeof note.id === "string" && note.id
        ? note.id
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: typeof note.title === "string" ? note.title.slice(0, MAX_TITLE_CHARS) : "",
    content,
    preview:
      typeof note.preview === "string" && note.preview
        ? note.preview
        : previewFromContent(content),
    contentVariant: (note.contentVariant ?? "plain") as InvestmentNoteContentVariant,
    teamShared: typeof note.teamShared === "boolean" ? note.teamShared : false,
    tags: Array.isArray(note.tags) ? note.tags.filter((t): t is string => typeof t === "string") : [],
    associations: normalizeAssociations(note.associations),
    attachments: Array.isArray(note.attachments)
      ? (note.attachments as InvestmentNoteAttachment[])
      : [],
    creator: typeof note.creator === "string" ? note.creator : "",
    creatorId: typeof note.creatorId === "string" ? note.creatorId : "",
    lastModifiedBy: typeof note.lastModifiedBy === "string" ? note.lastModifiedBy : "",
    modifiedDate: typeof note.modifiedDate === "string" ? note.modifiedDate : now,
    createdDate: typeof note.createdDate === "string" ? note.createdDate : now,
  }
}

function normalizeAssociations(value: unknown): InvestmentNoteAssociation[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === "string") {
      const match = item.match(/^(.+)\((.+)\)$/)
      if (!match) return { category: "私募基金", name: item, recordNo: "" }
      return { category: "私募基金", name: match[1], recordNo: "" }
    }
    const row = item as Partial<InvestmentNoteAssociation>
    return {
      category: row.category ?? "私募基金",
      name: row.name ?? "",
      recordNo: row.recordNo ?? "",
    }
  })
}

function readAllNotes(): Array<InvestmentNote & { creatorId: string }> {
  ensureStorageDir()
  const file = storageFile()
  if (!existsSync(file)) return []

  try {
    const raw = readFileSync(file, "utf-8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeNote)
  } catch {
    return []
  }
}

function writeAllNotes(notes: Array<InvestmentNote & { creatorId: string }>) {
  ensureStorageDir()
  writeFileSync(storageFile(), JSON.stringify(notes, null, 2), "utf-8")
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "/")
}

function canModifyNote(
  note: InvestmentNote & { creatorId: string },
  userId: string,
): boolean {
  if (note.teamShared) return true
  return note.creatorId === userId
}

export function listServerInvestmentNotes(
  scope: "team" | "mine",
  userId: string,
): InvestmentNote[] {
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) return []

  const notes = readAllNotes()
  const filtered =
    scope === "team"
      ? notes.filter((n) => n.teamShared)
      : notes.filter((n) => n.creatorId === safeUserId)

  return filtered.map(({ creatorId: _creatorId, ...note }) => note)
}

export function createServerInvestmentNote(
  userId: string,
  userName: string,
  partial?: Partial<Pick<InvestmentNote, "title" | "content" | "teamShared">>,
): InvestmentNote {
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) throw new Error("用户未登录")

  const content = String(partial?.content ?? "")
  if (content.length > MAX_CONTENT_CHARS) {
    throw new Error(`笔记内容过长，请控制在 ${MAX_CONTENT_CHARS.toLocaleString("zh-CN")} 字以内`)
  }

  const title = String(partial?.title ?? "").trim().slice(0, MAX_TITLE_CHARS) || "无标题"
  const date = isoDate()
  const note: InvestmentNote & { creatorId: string } = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content,
    preview: previewFromContent(content),
    contentVariant: "plain",
    teamShared: partial?.teamShared ?? false,
    tags: [],
    associations: [],
    attachments: [],
    creator: userName,
    creatorId: safeUserId,
    lastModifiedBy: userName,
    modifiedDate: date,
    createdDate: date,
  }

  const notes = readAllNotes()
  notes.unshift(note)
  writeAllNotes(notes)

  const { creatorId: _creatorId, ...result } = note
  return result
}

export function updateServerInvestmentNote(
  id: string,
  userId: string,
  userName: string,
  patch: Partial<
    Pick<
      InvestmentNote,
      | "title"
      | "content"
      | "contentVariant"
      | "teamShared"
      | "tags"
      | "associations"
      | "attachments"
    >
  >,
): InvestmentNote | null {
  const safeUserId = String(userId || "").trim()
  const safeId = String(id || "").trim()
  if (!safeUserId || !safeId) return null

  const notes = readAllNotes()
  const idx = notes.findIndex((n) => n.id === safeId)
  if (idx < 0) return null

  const existing = notes[idx]
  if (!canModifyNote(existing, safeUserId)) {
    throw new Error("没有权限修改此笔记")
  }

  const content = patch.content !== undefined ? String(patch.content) : existing.content
  if (content.length > MAX_CONTENT_CHARS) {
    throw new Error(`笔记内容过长，请控制在 ${MAX_CONTENT_CHARS.toLocaleString("zh-CN")} 字以内`)
  }

  const updated: InvestmentNote & { creatorId: string } = {
    ...existing,
    ...patch,
    title:
      patch.title !== undefined
        ? String(patch.title).trim().slice(0, MAX_TITLE_CHARS) || "无标题"
        : existing.title,
    content,
    preview: patch.content !== undefined ? previewFromContent(content) : existing.preview,
    lastModifiedBy: userName,
    modifiedDate: isoDate(),
  }

  notes[idx] = updated
  writeAllNotes(notes)

  const { creatorId: _creatorId, ...result } = updated
  return result
}

export function deleteServerInvestmentNote(id: string, userId: string): boolean {
  const safeUserId = String(userId || "").trim()
  const safeId = String(id || "").trim()
  if (!safeUserId || !safeId) return false

  const notes = readAllNotes()
  const target = notes.find((n) => n.id === safeId)
  if (!target) return false
  if (!canModifyNote(target, safeUserId)) {
    throw new Error("没有权限删除此笔记")
  }

  writeAllNotes(notes.filter((n) => n.id !== safeId))
  return true
}
