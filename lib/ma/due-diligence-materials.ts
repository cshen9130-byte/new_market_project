import type { DueDiligenceTableRow, DdMaterialsLinkStatus } from "./due-diligence-table"

/** Root folder in AI knowledge base for internal due diligence uploads. */
export const DD_MATERIALS_KB_ROOT = "内部尽调资料"

export function isDdMaterialsLinkLocked(
  row: Pick<DueDiligenceTableRow, "ddMaterialsLinkStatus">,
): boolean {
  return row.ddMaterialsLinkStatus === "approved" || row.ddMaterialsLinkStatus === "manual"
}

export function isDdMaterialsAutoLinkDisabled(
  row: Pick<DueDiligenceTableRow, "ddMaterialsLinkStatus">,
): boolean {
  return row.ddMaterialsLinkStatus === "rejected"
}

export function ddMaterialsLinkStatusLabel(status: DdMaterialsLinkStatus | undefined): string {
  switch (status) {
    case "approved":
      return "已确认"
    case "manual":
      return "手动关联"
    case "rejected":
      return "已排除自动关联"
    default:
      return "自动关联"
  }
}

export function ddMaterialsFileLinkStatusLabel(
  relativePath: string,
  fileLinks: Partial<Record<string, "approved" | "rejected">> | undefined,
  rowLinkStatus: DdMaterialsLinkStatus | undefined,
): { label: string; tone: "auto" | "approved" | "rejected" } {
  const fileStatus = fileLinks?.[relativePath]
  if (fileStatus === "rejected") return { label: "已排除", tone: "rejected" }
  if (fileStatus === "approved") return { label: "已确认", tone: "approved" }
  if (rowLinkStatus === "approved" || rowLinkStatus === "manual") {
    return { label: "已确认", tone: "approved" }
  }
  if (rowLinkStatus === "rejected") return { label: "已排除", tone: "rejected" }
  return { label: "自动", tone: "auto" }
}

export function applyDdMaterialsFileLinkFilters(
  allDocuments: DdMaterialsDocument[],
  autoDocuments: DdMaterialsDocument[],
  fileLinks?: Partial<Record<string, "approved" | "rejected">>,
): DdMaterialsDocument[] {
  if (!fileLinks || Object.keys(fileLinks).length === 0) return autoDocuments

  const visible = new Set<string>()
  for (const doc of autoDocuments) {
    if (fileLinks[doc.relativePath] !== "rejected") visible.add(doc.relativePath)
  }
  for (const doc of allDocuments) {
    if (fileLinks[doc.relativePath] === "approved") visible.add(doc.relativePath)
  }
  return allDocuments.filter((doc) => visible.has(doc.relativePath))
}

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

/** `2026/6/26` or `2026.6.26` → `2026.6.26` (matches KB folder naming). */
export function formatKbFolderDate(ddDate: string): string | null {
  const match = ddDate.trim().match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/)
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

/** Rows whose 基金公司 is a meeting/event title, not an actual fund company. */
function isEventStyleFundCompany(value: string): boolean {
  const name = value.trim()
  if (!name) return false
  if (/^\d{4}\s*年/u.test(name)) return true
  if (/半年度|季度|策略会|交流会|线上会|观看方式|扫码/u.test(name)) return true
  return false
}

/** Strip meeting/event suffixes but keep the fund brand, e.g. 敦和芝诺系列半年度总结 → 敦和芝诺. */
function stripFundCompanyEventNoise(name: string): string {
  return name
    .trim()
    .replace(/^\d{4}\s*年/u, "")
    .replace(/系列/gu, "")
    .replace(/半年度|季度|年度|总结|策略会|交流会|线上会|会议|路演|观看方式|扫码/gu, "")
    .trim()
}

/** Search tokens from 基金公司, longest first, e.g. 敦和芝诺系列半年度总结 → [敦和芝诺, 敦和]. */
export function extractFundCompanyMatchTerms(fundCompany: string): string[] {
  const raw = fundCompany.trim()
  if (!raw) return []

  const stripped = stripFundCompanyEventNoise(raw)
  const normalized = normalizeLabel(stripped)
  const source = normalized.length >= 2 ? normalized : stripped
  if (source.length < 2) return []

  const terms = new Set<string>()
  terms.add(source.slice(0, Math.min(6, source.length)))
  if (source.length >= 4) terms.add(source.slice(0, 4))
  if (source.length >= 2) terms.add(source.slice(0, 2))

  return [...terms]
    .filter((term) => term.length >= 2)
    .sort((left, right) => right.length - left.length)
}

function shouldAutoLinkDdMaterials(
  row: Pick<DueDiligenceTableRow, "fundCompany">,
): boolean {
  const fundCompany = row.fundCompany.trim()
  if (!fundCompany) return true
  if (!isEventStyleFundCompany(fundCompany)) return true
  return extractFundCompanyMatchTerms(fundCompany).length > 0
}

/** Primary folder-name labels; 基金公司 always wins when it yields tokens. */
function collectDdMaterialsPrimaryLabels(
  row: Pick<DueDiligenceTableRow, "fundCompany" | "investmentManager" | "representativeProduct">,
): string[] {
  const labels: string[] = []
  const seen = new Set<string>()
  const add = (value: string) => {
    const token = value.trim()
    if (token.length < 2 || seen.has(token)) return
    seen.add(token)
    labels.push(token)
  }

  for (const term of extractFundCompanyMatchTerms(row.fundCompany)) add(term)
  if (labels.length > 0) return labels

  const manager = row.investmentManager.trim().split(/[、,，/]/u)[0]?.trim() ?? ""
  if (manager.length >= 2) add(manager.slice(0, 4))

  const productBrand = extractProductBrand(row.representativeProduct.trim())
  if (productBrand) add(productBrand)
  else {
    const product = row.representativeProduct.trim()
    if (product.length >= 2) add(product.slice(0, 4))
  }

  return labels
}

function scoreFolderPrimaryLabelMatches(
  folderName: string,
  datePart: string,
  primaryLabels: string[],
): number {
  let best = 0
  for (const label of primaryLabels) {
    const slug = `${datePart}-${label}`
    best = Math.max(best, scoreFolderMatch(folderName, slug, label, datePart))
  }
  return best
}

/** Brand / short name used in KB folder names, e.g. 标准定律科技 → 标准定律. */
export function extractDdMaterialsLabel(
  row: Pick<DueDiligenceTableRow, "fundCompany" | "investmentManager" | "representativeProduct">,
): string {
  return collectDdMaterialsPrimaryLabels(row)[0] ?? ""
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
  const leaf = folderPath.split("/").pop() ?? folderPath
  const parent =
    /\.[a-z0-9]{2,5}$/i.test(leaf) && folderPath.includes("/")
      ? folderPath.replace(/\/[^/]+$/u, "")
      : folderPath
  return `/ma/dashboard/ai-knowledge?folder=${encodeURIComponent(parent)}`
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

function mapKbDocument(doc: KbTreeFolder["documents"][number]): DdMaterialsDocument {
  return {
    name: doc.name,
    relativePath: doc.relativePath,
    extension: doc.extension,
    size: doc.size,
    updatedAt: doc.updatedAt,
    canPreview: Boolean(doc.canPreview),
  }
}

function collectDdMaterialsFolders(
  folder: KbTreeFolder,
  folders: Map<string, { name: string; relativePath: string; documents: DdMaterialsDocument[] }>,
) {
  if (folder.documents.length > 0) {
    folders.set(folder.relativePath, {
      name: folder.name,
      relativePath: folder.relativePath,
      documents: folder.documents.map(mapKbDocument),
    })
  }
  for (const child of folder.folders) {
    collectDdMaterialsFolders(child, folders)
  }
}

export function buildDdMaterialsFolderIndex(tree: KbTreeFolder | null): DdMaterialsFolderIndex {
  const folders = new Map<string, { name: string; relativePath: string; documents: DdMaterialsDocument[] }>()
  const root = findRootFolder(tree, DD_MATERIALS_KB_ROOT)
  if (!root) return { folders }

  for (const folder of root.folders) {
    collectDdMaterialsFolders(folder, folders)
  }

  for (const doc of root.documents) {
    folders.set(doc.relativePath, {
      name: doc.name,
      relativePath: doc.relativePath,
      documents: [mapKbDocument(doc)],
    })
  }

  return { folders }
}

/** Minimum score to accept a folder match (requires date + label alignment). */
const DD_MATERIALS_MIN_MATCH_SCORE = 70

/** Reused fund folders may be dated up to this many days before the DD row date. */
const DD_MATERIALS_FUND_REUSE_MAX_DAYS_BEFORE = 180

/** Reused fund folders may be at most this many days after the DD row date. */
const DD_MATERIALS_FUND_REUSE_MAX_DAYS_AFTER = 14

/** `2026.07.16` and `2026.7.16` both normalize to `2026.7.16`. */
function normalizeKbDateParts(value: string): string | null {
  const match = value.trim().match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/u)
  if (!match) return null
  return `${match[1]}.${Number(match[2])}.${Number(match[3])}`
}

function parseFolderDateAndLabel(folderName: string): { datePart: string | null; label: string } {
  const name = folderName.trim()
  const dashMatch = name.match(/^(\d{4}[./]\d{1,2}[./]\d{1,2})[-－—](.+)$/u)
  if (dashMatch) {
    return {
      datePart: normalizeKbDateParts(dashMatch[1]),
      label: dashMatch[2].replace(/项目$/u, "").trim(),
    }
  }
  return { datePart: normalizeKbDateParts(name), label: "" }
}

/** Supports short folder names like `6.22 奥创etf` when the DD row supplies the year. */
function resolveFolderDateAndLabel(
  folderName: string,
  ddDateHint?: string,
): { datePart: string | null; label: string } {
  const parsed = parseFolderDateAndLabel(folderName)
  if (parsed.datePart) return parsed

  const hint = ddDateHint?.trim() ?? ""
  const kbDate = formatKbFolderDate(hint) ?? normalizeKbDateParts(hint)
  if (!kbDate) return parsed

  const shortMatch = folderName.trim().match(/^(\d{1,2})[./](\d{1,2})\s+(.+)$/u)
  if (!shortMatch) return parsed

  const year = kbDate.split(".")[0]
  const datePart = normalizeKbDateParts(`${year}.${Number(shortMatch[1])}.${Number(shortMatch[2])}`)
  if (!datePart) return parsed

  return { datePart, label: shortMatch[3].replace(/项目$/u, "").trim() }
}

function folderMatchesDate(folderName: string, datePart: string): boolean {
  const normalizedDate = normalizeKbDateParts(datePart)
  if (!normalizedDate) return false

  const { datePart: folderDate } = resolveFolderDateAndLabel(folderName, datePart)
  if (folderDate === normalizedDate) return true

  const name = folderName.trim()
  if (name === normalizedDate || name.startsWith(`${normalizedDate}-`) || name.startsWith(`${normalizedDate}.`)) {
    return true
  }

  const [, month, day] = normalizedDate.split(".").map(Number)
  const shortMatch = name.match(/^(\d{1,2})[./](\d{1,2})\b/u)
  if (shortMatch) {
    return Number(shortMatch[1]) === month && Number(shortMatch[2]) === day
  }

  return false
}

function folderMatchesExactDate(folderName: string, datePart: string): boolean {
  const normalizedDate = normalizeKbDateParts(datePart)
  if (!normalizedDate) return false

  const { datePart: folderDate } = resolveFolderDateAndLabel(folderName, datePart)
  if (folderDate === normalizedDate) return true

  const name = folderName.trim()
  return name === normalizedDate || name.startsWith(`${normalizedDate}-`) || name.startsWith(`${normalizedDate}.`)
}

/** Same month/day as the DD row, even when folder year differs (e.g. 2024.7.22 vs 2026/7/22). */
function folderMatchesMonthDay(folderName: string, datePart: string): boolean {
  const normalizedDate = normalizeKbDateParts(datePart)
  if (!normalizedDate) return false

  const [, month, day] = normalizedDate.split(".").map(Number)
  const { datePart: folderDate } = resolveFolderDateAndLabel(folderName, datePart)
  if (folderDate) {
    const [, folderMonth, folderDay] = folderDate.split(".").map(Number)
    return folderMonth === month && folderDay === day
  }

  const shortMatch = folderName.trim().match(/^(\d{1,2})[./](\d{1,2})\b/u)
  if (shortMatch) {
    return Number(shortMatch[1]) === month && Number(shortMatch[2]) === day
  }

  return false
}

function documentFilenameMatchesRowMonthDay(doc: DdMaterialsDocument, ddDate: string): boolean {
  const normalizedDd = normalizeKbDateParts(formatKbFolderDate(ddDate) ?? "")
  if (!normalizedDd) return false

  const [, month, day] = normalizedDd.split(".").map(Number)
  const embedded = doc.name.match(/(\d{4})[._-]?(\d{1,2})[._-]?(\d{1,2})/u)
  if (embedded) {
    return Number(embedded[2]) === month && Number(embedded[3]) === day
  }

  return documentUpdatedOnDdDate(doc, ddDate)
}

function extractFolderDateLabel(folderName: string, datePart: string): string {
  if (!folderMatchesDate(folderName, datePart)) return ""

  const { datePart: folderDate, label } = resolveFolderDateAndLabel(folderName, datePart)
  const normalizedDate = normalizeKbDateParts(datePart)
  if (folderDate === normalizedDate && label) return label

  const shortMatch = folderName.trim().match(/^(\d{1,2})[./](\d{1,2})\s+(.+)$/u)
  return shortMatch?.[3]?.replace(/项目$/u, "").trim() ?? ""
}

function extractFolderLabel(folderName: string): string {
  return parseFolderDateAndLabel(folderName).label
}

function kbDateToUtcDays(value: string): number | null {
  const normalized = normalizeKbDateParts(value)
  if (!normalized) return null
  const [year, month, day] = normalized.split(".").map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function getRowStrategyPrefixes(
  row: Pick<DueDiligenceTableRow, "strategyLevel1" | "strategyLevel2" | "strategyLevel3">,
): string[] {
  return [row.strategyLevel3, row.strategyLevel2, row.strategyLevel1]
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
}

function extractFundNameFromStrategyFolderLabel(
  folderLabel: string,
  strategyPrefixes: string[],
): string | null {
  const sorted = [...strategyPrefixes].sort((a, b) => b.length - a.length)
  for (const prefix of sorted) {
    if (folderLabel.startsWith(prefix)) {
      const rest = folderLabel.slice(prefix.length).replace(/基金$/u, "").trim()
      if (rest.length >= 2) return normalizeLabel(rest)
    }
  }

  const trailing = folderLabel.match(/([\u4e00-\u9fff]{2,8})基金$/u)?.[1]
  if (trailing) return normalizeLabel(trailing)
  return null
}

function addAlternateMatchLabel(labels: Set<string>, raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return

  const addToken = (token: string) => {
    const part = token.trim()
    if (part.length < 2) return
    labels.add(part.slice(0, 6))
    const normalized = normalizeLabel(part)
    if (normalized.length >= 2) {
      labels.add(normalized.slice(0, 4))
    }
  }

  addToken(trimmed)
  for (const segment of trimmed.split(/[、,，/\s]+/u)) addToken(segment)
  for (const segment of trimmed.split(/[-－—]/u)) addToken(segment)
}

/** Secondary labels when fund-company slug does not match KB folder naming. */
function collectSecondaryMatchLabels(
  row: Pick<
    DueDiligenceTableRow,
    | "fundCompany"
    | "ddTarget"
    | "strategyPreliminary"
  >,
): string[] {
  const labels = new Set<string>()
  for (const term of extractFundCompanyMatchTerms(row.fundCompany)) labels.add(term)
  if (!isEventStyleFundCompany(row.fundCompany)) {
    addAlternateMatchLabel(labels, row.fundCompany)
  }
  addAlternateMatchLabel(labels, row.ddTarget)
  addAlternateMatchLabel(labels, row.strategyPreliminary)
  return [...labels].filter((label) => label.length >= 2)
}

function labelsOverlap(a: string, b: string): boolean {
  if (a.length < 2 || b.length < 2) return false
  return a.includes(b) || b.includes(a)
}

/** Same leading brand character, e.g. 泓诚 ↔ 泓淋投资. */
function brandsRelated(a: string, b: string): boolean {
  if (labelsOverlap(a, b)) return true
  const left = normalizeLabel(a)
  const right = normalizeLabel(b)
  if (left.length < 2 || right.length < 2) return false
  if (left[0] !== right[0]) return false
  return left.length <= 4 && right.length <= 6
}

function collectRowIdentityTerms(
  row: Pick<
    DueDiligenceTableRow,
    | "fundCompany"
    | "investmentManager"
    | "representativeProduct"
    | "ddTarget"
    | "strategyPreliminary"
    | "otherInfo"
    | "ddConclusion"
  >,
): string[] {
  const terms = new Set<string>()
  const fundCompanyTerms = extractFundCompanyMatchTerms(row.fundCompany)
  for (const term of fundCompanyTerms) terms.add(term)
  if (!isEventStyleFundCompany(row.fundCompany)) {
    addAlternateMatchLabel(terms, row.fundCompany)
  }
  // When 基金公司 is known, never fall back to 代表产品 brand (e.g. 铭跃 → wrong 量化* folder).
  if (fundCompanyTerms.length === 0) {
    addAlternateMatchLabel(terms, row.representativeProduct)
  }
  addAlternateMatchLabel(terms, row.investmentManager.split(/[、,，/]/u)[0] ?? "")
  addAlternateMatchLabel(terms, row.ddTarget)
  addAlternateMatchLabel(terms, row.strategyPreliminary)
  addAlternateMatchLabel(terms, row.otherInfo)
  addAlternateMatchLabel(terms, row.ddConclusion)
  const label = extractDdMaterialsLabel(row)
  if (label) terms.add(label)
  return [...terms].filter((term) => term.length >= 2)
}

/** Require folder label (or strategy-stripped fund name) to carry 基金公司 when company is set. */
function fundCompanyMatchesFolderLabel(
  fundCompanyTerms: string[],
  folderLabel: string,
  fundFromFolder: string | null = null,
): boolean {
  if (fundCompanyTerms.length === 0) return true
  return fundCompanyTerms.some((term) => {
    if (labelsOverlap(folderLabel, term) || brandsRelated(term, folderLabel)) return true
    if (fundFromFolder && (labelsOverlap(fundFromFolder, term) || brandsRelated(term, fundFromFolder))) {
      return true
    }
    return false
  })
}

function collectFolderDocumentTerms(documents: DdMaterialsDocument[]): string[] {
  const terms = new Set<string>()
  for (const doc of documents) {
    addAlternateMatchLabel(terms, doc.name.replace(/\.[^.]+$/u, ""))
  }
  return [...terms].filter((term) => term.length >= 2)
}

function isStrongIdentityTerm(term: string): boolean {
  return term.length >= 2 && !DD_MATERIALS_NON_BRAND_TOKENS.has(term)
}

function documentUpdatedOnDdDate(doc: DdMaterialsDocument, ddDate: string): boolean {
  const normalizedDd = normalizeKbDateParts(formatKbFolderDate(ddDate) ?? "")
  if (!normalizedDd) return false

  const updated = doc.updatedAt.trim()
  const iso = updated.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/u)
  if (!iso) return false

  const normalizedDoc = `${iso[1]}.${Number(iso[2])}.${Number(iso[3])}`
  return normalizedDoc === normalizedDd
}

/** Match an existing fund folder reused across roadshows when dates differ. */
function scoreFolderFundReuseMatch(
  folder: { name: string; documents: DdMaterialsDocument[] },
  row: Pick<
    DueDiligenceTableRow,
    | "ddDate"
    | "fundCompany"
    | "investmentManager"
    | "representativeProduct"
    | "ddTarget"
    | "strategyPreliminary"
    | "otherInfo"
    | "ddConclusion"
    | "strategyLevel1"
    | "strategyLevel2"
    | "strategyLevel3"
  >,
): number {
  if (isEventStyleFundCompany(row.fundCompany) && extractFundCompanyMatchTerms(row.fundCompany).length === 0) return 0

  const { datePart: folderDate, label: folderLabel } = resolveFolderDateAndLabel(folder.name, row.ddDate)
  const ddDatePart = formatKbFolderDate(row.ddDate)
  if (!folderDate || !folderLabel || !ddDatePart) return 0

  const folderDays = kbDateToUtcDays(folderDate)
  const ddDays = kbDateToUtcDays(ddDatePart)
  if (folderDays === null || ddDays === null) return 0

  const dayDiff = ddDays - folderDays
  if (dayDiff < -DD_MATERIALS_FUND_REUSE_MAX_DAYS_AFTER || dayDiff > DD_MATERIALS_FUND_REUSE_MAX_DAYS_BEFORE) {
    return 0
  }

  const strategyPrefixes = getRowStrategyPrefixes(row)
  const fundFromFolder = extractFundNameFromStrategyFolderLabel(folderLabel, strategyPrefixes)
  const fundCompanyTerms = extractFundCompanyMatchTerms(row.fundCompany)
  // Prefer 基金公司 over product/strategy keywords; leave empty when company is absent from folder name.
  if (!fundCompanyMatchesFolderLabel(fundCompanyTerms, folderLabel, fundFromFolder)) return 0

  const identityTerms = collectRowIdentityTerms(row).filter(isStrongIdentityTerm)
  const documentTerms = collectFolderDocumentTerms(folder.documents)
  const strategyPrefix = strategyPrefixes.find((prefix) => prefix.length >= 3 && folderLabel.startsWith(prefix))
  const folderLabelInDocs = documentTerms.some((docTerm) => labelsOverlap(docTerm, folderLabel))

  const identityHit = identityTerms.some((term) => {
    if (labelsOverlap(folderLabel, term) || brandsRelated(term, folderLabel)) return true
    if (fundFromFolder && (labelsOverlap(fundFromFolder, term) || brandsRelated(term, fundFromFolder))) return true
    if (!folderLabelInDocs) return false
    return documentTerms.some((docTerm) => labelsOverlap(docTerm, term) || brandsRelated(term, docTerm))
  })

  const strategyConfirmed =
    Boolean(strategyPrefix)
    && Boolean(fundFromFolder)
    && folderLabelInDocs
    && documentTerms.some((docTerm) => labelsOverlap(docTerm, fundFromFolder!))

  const brandedDocTerms = documentTerms.filter((docTerm) => labelsOverlap(docTerm, folderLabel))
  const hasDdSubject = row.investmentManager.trim().length >= 2 || row.ddTarget.trim().length >= 2
  const sameDayFolderConfirmed =
    !identityHit
    && !strategyConfirmed
    && hasDdSubject
    && dayDiff <= 14
    && folderLabelInDocs
    && brandedDocTerms.length >= 2
    && folder.documents.some((doc) => documentUpdatedOnDdDate(doc, row.ddDate))

  if (!identityHit && !strategyConfirmed && !sameDayFolderConfirmed) return 0

  let score = identityHit ? 84 : strategyConfirmed ? 78 : 76
  if (fundFromFolder && identityTerms.some((term) => labelsOverlap(fundFromFolder, term) || brandsRelated(term, fundFromFolder))) {
    score += 4
  }
  if (strategyPrefix) score += 3
  const dayDistance = Math.abs(dayDiff)
  if (dayDistance <= 3) score += 4
  else if (dayDistance <= 14) score += 2
  else if (dayDiff >= 0 && dayDiff <= 90) score += 1

  if (sameDayFolderConfirmed) score += 2

  return score
}

function scoreFolderAlternateMatch(folderName: string, datePart: string, alternateLabels: string[]): number {
  if (
    !folderMatchesDate(folderName, datePart)
    && !folderMatchesMonthDay(folderName, datePart)
    && !folderName.trim().startsWith(datePart)
  ) {
    return 0
  }

  const folderLabel =
    extractFolderDateLabel(folderName, datePart)
    || extractFolderLabel(folderName)
  if (!folderLabel) return 0

  let best = 0
  for (const label of alternateLabels) {
    if (labelsOverlap(folderLabel, label) || brandsRelated(folderLabel, label)) {
      best = Math.max(best, folderMatchesDate(folderName, datePart) ? 75 : 74)
    }
  }
  return best
}

/** Match KB folders when month/day and fund identity align but folder year differs from the row. */
function scoreFolderMonthDayIdentityMatch(
  folder: { name: string; documents: DdMaterialsDocument[] },
  row: Pick<
    DueDiligenceTableRow,
    | "ddDate"
    | "fundCompany"
    | "investmentManager"
    | "representativeProduct"
    | "ddTarget"
    | "strategyPreliminary"
    | "otherInfo"
    | "ddConclusion"
  >,
): number {
  if (isEventStyleFundCompany(row.fundCompany) && extractFundCompanyMatchTerms(row.fundCompany).length === 0) return 0

  const datePart = formatKbFolderDate(row.ddDate)
  if (!datePart || !folderMatchesMonthDay(folder.name, datePart)) return 0
  if (folderMatchesExactDate(folder.name, datePart)) return 0

  const folderLabel =
    extractFolderLabel(folder.name)
    || extractFolderDateLabel(folder.name, datePart)
  if (!folderLabel) return 0

  const identityTerms = collectRowIdentityTerms(row).filter(isStrongIdentityTerm)
  const documentTerms = collectFolderDocumentTerms(folder.documents)
  const fundCompanyTerms = extractFundCompanyMatchTerms(row.fundCompany)
  const folderLabelInDocs = documentTerms.some((docTerm) => labelsOverlap(docTerm, folderLabel))

  const identityHit = identityTerms.some(
    (term) => labelsOverlap(folderLabel, term) || brandsRelated(folderLabel, term),
  )
  const fundCompanyHit = fundCompanyMatchesFolderLabel(fundCompanyTerms, folderLabel)
  // When 基金公司 is set, folder label must carry the company — do not accept product-only hits.
  if (fundCompanyTerms.length > 0 && !fundCompanyHit) return 0

  const productBrand = extractProductBrand(row.representativeProduct.trim())
  const productHit =
    fundCompanyTerms.length === 0
    && Boolean(productBrand)
    && (labelsOverlap(folderLabel, productBrand) || row.representativeProduct.trim().includes(folderLabel))
  const docBrandHit =
    fundCompanyTerms.length === 0
    && folderLabelInDocs
    && identityTerms.some((term) => documentTerms.some((docTerm) => labelsOverlap(docTerm, term) || brandsRelated(term, docTerm)))

  if (!identityHit && !fundCompanyHit && !productHit && !docBrandHit) return 0

  let score = fundCompanyHit || productHit || identityHit ? 84 : 78
  if (folder.documents.some((doc) => documentFilenameMatchesRowMonthDay(doc, row.ddDate))) score += 4
  if (folderLabelInDocs) score += 2
  return score
}

function scoreFolderMatch(folderName: string, slug: string, label: string, datePart: string): number {
  const { datePart: folderDate, label: folderLabel } = resolveFolderDateAndLabel(folderName, datePart)
  if (!folderDate) return 0

  const canonical = folderLabel ? `${folderDate}-${folderLabel}` : folderDate
  const normalizedDate = normalizeKbDateParts(datePart)

  if (canonical === slug) return 100
  if (canonical.startsWith(`${slug}-`)) return 90
  if (folderDate === normalizedDate && (labelsOverlap(folderLabel, label) || brandsRelated(label, folderLabel))) return 80
  return 0
}

function rowMentionsEtf(
  row: Pick<DueDiligenceTableRow, "strategyPreliminary" | "strategyLevel1" | "strategyLevel2" | "strategyLevel3">,
): boolean {
  return [row.strategyPreliminary, row.strategyLevel1, row.strategyLevel2, row.strategyLevel3].some((value) =>
    /etf/iu.test(value.trim()),
  )
}

function folderPathMentionsEtf(folderPath: string, folderName: string): boolean {
  return /etf/iu.test(folderPath) || /etf/iu.test(folderName)
}

/** Match nested ETF category folders like `奥创etf/6.22 奥创etf`. */
function scoreEtfCategoryFolderMatch(
  folder: { name: string; relativePath: string; documents: DdMaterialsDocument[] },
  row: Pick<
    DueDiligenceTableRow,
    "ddDate" | "strategyPreliminary" | "strategyLevel1" | "strategyLevel2" | "strategyLevel3"
  >,
): number {
  if (!rowMentionsEtf(row)) return 0
  if (!folderPathMentionsEtf(folder.relativePath, folder.name)) return 0

  const ddDatePart = formatKbFolderDate(row.ddDate)
  if (!ddDatePart || !folderMatchesDate(folder.name, ddDatePart)) return 0

  const { datePart: folderDate } = resolveFolderDateAndLabel(folder.name, row.ddDate)
  if (folderDate !== normalizeKbDateParts(ddDatePart)) return 0

  return 78
}

function isPlausibleDdMaterialsFolderMatch(
  folder: { name: string; relativePath: string; documents: DdMaterialsDocument[] },
  row: Pick<
    DueDiligenceTableRow,
    | "ddDate"
    | "fundCompany"
    | "investmentManager"
    | "representativeProduct"
    | "ddTarget"
    | "strategyPreliminary"
    | "otherInfo"
    | "ddConclusion"
    | "strategyLevel1"
    | "strategyLevel2"
    | "strategyLevel3"
  >,
): boolean {
  if (isLooseFileEntry(folder)) {
    return scoreLooseFileMatch(folder.documents[0], row) >= DD_MATERIALS_MIN_MATCH_SCORE
  }

  const slug = buildExpectedFolderSlug(row)
  const datePart = formatKbFolderDate(row.ddDate)
  const primaryLabels = collectDdMaterialsPrimaryLabels(row)
  if (
    slug
    && datePart
    && primaryLabels.length > 0
    && scoreFolderPrimaryLabelMatches(folder.name, datePart, primaryLabels) >= DD_MATERIALS_MIN_MATCH_SCORE
  ) {
    return true
  }
  if (scoreFolderFundReuseMatch(folder, row) >= DD_MATERIALS_MIN_MATCH_SCORE) return true
  if (scoreFolderMonthDayIdentityMatch(folder, row) >= DD_MATERIALS_MIN_MATCH_SCORE) return true
  return scoreEtfCategoryFolderMatch(folder, row) >= DD_MATERIALS_MIN_MATCH_SCORE
}

export function resolveDdMaterialsFolderPath(
  row: Pick<
    DueDiligenceTableRow,
    | "ddDate"
    | "fundCompany"
    | "investmentManager"
    | "representativeProduct"
    | "ddTarget"
    | "strategyPreliminary"
    | "otherInfo"
    | "ddConclusion"
    | "strategyLevel1"
    | "strategyLevel2"
    | "strategyLevel3"
    | "otherInfo"
    | "ddConclusion"
    | "ddMaterialsKbPath"
    | "ddMaterialsLinkStatus"
  >,
  index: DdMaterialsFolderIndex,
): string | null {
  if (isDdMaterialsAutoLinkDisabled(row)) {
    const explicit = row.ddMaterialsKbPath?.trim()
    return explicit && index.folders.has(explicit) ? explicit : null
  }

  const explicit = row.ddMaterialsKbPath?.trim()
  if (explicit && isDdMaterialsLinkLocked(row)) {
    return explicit
  }

  if (!shouldAutoLinkDdMaterials(row)) {
    return explicit && index.folders.has(explicit) ? explicit : null
  }

  const slug = buildExpectedFolderSlug(row)
  const datePart = formatKbFolderDate(row.ddDate)
  const primaryLabels = collectDdMaterialsPrimaryLabels(row)
  const secondaryLabels = collectSecondaryMatchLabels(row)

  if (explicit) {
    if (index.folders.has(explicit)) {
      const folder = index.folders.get(explicit)!
      if (isPlausibleDdMaterialsFolderMatch(folder, row)) return explicit
      if (
        datePart
        && scoreFolderAlternateMatch(folder.name, datePart, secondaryLabels) >= DD_MATERIALS_MIN_MATCH_SCORE
      ) {
        return explicit
      }
    }
  }

  if (!datePart) return null

  let bestPath: string | null = null
  let bestScore = 0

  if (datePart && primaryLabels.length > 0) {
    for (const [path, folder] of index.folders) {
      if (isLooseFileEntry(folder)) continue
      const score = scoreFolderPrimaryLabelMatches(folder.name, datePart, primaryLabels)
      if (score > bestScore) {
        bestScore = score
        bestPath = path
      }
    }
  }

  if (bestScore >= DD_MATERIALS_MIN_MATCH_SCORE) return bestPath

  bestPath = null
  bestScore = 0
  for (const [path, folder] of index.folders) {
    if (isLooseFileEntry(folder)) continue
    const score = scoreFolderMonthDayIdentityMatch(folder, row)
    if (score > bestScore) {
      bestScore = score
      bestPath = path
    }
  }

  if (bestScore >= DD_MATERIALS_MIN_MATCH_SCORE) return bestPath

  bestPath = null
  bestScore = 0
  for (const [path, folder] of index.folders) {
    if (isLooseFileEntry(folder)) continue
    const score = scoreFolderFundReuseMatch(folder, row)
    if (score > bestScore) {
      bestScore = score
      bestPath = path
    }
  }

  if (bestScore >= DD_MATERIALS_MIN_MATCH_SCORE) return bestPath

  bestPath = null
  bestScore = 0
  for (const [path, folder] of index.folders) {
    if (isLooseFileEntry(folder)) continue
    const score = scoreEtfCategoryFolderMatch(folder, row)
    if (score > bestScore) {
      bestScore = score
      bestPath = path
    }
  }

  if (bestScore >= DD_MATERIALS_MIN_MATCH_SCORE) return bestPath

  if (secondaryLabels.length === 0) {
    bestPath = null
    bestScore = 0
    for (const [path, folder] of index.folders) {
      if (!isLooseFileEntry(folder)) continue
      const score = scoreLooseFileMatch(folder.documents[0], row)
      if (score > bestScore) {
        bestScore = score
        bestPath = path
      }
    }
    return bestScore >= DD_MATERIALS_MIN_MATCH_SCORE ? bestPath : null
  }

  bestPath = null
  bestScore = 0
  for (const [path, folder] of index.folders) {
    if (isLooseFileEntry(folder)) continue
    const score = scoreFolderAlternateMatch(folder.name, datePart, secondaryLabels)
    if (score > bestScore) {
      bestScore = score
      bestPath = path
    }
  }

  if (bestScore >= DD_MATERIALS_MIN_MATCH_SCORE) return bestPath

  bestPath = null
  bestScore = 0
  for (const [path, folder] of index.folders) {
    if (!isLooseFileEntry(folder)) continue
    const score = scoreLooseFileMatch(folder.documents[0], row)
    if (score > bestScore) {
      bestScore = score
      bestPath = path
    }
  }

  return bestScore >= DD_MATERIALS_MIN_MATCH_SCORE ? bestPath : null
}

export function getDdMaterialsDocuments(
  folderPath: string | null,
  index: DdMaterialsFolderIndex,
): DdMaterialsDocument[] {
  if (!folderPath) return []
  const direct = index.folders.get(folderPath)
  if (direct) return direct.documents

  for (const folder of index.folders.values()) {
    const match = folder.documents.find((doc) => doc.relativePath === folderPath)
    if (match) return [match]
  }
  return []
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
  row: Pick<DueDiligenceTableRow, "fundCompany" | "investmentManager" | "representativeProduct">,
  folderLabel = "",
): string[] {
  const terms = new Set<string>()

  const add = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    terms.add(trimmed)
    const normalized = normalizeLabel(trimmed)
    if (normalized.length >= 2) {
      terms.add(normalized)
      if (normalized.length > 2) terms.add(normalized.slice(0, 2))
    }
  }

  add(row.fundCompany)
  const manager = row.investmentManager.trim().split(/[、,，/]/u)[0]?.trim() ?? ""
  add(manager)
  add(row.representativeProduct)

  const label = extractDdMaterialsLabel(row)
  if (label) terms.add(label)
  if (folderLabel) add(folderLabel)

  return [...terms].filter((term) => term.length >= 2)
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

function isLooseFileEntry(folder: { relativePath: string; documents: DdMaterialsDocument[] }): boolean {
  if (folder.documents.length !== 1) return false
  return /\.[a-z0-9]{2,5}$/i.test(folder.relativePath)
}

/** Match a single file sitting directly under `内部尽调资料`. */
function scoreLooseFileMatch(
  doc: DdMaterialsDocument,
  row: Pick<
    DueDiligenceTableRow,
    | "fundCompany"
    | "investmentManager"
    | "representativeProduct"
    | "ddTarget"
    | "strategyPreliminary"
    | "otherInfo"
    | "ddConclusion"
    | "strategyLevel1"
    | "strategyLevel2"
    | "strategyLevel3"
  >,
): number {
  if (isEventStyleFundCompany(row.fundCompany) && extractFundCompanyMatchTerms(row.fundCompany).length === 0) return 0

  const filename = doc.name.replace(/\.[^.]+$/u, "")
  const fundCompanyTerms = extractFundCompanyMatchTerms(row.fundCompany)
  if (fundCompanyTerms.length > 0) {
    const companyInFilename = fundCompanyTerms.some(
      (term) => filename.includes(term) || labelsOverlap(filename, term) || brandsRelated(term, filename),
    )
    if (!companyInFilename) return 0
  }

  const identityTerms = collectRowIdentityTerms(row).filter(isStrongIdentityTerm)
  const strategies = getRowStrategyPrefixes(row)

  let score = 0
  for (const term of identityTerms) {
    if (filename.startsWith(term)) score = Math.max(score, 92)
    else if (filename.includes(term)) score = Math.max(score, 86)
    else if (labelsOverlap(filename, term)) score = Math.max(score, 80)
  }

  if (score === 0) return 0

  for (const strategy of strategies) {
    if (strategy.length >= 2 && filename.includes(strategy)) score += 2
  }

  if (/T0/i.test(filename) && strategies.some((strategy) => /T0/i.test(strategy))) {
    score += 3
  }

  return score >= DD_MATERIALS_MIN_MATCH_SCORE ? score : 0
}

/** Drop files in a shared folder that clearly belong to another manager/company. */
export function filterDdMaterialsDocumentsForRow(
  row: Pick<DueDiligenceTableRow, "fundCompany" | "investmentManager" | "representativeProduct">,
  documents: DdMaterialsDocument[],
  folderLabel = "",
): DdMaterialsDocument[] {
  const matchTerms = collectRowDocumentMatchTerms(row, folderLabel)
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
    | "ddDate"
    | "fundCompany"
    | "investmentManager"
    | "representativeProduct"
    | "ddTarget"
    | "strategyPreliminary"
    | "otherInfo"
    | "ddConclusion"
    | "strategyLevel1"
    | "strategyLevel2"
    | "strategyLevel3"
    | "otherInfo"
    | "ddConclusion"
    | "ddMaterialsKbPath"
    | "ddMaterialsLinkStatus"
    | "ddMaterialsFileLinks"
  >,
  index: DdMaterialsFolderIndex,
): DdMaterialsDocument[] {
  const folderPath = resolveDdMaterialsFolderPath(row, index)
  const allDocuments = getDdMaterialsDocuments(folderPath, index)
  if (!folderPath || allDocuments.length === 0) return allDocuments

  const folderEntry = index.folders.get(folderPath)
  if (folderEntry && isLooseFileEntry(folderEntry)) {
    return applyDdMaterialsFileLinkFilters(allDocuments, allDocuments, row.ddMaterialsFileLinks)
  }

  let autoDocuments = allDocuments
  if (!isDdMaterialsLinkLocked(row)) {
    const folderName = folderEntry?.name ?? ""
    const folderLabel = extractFolderLabel(folderName)
    const fundHint =
      extractFundNameFromStrategyFolderLabel(folderLabel, getRowStrategyPrefixes(row))
      ?? (folderLabel.length >= 2 ? folderLabel : "")
    autoDocuments = filterDdMaterialsDocumentsForRow(row, allDocuments, fundHint)
  }

  return applyDdMaterialsFileLinkFilters(allDocuments, autoDocuments, row.ddMaterialsFileLinks)
}

export function rowHasDdMaterials(
  row: Pick<DueDiligenceTableRow, "ddMaterials">,
  folderPath: string | null,
  index: DdMaterialsFolderIndex,
): boolean {
  if (!folderPath) return false
  return getDdMaterialsDocuments(folderPath, index).length > 0
}

/** UI label for 尽调材料; never show orphan 「已上传」 without a real KB link. */
export function resolveDdMaterialsDisplayLabel(
  row: Pick<DueDiligenceTableRow, "ddMaterials">,
  folderPath: string | null,
  documentCount: number,
  materialsLoading: boolean,
  linkLocked = false,
): string {
  if (materialsLoading) return "…"
  if (documentCount > 0) return `已上传 (${documentCount})`
  if (folderPath && linkLocked) return "已上传"
  if (row.ddMaterials.trim() === "已上传") return ""
  return row.ddMaterials
}

export function buildDdMaterialsRowPresentation(
  row: Pick<
    DueDiligenceTableRow,
    | "ddDate"
    | "fundCompany"
    | "investmentManager"
    | "representativeProduct"
    | "ddTarget"
    | "strategyPreliminary"
    | "otherInfo"
    | "ddConclusion"
    | "strategyLevel1"
    | "strategyLevel2"
    | "strategyLevel3"
    | "ddMaterialsKbPath"
    | "ddMaterialsLinkStatus"
    | "ddMaterialsFileLinks"
  >,
  index: DdMaterialsFolderIndex,
): { folderPath: string | null; folderName: string | null; documents: DdMaterialsDocument[] } {
  const resolvedPath = resolveDdMaterialsFolderPath(row, index)
  const documents = getDdMaterialsDocumentsForRow(row, index)
  const linkLocked = isDdMaterialsLinkLocked(row)
  const folderPath = documents.length > 0 || (linkLocked && resolvedPath) ? resolvedPath : null
  const folderName = folderPath
    ? index.folders.get(folderPath)?.name ?? folderPath.split("/").pop() ?? null
    : null
  return { folderPath, folderName, documents }
}

export function buildDdMaterialsAutoFillPatch(
  row: DueDiligenceTableRow,
  index: DdMaterialsFolderIndex,
): Partial<DueDiligenceTableRow> | null {
  const storedPath = row.ddMaterialsKbPath?.trim() || null
  const storedDocuments = storedPath ? getDdMaterialsDocuments(storedPath, index) : []

  if (isDdMaterialsAutoLinkDisabled(row)) {
    const hasStoredLink = Boolean(storedPath) && storedDocuments.length > 0
    if (!hasStoredLink && (storedPath || row.ddMaterials.trim() === "已上传")) {
      return { ddMaterials: "", ddMaterialsKbPath: null }
    }
    return null
  }

  if (isDdMaterialsLinkLocked(row)) {
    if (!storedPath) {
      if (row.ddMaterials.trim() === "已上传" || row.ddMaterialsLinkStatus) {
        return { ddMaterials: "", ddMaterialsKbPath: null, ddMaterialsLinkStatus: null }
      }
      return null
    }
    if (!index.folders.has(storedPath)) {
      if (row.ddMaterials.trim() === "已上传" || row.ddMaterialsLinkStatus) {
        return { ddMaterials: "", ddMaterialsKbPath: null, ddMaterialsLinkStatus: null }
      }
      return null
    }
    if (row.ddMaterials.trim() !== "已上传") {
      return { ddMaterials: "已上传" }
    }
    return null
  }

  if (!shouldAutoLinkDdMaterials(row)) {
    if (storedPath || row.ddMaterials.trim() === "已上传") {
      return { ddMaterials: "", ddMaterialsKbPath: null, ddMaterialsLinkStatus: null }
    }
    return null
  }

  const folderPath = resolveDdMaterialsFolderPath(row, index)
  if (!folderPath) {
    if (storedPath || row.ddMaterials.trim() === "已上传") {
      return { ddMaterials: "", ddMaterialsKbPath: null, ddMaterialsLinkStatus: null }
    }
    return null
  }

  const visibleDocuments = getDdMaterialsDocumentsForRow({ ...row, ddMaterialsKbPath: folderPath }, index)
  if (visibleDocuments.length === 0) {
    if (storedPath || row.ddMaterials.trim() === "已上传") {
      return { ddMaterials: "", ddMaterialsKbPath: null, ddMaterialsLinkStatus: null }
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
