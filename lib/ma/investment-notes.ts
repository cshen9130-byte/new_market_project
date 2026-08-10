/** Max stored note HTML length (includes markup, not just visible text). */
export const MAX_INVESTMENT_NOTE_CONTENT_CHARS = 10_000_000
export const MAX_INVESTMENT_NOTE_TITLE_CHARS = 200

/**
 * Shrink pasted rich HTML (e.g. WeChat articles) by dropping scripts, classes,
 * data-* attrs, and bulky inline styles while keeping structure/tables/text.
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

export type InvestmentNoteContentVariant = "analysis" | "memo" | "plain"

export type InvestmentNote = {
  id: string
  title: string
  content: string
  preview: string
  contentVariant: InvestmentNoteContentVariant
  teamShared: boolean
  tags: string[]
  associations: InvestmentNoteAssociation[]
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
  partial?: Partial<Pick<InvestmentNote, "title" | "content" | "teamShared">>,
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
