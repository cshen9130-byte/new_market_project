/** Filename heuristics for 产品要素 sources (一页通 / 要素表 / 产品介绍). */

export const FUND_ELEMENT_EXTRACT_MAX_MB = 20
export const FUND_ELEMENT_EXTRACT_MAX_BYTES = FUND_ELEMENT_EXTRACT_MAX_MB * 1024 * 1024

export const FUND_ELEMENT_EXTRACT_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
] as const

const POSITIVE_RE =
  /一页通|壹页通|一期通|一页纸|要素表|产品要素|产品介绍|基金介绍|产品资料概要|资料概要|介绍[-_.]?\d{2,}/

const NEGATIVE_RE = /估值表|路演纪要|会议纪要|公司简介|管理人简介|策略介绍/

export function isFundElementSourceFilename(fileName: string): boolean {
  const name = (fileName || "").trim()
  if (!name) return false
  if (NEGATIVE_RE.test(name)) return false
  return POSITIVE_RE.test(name)
}

export function isFundElementExtractableFile(file: {
  name: string
  size: number
}): boolean {
  if (!isFundElementSourceFilename(file.name)) return false
  if (!Number.isFinite(file.size) || file.size <= 0) return false
  if (file.size > FUND_ELEMENT_EXTRACT_MAX_BYTES) return false
  const lower = file.name.toLowerCase()
  return FUND_ELEMENT_EXTRACT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function fundElementSourceKindLabel(fileName: string): string | null {
  if (!isFundElementSourceFilename(fileName)) return null
  if (/要素表|产品要素/.test(fileName)) return "要素表"
  if (/一页通|壹页通|一期通|一页纸/.test(fileName)) return "一页通"
  if (/产品资料概要|资料概要/.test(fileName)) return "资料概要"
  if (/产品介绍|基金介绍|介绍[-_.]?\d{2,}/.test(fileName)) return "产品介绍"
  return "产品要素"
}
