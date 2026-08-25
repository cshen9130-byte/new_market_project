import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs"
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
  type InvestmentNoteExtractedProduct,
  type InvestmentNoteRoadshowAssociation,
} from "@/lib/ma/investment-notes"
import {
  expectedKbRelativePath,
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
    extractedProducts: normalizeExtractedProducts(
      (note as { extractedProducts?: unknown }).extractedProducts,
    ),
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

function normalizeExtractedProducts(value: unknown): InvestmentNoteExtractedProduct[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: InvestmentNoteExtractedProduct[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const row = item as Partial<InvestmentNoteExtractedProduct>
    const name = typeof row.name === "string" ? row.name.trim() : ""
    const recordNo = typeof row.recordNo === "string" ? row.recordNo.trim() : ""
    if (!name && !recordNo) continue
    const key = `${recordNo.toUpperCase()}::${name}`
    if (seen.has(key)) continue
    seen.add(key)
    const sourceFile = typeof row.sourceFile === "string" ? row.sourceFile.trim() : ""
    const confidence =
      row.confidence === "applied" || row.confidence === "matched" || row.confidence === "extracted"
        ? row.confidence
        : "extracted"
    result.push({
      name: name || recordNo,
      recordNo,
      ...(sourceFile ? { sourceFile } : {}),
      confidence,
    })
  }
  return result
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

type StoredNote = InvestmentNote & { creatorId: string }

let notesFileCache: { mtimeMs: number; notes: StoredNote[] } | null = null

function toPublicNote(note: StoredNote): InvestmentNote {
  const { creatorId: _creatorId, ...result } = note
  return result
}

function toLiteNote(note: InvestmentNote): InvestmentNote {
  return {
    ...note,
    content: "",
    contentPending: true,
    hasBody: Boolean((note.content ?? "").trim()),
  }
}

function readAllNotes(): StoredNote[] {
  ensureStorageDir()
  const file = storageFile()
  if (!existsSync(file)) {
    notesFileCache = null
    return []
  }

  try {
    const mtimeMs = statSync(file).mtimeMs
    if (notesFileCache && notesFileCache.mtimeMs === mtimeMs) {
      return notesFileCache.notes
    }
    const raw = readFileSync(file, "utf-8")
    const parsed = JSON.parse(raw)
    const notes = Array.isArray(parsed) ? parsed.map(normalizeNote) : []
    notesFileCache = { mtimeMs, notes }
    return notes
  } catch {
    notesFileCache = null
    return []
  }
}

function writeAllNotes(notes: StoredNote[]) {
  ensureStorageDir()
  const file = storageFile()
  writeFileSync(file, JSON.stringify(notes), "utf-8")
  try {
    notesFileCache = { mtimeMs: statSync(file).mtimeMs, notes }
  } catch {
    notesFileCache = { mtimeMs: Date.now(), notes }
  }
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

export function getServerInvestmentNote(
  id: string,
  userId: string,
): InvestmentNote | null {
  const safeId = String(id || "").trim()
  const safeUserId = String(userId || "").trim()
  if (!safeId || !safeUserId) return null

  const note = readAllNotes().find((n) => n.id === safeId)
  if (!note) return null
  if (!note.teamShared && note.creatorId !== safeUserId) return null
  return { ...toPublicNote(note), contentPending: false, hasBody: Boolean(note.content.trim()) }
}

export function listServerInvestmentNotes(
  scope: "team" | "mine",
  userId: string,
  options?: { hydrateId?: string; includeContent?: boolean },
): InvestmentNote[] {
  const safeUserId = String(userId || "").trim()
  if (!safeUserId) return []

  const notes = readAllNotes()
  const filtered =
    scope === "team"
      ? notes.filter((n) => n.teamShared)
      : notes.filter((n) => n.creatorId === safeUserId)

  const publicNotes = filtered.map(toPublicNote)
  if (options?.includeContent) return publicNotes

  const hydrateId = String(options?.hydrateId || "").trim()
  if (!hydrateId) return publicNotes.map(toLiteNote)

  return publicNotes.map((note) => (note.id === hydrateId ? note : toLiteNote(note)))
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

export type CreateServerInvestmentNoteOptions = {
  /** Default prepends (newest first). Append puts the note at the end of 团队笔记. */
  append?: boolean
}

export function createServerInvestmentNote(
  userId: string,
  userName: string,
  partial?: Partial<
    Pick<
      InvestmentNote,
      "title" | "content" | "teamShared" | "associations" | "extractedProducts" | "roadshowAssociations"
    >
  >,
  options?: CreateServerInvestmentNoteOptions,
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
    associations:
      partial?.associations !== undefined
        ? normalizeAssociations(partial.associations)
        : [],
    extractedProducts:
      partial?.extractedProducts !== undefined
        ? normalizeExtractedProducts(partial.extractedProducts)
        : [],
    roadshowAssociations:
      partial?.roadshowAssociations !== undefined
        ? normalizeRoadshowAssociations(partial.roadshowAssociations)
        : [],
    attachments: [],
    creator: userName,
    creatorId: safeUserId,
    lastModifiedBy: userName,
    modifiedDate: date,
    createdDate: date,
  }

  const notes = readAllNotes()
  if (options?.append) notes.push(note)
  else notes.unshift(note)
  writeAllNotes(notes)

  const { creatorId: _creatorId, ...result } = note
  return result
}

export async function createServerInvestmentNoteWithKbSync(
  userId: string,
  userName: string,
  owner: InvestmentNoteKbOwner,
  partial?: Partial<
    Pick<
      InvestmentNote,
      "title" | "content" | "teamShared" | "associations" | "extractedProducts" | "roadshowAssociations"
    >
  >,
  options?: CreateServerInvestmentNoteOptions,
): Promise<InvestmentNote> {
  const note = createServerInvestmentNote(userId, userName, partial, options)
  if (!note.teamShared) return note
  return mirrorNoteToKnowledgeBase({ ...note, creatorId: userId }, owner, null)
}

/** All 尽调表格 row ids already linked from any investment note. */
export function collectInvestmentNoteRoadshowRowIds(): Set<string> {
  const ids = new Set<string>()
  for (const note of readAllNotes()) {
    for (const assoc of note.roadshowAssociations ?? []) {
      const rowId = assoc.rowId?.trim()
      if (rowId) ids.add(rowId)
    }
  }
  return ids
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
      | "extractedProducts"
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
    extractedProducts:
      patch.extractedProducts !== undefined
        ? normalizeExtractedProducts(patch.extractedProducts)
        : existing.extractedProducts,
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
      | "extractedProducts"
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

/**
 * Lazy backfill / rename for team notes mirrored to「投资笔记」.
 * Also rewrites files whose stored path no longer matches the derived title
 * (fixes bare `{id}.html` and stale titles from the first sync).
 */
export async function backfillTeamNotesToKnowledgeBase(
  owner: InvestmentNoteKbOwner,
): Promise<number> {
  const notes = readAllNotes().filter((n) => {
    if (!n.teamShared) return false
    const expected = expectedKbRelativePath(n)
    return !n.kbRelativePath || n.kbRelativePath !== expected
  })
  let synced = 0
  for (const note of notes) {
    const result = await mirrorNoteToKnowledgeBase(
      note,
      {
        id: note.creatorId || owner.id,
        name: note.creator || owner.name,
        email: owner.email,
      },
      note.kbRelativePath,
    )
    if (result.kbRelativePath) synced += 1
  }
  return synced
}
