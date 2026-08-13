/** Max stored note HTML length (includes markup, not just visible text). */
export const MAX_INVESTMENT_NOTE_CONTENT_CHARS = 10_000_000
export const MAX_INVESTMENT_NOTE_TITLE_CHARS = 200

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
  otherInfo?: string
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
    noteHtmlField("其他补充信息", row.otherInfo),
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

export async function listInvestmentNotes(scope: "team" | "mine"): Promise<InvestmentNote[]> {
  const data = await apiFetch<{ ok: true; notes: InvestmentNote[] }>(
    `/ma/api/investment-notes?scope=${scope}`,
  )
  return data.notes
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
  return data.note
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
  return data.note
}

export async function deleteInvestmentNote(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/ma/api/investment-notes?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
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

export async function uploadInvestmentNoteMaterial(
  file: File,
  noteId?: string | null,
): Promise<InvestmentNoteMaterial> {
  const form = new FormData()
  form.set("file", file)
  if (noteId) form.set("noteId", noteId)

  const res = await fetch("/ma/api/investment-notes/materials", {
    method: "POST",
    headers: {
      ...authHeaders(),
    },
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || res.statusText || "上传失败")
  }
  return data.material as InvestmentNoteMaterial
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
