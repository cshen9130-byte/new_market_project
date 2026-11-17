import { investmentNoteDeepLink, type InvestmentNote } from "@/lib/ma/investment-notes"
import { FUND_DATA_PUBLIC_HTTPS_ORIGIN } from "@/lib/ma/fund-data-public"

const TEXT_CAP = 12_000
const EXCERPT_RADIUS = 160

export function notePlainText(note: Pick<InvestmentNote, "content" | "preview">): string {
  const raw = (note.content || note.preview || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
  return raw
}

export function noteExcerpt(text: string, keyword: string, radius = EXCERPT_RADIUS): string {
  const q = keyword.trim()
  if (!text) return ""
  if (!q) return text.slice(0, radius * 2)
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0) return text.slice(0, radius * 2)
  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + q.length + radius)
  const slice = text.slice(start, end).trim()
  return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`
}

export type WebsiteNoteHit = {
  id: string
  title: string
  scope: "team" | "mine"
  match: "title" | "body"
  creator: string
  modified_date: string
  created_date: string
  source_label: string
  excerpt: string
  text: string | null
  url: string
}

export function rankWebsiteNotes(
  notes: Array<{ note: InvestmentNote; scope: "team" | "mine" }>,
  keyword: string,
  limit = 8,
): WebsiteNoteHit[] {
  const q = keyword.trim().toLowerCase()
  if (!q) return []
  const hits = notes.flatMap(({ note, scope }) => {
    const title = note.title || "无标题"
    const plain = notePlainText(note)
    const titleHit = title.toLowerCase().includes(q)
    const bodyHit = plain.toLowerCase().includes(q)
      || (note.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
      || (note.associations ?? []).some((item) =>
        `${item.name} ${item.recordNo}`.toLowerCase().includes(q))
    if (!titleHit && !bodyHit) return []
    return [{
      note,
      scope,
      title,
      plain,
      match: titleHit ? "title" as const : "body" as const,
    }]
  })
  hits.sort((a, b) => {
    if (a.match !== b.match) return a.match === "title" ? -1 : 1
    return (b.note.modifiedDate || "").localeCompare(a.note.modifiedDate || "")
  })
  let textsLeft = 2
  return hits.slice(0, limit).map((hit) => {
    const includeText = textsLeft > 0
    if (includeText) textsLeft -= 1
    const text = includeText ? hit.plain.slice(0, TEXT_CAP) : null
    return {
      id: hit.note.id,
      title: hit.title,
      scope: hit.scope,
      match: hit.match,
      creator: hit.note.creator || "",
      modified_date: hit.note.modifiedDate || "",
      created_date: hit.note.createdDate || "",
      source_label: hit.note.sourceLabel || "",
      excerpt: noteExcerpt(hit.plain || hit.title, keyword),
      text: text && text.length < hit.plain.length ? `${text}…` : text,
      url: `${FUND_DATA_PUBLIC_HTTPS_ORIGIN}${investmentNoteDeepLink({
        id: hit.note.id,
        title: hit.title,
        scope: hit.scope,
      })}`,
    }
  })
}
