import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"

/** True when the stored product name is just a 备案号 / ticker, not a display name. */
export function isCodeLikeProductName(name: string, beianHao?: string): boolean {
  const n = name.trim()
  const code = (beianHao ?? "").trim()
  if (!n) return true
  if (code && n.toUpperCase() === code.toUpperCase()) return true
  return /^[A-Z0-9]{4,10}$/i.test(n) && !/[\u4e00-\u9fff]/u.test(n)
}

/** Prefer a real Chinese/display name over a 备案号 or ticker such as AWM31C. */
export function preferNonCodeFundName(
  primary: string | null | undefined,
  fallback: string | null | undefined,
  beianHao?: string,
): string {
  const a = (primary ?? "").trim()
  const b = (fallback ?? "").trim()
  if (a && !isCodeLikeProductName(a, beianHao)) return a
  if (b && !isCodeLikeProductName(b, beianHao)) return b
  return a || b || (beianHao ?? "").trim()
}

/** Legal fund-type phrases that are redundant in private-fund UI labels. */
const LEGAL_PHRASES =
  "私募证券投资基金|私募股权投资基金|私募基金|证券投资基金|投资基金"

const BARE_LEGAL_RE = new RegExp(
  `^(?:${LEGAL_PHRASES})(?:[(（]?[A-Z]类?[)）]?|[A-Z]类?)?$`,
  "u",
)

/**
 * Trailing share-class markers:
 * A类 / A / (A类) / （A类） / (A) / （A）
 */
const SHARE_CLASS_RE = /(?:[(（]([A-Z])类?[)）]|([A-Z])类)$/u
const BARE_SHARE_LETTER_RE = /([A-Z])$/u
const BARE_FRAGMENT_RE = /^(?:私募|基金|证券|投资|证券投资)$/u

function stripLegalPhrases(value: string): string {
  return value.replace(new RegExp(LEGAL_PHRASES, "gu"), "")
}

function hasLegalPhrase(value: string): boolean {
  return new RegExp(LEGAL_PHRASES, "u").test(value)
}

/** Strip legal fund-type suffixes for UI display; preserve A/B/C… share class. */
export function normalizeFundDisplayName(raw: string): string {
  let s = raw.trim()
  if (!s) return s
  // Announcement subjects often start with 关于…基金合同变更 / 净值通知.
  s = s.replace(/^关于+/u, "")
  if (!s) return s
  if (BARE_LEGAL_RE.test(s)) return ""

  let shareClass = ""
  let base = s

  const sc = s.match(SHARE_CLASS_RE)
  if (sc) {
    const letter = sc[1] ?? sc[2] ?? ""
    shareClass = letter ? `${letter}类` : ""
    base = s.slice(0, -sc[0].length)
  } else {
    const letterOnly = s.match(BARE_SHARE_LETTER_RE)
    // Only treat a lone trailing Latin letter as share class when a legal phrase
    // precedes it (avoids chopping English product codes like "CTA").
    if (letterOnly && hasLegalPhrase(s.slice(0, -1))) {
      shareClass = `${letterOnly[1]}类`
      base = s.slice(0, -1)
    }
  }

  base = stripLegalPhrases(base).replace(/[（()）\s_-]+$/u, "").trim()
  if (!base || BARE_FRAGMENT_RE.test(base)) return ""
  return `${base}${shareClass}`
}

/** Same product after dropping 全称 / 份额 / A类, so a rename does not look like a short name. */
function displayNameKey(label: string): string {
  return label
    .replace(/[ABC]类(?:份额)?$/u, "")
    .replace(/\s+/gu, "")
    .replace(/份额$/u, "")
}

function trailingShareClass(label: string): string {
  return label.match(/([A-Z])类$/u)?.[1] ?? ""
}

/** EJ748B → B. Parent codes such as SEJ748 are left unchanged. */
function shareClassLetterFromBeian(beianHao: string | null | undefined): string {
  return String(beianHao ?? "").trim().toUpperCase().match(/([ABC])$/u)?.[1] ?? ""
}

/**
 * When both stored names omit the class, the filing code is the remaining signal
 * (众量资产聚宝19号 + EJ748B → 众量资产聚宝19号B类).
 */
export function appendShareClassFromBeian(
  label: string,
  beianHao: string | null | undefined,
): string {
  const name = label.trim()
  const letter = shareClassLetterFromBeian(beianHao)
  if (!name || !letter || trailingShareClass(name)) return name
  return `${name}${letter}类`
}

function toDisplayLabel(raw: string): string {
  // Drop 估值表 subject-path prefixes (场外_已上市_开放式_私募_…) before legal cleanup.
  const withoutSubjectPath = stripValuationSubjectPathPrefix(raw) || raw
  const normalized = normalizeFundDisplayName(withoutSubjectPath)
  // Final guarantee: the long legal wording must never remain in UI labels.
  const stripped = stripLegalPhrases(normalized || withoutSubjectPath).trim()
  return stripped || normalized || withoutSubjectPath.trim() || raw.trim()
}

/**
 * Preferred table/chart label.
 * Note: some APIs invert fields (short_name = full legal name, product_name = short).
 * We normalize both and keep the shortest clean label, unless only one of them
 * still has the A/B/C share class.
 */
export function resolveFundDisplayLabel(
  shortName: string | null | undefined,
  productName: string,
  beianHao?: string | null,
): string {
  const productLabel = toDisplayLabel((productName ?? "").trim())
  const shortLabel = toDisplayLabel((shortName ?? "").trim())
  const labels = [productLabel, shortLabel].filter(Boolean)
  if (labels.length === 0) return ""
  const productKey = displayNameKey(productLabel)
  const shortKey = displayNameKey(shortLabel)
  // A rename (兰盈中性增强 vs 兰盈俱乐部3号) is not a full-name/short-name pair.
  // Keep product_name: list and detail APIs put the AMAC official name there.
  if (productKey && shortKey && productKey !== shortKey) return productLabel
  // Same product: a short name often omits A/B/C类. Keep the class-bearing label.
  const productClass = trailingShareClass(productLabel)
  const shortClass = trailingShareClass(shortLabel)
  if (productClass && !shortClass) return productLabel
  if (shortClass && !productClass) return shortLabel
  // Prefer product_name first for equal-length ties — in several list APIs it is
  // already the shorter/display name while short_name holds the full legal name.
  const shortest = labels.reduce((a, b) => (a.length <= b.length ? a : b))
  return appendShareClassFromBeian(shortest, beianHao)
}
