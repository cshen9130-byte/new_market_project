import {
  associationKey,
  type InvestmentNote,
  type InvestmentNoteAssociation,
  type InvestmentNoteExtractedProduct,
} from "@/lib/ma/investment-notes"
import { resolveExtractedProductCandidates } from "@/lib/server/investment-note-extracted-products"
import { normalizeRegisterCode } from "@/lib/server/fund-picker-search"

/** Author / creatorId used by the external-KB import pipeline. */
export const EXTERNAL_NOTE_AUTHOR = "外部笔记"

export function isExternalInvestmentNote(
  note: Pick<InvestmentNote, "creator"> & { creatorId?: string },
): boolean {
  return note.creator === EXTERNAL_NOTE_AUTHOR || note.creatorId === EXTERNAL_NOTE_AUTHOR
}

/**
 * Turn catalog-matched extracted products into association rows.
 * Precision policy: only confidence matched/applied AND a non-empty register code.
 * Vague series names or manager-only mentions stay out of associations.
 */
export function associationsFromMatchedExtractedProducts(
  products: InvestmentNoteExtractedProduct[] | undefined | null,
): InvestmentNoteAssociation[] {
  const out: InvestmentNoteAssociation[] = []
  const seen = new Set<string>()
  for (const item of products ?? []) {
    const confidence = item.confidence || "extracted"
    if (confidence !== "matched" && confidence !== "applied") continue
    const recordNo = (item.recordNo || "").trim()
    const name = (item.name || "").trim()
    if (!recordNo) continue
    const assoc: InvestmentNoteAssociation = {
      category: "私募基金",
      name: name || recordNo,
      recordNo,
    }
    const key = associationKey(assoc)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(assoc)
  }
  return out
}

export function mergeInvestmentNoteAssociations(
  existing: InvestmentNoteAssociation[] | undefined | null,
  incoming: InvestmentNoteAssociation[] | undefined | null,
): InvestmentNoteAssociation[] {
  const out: InvestmentNoteAssociation[] = []
  const seen = new Set<string>()
  for (const item of [...(existing ?? []), ...(incoming ?? [])]) {
    const name = (item.name || "").trim()
    const recordNo = (item.recordNo || "").trim()
    if (!name && !recordNo) continue
    const assoc: InvestmentNoteAssociation = {
      category: (item.category || "私募基金").trim() || "私募基金",
      name: name || recordNo,
      recordNo,
    }
    const key = associationKey(assoc)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(assoc)
  }
  return out
}

function plainTextFromHtml(html: string): string {
  return String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

const BEIAN_IN_TEXT_RE = /\b([A-Z][A-Z0-9]{4,7}[A-Z]?)\b/g
const FULL_PRODUCT_RE =
  /([\u4e00-\u9fffA-Za-z0-9]{2,40}(?:\u79c1\u52df\u8bc1\u5238\u6295\u8d44\u57fa\u91d1|\u79c1\u52df\u6295\u8d44\u57fa\u91d1|\u8bc1\u5238\u6295\u8d44\u57fa\u91d1))/g
const NUMBERED_PRODUCT_RE =
  /([\u4e00-\u9fff]{2,20}\d{1,4}\u53f7(?:[\u4e00-\u9fffA-Za-z0-9]{0,24})?(?:\u79c1\u52df\u8bc1\u5238\u6295\u8d44\u57fa\u91d1|\u79c1\u52df\u6295\u8d44\u57fa\u91d1|\u6307\u6570\u589e\u5f3a|\u91cf\u5316\u9009\u80a1|CTA)?)/g
const LABELED_PRODUCT_RE =
  /(?:\u4ee3\u8868\u4ea7\u54c1|\u4ea7\u54c1\u540d\u79f0|\u4ea7\u54c1\u5168\u79f0|\u5173\u8054\u4ea7\u54c1|\u4ea7\u54c1)[\uff1a:\s]*([\u4e00-\u9fffA-Za-z0-9\uff08\uff09()]{4,60})/g
const MANAGER_ONLY_RE = /^[\u4e00-\u9fff]{2,12}(?:\u8d44\u4ea7|\u6295\u8d44|\u8d44\u672c|\u57fa\u91d1|\u8d44\u7ba1|\u91cf\u5316|\u7814\u7a76|\u7ba1\u7406)$/u

function extractRegisterCodesFromPlain(text: string): string[] {
  const out = new Set<string>()
  for (const match of text.toUpperCase().matchAll(BEIAN_IN_TEXT_RE)) {
    const code = normalizeRegisterCode(match[1])
    if (code) out.add(code)
  }
  return Array.from(out)
}

function extractProductNameCandidates(title: string, plain: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    let value = raw.replace(/[\uFF0C,\u3002\uFF1B;\u3001].*$/u, "").replace(/[\uff08(][^\uff09)]*[\uff09)]$/u, "").trim()
    value = value.replace(/^(?:\u662f|\u4e3a|\u5305\u62ec|\u542b|\u6709)/u, "").trim()
    if (value.length < 4 || value.length > 60) return
    if (MANAGER_ONLY_RE.test(value)) return
    if (/^(?:\u516c\u53f8|\u56e2\u961f|\u7b56\u7565|\u89c4\u6a21|\u7ba1\u7406\u4eba)/u.test(value)) return
    const key = value.replace(/\s+/g, "")
    if (seen.has(key)) return
    seen.add(key)
    out.push(value)
  }

  for (const re of [FULL_PRODUCT_RE, NUMBERED_PRODUCT_RE, LABELED_PRODUCT_RE]) {
    re.lastIndex = 0
    for (const match of plain.matchAll(re)) {
      add(match[1] || match[0])
    }
  }

  const titleProduct =
    title.match(/([\u4e00-\u9fff]{2,20}\d{1,4}\u53f7[\u4e00-\u9fffA-Za-z0-9]{0,30})/) ||
    title.match(/([\u4e00-\u9fffA-Za-z0-9]{4,40}(?:\u79c1\u52df\u8bc1\u5238\u6295\u8d44\u57fa\u91d1|\u6307\u6570\u589e\u5f3a))/)
  if (titleProduct?.[1]) add(titleProduct[1])

  return out.slice(0, 24)
}

/**
 * Fallback when a note has no matched extractedProducts: parse title+body for
 * register codes / explicit product names and resolve only high-confidence catalog hits.
 * Manager-only mentions are ignored.
 */
export async function resolveAssociationsFromNoteText(input: {
  title: string
  content: string
}): Promise<InvestmentNoteAssociation[]> {
  const title = String(input.title || "").trim()
  const plain = [title, plainTextFromHtml(input.content)].filter(Boolean).join("\n")
  if (plain.length < 8) return []

  const codes = extractRegisterCodesFromPlain(plain)
  const names = extractProductNameCandidates(title, plain)
  const raw = [
    ...codes.map((recordNo) => ({ name: "", recordNo })),
    ...names.map((name) => ({ name, recordNo: "" })),
  ]
  if (raw.length === 0) return []

  try {
    const resolved = await resolveExtractedProductCandidates(raw, title)
    return associationsFromMatchedExtractedProducts(resolved)
  } catch (err) {
    console.error("[investment-note-auto-associate] text resolve failed", err)
    return []
  }
}

export async function resolveAutoAssociationsForNote(input: {
  title: string
  content: string
  extractedProducts?: InvestmentNoteExtractedProduct[] | null
  /** When true, also parse title/body if extracted products yielded nothing. */
  allowTextFallback?: boolean
}): Promise<{
  associations: InvestmentNoteAssociation[]
  fromExtracted: number
  fromText: number
}> {
  const fromExtracted = associationsFromMatchedExtractedProducts(input.extractedProducts)
  let fromText: InvestmentNoteAssociation[] = []
  if (fromExtracted.length === 0 && input.allowTextFallback !== false) {
    fromText = await resolveAssociationsFromNoteText({
      title: input.title,
      content: input.content,
    })
  }
  return {
    associations: mergeInvestmentNoteAssociations(fromExtracted, fromText),
    fromExtracted: fromExtracted.length,
    fromText: fromText.length,
  }
}
