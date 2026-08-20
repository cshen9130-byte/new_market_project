/** Max stored note HTML length (includes markup, not just visible text). */
export const MAX_INVESTMENT_NOTE_CONTENT_CHARS = 10_000_000
export const MAX_INVESTMENT_NOTE_TITLE_CHARS = 200

/** Single-file cap for 投资笔记「上传资料」. */
export const INVESTMENT_NOTE_MATERIAL_MAX_MB = 150
export const INVESTMENT_NOTE_MATERIAL_MAX_BYTES =
  INVESTMENT_NOTE_MATERIAL_MAX_MB * 1024 * 1024
/** Split large PPT/Office files so each request stays under Next.js/nginx body limits. */
const MATERIAL_CHUNK_THRESHOLD_BYTES = 4 * 1024 * 1024
const MATERIAL_CHUNK_SIZE_BYTES = 4 * 1024 * 1024

/**
 * Shrink pasted rich HTML (e.g. WeChat articles / Word) by dropping scripts,
 * classes, data-* attrs, and bulky inline styles while keeping structure,
 * tables, and text. Table chrome is restored via `.investment-note-rich` CSS.
 */
export function compactRichNoteHtml(html: string): string {
  if (!html || !/<[a-z][\s\S]*>/i.test(html)) return html

  let out = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?(?:meta|link|xml|o:p|w:[a-z]+)[^>]*>/gi, "")
    .replace(/\s(?:class|id|data-[\w:-]+)=("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\sstyle=("[^"]*"|'[^']*')/gi, "")
    // Word often emits border=0 and relies on CSS borders we just stripped.
    .replace(/\sborder=("0"|'0'|0)/gi, "")
    .replace(/<(span|font)(\s[^>]*)?>/gi, "")
    .replace(/<\/(span|font)>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")

  return out.trim()
}

export type InvestmentNoteAttachment = {
  id: string
  name: string
  size: number
}

export type InvestmentNoteAssociation = {
  category: string
  name: string
  recordNo: string
}

export const ASSOCIATION_CATEGORIES = [
  "私募基金",
  "公募基金",
  "团队自建",
  "私募管理人",
  "公募基金公司",
] as const

export type AssociationCategory = (typeof ASSOCIATION_CATEGORIES)[number]

export const ASSOCIATION_CATEGORY_SHORT: Record<string, string> = {
  私募基金: "私募",
  公募基金: "公募",
  团队自建: "自建",
  私募管理人: "管理人",
  公募基金公司: "基金公司",
}

export function associationDisplayLabel(item: InvestmentNoteAssociation): string {
  // 私募 is the default product type on this page; skip the redundant suffix.
  if (item.category === "私募基金") return item.name
  const short = ASSOCIATION_CATEGORY_SHORT[item.category] ?? item.category
  return `${item.name}(${short})`
}

export function associationKey(item: InvestmentNoteAssociation): string {
  return `${item.category}::${item.recordNo || item.name}`
}

/** Link from an investment note to a 尽调表格 row (treated as a roadshow record). */
export type InvestmentNoteRoadshowAssociation = {
  rowId: string
  label: string
  ddDate?: string
  fundCompany?: string
  ddTarget?: string
  representativeProduct?: string
}

export function roadshowAssociationKey(item: InvestmentNoteRoadshowAssociation): string {
  return item.rowId
}

export function roadshowAssociationDisplayLabel(item: InvestmentNoteRoadshowAssociation): string {
  return item.label?.trim() || item.representativeProduct || item.fundCompany || item.ddTarget || item.rowId
}

export function buildRoadshowAssociationFromDdRow(row: {
  id: string
  ddDate?: string
  fundCompany?: string
  ddTarget?: string
  representativeProduct?: string
}): InvestmentNoteRoadshowAssociation {
  const ddDate = (row.ddDate ?? "").trim()
  const fundCompany = (row.fundCompany ?? "").trim()
  const ddTarget = (row.ddTarget ?? "").trim()
  const representativeProduct = (row.representativeProduct ?? "").trim()
  const companyOrTarget = fundCompany || ddTarget
  const label = [ddDate, companyOrTarget, representativeProduct].filter(Boolean).join(" ")
  return {
    rowId: row.id,
    label: label || row.id,
    ...(ddDate ? { ddDate } : {}),
    ...(fundCompany ? { fundCompany } : {}),
    ...(ddTarget ? { ddTarget } : {}),
    ...(representativeProduct ? { representativeProduct } : {}),
  }
}

function escapeNoteHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function noteHtmlLine(text: string): string {
  if (!text) return "<div><br></div>"
  return text
    .split(/\r?\n/)
    .map((line) => `<div>${line ? escapeNoteHtml(line) : "<br>"}</div>`)
    .join("")
}

function noteHtmlField(label: string, value?: string | null): string | null {
  const trimmed = (value ?? "").trim()
  if (!trimmed) return null
  const [first, ...rest] = trimmed.split(/\r?\n/)
  const head = noteHtmlLine(`${label}：${first ?? ""}`)
  if (rest.length === 0) return head
  return head + rest.map((line) => noteHtmlLine(line)).join("")
}

export type RoadshowNoteSourceRow = {
  id: string
  ddPersonnel?: string
  ddDate?: string
  ddTime?: string
  ddMethod?: string
  ddTarget?: string
  recommender?: string
  strategyPreliminary?: string
  fundCompany?: string
  investmentManager?: string
  representativeProduct?: string
  representativeProductBeianHao?: string
  strategyLevel1?: string
  strategyLevel2?: string
  strategyLevel3?: string
  inTrackingPool?: string
  suggestedTracking?: string
  ddConclusion?: string
}

/** Default title for a note created from a 尽调表格 roadshow row. */
export function buildInvestmentNoteTitleFromDdRow(row: RoadshowNoteSourceRow): string {
  const assoc = buildRoadshowAssociationFromDdRow(row)
  if (assoc.label && assoc.label !== row.id) return assoc.label
  const primary =
    (row.fundCompany ?? "").trim() ||
    (row.ddTarget ?? "").trim() ||
    (row.representativeProduct ?? "").trim()
  return primary ? `${primary} 路演笔记` : "路演笔记"
}

/** Rich HTML body seeded from roadshow basic fields. */
export function buildInvestmentNoteContentFromDdRow(row: RoadshowNoteSourceRow): string {
  const strategy = [row.strategyLevel1, row.strategyLevel2, row.strategyLevel3]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join(" / ")
  const datetime = [(row.ddDate ?? "").trim(), (row.ddTime ?? "").trim()].filter(Boolean).join(" ")

  const lines = [
    "<div><b>路演基本信息</b></div>",
    noteHtmlField("尽调日期", datetime),
    noteHtmlField("尽调形式", row.ddMethod),
    noteHtmlField("尽调人员", row.ddPersonnel),
    noteHtmlField("尽调对象", row.ddTarget),
    noteHtmlField("基金公司", row.fundCompany),
    noteHtmlField("投资经理", row.investmentManager),
    noteHtmlField("代表产品", row.representativeProduct),
    noteHtmlField("备案编码", row.representativeProductBeianHao),
    noteHtmlField("推荐人", row.recommender),
    noteHtmlField("策略初筛", row.strategyPreliminary),
    noteHtmlField("策略", strategy),
    noteHtmlField("已加入跟踪池", row.inTrackingPool),
    noteHtmlField("建议跟踪", row.suggestedTracking),
    noteHtmlField("尽调结论", row.ddConclusion),
    noteHtmlLine(""),
    "<div><b>笔记内容</b></div>",
    noteHtmlLine(""),
  ].filter((line): line is string => Boolean(line))

  return lines.join("")
}

export function buildProductAssociationFromDdRow(
  row: RoadshowNoteSourceRow,
): InvestmentNoteAssociation | null {
  const beian = (row.representativeProductBeianHao ?? "").trim()
  const name = (row.representativeProduct ?? "").trim()
  if (!beian && !name) return null
  return {
    category: "私募基金",
    name: name || beian,
    recordNo: beian,
  }
}

/** Create a team investment note linked to a roadshow, with basic fields imported. */
export async function createInvestmentNoteFromRoadshow(
  row: RoadshowNoteSourceRow,
): Promise<LinkedInvestmentNoteRef> {
  const title = buildInvestmentNoteTitleFromDdRow(row)
  const content = buildInvestmentNoteContentFromDdRow(row)
  const product = buildProductAssociationFromDdRow(row)
  const note = await createInvestmentNote({
    title,
    content,
    teamShared: true,
    roadshowAssociations: [buildRoadshowAssociationFromDdRow(row)],
    associations: product ? [product] : [],
  })
  return {
    id: note.id,
    title: note.title || title,
    scope: "team",
  }
}

export type InvestmentNoteContentVariant = "analysis" | "memo" | "plain"

export type InvestmentNote = {
  id: string
  title: string
  content: string
  preview: string
  contentVariant: InvestmentNoteContentVariant
  teamShared: boolean
  /** Relative path under AI 知识库 when mirrored to「投资笔记」. */
  kbRelativePath?: string | null
  tags: string[]
  associations: InvestmentNoteAssociation[]
  /** Linked 尽调表格 rows (路演). */
  roadshowAssociations: InvestmentNoteRoadshowAssociation[]
  attachments: InvestmentNoteAttachment[]
  creator: string
  lastModifiedBy: string
  modifiedDate: string
  createdDate: string
  /** List payloads omit HTML; fetch the note by id before editing or merging. */
  contentPending?: boolean
  /** True when stored body is non-empty (even if `content` was omitted). */
  hasBody?: boolean
}

export const INVESTMENT_NOTE_INTEGRATION_TITLE_MARK = "路演整合"

export function isIntegratedInvestmentNote(note: Pick<InvestmentNote, "title" | "tags">): boolean {
  const title = (note.title ?? "").trim()
  if (title.includes(INVESTMENT_NOTE_INTEGRATION_TITLE_MARK) || title.endsWith("整合笔记")) return true
  return (note.tags ?? []).includes("整合")
}

export function isEmptyDraftInvestmentNote(
  note: Pick<InvestmentNote, "title" | "content"> & Pick<InvestmentNote, "contentPending" | "hasBody">,
): boolean {
  const title = (note.title ?? "").trim()
  if (title && title !== "无标题") return false
  if (note.contentPending) return !note.hasBody
  return !(note.content ?? "").trim()
}

/** Flattened text used by the notes list search (title, body, products, roadshows). */
export function investmentNoteSearchText(note: InvestmentNote): string {
  const associations = (note.associations ?? []).flatMap((item) => [
    item.name,
    item.category,
    item.recordNo,
    associationDisplayLabel(item),
  ])
  const roadshows = (note.roadshowAssociations ?? []).flatMap((item) => [
    item.label,
    item.fundCompany,
    item.ddTarget,
    item.representativeProduct,
    item.ddDate,
  ])
  const strippedContent = note.contentPending
    ? ""
    : (note.content ?? "").replace(/<[^>]+>/g, " ")
  return [
    note.title,
    note.preview,
    strippedContent,
    note.creator,
    ...(note.tags ?? []),
    ...associations,
    ...roadshows,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function noteMatchesKeyword(note: InvestmentNote, keyword: string): boolean {
  const q = keyword.trim().toLowerCase()
  if (!q) return true
  return investmentNoteSearchText(note).includes(q)
}

/** Source notes to merge: skip empty drafts and previous integration notes, oldest first. */
export function selectNotesForIntegration(notes: InvestmentNote[]): InvestmentNote[] {
  return notes
    .filter((note) => !isEmptyDraftInvestmentNote(note) && !isIntegratedInvestmentNote(note))
    .slice()
    .sort((a, b) => {
      const byDate = (a.createdDate || a.modifiedDate || "").localeCompare(b.createdDate || b.modifiedDate || "")
      if (byDate !== 0) return byDate
      return (a.title || "").localeCompare(b.title || "", "zh")
    })
}

function noteBodyHtml(content: string): string {
  const trimmed = (content ?? "").trim()
  if (!trimmed) return noteHtmlLine("（无内容）")
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return trimmed
  return noteHtmlLine(trimmed)
}

export type IntegratedInvestmentNoteDraft = Pick<
  InvestmentNote,
  "title" | "content" | "associations" | "roadshowAssociations"
>

/** Build a new note body that concatenates source notes in chronological order. */
export function buildIntegratedInvestmentNoteDraft(
  notes: InvestmentNote[],
  keyword: string,
): IntegratedInvestmentNoteDraft {
  const sources = selectNotesForIntegration(notes)
  const q = keyword.trim()
  const titleBase = q || (sources[0]?.title ?? "").trim() || "路演"
  const title = `${titleBase} ${INVESTMENT_NOTE_INTEGRATION_TITLE_MARK}`.slice(0, MAX_INVESTMENT_NOTE_TITLE_CHARS)

  const intro = [
    "<div><b>整合说明</b></div>",
    noteHtmlLine(
      `本笔记由${q ? `搜索「${q}」得到的 ` : ""}${sources.length} 条路演笔记按时间顺序整合，原文笔记仍保留。`,
    ),
    noteHtmlLine(""),
  ]

  const sections = sources.flatMap((note, index) => {
    const headingParts = [
      note.createdDate?.trim(),
      (note.title ?? "").trim() || "无标题",
    ].filter(Boolean)
    const meta = [
      note.creator?.trim() ? `作者：${note.creator.trim()}` : "",
      note.modifiedDate?.trim() && note.modifiedDate !== note.createdDate
        ? `更新：${note.modifiedDate.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join("  ")
    return [
      `<div><b>${index + 1}. ${escapeNoteHtml(headingParts.join(" · "))}</b></div>`,
      meta ? noteHtmlLine(meta) : null,
      noteBodyHtml(note.content),
      noteHtmlLine(""),
    ].filter((line): line is string => Boolean(line))
  })

  const associations: InvestmentNoteAssociation[] = []
  const seenAssociations = new Set<string>()
  for (const note of sources) {
    for (const item of note.associations ?? []) {
      const key = associationKey(item)
      if (seenAssociations.has(key)) continue
      seenAssociations.add(key)
      associations.push(item)
    }
  }

  const roadshowAssociations: InvestmentNoteRoadshowAssociation[] = []
  const seenRoadshows = new Set<string>()
  for (const note of sources) {
    for (const item of note.roadshowAssociations ?? []) {
      const key = roadshowAssociationKey(item)
      if (!key || seenRoadshows.has(key)) continue
      seenRoadshows.add(key)
      roadshowAssociations.push(item)
    }
  }

  return {
    title,
    content: compactRichNoteHtml([...intro, ...sections].join("")),
    associations,
    roadshowAssociations,
  }
}

function currentUserId(): string {
  if (typeof window === "undefined") return ""
  try {
    const raw = localStorage.getItem("currentUser")
    if (!raw) return ""
    const user = JSON.parse(raw) as { id?: string }
    return user.id?.trim() || ""
  } catch {
    return ""
  }
}

function authHeaders(): HeadersInit {
  const uid = currentUserId()
  return uid ? { "x-market-user-id": uid } : {}
}

async function apiFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || res.statusText || "请求失败")
  }
  return data as T
}

type NotesScope = "team" | "mine"

const NOTES_SESSION_PREFIX = "investment-notes-list:v1:"
const listMemCache = new Map<NotesScope, InvestmentNote[]>()
const fullNoteCache = new Map<string, InvestmentNote>()

function rememberFullNote(note: InvestmentNote) {
  if (note.contentPending) return
  fullNoteCache.set(note.id, note)
}

function mergeListedNotes(listed: InvestmentNote[]): InvestmentNote[] {
  return listed.map((note) => {
    if (!note.contentPending) {
      rememberFullNote(note)
      return note
    }
    const cached = fullNoteCache.get(note.id)
    if (!cached || cached.contentPending) return note
    return { ...note, ...cached, contentPending: false }
  })
}

function persistNotesList(scope: NotesScope, notes: InvestmentNote[]) {
  listMemCache.set(scope, notes)
  if (typeof window === "undefined") return
  try {
    const lite = notes.map((note) =>
      note.contentPending
        ? note
        : {
            ...note,
            content: "",
            contentPending: true,
            hasBody: note.hasBody ?? Boolean(note.content.trim()),
          },
    )
    sessionStorage.setItem(`${NOTES_SESSION_PREFIX}${scope}`, JSON.stringify(lite))
  } catch {
    // quota / private mode
  }
}

export function peekInvestmentNotesCache(scope: NotesScope): InvestmentNote[] | null {
  const mem = listMemCache.get(scope)
  if (mem) return mem
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(`${NOTES_SESSION_PREFIX}${scope}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const notes = mergeListedNotes(parsed as InvestmentNote[])
    listMemCache.set(scope, notes)
    return notes
  } catch {
    return null
  }
}

export function invalidateInvestmentNotesCache(id?: string) {
  if (id) fullNoteCache.delete(id)
  else fullNoteCache.clear()
  listMemCache.clear()
  try {
    sessionStorage.removeItem(`${NOTES_SESSION_PREFIX}team`)
    sessionStorage.removeItem(`${NOTES_SESSION_PREFIX}mine`)
  } catch {
    // ignore
  }
}

export async function listInvestmentNotes(
  scope: NotesScope,
  options?: { hydrateId?: string },
): Promise<InvestmentNote[]> {
  const params = new URLSearchParams({ scope })
  if (options?.hydrateId) params.set("hydrateId", options.hydrateId)
  const data = await apiFetch<{ ok: true; notes: InvestmentNote[] }>(
    `/ma/api/investment-notes?${params}`,
  )
  const notes = mergeListedNotes(data.notes)
  persistNotesList(scope, notes)
  return notes
}

export async function getInvestmentNote(id: string): Promise<InvestmentNote | null> {
  const safeId = String(id || "").trim()
  if (!safeId) return null
  const cached = fullNoteCache.get(safeId)
  if (cached && !cached.contentPending) return cached
  try {
    const data = await apiFetch<{ ok: true; note: InvestmentNote }>(
      `/ma/api/investment-notes?id=${encodeURIComponent(safeId)}`,
    )
    const note = { ...data.note, contentPending: false, hasBody: Boolean(data.note.content?.trim()) }
    rememberFullNote(note)
    return note
  } catch {
    return null
  }
}

export async function createInvestmentNote(
  partial?: Partial<
    Pick<InvestmentNote, "title" | "content" | "teamShared" | "associations" | "roadshowAssociations">
  >,
): Promise<InvestmentNote> {
  const data = await apiFetch<{ ok: true; note: InvestmentNote }>("/ma/api/investment-notes", {
    method: "POST",
    body: JSON.stringify(partial ?? {}),
  })
  invalidateInvestmentNotesCache()
  const note = { ...data.note, contentPending: false, hasBody: Boolean(data.note.content?.trim()) }
  rememberFullNote(note)
  return note
}

export async function updateInvestmentNote(
  id: string,
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
      | "lastModifiedBy"
      | "modifiedDate"
    >
  >,
): Promise<InvestmentNote | null> {
  const data = await apiFetch<{ ok: true; note: InvestmentNote }>("/ma/api/investment-notes", {
    method: "PUT",
    body: JSON.stringify({ id, ...patch }),
  })
  invalidateInvestmentNotesCache(id)
  if (!data.note) return null
  const note = { ...data.note, contentPending: false, hasBody: Boolean(data.note.content?.trim()) }
  rememberFullNote(note)
  return note
}

export async function deleteInvestmentNote(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/ma/api/investment-notes?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  invalidateInvestmentNotesCache(id)
}

export async function setInvestmentNoteTeamShared(
  id: string,
  teamShared: boolean,
): Promise<InvestmentNote | null> {
  return updateInvestmentNote(id, { teamShared })
}

export async function setInvestmentNoteTags(id: string, tags: string[]): Promise<InvestmentNote | null> {
  return updateInvestmentNote(id, { tags })
}

export async function setInvestmentNoteAssociations(
  id: string,
  associations: InvestmentNoteAssociation[],
): Promise<InvestmentNote | null> {
  return updateInvestmentNote(id, { associations })
}

export async function setInvestmentNoteRoadshowAssociations(
  id: string,
  roadshowAssociations: InvestmentNoteRoadshowAssociation[],
): Promise<InvestmentNote | null> {
  return updateInvestmentNote(id, { roadshowAssociations })
}

/** Linked investment note for a 尽调表格 / roadshow row. */
export type LinkedInvestmentNoteRef = {
  id: string
  title: string
  scope: "team" | "mine"
}

/** Build rowId → note map (team notes win over mine when both link the same row). */
export function buildRoadshowLinkedNoteMap(
  teamNotes: InvestmentNote[],
  mineNotes: InvestmentNote[],
): Record<string, LinkedInvestmentNoteRef> {
  const map: Record<string, LinkedInvestmentNoteRef> = {}
  for (const note of mineNotes) {
    for (const assoc of note.roadshowAssociations ?? []) {
      const rowId = assoc.rowId?.trim()
      if (!rowId || map[rowId]) continue
      map[rowId] = { id: note.id, title: note.title, scope: "mine" }
    }
  }
  for (const note of teamNotes) {
    for (const assoc of note.roadshowAssociations ?? []) {
      const rowId = assoc.rowId?.trim()
      if (!rowId) continue
      map[rowId] = { id: note.id, title: note.title, scope: "team" }
    }
  }
  return map
}

export function investmentNoteDeepLink(note: LinkedInvestmentNoteRef): string {
  const params = new URLSearchParams({
    tab: "investment",
    side: "inv-dd-notes",
    noteId: note.id,
    notesScope: note.scope,
  })
  return `/ma/dashboard/private-funds?${params.toString()}`
}

/** True when the note associates to this private-fund product (by beian_hao). */
export function noteAssociatesToProduct(
  note: Pick<InvestmentNote, "associations">,
  beianHao: string,
  productName?: string,
): boolean {
  const beian = beianHao.trim()
  const name = (productName ?? "").trim()
  if (!beian && !name) return false
  return (note.associations ?? []).some((item) => {
    if (item.category !== "私募基金") return false
    const recordNo = (item.recordNo || "").trim()
    if (beian && recordNo === beian) return true
    if (!recordNo && name && (item.name || "").trim() === name) return true
    return false
  })
}

export type ProductLinkedInvestmentNote = InvestmentNote & {
  scope: "team" | "mine"
}

/** Filter notes linked to a product; team scope wins when the same id appears in both. */
export function filterInvestmentNotesLinkedToProduct(
  teamNotes: InvestmentNote[],
  mineNotes: InvestmentNote[],
  beianHao: string,
  productName?: string,
): ProductLinkedInvestmentNote[] {
  const byId = new Map<string, ProductLinkedInvestmentNote>()
  for (const note of mineNotes) {
    if (!noteAssociatesToProduct(note, beianHao, productName)) continue
    byId.set(note.id, { ...note, scope: "mine" })
  }
  for (const note of teamNotes) {
    if (!noteAssociatesToProduct(note, beianHao, productName)) continue
    byId.set(note.id, { ...note, scope: "team" })
  }
  return Array.from(byId.values()).sort((a, b) =>
    (b.modifiedDate || b.createdDate || "").localeCompare(a.modifiedDate || a.createdDate || ""),
  )
}

/** Load team + mine notes linked to a private-fund product. */
export async function listInvestmentNotesLinkedToProduct(
  beianHao: string,
  productName?: string,
): Promise<ProductLinkedInvestmentNote[]> {
  const [teamNotes, mineNotes] = await Promise.all([
    listInvestmentNotes("team"),
    listInvestmentNotes("mine"),
  ])
  return filterInvestmentNotesLinkedToProduct(teamNotes, mineNotes, beianHao, productName)
}

/** Load team + mine notes and index by linked 尽调表格 row id. */
export async function loadRoadshowLinkedNoteMap(): Promise<Record<string, LinkedInvestmentNoteRef>> {
  const [teamNotes, mineNotes] = await Promise.all([
    listInvestmentNotes("team"),
    listInvestmentNotes("mine"),
  ])
  return buildRoadshowLinkedNoteMap(teamNotes, mineNotes)
}

export type InvestmentNoteProofreadChange = {
  field: string
  from: string
  to: string
}

export type InvestmentNoteProofreadResult = {
  content: string
  changes: InvestmentNoteProofreadChange[]
  roadshowLabel?: string
}

/** AI-proofread note content against linked 尽调表格 roadshow rows. */
export async function proofreadInvestmentNoteWithRoadshow(input: {
  content: string
  rowIds: string[]
}): Promise<InvestmentNoteProofreadResult> {
  const data = await apiFetch<{
    ok: true
    content: string
    changes?: InvestmentNoteProofreadChange[]
    roadshowLabel?: string
  }>("/ma/api/investment-notes/proofread", {
    method: "POST",
    body: JSON.stringify({
      content: input.content,
      rowIds: input.rowIds,
    }),
  })
  return {
    content: data.content,
    changes: Array.isArray(data.changes) ? data.changes : [],
    roadshowLabel: data.roadshowLabel,
  }
}

export type InvestmentNoteMaterial = {
  id: string
  name: string
  size: number
  mimeType: string
  noteId: string | null
  noteTitle: string | null
  uploadedBy: string
  uploadedByName: string
  createdAt: string
}

export async function listInvestmentNoteMaterials(): Promise<InvestmentNoteMaterial[]> {
  const data = await apiFetch<{ ok: true; materials: InvestmentNoteMaterial[] }>(
    "/ma/api/investment-notes/materials",
  )
  return data.materials
}

export type InvestmentNoteMaterialUploadResult = {
  material: InvestmentNoteMaterial
  extractJob?: unknown | null
  extractSkipReason?: string | null
}

async function postMaterialForm(form: FormData): Promise<Record<string, any>> {
  const res = await fetch("/ma/api/investment-notes/materials", {
    method: "POST",
    headers: {
      ...authHeaders(),
    },
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 413) {
    throw new Error(`上传被网关拦截（413），请稍后重试或联系管理员检查 nginx 请求体限制`)
  }
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || res.statusText || "上传失败")
  }
  return data
}

export async function uploadInvestmentNoteMaterial(
  file: File,
  noteId?: string | null,
): Promise<InvestmentNoteMaterialUploadResult> {
  if (file.size > INVESTMENT_NOTE_MATERIAL_MAX_BYTES) {
    throw new Error(`文件大小不能超过 ${INVESTMENT_NOTE_MATERIAL_MAX_MB}MB`)
  }

  const data =
    file.size > MATERIAL_CHUNK_THRESHOLD_BYTES
      ? await uploadMaterialInChunks(file, noteId)
      : await postMaterialForm(buildMaterialForm(file, noteId))

  return {
    material: data.material as InvestmentNoteMaterial,
    extractJob: data.extractJob ?? null,
    extractSkipReason: data.extractSkipReason ?? null,
  }
}

function buildMaterialForm(file: File, noteId?: string | null): FormData {
  const form = new FormData()
  form.set("file", file)
  if (noteId) form.set("noteId", noteId)
  return form
}

async function uploadMaterialInChunks(
  file: File,
  noteId?: string | null,
): Promise<Record<string, any>> {
  const totalChunks = Math.max(1, Math.ceil(file.size / MATERIAL_CHUNK_SIZE_BYTES))
  const sessionId = crypto.randomUUID()
  let last: Record<string, any> = {}

  for (let i = 0; i < totalChunks; i++) {
    const start = i * MATERIAL_CHUNK_SIZE_BYTES
    const end = Math.min(start + MATERIAL_CHUNK_SIZE_BYTES, file.size)
    const chunk = new File([file.slice(start, end)], file.name, {
      type: file.type || "application/octet-stream",
    })
    const form = new FormData()
    form.set("file", chunk)
    form.set("chunkSessionId", sessionId)
    form.set("chunkIndex", String(i))
    form.set("totalChunks", String(totalChunks))
    form.set("originalFileName", file.name)
    form.set("originalFileSize", String(file.size))
    if (noteId) form.set("noteId", noteId)
    last = await postMaterialForm(form)
  }

  if (!last?.material) {
    throw new Error("上传失败：服务器未返回文件信息")
  }
  return last
}

export async function extractInvestmentNoteMaterialElements(id: string): Promise<unknown> {
  const data = await apiFetch<{ ok: true; extractJob: unknown }>(
    `/ma/api/investment-notes/materials/${encodeURIComponent(id)}/extract-elements`,
    { method: "POST", body: "{}" },
  )
  return data.extractJob
}

export async function linkInvestmentNoteMaterial(
  id: string,
  noteId: string | null,
): Promise<InvestmentNoteMaterial> {
  const data = await apiFetch<{ ok: true; material: InvestmentNoteMaterial }>(
    "/ma/api/investment-notes/materials",
    {
      method: "PUT",
      body: JSON.stringify({ id, noteId }),
    },
  )
  return data.material
}

export async function deleteInvestmentNoteMaterial(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(
    `/ma/api/investment-notes/materials?id=${encodeURIComponent(id)}`,
    { method: "DELETE" },
  )
}

export type GeneratedInvestmentNoteFromMaterials = {
  note: InvestmentNote
  materials: InvestmentNoteMaterial[]
  skipped: string[]
}

/** Generate, save, and link an investment note from selected「上传资料」files. */
export async function generateInvestmentNoteFromMaterials(
  materialIds: string[],
): Promise<GeneratedInvestmentNoteFromMaterials> {
  const data = await apiFetch<{
    ok: true
    note: InvestmentNote
    materials: InvestmentNoteMaterial[]
    skipped?: string[]
  }>("/ma/api/investment-notes/generate-from-materials", {
    method: "POST",
    body: JSON.stringify({ materialIds }),
  })
  invalidateInvestmentNotesCache()
  const note = {
    ...data.note,
    contentPending: false,
    hasBody: Boolean(data.note.content?.trim()),
  }
  rememberFullNote(note)
  return {
    note,
    materials: Array.isArray(data.materials) ? data.materials : [],
    skipped: Array.isArray(data.skipped) ? data.skipped : [],
  }
}

export function investmentNoteMaterialFileUrl(id: string): string {
  return `/ma/api/investment-notes/materials/${encodeURIComponent(id)}/file`
}

/** Open a stored material in a new tab (sends auth header). */
export async function openInvestmentNoteMaterial(id: string): Promise<void> {
  const res = await fetch(investmentNoteMaterialFileUrl(id), {
    headers: {
      ...authHeaders(),
    },
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || res.statusText || "无法打开文件")
  }
  const blob = await res.blob()
  const disposition = res.headers.get("Content-Disposition") || ""
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
  const filename = match
    ? decodeURIComponent((match[1] || match[2] || "").trim())
    : undefined
  const url = URL.createObjectURL(blob)
  const opened = window.open(url, "_blank")
  if (!opened) {
    const a = document.createElement("a")
    a.href = url
    a.download = filename || "material"
    a.click()
  } else {
    try {
      opened.opener = null
    } catch {
      /* ignore */
    }
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
