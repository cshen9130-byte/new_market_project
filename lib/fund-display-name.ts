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
  const s = raw.trim()
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

function toDisplayLabel(raw: string): string {
  const normalized = normalizeFundDisplayName(raw)
  // Final guarantee: the long legal wording must never remain in UI labels.
  const stripped = stripLegalPhrases(normalized || raw).trim()
  return stripped || normalized || raw.trim()
}

/**
 * Preferred table/chart label.
 * Note: some APIs invert fields (short_name = full legal name, product_name = short).
 * We normalize both and keep the shortest clean label.
 */
export function resolveFundDisplayLabel(
  shortName: string | null | undefined,
  productName: string,
): string {
  // Prefer product_name first for equal-length ties — in several list APIs it is
  // already the shorter/display name while short_name holds the full legal name.
  const labels = [productName, shortName]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .map(toDisplayLabel)
  if (labels.length === 0) return ""
  return labels.reduce((a, b) => (a.length <= b.length ? a : b))
}
