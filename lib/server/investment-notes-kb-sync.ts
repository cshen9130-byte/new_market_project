import { promises as fs } from "fs"
import path from "path"
import type { InvestmentNote } from "@/lib/ma/investment-notes"
import { roadshowAssociationDisplayLabel } from "@/lib/ma/investment-notes"
import {
  createKnowledgeBaseFolder,
  ensureKnowledgeBaseStorage,
  getKnowledgeBaseStorageRoot,
  recordKnowledgeBaseOwner,
  removeKnowledgeBaseOwnerRecord,
} from "@/lib/server/knowledge-base"

/** Knowledge-base folder that mirrors every 团队笔记. */
export const INVESTMENT_NOTES_KB_FOLDER = "投资笔记"

export type InvestmentNoteKbOwner = {
  id: string
  name: string
  email?: string
}

function sanitizeTitle(raw: string): string {
  return (
    raw
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\.+$/, "")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "无标题"
  )
}

function isWeakTitle(title: string): boolean {
  const t = title.trim()
  if (!t || t === "无标题" || t === "未命名" || t === "投资笔记") return true
  // Bare ids / random tokens used as placeholders
  if (/^[a-z0-9]{4,12}$/i.test(t)) return true
  if (/^\d{10,}-[a-z0-9]+$/i.test(t)) return true
  return false
}

function titleFromContent(content: string): string | null {
  const raw = String(content || "")
  if (!raw.trim()) return null

  const meeting = raw.match(/会议主题\s*[：:]\s*([^<\r\n]+)/)
  if (meeting?.[1]?.trim()) return meeting[1].trim().slice(0, 80)

  const heading = raw.match(/<h[1-3][^>]*>\s*([\s\S]*?)\s*<\/h[1-3]>/i)
  if (heading?.[1]) {
    const text = heading[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
    if (text.length >= 2) return text.slice(0, 80)
  }

  const plain = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")

  for (const line of plain.split(/\n+/)) {
    const t = line.trim()
    if (t.length < 4 || t.length > 80) continue
    if (/^(主要内容|公司与团队|路演基本信息|笔记内容)$/.test(t)) continue
    return t
  }
  return null
}

/** Human-readable title used for KB filename / HTML <title>. */
export function resolveInvestmentNoteKbTitle(note: Pick<
  InvestmentNote,
  "title" | "content" | "associations" | "roadshowAssociations"
>): string {
  const direct = String(note.title || "").trim()
  if (!isWeakTitle(direct)) return direct

  for (const assoc of note.roadshowAssociations || []) {
    const label = roadshowAssociationDisplayLabel(assoc).trim()
    if (label && label !== assoc.rowId && !isWeakTitle(label)) return label
  }

  const product = (note.associations || []).map((a) => a.name?.trim()).find(Boolean)
  if (product) return `${product} 投资笔记`

  const fromContent = titleFromContent(note.content || "")
  if (fromContent && !isWeakTitle(fromContent)) return fromContent

  return direct || "投资笔记"
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildNoteHtml(note: InvestmentNote): string {
  const title = resolveInvestmentNoteKbTitle(note)
  const body = note.content.trim()
  const isHtml = /<[a-z][\s\S]*>/i.test(body)
  const inner = isHtml ? body : escapeHtml(body).replace(/\n/g, "<br />")

  const roadshowBits = (note.roadshowAssociations || [])
    .map((a) => roadshowAssociationDisplayLabel(a))
    .filter(Boolean)
  const productBits = (note.associations || [])
    .map((a) => a.name?.trim())
    .filter(Boolean)

  const metaParts = [
    `创建人：${escapeHtml(note.creator || "-")}`,
    `最近修改：${escapeHtml(note.lastModifiedBy || "-")}`,
    escapeHtml(note.modifiedDate || ""),
  ]
  if (productBits.length) {
    metaParts.push(`关联产品：${escapeHtml(productBits.join("、"))}`)
  }
  if (roadshowBits.length) {
    metaParts.push(`关联路演：${escapeHtml(roadshowBits.join("、"))}`)
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; line-height: 1.7; color: #27272a; max-width: 880px; margin: 24px auto; padding: 0 20px; }
    h1 { font-size: 1.5rem; margin: 0 0 1rem; }
    .meta { color: #71717a; font-size: 0.85rem; margin-bottom: 1.25rem; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #d4d4d8; padding: 6px 10px; }
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${metaParts.filter(Boolean).join(" · ")}</div>
  <div class="content">${inner || "<p>（空笔记）</p>"}</div>
</body>
</html>
`
}

function noteFileName(note: Pick<InvestmentNote, "id" | "title" | "content" | "associations" | "roadshowAssociations">): string {
  // Keep a short unique suffix so renames stay stable, but lead with the human title.
  return `${sanitizeTitle(resolveInvestmentNoteKbTitle(note))}__${note.id}.html`
}

export function expectedKbRelativePath(
  note: Pick<InvestmentNote, "id" | "title" | "content" | "associations" | "roadshowAssociations">,
): string {
  return `${INVESTMENT_NOTES_KB_FOLDER}/${noteFileName(note)}`
}

function relativePathFor(
  note: Pick<InvestmentNote, "id" | "title" | "content" | "associations" | "roadshowAssociations">,
): string {
  return expectedKbRelativePath(note)
}

async function ensureFolder(owner?: InvestmentNoteKbOwner) {
  await createKnowledgeBaseFolder(
    INVESTMENT_NOTES_KB_FOLDER,
    owner
      ? { ownerId: owner.id, ownerName: owner.name, ownerEmail: owner.email }
      : undefined,
  )
}

async function unlinkKbFile(relativePath: string | null | undefined) {
  const normalized = String(relativePath || "").trim().replace(/\\/g, "/")
  if (!normalized || !normalized.startsWith(`${INVESTMENT_NOTES_KB_FOLDER}/`) || normalized.includes("..")) {
    return
  }

  const root = getKnowledgeBaseStorageRoot()
  const filePath = path.join(root, ...normalized.split("/"))
  const resolvedFile = path.resolve(filePath)
  const resolvedRoot = path.resolve(root)
  if (!resolvedFile.startsWith(resolvedRoot + path.sep)) return

  try {
    await fs.unlink(filePath)
  } catch {
    // already gone
  }
  await removeKnowledgeBaseOwnerRecord(normalized)
}

/** Older mirrors used bare `{id}.html` when the note title was empty/weak. */
async function unlinkLegacyIdOnlyFile(noteId: string) {
  const id = String(noteId || "").trim()
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return
  await unlinkKbFile(`${INVESTMENT_NOTES_KB_FOLDER}/${id}.html`)
}

/**
 * Write (or rewrite) a team note into AI 知识库 / 投资笔记.
 * Returns the KB relative path, or null when the note is not team-shared.
 */
export async function upsertTeamNoteInKnowledgeBase(
  note: InvestmentNote,
  owner: InvestmentNoteKbOwner,
  previousKbRelativePath?: string | null,
): Promise<string | null> {
  if (!note.teamShared) {
    await unlinkKbFile(previousKbRelativePath || note.kbRelativePath)
    await unlinkLegacyIdOnlyFile(note.id)
    return null
  }

  await ensureKnowledgeBaseStorage()
  await ensureFolder(owner)

  const relativePath = relativePathFor(note)
  const root = getKnowledgeBaseStorageRoot()
  const filePath = path.join(root, ...relativePath.split("/"))
  const resolvedFile = path.resolve(filePath)
  const resolvedRoot = path.resolve(root)
  if (!resolvedFile.startsWith(resolvedRoot + path.sep)) {
    throw new Error("知识库路径不合法")
  }

  const previous = String(previousKbRelativePath || note.kbRelativePath || "").trim()
  if (previous && previous !== relativePath) {
    await unlinkKbFile(previous)
  }
  // Clean up legacy bare-id filenames left by the first sync.
  if (previous !== `${INVESTMENT_NOTES_KB_FOLDER}/${note.id}.html`) {
    await unlinkLegacyIdOnlyFile(note.id)
  }

  let isNew = true
  try {
    await fs.access(filePath)
    isNew = false
  } catch {
    isNew = true
  }

  await fs.writeFile(filePath, buildNoteHtml(note), "utf-8")

  await recordKnowledgeBaseOwner(
    relativePath,
    { ownerId: owner.id, ownerName: owner.name, ownerEmail: owner.email },
    "file",
    isNew,
  )

  return relativePath
}

export async function removeTeamNoteFromKnowledgeBase(
  noteOrPath: Pick<InvestmentNote, "id" | "title" | "teamShared" | "kbRelativePath" | "content" | "associations" | "roadshowAssociations"> | string | null | undefined,
): Promise<void> {
  if (typeof noteOrPath === "string" || noteOrPath == null) {
    await unlinkKbFile(noteOrPath)
    return
  }
  const pathToRemove = noteOrPath.kbRelativePath || relativePathFor(noteOrPath)
  await unlinkKbFile(pathToRemove)
  await unlinkLegacyIdOnlyFile(noteOrPath.id)
}
