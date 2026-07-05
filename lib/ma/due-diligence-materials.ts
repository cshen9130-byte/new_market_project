import type { DueDiligenceTableRow } from "./due-diligence-table"

/** Root folder in AI knowledge base for internal due diligence uploads. */
export const DD_MATERIALS_KB_ROOT = "内部尽调资料"

export type DdMaterialsDocument = {
  name: string
  relativePath: string
  extension: string
  size: number
  updatedAt: string
  canPreview: boolean
}

export type DdMaterialsFolderIndex = {
  /** Child folders directly under `内部尽调资料`, keyed by relative path. */
  folders: Map<string, { name: string; relativePath: string; documents: DdMaterialsDocument[] }>
}

type KbTreeFolder = {
  name: string
  relativePath: string
  folders: KbTreeFolder[]
  documents: Array<{
    name: string
    relativePath: string
    extension: string
    size: number
    updatedAt: string
    canPreview?: boolean
  }>
}

/** `2026/6/26` → `2026.6.26` (matches KB folder naming). */
export function formatKbFolderDate(ddDate: string): string | null {
  const match = ddDate.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
  if (!match) return null
  const [, year, month, day] = match
  return `${year}.${Number(month)}.${Number(day)}`
}

function extractBrandPrefix(value: string): string | null {
  const name = value.trim()
  if (!name) return null
  const match = name.match(/^([\u4e00-\u9fff]{2})/)
  return match?.[1] ?? null
}

function extractManagerBrand(managerName: string): string | null {
  const name = managerName.trim()
  if (!name) return null
  const stripped = name.replace(/^(上海|北京|深圳|广州|杭州|南京|成都|重庆|天津|苏州|宁波|武汉|厦门|青岛|大连|香港)/, "")
  if (stripped.length >= 2) return stripped.slice(0, 4)
  return extractBrandPrefix(name)
}

function extractProductBrand(productName: string): string | null {
  const name = productName.trim()
  if (!name) return null
  const match = name.match(/^([\u4e00-\u9fff]{4})/)
  if (match) return match[1]
  return extractBrandPrefix(name)
}
function normalizeLabel(value: string): string {
  return value
    .trim()
    .replace(/^(上海|北京|深圳|广州|杭州|南京|成都|重庆|天津|苏州|宁波|武汉|厦门|青岛|大连|香港)/, "")
    .replace(/(科技|资产|投资|私募|基金|管理|有限公司|股份|证券|资管)$/g, "")
    .trim()
}

/** Brand / short name used in KB folder names, e.g. 标准定律科技 → 标准定律. */
export function extractDdMaterialsLabel(
  row: Pick<DueDiligenceTableRow, "fundCompany" | "investmentManager" | "representativeProduct">,
): string {
  const fundCompany = row.fundCompany.trim()
  if (fundCompany) {
    const brand = extractManagerBrand(fundCompany)
    if (brand) return brand
    const normalized = normalizeLabel(fundCompany)
    if (normalized.length >= 2) return normalized.slice(0, 4)
  }

  const manager = row.investmentManager.trim()
  if (manager) {
    const first = manager.split(/[、,，/]/)[0]?.trim() ?? ""
    if (first.length >= 2) return first.slice(0, 4)
  }

  const product = row.representativeProduct.trim()
  if (product) {
    const brand = extractProductBrand(product)
    if (brand) return brand
    if (product.length >= 2) return product.slice(0, 4)
  }

  return ""
}

/** Expected folder name segment, e.g. `2026.6.26-标准定律`. */
export function buildExpectedFolderSlug(
  row: Pick<DueDiligenceTableRow, "ddDate" | "fundCompany" | "investmentManager" | "representativeProduct">,
): string | null {
  const datePart = formatKbFolderDate(row.ddDate)
  const label = extractDdMaterialsLabel(row)
  if (!datePart || !label) return null
  return `${datePart}-${label}`
}

export function buildDdMaterialsKbUrl(folderPath: string): string {
  return `/ma/dashboard/ai-knowledge?folder=${encodeURIComponent(folderPath)}`
}

export function buildDdMaterialsPreviewUrl(relativePath: string): string {
  const params = new URLSearchParams({ path: relativePath, preview: "1" })
  return `/api/knowledge-base/file?${params.toString()}`
}

export function buildDdMaterialsFileUrl(relativePath: string, download = false): string {
  const params = new URLSearchParams({ path: relativePath })
  if (download) params.set("download", "1")
  return `/api/knowledge-base/file?${params.toString()}`
}

export function buildDdMaterialsEditableTextUrl(relativePath: string): string {
  const params = new URLSearchParams({ path: relativePath, text: "1" })
  return `/api/knowledge-base/file?${params.toString()}`
}

const DD_MATERIALS_EDITABLE_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".log", ".tsv", ".xml", ".docx"])

export function isDdMaterialsEditable(document: Pick<DdMaterialsDocument, "extension">): boolean {
  return DD_MATERIALS_EDITABLE_EXTENSIONS.has(document.extension.toLowerCase())
}

function findRootFolder(tree: KbTreeFolder | null, rootPath: string): KbTreeFolder | null {
  if (!tree) return null
  if (!rootPath) return tree
  if (tree.relativePath === rootPath) return tree

  for (const child of tree.folders) {
    const found = findRootFolder(child, rootPath)
    if (found) return found
  }
  return null
}

export function buildDdMaterialsFolderIndex(tree: KbTreeFolder | null): DdMaterialsFolderIndex {
  const folders = new Map<string, { name: string; relativePath: string; documents: DdMaterialsDocument[] }>()
  const root = findRootFolder(tree, DD_MATERIALS_KB_ROOT)
  if (!root) return { folders }

  for (const folder of root.folders) {
    folders.set(folder.relativePath, {
      name: folder.name,
      relativePath: folder.relativePath,
      documents: folder.documents.map((doc) => ({
        name: doc.name,
        relativePath: doc.relativePath,
        extension: doc.extension,
        size: doc.size,
        updatedAt: doc.updatedAt,
        canPreview: Boolean(doc.canPreview),
      })),
    })
  }
  return { folders }
}

function scoreFolderMatch(folderName: string, slug: string, label: string, datePart: string): number {
  const normalizedName = folderName.trim()
  if (normalizedName === slug) return 100
  if (normalizedName.startsWith(`${slug}-`) || normalizedName.startsWith(slug)) return 90
  if (normalizedName.includes(slug)) return 80
  if (normalizedName.startsWith(datePart) && normalizedName.includes(label)) return 70
  if (normalizedName.startsWith(datePart)) return 40
  return 0
}

export function resolveDdMaterialsFolderPath(
  row: Pick<
    DueDiligenceTableRow,
    "ddDate" | "fundCompany" | "investmentManager" | "representativeProduct" | "ddMaterialsKbPath"
  >,
  index: DdMaterialsFolderIndex,
): string | null {
  const explicit = row.ddMaterialsKbPath?.trim()
  if (explicit && index.folders.has(explicit)) return explicit

  const slug = buildExpectedFolderSlug(row)
  const datePart = formatKbFolderDate(row.ddDate)
  const label = extractDdMaterialsLabel(row)
  if (!slug || !datePart || !label) return explicit || null

  let bestPath: string | null = null
  let bestScore = 0

  for (const [path, folder] of index.folders) {
    const score = scoreFolderMatch(folder.name, slug, label, datePart)
    if (score > bestScore) {
      bestScore = score
      bestPath = path
    }
  }

  return bestScore >= 40 ? bestPath : explicit || null
}

export function getDdMaterialsDocuments(
  folderPath: string | null,
  index: DdMaterialsFolderIndex,
): DdMaterialsDocument[] {
  if (!folderPath) return []
  return index.folders.get(folderPath)?.documents ?? []
}

export function rowHasDdMaterials(
  row: Pick<DueDiligenceTableRow, "ddMaterials">,
  folderPath: string | null,
  index: DdMaterialsFolderIndex,
): boolean {
  if (row.ddMaterials.trim() === "已上传") return true
  if (!folderPath) return false
  return getDdMaterialsDocuments(folderPath, index).length > 0
}

export function buildDdMaterialsAutoFillPatch(
  row: DueDiligenceTableRow,
  index: DdMaterialsFolderIndex,
): Partial<DueDiligenceTableRow> | null {
  const folderPath = resolveDdMaterialsFolderPath(row, index)
  if (!folderPath) return null
  const documents = getDdMaterialsDocuments(folderPath, index)
  if (documents.length === 0) return null

  if (row.ddMaterials.trim() === "已上传" && row.ddMaterialsKbPath === folderPath) {
    return null
  }

  return {
    ddMaterials: "已上传",
    ddMaterialsKbPath: folderPath,
  }
}
