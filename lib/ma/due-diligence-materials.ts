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
    .replace(/^(上海|北京|深圳|广州|杭州|南京|成都|重庆|天津|苏州|宁波|武汉|厦门|青岛|大连|香港|海南)/, "")
    .replace(/(科技|资产|投资|私募|基金|管理|有限公司|股份|证券|资管)$/g, "")
    .trim()
}

export type DdMaterialsMatchRow = Pick<
  DueDiligenceTableRow,
  | "ddDate"
  | "fundCompany"
  | "investmentManager"
  | "representativeProduct"
  | "strategyPreliminary"
  | "otherInfo"
  | "ddTarget"
  | "ddMaterialsKbPath"
>

function looksLikeCompanyName(value: string): boolean {
  const name = value.trim()
  if (!name) return false
  return /(公司|资产|投资|私募|基金|管理|有限|股份|证券|资管|FOF|fof|资本|控股|集团)/u.test(name)
}

function addMatchLabel(labels: Set<string>, raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return

  for (const segment of trimmed.split(/[、,，/\s]+/u)) {
    const part = segment.trim()
    if (part.length < 2) continue
    labels.add(part.slice(0, 6))
    const normalized = normalizeLabel(part)
    if (normalized.length >= 2) {
      labels.add(normalized.slice(0, 4))
      if (normalized.length > 2) labels.add(normalized.slice(0, 2))
    }
  }
}

/** Candidate labels from all row fields that may appear in KB folder names. */
export function collectDdMaterialsMatchLabels(
  row: Pick<
    DueDiligenceTableRow,
    "fundCompany" | "investmentManager" | "representativeProduct" | "strategyPreliminary" | "otherInfo" | "ddTarget"
  >,
): string[] {
  const labels = new Set<string>()

  const fundCompany = row.fundCompany.trim()
  if (fundCompany && looksLikeCompanyName(fundCompany)) {
    addMatchLabel(labels, fundCompany)
    const brand = extractManagerBrand(fundCompany)
    if (brand) labels.add(brand)
  }

  const manager = row.investmentManager.trim()
  if (manager) addMatchLabel(labels, manager.split(/[、,，/]/u)[0] ?? "")

  addMatchLabel(labels, row.representativeProduct)
  addMatchLabel(labels, row.strategyPreliminary)
  addMatchLabel(labels, row.otherInfo)
  addMatchLabel(labels, row.ddTarget)

  if (labels.size === 0 && fundCompany) addMatchLabel(labels, fundCompany)

  return [...labels].filter((label) => label.length >= 2)
}

/** Brand / short name used in KB folder names, e.g. 标准定律科技 → 标准定律. */
export function extractDdMaterialsLabel(
  row: Pick<DueDiligenceTableRow, "fundCompany" | "investmentManager" | "representativeProduct">,
): string {
  return collectDdMaterialsMatchLabels(row)[0] ?? ""
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

/** Minimum score to accept a folder match (requires date + label alignment). */
const DD_MATERIALS_MIN_MATCH_SCORE = 70

function extractFolderDateLabel(folderName: string, datePart: string): string {
  const name = folderName.trim()
  if (!name.startsWith(datePart)) return ""
  const rest = name.slice(datePart.length).replace(/^[-_.]/u, "").trim()
  return rest.replace(/项目$/u, "").trim() || rest
}

function labelsOverlap(a: string, b: string): boolean {
  if (a.length < 2 || b.length < 2) return false
  return a.includes(b) || b.includes(a)
}

function folderMatchesDate(folderName: string, datePart: string): boolean {
  const name = folderName.trim()
  return name === datePart || name.startsWith(`${datePart}-`) || name.startsWith(`${datePart}.`)
}

function foldersMatchingDate(index: DdMaterialsFolderIndex, datePart: string) {
  return [...index.folders.entries()].filter(([, folder]) => folderMatchesDate(folder.name, datePart))
}

function scoreFolderMatch(
  folderName: string,
  slug: string | null,
  matchLabels: string[],
  datePart: string,
): number {
  const normalizedName = folderName.trim()
  let best = 0

  if (slug) {
    if (normalizedName === slug) best = Math.max(best, 100)
    if (normalizedName.startsWith(`${slug}-`) || normalizedName.startsWith(slug)) best = Math.max(best, 90)
    if (normalizedName.includes(slug)) best = Math.max(best, 80)
  }

  for (const label of matchLabels) {
    if (normalizedName.startsWith(datePart) && normalizedName.includes(label)) {
      best = Math.max(best, 70)
    }
  }

  const folderLabel = extractFolderDateLabel(normalizedName, datePart)
  if (folderLabel) {
    for (const label of matchLabels) {
      if (labelsOverlap(folderLabel, label)) best = Math.max(best, 75)
    }
  }

  return best
}

function isPlausibleDdMaterialsFolderMatch(
  folderName: string,
  row: DdMaterialsMatchRow,
  index?: DdMaterialsFolderIndex,
): boolean {
  const datePart = formatKbFolderDate(row.ddDate)
  if (!datePart || !folderMatchesDate(folderName, datePart)) return false

  const slug = buildExpectedFolderSlug(row)
  const matchLabels = collectDdMaterialsMatchLabels(row)
  if (scoreFolderMatch(folderName, slug, matchLabels, datePart) >= DD_MATERIALS_MIN_MATCH_SCORE) {
    return true
  }

  if (index) {
    const dateFolders = foldersMatchingDate(index, datePart)
    if (dateFolders.length === 1 && dateFolders[0][1].name === folderName.trim()) {
      return dateFolders[0][1].documents.length > 0
    }
  }

  return false
}

export function resolveDdMaterialsFolderPath(
  row: DdMaterialsMatchRow,
  index: DdMaterialsFolderIndex,
): string | null {
  const datePart = formatKbFolderDate(row.ddDate)
  const slug = buildExpectedFolderSlug(row)
  const matchLabels = collectDdMaterialsMatchLabels(row)

  const explicit = row.ddMaterialsKbPath?.trim()
  if (explicit && index.folders.has(explicit)) {
    const folder = index.folders.get(explicit)!
    if (datePart && folderMatchesDate(folder.name, datePart)) return explicit
    if (isPlausibleDdMaterialsFolderMatch(folder.name, row, index)) return explicit
  }

  if (!datePart) return null

  let bestPath: string | null = null
  let bestScore = 0

  for (const [path, folder] of index.folders) {
    const score = scoreFolderMatch(folder.name, slug, matchLabels, datePart)
    if (score > bestScore) {
      bestScore = score
      bestPath = path
    }
  }

  if (bestScore >= DD_MATERIALS_MIN_MATCH_SCORE) return bestPath

  const dateFolders = foldersMatchingDate(index, datePart)
  if (dateFolders.length === 1) {
    const [path, folder] = dateFolders[0]
    if (folder.documents.length > 0) return path
  }

  return null
}

export function getDdMaterialsDocuments(
  folderPath: string | null,
  index: DdMaterialsFolderIndex,
): DdMaterialsDocument[] {
  if (!folderPath) return []
  return index.folders.get(folderPath)?.documents ?? []
}

const DD_MATERIALS_NEUTRAL_FILENAME_TOKENS = new Set([
  "简报",
  "要素表",
  "业绩走势图",
  "转写结果",
  "会议纪要",
  "AI纪要",
])

const DD_MATERIALS_NON_BRAND_TOKENS = new Set([
  "权益类",
  "绩效",
  "宏观",
  "策略",
  "投资",
  "路演",
  "转写",
  "合并",
  "要素",
  "业绩",
  "走势",
  "交流",
  "小范围",
  "主观",
  "量化",
  "产品介绍",
  "会议",
  "助手",
  "报告",
  "纪要",
  "录音",
  "材料",
  "说明",
  "Disclaimer",
])

function collectRowDocumentMatchTerms(
  row: Pick<
    DueDiligenceTableRow,
    "fundCompany" | "investmentManager" | "representativeProduct" | "strategyPreliminary" | "otherInfo" | "ddTarget"
  >,
): string[] {
  return collectDdMaterialsMatchLabels(row)
}

function isNeutralDdMaterialsFilename(name: string): boolean {
  const base = name.replace(/\.[^.]+$/u, "").trim()
  if (!base) return true
  if (/^STJ[A-Z0-9]+/i.test(base)) return false
  if (/^\d{4}[_-]\d{2}[_-]\d{2}/.test(base)) return true
  return DD_MATERIALS_NEUTRAL_FILENAME_TOKENS.has(base)
}

function isLikelyForeignCompanyBrand(token: string): boolean {
  const normalized = normalizeLabel(token)
  if (normalized.length < 2) return false
  if (DD_MATERIALS_NON_BRAND_TOKENS.has(normalized)) return false
  if ([...DD_MATERIALS_NON_BRAND_TOKENS].some((generic) => normalized.startsWith(generic))) return false
  return true
}

function extractFilenameCompanyBrands(name: string): string[] {
  const base = name.replace(/\.[^.]+$/u, "").trim()
  const brands = new Set<string>()

  for (const match of base.matchAll(/【([^】]{2,10})】/gu)) {
    const inner = match[1]?.trim() ?? ""
    const chinese = inner.match(/[\u4e00-\u9fff]{2,6}/u)?.[0]
    if (chinese) brands.add(chinese.slice(0, 4))
  }

  const leading = base.match(/^[\d_\-【\[\]\s]*([\u4e00-\u9fff]{2,6})/u)?.[1]
  if (leading) brands.add(leading.slice(0, 4))

  const underscored = base.match(/^([\u4e00-\u9fff]{2,6})_/u)?.[1]
  if (underscored) brands.add(underscored.slice(0, 4))

  for (const match of base.matchAll(/[-－]([\u4e00-\u9fff]{2,6})/gu)) {
    brands.add(match[1].slice(0, 4))
  }

  return [...brands].map((brand) => normalizeLabel(brand)).filter((brand) => brand.length >= 2)
}

function documentTermsCompatible(brand: string, matchTerms: string[]): boolean {
  return matchTerms.some((term) => brand.includes(term) || term.includes(brand))
}

/** Drop files in a shared folder that clearly belong to another manager/company. */
export function filterDdMaterialsDocumentsForRow(
  row: Pick<DueDiligenceTableRow, "fundCompany" | "investmentManager" | "representativeProduct">,
  documents: DdMaterialsDocument[],
): DdMaterialsDocument[] {
  const matchTerms = collectRowDocumentMatchTerms(row)
  if (matchTerms.length === 0) return documents

  return documents.filter((doc) => {
    const name = doc.name
    if (matchTerms.some((term) => name.includes(term))) return true
    if (isNeutralDdMaterialsFilename(name)) return true

    const foreignBrands = extractFilenameCompanyBrands(name).filter(isLikelyForeignCompanyBrand)
    if (foreignBrands.length === 0) return true

    return foreignBrands.every((brand) => documentTermsCompatible(brand, matchTerms))
  })
}

export function getDdMaterialsDocumentsForRow(
  row: Pick<
    DueDiligenceTableRow,
    "fundCompany" | "investmentManager" | "representativeProduct" | "ddMaterialsKbPath"
  >,
  index: DdMaterialsFolderIndex,
): DdMaterialsDocument[] {
  const folderPath = resolveDdMaterialsFolderPath(row, index)
  return filterDdMaterialsDocumentsForRow(row, getDdMaterialsDocuments(folderPath, index))
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
  const documents = folderPath ? filterDdMaterialsDocumentsForRow(row, getDdMaterialsDocuments(folderPath, index)) : []
  const storedPath = row.ddMaterialsKbPath?.trim() || null

  if (!folderPath || documents.length === 0) {
    if (storedPath || row.ddMaterials.trim() === "已上传") {
      return { ddMaterials: "", ddMaterialsKbPath: null }
    }
    return null
  }

  if (row.ddMaterials.trim() === "已上传" && storedPath === folderPath) {
    return null
  }

  return {
    ddMaterials: "已上传",
    ddMaterialsKbPath: folderPath,
  }
}
