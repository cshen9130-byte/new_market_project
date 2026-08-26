/**
 * Display-name cleanup for 投资笔记「上传资料」.
 * Storage filenames stay hashed; only the shown `name` is rewritten.
 */

export const MATERIAL_DISPLAY_NAME_MAX_CHARS = 60

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
