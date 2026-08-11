import { promises as fs } from "fs"
import path from "path"
import type { InvestmentNote } from "@/lib/ma/investment-notes"
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
      .slice(0, 80) || "无标题"
  )
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
  const title = note.title.trim() || "无标题"
  const body = note.content.trim()
  const isHtml = /<[a-z][\s\S]*>/i.test(body)
  const inner = isHtml ? body : escapeHtml(body).replace(/\n/g, "<br />")

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
  <div class="meta">创建人：${escapeHtml(note.creator || "-")} · 最近修改：${escapeHtml(note.lastModifiedBy || "-")} · ${escapeHtml(note.modifiedDate || "")}</div>
  <div class="content">${inner || "<p>（空笔记）</p>"}</div>
</body>
</html>
`
}

function noteFileName(note: Pick<InvestmentNote, "id" | "title">): string {
  return `${sanitizeTitle(note.title)}__${note.id}.html`
}

function relativePathFor(note: Pick<InvestmentNote, "id" | "title">): string {
  return `${INVESTMENT_NOTES_KB_FOLDER}/${noteFileName(note)}`
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
  noteOrPath: Pick<InvestmentNote, "id" | "title" | "teamShared" | "kbRelativePath"> | string | null | undefined,
): Promise<void> {
  if (typeof noteOrPath === "string" || noteOrPath == null) {
    await unlinkKbFile(noteOrPath)
    return
  }
  const pathToRemove = noteOrPath.kbRelativePath || relativePathFor(noteOrPath)
  await unlinkKbFile(pathToRemove)
}
