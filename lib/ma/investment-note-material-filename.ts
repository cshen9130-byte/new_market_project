/**
 * Display-name cleanup for 投资笔记「上传资料」.
 * Storage filenames stay hashed; only the shown `name` is rewritten.
 */

import { normalizeFundDisplayName } from "@/lib/fund-display-name"

export const MATERIAL_DISPLAY_NAME_MAX_CHARS = 60
/** Compact label for the 上传资料 table; hover still shows the full stored name. */
export const MATERIAL_LIST_NAME_MAX_CHARS = 22

const DOC_KIND_PHRASE_RE =
  /基金合同|产品合同|私募合同|产品介绍|基金介绍|一页通|壹页通|一期通|一页纸|要素表|产品要素|产品资料概要|资料概要/gu
const BOILERPLATE_RE =
  /仅供(?:机构投资者)?内部[^\s._-]{0,20}|双面版|内部审查使用|内部法务使用|内部使用/gu
const ANNOUNCEMENT_PREFIX_RE = /第\d+次变更(?:加入)?公告/gu
const DATE_OR_VERSION_PAREN_RE = /[（(](?:20\d{2,6}|\d+改\d+|日期[^)）]*)[)）]/gu
const LONG_DIGIT_RUN_RE = /20\d{6,14}/g
const BEIAN_BEFORE_CJK_RE = /([A-Z]{2,}\d{2,})(?=[\u4e00-\u9fff])/g

const COPY_NUMBER_SUFFIX_RE = /(?:\s*[(（]\d+[)）])+$/u
const VERSION_SUFFIX_RE = /(?:[\s._-]*[vV]\d+)$/u
const COPY_WORD_SUFFIX_RE = /(?:[\s._-]*(?:副本|拷贝|copy))+$/iu

const HEX_NAME_RE = /^[0-9a-f]{16,64}$/i
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GENERIC_NAME_RE =
  /^(image|img|photo|pic|picture|screenshot|screen|download|file|document|untitled|未知|未命名|图片|截图|文件|文档|附件|微信图片|weixin)[-_\s\d]*$/iu
const WECHAT_EXPORT_RE = /^(mmexport|wx_camera|wx_img|weixin)\d+$/i
const CAMERA_ROLL_RE = /^(IMG|DSC|DCIM|PHOTO)[-_]?\d{3,}$/i

const SKIP_TITLE_LINE_RE =
  /^(机密|内部资料|仅供内部参考|目录|封面|contents?|page\s*\d+|第\s*\d+\s*页|保密)$/iu

export function materialExtension(filename: string): string {
  const match = String(filename || "").match(/(\.[A-Za-z0-9]{1,8})$/)
  return match ? match[1].toLowerCase() : ""
}

export function materialBasename(filename: string): string {
  const name = String(filename || "").trim()
  const ext = materialExtension(name)
  return ext ? name.slice(0, -ext.length) : name
}

export function sanitizeMaterialFilename(name: string): string {
  return (
    name.replace(/[^\w\u4e00-\u9fff.\-()+（）\s]/g, "_").replace(/\s+/g, " ").trim() ||
    "material.bin"
  )
}

export function stripRedundantMaterialSuffixes(basename: string): string {
  let current = String(basename || "").trim()
  if (!current) return current
  for (let i = 0; i < 6; i += 1) {
    const next = current
      .replace(COPY_NUMBER_SUFFIX_RE, "")
      .replace(VERSION_SUFFIX_RE, "")
      .replace(COPY_WORD_SUFFIX_RE, "")
      .replace(/[\s._-]+$/u, "")
      .trim()
    if (next === current) break
    current = next
  }
  return current || String(basename || "").trim()
}

export function isOpaqueMaterialFilename(filename: string): boolean {
  const base = stripRedundantMaterialSuffixes(materialBasename(filename))
  const compact = base.replace(/[\s._-]+/g, "")
  if (!compact) return true
  if (HEX_NAME_RE.test(compact)) return true
  if (UUID_RE.test(base)) return true
  if (GENERIC_NAME_RE.test(base)) return true
  if (WECHAT_EXPORT_RE.test(compact)) return true
  if (CAMERA_ROLL_RE.test(base)) return true
  if (/[\u4e00-\u9fff]/.test(base)) return false
  const readableWords = base
    .split(/[\s._-]+/)
    .filter((word) => /[a-z]{4,}/i.test(word) && !/^[0-9a-f]+$/i.test(word))
  return readableWords.length === 0
}

export function cleanMaterialDisplayName(filename: string, ext = ""): string {
  const resolvedExt = ext || materialExtension(filename)
  const rawBase = materialBasename(filename) || "material"
  const stripped = stripRedundantMaterialSuffixes(rawBase)
  const sanitized = sanitizeMaterialFilename(stripped || rawBase)
  const sanitizedBase = materialBasename(sanitized) || "material"
  const clipped = sanitizedBase.slice(0, MATERIAL_DISPLAY_NAME_MAX_CHARS).trim() || "material"
  return `${clipped}${resolvedExt}`
}

/** Short product-style label for lists; does not change the stored filename. */
export function formatMaterialListName(
  filename: string,
  maxChars = MATERIAL_LIST_NAME_MAX_CHARS,
): string {
  const ext = materialExtension(filename)
  const rawBase = materialBasename(filename).trim() || "material"
  let base = rawBase
    .replace(ANNOUNCEMENT_PREFIX_RE, " ")
    .replace(DOC_KIND_PHRASE_RE, " ")
    .replace(BOILERPLATE_RE, " ")
    .replace(DATE_OR_VERSION_PAREN_RE, " ")
    .replace(LONG_DIGIT_RUN_RE, " ")
  const normalized = normalizeFundDisplayName(base)
  if (normalized) base = normalized
  base = base
    .replace(BEIAN_BEFORE_CJK_RE, "$1 ")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s_-]+|[.\s_-]+$/g, "")
    .trim()
  if (!base) base = rawBase
  const limit = Math.max(8, maxChars)
  if (base.length > limit) base = `${base.slice(0, limit).trim()}…`
  return `${base}${ext}`
}

export function materialNameFromNoteTitle(title: string, ext: string): string | null {
  const cleaned = String(title || "")
    .replace(/\s*[（(](?:团队|我的)[)）]\s*$/u, "")
    .trim()
  if (!cleaned) return null
  const name = cleanMaterialDisplayName(cleaned, ext)
  if (isOpaqueMaterialFilename(name)) return null
  return name
}

export function materialNameFromExtractedText(text: string, ext: string): string | null {
  const lines = String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)

  for (const line of lines.slice(0, 24)) {
    if (line.length < 4 || line.length > 80) continue
    if (SKIP_TITLE_LINE_RE.test(line)) continue
    if (/^[\d./\-]+$/.test(line)) continue
    const name = cleanMaterialDisplayName(line, ext)
    if (!isOpaqueMaterialFilename(name) && materialBasename(name).length >= 4) {
      return name
    }
  }

  const compact = lines.join(" ").replace(/\s+/g, " ").trim()
  if (compact.length < 4) return null
  const snippet = compact.slice(0, MATERIAL_DISPLAY_NAME_MAX_CHARS)
  const name = cleanMaterialDisplayName(snippet, ext)
  return isOpaqueMaterialFilename(name) ? null : name
}

export function needsContentBasedMaterialRename(filename: string): boolean {
  return isOpaqueMaterialFilename(cleanMaterialDisplayName(filename))
}

/** Same cleaned display name + size — used to catch re-uploads before hashing. */
export function materialDuplicateKey(name: string, size: number): string {
  return `${cleanMaterialDisplayName(name).trim().toLowerCase()}::${size}`
}

/**
 * Keep one copy per linked note; drop 未关联 extras when a linked copy exists.
 * Among copies of the same note (or all-unlinked), prefer extract jobs, then newest.
 */
export function selectKeptDuplicateMaterialIds<
  T extends {
    id: string
    noteId: string | null
    extractJobId?: number | null
    createdAt: string
  },
>(group: T[]): Set<string> {
  if (group.length <= 1) return new Set(group.map((row) => row.id))

  const better = (a: T, b: T): T => {
    const aExtract = a.extractJobId ? 1 : 0
    const bExtract = b.extractJobId ? 1 : 0
    if (aExtract !== bExtract) return aExtract > bExtract ? a : b
    if (a.createdAt !== b.createdAt) return a.createdAt >= b.createdAt ? a : b
    return a.id <= b.id ? a : b
  }

  const byNote = new Map<string, T[]>()
  const unlinked: T[] = []
  for (const row of group) {
    const noteId = (row.noteId || "").trim()
    if (!noteId) {
      unlinked.push(row)
      continue
    }
    const copies = byNote.get(noteId) ?? []
    copies.push(row)
    byNote.set(noteId, copies)
  }

  const kept = new Set<string>()
  for (const copies of byNote.values()) {
    kept.add(copies.reduce(better).id)
  }
  if (kept.size === 0 && unlinked.length > 0) {
    kept.add(unlinked.reduce(better).id)
  }
  return kept
}

export function partitionDuplicateMaterialFiles<T extends { name: string; size: number }>(
  files: T[],
  existing: { name: string; size: number }[],
): { unique: T[]; duplicates: T[] } {
  const seen = new Set(existing.map((item) => materialDuplicateKey(item.name, item.size)))
  const unique: T[] = []
  const duplicates: T[] = []
  for (const file of files) {
    const key = materialDuplicateKey(file.name, file.size)
    if (seen.has(key)) {
      duplicates.push(file)
      continue
    }
    seen.add(key)
    unique.push(file)
  }
  return { unique, duplicates }
}
