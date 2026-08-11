import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { getServerStoragePath } from "@/lib/server/storage"
import {
  MAX_INVESTMENT_NOTE_CONTENT_CHARS,
  MAX_INVESTMENT_NOTE_TITLE_CHARS,
  compactRichNoteHtml,
  type InvestmentNote,
  type InvestmentNoteAssociation,
  type InvestmentNoteAttachment,
  type InvestmentNoteContentVariant,
  type InvestmentNoteRoadshowAssociation,
} from "@/lib/ma/investment-notes"
import {
  removeTeamNoteFromKnowledgeBase,
  upsertTeamNoteInKnowledgeBase,
  type InvestmentNoteKbOwner,
} from "@/lib/server/investment-notes-kb-sync"

const MAX_CONTENT_CHARS = MAX_INVESTMENT_NOTE_CONTENT_CHARS
const MAX_TITLE_CHARS = MAX_INVESTMENT_NOTE_TITLE_CHARS

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
  const line = content
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
  return line.length > 80 ? `${line.slice(0, 80)}...` : line
}

function normalizeNote(raw: unknown): InvestmentNote & { creatorId: string } {
  const note = (raw ?? {}) as Partial<InvestmentNote & { creatorId?: string }> & {
    associations?: unknown
    roadshowAssociations?: unknown
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
    kbRelativePath:
      typeof note.kbRelativePath === "string" && note.kbRelativePath
        ? note.kbRelativePath
        : null,
    tags: Array.isArray(note.tags) ? note.tags.filter((t): t is string => typeof t === "string") : [],
    associations: normalizeAssociations(note.associations),
    roadshowAssociations: normalizeRoadshowAssociations(note.roadshowAssociations),
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

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeRoadshowAssociations(value: unknown): InvestmentNoteRoadshowAssociation[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: InvestmentNoteRoadshowAssociation[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const row = item as Partial<InvestmentNoteRoadshowAssociation>
    const rowId = typeof row.rowId === "string" ? row.rowId.trim() : ""
    if (!rowId || seen.has(rowId)) continue
    seen.add(rowId)
    const ddDate = optionalTrimmedString(row.ddDate)
    const fundCompany = optionalTrimmedString(row.fundCompany)
    const ddTarget = optionalTrimmedString(row.ddTarget)
    const representativeProduct = optionalTrimmedString(row.representativeProduct)
    const label =
      optionalTrimmedString(row.label) ||
      [ddDate, fundCompany || ddTarget, representativeProduct].filter(Boolean).join(" ") ||
      rowId
    result.push({
      rowId,
      label,
      ...(ddDate ? { ddDate } : {}),
      ...(fundCompany ? { fundCompany } : {}),
      ...(ddTarget ? { ddTarget } : {}),
      ...(representativeProduct ? { representativeProduct } : {}),
    })
  }
  return result
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

function applyKbRelativePath(id: string, kbRelativePath: string | null) {
  const notes = readAllNotes()
  const idx = notes.findIndex((n) => n.id === id)
  if (idx < 0) return
  notes[idx] = { ...notes[idx], kbRelativePath }
  writeAllNotes(notes)
}

async function mirrorNoteToKnowledgeBase(
  note: InvestmentNote & { creatorId: string },
  owner: InvestmentNoteKbOwner,
  previousKbRelativePath?: string | null,
): Promise<InvestmentNote> {
  try {
    const kbRelativePath = await upsertTeamNoteInKnowledgeBase(
      note,
      owner,
      previousKbRelativePath,
    )
    if (kbRelativePath !== (note.kbRelativePath ?? null)) {
      applyKbRelativePath(note.id, kbRelativePath)
    }
    const { creatorId: _creatorId, ...result } = { ...note, kbRelativePath }
    return result
  } catch (err) {
    console.error("[investment-notes] KB mirror failed:", err)
    const { creatorId: _creatorId, ...result } = note
    return result
  }
}

export function createServerInvestmentNote(
  userId: string,
  userName: string,
  partial?: Partial<Pick<InvestmentNote, "title" | "content" | "teamShared">>,
): InvestmentNote {
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) throw new Error("用户未登录")

  const content = compactRichNoteHtml(String(partial?.content ?? ""))
  if (content.length > MAX_CONTENT_CHARS) {
    throw new Error(
      `笔记内容过长，请控制在 ${MAX_CONTENT_CHARS.toLocaleString("zh-CN")} 字符以内（含格式代码，当前 ${content.length.toLocaleString("zh-CN")}）`,
    )
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
    kbRelativePath: null,
    tags: [],
    associations: [],
    roadshowAssociations: [],
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

export async function createServerInvestmentNoteWithKbSync(
  userId: string,
  userName: string,
  owner: InvestmentNoteKbOwner,
  partial?: Partial<Pick<InvestmentNote, "title" | "content" | "teamShared">>,
): Promise<InvestmentNote> {
  const note = createServerInvestmentNote(userId, userName, partial)
  if (!note.teamShared) return note
  return mirrorNoteToKnowledgeBase({ ...note, creatorId: userId }, owner, null)
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
      | "roadshowAssociations"
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

  const content =
    patch.content !== undefined ? compactRichNoteHtml(String(patch.content)) : existing.content
  if (content.length > MAX_CONTENT_CHARS) {
    throw new Error(
      `笔记内容过长，请控制在 ${MAX_CONTENT_CHARS.toLocaleString("zh-CN")} 字符以内（含格式代码，当前 ${content.length.toLocaleString("zh-CN")}）`,
    )
  }

  // Omit undefined patch fields so a partial update cannot clear teamShared / tags / etc.
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as typeof patch

  const updated: InvestmentNote & { creatorId: string } = {
    ...existing,
    ...definedPatch,
    title:
      patch.title !== undefined
        ? String(patch.title).trim().slice(0, MAX_TITLE_CHARS) || "无标题"
        : existing.title,
    content,
    preview: patch.content !== undefined ? previewFromContent(content) : existing.preview,
    associations:
      patch.associations !== undefined
        ? normalizeAssociations(patch.associations)
        : existing.associations,
    roadshowAssociations:
      patch.roadshowAssociations !== undefined
        ? normalizeRoadshowAssociations(patch.roadshowAssociations)
        : existing.roadshowAssociations,
    lastModifiedBy: userName,
    modifiedDate: isoDate(),
  }

  notes[idx] = updated
  writeAllNotes(notes)

  const { creatorId: _creatorId, ...result } = updated
  return result
}

export async function updateServerInvestmentNoteWithKbSync(
  id: string,
  userId: string,
  userName: string,
  owner: InvestmentNoteKbOwner,
  patch: Partial<
    Pick<
      InvestmentNote,
      | "title"
      | "content"
      | "contentVariant"
      | "teamShared"
      | "tags"
      | "associations"
      | "roadshowAssociations"
      | "attachments"
    >
  >,
): Promise<InvestmentNote | null> {
  const before = readAllNotes().find((n) => n.id === id)
  const previousKbRelativePath = before?.kbRelativePath ?? null
  const note = updateServerInvestmentNote(id, userId, userName, patch)
  if (!note) return null

  const creatorId = before?.creatorId || userId
  return mirrorNoteToKnowledgeBase({ ...note, creatorId }, owner, previousKbRelativePath)
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

export async function deleteServerInvestmentNoteWithKbSync(
  id: string,
  userId: string,
): Promise<boolean> {
  const target = readAllNotes().find((n) => n.id === id)
  const deleted = deleteServerInvestmentNote(id, userId)
  if (deleted && target?.teamShared) {
    try {
      await removeTeamNoteFromKnowledgeBase(target)
    } catch (err) {
      console.error("[investment-notes] KB remove failed:", err)
    }
  }
  return deleted
}

/** One-time / lazy backfill for team notes that are not yet mirrored to「投资笔记」. */
export async function backfillTeamNotesToKnowledgeBase(
  owner: InvestmentNoteKbOwner,
): Promise<number> {
  const notes = readAllNotes().filter((n) => n.teamShared && !n.kbRelativePath)
  let synced = 0
  for (const note of notes) {
    const result = await mirrorNoteToKnowledgeBase(
      note,
      {
        id: note.creatorId || owner.id,
        name: note.creator || owner.name,
        email: owner.email,
      },
      null,
    )
    if (result.kbRelativePath) synced += 1
  }
  return synced
}
